---
name: writing
description: >
  Write, edit, and review technical documents: design docs, RFCs, specs,
  ADRs, implementation plans, and architecture explanations. Use when asked
  to write a document from source material; make existing prose clearer,
  tighter, or less AI-sounding; or critique a document. Write or edit when
  asked for text. Review by diagnosing and leaving anchored comments unless
  the user asks for a rewrite.
---

# Technical writing

Follow the requested mode: write, edit, or review. Produce requested text rather than
substituting a review; leave review feedback rather than rewriting without permission.
Follow `~/.pi/agent/AGENTS.md` for prose conventions.

## Source fidelity

Extract facts, decisions, open questions, and citations before writing from source
material. Write from that inventory, not the source's sentences. Preserve uncertainty
and deliberate opinions; do not make an unsupported claim sound settled.

For edits, prefer:

- **Deletion:** remove filler and repeated claims.
- **Reordering:** move existing context or definitions before their consumers.
- **Plain restatement:** express the existing fact directly.

These changes do not require inventing facts. If an edit needs a new mechanism,
measurement, example, or claim, establish its source or leave it unresolved.

For code comments, read the surrounding implementation and relevant callers. Keep the
non-obvious constraint near the code it governs; remove narration duplicated by code.
Do not shorten a comment at the expense of technical accuracy.

## Writing and editing

Organize new documents from overview to details. Unless the required format differs,
use overview → glossary → scope → architecture → implementation → workflow;
implementation sections follow the architecture's decomposition.

Keep the author's supported claims and intentional positions. Before delivering, check
for borrowed voice, unsupported confidence, slogans, repeated claims, and contrastive
one-liners. Preserve emphasis where it identifies a load-bearing decision.

## Document review

For document critique or review, read [the document-review procedure](reference/document-review.md).
It covers comprehension, local clarity, structural review, and anchored comments.
Ordinary writing and editing do not require that reference.
