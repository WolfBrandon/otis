# Contributing to OTIS

Thanks for helping out. Bug reports, ideas, snippets, themes and code are all
welcome.

## Reporting a bug

Open an issue and include:

- the OTIS version (Help → About OTIS)
- how you run it (`install.sh`, Docker, `node server.js`)
- your browser
- what you did, what you expected, and what happened instead

A screenshot or the project file (*File → Download project*) helps a lot.

## Getting set up

There's no build step and nothing to install beyond Node 20 or newer.

```sh
git clone https://github.com/WolfBrandon/otis.git
cd otis
node server.js         # http://localhost:6847, saves to ./data
npm test               # runs every test, in about a second
```

If OTIS is already installed and running on 6847, use another port and a
scratch data folder so your own projects stay out of it:

```sh
PORT=6848 DATA_DIR=/tmp/otis-dev node server.js
```

The browser code is plain ES modules served straight from `public/`, so a
browser refresh picks up front-end changes. Only `server.js` changes need a
restart. The README's Development section has a map of the files.

## Ground rules

- **No dependencies.** OTIS uses Node's standard library on the server and
  vanilla JavaScript in the browser. Please don't add npm packages, a bundler
  or a framework.
- **Simple beats clever.** Prefer the small, readable version.
- **Keep the core pure.** `model.js`, `composite.js`, `export.js`,
  `palette.js`, `snippets.js` and `textart.js` must not touch the DOM. They run in Node for
  the tests and for the MCP server.
- **Don't break saved projects.** If you change the file format, update
  `docs/FORMAT.md` and make sure older files still open (see
  `normalizeProject` in `state.js`).
- **Write it the way the code around it is written**: same naming, comment
  style and formatting.

## Tests

`npm test` runs everything: model and rendering, colors, the server API and
the MCP server. Add a test when you change behavior in the pure modules, the
server or `mcp.js`. For UI changes, say in the pull request what you clicked
through to check it.

## Versions and the changelog

OTIS uses [semantic versioning](https://semver.org/) (MAJOR.MINOR.PATCH):

| Change | Bump |
|---|---|
| Breaks existing projects, files or the API | MAJOR (MINOR while below 1.0) |
| New feature | MINOR |
| Bug fix or small tweak | PATCH |

Every change gets a line in `CHANGELOG.md`. In a pull request, add yours under
an `## [Unreleased]` heading at the top. The maintainer picks the version
number when releasing, sets it in `package.json` and `CHANGELOG.md` (a test
checks that the two match), tags the commit `vX.Y.Z` and publishes a GitHub
release. OTIS's About window compares itself against that release.

## Releasing (maintainer)

1. In `CHANGELOG.md`, turn `## [Unreleased]` into `## [X.Y.Z] - YYYY-MM-DD`
   and add its compare link at the bottom. Set the same version in
   `package.json` and in `packaging/aur/PKGBUILD` (`pkgver`, with `pkgrel=1`).
2. Run `npm test`, then commit: `Release vX.Y.Z`.
3. Tag and push: `git tag -a vX.Y.Z -m "OTIS X.Y.Z" && git push --follow-tags`.
4. Publish the GitHub release with that version's changelog section as the
   notes: `gh release create vX.Y.Z --title "OTIS X.Y.Z" --notes-file notes.md`.
   The About window compares against this release. Don't mark it as a
   pre-release: GitHub leaves those out of "latest", and the version number
   below 1.0 already says it's a beta.
5. Update the AUR package from a clone of `ssh://aur@aur.archlinux.org/otis.git`:
   copy in `packaging/aur/PKGBUILD` and `otis.install`, run `updpkgsums` to
   record the release tarball's checksum, then
   `makepkg --printsrcinfo > .SRCINFO`. Test it with `makepkg -f`, then
   commit and push.

## Pull requests

- Keep each pull request to one topic.
- Make sure `npm test` passes.
- Add a screenshot for visible changes.
- Use short, plain commit messages ("Add table header colors", "Fix arrow
  caps on ASCII lines").

By contributing, you agree that your work is released under the
[MIT License](LICENSE).
