---
name: ascii-box-diagram
description: Use when asked to draw an ASCII architecture/system diagram made of nested and/or side-by-side rectangular boxes connected by vertical arrows (the "+---+ / | text |" style) — e.g. component/service diagrams in code comments, design docs, or READMEs. Not for flowcharts with branching/diamonds or free-form ASCII art, or repositories whose conventions mandate Mermaid.
---

# ASCII box diagram

Renders clean, perfectly-aligned nested-box ASCII diagrams like this:

```
+---------------------------------------------------------------+
|                     RequestCoordinator                        |
|  +---------------------------------------------------------+  |
|  |                    request observers                    |  |
|  | RequestObserver (request completion)                    |  |
|  +---------------------------------------------------------+  |
+---------------------------------------------------------------+
                                |
                                v
+---------------------------------------------------------------+
|                       RequestHandler                          |
+---------------------------------------------------------------+
```

Boxes can also sit side by side as parallel columns (see the **row**
element below), for diagrams that fork into alternatives, run
components in parallel, or otherwise aren't purely top-down:

```
+----------------------------------------+
|               Dispatcher               |
+----------------------------------------+
                     |
                     v
+----------+      +----------------------+
|  Path A  |      |        Path B        |
| fast path|      | slow path            |
+----------+      | does extra validation|
                  +----------------------+
                     |
                     v
+----------------------------------------+
|                  Sink                  |
+----------------------------------------+
```

**Never hand-align these by counting spaces.** Getting every `|` in a
nested or multi-column diagram to line up by hand is exactly the kind
of mechanical work that produces subtle off-by-one drift (a single
mis-padded line buried in 70 lines of box art). Instead, describe the
diagram as data and let `scripts/render.py` compute widths and
alignment. Don't pre-plan exact widths yourself — describe the
content (titles, lines, nesting, columns) and let the renderer size
and align everything; reach for `width`/`min_width` only for
deliberate aesthetic tweaks, not to make things line up.

## Workflow

1. Translate the diagram into the JSON schema below (see Schema).
2. Write it to a temp file and run:
   ```
   python3 ~/.pi/agent/skills/ascii-box-diagram/scripts/render.py spec.json
   ```
   (or pipe JSON via stdin).
3. Paste the script's stdout verbatim into the target file/comment.
   Do not manually edit whitespace in the output — if something looks
   wrong, fix the JSON spec and re-render.

## Schema

Top level:
```json
{"elements": [ ...sibling elements, rendered top to bottom... ]}
```

An **element** is one of:

- **box** — a rectangle.
  ```json
  {"box": {
    "title": "Centered header text (optional)",
    "lines": ["Left-aligned content line", "..."],
    "children": [ ...nested elements, indented one level... ],
    "fit": false,
    "width": null,
    "min_width": null
  }}
  ```
  - `title`, `lines`, `children` are all optional and can combine (a
    box can have a title, its own lines, *and* nested child boxes).
  - `fit: true` sizes the box to its own minimal content instead of
    stretching to match its sibling boxes — use this for small
    pass-through/label boxes (e.g. a protocol name) sitting between
    two wider component boxes in the same vertical chain.
  - `width` forces an exact total width (border to border). Use for
    manual aesthetic control (e.g. a `fit` box you want a bit roomier
    than its bare minimum).
  - `min_width` sets a floor without forcing an exact width.

- **arrow** — a vertical connector (`|` then `v`), optionally with a
  centered label in between (renders as `|` / label / `|` / `v`):
  ```json
  {"arrow": {"label": "optional note text"}}
  ```

- **note** — a standalone centered text line with no box or arrow:
  ```json
  {"note": "some centered text"}
  ```

- **row** — side-by-side columns, for splitting the same level into
  parallel branches instead of stacking everything vertically.
  ```json
  {"row": {
    "columns": [
      [ ...elements, rendered top to bottom, for column 1... ],
      [ ...elements for column 2... ]
    ],
    "gap": 4,
    "align": "top",
    "fit": false,
    "width": null,
    "min_width": null
  }}
  ```
  - Each entry in `columns` is a sibling list using the *exact same
    schema* as top-level `elements` — a column can be one box, a
    whole vertical chain (box/arrow/box/...), or even another `row`
    nested inside it. This is what lets you build forks, parallel
    lanes, or side-by-side comparisons instead of one long stack.
  - `gap` is the number of spaces between adjacent columns (default
    4).
  - `align` controls vertical alignment when columns render to
    different heights: `"top"` (default, columns start together and
    the shorter one ends early — natural for "these start at the same
    point and may finish at different times"), `"bottom"`, or
    `"center"`.
  - `fit`, `width`, `min_width` behave the same as on a box: `fit`
    keeps a row from stretching its siblings wider, `width`/`min_width`
    give manual control. Unlike a box, a row has no border of its own
    to stretch — if it's forced wider than its columns need, the
    extra space is split evenly on the outside (centering), not
    injected between columns.

Put `arrow`/`note`/`row` elements directly in a `children` list to
connect or annotate nested boxes inside a parent, exactly like
top-level elements connect top-level boxes — nesting and splitting
compose freely at any depth.

## How sizing works (so you can predict the output)

- All *sibling* elements in the same list (top-level `elements`, one
  box's `children`, or one row's `columns[i]`) that aren't marked
  `fit` share one common width: the widest minimum any of them needs.
  This is what makes a whole vertical chain of component boxes line up
  even when one has far more content than the others. A `row` counts
  toward this like any other sibling — its width is the sum of its
  columns' widths plus gaps.
- A `fit` box or row is sized to its own content and centered under
  the shared width — use it for slim connector labels or a branch
  that shouldn't force everything else wider.
- Nesting one level deeper (a box's `children`) always costs 6 columns
  of total width (2 spaces of margin + 1 border char, each side). A
  `row`'s columns have no such fixed border cost — each column is
  exactly as wide as its own content needs, joined by `gap` spaces.
- Arrows and notes center on the same shared width as their
  surrounding siblings, so `|`/`v` land under the middle of the
  chain — or under the middle of a whole `row` block if one precedes
  or follows it, not under any single column.
- Within a `row`, columns render independently and are joined
  left-to-right; a taller column doesn't affect a shorter neighbor's
  own internal alignment, only the blank padding added per `align`.

If a rendered box looks awkwardly wide, it's because some sibling
(possibly several levels deep, or inside a row's column) has a long
content line forcing the whole group wider — shorten that line, or
pull it out of the shared-width group with `fit: true` if it doesn't
belong in the visual chain.

## When not to use this

- Flowcharts needing decision diamonds, swimlanes, diagonal/curved
  connectors, or arrows that merge two branches back into one visual
  line — this renderer does stacked boxes, straight vertical arrows,
  and side-by-side columns (`row`), but nothing more exotic. A fork
  into parallel columns is fine; drawing the lines that visually
  converge them back together is not — just start a new full-width
  box after the row and let the reader infer the join.
- Free-form or non-hierarchical layouts in general.
- Repositories whose own conventions mandate another diagram format,
  such as Mermaid — check first.
