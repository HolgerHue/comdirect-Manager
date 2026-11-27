# shellcheck shell=sh
# Keel: Identität dieser Sitzung (project-state.md "scripts/keel-session-pid.sh"). Nur einbinden (source).
# Ergebnis: "<PID>-<Startzeit>" des Elternprozesses, damit eine wiederverwendete PID keine tote Sitzung vortäuscht.
# Claude Code liefert Hooks zusätzlich session_id; scripts/keel-stop-hook nutzt diese, wenn vorhanden.
keel_session_pid() {
  pid="${KEEL_SESSION_PID:-$PPID}"
  start="$(ps -o lstart= -p "$pid" 2>/dev/null | tr -s ' ' '_' )"
  printf '%s-%s\n' "$pid" "${start:-unknown}"
}
