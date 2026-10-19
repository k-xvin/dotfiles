/**
 * Detached commands with per-job logs and runner-owned results.
 * Jobs survive Pi shutdown; automatic completion follow-ups require the live
 * extension runtime. Resumed sessions can inspect saved jobs by ID.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import {
	DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead, truncateLine, truncateTail,
	type ExtensionAPI, type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const JOB_ROOT = path.join(process.env.HOME || ".", ".pi", "agent", "jobs");
const LOG_TAIL_BYTES = 12 * 1024;
const RECENT_COMPLETIONS = 10;
const COMMAND_PREVIEW_CHARS = 120;
const JOB_ID_PATTERN = "^J[0-9A-F]{8}$";

type JobState = "running" | "passed" | "failed" | "cancelled" | "unknown";

interface JobRecord {
	id: string;
	command: string;
	cwd: string;
	state: JobState;
	pid?: number;
	startedAt: number;
	endedAt?: number;
	exitCode?: number | null;
	stdoutPath: string;
	stderrPath: string;
	ownerSessionId?: string;
}

const JobId = Type.String({ pattern: JOB_ID_PATTERN, description: "Job ID returned by background_start" });
const StartParams = Type.Object({
	command: Type.String({ description: "Shell command to run in the background" }),
	cwd: Type.Optional(Type.String({ description: "Working directory; defaults to the current Pi cwd" })),
});
const JobParams = Type.Object({ id: JobId });
const LogsParams = Type.Object({
	id: JobId,
	stream: Type.Optional(StringEnum(["stdout", "stderr", "both"] as const)),
	maxBytes: Type.Optional(Type.Integer({ minimum: 1024, maximum: 45000, description: "Total response budget across both streams, including headers" })),
});

function jobDir(id: string): string {
	return path.join(JOB_ROOT, id);
}
function metadataPath(id: string): string {
	return path.join(jobDir(id), "metadata.json");
}
function persist(record: JobRecord): void {
	const file = metadataPath(record.id);
	const temporary = `${file}.${process.pid}.tmp`;
	fs.writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
	fs.renameSync(temporary, file);
}
function processAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
function readJob(id: string): JobRecord {
	if (!new RegExp(JOB_ID_PATTERN).test(id)) throw new Error(`Invalid background job ID: ${id}`);
	let record: JobRecord;
	try {
		record = JSON.parse(fs.readFileSync(metadataPath(id), "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`Unknown background job ID: ${id}`);
		throw error;
	}
	if (record.state === "running" && record.pid && !processAlive(record.pid)) {
		// The runner can finish between the first read and the liveness check.
		record = JSON.parse(fs.readFileSync(metadataPath(id), "utf8"));
		if (record.state === "running") {
			record.state = "unknown";
			record.endedAt ??= Date.now();
			persist(record);
		}
	}
	return record;
}
function sessionJobs(sessionId: string): JobRecord[] {
	const jobs: JobRecord[] = [];
	if (!fs.existsSync(JOB_ROOT)) return jobs;
	for (const entry of fs.readdirSync(JOB_ROOT, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		try {
			const record = readJob(entry.name);
			if (record.ownerSessionId === sessionId) jobs.push(record);
		} catch {
			// Ignore incomplete/malformed metadata from an interrupted write.
		}
	}
	jobs.sort((a, b) => b.startedAt - a.startedAt);
	return [
		...jobs.filter((job) => job.state === "running"),
		...jobs.filter((job) => job.state !== "running")
			.sort((a, b) => (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt))
			.slice(0, RECENT_COMPLETIONS),
	];
}
function elapsed(record: JobRecord): string {
	const seconds = Math.max(0, Math.floor(((record.endedAt ?? Date.now()) - record.startedAt) / 1000));
	return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}
function display(record: JobRecord): string {
	const exit = record.state === "running" ? "" : ` · exit ${record.exitCode ?? "n/a"}`;
	const preview = truncateLine(record.command.replace(/\s+/g, " ").trim(), COMMAND_PREVIEW_CHARS).text;
	return `${record.id} · ${record.state} · ${elapsed(record)}${exit} · ${preview}`;
}
function bounded(text: string, maxBytes = DEFAULT_MAX_BYTES): string {
	const notice = "\n[Output truncated. Full metadata/logs are under ~/.pi/agent/jobs.]";
	if (!truncateHead(text, { maxBytes }).truncated) return text;
	const result = truncateHead(text, { maxBytes: Math.max(0, maxBytes - Buffer.byteLength(notice)), maxLines: DEFAULT_MAX_LINES - 1 });
	return result.content + notice;
}
function status(record: JobRecord): string {
	return bounded([
		display(record),
		`Command: ${record.command}`,
		`Cwd: ${record.cwd}`,
		`Stdout: ${record.stdoutPath}`,
		`Stderr: ${record.stderrPath}`,
	].join("\n"));
}
function statusList(jobs: JobRecord[]): string {
	return bounded(jobs.length ? jobs.map(display).join("\n") : "No background jobs in this session.");
}
function tail(file: string, maxBytes: number, maxLines: number) {
	try {
		return truncateTail(fs.readFileSync(file, "utf8"), { maxBytes, maxLines });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		return { content: "", truncated: false };
	}
}

/** The runner writes the final result even if Pi reloads or exits. */
function writeRunner(file: string): void {
	const source = `
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const metadataPath = process.argv[2];
let record = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
const out = fs.openSync(record.stdoutPath, "a");
const err = fs.openSync(record.stderrPath, "a");
let cancelled = false;
// A separate process group lets cancellation signal the whole command tree.
const child = spawn("/bin/bash", ["-c", record.command], { cwd: record.cwd, stdio: ["ignore", out, err], detached: true });
const signalGroup = (signal) => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try { process.kill(-child.pid, signal); } catch {}
};
let watchdog;
const finish = (code, signal) => {
  if (watchdog) clearTimeout(watchdog);
  try { record = JSON.parse(fs.readFileSync(metadataPath, "utf8")); } catch {}
  record.endedAt = Date.now();
  record.exitCode = code;
  record.state = cancelled ? "cancelled" : code === 0 && !signal ? "passed" : "failed";
  const temporary = metadataPath + "." + process.pid + ".tmp";
  fs.writeFileSync(temporary, JSON.stringify(record, null, 2) + "\\n", { mode: 0o600 });
  fs.renameSync(temporary, metadataPath);
  try { fs.closeSync(out); fs.closeSync(err); } catch {}
  try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch {}
  process.exit(typeof code === "number" ? code : 1);
};
const cancel = (signal) => {
  cancelled = true;
  signalGroup(signal);
  // Give SIGTERM 10s before forcing the command group to exit.
  watchdog ??= setTimeout(() => { signalGroup("SIGKILL"); finish(128 + 9, "SIGKILL"); }, 10000);
  watchdog.unref();
};
child.on("close", finish);
child.on("error", (error) => { fs.writeSync(err, error.message + "\\n"); finish(1, null); });
process.on("SIGTERM", () => cancel("SIGTERM"));
process.on("SIGINT", () => cancel("SIGINT"));
`;
	fs.writeFileSync(file, source, { mode: 0o700 });
}

export default function backgroundJobs(pi: ExtensionAPI) {
	const pendingCompletions = new Map<string, JobRecord>();
	let completionTimer: NodeJS.Timeout | undefined;
	let currentCtx: ExtensionContext | undefined;

	const deliverCompletions = () => {
		completionTimer = undefined;
		if (!currentCtx || !currentCtx.isIdle()) return;
		const jobs = [...pendingCompletions.values()].slice(0, RECENT_COMPLETIONS);
		if (!jobs.length) return;
		try {
			pi.sendMessage({
				customType: "background-job-completion",
				content: [
					"Background jobs completed:",
					...jobs.map(display),
					"Inspect each result with background_logs({id: ...}) and continue the current task. Do not repeat completion notices.",
				].join("\n"),
				display: false,
			}, { triggerTurn: true, deliverAs: "followUp" });
			for (const job of jobs) pendingCompletions.delete(job.id);
		} catch {
			// Keep the pending IDs if the runtime cannot accept a follow-up.
		}
	};
	const scheduleCompletions = () => {
		if (completionTimer || !pendingCompletions.size) return;
		completionTimer = setTimeout(deliverCompletions, 250);
		completionTimer.unref();
	};
	const complete = (record: JobRecord) => {
		if (!currentCtx || record.ownerSessionId !== currentCtx.sessionManager.getSessionId()) return;
		currentCtx.ui.notify(display(record), record.state === "passed" ? "info" : record.state === "failed" ? "error" : "warning");
		pendingCompletions.set(record.id, record);
		scheduleCompletions();
	};

	pi.on("session_start", async (_event, ctx) => { currentCtx = ctx; });
	pi.on("agent_settled", scheduleCompletions);
	pi.on("session_shutdown", async () => {
		currentCtx = undefined;
		pendingCompletions.clear();
		if (completionTimer) clearTimeout(completionTimer);
		completionTimer = undefined;
		// Detached jobs deliberately outlive the extension runtime.
	});

	pi.registerCommand("jobs", {
		description: "Show this session's running jobs and ten recent completions",
		handler: async (_args, ctx) => {
			ctx.ui.notify(statusList(sessionJobs(ctx.sessionManager.getSessionId())), "info");
		},
	});

	pi.registerTool({
		name: "background_start",
		label: "Background job",
		description: "Start a long-running command without blocking Pi. Use for builds, tests, flashing, CI polling, or commands expected to take more than a minute. Returns a job ID; completion arrives automatically while this runtime is live. Continue other work or yield instead of polling. After reload/resume, inspect saved IDs explicitly.",
		parameters: StartParams,
		async execute(_id, params, _signal, _update, ctx) {
			const id = `J${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
			const dir = jobDir(id);
			fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
			const record: JobRecord = {
				id, command: params.command, cwd: params.cwd || ctx.cwd,
				state: "running", startedAt: Date.now(),
				stdoutPath: path.join(dir, "stdout.log"), stderrPath: path.join(dir, "stderr.log"),
				ownerSessionId: ctx.sessionManager.getSessionId(),
			};
			persist(record);
			const runnerPath = path.join(dir, "runner.cjs");
			writeRunner(runnerPath);
			const child = spawn(process.execPath, [runnerPath, metadataPath(id)], {
				cwd: record.cwd, detached: true, stdio: "ignore",
			});
			record.pid = child.pid;
			persist(record);
			child.unref();
			child.on("error", (error) => {
				// No runner exists to record a launch failure.
				record.state = "failed";
				record.endedAt = Date.now();
				record.exitCode = 1;
				fs.appendFileSync(record.stderrPath, `${error.message}\n`, { mode: 0o600 });
				persist(record);
			});
			child.on("close", () => {
				try {
					complete(readJob(id));
				} catch {
					currentCtx?.ui.notify(`Cannot read result for ${id}; inspect ${metadataPath(id)}.`, "error");
				}
			});
			return {
				content: [{ type: "text", text: `Started ${id}\n${display(record)}\nCompletion arrives automatically while this runtime is live. Continue independent work or yield instead of polling.\nAfter reload/resume, inspect saved ID ${id} explicitly; completion notices are not replayed. background_logs returns state, exit status, and log tails. Use background_cancel to stop the job.` }],
				details: record,
			};
		},
	});

	pi.registerTool({
		name: "background_status",
		label: "Background status",
		description: "Inspect a job by ID, or list this session's running jobs and ten recent completions. Output is capped at 50 KiB or 2000 lines.",
		parameters: Type.Object({ id: Type.Optional(JobId) }),
		async execute(_id, params, _signal, _update, ctx) {
			if (params.id) {
				const record = readJob(params.id);
				return { content: [{ type: "text", text: status(record) }], details: record };
			}
			const jobs = sessionJobs(ctx.sessionManager.getSessionId());
			return { content: [{ type: "text", text: statusList(jobs) }], details: { ids: jobs.map((job) => job.id) } };
		},
	});

	pi.registerTool({
		name: "background_logs",
		label: "Background logs",
		description: "Inspect a job's state and log tails by ID. maxBytes bounds the entire response (default 12 KiB, maximum 45000 bytes); output is also capped at 2000 lines. Full logs remain on disk.",
		parameters: LogsParams,
		async execute(_id, params) {
			const record = readJob(params.id);
			const max = params.maxBytes ?? LOG_TAIL_BYTES;
			const stream = params.stream ?? "both";
			const streams = [
				{ name: "stdout", file: record.stdoutPath },
				{ name: "stderr", file: record.stderrPath },
			].filter((item) => stream === "both" || item.name === stream);
			const header = display(record);
			const prefixes = streams.map((item) => `\n\n== ${item.name}: ${item.file} ==\n`);
			const notice = "\n[Log tail truncated]";
			const overhead = Buffer.byteLength(header + prefixes.join("") + notice.repeat(streams.length));
			const bytesPerStream = Math.max(0, Math.floor((max - overhead) / streams.length));
			const linesPerStream = Math.floor((DEFAULT_MAX_LINES - 10) / streams.length);
			const sections = streams.map((item, i) => {
				const result = tail(item.file, bytesPerStream, linesPerStream);
				return prefixes[i] + (result.content || "(empty)") + (result.truncated ? notice : "");
			});
			const output = bounded(header + sections.join(""), max);
			if (record.state !== "running") pendingCompletions.delete(record.id);
			return { content: [{ type: "text", text: output }], details: record };
		},
	});

	pi.registerTool({
		name: "background_cancel",
		label: "Cancel background job",
		description: "Request cancellation of one job by ID. Preserves its logs and metadata; the runner records the final result after termination.",
		parameters: JobParams,
		async execute(_id, params) {
			const record = readJob(params.id);
			if (record.state !== "running") return { content: [{ type: "text", text: `${record.id} is already ${record.state}.` }], details: record };
			if (!record.pid) throw new Error(`Job ${record.id} has no runner PID.`);
			// The runner signals the command group, escalates after 10s, and saves the result.
			process.kill(record.pid, "SIGTERM");
			return {
				content: [{ type: "text", text: `Cancellation requested for ${record.id}.\nWork delegated to a container or remote host may keep running there and hold locks; verify there before retrying.` }],
				details: record,
			};
		},
	});
}
