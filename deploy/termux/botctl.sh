#!/data/data/com.termux/files/usr/bin/bash
# Control the bot from TERMUX (not from inside Debian).
#
#   bash botctl.sh install      create ~/botctl.sh (points here) + set up auto-start on boot
#   bash ~/botctl.sh start      start in the background (tmux session "wabot")
#   bash ~/botctl.sh stop
#   bash ~/botctl.sh restart    e.g. after `git pull` + build
#   bash ~/botctl.sh update     pull from git, install, build, and restart
#   bash ~/botctl.sh status
#   bash ~/botctl.sh logs       follow the log (Ctrl-C to stop following; the bot keeps running)
#   bash ~/botctl.sh attach     live console (detach: Ctrl-b then d)
set -euo pipefail

DISTRO="${DISTRO:-debian}"
REPO="${REPO:-/root/Whatsapp-bot}"
SESSION="wabot"
# proot-distro moved the rootfs: containers/<distro>/rootfs in newer releases,
# installed-rootfs/<distro> in older ones. Use whichever exists.
ROOTFS=""
for dir in "$PREFIX/var/lib/proot-distro/containers/$DISTRO/rootfs" \
           "$PREFIX/var/lib/proot-distro/installed-rootfs/$DISTRO"; do
  if [ -d "$dir" ]; then ROOTFS="$dir"; break; fi
done
[ -n "$ROOTFS" ] || { echo "Debian rootfs not found - run: proot-distro install $DISTRO" >&2; exit 1; }
LOG="$ROOTFS/root/whatsapp-bot-logs/bot.log"

need() { command -v "$1" >/dev/null || { echo "Missing $1: pkg install $2" >&2; exit 1; }; }
need tmux tmux
need proot-distro proot-distro

running() { tmux has-session -t "$SESSION" 2>/dev/null; }

start() {
  if running; then echo "already running (bash ~/botctl.sh attach)"; return; fi
  # Keep the CPU awake with the screen off. Without this Android dozes Termux
  # and the WhatsApp socket drops within minutes.
  termux-wake-lock 2>/dev/null || true
  tmux new-session -d -s "$SESSION" \
    "proot-distro login $DISTRO -- bash $REPO/deploy/termux/run.sh"
  echo "started. logs: bash ~/botctl.sh logs"
}

stop() {
  if ! running; then echo "not running"; return; fi
  tmux send-keys -t "$SESSION" C-c
  for _ in $(seq 1 15); do running || break; sleep 1; done
  running && tmux kill-session -t "$SESSION"
  echo "stopped."
}

install() {
  # A pointer, not a copy: fixes to this script reach the phone through
  # git pull / auto-update without re-running install.
  printf '#!/data/data/com.termux/files/usr/bin/bash\nexec bash "%s" "$@"\n' \
    "$ROOTFS$REPO/deploy/termux/botctl.sh" > "$HOME/botctl.sh"
  chmod +x "$HOME/botctl.sh"
  mkdir -p "$HOME/.termux/boot"
  cat > "$HOME/.termux/boot/start-wabot" <<'EOF'
#!/data/data/com.termux/files/usr/bin/sh
# Output goes to ~/boot.log: a boot that fails has no terminal to show it.
exec >> "$HOME/boot.log" 2>&1
echo "=== boot $(date)"
termux-wake-lock
sleep 20   # let networking come up after boot
bash "$HOME/botctl.sh" start
echo "=== done $(date)"
EOF
  chmod +x "$HOME/.termux/boot/start-wabot"
  echo "installed ~/botctl.sh and ~/.termux/boot/start-wabot"
  echo "auto-start on boot needs the Termux:Boot app (F-Droid), opened once."
}

update() {
  echo "Updating repository from GitHub and rebuilding..."
  proot-distro login "$DISTRO" -- bash -c "cd '$REPO' && git config --global --add safe.directory '$REPO' 2>/dev/null || true && git fetch origin main && git reset --hard origin/main && NODE_ENV=development npm install --include=dev --no-audit --no-fund && npm run build"
  restart
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  restart) stop; sleep 2; start ;;
  update) update ;;
  status) running && echo "running" || echo "stopped" ;;
  logs) tail -n 100 -F "$LOG" ;;
  attach) tmux attach -t "$SESSION" ;;
  install) install ;;
  *) sed -n '2,12p' "$0"; exit 1 ;;
esac
