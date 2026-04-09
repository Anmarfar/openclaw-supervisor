# OpenClaw Supervisor Troubleshooting

## Plugin not loaded

Symptom: The tool is unavailable or the plugin does not appear to load.

Likely cause: The plugin files were not installed into the expected plugin directory, the manifest is missing, or the gateway was not restarted.

Exact checks:

```bash
./scripts/verify-install.sh
ls -1 "$HOME/.openclaw/workspace/.openclaw/plugins/supervisor"
systemctl --user is-active openclaw-gateway.service
```

Exact fix: Re-run `./scripts/install-plugin.sh`, confirm `openclaw.plugin.json` and `index.js` exist in the target path, then restart the gateway.

Rollback threshold: If the plugin still does not load after reinstall and restart, run `./scripts/rollback-plugin.sh`.

## Gateway inactive

Symptom: Smoke test or tool invocation fails before any plugin behavior occurs.

Likely cause: `openclaw-gateway.service` is stopped, failed, or not installed as a user service.

Exact checks:

```bash
systemctl --user is-active openclaw-gateway.service
systemctl --user status openclaw-gateway.service --no-pager
```

Exact fix: Start or restart the gateway and rerun `./scripts/verify-install.sh`.

Rollback threshold: If the gateway continues to fail after restart and this rollout is the suspected change, run `./scripts/rollback-plugin.sh`.

## gateEnabled=false

Symptom: `supervisor_run` returns a gate-off response.

Likely cause: The config gate is still disabled or an env override is forcing the gate off.

Exact checks:

```bash
openclaw config get plugins.entries.supervisor.enabled
openclaw config get plugins.entries.supervisor.config.gateEnabled
printenv OPENCLAW_SUPERVISOR_ENABLED
```

Exact fix: Set `plugins.entries.supervisor.enabled=true`, set `gateEnabled=true`, clear or correct any conflicting env override, and restart the gateway if needed.

Rollback threshold: Roll back if you cannot explain the gate behavior on a live node.

## Auth or token problem

Symptom: Tool invocation returns 401, 403, or an auth-related client error.

Likely cause: Missing or wrong gateway bearer token.

Exact checks:

```bash
printf '%s\n' "${OPENCLAW_GATEWAY_TOKEN:-unset}"
openclaw config get gateway.auth 2>&1 | grep mode
```

Exact fix: Use the same local gateway token your OpenClaw node expects for tool invocation. The smoke-test script attempts to acquire it automatically from the standard local config. If that does not work in your environment, export `OPENCLAW_GATEWAY_TOKEN` manually and rerun `./scripts/run-smoke-test.sh`.

Do not print the token value in logs or tickets.

Rollback threshold: Roll back only if 401 errors started immediately after this plugin rollout and the gateway was otherwise healthy before.

## Smoke-test exits with "set OPENCLAW_GATEWAY_TOKEN"

Symptom: `./scripts/run-smoke-test.sh` exits with the message `set OPENCLAW_GATEWAY_TOKEN to a valid local gateway bearer token before running the smoke test`.

Likely cause: Neither the `OPENCLAW_GATEWAY_TOKEN` env var is set, nor was the automatic local token acquisition successful.

Exact checks:

```bash
printf '%s\n' "${OPENCLAW_GATEWAY_TOKEN:-unset}"
openclaw config get gateway.auth 2>&1 | grep mode
```

Exact fix: Export a valid local gateway token for your node, then rerun the smoke test.

```bash
export OPENCLAW_GATEWAY_TOKEN="your-local-token"
./scripts/run-smoke-test.sh
```

Rollback threshold: None. This is a pre-flight check failure, not a plugin failure.

## events.jsonl missing

Symptom: A run appears to execute but `events.jsonl` is missing.

Likely cause: Artifact directory permissions are wrong or the run never reached artifact emission.

Exact checks:

```bash
ls -ld "$HOME/.openclaw" "$HOME/.openclaw/supervisor" "$HOME/.openclaw/supervisor/runs"
./scripts/run-smoke-test.sh
```

Exact fix: Correct permissions for the OpenClaw state directory, rerun the smoke test, and inspect gateway health.

Rollback threshold: Roll back after repeated missing `events.jsonl` results in normal traffic.

## final.json missing

Symptom: `events.jsonl` exists but `final.json` is missing.

Likely cause: The run did not finalize cleanly or artifact writes were interrupted.

Exact checks:

```bash
sed -n '1,40p' "$HOME/.openclaw/supervisor/runs/<runId>/events.jsonl"
ls -1 "$HOME/.openclaw/supervisor/runs/<runId>"
```

Exact fix: Check for `RunFinalized` in the event stream, rerun the smoke test, and inspect gateway stability.

Rollback threshold: Roll back if missing final artifacts occur repeatedly.

## unreadable final.json

Symptom: The status view reports `missing-final` or JSON parsing fails.

Likely cause: `final.json` is truncated or malformed.

Exact checks:

```bash
python3 -m json.tool < "$HOME/.openclaw/supervisor/runs/<runId>/final.json"
```

Exact fix: Inspect the corresponding `events.jsonl`, rerun the smoke test, and replace the plugin files from this repo if the installed copy is stale.

Rollback threshold: Roll back if new runs keep producing unreadable `final.json` files.

## missing-final status

Symptom: `supervisor_status` reports `missing-final`.

Likely cause: The run directory exists but `final.json` is missing or unreadable.

Exact checks:

```bash
python3 -m json.tool < "$HOME/.openclaw/supervisor/runs/<runId>/final.json"
sed -n '1,40p' "$HOME/.openclaw/supervisor/runs/<runId>/events.jsonl"
```

Exact fix: Restore a healthy plugin install, rerun the smoke test, and confirm new runs produce valid final artifacts.

Rollback threshold: Roll back if `missing-final` becomes persistent rather than isolated.

## Smoke test failure

Symptom: `./scripts/run-smoke-test.sh` exits non-zero.

Likely cause: Gateway inactive, plugin disabled, auth failure, or artifact write failure.

Exact checks:

```bash
./scripts/verify-install.sh
systemctl --user is-active openclaw-gateway.service
openclaw config get plugins.entries.supervisor.enabled
openclaw config get plugins.entries.supervisor.config.gateEnabled
```

Exact fix: Resolve the first failing prerequisite, then rerun the smoke test without changing unrelated settings.

Rollback threshold: Roll back if the smoke test still fails after a clean reinstall and gateway restart.

## Config mismatch

Symptom: The manifest, docs, and runtime behavior do not agree.

Likely cause: A repo change updated one surface but not the others.

Exact checks:

```bash
python3 -m json.tool < openclaw.plugin.json
sed -n '1,220p' README.md
node --test
```

Exact fix: Align `openclaw.plugin.json`, `README.md`, scripts, and runtime files in one change set, then rerun tests and the staged install verification.

Rollback threshold: Roll back if you detect a mismatch on a live deployment and cannot reconcile it immediately.
