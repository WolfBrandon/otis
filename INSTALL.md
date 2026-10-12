# Installing OTIS: instructions for AI agents

The user asked you to install OTIS (https://github.com/WolfBrandon/otis), a
local app for designing terminal UIs, so that it opens from their app
launcher and you can draw in it. Follow these steps in order. Nothing needs
root unless Node.js is missing.

## 1. Check first

```bash
node --version    # needs v20 or newer
git --version
~/.local/share/otis/app/install.sh --check 2>/dev/null   # already installed?
```

- No Node.js: on Omarchy run `mise use -g node@lts`; elsewhere ask the user
  to run `sudo pacman -S nodejs` (it needs their password).
- Already installed: running step 2 again updates it.

## 2. Install

```bash
curl -fsSL https://raw.githubusercontent.com/WolfBrandon/otis/main/install.sh | bash
```

Run it as is, from any folder. It:

- downloads OTIS to `~/.local/share/otis/app` (projects go in
  `~/.local/share/otis/projects`),
- runs it as a systemd user service at http://localhost:6847,
- adds an **OTIS** launcher (Super + Space, then type OTIS) and opens it,
- connects OTIS's MCP server to every installed agent it knows: Claude Code,
  Codex, Gemini CLI, Grok, Copilot CLI, Pi, OpenCode and Cursor CLI,
- links the OTIS skill into `~/.agents/skills` and `~/.claude/skills`.

Options go after `bash -s --`, e.g. `| bash -s -- --docker` to run in Docker,
`--agent codex` to connect only one agent, `--port 6900`.

Run the curl line even if you cloned the repo to read it, and delete your
clone afterwards: the service runs from the folder it was installed from.
Only run `./install.sh` from a clone the user told you to keep.

## 3. Connect yourself, if you're not in that list

Add a stdio MCP server named `otis` whose command is
`~/.local/share/otis/otis-mcp` (no arguments, written by the installer),
using your own way of adding MCP servers for all projects (user scope, not
just this folder).

## 4. Check, then tell the user

```bash
~/.local/share/otis/app/install.sh --check    # the lines after the first start with "ok"
```

Then tell the user, briefly:

- OTIS is open; next time it's Super + Space, then type OTIS.
- Start a new session with you so OTIS's tools load, then try something like
  "sketch a TUI for a Docker dashboard in OTIS".
- Ctrl+Z in OTIS undoes anything an agent draws.

## Updating and removing

- Update: run the step 2 command again. (The user can also click Update now
  in OTIS's Help → About; that updates the app but not the launcher or agent
  connections.)
- Remove: `~/.local/share/otis/app/install.sh --uninstall`. That takes out
  the service, launcher and agent connections, and keeps the projects.
