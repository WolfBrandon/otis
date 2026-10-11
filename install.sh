#!/usr/bin/env bash
# OTIS installer for Omarchy (and other Linux desktops).
#
#   curl -fsSL https://raw.githubusercontent.com/WolfBrandon/otis/main/install.sh | bash
#                             download OTIS to ~/.local/share/otis/app and install it
#                             (run it again to update)
#   ./install.sh              run OTIS natively, as a systemd user service (needs Node 20+)
#   ./install.sh --docker     run OTIS in Docker instead
#   ./install.sh --check      show what's installed and connected
#   ./install.sh --uninstall  remove the service, container, launcher and agent connections (keeps your projects)
#
# Either way OTIS runs at http://localhost:6847, starts when you log in, gets
# an "OTIS" launcher (Super + Space on Omarchy), and is connected to the AI
# coding agents you have installed, so they can draw in it. Your projects live
# in ~/.local/share/otis.
#
# Options: --port N        use another port
#          --agent NAME    connect only this agent (repeatable): claude codex gemini grok
#                          copilot pi opencode cursor (default: every one that's installed)
#          --no-agents     don't connect any agents (--no-mcp works too)
#          --no-open       don't open OTIS when a first install finishes

set -euo pipefail

REPO_URL=${OTIS_REPO_URL:-https://github.com/WolfBrandon/otis.git}
DATA="${XDG_DATA_HOME:-$HOME/.local/share}/otis"
HOME_APP="$DATA/app"   # where the one-line install puts OTIS

say() { printf '\e[32m==>\e[0m %s\n' "$*"; }
note() { printf '    %s\n' "$*"; }
die() {
  printf '\e[31mError:\e[0m %s\n' "$*" >&2
  exit 1
}

# Download (or update) OTIS into ~/.local/share/otis/app and run its installer.
fetch_and_run() {
  command -v git >/dev/null || die "OTIS needs git. Install it with: sudo pacman -S git"
  if [[ -d $HOME_APP/.git ]]; then
    say "Updating OTIS in $HOME_APP"
    git -C "$HOME_APP" pull --ff-only --quiet ||
      die "Couldn't update $HOME_APP (were files there edited?). Move your changes out, or delete the folder, and run this again. Your projects aren't in it."
  else
    say "Downloading OTIS to $HOME_APP"
    mkdir -p "$DATA"
    git clone --quiet "$REPO_URL" "$HOME_APP"
  fi
  exec bash "$HOME_APP/install.sh" "$@"
}

# Piped from curl, there's no OTIS folder around this script yet.
SELF=${BASH_SOURCE[0]:-}
if [[ -z $SELF || ! -f "$(dirname "$SELF")/server.js" ]]; then fetch_and_run "$@"; fi

REPO="$(cd "$(dirname "$SELF")" && pwd)"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT="$UNIT_DIR/otis.service"
APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
THEMES="${XDG_CONFIG_HOME:-$HOME/.config}/omarchy/themes"
MCP_CMD="$DATA/otis-mcp"   # what agents run to reach OTIS (written below)
AGENTS_FILE="$DATA/agents" # the agents this installer connected
ALL_AGENTS=(claude codex gemini grok copilot pi opencode cursor-agent)
PORT=6847
MODE=native
AGENTS=()
NO_AGENTS=no
OPEN=yes
ARGS=("$@")
NODE=

while (($#)); do
  case $1 in
  --docker) MODE=docker ;;
  --uninstall) MODE=uninstall ;;
  --check) MODE=check ;;
  --port)
    PORT=${2:-}
    shift
    ;;
  --agent)
    a=${2:-}
    [[ $a == cursor ]] && a=cursor-agent
    AGENTS+=("$a")
    shift
    ;;
  --no-agents | --no-mcp) NO_AGENTS=yes ;;
  --no-open) OPEN=no ;;
  -h | --help)
    sed -n '2,/^[^#]/{/^#/s/^# \{0,1\}//p}' "$REPO/install.sh"
    exit 0
    ;;
  *) die "Unknown option $1 (try --help)" ;;
  esac
  shift
done
[[ $PORT =~ ^[0-9]+$ ]] || die "--port needs a number"
for a in "${AGENTS[@]}"; do
  [[ " ${ALL_AGENTS[*]} " == *" $a "* ]] || die "OTIS can't connect \"$a\" itself. Agents: ${ALL_AGENTS[*]}. For others, add a stdio MCP server that runs: $MCP_CMD"
done
URL="http://localhost:$PORT"

# A folder in /tmp gets cleaned up, and the service would break with it.
if [[ $MODE == native && $REPO != "$HOME_APP" && ($REPO == /tmp/* || $REPO == /var/tmp/*) ]]; then
  say "OTIS is in a temporary folder ($REPO), so it's installed from $HOME_APP instead"
  fetch_and_run "${ARGS[@]}"
fi

# ── Helpers ──────────────────────────────────────────────────────────────────

docker_ok() { command -v docker >/dev/null && docker info >/dev/null 2>&1; }
has_container() { docker_ok && docker container inspect otis >/dev/null 2>&1; }
port_busy() { ss -Hltn "sport = :$PORT" 2>/dev/null | grep -q .; }
running() { curl -fsS -m 1 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; }

wait_for_otis() {
  for _ in $(seq 1 30); do
    running && return 0
    sleep 0.5
  done
  return 1
}

# A systemd service doesn't get your shell's PATH, so it needs node's full
# path. Node from mise (common on Omarchy) is found through mise's "latest"
# link, which keeps working after Node upgrades.
find_node() {
  local c
  for c in "$(mise which node 2>/dev/null || true)" "$(command -v node 2>/dev/null || true)" /usr/bin/node; do
    [[ -n $c && -x $c && $c != */shims/* ]] || continue
    if "$c" -e 'process.exit(+process.versions.node.split(".")[0] >= 20 ? 0 : 1)' 2>/dev/null; then
      echo "$c"
      return 0
    fi
  done
  return 1
}

# Is a coding agent really installed? On Omarchy, ~/.local/bin holds stubs
# that install (or upgrade) an agent whenever they run, so a stub only counts
# when mise already has the agent behind it, and AGENT_BIN is then the real
# program, which runs without touching the stub.
AGENT_BIN=
agent_installed() {
  local tool
  AGENT_BIN=$(command -v "$1" 2>/dev/null) || return 1
  tool=$(head -c 4096 "$AGENT_BIN" 2>/dev/null | sed -n 's/^mise use -g[^"]*"\([^"]*\)".*/\1/p' | head -1)
  [[ -z $tool ]] && return 0
  mise where "$tool" >/dev/null 2>&1 || return 1
  AGENT_BIN=$(mise which "$1" 2>/dev/null) || return 1
}

# Projects folder. On the first install, copy over anything saved by running
# `node server.js` from this folder (./data), leaving the originals in place.
setup_data() {
  mkdir -p "$DATA/projects"
  shopt -s nullglob
  local mine=("$DATA"/projects/*.otis.json) old=("$REPO"/data/projects/*.otis.json)
  shopt -u nullglob
  if ((${#mine[@]} == 0 && ${#old[@]} > 0)); then
    cp -p "${old[@]}" "$DATA/projects/"
    [[ -f $REPO/data/library.json && ! -f $DATA/library.json ]] && cp -p "$REPO/data/library.json" "$DATA/"
    say "Copied ${#old[@]} project(s) from $REPO/data to $DATA (the originals are still there)"
  fi
}

stop_native() {
  [[ -f $UNIT ]] || return 0
  systemctl --user disable --now otis.service >/dev/null 2>&1 || true
  rm -f "$UNIT"
  systemctl --user daemon-reload
  say "Removed the native otis service"
}

stop_docker() {
  has_container || return 0
  (cd "$REPO" && docker compose down)
  say "Stopped the OTIS Docker container"
}

launcher_exists() { [[ -f $APPS/OTIS.desktop || -f $APPS/otis.desktop ]]; }

install_launcher() {
  if command -v omarchy-webapp-install >/dev/null; then
    # Omarchy's own web app launcher: OTIS opens in its own window
    omarchy-webapp-install OTIS "$URL" "$REPO/public/icon.png"
    say "Added OTIS to the app launcher (Super + Space)"
  else
    mkdir -p "$APPS"
    cat >"$APPS/otis.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=OTIS
Comment=Omarchy Text Interface Studio
Exec=xdg-open $URL
Icon=$REPO/public/icon.png
Terminal=false
EOF
    say "Added OTIS to your applications menu"
  fi
}

open_otis() {
  [[ $OPEN == yes && -n ${WAYLAND_DISPLAY:-${DISPLAY:-}} ]] || return 0
  if command -v omarchy-launch-webapp >/dev/null; then
    (setsid omarchy-launch-webapp "$URL" >/dev/null 2>&1 &)
  else
    (setsid xdg-open "$URL" >/dev/null 2>&1 &)
  fi
}

# ── AI agents ────────────────────────────────────────────────────────────────
# Agents start OTIS's MCP server with one small script, so switching between
# native and Docker, or changing the port, never needs the agents touched again.

write_mcp_cmd() {
  mkdir -p "$DATA"
  {
    echo '#!/bin/sh'
    echo "# Written by OTIS's install.sh: starts OTIS's MCP server for AI agents (stdio)."
    [[ $PORT != 6847 ]] && echo "export OTIS_URL=http://127.0.0.1:$PORT"
    if [[ $MODE == docker ]]; then
      echo 'exec docker exec -i otis node mcp.js'
    else
      echo "exec \"$NODE\" \"$REPO/mcp.js\""
    fi
  } >"$MCP_CMD"
  chmod +x "$MCP_CMD"
}

# Set (or with no value, delete) one entry in a JSON config file, keeping the
# rest. A file that isn't plain JSON (comments) is left alone. The first edit
# keeps a copy next to it (.otis-bak).
json_entry() {
  local file=$1 key=$2 value=${3:-}
  [[ -f $file && ! -f $file.otis-bak ]] && cp "$file" "$file.otis-bak"
  mkdir -p "$(dirname "$file")"
  "${NODE:-node}" -e '
    const fs = require("fs");
    const [file, key, value] = process.argv.slice(1);
    let config = {};
    try { config = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { if (e.code !== "ENOENT") process.exit(1); }
    const [group, name] = key.split(".");
    config[group] ||= {};
    if (value) config[group][name] = JSON.parse(value); else delete config[group][name];
    if (!Object.keys(config[group]).length) delete config[group];
    fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
  ' "$file" "$key" "$value"
}

OPENCODE_CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/opencode/opencode.json"
CURSOR_CONFIG="$HOME/.cursor/mcp.json"

# Each agent's own way of adding a stdio MCP server for every project.
# Call agent_installed first: it finds the program ($AGENT_BIN).
agent_add() {
  local bin=$AGENT_BIN
  case $1 in
  claude) "$bin" mcp remove otis --scope user >/dev/null 2>&1 || true
    "$bin" mcp add --scope user otis -- "$MCP_CMD" ;;
  codex) "$bin" mcp remove otis >/dev/null 2>&1 || true
    "$bin" mcp add otis -- "$MCP_CMD" ;;
  gemini) "$bin" mcp remove --scope user otis >/dev/null 2>&1 || true
    "$bin" mcp add --scope user otis "$MCP_CMD" ;;
  grok) "$bin" mcp add --scope user otis -- "$MCP_CMD" ;;
  copilot) "$bin" mcp remove otis >/dev/null 2>&1 || true
    "$bin" mcp add otis -- "$MCP_CMD" ;;
  pi) "$bin" mcp remove otis >/dev/null 2>&1 || true
    "$bin" mcp add otis -- "$MCP_CMD" ;;
  opencode) json_entry "$OPENCODE_CONFIG" mcp.otis "{\"type\":\"local\",\"command\":[\"$MCP_CMD\"],\"enabled\":true}" ;;
  cursor-agent) json_entry "$CURSOR_CONFIG" mcpServers.otis "{\"command\":\"$MCP_CMD\"}" ;;
  esac
}

agent_remove() {
  local bin=$AGENT_BIN
  case $1 in
  claude) "$bin" mcp remove otis --scope user ;;
  codex) "$bin" mcp remove otis ;;
  gemini) "$bin" mcp remove --scope user otis ;;
  grok) "$bin" mcp remove --scope user otis ;;
  copilot) "$bin" mcp remove otis ;;
  pi) "$bin" mcp remove otis ;;
  opencode) json_entry "$OPENCODE_CONFIG" mcp.otis ;;
  cursor-agent) json_entry "$CURSOR_CONFIG" mcpServers.otis ;;
  esac
}

# The OTIS skill teaches agents when and how to use OTIS. These are the
# folders Omarchy links its own skill into; ~/.agents/skills is shared by
# agents that follow the Agent Skills standard.
SKILL_DIRS=("$HOME/.agents/skills" "$HOME/.claude/skills" "$HOME/.codex/skills" "$HOME/.pi/agent/skills" "$HOME/.hermes/skills")

link_skill() {
  local dir linked=()
  for dir in "${SKILL_DIRS[@]}"; do
    # only agents that are set up here (their home folder exists), plus the shared folder
    [[ $dir == "$HOME/.agents/skills" || -d $(dirname "$dir") ]] || continue
    mkdir -p "$dir"
    ln -sfn "$REPO/skills/otis" "$dir/otis"
    linked+=("${dir/#$HOME/\~}")
  done
  say "Linked the OTIS skill for agents into ${linked[*]}"
}

unlink_skill() {
  local dir
  for dir in "${SKILL_DIRS[@]}"; do
    [[ -L $dir/otis && $(readlink "$dir/otis") == */skills/otis ]] && rm -f "$dir/otis"
  done
  return 0
}

connect_agents() {
  [[ $NO_AGENTS == yes ]] && { link_skill; return 0; }
  write_mcp_cmd
  local list=("${AGENTS[@]}") a connected=() missing=()
  ((${#list[@]})) || list=("${ALL_AGENTS[@]}")
  for a in "${list[@]}"; do
    if ! agent_installed "$a"; then
      ((${#AGENTS[@]})) && missing+=("$a")
      continue
    fi
    if agent_add "$a" >/dev/null 2>&1; then connected+=("$a"); else note "Couldn't connect $a; add a stdio MCP server to it that runs: $MCP_CMD"; fi
  done
  # remember who's connected, for --check and --uninstall
  { [[ -f $AGENTS_FILE ]] && cat "$AGENTS_FILE"; printf '%s\n' "${connected[@]}"; } | sort -u | grep . >"$AGENTS_FILE.new" || true
  mv "$AGENTS_FILE.new" "$AGENTS_FILE"
  if ((${#connected[@]})); then
    say "Connected OTIS's tools to: ${connected[*]}"
    note "Start a new session of your agent to load them."
  else
    note "No AI agents connected. For any MCP client, add a stdio server that runs: $MCP_CMD"
  fi
  ((${#missing[@]})) && note "Not installed, so not connected: ${missing[*]}"
  link_skill
}

disconnect_agents() {
  local a
  if [[ -f $AGENTS_FILE ]]; then
    while read -r a; do
      [[ -n $a ]] && agent_installed "$a" && agent_remove "$a" >/dev/null 2>&1 && say "Disconnected OTIS from $a"
    done <"$AGENTS_FILE"
    rm -f "$AGENTS_FILE"
  fi
  # installs from before 0.4 only knew Claude Code
  if agent_installed claude && agent_remove claude >/dev/null 2>&1; then say "Disconnected OTIS from claude"; fi
  rm -f "$MCP_CMD"
  unlink_skill
}

# ── Install natively ─────────────────────────────────────────────────────────

install_native() {
  NODE=$(find_node) || die "OTIS needs Node.js 20 or newer. Install it with: sudo pacman -S nodejs"
  stop_docker
  systemctl --user stop otis.service >/dev/null 2>&1 || true
  port_busy && die "Something else is using port $PORT (maybe 'node server.js'). Stop it, or pick another port with --port."
  setup_data

  mkdir -p "$UNIT_DIR"
  [[ -f $UNIT ]] && cp "$UNIT" "$UNIT.bak"
  cat >"$UNIT" <<EOF
[Unit]
Description=OTIS - Omarchy Text Interface Studio ($URL)
After=network.target

[Service]
Type=simple
WorkingDirectory=$REPO
ExecStart="$NODE" "$REPO/server.js"
Environment=HOST=127.0.0.1
Environment=PORT=$PORT
Environment="DATA_DIR=$DATA"
Environment="THEME_DIRS=$THEMES"
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
EOF
  # daemon-reload makes systemd read the new file; enable starts it at login
  systemctl --user daemon-reload
  systemctl --user enable otis.service >/dev/null 2>&1
  systemctl --user restart otis.service
  wait_for_otis || die "OTIS didn't start. See what went wrong with: journalctl --user -u otis -n 30"
  say "OTIS is running as a user service with $NODE"
  [[ $REPO == "$HOME_APP" ]] || note "It runs from $REPO, so keep that folder: moving or deleting it stops OTIS."
}

# ── Install in Docker ────────────────────────────────────────────────────────

install_docker() {
  command -v docker >/dev/null || die "Docker isn't installed. Install it with: sudo pacman -S docker docker-compose"
  docker info >/dev/null 2>&1 || die "Can't talk to Docker. Start it with 'sudo systemctl enable --now docker', and make sure you're in the docker group: 'sudo usermod -aG docker \$USER', then log out and back in."
  stop_native
  if ! has_container && port_busy; then
    die "Something else is using port $PORT. Stop it, or pick another port with --port."
  fi
  setup_data

  # .env holds this machine's settings for compose.yaml
  [[ -f $REPO/.env ]] && cp "$REPO/.env" "$REPO/.env.bak"
  {
    echo "# Written by install.sh. docker compose reads this file."
    echo "OTIS_PORT=$PORT"
    echo "OTIS_DATA=$DATA"
    [[ -d $THEMES ]] && echo "OTIS_THEMES=$THEMES"
    echo "OTIS_USER=$(id -u):$(id -g)"
  } >"$REPO/.env"

  (cd "$REPO" && docker compose up -d --build)
  wait_for_otis || die "OTIS didn't start. See what went wrong with: docker compose logs otis"
  say "OTIS is running in Docker (container \"otis\")"
  if [[ $(systemctl is-enabled docker.service 2>/dev/null) != enabled ]]; then
    note "Docker doesn't start at boot, so OTIS won't either. To change that: sudo systemctl enable docker"
  fi
}

# ── Check ────────────────────────────────────────────────────────────────────

# Every line starts with ok or -- so agents and people can read it at a glance.
check() {
  local ok=0 version agents dir links=()
  # the port the service was installed with
  [[ -f $UNIT ]] && PORT=$(sed -n 's/^Environment=PORT=//p' "$UNIT") && URL="http://localhost:$PORT"
  version=$(curl -fsS -m 2 "http://127.0.0.1:$PORT/api/health" 2>/dev/null | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')
  echo "OTIS in $REPO ($(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' "$REPO/package.json"))"
  if [[ -n $version ]]; then echo "ok  running at $URL, version $version"; else echo "--  not running at $URL (start it: systemctl --user start otis)"; ok=1; fi
  if [[ -f $UNIT ]]; then echo "ok  native service: systemctl --user status otis"
  elif has_container; then echo "ok  Docker container \"otis\""
  else echo "--  no service or container: run install.sh"; ok=1; fi
  if launcher_exists; then echo "ok  launcher: Super + Space, then OTIS"; else echo "--  no launcher"; ok=1; fi
  if [[ -x $MCP_CMD ]] && printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"check","version":"1"}}}' |
    timeout 10 "$MCP_CMD" 2>/dev/null | grep -q '"name":"otis"'; then
    echo "ok  MCP server starts: $MCP_CMD"
  else echo "--  MCP server doesn't start ($MCP_CMD); run install.sh again"; ok=1; fi
  agents=$(paste -sd' ' "$AGENTS_FILE" 2>/dev/null || true)
  if [[ -n $agents ]]; then echo "ok  connected agents: $agents (new sessions get OTIS's tools)"; else echo "--  no agents connected: install.sh --agent <name>"; fi
  for dir in "${SKILL_DIRS[@]}"; do [[ -L $dir/otis ]] && links+=("${dir/#$HOME/\~}"); done
  if ((${#links[@]})); then echo "ok  skill linked in: ${links[*]}"; else echo "--  skill not linked"; fi
  return $ok
}

# ── Uninstall ────────────────────────────────────────────────────────────────

uninstall() {
  stop_native
  stop_docker
  if [[ -f $APPS/OTIS.desktop ]] && command -v omarchy-webapp-remove >/dev/null; then
    OMARCHY_REMOVE_NOTIFY=false omarchy-webapp-remove OTIS
    say "Removed the OTIS launcher"
  elif [[ -f $APPS/otis.desktop ]]; then
    rm -f "$APPS/otis.desktop"
    say "Removed the OTIS launcher"
  fi
  disconnect_agents
  say "Your projects are still in $DATA/projects. Delete $DATA to remove them (and OTIS) too."
}

# ── Go ───────────────────────────────────────────────────────────────────────

case $MODE in
check)
  check
  exit $?
  ;;
uninstall)
  uninstall
  exit 0
  ;;
esac
first=yes
launcher_exists && first=no
case $MODE in
docker) install_docker ;;
native) install_native ;;
esac
install_launcher
connect_agents

echo
say "OTIS is ready at $URL: press Super + Space and type OTIS"
note "Projects: $DATA/projects"
if [[ $MODE == native ]]; then
  note "Service:  systemctl --user status otis   (also: restart, stop, start)"
  note "Logs:     journalctl --user -u otis"
else
  note "Status:   docker compose ps     Logs: docker compose logs otis"
fi
note "Update:   run this installer again. Check: $REPO/install.sh --check"
[[ $first == yes ]] && open_otis
exit 0
