# OpenClaw Supervisor

Important tasks should not disappear into a single opaque worker turn.

This repository packages a controlled supervisor path for OpenClaw: one or more worker attempts, deterministic arbitration, bounded retry, optional verification on flagged runs, and durable artifacts the operator can inspect after the fact.

```text
caller
  -> supervisor_run
    -> worker fanout
      -> arbitration
        -> events.jsonl + final.json
```

The goal is simple:

- keep supervised execution explicit
- keep outcomes deterministic
- keep artifacts inspectable
- keep rollout controlled

The workflow stays on your machine, inside your OpenClaw environment, under operator control.

## Warning

This is an operator-controlled production component, not a broad autonomous default.

- Do not enable it widely until you have validated your own rollout path.
- Do not expose bearer tokens, gateway secrets, or machine-local secrets in docs, shell history, logs, or tickets.
- Do not casually rename runtime contract identifiers.
- Use the rollback path before making speculative live-node changes during an incident.
- Keep the README, manifest, scripts, and active docs aligned. Drift here becomes operational risk.

## For the Operator

You want a safer execution lane for important work inside OpenClaw.

This gives you that lane.

Instead of one unchecked worker output, you get:

- controlled fanout when needed
- deterministic arbitration
- bounded retry on weak output or worker error
- optional verification on flagged single-worker runs
- durable artifacts under `~/.openclaw/supervisor/runs/<runId>/`

What changes after install:

- OpenClaw exposes `supervisor_run`
- OpenClaw exposes `supervisor_status`
- each supervised run writes inspectable artifacts
- the operator has a repeatable verify / smoke-test / rollback path

Commands you will actually use:

```bash
PLUGIN_TARGET_DIR="$HOME/.openclaw/workspace/.openclaw/plugins/supervisor" \
./scripts/install-plugin.sh

./scripts/print-config-example.sh

openclaw config set plugins.entries.supervisor.enabled true
openclaw config set plugins.entries.supervisor.config.gateEnabled true
systemctl --user restart openclaw-gateway.service

./scripts/verify-install.sh
./scripts/run-smoke-test.sh
./scripts/rollback-plugin.sh
```

Short practical workflow:

1. Install the plugin files.
2. Merge the config block.
3. Enable the plugin and restart the gateway.
4. Verify the install.
5. Run the smoke test.
6. Use the supervisor lane only where you want bounded, inspectable execution.

## How It Works

```text
caller
  -> supervisor_run
    -> one or more worker attempts
      -> retry on weak output or worker error
        -> optional verification worker on flagged single-worker runs
          -> deterministic arbitration
            -> final status + durable artifacts
              -> supervisor_status / operator inspection
```

At runtime, the supervisor does four jobs:

1. It plans worker execution.
   The request and config determine whether the run stays single-worker or fans out.

2. It runs bounded attempts.
   A worker can retry within configured limits if it errors or returns weak output.

3. It computes a deterministic result.
   Arbitration compares candidate outputs and selects a stable outcome in a repeatable way.

4. It writes durable evidence.
   Each run produces `events.jsonl` and `final.json`, so the operator can inspect what happened without guessing.

This is not just about getting an answer. It is about getting an answer through a path the operator can verify and trust.

## Prerequisites

- A working OpenClaw installation
- A running user gateway service, typically `openclaw-gateway.service`
- Access to the OpenClaw plugin directory
- Access to the OpenClaw state root, typically `~/.openclaw`
- Shell tools used by the included scripts: `bash`, `cp`, `mkdir`, `python3`, and optionally `systemctl`
- A local OpenClaw config that can supply the gateway bearer token for smoke testing

## Installation (for Operator or Agent)

You can hand this section directly to Codex or Claude.

Follow these steps exactly. Do not improvise paths, rename compatibility-bound identifiers, or substitute different runtime ids.

### 1. Choose the repo path

Clone or place this repository somewhere local, then enter it:

```bash
cd /path/to/openclaw-supervisor
```

### 2. Install the plugin files

```bash
PLUGIN_TARGET_DIR="$HOME/.openclaw/workspace/.openclaw/plugins/supervisor" \
./scripts/install-plugin.sh
```

This copies only the deployable runtime files into the live plugin directory.

### 3. Print and review the config block

```bash
./scripts/print-config-example.sh
```

The full example is also available at:

- `openclaw.json.example`

Merge the `plugins.entries.supervisor` block into your real OpenClaw config.

### 4. Enable the plugin entry

```bash
openclaw config set plugins.entries.supervisor.enabled true
openclaw config set plugins.entries.supervisor.config.gateEnabled true
```

If you are installing ahead of time but not ready to use the lane yet, keep `gateEnabled=false`.

### 5. Restart the gateway

```bash
systemctl --user restart openclaw-gateway.service
```

### 6. Verify the install

```bash
./scripts/verify-install.sh
```

### 7. Run the smoke test

```bash
./scripts/run-smoke-test.sh
```

If the smoke test cannot auto-acquire the local gateway token, start with:

- [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)

## Post-Install Validation

Run both validation scripts after installation:

```bash
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

If validation fails:

1. stop changing unrelated settings
2. inspect the first failing prerequisite
3. use `docs/TROUBLESHOOTING.md`
4. if the node is live and you need to restore safe state, run `./scripts/rollback-plugin.sh`

## Usage

Run `supervisor_run` through the gateway:

```bash
export OPENCLAW_GATEWAY_TOKEN=$(python3 -c "import json; d=json.load(open('$HOME/.openclaw/openclaw.json')); print(d['gateway']['auth']['token'])")
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
export OPENCLAW_GATEWAY_TOKEN=$(python3 -c "import json; d=json.load(open('$HOME/.openclaw/openclaw.json')); print(d['gateway']['auth']['token'])")
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

In normal supervised use, the operator should prefer:

- `supervisor_run` for controlled execution
- `supervisor_status` for quick state inspection
- artifact inspection on disk before guessing about failures

## Configuration

The plugin reads configuration from:

- `plugins.entries.supervisor.config`

Supported options:

| Option | Type | Default | Description |
|---|---|---:|---|
| `gateEnabled` | boolean | `false` | Enables runtime use when no env override is forcing the gate off |
| `gateEnvVar` | string | `OPENCLAW_SUPERVISOR_ENABLED` | Env override that can force the gate on or off |
| `defaultFanout` | `single` or `multi` | `single` | Default worker strategy for normal tasks |
| `highImportanceFanout` | `single` or `multi` | `multi` | Worker strategy for tasks marked `high` |
| `maxRetriesPerWorker` | integer | `1` | Maximum retry count per worker on weak output or worker error |
| `verificationOnFlaggedCases` | boolean | `true` | Enables a verification worker on flagged single-worker runs |
| `maxVerificationWorkers` | integer | `1` | Maximum number of verification workers |

Full example config block:

```json
{
  "plugins": {
    "entries": {
      "supervisor": {
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
./scripts/rollback-plugin.sh
```

Routine checks:

```bash
./scripts/verify-install.sh
systemctl --user is-active openclaw-gateway.service
openclaw config get plugins.entries.supervisor.enabled
openclaw config get plugins.entries.supervisor.config.gateEnabled
```

Use the rollback path before making speculative changes on a live deployment.

## For Codex / Claude

Agent guidance:

- Start with the root files; this repo is intentionally flat.
- Do not casually rename `supervisor`, the tool names, or artifact filenames.
- Keep the README, manifest, scripts, and active docs aligned before claiming a packaging change is complete.
- Use `supervisor_status`, `events.jsonl`, and `final.json` before guessing about runtime failures.
- Treat compatibility-bound names as migration-sensitive operational interfaces, not cosmetic naming choices.

## Compatibility Constraints

The following names remain stable because deployed systems already depend on them:

- Plugin id: `supervisor`
- Config path: `plugins.entries.supervisor.*`
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

## Disclaimer

Files in this repo are clean. No secrets, no embedded credentials, no committed token values, no silent surprises.

Beyond that, this is operational knowledge, not a managed service.

Supervisor logic can be correct and still produce an answer you do not want. Models drift. Gateways fail. Artifacts can reveal problems after the fact, but they do not remove operator responsibility.

Use this deliberately. Validate it on your own lane. Broaden only when you have the evidence to do so safely.
