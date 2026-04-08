#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_DIR=${REPO_DIR:-$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)}

cat "$REPO_DIR/openclaw.json.example"
