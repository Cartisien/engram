#!/usr/bin/env bash
set -u

RESULT_DIR="${1:-artifacts/checks}"
mkdir -p "$RESULT_DIR"

run_cmd() {
  local name="$1"
  shift
  local logfile="$RESULT_DIR/${name}.log"
  echo "== ${name} ==" | tee "$logfile"
  if "$@" >>"$logfile" 2>&1; then
    echo "PASS" | tee -a "$logfile"
    return 0
  else
    echo "FAIL" | tee -a "$logfile"
    return 1
  fi
}

# Update these commands to match the repo.
run_cmd lint pnpm lint || true
run_cmd typecheck pnpm typecheck || true
run_cmd test pnpm test || true
run_cmd build pnpm build || true

# Optional UI/e2e checks; uncomment if the repo supports them.
# run_cmd playwright pnpm playwright test || true

echo "Logs written to $RESULT_DIR"
