# OpenClaw Supervisor Compatibility

## Compatibility-Bound Names

The following names are part of the deployed runtime contract and should not be renamed casually.

| Name | Why it stays stable |
|---|---|
| `supervisor-phase1` | Existing OpenClaw configs already reference this plugin id. |
| `plugins.entries.supervisor-phase1.*` | The deployed config path is keyed by the stable plugin id. |
| `supervisor_run` | External workflows and operators invoke this tool name directly. |
| `supervisor_status` | Operators and automation use this tool name for diagnostics. |
| `events.jsonl` | Artifact readers and inspection steps expect this filename. |
| `final.json` | Replay and status flows expect this filename. |
| `RunStarted`, `FanoutDecided`, `WorkerDispatched`, `WorkerCompleted`, `RetryScheduled`, `RetryCompleted`, `ArbitrationComputed`, `RunFinalized` | Event readers and replay logic depend on this event taxonomy. |

## What Can Be Renamed Safely

These surfaces are safe to rename when documentation and tests are updated together:

- Non-runtime docs in `docs/`.
- Archived notes under `docs/archive/`.
- Script internals that do not change operator-facing script names.
- Internal helper names that do not affect exported interfaces.

## What Requires a Migration Plan

The following changes require a migration plan, rollout validation, and updated operator procedures:

- Changing the plugin id.
- Changing the config path.
- Changing tool names or parameter contracts.
- Changing artifact filenames.
- Changing the event taxonomy in a way that breaks replay or diagnostics.

## Why Stability Matters Here

This repo is packaged as a flat deployment surface. That keeps installation simple, but it also means operators rely directly on the documented names. If those names change without a migration plan, deployment instructions, smoke tests, and artifact inspection steps stop matching live behavior.
