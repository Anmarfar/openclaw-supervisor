#!/usr/bin/env bash
set -euo pipefail

STATE_ROOT=${OPENCLAW_STATE_ROOT:-"$HOME/.openclaw"}
RUNS_ROOT="$STATE_ROOT/supervisor/runs"
RUN_ID=${RUN_ID:-"smoke-$(date +%Y%m%d-%H%M%S)"}
GATEWAY_URL=${OPENCLAW_GATEWAY_URL:-"http://127.0.0.1:18789/tools/invoke"}

if ! command -v python3 >/dev/null 2>&1; then
  printf 'python3 is required for the smoke test\n' >&2
  exit 1
fi

if ! command -v openclaw >/dev/null 2>&1; then
  printf 'openclaw CLI is required for the smoke test\n' >&2
  exit 1
fi

if command -v systemctl >/dev/null 2>&1; then
  if ! systemctl --user is-active openclaw-gateway.service >/dev/null 2>&1; then
    printf 'gateway service is not active\n' >&2
    exit 1
  fi
fi

plugin_enabled=$(openclaw config get plugins.entries.supervisor-phase1.enabled 2>/dev/null | awk 'NF{line=$0} END{print line}')
gate_enabled=$(openclaw config get plugins.entries.supervisor-phase1.config.gateEnabled 2>/dev/null | awk 'NF{line=$0} END{print line}')

if [[ "$plugin_enabled" != "true" ]]; then
  printf 'plugin is not enabled\n' >&2
  exit 1
fi

if [[ "$gate_enabled" != "true" ]]; then
  printf 'plugin gate is not enabled\n' >&2
  exit 1
fi

if [[ -z "${OPENCLAW_GATEWAY_TOKEN:-}" ]]; then
  local_config="$HOME/.openclaw/openclaw.json"
  if [[ -f "$local_config" ]]; then
    OPENCLAW_GATEWAY_TOKEN=$(python3 -c "
import json, sys
try:
    d = json.load(open(sys.argv[1]))
    t = d.get('gateway', {}).get('auth', {}).get('token', '')
    if t:
        print(t)
except Exception:
    pass
" "$local_config" 2>/dev/null || true)
  fi
fi

if [[ -z "${OPENCLAW_GATEWAY_TOKEN:-}" ]]; then
  printf 'set OPENCLAW_GATEWAY_TOKEN to a valid local gateway bearer token before running the smoke test\n' >&2
  printf 'on this node, try: OPENCLAW_GATEWAY_TOKEN=$(python3 -c "import json; d=json.load(open(\"$HOME/.openclaw/openclaw.json\")); print(d[\"gateway\"][\"auth\"][\"token\"])")\n' >&2
  exit 1
fi

export OPENCLAW_GATEWAY_TOKEN RUN_ID GATEWAY_URL

python3 - <<'PY'
import json
import os
import sys
import urllib.request


def invoke(tool, args):
    payload = {"tool": tool, "args": args}
    request = urllib.request.Request(
        os.environ["GATEWAY_URL"],
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {os.environ['OPENCLAW_GATEWAY_TOKEN']}",
            "Content-Type": "application/json",
            "x-openclaw-scopes": "agent",
        },
        method="POST",
    )
    with urllib.request.urlopen(request) as response:
        return json.loads(response.read().decode())

run_id = os.environ["RUN_ID"]
run_result = invoke(
    "supervisor_run",
    {
        "task": "Return this exact sentence: READY because the smoke test path is healthy.",
        "runId": run_id,
        "importanceLevel": "medium",
    },
)
status_result = invoke("supervisor_status", {"limit": 3})

final_status = run_result.get("result", {}).get("details", {}).get("finalStatus")
if final_status != "success":
    print(f"supervisor_run finalStatus was {final_status!r}, expected 'success'", file=sys.stderr)
    sys.exit(1)

if not status_result.get("ok"):
    print("supervisor_status did not return ok=true", file=sys.stderr)
    sys.exit(1)

print(f"runId: {run_id}")
print(f"finalStatus: {final_status}")
print("statusTool: ok")
PY

EVENTS_FILE="$RUNS_ROOT/$RUN_ID/events.jsonl"
FINAL_FILE="$RUNS_ROOT/$RUN_ID/final.json"

if [[ ! -f "$EVENTS_FILE" ]]; then
  printf 'missing artifact: %s\n' "$EVENTS_FILE" >&2
  exit 1
fi

if [[ ! -f "$FINAL_FILE" ]]; then
  printf 'missing artifact: %s\n' "$FINAL_FILE" >&2
  exit 1
fi

printf 'artifacts: ok\n'
printf 'events: %s\n' "$EVENTS_FILE"
printf 'final: %s\n' "$FINAL_FILE"
printf 'smoke test: pass\n'
