#!/usr/bin/env bash
# Pulls new commits from GitHub and restarts the bot on them. Started by
# run.sh when .env has AUTO_UPDATE=true; not meant to be run by hand.
#
# Safe by construction:
#   - fast-forward / clean sync with origin
#   - builds into dist-next/ and swaps it in only if the build succeeds, so a
#     broken commit never replaces a working dist/
#   - on any build failure it resets to the commit that was running and carries on
set -uo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
LOG_FILE="${LOG_FILE:-$HOME/whatsapp-bot-logs/bot.log}"
BRANCH="${AUTO_UPDATE_BRANCH:-main}"
INTERVAL="${AUTO_UPDATE_INTERVAL_SEC:-60}"
RESTART_FLAG="$REPO_DIR/.restart-requested"

# Avoid git hanging on terminal credential prompts in background
export GIT_TERMINAL_PROMPT=0

# Ensure git trusts the repository directory in proot
git config --global --add safe.directory "$REPO_DIR" 2>/dev/null || true

failed_commit=""

cd "$REPO_DIR"
log() { echo "[autoupdate] $(date -u +%FT%TZ) $*" >> "$LOG_FILE"; }

install_deps() {
  if command -v pnpm >/dev/null 2>&1; then
    log "installing via pnpm..."
    NODE_ENV=development pnpm install --prod=false --frozen-lockfile=false >>"$LOG_FILE" 2>&1
  else
    log "installing via npm..."
    NODE_ENV=development npm install --include=dev --no-audit --no-fund >>"$LOG_FILE" 2>&1
  fi
}

restart_bot() {
  touch "$RESTART_FLAG"

  # Kill exact PID recorded by run.sh if available
  local bot_pid=""
  if [ -f "$REPO_DIR/.bot.pid" ]; then
    bot_pid="$(cat "$REPO_DIR/.bot.pid" 2>/dev/null || true)"
  fi

  if [ -n "$bot_pid" ]; then
    log "stopping bot process (PID: $bot_pid)..."
    kill -TERM "$bot_pid" 2>/dev/null || true
    for _ in $(seq 1 5); do
      kill -0 "$bot_pid" 2>/dev/null || break
      sleep 1
    done
    kill -9 "$bot_pid" 2>/dev/null || true
  else
    log "stopping bot process via pkill..."
    pkill -TERM -f "node dist/bot.js" 2>/dev/null || true
  fi
}

update_once() {
  local fetch_err
  if ! fetch_err="$(git fetch origin "$BRANCH" 2>&1)"; then
    log "fetch failed (network or credentials): $fetch_err"
    return
  fi

  local old new deps_changed=0
  old="$(git rev-parse HEAD 2>/dev/null)" || { log "git rev-parse HEAD failed"; return; }
  new="$(git rev-parse "origin/$BRANCH" 2>/dev/null)" || { log "git rev-parse origin/$BRANCH failed"; return; }
  [ "$old" = "$new" ] && return
  [ "$new" = "$failed_commit" ] && return

  # Check if package dependencies changed between commits
  git diff --quiet "$old" "$new" -- package.json package-lock.json pnpm-lock.yaml 2>/dev/null || deps_changed=1

  log "updating ${old:0:7} -> ${new:0:7}$([ $deps_changed = 1 ] && echo ' (dependencies changed)')"

  # Discard any local modifications to tracked files (e.g. package-lock.json touched by npm)
  git reset -q --hard HEAD 2>/dev/null || true

  # If checkout diverged or fast-forward is blocked, sync to origin/$BRANCH
  if ! git merge-base --is-ancestor "$old" "$new"; then
    log "local checkout diverged; resetting to origin/$BRANCH"
    if ! git reset -q --hard "$new" >>"$LOG_FILE" 2>&1; then
      log "git reset to origin/$BRANCH failed"
      return
    fi
  else
    local merge_err
    if ! merge_err="$(git merge -q --ff-only "$new" 2>&1)"; then
      log "fast-forward failed ($merge_err); resetting to origin/$BRANCH"
      git reset -q --hard "$new" >>"$LOG_FILE" 2>&1 || { log "hard reset failed"; return; }
    fi
  fi

  # Install deps if package files changed or tsc binary is absent
  if [ $deps_changed = 1 ] || [ ! -f "$REPO_DIR/node_modules/.bin/tsc" ]; then
    if ! install_deps; then
      rollback "$old" "dependency install failed"
      return
    fi
  fi

  rm -rf dist-next
  log "building next release..."

  local tsc_bin="$REPO_DIR/node_modules/.bin/tsc"
  local build_ok=0
  if [ -x "$tsc_bin" ]; then
    NODE_OPTIONS="--max-old-space-size=1024" "$tsc_bin" --outDir dist-next >>"$LOG_FILE" 2>&1 && build_ok=1
  elif command -v npx >/dev/null 2>&1; then
    NODE_OPTIONS="--max-old-space-size=1024" npx --no-install tsc --outDir dist-next >>"$LOG_FILE" 2>&1 && build_ok=1
  fi

  if [ "$build_ok" -ne 1 ]; then
    rm -rf dist-next
    rollback "$old" "build failed"
    return
  fi

  # Atomic swap of dist
  rm -rf dist-old
  if [ -d dist ]; then
    mv dist dist-old
  fi
  mv dist-next dist
  rm -rf dist-old
  log "built ${new:0:7}; restarting the bot"

  restart_bot
}

rollback() {
  failed_commit="$(git rev-parse HEAD 2>/dev/null || echo "")"
  log "$2; rolling back to ${1:0:7}; skipping ${failed_commit:0:7} until a newer commit lands"
  git reset -q --hard "$1" 2>/dev/null || true
  if [ -d dist-old ]; then
    rm -rf dist
    mv dist-old dist
  fi
  git diff --quiet HEAD@{1} HEAD -- package.json package-lock.json pnpm-lock.yaml 2>/dev/null \
    || install_deps \
    || log "dependency reinstall during rollback failed - check the log"
}

log "watching origin/$BRANCH every ${INTERVAL}s"
while true; do
  update_once
  sleep "$INTERVAL"
done
