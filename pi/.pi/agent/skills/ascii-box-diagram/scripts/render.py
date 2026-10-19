#!/usr/bin/env python3
"""Render a nested-box ASCII diagram from a JSON spec.

Usage: render.py < spec.json
       render.py spec.json

See SKILL.md in this skill's directory for the JSON schema and examples.
"""
import json
import sys


DEFAULT_ROW_GAP = 4


def is_box(e):
    return "box" in e


def is_arrow(e):
    return "arrow" in e


def is_note(e):
    return "note" in e


def is_row(e):
    return "row" in e


def box_of(e):
    return e["box"]


def row_of(e):
    return e["row"]


def is_fit(e):
    """True if this element opts out of stretching to the group's shared width."""
    if is_box(e):
        return bool(box_of(e).get("fit"))
    if is_row(e):
        return bool(row_of(e).get("fit"))
    return False


def min_width(e):
    """Total width (border to border) this element needs at minimum."""
    if is_box(e):
        b = box_of(e)
        interior = 0
        if b.get("title"):
            interior = max(interior, len(b["title"]) + 2)
        for line in b.get("lines", []):
            interior = max(interior, len(line) + 1)
        children = b.get("children")
        if children:
            interior = max(interior, group_width(children) + 4)
        if b.get("min_width"):
            interior = max(interior, b["min_width"] - 2)
        return interior + 2
    if is_arrow(e):
        label = e["arrow"].get("label")
        return (len(label) + 2) if label else 0
    if is_note(e):
        return len(e["note"]) + 2
    if is_row(e):
        r = row_of(e)
        columns = r.get("columns", [])
        gap = r.get("gap", DEFAULT_ROW_GAP)
        total = sum(group_width(col) for col in columns)
        if len(columns) > 1:
            total += gap * (len(columns) - 1)
        if r.get("width"):
            total = max(total, r["width"])
        if r.get("min_width"):
            total = max(total, r["min_width"])
        return total
    raise ValueError(f"unrecognized element: {e!r}")


def group_width(elements):
    """Shared width for a sibling list: max requirement among non-'fit' elements.

    'fit' boxes/rows are sized independently and centered, so they don't force
    the rest of the group wider.
    """
    constraining = [e for e in elements if not is_fit(e)]
    pool = constraining if constraining else elements
    widths = [min_width(e) for e in pool]
    return max(widths) if widths else 0


def render_arrow(label, width):
    col = width // 2
    rows = []
    rows.append((" " * col + "|").ljust(width))
    if label:
        rows.append(label.center(width))
        rows.append((" " * col + "|").ljust(width))
    rows.append((" " * col + "v").ljust(width))
    return rows


def render_box(b, width):
    interior = width - 2
    rows = ["+" + "-" * interior + "+"]
    if b.get("title"):
        rows.append("|" + b["title"].center(interior) + "|")
    for line in b.get("lines", []):
        rows.append("|" + (" " + line).ljust(interior) + "|")
    children = b.get("children")
    if children:
        child_width = interior - 4
        for row in render_group(children, child_width):
            rows.append("|" + "  " + row + "  " + "|")
    rows.append("+" + "-" * interior + "+")
    return rows


def render_row(r):
    """Render side-by-side columns at the row's own natural width. Each column
    is its own sibling list (same schema as top-level `elements`), recursively
    rendered and width-computed — so a column can hold a single box, a whole
    vertical chain, or nested rows. Columns are padded to a common height (per
    `align`) and joined by `gap` spaces. The caller (render_group) centers the
    result if a wider sibling forces the group wider.
    """
    columns = r.get("columns", [])
    gap = r.get("gap", DEFAULT_ROW_GAP)
    align = r.get("align", "top")
    col_widths = [group_width(col) for col in columns]
    col_lines = [render_group(col, w) for col, w in zip(columns, col_widths)]
    height = max((len(cl) for cl in col_lines), default=0)
    padded = []
    for cl, w in zip(col_lines, col_widths):
        blank = " " * w
        deficit = height - len(cl)
        if align == "bottom":
            cl = [blank] * deficit + cl
        elif align == "center":
            top = deficit // 2
            cl = [blank] * top + cl + [blank] * (deficit - top)
        else:  # top
            cl = cl + [blank] * deficit
        padded.append(cl)
    gap_str = " " * gap
    rows = [gap_str.join(cols_at_row) for cols_at_row in zip(*padded)] if padded else []
    natural_width = sum(col_widths) + gap * max(0, len(columns) - 1)
    return [l.ljust(natural_width) for l in rows]


def render_group(elements, width):
    """Render a sibling list to a list of strings, each exactly `width` chars."""
    out = []
    for e in elements:
        if is_box(e):
            b = box_of(e)
            own_width = b.get("width") or (min_width(e) if b.get("fit") else width)
            box_lines = render_box(b, own_width)
            if own_width < width:
                pad = (width - own_width) // 2
                box_lines = [(" " * pad + l).ljust(width) for l in box_lines]
            out.extend(box_lines)
        elif is_arrow(e):
            out.extend([l.ljust(width) for l in render_arrow(e["arrow"].get("label"), width)])
        elif is_note(e):
            out.append(e["note"].center(width))
        elif is_row(e):
            r = row_of(e)
            row_lines = render_row(r)
            natural_width = len(row_lines[0]) if row_lines else 0
            # An explicit width/min_width on the row can exceed what its
            # columns need; a row has no border to stretch, so make up the
            # difference by centering (unlike a box, which stretches instead).
            own_width = max(natural_width, min_width(e))
            if natural_width < own_width:
                pad = (own_width - natural_width) // 2
                row_lines = [(" " * pad + l).ljust(own_width) for l in row_lines]
            if own_width < width:
                pad = (width - own_width) // 2
                row_lines = [(" " * pad + l).ljust(width) for l in row_lines]
            else:
                row_lines = [l.ljust(width) for l in row_lines]
            out.extend(row_lines)
        else:
            raise ValueError(f"unrecognized element: {e!r}")
    return out


def render(spec):
    elements = spec["elements"]
    width = spec.get("width") or group_width(elements)
    lines = render_group(elements, width)
    return "\n".join(l.rstrip() for l in lines)


def main():
    if len(sys.argv) > 1:
        with open(sys.argv[1]) as f:
            spec = json.load(f)
    else:
        spec = json.load(sys.stdin)
    print(render(spec))


if __name__ == "__main__":
    main()
