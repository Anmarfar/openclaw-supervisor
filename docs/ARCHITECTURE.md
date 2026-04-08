# OpenClaw Supervisor Architecture

## Module Roles

- `index.js`: plugin registration, tool definitions, config normalization, and status reporting.
- `ArbitrationPolicy.js`: deterministic ranking, low-confidence checks, and disagreement handling.
- `DecisionLogStore.js`: artifact writes, reads, and replay behavior for `events.jsonl` and `final.json`.
- `SupervisorOrchestrator.js`: execution plan building, worker attempts, verification dispatch, and finalization.

## Execution Lifecycle

The runtime flow is explicit and linear:

1. Build the execution plan from the request and config.
2. Emit `RunStarted` and `FanoutDecided`.
3. Dispatch each worker attempt.
4. Retry weak or failed workers within configured bounds.
5. Arbitrate results.
6. Optionally dispatch a verification worker for flagged single-worker runs.
7. Emit `ArbitrationComputed` and `RunFinalized`.
8. Write `final.json`.

## Arbitration Model

Arbitration evaluates each successful outcome across four dimensions:

- Delivery
- Certainty
- Consensus
- Substance

Ranking is deterministic in this order:

```text
delivery -> certainty -> consensus -> substance -> workerId
```

This keeps selection reproducible across repeated runs with the same inputs.

## Artifact Model

Each run writes to `~/.openclaw/supervisor/runs/<runId>/`.

- `events.jsonl`: append-first event stream.
- `final.json`: final decision, output hash, and attempt summary.

Replay behavior is tolerant of malformed event lines and returns `missing-final` semantics when the status layer cannot read a valid final artifact.

## Why Some Names Stay Stable

The following names remain stable because they are runtime contracts:

- `supervisor-phase1` plugin id.
- `plugins.entries.supervisor-phase1.*` config path.
- `supervisor_run` and `supervisor_status` tool names.
- `events.jsonl` and `final.json` artifact filenames.

Those names are retained to avoid breaking deployed configs, workflow calls, and artifact readers.

## Operator Workflow and Implementation Boundaries

Operator-facing workflow is limited to installation, enablement, verification, usage, and rollback. Operators should not need to understand internal worker retry loops or arbitration scoring details to perform safe deployment and diagnosis.

Implementation internals are intentionally isolated in the four root JavaScript modules so that:

- deployment remains flat and easy to install,
- tests import the real implementation directly,
- documentation maps cleanly to runtime files,
- packaging does not depend on wrapper indirection.
