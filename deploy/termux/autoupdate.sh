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

update_once() {
  git fetch -q origin "$BRANCH" 2>>"$LOG_FILE" || { log "fetch failed (network or credentials)"; return; }
  local old new deps_changed=0
  old="$(git rev-parse HEAD)"
  new="$(git rev-parse "origin/$BRANCH")"
  [ "$old" = "$new" ] && return
  [ "$new" = "$failed_commit" ] && return

  if ! git merge-base --is-ancestor "$old" "$new"; then
    log "local checkout has diverged from origin/$BRANCH; not updating"
    return
  fi
  git diff --quiet "$old" "$new" -- package.json package-lock.json || deps_changed=1

  log "updating ${old:0:7} -> ${new:0:7}$([ $deps_changed = 1 ] && echo ' (dependencies changed)')"
  git merge -q --ff-only "$new" 2>>"$LOG_FILE" || { log "fast-forward failed"; return; }

  if [ $deps_changed = 1 ] && ! npm ci --no-audit --no-fund >>"$LOG_FILE" 2>&1; then
    rollback "$old" "npm ci failed"; return
  fi
  rm -rf dist-next
  if ! npx tsc --outDir dist-next >>"$LOG_FILE" 2>&1; then
    rm -rf dist-next
    rollback "$old" "build failed"; return
  fi

  rm -rf dist-old && mv dist dist-old && mv dist-next dist && rm -rf dist-old
  log "built ${new:0:7}; restarting the bot"
  # run.sh treats a clean exit as "stop" unless this flag is present.
  touch "$RESTART_FLAG"
  pkill -TERM -f "node dist/bot.js" || true
}

rollback() {
  failed_commit="$(git rev-parse HEAD)"
  log "$2; rolling back to ${1:0:7}; skipping ${failed_commit:0:7} until a newer commit lands"
  git reset -q --hard "$1"
  # Put back the node_modules that match the code still running.
  git diff --quiet HEAD@{1} HEAD -- package.json package-lock.json \
    || npm ci --no-audit --no-fund >>"$LOG_FILE" 2>&1 \
    || log "npm ci during rollback failed - check the log"
}

log "watching origin/$BRANCH every ${INTERVAL}s"
while sleep "$INTERVAL"; do
  update_once
done
