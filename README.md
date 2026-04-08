# OpenClaw Supervisor

OpenClaw Supervisor gives OpenClaw a controlled multi-worker execution path with deterministic arbitration and durable run artifacts.

Instead of treating important tasks as a single opaque model turn, this plugin gives the operator a bounded lane where worker fanout, retry behavior, verification behavior, and final run artifacts are explicit and inspectable.

```text
caller -> supervisor_run -> worker fanout -> arbitration -> durable artifacts
```

The result is a safer operational path for supervised work inside OpenClaw:

- one or more worker attempts
- deterministic outcome selection
- bounded retry behavior
- optional verification on flagged single-worker runs
- durable `events.jsonl` and `final.json` artifacts for later inspection

## Warning

This repository is for controlled, operator-reviewed deployment.

- Do not enable this as broad autonomous default behavior without validating your own rollout path.
- Do not expose bearer tokens, gateway secrets, or local machine secrets in docs, scripts, shell history, or tickets.
- Preserve compatibility-bound identifiers unless you are intentionally planning and validating a migration.
- Use the included rollback path before making unrelated live-node changes during an incident.
- Treat this as an operational system, not just a code drop. Config, scripts, docs, and runtime behavior must stay aligned.

## For the Operator

Use OpenClaw Supervisor when you want a task to run through a controlled execution path rather than a single unchecked worker turn.

This is useful when you want:

- durable run evidence on disk
- deterministic arbitration across multiple worker outputs
- bounded retry on weak output or worker error
- a verification worker for flagged single-worker cases
- a safer rollout lane for supervised tasks on a live node

What changes after installation:

- OpenClaw exposes `supervisor_run`
- OpenClaw exposes `supervisor_status`
- each run writes artifacts under `~/.openclaw/supervisor/runs/<runId>/`
- the operator gets a repeatable smoke-test and rollback path

Commands you will actually use:

```bash
PLUGIN_TARGET_DIR="$HOME/.openclaw/workspace/.openclaw/plugins/supervisor-phase1" \
./scripts/install-plugin.sh

./scripts/print-config-example.sh

openclaw config set plugins.entries.supervisor-phase1.enabled true
openclaw config set plugins.entries.supervisor-phase1.config.gateEnabled true
systemctl --user restart openclaw-gateway.service

./scripts/verify-install.sh
./scripts/run-smoke-test.sh
./scripts/rollback-plugin.sh
```

Short practical workflow:

1. Install the plugin into the OpenClaw plugin directory.
2. Merge the config block from `openclaw.json.example`.
3. Enable the plugin and restart the gateway.
4. Run verification and the smoke test.
5. Use `supervisor_run` only through the controlled/operator-reviewed lane unless you have validated broader use.

## How It Works

```text
caller
  -> supervisor_run
    -> one or more worker attempts
      -> retry on weak output or worker error
        -> optional verification worker on flagged single-worker runs
          -> arbitration
            -> events.jsonl + final.json
              -> supervisor_status / operator inspection
```

At runtime, the plugin does four things:

1. Chooses a worker plan.
   Normal tasks can use a single worker or fan out to multiple workers depending on config and the request.

2. Runs bounded attempts.
   Workers can be retried within configured limits if they error or return weak output.

3. Computes a deterministic decision.
   Arbitration ranks candidate results deterministically and produces a stable selected outcome.

4. Writes inspectable artifacts.
   Every run produces append-first event history plus a final decision artifact so the operator can inspect what happened after the fact.

This is designed for operational clarity. The point is not just to get an answer. The point is to make the execution path bounded, inspectable, and replayable enough for controlled production use.

## Prerequisites

- A working OpenClaw installation.
- A running gateway service, typically `openclaw-gateway.service` in the user systemd session.
- Access to the OpenClaw plugin path, typically `~/.openclaw/workspace/.openclaw/plugins/`.
- Access to the OpenClaw state root, typically `~/.openclaw/`.
- Shell tools used by the included scripts: `bash`, `cp`, `mkdir`, `python3`, and optionally `systemctl`.
- A local OpenClaw config that can supply the gateway auth token from `~/.openclaw/openclaw.json` for smoke-test execution.

## Installation (for Operator or Agent)

This section is intentionally step-by-step and copy-pastable. It can be handed to Codex or Claude directly.

Follow these steps exactly. Do not improvise paths. Do not rename compatibility-bound identifiers such as `supervisor-phase1`, `supervisor_run`, `supervisor_status`, `events.jsonl`, or `final.json`.

### 1. Install the plugin files

```bash
cd /home/z2/repos/openclaw-supervisor
PLUGIN_TARGET_DIR="$HOME/.openclaw/workspace/.openclaw/plugins/supervisor-phase1" \
./scripts/install-plugin.sh
```

This copies only the deployable runtime files into the live plugin directory.

### 2. Print and review the example config

```bash
cd /home/z2/repos/openclaw-supervisor
./scripts/print-config-example.sh
```

The full example is also available at:

- `openclaw.json.example`

Merge the `plugins.entries.supervisor-phase1` block into your real OpenClaw config.

### 3. Enable the plugin entry

```bash
openclaw config set plugins.entries.supervisor-phase1.enabled true
openclaw config set plugins.entries.supervisor-phase1.config.gateEnabled true
```

If you are not ready to route real work through the plugin yet, keep `gateEnabled=false` and stop after installation.

### 4. Restart the gateway

```bash
systemctl --user restart openclaw-gateway.service
```

### 5. Verify the install

```bash
cd /home/z2/repos/openclaw-supervisor
./scripts/verify-install.sh
```

### 6. Run the smoke test

```bash
cd /home/z2/repos/openclaw-supervisor
./scripts/run-smoke-test.sh
```

If the smoke test cannot auto-acquire the local gateway token, see:

- [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)

## Post-Install Validation

Run both validation scripts after installation:

```bash
cd /home/z2/repos/openclaw-supervisor
./scripts/verify-install.sh
./scripts/run-smoke-test.sh
```

The smoke-test script first tries to read the local gateway token from:

- `~/.openclaw/openclaw.json`
- `gateway.auth.token`

If your config is not in the default location, export the token explicitly:

```bash
export OPENCLAW_GATEWAY_TOKEN=$(python3 -c "
import json
d = json.load(open('$HOME/.openclaw/openclaw.json'))
print(d['gateway']['auth']['token'])
")
./scripts/run-smoke-test.sh
```

Expected success signals:

- `verify-install.sh` reports `PASS: all required files present`
- `verify-install.sh` reports `PASS: verify complete`
- `run-smoke-test.sh` reports `finalStatus: success`
- `run-smoke-test.sh` reports `statusTool: ok`
- `run-smoke-test.sh` reports `artifacts: ok`
- `run-smoke-test.sh` exits with `smoke test: pass`

Expected on-disk artifacts after a successful smoke test:

- `~/.openclaw/supervisor/runs/<runId>/events.jsonl`
- `~/.openclaw/supervisor/runs/<runId>/final.json`

If the smoke test fails:

1. do not start broad debugging changes immediately
2. inspect the first failing prerequisite
3. use `docs/TROUBLESHOOTING.md`
4. use `./scripts/rollback-plugin.sh` if the node is live and you need to restore safe state

## Usage

Run `supervisor_run` through the gateway:

```bash
export OPENCLAW_GATEWAY_TOKEN="set-a-local-token-here"
python3 - <<'PY'
import json
import os
import urllib.request

payload = {
  "tool": "supervisor_run",
  "args": {
    "task": "Return READY with one short reason.",
    "runId": "manual-run-001",
    "importanceLevel": "medium"
  }
}

req = urllib.request.Request(
  "http://127.0.0.1:18789/tools/invoke",
  data=json.dumps(payload).encode(),
  headers={
    "Authorization": f"Bearer {os.environ['OPENCLAW_GATEWAY_TOKEN']}",
    "Content-Type": "application/json",
    "x-openclaw-scopes": "agent",
  },
  method="POST",
)

with urllib.request.urlopen(req) as response:
  print(response.read().decode())
PY
```

Inspect recent runs with `supervisor_status`:

```bash
export OPENCLAW_GATEWAY_TOKEN="set-a-local-token-here"
python3 - <<'PY'
import json
import os
import urllib.request

payload = {
  "tool": "supervisor_status",
  "args": {"limit": 5}
}

req = urllib.request.Request(
  "http://127.0.0.1:18789/tools/invoke",
  data=json.dumps(payload).encode(),
  headers={
    "Authorization": f"Bearer {os.environ['OPENCLAW_GATEWAY_TOKEN']}",
    "Content-Type": "application/json",
    "x-openclaw-scopes": "agent",
  },
  method="POST",
)

with urllib.request.urlopen(req) as response:
  print(response.read().decode())
PY
```

In routine use, the operator should prefer:

- `supervisor_run` for controlled execution
- `supervisor_status` for quick state inspection
- artifact inspection on disk before guessing about failures

## Configuration

The plugin reads configuration from:

- `plugins.entries.supervisor-phase1.config`

Supported options:

| Option | Type | Default | Description |
|---|---|---:|---|
| `gateEnabled` | boolean | `false` | Enables runtime use when no env override is forcing the gate off. |
| `gateEnvVar` | string | `OPENCLAW_SUPERVISOR_ENABLED` | Optional env override that can force the gate on or off. |
| `defaultFanout` | `single` or `multi` | `single` | Default worker strategy for normal tasks. |
| `highImportanceFanout` | `single` or `multi` | `multi` | Worker strategy for tasks marked `high`. |
| `maxRetriesPerWorker` | integer | `1` | Maximum retry count per worker when output is weak or the worker errors. |
| `verificationOnFlaggedCases` | boolean | `true` | Enables a verification worker on flagged single-worker runs. |
| `maxVerificationWorkers` | integer | `1` | Maximum number of verification workers. |

Full example config block:

```json
{
  "plugins": {
    "entries": {
      "supervisor-phase1": {
        "enabled": false,
        "config": {
          "gateEnabled": false,
          "gateEnvVar": "OPENCLAW_SUPERVISOR_ENABLED",
          "defaultFanout": "single",
          "highImportanceFanout": "multi",
          "maxRetriesPerWorker": 1,
          "verificationOnFlaggedCases": true,
          "maxVerificationWorkers": 1
        }
      }
    }
  }
}
```

The manifest, scripts, docs, and runtime code are expected to stay aligned around this exact config surface.

## Artifacts

Each run writes artifacts under:

- `~/.openclaw/supervisor/runs/<runId>/`

Files:

- `events.jsonl`: append-first event history
- `final.json`: final decision and attempt summary

Status meanings:

- `success`: selected output accepted without disagreement or low-confidence classification
- `disagreement`: multiple successful workers produced different outputs and arbitration selected one
- `lowConfidence`: the selected output was accepted but flagged as weak
- `error`: no usable result was selected
- `missing-final`: status reporting found a run directory but could not read a usable `final.json`

Artifact inspection examples:

```bash
ls -1 "$HOME/.openclaw/supervisor/runs/<runId>"
sed -n '1,40p' "$HOME/.openclaw/supervisor/runs/<runId>/events.jsonl"
python3 -m json.tool < "$HOME/.openclaw/supervisor/runs/<runId>/final.json"
```

## Troubleshooting

Start with:

- [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)

Most common failures:

1. Plugin not loaded
   Check the install target, required files, and gateway restart state.

2. `gateEnabled=false`
   Check both config values and env overrides before assuming the plugin is broken.

3. Missing artifacts or `missing-final`
   Inspect `events.jsonl`, `final.json`, and the corresponding run directory before changing code or config.

## Maintenance

Upgrade flow:

1. update the repo contents
2. re-run `./scripts/install-plugin.sh`
3. re-run `./scripts/verify-install.sh`
4. re-run `./scripts/run-smoke-test.sh`

Rollback flow:

```bash
cd /home/z2/repos/openclaw-supervisor
./scripts/rollback-plugin.sh
```

Routine checks:

```bash
./scripts/verify-install.sh
systemctl --user is-active openclaw-gateway.service
openclaw config get plugins.entries.supervisor-phase1.enabled
openclaw config get plugins.entries.supervisor-phase1.config.gateEnabled
```

Use the rollback path before making speculative changes on a live deployment.

## For Codex / Claude

Agent guidance:

- Start with the root files; this repo is intentionally flat.
- Do not casually rename `supervisor-phase1`, the tool names, or artifact filenames.
- Treat `docs/archive` as historical context, not the primary install path.
- Keep the README, manifest, scripts, and active docs aligned before claiming a packaging change is complete.
- Use `supervisor_status`, `events.jsonl`, and `final.json` before guessing about runtime failures.
- Treat compatibility-bound names as migration-sensitive operational interfaces, not cosmetic naming choices.

## Compatibility Constraints

The following names remain stable because deployed systems already depend on them:

- Plugin id: `supervisor-phase1`
- Config path: `plugins.entries.supervisor-phase1.*`
- Tool names: `supervisor_run`, `supervisor_status`
- Artifact filenames: `events.jsonl`, `final.json`

These remain stable because they are runtime interfaces already used by live configs, tools, or artifact readers. Any change to them requires:

- a migration plan
- rollout validation
- compatibility updates across scripts and docs
- explicit operator review

Further detail:

- [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md)

## Repository Layout

- `index.js`: plugin entrypoint and tool registration
- `ArbitrationPolicy.js`: arbitration and confidence rules
- `DecisionLogStore.js`: artifact write, read, and replay behavior
- `SupervisorOrchestrator.js`: execution lifecycle
- `openclaw.plugin.json`: plugin manifest and config schema
- `openclaw.json.example`: example config block
- `scripts/`: installation, validation, rollback, and config helpers
- `__tests__/`: test suite
- `docs/`: operator, troubleshooting, architecture, and compatibility docs
- `docs/archive/`: archived migration and audit notes

## Disclaimer

- No secrets are included in this repository.
- All example tokens and config values are placeholders.
- Operators must review config and rollout impact before enabling this plugin on a live environment.
- This repository provides a controlled operational path, not an unconditional guarantee of correct model behavior.
- If you deploy it on a live node, the responsibility for rollout scope, validation, and incident handling remains with the operator.

Use it deliberately. Validate it on your own lane. Broaden only when you have the evidence to do so safely.
