# Changelog

All notable changes to OTIS are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and OTIS uses
[semantic versioning](https://semver.org/): MAJOR.MINOR.PATCH.

- **MAJOR** goes up for changes that break existing projects, files or the API.
- **MINOR** goes up for new features.
- **PATCH** goes up for bug fixes and small tweaks.

While OTIS is below 1.0, a minor version may still change the file format,
and this file will say so when it does.

## [0.5.1] - 2026-10-13

### Fixed

- An edit made while OTIS was saving could be marked as saved when it
  wasn't, and be lost if you closed the window. The next autosave now saves
  it.
- An edit made while OTIS was loading a change from the AI or another window
  could be replaced without a word. OTIS now keeps it; if both sides changed
  the project, it says so, and Ctrl+Z brings your edit back.
- Deleting a project that's open (in this window or another one) no longer
  brings it back at the next autosave. The window opens your most recent
  other project instead, and the server refuses saves to a deleted project.
- Saving twice at once, such as Ctrl+S during an autosave, no longer reports
  "Changed elsewhere" by mistake.

## [0.5.0] - 2026-10-11

### Added

- **Update now**, in Help → About: when a new version is out, OTIS downloads
  it and restarts itself, and the window reloads on the new version. It works
  when OTIS was installed with the install command (or runs from a clone of
  the repository without uncommitted changes); otherwise About says what to
  run. It brings in the latest code, which can be a little newer than the
  latest release. Other open OTIS windows reload by themselves too.
- `/api/update` in the server, which the button uses, and a `boot` id in
  `/api/health` that changes whenever the server restarts.

## [0.4.2] - 2026-10-11

### Fixed

- The Text tool adds new text when you click on a box or a table, instead of
  editing the box's own text. Clicking existing text still edits it. If the
  box is on a layer above the active one, the new text goes on the box's
  layer, so it shows on top.
- Rename and other dialogs open with their text selected, so typing replaces
  the old name instead of adding to it.

## [0.4.1] - 2026-10-11

### Fixed

- A box with a solid fill now hides what's underneath along its border and
  title too, not just inside. Before, a highlighted row on a lower layer
  showed through a popup's edge.

## [0.4.0] - 2026-10-11

### Added

- Tabs: one project holds several screens, each with its own canvas size and
  layers. Add, rename, reorder, duplicate and delete them from the bar above
  the canvas. Undo takes you to the tab where the change was, and other
  windows stay on their own tab.
- Scale a selection: several selected objects (or a group) get handles, and
  dragging one stretches or shrinks them all. Junctions stay joined.
- TextArt (`Shift+T`): big letters from text, in OTIS's Blocks 3D and Blocks
  fonts or the classic FIGlet fonts, in small, medium and large. TextArt
  remembers its text, font and size, so you can change them later.
- Markdown export can include every tab, each under its own heading.
- MCP: an `edit_tab` tool, a `tab` option on the drawing tools (they use the
  tab you have open), and TextArt through `art` on text objects.
- Install by asking your AI agent ("Install https://github.com/WolfBrandon/otis
  as an app"), or with one line: `curl -fsSL …/install.sh | bash`. OTIS goes
  in `~/.local/share/otis/app`. `INSTALL.md` walks agents through it.
- The installer connects OTIS to every coding agent it finds (Claude Code,
  Codex, Gemini CLI, Grok, Copilot CLI, Pi, OpenCode, Cursor CLI) and links an
  OTIS Agent Skill that tells them when and how to use it. `--agent NAME`
  picks agents, `--check` reports what's set up, and `--uninstall` undoes it
  all.
- `AGENTS.md` for agents working on OTIS's code.
- A how-to (`docs/HOWTO.md`, also under Help → How-to guide) that goes from
  installing OTIS through tabs, popups and TextArt to building the design
  with your AI agent.

### Changed

- The project file format is now version 2: canvas size and layers live in
  `tabs`. Older files open as a single tab named "Main" and look the same.
  OTIS 0.3 and earlier can't read version 2 files.

### Fixed

- A box with a solid fill now hides background colors underneath it, also
  from lower layers. Before, a highlighted row under a popup showed through.

## [0.3.0] - 2026-10-11

### Added

- OTIS works as an online demo on GitHub Pages. Without the OTIS server it
  saves designs in the browser, says so once, and links to the full version
  from the status bar. The About window still shows the version.
- A demo GIF at the top of the README and a preview image for links to OTIS.

## [0.2.0] - 2026-10-11

### Added

- The About window shows the version, and whether a newer release is out.
- Layers panel: drag objects onto another layer, or between objects to restack
  them. A selection moves together.
- Layers panel: delete a single object (with a confirmation), and double-click
  an object's name to rename it.
- Palette swatch groups and snippet categories collapse. OTIS remembers which
  ones you closed.
- An `otis` command, systemd unit, desktop entry and AUR `PKGBUILD` in
  `packaging/`, ready for an Arch package.
- Without `DATA_DIR`, OTIS saves to `~/.local/share/otis` when its own folder
  is read-only (a system package), and still to `./data` otherwise.
- `node server.js` finds your Omarchy themes in `~/.config/omarchy/themes`
  without extra settings.
- Project docs: `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, a code of
  conduct, issue and pull request templates, and tests that run on GitHub for
  Node 20, 22 and 24.

### Fixed

- Hovering a button in a button group (Attributes, Order, Align and others)
  no longer highlights the group's first button as well.
- Closing the Properties panel no longer breaks editing, and OTIS starts
  normally when it was left closed.
- Double-clicking a layer's name to rename it works every time.
- `npm test` works on Node 22. It used to fail there on the `test/` folder
  argument.

## [0.1.0] - 2026-10-11

The first version.

- Canvas measured in characters, with layers, groups, undo and autosave.
- Tools: Select, Box, Text, Arrow, Table, Cursor, Block fill, Pencil, Eraser and Pan.
- Box styles, line styles, tables with resizable rows and columns, fonts, and
  text attributes.
- Palettes built from every stock Omarchy theme, plus PhosphorWolf (the
  default) and Phosphor. Colors can follow the theme.
- 27 built-in snippets, and your own snippet library.
- Sidebar panels that collapse, close, reorder and resize, in Slim and Wide modes.
- Export to Markdown, plain text, ANSI and PNG.
- `install.sh`: run natively as a systemd user service or in Docker, with an
  Omarchy launcher.
- An MCP server (`mcp.js`) so AI assistants can view and draw designs live.

[0.4.2]: https://github.com/WolfBrandon/otis/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/WolfBrandon/otis/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/WolfBrandon/otis/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/WolfBrandon/otis/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/WolfBrandon/otis/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/WolfBrandon/otis/releases/tag/v0.1.0
