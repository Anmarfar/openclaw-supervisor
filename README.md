# OpenClaw Supervisor

One worker failed you. This prevents that.

This plugin gives OpenClaw a supervised execution lane: controlled fanout, deterministic arbitration, bounded retry, and inspectable run files you can check after the fact.

```text
caller
  -> supervisor_run
    -> worker fanout
      -> arbitration
        -> events.jsonl + final.json
```

Install it once. After that, you have a repeatable, inspectable path for any task where correctness matters.

**The grid stays alive.**

---

## Inspiration

This project draws from the incredible pace of development happening in the open agent space.

[OpenClaw](https://github.com/openclaw/openclaw) showed what a persistent, self-directed agent can look like when built in the open. Projects like [Hermes Agent](https://github.com/NousResearch/hermes-agent), [Open Multi-Agent](https://github.com/jackchen-me/open-multi-agent), and the broader coordination ecosystem are pushing what is possible when these patterns are shared freely.

This is a small contribution to that direction: a controlled execution lane that makes agent work inspectable and reproducible without getting in the way.

Credit where it's due.

---

## For the Operator

You run important tasks through OpenClaw. Sometimes one worker turn is not enough. Output is weak. A worker errors. You need more confidence in the result.

This fixes that.

Install once. After that, tasks routed through the supervisor lane get:

- one or more worker attempts, bounded by config
- automatic retry on weak output or worker error
- optional verification on flagged single-worker runs
- deterministic arbitration when multiple workers ran
- run files written to disk so you can inspect what happened

What changes after install:

- OpenClaw exposes `supervisor_run`
- OpenClaw exposes `supervisor_status`
- every supervised run writes inspectable files under `~/.openclaw/supervisor/runs/<runId>/`

Commands you'll actually use:

```bash
# install
PLUGIN_TARGET_DIR="$HOME/.openclaw/workspace/.openclaw/plugins/supervisor" \
./scripts/install-plugin.sh

# enable and restart
openclaw config set plugins.entries.supervisor.enabled true
openclaw config set plugins.entries.supervisor.config.gateEnabled true
systemctl --user restart openclaw-gateway.service

# verify and smoke test
./scripts/verify-install.sh
./scripts/run-smoke-test.sh

# rollback if needed
./scripts/rollback-plugin.sh
```

A similar supervised execution approach has been running successfully in production on OpenClaw. It works.

---

## How It Works

```text
caller
  -> supervisor_run
    -> one or more worker attempts
      -> retry on weak output or worker error
        -> optional verification on flagged single-worker runs
          -> deterministic arbitration
            -> run files + final result
```

The supervisor does four things:

1. **Plans execution.** The request and config decide whether the run stays single-worker or fans out.
2. **Runs bounded attempts.** A worker retries within configured limits if it errors or returns weak output.
3. **Picks a result.** Arbitration compares candidate outputs and selects a stable outcome the same way every time.
4. **Writes the evidence.** Every run produces `events.jsonl` and `final.json` so you can see what happened without guessing.

The point is not just to get an answer. It is to get it through a path you can verify.

---

## Quick Examples

**Routine** - fast, single worker:

> "Summarise the last 5 changelog entries and flag any breaking changes."

```bash
supervisor_run task="Summarise the last 5 changelog entries and flag any breaking changes." importanceLevel=low runId="changelog-001"
# Result: Fast-track
```

**Standard** - production check with retry:

> "Is this config change safe to apply to the live node?"

```bash
supervisor_run task="Review this config change for risks before I apply it to the live node." importanceLevel=medium runId="config-review-001"
# Result: Verified
```

**Critical** - multiple workers, arbitration, full record on disk:

> "What are the top risks in this deployment plan?"

```bash
supervisor_run task="Analyse this deployment plan. Top 3 risks ranked by severity." importanceLevel=high runId="deploy-risk-001"
# Result: Arbitrated
```

**Check recent runs:**

```bash
supervisor_status limit=5
```

Full usage guide: [docs/USAGE_GUIDE.md](docs/USAGE_GUIDE.md)

---

## Execution Path

> Tool names, artifact filenames, and the plugin id `supervisor` remain stable because deployed configs depend on them. Change them only with a migration plan.

| Priority | Step | What happens |
|----------|------|--------------|
| 1 | Worker attempt | Runs the task with the assigned worker |
| 2 | Retry | If output is weak or the worker errors, retries within `maxRetriesPerWorker` |
| 3 | Verification | If the run is flagged and `verificationOnFlaggedCases=true`, a verification worker can run |
| 4 | Arbitration | Compares candidates and selects deterministically |
| 5 | Result | Writes `final.json` and `events.jsonl`, returns final status |

If all attempts fail, the run status is `error` and the run files explain why.

---

## Prerequisites

- A working OpenClaw installation
- A running user gateway service, typically `openclaw-gateway.service`
- Access to the OpenClaw plugin directory and state root, typically `~/.openclaw`
- `bash`, `cp`, `mkdir`, `python3`, and optionally `systemctl`
- A local gateway token or a standard OpenClaw config that the smoke-test script can read

---

## 🤖 Installation (for Operator or Agent)

You can paste this section directly into an agent and ask it to execute step-by-step.

Follow these steps exactly. Do not modify compatibility-bound identifiers. Do not improvise runtime ids or config paths.

### 1. Deploy plugin files

```bash
cd /path/to/openclaw-supervisor
PLUGIN_TARGET_DIR="$HOME/.openclaw/workspace/.openclaw/plugins/supervisor" \
./scripts/install-plugin.sh
```

### 2. Configure the gate

Merge the config block from `openclaw.json.example` into your real `openclaw.json`, or use the CLI:

```bash
openclaw config set plugins.entries.supervisor.enabled true
openclaw config set plugins.entries.supervisor.config.gateEnabled true
```

If you are installing ahead of time but are not ready to route real work yet, keep `gateEnabled=false`.

This config path is the normal way to control the supervisor lane. Use the environment override only as an exceptional operator override.

### 3. Restart and verify

```bash
systemctl --user restart openclaw-gateway.service
./scripts/verify-install.sh
./scripts/run-smoke-test.sh
```

The smoke-test script tries to use the local gateway auth automatically. If your environment does not expose it in the usual place, export `OPENCLAW_GATEWAY_TOKEN` manually before running the script.

---

## 🧩 Post-Install Validation

Expected success signals:

- `verify-install.sh` reports `PASS: all required files present`
- `verify-install.sh` reports `PASS: verify complete`
- `run-smoke-test.sh` reports `finalStatus: success`
- `run-smoke-test.sh` reports `statusTool: ok`
- `run-smoke-test.sh` exits with `smoke test: pass`

Expected files on disk after a successful smoke test:

- `~/.openclaw/supervisor/runs/<runId>/events.jsonl`
- `~/.openclaw/supervisor/runs/<runId>/final.json`

If validation fails: stop, inspect the first failing step, check [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md), and run `./scripts/rollback-plugin.sh` if the node is live.

---

## Usage

```bash
# run a supervised task
export OPENCLAW_GATEWAY_TOKEN="your-local-token"
python3 - <<'PY'
import json, os, urllib.request
req = urllib.request.Request(
  "http://127.0.0.1:18789/tools/invoke",
  data=json.dumps({"tool": "supervisor_run", "args": {"task": "Return READY with one short reason.", "runId": "manual-run-001", "importanceLevel": "medium"}}).encode(),
  headers={"Authorization": f"Bearer {os.environ['OPENCLAW_GATEWAY_TOKEN']}", "Content-Type": "application/json", "x-openclaw-scopes": "agent"},
  method="POST"
)
with urllib.request.urlopen(req) as r: print(r.read().decode())
PY

# check recent runs
# same pattern, tool: supervisor_status, args: {"limit": 5}
```

In normal supervised use, prefer:

- `supervisor_run` for controlled execution
- `supervisor_status` for quick state inspection
- artifact inspection on disk before guessing about failures

---

## Configuration

The plugin reads from `plugins.entries.supervisor.config`:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `gateEnabled` | boolean | `false` | Enables runtime use |
| `gateEnvVar` | string | `OPENCLAW_SUPERVISOR_ENABLED` | Optional emergency override; normal gate control should stay in config |
| `defaultFanout` | `single` or `multi` | `single` | Worker strategy for normal tasks |
| `highImportanceFanout` | `single` or `multi` | `multi` | Worker strategy for high-importance tasks |
| `maxRetriesPerWorker` | integer | `1` | Max retries per worker on weak output or error |
| `verificationOnFlaggedCases` | boolean | `true` | Verification worker on flagged single-worker runs |
| `maxVerificationWorkers` | integer | `1` | Max verification workers |

The manifest, scripts, docs, and runtime code are expected to stay aligned around this exact config surface.

---

## Run Files

Every run writes to `~/.openclaw/supervisor/runs/<runId>/`:

- `events.jsonl` — append-first event history
- `final.json` — final decision and attempt summary

Status values:

- `success` — selected output accepted cleanly
- `disagreement` — workers diverged, arbitration selected one
- `lowConfidence` — output accepted but flagged as weak
- `error` — no usable result selected
- `missing-final` — run directory found but `final.json` unreadable

Inspect them directly:

```bash
ls -1 ~/.openclaw/supervisor/runs/<runId>/
python3 -m json.tool < ~/.openclaw/supervisor/runs/<runId>/final.json
```

---

## Troubleshooting

Start with [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

Top three failures:

1. Plugin not loaded
   Check the install target, required files, and gateway restart state.

2. `gateEnabled=false`
   Check config values and env overrides before assuming the plugin is broken.

3. Missing artifacts or `missing-final`
   Inspect `events.jsonl`, `final.json`, and the corresponding run directory before changing code or config.

---

## Maintenance

Update:

```bash
# pull new repo contents, then:
./scripts/install-plugin.sh
./scripts/verify-install.sh
./scripts/run-smoke-test.sh
```

Rollback:

```bash
./scripts/rollback-plugin.sh
```

Routine checks:

```bash
./scripts/verify-install.sh
systemctl --user is-active openclaw-gateway.service
openclaw config get plugins.entries.supervisor.enabled
```

---

## For Codex / Claude

- Start with the root files. This repo is intentionally flat.
- Do not casually rename `supervisor`, the tool names, or artifact filenames.
- Keep the README, manifest, scripts, and active docs aligned before claiming a packaging change is complete.
- Use `supervisor_status`, `events.jsonl`, and `final.json` before guessing about runtime failures.

---

## Repository Layout

- `index.js` — plugin entrypoint and tool registration
- `ArbitrationPolicy.js` — arbitration and confidence rules
- `DecisionLogStore.js` — run file write, read, and replay
- `SupervisorOrchestrator.js` — execution lifecycle
- `openclaw.plugin.json` — plugin manifest and config schema
- `openclaw.json.example` — example config block
- `scripts/` — install, verify, smoke test, rollback, config helpers
- `__tests__/` — test suite
- `docs/` — operator, troubleshooting, architecture docs

---

## Warning

This is an operator-controlled production component, not a broad autonomous default.

- Do not enable it widely until you have validated your own rollout path.
- Use configuration as the normal gate path. Treat the environment override as exceptional operator control.
- Do not expose bearer tokens, gateway secrets, or machine-local secrets in docs, shell history, logs, or tickets.
- Do not casually rename runtime contract identifiers.
- Use the rollback path before making speculative live-node changes during an incident.
- Keep the README, manifest, scripts, and active docs aligned. Drift here becomes operational risk.

---

## Disclaimer

Files in this repo are clean. No secrets, no local paths, no metadata, no nasties. Safe to clone, safe to inspect, safe to deploy.

Beyond that — this is shared knowledge, not a service.

Whatever happens after you deploy this — good, bad, unexpected, spectacular — that's on you. Models misbehave. Free tiers disappear. Things break in interesting ways. No guarantees are made here about any of it.

Use at your own risk.

Knowledge shared freely. Responsibility stays with the user.

**The grid stays alive.**
