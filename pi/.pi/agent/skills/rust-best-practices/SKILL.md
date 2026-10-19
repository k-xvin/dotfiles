---
name: rust-best-practices
description: Write, refactor, or review Rust code using idiomatic naming, ownership, traits, API design, structured concurrency, error handling, unsafe-code contracts, and representative tests. Use for Rust implementation work and code review; follow the current repository's runtime, build system, and platform rules.
---

# Rust best practices

Apply these guidelines within the requested scope and the repository's conventions.
Read its instructions, edition, dependency policy, runtime, and nearby code before
changing a pattern. A read-only review does not authorize edits or test execution.

## Naming and organization

- Use `UpperCamelCase` for types, `snake_case` for functions and variables, and
  `SCREAMING_SNAKE_CASE` for constants. Getter methods usually omit `get_`.
- Follow conversion vocabulary: `as_` for cheap borrowed views, `to_` for
  conversions that may do work while borrowing the input, and `into_` when
  consuming it. Keep iterator methods consistent with `iter`, `iter_mut`,
  and `into_iter`.
- Group imports at the appropriate module boundary and follow local ordering.
  Import names that improve readability without hiding which API owns an operation.
- Use descriptive names and named constants for shared limits and configuration.
- Remove stale lint suppressions and comments addressed to an agent. For an
  intentionally retained field, use an underscore name when it expresses the
  purpose better than an `allow` attribute.
- Put constructors and operations with a clear receiver on the type. Keep free
  functions for operations without a natural owner; module privacy applies to both.

## Ownership and API design

- State what each type owns, its invariants, and the lifetime of borrowed values.
  Keep implementation details private while exposing operations callers need.
- Construct valid values. Validate and normalize input at the boundary rather
  than repeating validation at every use.
- Return results directly instead of using mutable out-parameters. Use named
  structs when a tuple would obscure the meaning of its fields.
- Use newtypes and enums to distinguish domain values and meaningful states.
  Prefer them over interchangeable integers, Boolean flags, and nested options
  when callers need to distinguish the cases.
- Use builders for demonstrated construction complexity, not for every struct.
- Give callers control over ownership and allocation. Avoid hidden clones; use
  borrowed values, owned values, or `Cow` according to the actual lifetime needs.
- Use generics where callers need variation. Do not add bounds, trait objects,
  or abstractions without a consumer. Put bounds on the implementation that
  needs them rather than repeating unnecessary bounds on a struct.
- Use `Deref` for pointer-like behavior, not inheritance or general code reuse.
  Avoid inherent smart-pointer methods that shadow methods on the pointee.
- Make operator overloads predictable. Seal traits only when restricting external
  implementations is part of the API contract.

## Traits and interoperability

Implement standard traits when their semantics fit:

- `Debug` for useful diagnostics, omitting or redacting secrets.
- `Clone`, `Copy`, equality, ordering, hashing, `Display`, and `Default` when
  their contracts are meaningful. Deriving `Copy` is an API decision.
- `From` or `TryFrom` for value conversions, and `AsRef` or `AsMut` for borrowed
  access. Prefer these to redundant custom conversion methods.
- `FromIterator`, `Extend`, and the appropriate `IntoIterator` implementations
  for collection types.
- Serialization traits when the type crosses a serialization boundary and the
  repository permits the dependency.

Preserve `Send` and `Sync` where required by consumers, but do not force them onto
thread-affine types. For generic I/O, accepting `R: Read` or `W: Write` by value
lets a caller pass either an owned object or a mutable reference.

## Errors, validation, and arithmetic

- Use `Result` and meaningful error types for recoverable failures. Add context
  at ownership boundaries and preserve the underlying cause. Follow local policy
  for application-level error wrappers versus library error types.
- Avoid `unwrap` and `expect` on fallible runtime input. Where a panic represents
  a proven invariant or an unrecoverable condition, document that reason and use
  a useful message. Tests may use assertions and `expect` for fixture invariants.
- Validate lengths, indices, conversions, and external input before changing state.
  Use checked arithmetic for untrusted size and offset calculations; choose
  saturating or wrapping arithmetic only when the domain requires it.
- Keep `Drop` implementations non-panicking. Make blocking cleanup explicit and
  provide a non-blocking or async alternative where the runtime requires it.

## Concurrency and async work

- Use the repository's executor and task ownership model. Keep spawned work under
  a scope or retain its handle so completion, failure, and cancellation are visible.
- Use thread-local spawning only when the future is not `Send` and the executor
  supports it. Do not detach work without an explicit lifecycle owner.
- Choose locks for the runtime and protected state. Avoid holding a blocking lock
  across `.await`; check lock ordering, cancellation safety, and shutdown behavior.
- Trace the lifetime of references and resources captured by tasks. A cancelled
  parent must not silently abandon required cleanup or leave work unobserved.

## Unsafe code

Prefer a safe implementation. When unsafe code is necessary:

- Document unsafe function and trait preconditions in a `# Safety` section.
- Precede unsafe blocks and unsafe impls with `// SAFETY:` and a concrete
  soundness argument. State the established bounds, alignment, initialization,
  aliasing, lifetime, and synchronization guarantees that the operation needs.
- Keep unsafe operations inside explicit unsafe blocks, including within unsafe
  functions. Minimize the unsafe region so its assumptions can be audited.
- A performance claim does not prove soundness. Explain why the safe alternative
  is insufficient separately from why the unsafe operation is valid.

For example, a byte-buffer view must establish its representation and lifetime
requirements, not merely assert that the input is trusted.

## Documentation and macros

- Document the crate's purpose and public APIs with representative examples.
  Explain errors, panics, and safety preconditions. Link to relevant items.
- Use `?` in fallible examples and keep internal implementation details out of
  public rustdoc. Run doctests where the repository supports them.
- Macro syntax should suggest its output. Support applicable attributes,
  documentation, visibility, item positions, types, and lifetime bounds.

## Implementation and review checks

Before finishing authorized implementation work, review the diff for:

- Consistent imports, names, ownership, and construction paths.
- Useful error context, checked boundaries, and intentional panic behavior.
- Task ownership, lock behavior, cancellation, and teardown.
- Explicit unsafe blocks with justified contracts and `// SAFETY:` comments.
- Representative tests for successful values, malformed input, and failure paths;
  avoid relying only on all-zero or identity fixtures.
- Stale suppressions, unnecessary clones, magic values, and obsolete code paths.

Use the project's test framework and build system. Run its formatting, linting,
unit tests, and doctests when feasible and authorized; use Cargo commands only
when the repository uses Cargo. Adopt new editions and dependencies according
to its policy. Prefer standard library facilities such as `LazyLock` when the
minimum supported Rust version allows them.

Report the exact checks performed and remaining gaps. Review-only work recommends
checks and does not claim to have executed them.

## References

- [Rust API Guidelines](https://rust-lang.github.io/api-guidelines/)
- [The Rust Reference](https://doc.rust-lang.org/reference/)
- [The Rustonomicon](https://doc.rust-lang.org/nomicon/)
- [Standard library documentation](https://doc.rust-lang.org/std/)
