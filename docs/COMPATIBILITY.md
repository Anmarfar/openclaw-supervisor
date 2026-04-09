# OpenClaw Supervisor Compatibility

## Compatibility-Bound Names

The following names are part of the deployed runtime contract and should not be renamed casually.

| Name | Why it stays stable |
|---|---|
| `supervisor` | Runtime plugin lookup and config binding use this plugin id. |
| `plugins.entries.supervisor.*` | The deployed config path is keyed by the stable plugin id. |
| `supervisor_run` | External workflows and operators invoke this tool name directly. |
| `supervisor_status` | Operators and automation use this tool name for diagnostics. |
| `events.jsonl` | Artifact readers and inspection steps expect this filename. |
| `final.json` | Replay and status flows expect this filename. |
| `RunStarted`, `FanoutDecided`, `WorkerDispatched`, `WorkerCompleted`, `RetryScheduled`, `RetryCompleted`, `ArbitrationComputed`, `RunFinalized` | Event readers and replay logic depend on this event taxonomy. |

## Migration from Older Deployments

If an existing node still uses a legacy phase-suffixed supervisor id, migrate to the current path:

- Old: `plugins.entries.<legacy-supervisor-id>.*`
- New: `plugins.entries.supervisor.*`

Required operator changes:

1. Move the plugin directory to `$HOME/.openclaw/workspace/.openclaw/plugins/supervisor`.
2. Move config values from `plugins.entries.<legacy-supervisor-id>` to `plugins.entries.supervisor`.
3. Restart the gateway and run `./scripts/verify-install.sh` then `./scripts/run-smoke-test.sh`.

## What Can Be Renamed Safely

These surfaces are safe to rename when documentation and tests are updated together:

- Non-runtime docs in `docs/`.
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
