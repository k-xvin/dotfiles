import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const DEFAULT_TURN_BUDGET = 200;
const TURN_TIMEOUT_MS = 10 * 60 * 1000;
const TIMEOUT_MESSAGE = `Turn exceeded ${TURN_TIMEOUT_MS / 60_000} minutes; abort requested. Tools that ignore cancellation must be stopped manually.`;
const STATE_TYPE = "turn-budget";

interface Budget {
	used: number;
	limit: number;
}

export default function turnBudget(pi: ExtensionAPI): void {
	let budget: Budget = { used: 0, limit: DEFAULT_TURN_BUDGET };
	let ready = false;
	let currentTurnAllowed = false;
	let notified = false;
	let timedOut = false;
	let watchdog: ReturnType<typeof setTimeout> | undefined;
	let remainingMs = TURN_TIMEOUT_MS;
	let deadline = 0;
	const delegations = new Set<string>();

	const clearWatchdog = () => {
		if (watchdog !== undefined) clearTimeout(watchdog);
		watchdog = undefined;
	};
	const finishTurn = () => {
		clearWatchdog();
		delegations.clear();
		currentTurnAllowed = false;
	};
	const armWatchdog = (ctx: ExtensionContext) => {
		deadline = Date.now() + remainingMs;
		watchdog = setTimeout(() => {
			watchdog = undefined;
			timedOut = true;
			currentTurnAllowed = false;
			ctx.abort();
			ctx.ui.notify(TIMEOUT_MESSAGE, "error");
		}, remainingMs);
		watchdog.unref?.();
	};

	const status = () => `Turns: ${budget.used}/${budget.limit}${budget.used >= budget.limit ? " — budget exhausted" : ""}`;
	const refresh = (ctx: ExtensionContext) => ctx.ui.setStatus(STATE_TYPE, ready ? status() : "Turns: unavailable");
	const blockedMessage = () => ready
		? `${status()}. Run /turn-budget +${DEFAULT_TURN_BUDGET} in the TUI to increase the allowance.`
		: "Turn-budget state is unavailable. Fix the session state and reload before continuing.";
	const notifyBlocked = (ctx: ExtensionContext) => {
		if (notified) return;
		notified = true;
		ctx.ui.notify(blockedMessage(), "warning");
	};
	const fail = (ctx: ExtensionContext, error: unknown) => {
		ready = false;
		finishTurn();
		ctx.abort();
		refresh(ctx);
		ctx.ui.notify(`Turn-budget failure: ${error instanceof Error ? error.message : String(error)}`, "error");
	};
	const save = (next: Budget) => {
		pi.appendEntry(STATE_TYPE, next);
		budget = next;
	};

	pi.on("session_start", (_event, ctx) => {
		ready = false;
		finishTurn();
		timedOut = false;
		notified = false;
		try {
			const entries = ctx.sessionManager.getEntries();
			const saved = entries.filter((entry) => entry.type === "custom" && entry.customType === STATE_TYPE).at(-1);
			if (saved?.type === "custom") {
				const data = saved.data as Budget | undefined;
				if (!data || !Number.isSafeInteger(data.used) || data.used < 0 || !Number.isSafeInteger(data.limit) || data.limit <= 0) {
					throw new Error("Invalid saved turn budget");
				}
				budget = { used: data.used, limit: data.limit };
			} else {
				const used = entries.filter((entry) => entry.type === "message" && entry.message.role === "assistant").length;
				save({ used, limit: DEFAULT_TURN_BUDGET });
			}
			ready = true;
			refresh(ctx);
		} catch (error) {
			fail(ctx, error);
		}
	});

	pi.on("input", (_event, ctx) => {
		if (ready && budget.used < budget.limit) return { action: "continue" as const };
		notifyBlocked(ctx);
		return { action: "handled" as const };
	});

	pi.on("turn_start", (_event, ctx) => {
		finishTurn();
		timedOut = false;
		remainingMs = TURN_TIMEOUT_MS;
		if (!ready || budget.used >= budget.limit) {
			ctx.abort();
			notifyBlocked(ctx);
			return;
		}
		try {
			save({ used: budget.used + 1, limit: budget.limit });
			currentTurnAllowed = true;
			armWatchdog(ctx);
			refresh(ctx);
		} catch (error) {
			fail(ctx, error);
		}
	});

	pi.on("tool_execution_start", (event) => {
		if (event.toolName !== "subagent" || !currentTurnAllowed) return;
		if (delegations.size === 0) {
			remainingMs = Math.max(0, deadline - Date.now());
			if (remainingMs === 0) return;
			clearWatchdog();
		}
		delegations.add(event.toolCallId);
	});

	pi.on("tool_execution_end", (event, ctx) => {
		if (delegations.delete(event.toolCallId) && delegations.size === 0 && currentTurnAllowed) armWatchdog(ctx);
	});

	pi.on("turn_end", finishTurn);
	// Provider failures can end an agent run without emitting turn_end.
	pi.on("agent_end", finishTurn);

	pi.on("tool_call", () => {
		if (!currentTurnAllowed) return { block: true, reason: timedOut ? TIMEOUT_MESSAGE : blockedMessage(), terminate: true };
	});

	pi.on("session_shutdown", (_event, ctx) => {
		ready = false;
		finishTurn();
		ctx.ui.setStatus(STATE_TYPE, undefined);
	});

	pi.registerCommand("turn-budget", {
		description: "Show the turn budget, or request an increase with +N",
		handler: async (args, ctx) => {
			if (!ready) { notifyBlocked(ctx); return; }
			const request = args.trim();
			if (!request) { ctx.ui.notify(status(), "info"); return; }
			const increment = /^\+[1-9]\d*$/.test(request) ? Number(request.slice(1)) : NaN;
			const previousLimit = budget.limit;
			const nextLimit = previousLimit + increment;
			if (!Number.isSafeInteger(increment) || !Number.isSafeInteger(nextLimit)) {
				ctx.ui.notify("Usage: /turn-budget +N, where N is a positive safe integer", "error");
				return;
			}
			if (ctx.mode !== "tui") {
				ctx.ui.notify("Budget increases require human confirmation in the TUI. Resume this session interactively.", "error");
				return;
			}
			if (!ctx.isIdle()) {
				ctx.ui.notify("Stop the current run before increasing its turn budget.", "warning");
				return;
			}
			if (!await ctx.ui.confirm("Increase turn budget?", `${budget.used} turns used. Raise the allowance from ${previousLimit} to ${nextLimit}?`)) return;
			if (!ready || !ctx.isIdle() || budget.limit !== previousLimit) {
				ctx.ui.notify("The run or allowance changed during confirmation. Retry the command.", "warning");
				return;
			}
			try {
				save({ used: budget.used, limit: nextLimit });
				notified = false;
				refresh(ctx);
				ctx.ui.notify(status(), "info");
			} catch (error) {
				fail(ctx, error);
			}
		},
	});
}
