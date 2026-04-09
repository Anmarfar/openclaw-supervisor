#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_DIR=${REPO_DIR:-$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)}
TARGET_DIR=${PLUGIN_TARGET_DIR:-${TARGET_DIR:-"$HOME/.openclaw/workspace/.openclaw/plugins/supervisor"}}

required=(openclaw.plugin.json index.js ArbitrationPolicy.js DecisionLogStore.js SupervisorOrchestrator.js package.json)

file_failures=0
for file in "${required[@]}"; do
  if [[ ! -f "$TARGET_DIR/$file" ]]; then
    printf 'FAIL file missing: %s\n' "$TARGET_DIR/$file" >&2
    (( file_failures++ )) || true
  else
    printf 'ok   %s\n' "$file"
  fi
done

if (( file_failures > 0 )); then
  printf 'FAIL: %d required file(s) missing in %s\n' "$file_failures" "$TARGET_DIR" >&2
  exit 1
fi
printf 'PASS: all required files present in %s\n' "$TARGET_DIR"

if command -v openclaw >/dev/null 2>&1; then
  plugin_enabled=$(openclaw config get plugins.entries.supervisor.enabled 2>/dev/null | awk 'NF{line=$0} END{print line}')
  gate_enabled=$(openclaw config get plugins.entries.supervisor.config.gateEnabled 2>/dev/null | awk 'NF{line=$0} END{print line}')

  if [[ -n "$plugin_enabled" ]]; then
    printf 'plugin enabled state: %s\n' "$plugin_enabled"
  else
    printf 'plugin enabled state: not readable; merge openclaw.json.example if needed\n'
  fi

  if [[ -n "$gate_enabled" ]]; then
    printf 'gate enabled state: %s\n' "$gate_enabled"
  else
    printf 'gate enabled state: not readable; merge openclaw.json.example if needed\n'
  fi
else
  printf 'openclaw CLI not found; config verification skipped\n'
fi

gateway_ok=true
if command -v systemctl >/dev/null 2>&1; then
  if systemctl --user is-active openclaw-gateway.service >/dev/null 2>&1; then
    printf 'ok   gateway service: active\n'
  else
    printf 'FAIL gateway service: inactive or unavailable\n'
    gateway_ok=false
  fi
else
  printf 'skip gateway service check (systemctl not available)\n'
fi

if [[ "$gateway_ok" == true ]]; then
  printf 'PASS: verify complete\n'
else
  printf 'WARN: verify complete with non-fatal issues (see above)\n'
fi
