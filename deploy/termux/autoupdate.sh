#!/usr/bin/env bash
# Pulls new commits from GitHub and restarts the bot on them. Started by
# run.sh when .env has AUTO_UPDATE=true; not meant to be run by hand.
#
# Safe by construction:
#   - fast-forward only: a phone checkout with local commits is left alone
#   - builds into dist-next/ and swaps it in only if the build succeeds, so a
#     broken commit never replaces a working dist/
#   - on any failure it resets to the commit that was running and carries on
set -uo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
LOG_FILE="${LOG_FILE:-$HOME/whatsapp-bot-logs/bot.log}"
BRANCH="${AUTO_UPDATE_BRANCH:-main}"
INTERVAL="${AUTO_UPDATE_INTERVAL_SEC:-300}"
RESTART_FLAG="$REPO_DIR/.restart-requested"

# A commit that failed to build is not retried every interval (that would be
# a phone-sized tsc run every 5 minutes); it is skipped until origin moves on.
failed_commit=""

cd "$REPO_DIR"
log() { echo "[autoupdate] $(date -u +%FT%TZ) $*" >> "$LOG_FILE"; }

install_deps() {
  if command -v pnpm >/dev/null 2>&1; then
    pnpm install --frozen-lockfile=false >>"$LOG_FILE" 2>&1
  elif npm ci --no-audit --no-fund >>"$LOG_FILE" 2>&1; then
    return 0
  else
    log "npm ci failed; attempting npm install fallback"
    npm install --no-audit --no-fund >>"$LOG_FILE" 2>&1
  fi
}

update_once() {
  local fetch_err
  if ! fetch_err="$(git fetch origin "$BRANCH" 2>&1)"; then
    log "fetch failed (network or credentials): $fetch_err"
    return
  fi

  local old new deps_changed=0
  old="$(git rev-parse HEAD)"
  new="$(git rev-parse "origin/$BRANCH")"
  [ "$old" = "$new" ] && return
  [ "$new" = "$failed_commit" ] && return

  if ! git merge-base --is-ancestor "$old" "$new"; then
    log "local checkout has diverged from origin/$BRANCH; not updating"
    return
  fi

  git diff --quiet "$old" "$new" -- package.json package-lock.json pnpm-lock.yaml || deps_changed=1

  log "updating ${old:0:7} -> ${new:0:7}$([ $deps_changed = 1 ] && echo ' (dependencies changed)')"

  # Reset any locally modified lockfiles that would block fast-forward merge
  git checkout -- package-lock.json pnpm-lock.yaml 2>/dev/null || true

  local merge_err
  if ! merge_err="$(git merge -q --ff-only "$new" 2>&1)"; then
    log "fast-forward failed: $merge_err"
    return
  fi

  if [ $deps_changed = 1 ]; then
    log "installing dependencies..."
    if ! install_deps; then
      rollback "$old" "dependency install failed"
      return
    fi
  fi

  rm -rf dist-next
  log "building next release..."
  if ! npx tsc --outDir dist-next >>"$LOG_FILE" 2>&1; then
    rm -rf dist-next
    rollback "$old" "build failed"
    return
  fi

  rm -rf dist-old && mv dist dist-old && mv dist-next dist && rm -rf dist-old
  log "built ${new:0:7}; restarting the bot"
  # run.sh treats this flag as an immediate reload instruction.
  touch "$RESTART_FLAG"
  pkill -TERM -f "node dist/bot.js" || true
}

rollback() {
  failed_commit="$(git rev-parse HEAD)"
  log "$2; rolling back to ${1:0:7}; skipping ${failed_commit:0:7} until a newer commit lands"
  git reset -q --hard "$1"
  git checkout -- package-lock.json pnpm-lock.yaml 2>/dev/null || true
  git diff --quiet HEAD@{1} HEAD -- package.json package-lock.json pnpm-lock.yaml \
    || npm install --no-audit --no-fund >>"$LOG_FILE" 2>&1 \
    || log "dependency reinstall during rollback failed - check the log"
}

log "watching origin/$BRANCH every ${INTERVAL}s"
while sleep "$INTERVAL"; do
  update_once
done
