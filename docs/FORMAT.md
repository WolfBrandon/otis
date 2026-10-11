# OTIS file format

OTIS saves projects as JSON (`*.otis.json`). Everything is measured in
**character cells**, never pixels. `x` is the column, `y` is the row, both
zero-based from the top-left of the canvas.

## Project

```json
{
  "otis": 1,
  "id": "k3j9x2",
  "name": "GenX dashboard",
  "cols": 120,
  "rows": 40,
  "font": { "family": "GeistMono Nerd Font", "size": 16, "lineHeight": 1.2 },
  "palette": { "id": "tokyo-night", "name": "Tokyo Night", "mode": "dark", "colors": { "background": "#1a1b26", "...": "..." } },
  "background": "background",
  "foreground": "foreground",
  "layers": [
    { "id": "a1", "name": "Layer 1", "visible": true, "locked": false, "objects": [] }
  ]
}
```

- `layers[0]` is the **bottom** layer. Objects inside a layer draw in array
  order, so the last object is on top.
- `palette` is a full copy of the palette, so a project file is self-contained.

## Colors

A color is one of:

| value        | meaning                                                         |
|--------------|-----------------------------------------------------------------|
| `"#rrggbb"`  | a fixed truecolor value                                         |
| `"red"` etc. | a **palette slot** — a key in `palette.colors`; follows the theme |
| `null`       | default: `fg` falls back to the project `foreground`, `bg` is transparent |

Palette slots use Omarchy's `colors.toml` keys:

```
background dark_background darker_background lighter_background selection
foreground dark_foreground light_foreground bright_foreground
accent muted
red yellow orange green cyan blue magenta brown
bright_red bright_yellow bright_green bright_cyan bright_blue bright_magenta
```

A palette may add any extra keys of its own (custom swatches).

For ANSI export, slots map to the 16 terminal colors the way Omarchy's
terminal templates do: 0 `background`, 1 `red`, 2 `green`, 3 `yellow`,
4 `blue`, 5 `magenta`, 6 `cyan`, 7 `foreground`, 8 `muted`, 9–14 `bright_*`,
15 `bright_foreground`. Any other slot or hex color is exported as truecolor.

## Objects

Fields every object has:

```json
{ "id": "q81", "type": "box", "name": "", "fg": null, "bg": null,
  "attrs": { "bold": false, "italic": false, "underline": false, "dim": false, "strike": false },
  "font": null }
```

`font` is `null` (use the project font) or a font-family name. The cell grid is
always sized by the project font; a per-object font only changes how glyphs are
drawn inside their cells.

### `box` and `text`

Both are rectangular frames with an optional border and optional text. The
**Box** tool makes one with a border; the **Text** tool makes one without.

```json
{ "type": "box", "x": 2, "y": 1, "w": 30, "h": 8,
  "border": "single", "borderChars": null, "borderFg": null,
  "fill": null,
  "title": "BOARDS", "titleAlign": "left",
  "text": "", "align": "left", "valign": "top", "padding": 1,
  "autoSize": false, "transparent": false }
```

- `border`: `none single double heavy rounded dashed heavy-dashed ascii block half outer custom`
- `borderChars`: with `custom`, 8 characters in the order
  top-left, top, top-right, right, bottom-right, bottom, bottom-left, left.
- `fill`: `null` leaves the interior transparent; a character (usually `" "`)
  paints every interior cell with that character in `fg`/`bg`.
- `padding`: blank columns between the border and the text, left and right.
- `autoSize` (text objects): `w`/`h` follow the text instead of wrapping.
- `transparent`: spaces in the text let what's underneath show through
  (for ASCII art). Otherwise typed spaces cover what's below.
- A space with no background never paints, so text and ASCII art are
  transparent around their characters unless `bg` or `fill` is set.

### `line`

An orthogonal connector. Each pair of consecutive points is joined with one
elbow.

```json
{ "type": "line", "points": [[4, 10], [30, 14]], "route": "hv",
  "style": "single", "start": "none", "end": "arrow" }
```

- `route`: `hv` goes horizontal first, `vh` vertical first.
- `style`: `single double heavy rounded dashed ascii`
- `start` / `end`: `none arrow triangle dot circle diamond square bar`

### `table`

A grid of cells. Widths and heights are per column and row, measured inside
the lines; each border or divider line takes one more cell.

```json
{ "type": "table", "x": 2, "y": 4,
  "colWidths": [12, 10, 7], "rowHeights": [1, 1, 1],
  "cells": [["NAME", "STATUS", "CPU"], ["nginx", "running", "12%"], ["redis", "stopped", "0%"]],
  "aligns": ["left", "left", "right"],
  "border": "single", "borderFg": null, "header": true, "headerFg": "accent", "headerBg": null,
  "colLines": true, "rowLines": false, "padding": 1 }
```

- `border`: `single double heavy rounded dashed ascii none`
- `header`: the first row is bold and has a line under it.
- `colLines` / `rowLines`: divider lines between columns / between every row.
- `padding`: blank columns inside each cell, left and right.

### `block`

A rectangle filled with one glyph — shades and block elements.

```json
{ "type": "block", "x": 0, "y": 0, "w": 10, "h": 3, "glyph": "▓" }
```

### `cursor`

A one-cell TUI cursor or selection marker.

```json
{ "type": "cursor", "x": 12, "y": 5, "glyph": "█", "blink": true }
```

### `paint`

Free-hand cells from the pencil. `cells` are `[dx, dy, char, fg, bg]`, offset
from `x`/`y`; `fg`/`bg` may be `null` to use the object's colors.

```json
{ "type": "paint", "x": 40, "y": 3, "cells": [[0, 0, "█", "red", null], [1, 0, "▀", null, null]] }
```

### `group`

Objects moved and selected together. Children keep **absolute** coordinates.

```json
{ "type": "group", "children": [ { "type": "box", "...": "..." } ] }
```

## Library

Snippets and custom palettes live in a separate library, not in projects.

```json
{
  "snippets": [
    { "id": "s1", "name": "Progress bar", "category": "Widgets",
      "w": 22, "h": 1, "objects": [ { "type": "text", "x": 0, "y": 0, "...": "..." } ] }
  ],
  "palettes": [
    { "id": "my-theme", "name": "My theme", "mode": "dark", "colors": { "background": "#000000" } }
  ]
}
```

Snippet objects are stored relative to `0,0`.

## Markdown export

Markdown export writes the visible canvas as plain text inside a fenced code
block. Colors and fonts can't be carried by Markdown. With **Embed project**
on, the full project JSON is appended inside an HTML comment
(`<!-- otis-project ... -->`), so OTIS can open the `.md` file again.
