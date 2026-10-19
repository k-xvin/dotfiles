# Document review

Read existing comments and edit history before adding feedback. Check whether later
sections answer a question before commenting, and do not reopen resolved discussions
without new evidence.

## Procedure

1. Read for comprehension before commenting. Note undefined terms, forward references,
   passages that require rereading, and questions answered later. Those observations
   support specific feedback about reading order.
2. State the thesis, load-bearing decisions, and audience in your own words. If they
   differ from the author's stated intent, identify that divergence. Ask only questions
   that the document and conversation leave unresolved; preserve deliberate opinions.
3. Review local clarity using the categories below.
4. Review structure and combine related local defects into structural findings.
5. Deliver structural findings first, followed by anchored comments in document order.
   Mention concrete strengths where useful. Write one comment per repeated pattern,
   and scale feedback to the document rather than filling a quota.

Edit the source only when requested. A review that only deletes opinions can remove the
reason the document exists; distinguish unsupported claims from positions the author
intends to defend.

## Local clarity

- **Undefined terms:** locate first use and definition. Moving an existing definition
  earlier is safe; inventing one requires evidence.
- **Misleading or overloaded terms:** describe your initial interpretation and what the
  text appears to mean. Check component and API names for inconsistent spelling.
- **Claims without examples:** ask for the actual output, command, log, or configuration
  that would make the claim concrete. Do not invent it.
- **Unverifiable claims:** replace superlatives with supported facts or ask what would
  distinguish agreement from disagreement.
- **Headings:** check whether the section answers the heading; propose a better heading
  from existing content when it does not.
- **Diagrams:** check labels, formats, explanations, and whether repeated diagrams show
  distinct views or duplicate the same information.

## Prose defects

Apply the global prose rules. Diagnose a repeated pattern once, not at every occurrence:

- Delete aphoristic closers, self-congratulation, slogans, and statements about a claim's
  importance that add no facts.
- Prefer a literal description to a metaphor before using that metaphor as shorthand.
- Check absolutes against actual requirements and enforcement. Keep necessary negations
  when readers are likely to hold the specific misconception being corrected.
- Replace hedged non-answers with a decision, an action, or an explicitly unresolved issue.
- Keep one statement of a point rather than repeating it in plain, emphatic, and abstract
  forms. Split stacked asides that obscure the main clause.
- Require evidence for numerical precision and comparisons. Do not supply a measurement
  the source lacks.
- Join related facts; use bullets for disjoint facts instead of a run of two-clause
  one-liners.

Use these as diagnoses, not a mechanical linter. Emphasis can identify a genuinely
load-bearing claim; provenance such as "We chose A over B because C" is useful content.

## Structure

Unless the document has a different required format, check the order:
overview → glossary → scope → architecture → implementation → workflow.
Implementation sections should follow the architecture's decomposition.

Look for:

- Architecture-level questions buried in implementation details.
- Duplicate definitions, glossary entries, or overlapping claims.
- Context or definitions placed after the sections that require them.
- Audiences or components named in the overview but omitted later.
- A document serving several jobs, such as design, tutorial, and repository guide.
  Propose a split by reader need, not file tidiness.
- A thesis or material decision that cannot be identified from the opening section.

Propose exact moves where possible. Many undefined terms may need one glossary change;
several local comments may disappear after moving a section. Preserve uncertainty about
whether apparently overlapping concepts are deliberately distinct.

## Anchored comments

Each comment includes:

1. An exact quoted anchor; line numbers alone can become stale.
2. The reading difficulty or concrete defect: for example, "I could not tell whether X
   or Y owns this operation."
3. An answerable question or focused action.
4. Optionally, a clearly marked draft using deletion, reordering, or restatement of
   supported facts. A new factual claim needs evidence before entering the draft.

Be direct about the defect and explicit about uncertainty. Distinguish a missing fact
from an opinion you would have expressed differently.
