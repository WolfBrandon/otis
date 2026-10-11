---
name: otis
description: >
  Design terminal UIs on a character grid with OTIS (Omarchy Text Interface
  Studio), live in front of the user. Use when the user wants to sketch, mock
  up, lay out or restyle a terminal UI, TUI screen, dashboard, dialog, status
  bar or big title text (TextArt); mentions OTIS or an OTIS design; or wants
  an OTIS design turned into code (Bubble Tea, Ratatui, Textual, Ink…).
---

# OTIS

OTIS is a local web app at http://localhost:6847. The user watches it in its
own window (Super+Space → OTIS) while you draw: every change shows up live,
and Ctrl+Z in OTIS undoes it. Designs are boxes, text, tables, arrows and
TextArt on layers, in one or more tabs (screens), colored with palette slots
so they follow the Omarchy theme.

## 1. Make sure OTIS is running and connected

```bash
curl -fsS http://127.0.0.1:6847/api/health    # {"ok":true,"version":"…"}
```

- No answer: `systemctl --user start otis`. No such service: OTIS isn't
  installed; see "Installing" below.
- Your tools include `render`, `add_objects`, `edit_tab`… from the `otis` MCP
  server: use them (step 2).
- They don't: add a stdio MCP server named `otis` that runs
  `~/.local/share/otis/otis-mcp` (user scope), or run `install.sh --agent
  <you>` from the OTIS folder (two levels above this file). Then tell the user
  to start a new session so the tools load; until then, use the HTTP API
  (step 3).

## 2. Draw with the MCP tools

- `render` first: it shows the open tab with a coordinate ruler and every
  object's id. Every edit returns a fresh render, so check your work.
- Tools act on the project and tab the user has open unless you pass
  `project` / `tab`. Objects the user selected are marked in `render`, so
  "make this red" means the marked ones.
- Use palette slots (`accent`, `foreground`, `muted`, `red`…) instead of hex
  colors, and `list_snippets` for ready-made widgets.
- Big titles: a text object with `art: {text, font, size}`.

## 3. Without MCP: the HTTP API

- `GET /api/current` → `{id, tab, selection}`: what the user has open.
- `GET /api/projects/<id>` → the project JSON, with an `ETag` header.
- `PUT /api/projects/<id>` with `If-Match: <etag>` saves it; the OTIS window
  updates live. A 412 means the user changed it meanwhile: fetch and retry.
- The format is in `docs/FORMAT.md` in the app folder: `tabs[].layers[].objects[]`,
  x = column, y = row, 0-based.

## 4. Turning a design into code

`render` with `format: "text"` and `ruler: false` gives the exact screen;
`get_project` gives every object with its position, colors and text. Build
the real TUI from those, mapping palette slots to the framework's theme
colors.

## Installing, updating, checking

Follow https://raw.githubusercontent.com/WolfBrandon/otis/main/INSTALL.md.
In short: `curl -fsSL https://raw.githubusercontent.com/WolfBrandon/otis/main/install.sh | bash`
installs or updates OTIS (service, launcher, agent connections),
`install.sh --check` reports what's set up, and `install.sh --uninstall`
removes it, keeping the user's projects in `~/.local/share/otis/projects`.
