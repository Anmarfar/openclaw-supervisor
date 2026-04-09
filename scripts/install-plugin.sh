#!/usr/bin/env bash
set -euo pipefail

for cmd in cp mkdir; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    printf 'required command not found: %s\n' "$cmd" >&2
    exit 1
  fi
done

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_DIR=${REPO_DIR:-$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)}
TARGET_DIR=${PLUGIN_TARGET_DIR:-${TARGET_DIR:-"$HOME/.openclaw/workspace/.openclaw/plugins/supervisor"}}

DEPLOY_FILES=(
  index.js
  ArbitrationPolicy.js
  DecisionLogStore.js
  SupervisorOrchestrator.js
  openclaw.plugin.json
  package.json
)

for file in "${DEPLOY_FILES[@]}"; do
  if [[ ! -f "$REPO_DIR/$file" ]]; then
    printf 'missing required deployable file: %s\n' "$REPO_DIR/$file" >&2
    exit 1
  fi
done

mkdir -p "$TARGET_DIR"

for file in "${DEPLOY_FILES[@]}"; do
  cp "$REPO_DIR/$file" "$TARGET_DIR/$file"
done

printf 'installed plugin files to %s\n' "$TARGET_DIR"
printf 'installed files:\n'
printf ' - %s\n' "${DEPLOY_FILES[@]}"
