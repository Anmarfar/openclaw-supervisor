# OpenClaw Supervisor Operator Manual

## Scope

This manual covers safe operator use of OpenClaw Supervisor in a controlled rollout. It assumes the plugin is installed, the gateway is available, and operators need an exact procedure for enablement, verification, rollback, and incident handling.

## Safe Operating Policy

- Keep deployment operator-driven until your rollout criteria are satisfied.
- Do not expose gateway tokens or machine-local secrets in terminals, docs, or tickets.
- Preserve compatibility-bound names unless a migration plan has been approved.
- Prefer `scripts/run-smoke-test.sh` and `scripts/rollback-plugin.sh` over improvised live-node changes.

## Enable Procedure

1. Install or refresh the plugin files.

```bash
PLUGIN_TARGET_DIR="$HOME/.openclaw/workspace/.openclaw/plugins/supervisor" \
./scripts/install-plugin.sh
```

2. Merge the config block from `openclaw.json.example`.

3. Enable the plugin.

```bash
openclaw config set plugins.entries.supervisor.enabled true
openclaw config set plugins.entries.supervisor.config.gateEnabled true
```

4. Restart the gateway.

```bash
systemctl --user restart openclaw-gateway.service
```

5. Validate the installation.

```bash
./scripts/verify-install.sh
export OPENCLAW_GATEWAY_TOKEN="set-a-local-token-here"
./scripts/run-smoke-test.sh
```

## Disable / Rollback Procedure

Immediate rollback:

```bash
./scripts/rollback-plugin.sh
```

Manual rollback if needed:

```bash
openclaw config set plugins.entries.supervisor.enabled false
openclaw config set plugins.entries.supervisor.config.gateEnabled false
systemctl --user restart openclaw-gateway.service
```

Verify rollback:

```bash
openclaw config get plugins.entries.supervisor.enabled
openclaw config get plugins.entries.supervisor.config.gateEnabled
systemctl --user is-active openclaw-gateway.service
```

## Health Checks

- `systemctl --user is-active openclaw-gateway.service`
- `openclaw config get plugins.entries.supervisor.enabled`
- `openclaw config get plugins.entries.supervisor.config.gateEnabled`
- `./scripts/verify-install.sh`
- `./scripts/run-smoke-test.sh`

## Artifact Inspection

Artifacts live under `~/.openclaw/supervisor/runs/<runId>/`.

Inspect the final artifact:

```bash
python3 -m json.tool < ~/.openclaw/supervisor/runs/<runId>/final.json
```

Inspect the event stream:

```bash
sed -n '1,20p' ~/.openclaw/supervisor/runs/<runId>/events.jsonl
```

## Expected Outputs

- `success`: selected output accepted.
- `disagreement`: multiple successful workers disagreed and arbitration selected one.
- `lowConfidence`: selected output was accepted but flagged as weak.
- `error`: no usable output selected.
- `missing-final`: status tooling found a run directory but could not read a usable final artifact.

## Incident Steps

1. Confirm gateway status.
2. Confirm plugin enablement and gate state.
3. Run `./scripts/verify-install.sh`.
4. Run `./scripts/run-smoke-test.sh` if the gateway is healthy.
5. Inspect `events.jsonl` and `final.json` for the affected run.
6. Roll back if repeated failures or missing artifacts continue.

## Escalation Triggers

Escalate or roll back when any of the following occur:

- Repeated `error` or `missing-final` results in normal task traffic.
- `events.jsonl` or `final.json` is not written for a completed run.
- Gateway restart fails or the service remains inactive.
- Smoke test fails after a plugin update or config change.
