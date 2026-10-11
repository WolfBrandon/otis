# Changelog

All notable changes to OTIS are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and OTIS uses
[semantic versioning](https://semver.org/): MAJOR.MINOR.PATCH.

- **MAJOR** goes up for changes that break existing projects, files or the API.
- **MINOR** goes up for new features.
- **PATCH** goes up for bug fixes and small tweaks.

While OTIS is below 1.0, a minor version may still change the file format,
and this file will say so when it does.

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

[0.3.0]: https://github.com/WolfBrandon/otis/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/WolfBrandon/otis/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/WolfBrandon/otis/releases/tag/v0.1.0
