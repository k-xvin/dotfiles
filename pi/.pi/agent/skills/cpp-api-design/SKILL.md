---
name: cpp-api-design
description: Method for designing or unifying a C++ class/module/interface — auditing an existing surface and refactoring it into one coherent object, or shaping a new one correctly the first time. Use when a module has grown duplicate entry points, near-duplicate overloads, leaked internals, two-phase init, or "parser here / fetcher there" splits; when asked to review an API, interface, abstraction, or class boundary; or before adding a public method to an existing type. Complements line-level code review (cpp-code-review) by working at the abstraction boundary instead.
---

# C++ API and abstraction design

Design from consumers and local precedent. Apply the requested scope: a read-only review
proposes an interface and its evidence; implementation follows an approved plan. Neither
mode independently authorizes builds, deployment, or remote changes.

## 1. Census the consumer surface

Find every call site before designing from the header. For each public member, identify
production consumers, test consumers, and what they need from its result.

| Evidence | Action |
|---|---|
| Production caller | Keep the behavior it needs; check whether the existing surface serves it directly |
| Callers all post-process results identically | Move that work to the owner and return the result they use |
| Test-only caller | Check for a missing test seam; prefer observation through controlled inputs or a fake interface over exposing representation |
| No caller | Remove rather than preserve a speculative API |

Count callers of new helpers and convenience predicates too. Preserve test coverage when
removing accessors; a test-only member is not automatically a useful public API.

## 2. Find the canonical analogue

Inspect the owning platform, reference implementation, and modern sibling modules:

- **Object model:** what belongs together and what has separate ownership?
- **File placement:** which independent responsibilities live in different modules?
- **Vocabulary:** what does the domain already call this concept?
- **Consumer posture:** typed queries, values, callbacks, or exposed representation?

State the object's job in one sentence before sketching its surface. Each member must
fit that responsibility. Recheck reference and local evidence when a proposed design is
challenged rather than defending an unsupported preference.

## 3. Establish local convention

Check this module first, then modern in-tree peers, then platform/language norms. Count
existing spellings rather than treat one example as a rule.

Settle namespaces, method names, construction, errors, and function placement. Follow
local precedent for I/O on an owning type versus free transforms; do not impose one
module's arrangement on every repository.

## 4. Identify real variation

For duplicate entry points or near-copies, name what varies and keep invariant behavior
in one place:

- Input sources may share one parser or consumer.
- Output views may share one producer.
- Chip or version implementations may share an interface when a real second
  implementation or test seam needs it.

Name sources by role rather than add indistinguishable overloads. Group version-specific
code without speculative polymorphism when there is no current consumer for an interface.

## 5. Draft the surface

- **Valid construction:** prefer a canonical factory or hermetic constructor to a
  construct-then-init protocol. Every successful entry point yields a usable object.
- **Consistent tests:** production and tests use the same construction path. Separate
  I/O from parsing when that keeps construction hermetic.
- **Canonical values:** validate, narrow, and normalize on ingest, not at every read.
  Stored types match the consumers' needs.
- **Private representation:** expose typed queries or values instead of a tree that
  callers must interpret or index using raw positions.
- **Useful results:** return what callers actually use; do not add zero-consumer helpers.
- **Error boundaries:** use the repository's result/error vocabulary, preserving useful
  internal detail and mapping/logging once at the boundary.
- **Provenance:** separate a callee's reported facts from the caller's own parsed input.
  Do not fuse fields that force redundant derivation.
- **Lifetime:** return transient results rather than store `last_*` members used only
  by the next call. Members represent state that outlives the operation.
- **Names:** avoid using the same name for different meanings in adjacent layers.

## 6. Resolve consequential decisions

For a new design, present the proposed surface, call-site/reference evidence, focused
behavior fixes, exclusions, and verification. Offer naming alternatives when introducing
an unresolved domain concept. Ask for decisions that are consequential or ambiguous.

For an already-approved plan, proceed without reopening routine choices. Stop for a new
consequential API or domain-naming decision, or evidence that changes the approved scope.
A review remains read-only until implementation is authorized.

## 7. Verify the affected behavior

Use the owning repository's build, test, and deployment instructions. Do not substitute
a different project's commands or deploy just because an API changed.

- Exercise real captured or representative inputs, not only zero/identity values.
- For behavior-preserving refactors, compare a relevant pre/post observable, such as
  parsed values, output, or a trace, and explain deltas.
- Hardware-init changes require the domain's real pre/post hardware observable; green
  unit tests alone do not establish hardware behavior preservation.
- Run the relevant tests when authorized, and sweep callers/build files for old names.
- State what was inspected, tested, and left unverified. Read-only reviews recommend
  verification without claiming to have run it.

Keep unrelated cleanup out of the refactor. Extract shared helpers at demonstrated
repetition, and add interfaces only for real variation or a needed test seam.
