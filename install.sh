#!/usr/bin/env bash
# OTIS installer for Omarchy (and other Linux desktops).
#
#   ./install.sh              run OTIS natively, as a systemd user service (needs Node 20+)
#   ./install.sh --docker     run OTIS in Docker instead
#   ./install.sh --uninstall  remove the service, container, launcher and AI tools (keeps your projects)
#
# Either way OTIS runs at http://localhost:6847, starts when you log in, and
# gets an "OTIS" launcher (Super + Space on Omarchy). Your projects live in
# ~/.local/share/otis. To update: git pull, then run this again.
#
# Options: --port N      use another port
#          --no-mcp      don't register OTIS's AI tools with Claude Code

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}/otis"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT="$UNIT_DIR/otis.service"
APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
THEMES="${XDG_CONFIG_HOME:-$HOME/.config}/omarchy/themes"
PORT=6847
MODE=native
MCP=yes
NODE=

say() { printf '\e[32m==>\e[0m %s\n' "$*"; }
note() { printf '    %s\n' "$*"; }
die() {
  printf '\e[31mError:\e[0m %s\n' "$*" >&2
  exit 1
}

while (($#)); do
  case $1 in
  --docker) MODE=docker ;;
  --uninstall) MODE=uninstall ;;
  --port)
    PORT=${2:-}
    shift
    ;;
  --no-mcp) MCP=no ;;
  -h | --help)
    sed -n '2,/^[^#]/{/^#/s/^# \{0,1\}//p}' "$0"
    exit 0
    ;;
  *) die "Unknown option $1 (try --help)" ;;
  esac
  shift
done
[[ $PORT =~ ^[0-9]+$ ]] || die "--port needs a number"
URL="http://localhost:$PORT"

# ── Helpers ──────────────────────────────────────────────────────────────────

docker_ok() { command -v docker >/dev/null && docker info >/dev/null 2>&1; }
has_container() { docker_ok && docker container inspect otis >/dev/null 2>&1; }
port_busy() { ss -Hltn "sport = :$PORT" 2>/dev/null | grep -q .; }

wait_for_otis() {
  for _ in $(seq 1 30); do
    curl -fsS -m 1 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && return 0
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

# Lets Claude Code draw in OTIS (see README → "Let an AI draw in OTIS").
register_mcp() {
  [[ $MCP == yes ]] || return 0
  if ! command -v claude >/dev/null; then
    note "To let an AI assistant draw in OTIS, add its MCP server: see \"Let an AI draw in OTIS\" in the README."
    return 0
  fi
  claude mcp remove otis --scope user >/dev/null 2>&1 || true
  if [[ $MODE == docker ]]; then
    claude mcp add --scope user otis -- docker exec -i otis node mcp.js >/dev/null
  elif [[ $PORT == 6847 ]]; then
    claude mcp add --scope user otis -- "$NODE" "$REPO/mcp.js" >/dev/null
  else
    claude mcp add --scope user otis -e "OTIS_URL=http://127.0.0.1:$PORT" -- "$NODE" "$REPO/mcp.js" >/dev/null
  fi
  say "Gave Claude Code the OTIS tools (undo with: claude mcp remove otis --scope user)"
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
  if command -v claude >/dev/null && claude mcp remove otis --scope user >/dev/null 2>&1; then
    say "Removed the OTIS tools from Claude Code"
  fi
  say "Your projects are still in $DATA. Delete that folder to remove them too."
}

# ── Go ───────────────────────────────────────────────────────────────────────

case $MODE in
uninstall)
  uninstall
  exit 0
  ;;
docker) install_docker ;;
native) install_native ;;
esac
install_launcher
register_mcp

echo
say "OTIS is ready at $URL"
note "Projects: $DATA"
if [[ $MODE == native ]]; then
  note "Service:  systemctl --user status otis   (also: restart, stop, start)"
  note "Logs:     journalctl --user -u otis"
  note "Update:   git pull && ./install.sh"
else
  note "Status:   docker compose ps     Logs: docker compose logs otis"
  note "Update:   git pull && ./install.sh --docker"
fi
