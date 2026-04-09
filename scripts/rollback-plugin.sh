#!/usr/bin/env bash
set -euo pipefail

if ! command -v openclaw >/dev/null 2>&1; then
  printf 'openclaw CLI is required for rollback\n' >&2
  exit 1
fi

openclaw config set plugins.entries.supervisor.enabled false
openclaw config set plugins.entries.supervisor.config.gateEnabled false

if command -v systemctl >/dev/null 2>&1; then
  systemctl --user restart openclaw-gateway.service
fi

enabled=$(openclaw config get plugins.entries.supervisor.enabled 2>/dev/null | awk 'NF{line=$0} END{print line}')
gate=$(openclaw config get plugins.entries.supervisor.config.gateEnabled 2>/dev/null | awk 'NF{line=$0} END{print line}')

printf 'plugin enabled state after rollback: %s\n' "${enabled:-unknown}"
printf 'gate enabled state after rollback: %s\n' "${gate:-unknown}"

if [[ "$enabled" != "false" || "$gate" != "false" ]]; then
  printf 'rollback verification failed\n' >&2
  exit 1
fi

printf 'rollback complete\n'
