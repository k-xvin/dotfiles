/**
 * Managed subagents for Pi.
 *
 * This is an owned fork of Pi 0.85.1's example.  Unlike the example, children
 * run in RPC mode with persistent sessions, retain partial transcripts when
 * stopped, and can be steered or cancelled individually while a parent call is
 * still active.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { StringEnum, type Usage } from "@earendil-works/pi-ai";
import {
	CONFIG_DIR_NAME,
	getAgentDir,
	getPackageDir,
	RpcClient,
	SessionManager,
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	truncateHead,
	truncateTail,
	getMarkdownTheme,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Container, Input, Markdown, Spacer, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { type AgentConfig, type AgentScope, discoverAgents } from "./agents.ts";

const MAX_PARALLEL_TASKS = 8;
const MAX_CONCURRENCY = 4;
const DISPLAY_ITEMS = 5;
const CHILD_HEALTH_CHECK_MS = 15 * 1000;
const SUBAGENT_SESSION_ROOT = path.join(getAgentDir(), "subagent-sessions");

type Status = "queued" | "running" | "completed" | "failed" | "cancelled";

interface UsageStats extends Usage {
	turns: number;
}

interface SubagentResult {
	id: string;
	agent: string;
	agentSource: "user" | "project" | "unknown";
	task: string;
	step?: number;
	status: Status;
	exitCode: number;
	startedAt?: number;
	endedAt?: number;
	lastActivityAt?: number;
	currentActivity?: string;
	lastActivity?: string;
	stderr: string;
	errorMessage?: string;
	model?: string;
	stopReason?: string;
	childSessionFile?: string;
	usage: UsageStats;
	usageIncomplete?: boolean;
	summary?: string;
}

interface ManagedResult extends SubagentResult {
	messages: any[];
}

interface SubagentDetails {
	mode: "single" | "parallel" | "chain";
	agentScope: AgentScope;
	projectAgentsDir: string | null;
	results: SubagentResult[];
}

interface ActiveChild {
	result: ManagedResult;
	client: RpcClient;
	cancel: () => Promise<void>;
	steer: (message: string) => Promise<void>;
}

interface TranscriptEntry {
	id: string;
	agent: string;
	status: Status;
	task: string;
	startedAt?: number;
	endedAt?: number;
	lastActivity?: string;
	childSessionFile?: string;
	summary: string;
}

function steeringTranscript(result: ManagedResult): string[] {
	const lines: string[] = [];
	for (const message of result.messages) {
		if (message?.role === "assistant") {
			for (const part of message.content ?? []) {
				if (part?.type === "thinking" && part.thinking) lines.push(`think  ${preview(part.thinking, 140)}`);
				if (part?.type === "text" && part.text) lines.push(`agent  ${preview(part.text, 140)}`);
				if (part?.type === "toolCall") lines.push(`tool   ${part.name} ${preview(JSON.stringify(part.arguments ?? {}), 100)}`);
			}
		} else if (message?.role === "toolResult") {
			const text = Array.isArray(message.content)
				? message.content.filter((part: any) => part?.type === "text").map((part: any) => part.text).join(" ")
				: "";
			if (text) lines.push(`result ${preview(text, 140)}`);
		}
	}
	return lines.slice(-12);
}

/** A focused transient overlay: inspect a child before sending it direction. */
class SteeringPanel {
	focused = false;
	private readonly input = new Input({ prompt: "Steer > ", placeholder: "Type direction for this subagent" });

	constructor(
		private readonly tui: any,
		private readonly theme: any,
		private readonly child: ActiveChild,
		private readonly done: (message: string | undefined) => void,
	) {
		this.input.onSubmit = (value) => done(value.trim() || undefined);
		this.input.onEscape = () => done(undefined);
	}

	handleInput(data: string): void {
		this.input.handleInput(data);
		this.tui.requestRender();
	}

	render(width: number): string[] {
		const inner = Math.max(36, width - 2);
		const border = (text: string) => this.theme.fg(this.focused ? "accent" : "border", text);
		const row = (text = "") => border("│") + truncateToWidth(text, inner, "...", true) + " ".repeat(Math.max(0, inner - visibleWidth(text))) + border("│");
		const result = this.child.result;
		const lines = [border(`╭${"─".repeat(inner)}╮`)];
		lines.push(row(` ${this.theme.fg("accent", `Steer ${result.agent}`)} ${this.theme.fg("dim", `${elapsed(result)} · ${result.status}`)}`));
		lines.push(row(` ${this.theme.fg("muted", `now: ${preview(renderActivity(result), inner - 7)}`)}`));
		lines.push(row());
		lines.push(row(` ${this.theme.fg("muted", "Recent transcript and thinking")}`));
		const transcript = steeringTranscript(result);
		if (transcript.length === 0) lines.push(row(` ${this.theme.fg("dim", "(waiting for child events)")}`));
		else for (const line of transcript) lines.push(row(` ${this.theme.fg("text", line)}`));
		lines.push(row());
		this.input.focused = this.focused;
		for (const line of this.input.render(Math.max(1, inner - 2))) lines.push(row(` ${line}`));
		lines.push(row(` ${this.theme.fg("dim", "Enter sends steering · Esc cancels")}`));
		lines.push(border(`╰${"─".repeat(inner)}╯`));
		return lines;
	}

	invalidate(): void {}
	dispose(): void {}
}

function usage(): UsageStats {
	return {
		input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, turns: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function addUsage(target: Usage, value: Usage): void {
	for (const kind of ["input", "output", "cacheRead", "cacheWrite"] as const) {
		target[kind] += value[kind] || 0;
		target.cost[kind] += value.cost?.[kind] || 0;
	}
	target.totalTokens = target.input + target.output + target.cacheRead + target.cacheWrite;
	target.cost.total += value.cost?.total || 0;
}

function isFailure(result: SubagentResult): boolean {
	return result.status === "failed" || result.status === "cancelled" || result.exitCode !== 0;
}

function elapsed(result: SubagentResult): string {
	if (!result.startedAt) return "";
	const ms = (result.endedAt ?? Date.now()) - result.startedAt;
	const seconds = Math.max(0, Math.floor(ms / 1000));
	return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function age(timestamp?: number): string {
	if (!timestamp) return "";
	return `${Math.max(0, Math.floor((Date.now() - timestamp) / 1000))}s ago`;
}

function promptAndWaitForChild(client: RpcClient, task: string, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		let done = false;
		let accepted = false;
		let settled = false;
		let checkingHealth = false;
		let heartbeat: ReturnType<typeof setInterval> | undefined;
		const finish = (error?: Error) => {
			if (done) return;
			done = true;
			if (heartbeat) clearInterval(heartbeat);
			unsubscribe();
			signal.removeEventListener("abort", abortHandler);
			if (error) reject(error);
			else resolve();
		};
		const abortHandler = () => finish(new Error("Subagent run was aborted"));
		const unsubscribe = client.onEvent((event: any) => {
			if (event.type !== "agent_settled") return;
			settled = true;
			if (accepted) finish();
		});
		if (signal.aborted) {
			abortHandler();
			return;
		}
		signal.addEventListener("abort", abortHandler, { once: true });
		// RPC responsiveness is independent of task duration or output activity.
		heartbeat = setInterval(() => {
			if (done || checkingHealth) return;
			checkingHealth = true;
			void client.getState().then(
				() => { checkingHealth = false; },
				(error: Error) => { checkingHealth = false; finish(error); },
			);
		}, CHILD_HEALTH_CHECK_MS);
		void client.prompt(`Task: ${task}`).then(
			() => { accepted = true; if (settled) finish(); },
			finish,
		);
	});
}

function textFromMessage(message: any): string {
	if (!message || message.role !== "assistant" || !Array.isArray(message.content)) return "";
	return message.content
		.filter((part: any) => part?.type === "text")
		.map((part: any) => part.text)
		.join("\n");
}

function finalOutput(messages: any[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const text = textFromMessage(messages[i]);
		if (text) return text;
	}
	return "";
}

function preview(text: string, width = 110): string {
	const singleLine = text.replace(/\s+/g, " ").trim();
	return singleLine.length > width ? `${singleLine.slice(0, width - 3)}...` : singleLine;
}

function capOutput(text: string, maxBytes = DEFAULT_MAX_BYTES, maxLines = DEFAULT_MAX_LINES): string {
	if (maxBytes <= 0 || maxLines <= 0) return "";
	if (!truncateHead(text, { maxBytes, maxLines }).truncated) return text;
	const notice = "[Output truncated; see child transcript.]";
	if (maxBytes <= Buffer.byteLength(notice) || maxLines === 1) {
		return truncateHead(notice, { maxBytes, maxLines }).content;
	}
	const contentBytes = maxBytes - Buffer.byteLength(notice) - 1;
	const clipped = truncateHead(text, { maxBytes: contentBytes, maxLines: maxLines - 1 });
	const content = clipped.firstLineExceedsLimit
		? truncateTail(text.split("\n", 1)[0], { maxBytes: contentBytes, maxLines: 1 }).content
		: clipped.content;
	return content ? `${content}\n${notice}` : notice;
}

function formatOutput(mode: SubagentDetails["mode"], results: ManagedResult[]): string {
	const completed = results.filter((result) => !isFailure(result)).length;
	const title = mode === "chain" && completed !== results.length
		? `Chain stopped at step ${results.length}`
		: `${mode}: ${completed}/${results.length} completed`;
	const metadata = [title, ...results.map((result, index) => [
		`[${index + 1}] ${preview(result.agent, 100)} · ${result.status} · ${result.id}`,
		`Transcript: ${result.childSessionFile ?? "unavailable"}`,
		...(result.usageIncomplete ? ["Usage incomplete: observed totals only."] : []),
	].join("\n"))].join("\n\n");
	const answers = mode === "chain" ? results.slice(-1) : results;
	const headings = answers.map((result) => `### [${results.indexOf(result) + 1}] ${preview(result.agent, 100)}`);
	const scaffold = [metadata, ...headings.map((heading) => `${heading}\n`)].join("\n\n");
	const bytes = Math.floor((DEFAULT_MAX_BYTES - Buffer.byteLength(scaffold)) / answers.length);
	const lines = Math.floor((DEFAULT_MAX_LINES - scaffold.split("\n").length) / answers.length);
	return capOutput([metadata, ...answers.map((result, index) =>
		`${headings[index]}\n${capOutput(resultText(result), bytes, lines)}`,
	)].join("\n\n"));
}

function storedResult(result: ManagedResult): SubagentResult {
	const { messages: _messages, ...stored } = result;
	return { ...stored, summary: capOutput(resultText(result)), usage: { ...result.usage, cost: { ...result.usage.cost } } };
}

function childSessionId(result: ManagedResult): string {
	return `subagent-${result.agent}-${result.id.slice(0, 8)}`;
}

function findSessionFile(root: string, id: string): string | undefined {
	const stack = [root];
	while (stack.length > 0) {
		const dir = stack.pop()!;
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const candidate = path.join(dir, entry.name);
			if (entry.isDirectory()) stack.push(candidate);
			else if (entry.name.endsWith(`_${id}.jsonl`)) return candidate;
		}
	}
	return undefined;
}

function rpcCliPath(): string {
	return path.join(getPackageDir(), "dist", "cli.js");
}

function eventActivity(event: any): string | undefined {
	const name = event?.toolName ?? event?.toolCall?.name ?? event?.tool?.name;
	if (typeof name === "string") return name;
	if (event?.type === "message_end" && event?.message?.role === "assistant") {
		const text = preview(textFromMessage(event.message), 90);
		if (text) return text;
	}
	return undefined;
}

function updateUsage(result: ManagedResult, message: any): void {
	if (message?.role !== "assistant") return;
	result.usage.turns++;
	if (message.stopReason) result.stopReason = message.stopReason;
	if (message.errorMessage) result.errorMessage = message.errorMessage;
	const value = message.usage;
	if (!value) return;
	addUsage(result.usage, value);
	if (!result.model && message.model) result.model = message.model;
}

function finalizeUsage(result: ManagedResult): void {
	result.usageIncomplete = true;
	if (!result.childSessionFile || !fs.existsSync(result.childSessionFile)) return;
	try {
		const session = SessionManager.open(result.childSessionFile);
		if (session.getSessionId() !== result.id) return;
		const total = usage();
		let incomplete = false;
		for (const entry of session.getEntries()) {
			if (entry.type === "message") {
				const message = entry.message;
				if (message.role === "assistant") {
					total.turns++;
					if (message.usage) addUsage(total, message.usage);
					else incomplete = true;
				} else if (message.role === "toolResult" && message.usage) {
					addUsage(total, message.usage);
				}
			} else if ((entry.type === "compaction" || entry.type === "branch_summary") && entry.usage) {
				addUsage(total, entry.usage);
			}
		}
		// A crash may leave the persisted transcript behind the observed events.
		if (total.turns < result.usage.turns) return;
		result.usage = total;
		result.usageIncomplete = incomplete;
	} catch {
		// Keep observed consumption when the saved session cannot be read.
	}
}

function renderActivity(result: SubagentResult): string {
	if (result.status === "queued") return "queued";
	if (result.status === "running") return result.currentActivity ?? result.lastActivity ?? "starting";
	return result.lastActivity ?? result.errorMessage ?? resultText(result);
}

function renderLines(result: SubagentResult): string[] {
	const icon = result.status === "running" || result.status === "queued" ? "⏳" : result.status === "completed" ? "✓" : "✗";
	const lines = [`${icon} ${result.agent} · ${elapsed(result)} · ${result.status}`];
	lines.push(`  ${preview(renderActivity(result), 120)}`);
	if (result.status === "running" && result.lastActivityAt) {
		lines.push(`  last activity: ${age(result.lastActivityAt)}`);
	}
	if (result.childSessionFile) lines.push(`  transcript: ${result.childSessionFile}`);
	if (result.usageIncomplete) lines.push("  usage incomplete: observed totals only");
	return lines;
}

function resultText(result: SubagentResult & { messages?: any[] }): string {
	if (result.summary !== undefined) return result.summary;
	if (result.status === "cancelled") {
		if (!result.startedAt) return result.errorMessage || "Cancelled before launch";
		return `Cancelled after ${elapsed(result)}. Last activity: ${result.lastActivity ?? "none"}.`;
	}
	if (isFailure(result)) return result.errorMessage || result.stderr || finalOutput(result.messages ?? []) || "Subagent failed.";
	return finalOutput(result.messages ?? []) || "(no output)";
}

function durableTranscript(pi: ExtensionAPI, result: ManagedResult): void {
	pi.appendEntry<TranscriptEntry>("subagent-transcript", {
		id: result.id,
		agent: result.agent,
		status: result.status,
		task: result.task,
		startedAt: result.startedAt,
		endedAt: result.endedAt,
		lastActivity: result.lastActivity,
		childSessionFile: result.childSessionFile,
		summary: capOutput(resultText(result)),
	});
}

const TaskItem = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	task: Type.String({ description: "Task to delegate to the agent" }),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
});

const SubagentParams = Type.Object({
	agent: Type.Optional(Type.String({ description: "Name of the agent to invoke (for single mode)" })),
	task: Type.Optional(Type.String({ description: "Task to delegate (for single mode)" })),
	tasks: Type.Optional(Type.Array(TaskItem, { description: "Parallel {agent, task} requests" })),
	chain: Type.Optional(Type.Array(TaskItem, { description: "Sequential {agent, task}; {previous} is replaced with the prior output" })),
	agentScope: Type.Optional(StringEnum(["user", "project", "both"] as const)),
	confirmProjectAgents: Type.Optional(Type.Boolean()),
	cwd: Type.Optional(Type.String({ description: "Working directory for single mode" })),
});

export default function managedSubagents(pi: ExtensionAPI) {
	const active = new Map<string, ActiveChild>();
	let activeSteeringOverlay: { childId: string; requestRender: () => void } | undefined;
	const refreshSteeringOverlay = (childId: string) => {
		if (activeSteeringOverlay?.childId === childId) activeSteeringOverlay.requestRender();
	};

	pi.registerEntryRenderer<TranscriptEntry>("subagent-transcript", (entry, { expanded }, theme) => {
		const data = entry.data;
		const icon = data.status === "completed" ? theme.fg("success", "✓") : data.status === "cancelled" ? theme.fg("warning", "✗") : theme.fg("error", "✗");
		const box = new Container();
		box.addChild(new Text(`${icon} ${theme.fg("accent", `subagent ${data.agent}`)} ${theme.fg("muted", data.status)}`, 0, 0));
		box.addChild(new Text(theme.fg("dim", preview(data.summary, expanded ? 5000 : 260)), 0, 0));
		if (data.childSessionFile) {
			box.addChild(new Text(theme.fg("dim", `resume: pi --session "${data.childSessionFile}"`), 0, 0));
		}
		if (expanded) {
			box.addChild(new Spacer(1));
			box.addChild(new Text(theme.fg("muted", `task: ${data.task}`), 0, 0));
		}
		return box;
	});

	const chooseActive = async (ctx: ExtensionContext, title: string): Promise<ActiveChild | undefined> => {
		const children = [...active.values()];
		if (children.length === 0) {
			ctx.ui.notify("No active subagents", "info");
			return undefined;
		}
		const choices = children.map((child) => `${child.result.id.slice(0, 8)} · ${child.result.agent} · ${renderActivity(child.result)}`);
		const selected = await ctx.ui.select(title, choices);
		const index = selected ? choices.indexOf(selected) : -1;
		return index >= 0 ? children[index] : undefined;
	};

	const stopOne = async (ctx: ExtensionContext): Promise<void> => {
		const child = await chooseActive(ctx, "Stop which subagent?");
		if (!child) return;
		await child.cancel();
		ctx.ui.notify(`Stopping ${child.result.agent}; partial transcript will be retained`, "warn");
	};

	const steerOne = async (ctx: ExtensionContext): Promise<void> => {
		if (ctx.mode !== "tui") {
			ctx.ui.notify("Subagent steering requires Pi's interactive TUI", "error");
			return;
		}
		const child = await chooseActive(ctx, "Steer which subagent?");
		if (!child) return;
		const message = await ctx.ui.custom<string | undefined>(
			(tui, theme, _keybindings, done) => {
				activeSteeringOverlay = { childId: child.result.id, requestRender: () => tui.requestRender() };
				return new SteeringPanel(tui, theme, child, done);
			},
			{
				overlay: true,
				overlayOptions: { width: "72%", minWidth: 58, maxHeight: "82%", anchor: "center", margin: 1 },
			},
		);
		if (activeSteeringOverlay?.childId === child.result.id) activeSteeringOverlay = undefined;
		if (!message?.trim()) return;
		try {
			await child.steer(message.trim());
			child.result.lastActivity = `steered: ${preview(message.trim(), 90)}`;
			child.result.lastActivityAt = Date.now();
			refreshSteeringOverlay(child.result.id);
			ctx.ui.notify(`Steered ${child.result.agent}`, "info");
		} catch (error: any) {
			ctx.ui.notify(`Could not steer ${child.result.agent}: ${error?.message || "child already stopped"}`, "error");
		}
	};

	pi.registerShortcut("ctrl+shift+x", { description: "Stop one active subagent", handler: stopOne });
	pi.registerShortcut("ctrl+shift+s", { description: "Steer one active subagent", handler: steerOne });

	pi.registerCommand("subagents", {
		description: "Show active managed subagents and their latest activity",
		handler: async (_args, ctx) => {
			const lines = [...active.values()].flatMap((child) => renderLines(child.result));
			if (lines.length === 0) {
				ctx.ui.notify("No active subagents", "info");
				return;
			}
			await ctx.ui.select("Active subagents", [lines.join("\n")]);
		},
	});

	async function runOne(
		ctx: ExtensionContext,
		agents: AgentConfig[],
		agentName: string,
		task: string,
		cwd: string | undefined,
		step: number | undefined,
		signal: AbortSignal | undefined,
		onProgress: (result: ManagedResult) => void,
	): Promise<ManagedResult> {
		const agent = agents.find((candidate) => candidate.name === agentName);
		if (signal?.aborted) {
			// Settled workers still return usage when cancellation leaves tasks queued.
			const result: ManagedResult = {
				id: randomUUID(), agent: agentName, agentSource: agent?.source ?? "unknown", task, step,
				status: "cancelled", exitCode: 130, messages: [], stderr: "", usage: usage(),
				errorMessage: "Cancelled before launch", endedAt: Date.now(),
			};
			onProgress(result);
			return result;
		}
		if (!agent) {
			const result: ManagedResult = {
				id: randomUUID(), agent: agentName, agentSource: "unknown", task, step, status: "failed", exitCode: 1,
				startedAt: Date.now(), messages: [], stderr: "", errorMessage: `Unknown agent: ${agentName}`, usage: usage(), endedAt: Date.now(),
			};
			durableTranscript(pi, result);
			onProgress(result);
			return result;
		}

		const id = randomUUID();
		const result: ManagedResult = {
			id, agent: agent.name, agentSource: agent.source, task, step, status: "running", exitCode: -1,
			startedAt: Date.now(), lastActivityAt: Date.now(), currentActivity: "starting", messages: [], stderr: "", usage: usage(),
			model: agent.model ?? (ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined),
		};
		const parentSessionId = ctx.sessionManager.getSessionId() || "unattached";
		const childSessionRoot = path.join(SUBAGENT_SESSION_ROOT, parentSessionId);
		fs.mkdirSync(childSessionRoot, { recursive: true, mode: 0o700 });
		const args = ["--session-dir", childSessionRoot, "--session-id", id, "--name", childSessionId(result), "--exclude-tools", "subagent"];
		if (agent.systemPrompt.trim()) {
			const promptDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-"));
			const promptPath = path.join(promptDir, "system.md");
			fs.writeFileSync(promptPath, agent.systemPrompt, { encoding: "utf8", mode: 0o600 });
			args.push("--append-system-prompt", promptPath);
		}
		if (agent.tools?.length) args.push("--tools", agent.tools.join(","));
		if (!agent.model && ctx.thinkingLevel) args.push("--thinking", ctx.thinkingLevel);

		const client = new RpcClient({
			cliPath: rpcCliPath(), cwd: cwd ?? ctx.cwd, args,
			provider: agent.model?.includes("/") ? agent.model.split("/", 2)[0] : ctx.model?.provider,
			model: agent.model?.includes("/") ? agent.model.split("/", 2)[1] : agent.model ?? ctx.model?.id,
		});
		let cancelled = false;
		const cancellation = new AbortController();
		const cancel = async () => {
			if (result.status !== "running" || cancelled) return;
			cancelled = true;
			cancellation.abort();
			result.currentActivity = "cancelling";
			onProgress(result);
			refreshSteeringOverlay(result.id);
			try { await client.abort(); } catch { /* child may already have exited */ }
		};
		const steer = async (message: string) => client.steer(message);
		active.set(id, { result, client, cancel, steer });

		const unsubscribe = client.onEvent((event: any) => {
			result.lastActivityAt = Date.now();
			const activity = eventActivity(event);
			if (activity) {
				result.currentActivity = activity;
				result.lastActivity = activity;
			}
			if ((event.type === "message_end" || event.type === "tool_result_end") && event.message) {
				result.messages.push(event.message);
				updateUsage(result, event.message);
			}
			onProgress(result);
			refreshSteeringOverlay(result.id);
		});
		const abortHandler = () => { void cancel(); };
		if (signal) {
			if (signal.aborted) void cancel();
			else signal.addEventListener("abort", abortHandler, { once: true });
		}

		try {
			if (cancelled) throw new Error("Subagent run was aborted");
			await client.start();
			if (cancelled) throw new Error("Subagent run was aborted");
			result.currentActivity = "running task";
			onProgress(result);
			refreshSteeringOverlay(result.id);
			await promptAndWaitForChild(client, task, cancellation.signal);
			const messages = await client.getMessages();
			if (messages.length > result.messages.length) result.messages = messages;
			const terminal = [...result.messages].reverse().find((message) => message.role === "assistant");
			result.stopReason = terminal?.stopReason;
			if (cancelled || terminal?.stopReason === "aborted") {
				result.status = "cancelled";
				result.exitCode = 130;
				result.errorMessage = terminal?.errorMessage || "Subagent cancelled";
			} else if (!terminal || terminal.stopReason === "error") {
				result.status = "failed";
				result.exitCode = 1;
				result.errorMessage = terminal?.errorMessage || "Subagent settled without an assistant response";
			} else {
				result.status = "completed";
				result.exitCode = 0;
			}
		} catch (error: any) {
			result.status = cancelled ? "cancelled" : "failed";
			result.exitCode = cancelled ? 130 : 1;
			result.errorMessage = cancelled ? "Subagent cancelled" : error?.message || "Subagent RPC failed";
			result.stderr = client.getStderr();
		} finally {
			unsubscribe();
			if (signal) signal.removeEventListener("abort", abortHandler);
			result.endedAt = Date.now();
			result.lastActivity = result.lastActivity ?? result.currentActivity;
			result.currentActivity = undefined;
			try { await client.stop(); } catch { /* session is still retained if process already exited */ }
			result.childSessionFile = findSessionFile(childSessionRoot, id);
			finalizeUsage(result);
			active.delete(id);
			durableTranscript(pi, result);
			onProgress(result);
			refreshSteeringOverlay(result.id);
		}
		return result;
	}

	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description: [
			"Delegate isolated work to managed subagents.",
			"Children have persistent transcripts; Ctrl+Shift+S steers one and Ctrl+Shift+X stops one without losing its progress.",
			"Children cannot invoke the subagent tool.",
			"Modes: single (agent + task), parallel (tasks), chain (sequential tasks with {previous}).",
			`User agents are loaded from ${path.join(getAgentDir(), "agents")}.`,
			`Combined output is capped at ${DEFAULT_MAX_BYTES / 1024} KiB or ${DEFAULT_MAX_LINES} lines; full child transcripts are preserved.`,
		].join(" "),
		parameters: SubagentParams,

		async execute(_toolCallId: string, params: any, signal: AbortSignal | undefined, onUpdate: any, ctx: ExtensionContext) {
			if (signal?.aborted) throw new Error("Subagent run was aborted");
			const scope: AgentScope = params.agentScope ?? "user";
			const discovery = discoverAgents(ctx.cwd, scope);
			const agents = discovery.agents;
			const hasSingle = Boolean(params.agent && params.task);
			const hasParallel = Array.isArray(params.tasks) && params.tasks.length > 0;
			const hasChain = Array.isArray(params.chain) && params.chain.length > 0;
			if (Number(hasSingle) + Number(hasParallel) + Number(hasChain) !== 1) {
				return { content: [{ type: "text", text: "Provide exactly one of agent+task, tasks, or chain." }] };
			}
			if ((scope === "project" || scope === "both") && (params.confirmProjectAgents ?? true) && ctx.hasUI && !ctx.isProjectTrusted()) {
				const requested = new Set<string>([
					...(params.agent ? [params.agent] : []),
					...(params.tasks ?? []).map((item: any) => item.agent),
					...(params.chain ?? []).map((item: any) => item.agent),
				]);
				const projectNames = [...requested].filter((name) => agents.find((agent) => agent.name === name)?.source === "project");
				if (projectNames.length && !(await ctx.ui.confirm("Run project-local agents?", projectNames.join(", ")))) {
					return { content: [{ type: "text", text: "Cancelled: project-local agents not approved." }] };
				}
			}

			const details = (mode: SubagentDetails["mode"], results: ManagedResult[]): SubagentDetails => ({
				mode, agentScope: scope, projectAgentsDir: discovery.projectAgentsDir, results: results.map(storedResult),
			});
			const combinedUsage = (results: ManagedResult[]): Usage => {
				const { turns: _turns, ...total } = usage();
				for (const result of results) addUsage(total, result.usage);
				return total;
			};
			const emit = (mode: SubagentDetails["mode"], results: ManagedResult[]) => {
				onUpdate?.({
					content: [{ type: "text", text: capOutput(results.map((result) => renderLines(result).join("\n")).join("\n\n") || "Starting subagent...") }],
					details: details(mode, [...results]),
				});
			};

			if (hasSingle) {
				const holder: ManagedResult[] = [];
				const result = await runOne(ctx, agents, params.agent, params.task, params.cwd, undefined, signal, (current) => {
					holder[0] = current;
					emit("single", holder);
				});
				holder[0] = result;
				emit("single", holder);
				return {
					content: [{ type: "text", text: formatOutput("single", [result]) }],
					details: details("single", [result]), usage: combinedUsage([result]), isError: isFailure(result),
				};
			}

			if (hasParallel) {
				if (params.tasks.length > MAX_PARALLEL_TASKS) {
					return { content: [{ type: "text", text: `Too many parallel tasks; maximum is ${MAX_PARALLEL_TASKS}.` }] };
				}
				const results: ManagedResult[] = params.tasks.map((item: any) => ({
					id: randomUUID(), agent: item.agent, agentSource: "unknown", task: item.task, status: "queued", exitCode: -1,
					messages: [], stderr: "", usage: usage(),
				}));
				let next = 0;
				const worker = async () => {
					while (next < params.tasks.length) {
						const index = next++;
						const item = params.tasks[index];
						results[index] = await runOne(ctx, agents, item.agent, item.task, item.cwd, undefined, signal, (current) => {
							results[index] = current;
							emit("parallel", results);
						});
					}
				};
				await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, params.tasks.length) }, worker));
				const completed = results.filter((result) => !isFailure(result)).length;
				return {
					content: [{ type: "text", text: formatOutput("parallel", results) }],
					details: details("parallel", results), usage: combinedUsage(results), isError: completed !== results.length,
				};
			}

			const results: ManagedResult[] = [];
			let previous = "";
			for (let index = 0; index < params.chain.length; index++) {
				const item = params.chain[index];
				const task = item.task.replace(/\{previous\}/g, previous);
				let current: ManagedResult | undefined;
				const result = await runOne(ctx, agents, item.agent, task, item.cwd, index + 1, signal, (next) => {
					current = next;
					emit("chain", [...results, current!]);
				});
				results.push(result);
				if (isFailure(result)) {
					return { content: [{ type: "text", text: formatOutput("chain", results) }], details: details("chain", results), usage: combinedUsage(results), isError: true };
				}
				previous = finalOutput(result.messages);
			}
			return { content: [{ type: "text", text: formatOutput("chain", results) }], details: details("chain", results), usage: combinedUsage(results) };
		},

		renderCall(args: any, theme: any) {
			const items = args.tasks ?? args.chain ?? (args.agent ? [{ agent: args.agent, task: args.task }] : []);
			const mode = args.tasks ? "parallel" : args.chain ? "chain" : "single";
			const lines = [`${theme.fg("toolTitle", theme.bold("subagent "))}${theme.fg("accent", `${mode} (${items.length})`)}`];
			for (const item of items.slice(0, 3)) lines.push(`  ${theme.fg("accent", item.agent)}${theme.fg("dim", ` ${preview(item.task ?? "", 70)}`)}`);
			return new Text(lines.join("\n"), 0, 0);
		},

		renderResult(result: any, { expanded }: any, theme: any) {
			const data = result.details as SubagentDetails | undefined;
			if (!data?.results?.length) return new Text(result.content?.[0]?.text ?? "(no subagent result)", 0, 0);
			const container = new Container();
			const running = data.results.filter((item) => item.status === "running" || item.status === "queued").length;
			const done = data.results.length - running;
			container.addChild(new Text(theme.fg("toolTitle", `${running ? "⏳" : "✓"} ${data.mode}: ${done}/${data.results.length} settled`), 0, 0));
			for (const item of data.results) {
				container.addChild(new Spacer(1));
				for (const line of renderLines(item)) container.addChild(new Text(theme.fg(item.status === "failed" ? "error" : item.status === "completed" ? "success" : "muted", line), 0, 0));
				if (expanded) {
					const output = resultText(item);
					if (output) {
						container.addChild(new Spacer(1));
						container.addChild(new Markdown(capOutput(output), 0, 0, getMarkdownTheme()));
					}
				}
			}
			if (running) container.addChild(new Text(theme.fg("dim", "Ctrl+Shift+S to steer one · Ctrl+Shift+X to stop one"), 0, 0));
			else if (!expanded) container.addChild(new Text(theme.fg("dim", "Ctrl+O to expand"), 0, 0));
			return container;
		},
	});
}
