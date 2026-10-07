#!/usr/bin/env bash
# DecisionX launcher for Omarchy (Hyprland + uwsm).
#
# Runs start_dev.sh in the background, waits until the backend and frontend
# answer, then opens the UI as a web app window. Re-running it while the
# servers are up just opens another window.
#
#   decisionx            open (start servers if needed, then open the window)
#   decisionx start      start servers only
#   decisionx stop       stop servers
#   decisionx restart    stop, then open
#   decisionx status     show whether the servers are running
#   decisionx logs       follow the server log
#   decisionx install    add `decisionx` to ~/.local/bin and an app-launcher entry
#   decisionx uninstall  remove both
set -euo pipefail

ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
STATE="${XDG_STATE_HOME:-$HOME/.local/state}/decisionx"
LOG="$STATE/server.log"
PIDFILE="$STATE/server.pid"
UI_URL="http://localhost:3000"
API_URL="http://127.0.0.1:8001/api/health"
START_TIMEOUT=180 # first run installs Python + npm deps

BIN_LINK="$HOME/.local/bin/decisionx"
DESKTOP_FILE="$HOME/.local/share/applications/DecisionX.desktop"

# Launched from the app launcher, PATH may not include mise-managed node/npm.
[ -d "$HOME/.local/share/mise/shims" ] && export PATH="$HOME/.local/share/mise/shims:$PATH"

mkdir -p "$STATE"

notify() { command -v notify-send >/dev/null && notify-send -a DecisionX -i "$ROOT/images/decisionx-icon.svg" "$@" || echo "$*"; }

server_pid() {
  [ -f "$PIDFILE" ] || return 1
  local pid
  pid=$(<"$PIDFILE")
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then echo "$pid"; return 0; fi
  rm -f "$PIDFILE"
  return 1
}

healthy() {
  curl -fsS -m 2 "$API_URL" >/dev/null 2>&1 && curl -fsS -m 5 -o /dev/null "$UI_URL" 2>/dev/null
}

port_busy() { ss -ltnH "sport = :$1" 2>/dev/null | grep -q .; }

start() {
  if server_pid >/dev/null; then
    healthy && return 0
  elif healthy; then
    return 0 # started some other way (e.g. ./start_dev.sh in a terminal); reuse it
  else
    for port in 3000 8001; do
      if port_busy "$port"; then
        notify -u critical "DecisionX can't start" "Port $port is already in use by another program."
        exit 1
      fi
    done
    notify "DecisionX" "Starting servers…"
    : >"$LOG"
    # setsid: own process group, so `stop` can take down uvicorn + next together,
    # and the servers outlive the launcher that started them.
    setsid bash "$ROOT/start_dev.sh" >>"$LOG" 2>&1 </dev/null &
    echo $! >"$PIDFILE"
  fi

  local waited=0
  until healthy; do
    if ! server_pid >/dev/null; then
      notify -u critical "DecisionX failed to start" "$(tail -n 4 "$LOG")"
      exit 1
    fi
    if [ "$waited" -ge "$START_TIMEOUT" ]; then
      notify -u critical "DecisionX is taking too long" "Check the log: decisionx logs"
      exit 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
}

stop() {
  local pid
  if ! pid=$(server_pid); then
    echo "DecisionX is not running (or was started outside this launcher)."
    return 0
  fi
  kill -TERM -- "-$pid" 2>/dev/null || true
  for _ in $(seq 20); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.5
  done
  kill -KILL -- "-$pid" 2>/dev/null || true
  rm -f "$PIDFILE"
  notify "DecisionX" "Servers stopped."
}

open_ui() {
  start
  if command -v omarchy-launch-webapp >/dev/null; then
    omarchy-launch-webapp "$UI_URL"
  else
    xdg-open "$UI_URL" >/dev/null 2>&1 &
  fi
}

status() {
  local pid
  if pid=$(server_pid); then
    healthy && echo "running (pid group $pid) — $UI_URL" || echo "starting (pid group $pid)"
  elif healthy; then
    echo "running, but started outside this launcher — $UI_URL"
  else
    echo "stopped"
  fi
}

install_launcher() {
  mkdir -p "$(dirname "$BIN_LINK")" "$(dirname "$DESKTOP_FILE")"
  ln -sf "$ROOT/start_omarchy.sh" "$BIN_LINK"
  cat >"$DESKTOP_FILE" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=DecisionX
Comment=Multi-agent idea evaluation panel
Exec=$BIN_LINK open
Icon=$ROOT/images/decisionx-icon.svg
Terminal=false
StartupNotify=true
Categories=Development;
Actions=stop;restart;

[Desktop Action stop]
Name=Stop DecisionX servers
Exec=$BIN_LINK stop

[Desktop Action restart]
Name=Restart DecisionX
Exec=$BIN_LINK restart
EOF
  command -v update-desktop-database >/dev/null && update-desktop-database "$(dirname "$DESKTOP_FILE")" 2>/dev/null || true
  echo "Installed: $BIN_LINK and $DESKTOP_FILE"
  echo "Open it from the app launcher (Super+Space → DecisionX) or run: decisionx"
}

uninstall_launcher() {
  rm -f "$BIN_LINK" "$DESKTOP_FILE"
  echo "Removed the launcher. Servers, if running, are untouched (decisionx stop first)."
}

case "${1:-open}" in
  open) open_ui ;;
  start) start && echo "DecisionX is up — $UI_URL" ;;
  stop) stop ;;
  restart) stop; open_ui ;;
  status) status ;;
  logs) touch "$LOG"; exec tail -n 100 -f "$LOG" ;;
  install) install_launcher ;;
  uninstall) uninstall_launcher ;;
  *) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
