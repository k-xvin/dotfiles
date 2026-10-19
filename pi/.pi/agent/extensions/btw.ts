/**
 * /btw — ask a side question without polluting the main session.
 *
 * Forks the current session into a fresh session, asks the question there
 * non-interactively, and renders the answer in the main transcript as a durable
 * custom entry — which is NOT sent to the LLM. The main conversation's context
 * is completely untouched.
 *
 * Usage:
 *   /btw <question>
 *
 * The rendered entry shows the answer plus a paste-ready command to continue
 * the side thread in any window/pane (works from any directory):
 *   pi --session <absolute path to forked session file>
 *
 * Optional: set BTW_MODEL=provider/model-id to answer side questions with a
 * cheaper model instead of the session's current one.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const CHILD_TIMEOUT_MS = 10 * 60 * 1000;

interface RunResult {
	stdout: string;
	stderr: string;
	code: number | null;
	timedOut: boolean;
}

/**
 * Run `pi` and capture stdout.
 *
 * Must be spawn(), not execFile(): execFile ignores the `stdio` option and always
 * gives the child an open stdin pipe. `pi -p` reads piped stdin until EOF, so the
 * child would block forever waiting for input that never comes.
 */
function runPi(argv: string[], cwd: string, env: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<RunResult> {
	return new Promise((resolve, reject) => {
		const child = spawn("pi", argv, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		let timedOut = false;

		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGTERM");
		}, CHILD_TIMEOUT_MS);

		const onAbort = () => child.kill("SIGTERM");
		signal?.addEventListener("abort", onAbort, { once: true });

		child.stdout.on("data", (d) => {
			stdout += d;
		});
		child.stderr.on("data", (d) => {
			stderr += d;
		});
		child.on("error", (err) => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			reject(err);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			resolve({ stdout, stderr, code, timedOut });
		});
	});
}

interface BtwEntryData {
	question: string;
	answer: string;
	sessionFile: string;
	error?: string;
}

/** Short topic label for --name, derived from the question. */
function topicOf(question: string): string {
	const words = question.split(/\s+/).slice(0, 5).join(" ");
	return words.length > 40 ? words.slice(0, 37) + "..." : words;
}

/** Locate the forked session file by its minted ID, anywhere under the session store. */
async function findSessionFile(sessionDir: string | undefined, id: string): Promise<string | undefined> {
	if (sessionDir) {
		const dir = await readdir(sessionDir).catch(() => [] as string[]);
		const hit = dir.find((f) => f.endsWith(`_${id}.jsonl`));
		if (hit) return join(sessionDir, hit);
	}
	// Fallback: search the whole session store (ephemeral parent, odd layouts).
	const root = process.env.PI_CODING_AGENT_SESSION_DIR || join(homedir(), ".pi", "agent", "sessions");
	const stack = [root];
	while (stack.length > 0) {
		const dir = stack.pop()!;
		let entries: string[] = [];
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const e of entries) {
			const full = join(dir, e.name);
			if (e.isDirectory()) stack.push(full);
			else if (e.name.endsWith(`_${id}.jsonl`)) return full;
		}
	}
	return undefined;
}

export default function (pi: ExtensionAPI) {
	pi.registerEntryRenderer<BtwEntryData>("btw", (entry, { expanded }, theme) => {
		const data = entry.data ?? { question: "?", answer: "", sessionFile: "" };
		const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
		box.addChild(new Text(`${theme.fg("accent", "[btw]")} ${data.question}`, 0, 0));

		if (data.error) {
			box.addChild(new Text(theme.fg("error", `error: ${data.error}`), 0, 0));
		} else {
			box.addChild(new Text(data.answer, 0, 0));
		}

		if (data.sessionFile) {
			const cmd = `pi --session "${data.sessionFile}"`;
			box.addChild(
				new Text(
					theme.fg("dim", `continue this thread in any pane:  ${cmd}`),
					0,
					0,
				),
			);
			if (expanded) {
				box.addChild(new Text(theme.fg("dim", `cwd: ${process.cwd()}`), 0, 0));
			}
		}
		return box;
	});

	pi.registerCommand("btw", {
		description: "Ask a side question in a forked session (zero main-context pollution)",
		handler: async (args, ctx) => {
			const question = args.trim();
			if (!question) {
				if (ctx.hasUI) ctx.ui.notify("Usage: /btw <question>", "warn");
				return;
			}

			if (ctx.hasUI) ctx.ui.notify(`btw: asking "${topicOf(question)}" in a forked session...`, "info");

			const id = randomUUID();
			const parentFile = ctx.sessionManager.getSessionFile();

			const argv: string[] = [];
			if (parentFile) {
				argv.push("--fork", parentFile, "--session-dir", dirname(parentFile));
			}
			argv.push("--session-id", id);
			// BTW_MODEL env override wins; else inherit the session's model.
			const model = process.env.BTW_MODEL || (ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "");
			if (model) argv.push("--model", model);
			if (ctx.thinkingLevel) argv.push("--thinking", ctx.thinkingLevel);
			argv.push("--name", `btw: ${topicOf(question)}`);
			// Keep side answers lean: they render as a digest in the main transcript.
			const prompt = `${question}\n\n(Answer concisely: under ~150 words.)`;
			argv.push("-p", "--", prompt);

			// Nested pi must see its own session, not this session's metadata.
			const env = { ...process.env };
			delete env.PI_SESSION_ID;
			delete env.PI_SESSION_FILE;

			let answer = "";
			let error: string | undefined;
			try {
				const res = await runPi(argv, ctx.cwd, env, ctx.signal);
				answer = res.stdout.trim();
				if (res.timedOut) {
					error = "timed out";
				} else if (res.code !== 0) {
					error = res.stderr.trim() || `pi exited with code ${res.code}`;
				} else if (!answer) {
					error = res.stderr.trim() || "no answer returned";
				}
			} catch (err: unknown) {
				error = (err as Error)?.message || "failed to spawn pi";
			}

			const sessionFile = await findSessionFile(parentFile ? dirname(parentFile) : undefined, id);

			// Durable, TUI-only: never enters LLM context.
			pi.appendEntry<BtwEntryData>("btw", {
				question,
				answer,
				sessionFile: sessionFile ?? "",
				error,
			});

			if (ctx.hasUI) {
				ctx.ui.notify(error ? `btw: failed — ${error}` : "btw: done (answer rendered above; no LLM context used)", error ? "error" : "info");
			}
		},
	});
}
