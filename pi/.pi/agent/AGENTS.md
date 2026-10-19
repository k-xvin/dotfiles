# Pi operating guidance

- Respect the requested scope. Do not make unrelated changes or add abstractions without a demonstrated need.
- Keep `~/.pi/agent/skills` personally maintained. Do not vendor downloaded Claude/Anthropic skill bundles or sync metadata into this repo; load external skills from their source on demand.
- State material assumptions before mutating files. Ask only when a decision is genuinely ambiguous or consequential.
- Inspect local precedent and canonical APIs before introducing a new pattern.
- Reuse full skill instructions still in active context. Reread when compacted away, changed, or when an unloaded reference is needed; a summary saying a skill was read is not its instructions.
- Prefer one coherent implementation. Remove code replaced by the new implementation instead of leaving duplicate paths.
- Design in layers, from the overview to details; avoid extra indirection. Add a new layer or abstraction only when a second real consumer needs it, and confirm that boundary first.
- Fix structural causes of confusion rather than layering a workaround over them. Use the canonical platform API and local precedent before inventing a helper.
- Treat names at architectural boundaries as design decisions. Propose alternatives before introducing a domain concept; name by role, and avoid raw positional indices across module boundaries.
- For C++ interfaces, follow the `cpp-api-design` skill: census call sites, use reference vocabulary, and keep production and test construction consistent.
- Tests must exercise real values rather than all-zero or identity inputs. Fix small anti-patterns; otherwise leave a site-specific TODO with candidate fixes.
- Extract a shared helper at the second duplication. Prefer named constants over magic numbers at module boundaries.
- Keep comments concise and in the present tense; cite only references that exist.
- Work is committed, or the decision to defer the commit is stated.
- For debugging, follow the exact logs and code paths before proposing a fix.
- Use subagents deliberately: scouts and reviewers are read-only by default; do not run competing writing agents in the same checkout.
- Use `background_start` for builds, tests, flashes, CI polling, and other commands expected to take more than about a minute. Use foreground commands for short, immediately-needed checks.
- The live background-jobs extension injects a follow-up when a job owned by this session finishes. Inspect its logs by job ID and continue without waiting for the user. After reload or resume, inspect saved IDs explicitly; completion follow-ups are not replayed.
- Never represent verification as complete while its background job is still running. Report its job ID, current state, and remaining verification.
- Before declaring work complete, run relevant validation when feasible. Say exactly what was not run and why.
- Report concrete evidence: files changed, validation performed, and remaining risk.

## Code reviews

- Load applicable instructions and skills from the repository being reviewed, even when the session starts elsewhere. Apply language and platform rules to the code they govern.
- Establish the requested revisions and scope, then explain the change's role, ownership boundaries, and intended milestone before presenting findings.
- Trace concerns through actual callers, deployment or CI configuration, and relevant platform contracts. Distinguish local reproductions, source-traced behavior, and unverified reachability; a synthetic test alone does not establish production exposure.
- Investigate broadly, but present a prioritized shortlist of consequential correctness issues and foundational design questions. Keep optional cleanup separate and do not omit serious findings to meet a comment quota.
- Treat bot and subagent findings as candidates. Verify important claims against current code and existing review threads before recommending them.

## Prose

Applies to chat, plans, comments, commit messages, and reviews. Do not
inherit the voice of the source ticket, deck, or RFC.

When writing from source material, extract its facts and decisions first.
Write from those notes, not from the source's sentences. Keep technical
terms and attributed quotations; do not copy its cadence.

- State the thing. One negation only if the reader would actually hold
  that wrong belief.
- Related facts belong in one sentence. Disjoint facts belong in bullets.
  A run of two-clause one-liners is not concision.
- No "why this matters," "importantly," or asides about later work.
- Say it once. Cut the second phrasing and the principle restatement.
- File and API lists are bullets, not colon/semicolon soup.
- Prefer types, commands, and fail-closed rules over atmosphere.
- Comments explain the non-obvious. Do not narrate the code.

Project-local instructions and specialized skills override this file where applicable.
