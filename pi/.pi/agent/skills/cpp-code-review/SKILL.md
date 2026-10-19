---
name: cpp-code-review
description: Review C++ changes for undefined behavior, ownership and lifetime errors, concurrency mistakes, error handling, and local conventions. Use when asked to review C++ code or a C++ diff. Use cpp-api-design as well when the review concerns a public API or abstraction boundary.
---

# C++ code review

Review the requested revision and scope. A review is read-only unless the user
also asks for edits; it does not authorize builds, deployment, or remote changes.

## Establish context

1. Identify the diff, comparison base, and intended behavior. Ask for the code
   when no source reference or revision is available.
2. Load the repository's instructions and applicable C++ documentation. Check
   its language standard, library restrictions, naming, logging, and concurrency
   contracts rather than assuming another platform's conventions.
3. Read complete affected files and relevant callers, tests, and build wiring.
   Use `cpp-api-design` for interface and ownership-boundary questions.
4. Read existing review threads and relevant later changes before recommending
   feedback that may already be addressed.

## Correctness priorities

Check undefined behavior first:

- Signed overflow, invalid shifts, narrowing, and size calculations.
- Null dereferences, out-of-bounds access, and invalid pointer arithmetic.
- Uninitialized values and reads after move where a stronger state is required.
- Dangling references, views, iterators, and callback captures; use-after-free
  and double destruction.
- Data races, synchronization gaps, and unsafe publication of shared objects.

Trace ownership from creation through teardown. Consider asynchronous work,
callbacks, cancellation, early returns, and shutdown. A smart pointer alone
is not evidence that a captured object or borrowed view remains alive.

For concurrent code:

- Identify the state protected by each lock and the actual happens-before edge.
- Verify acquire/release pairings and the publication they establish. Require
  evidence for relaxed ordering; sequential consistency does not repair an
  incorrect lifetime or synchronization protocol.
- Check lock ordering, reentrancy, waits under locks, and teardown races.
- Read executor and callback contracts before assuming thread affinity.

Then check logical invariants, error propagation, partial initialization,
resource cleanup, invalid external inputs, and boundary conditions. Trace a
suspected defect through real callers and deployment configuration before
claiming production exposure.

## Conventions and explanations

Follow the surrounding code and canonical platform APIs. Separate a concrete
correctness issue from a style preference or optional modernization. Propose
abstractions only when callers or repeated behavior demonstrate the need.

Explain a lifetime or concurrency bug with the sequence of operations that
triggers it. Cite the applicable contract or a precise language reference when
useful, such as [cppreference](https://en.cppreference.com/w/cpp).

## Report

Use the user's requested output format; otherwise report in Markdown with file
and line references. Present consequential findings before optional cleanup.
For each finding, include:

- The triggering conditions, mechanism, and observable consequence.
- Evidence from the current source and callers; distinguish a local reproduction
  from source-traced behavior and unverified reachability.
- A focused fix or design question and a regression test to consider.

State what was inspected and what remains unverified. Recommend validation
without claiming to have run it. If the inspected scope has no actionable
findings, say so.
