# OTIS: notes for AI agents

**Installing OTIS for a user?** Follow [INSTALL.md](INSTALL.md). This file is
for changing OTIS's code.

OTIS is a design app for terminal UIs: a Node server (`server.js`, standard
library only) serving a browser app (`public/`, plain ES modules, no build
step), plus an MCP server (`mcp.js`). [CONTRIBUTING.md](CONTRIBUTING.md) has
the ground rules and the release steps; the README's Development section maps
the files; [docs/FORMAT.md](docs/FORMAT.md) is the project file format.

- **No dependencies.** No npm packages, bundler or framework.
- **Keep the core pure.** `model.js`, `composite.js`, `export.js`,
  `palette.js`, `snippets.js` and `textart.js` don't touch the DOM; the tests
  and `mcp.js` run them in Node.
- **Test:** `npm test` (about a second). After editing browser code, also run
  `node --check` on the changed files.
- **Try changes on a scratch server**, never on the user's own data:
  `PORT=6848 DATA_DIR=/tmp/otis-dev node server.js`. An installed OTIS on
  port 6847 may serve this very folder, so browser-code edits reach the user
  when they reload.
- **Versions:** every change gets a semver bump and a `CHANGELOG.md` entry;
  `package.json`, the changelog and `packaging/aur/PKGBUILD` must agree (a
  test checks).
