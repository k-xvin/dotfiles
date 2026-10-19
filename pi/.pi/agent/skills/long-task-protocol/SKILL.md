---
name: long-task-protocol
description: Run long-lived engineering work in Pi without blocking the session. Use whenever a request involves a build, test suite, flash/deploy, CI polling, benchmark, log capture, or any command likely to take more than about one minute or wait indefinitely.
---

# Long-task protocol

Use the foreground shell only for short commands whose result is needed immediately. For builds, tests, flashing, CI polling, benchmarks, and unbounded watchers, use `background_start`.

## Before starting

1. State the command's purpose and what completion will verify.
2. Choose a specific working directory; keep the command free of display-label comments.
3. Ensure the command has bounded behavior where practical. Do not put an unbounded polling loop in foreground Bash.

## While running

- Record the returned job ID in the progress report.
- Pass the returned `id` to `background_status`, `background_logs`, and `background_cancel`.
- Completion arrives automatically while this runtime is live. Continue independent work or yield; do not repeatedly poll to wait for completion.
- Inspect a running job for a user-requested status, evidence of a stall, or a time-sensitive diagnostic. A resumed job also needs explicit inspection.
- `background_logs` includes state and exit status; skip a preceding status call when logs are needed next.
- Without an `id`, `background_status` lists this session's running jobs and ten recent completions.
- When a completion follow-up arrives, inspect that job and continue. Do not wait for the user to mention it. Reading completed logs acknowledges a pending completion.
- Jobs survive Pi shutdown, but automatic follow-ups require the live runtime. After reload or resume, inspect saved IDs explicitly; notices are not replayed.
- Use `background_cancel` only when the user asks to stop or evidence shows the job cannot recover.

## Completion

A running job is not verification. Report one of:

- **passed** — state exactly what it verified;
- **failed** — include the useful error/log tail and next diagnosis;
- **cancelled** — state why and preserve the job ID/logs;
- **still running** — state the job ID and the remaining unverified work.

Never claim the overall task complete while required validation is still running.
