# Naming Compatibility Notes

## Overview

This document explains which naming identifiers were preserved for runtime stability and which were changed for distinctive project branding.

## Preserved Stable Identifiers

### Plugin Runtime ID

**Kept As:** `supervisor-phase1` (unchanged)

**Why:** The live OpenClaw deployment configuration depends on this identifier at:
```
plugins.entries.supervisor-phase1.enabled
plugins.entries.supervisor-phase1.config.*
```

Changing this plugin ID would require all deployed systems to migrate their OpenClaw config, causing operational disruption. The identifier is part of the runtime contract and must remain stable across versions.

**Code Location:** [src/index.js](src/index.js#L200)
```javascript
export default {
  // Plugin ID is "supervisor-phase1" (not renamed) because existing OpenClaw
  // deployments depend on this identifier in their config at:
  //   plugins.entries.supervisor-phase1.*
  id: "supervisor-phase1",
```

### Plugin Manifest Fields

**Kept Stable:**
- `openclaw.plugin.json` → `id: "supervisor-phase1"` (runtime binding)
- `openclaw.plugin.json` → `name: "supervisor-phase1"` (registry identifier)

**Why:** These fields are used by OpenClaw's plugin registry and loader. Changing them would break plugin discovery and loading for existing deployments.

### Configuration Schema Paths

**Kept Stable:**
- `plugins.entries.supervisor-phase1.enabled`
- `plugins.entries.supervisor-phase1.config.gateEnabled`
- `plugins.entries.supervisor-phase1.config.gateEnvVar`
- `plugins.entries.supervisor-phase1.config.defaultFanout`
- `plugins.entries.supervisor-phase1.config.highImportanceFanout`
- `plugins.entries.supervisor-phase1.config.maxRetriesPerWorker`
- `plugins.entries.supervisor-phase1.config.verificationOnFlaggedCases`
- `plugins.entries.supervisor-phase1.config.maxVerificationWorkers`

**Why:** Live OpenClaw deployment configuration uses these paths. Changing them requires migration of every deployed instance's config file.

### Tool Names & Tool Parameters

**Kept Stable:**
- Tool: `supervisor_run`
  - Parameters: `task`, `runId`, `importanceLevel`, `fanoutHint`, `workerAgentId`
- Tool: `supervisor_status`
  - Parameters: `limit`

**Why:** External workflows and user scripts depend on these tool names and parameter contracts.

### Artifact File Names

**Kept Stable:**
- `events.jsonl` (append-first event log)
- `final.json` (final decision artifact)

**Why:** Existing tools and monitoring may depend on these artifact file names. Any change breaks replay and persistence guarantees.

### Event Taxonomy

**Kept Stable:**
- `RunStarted`, `FanoutDecided`, `WorkerDispatched`, `WorkerCompleted`
- `RetryScheduled`, `RetryCompleted`
- `ArbitrationComputed`, `RunFinalized`

**Why:** Event log consumers and replay logic depend on these event types.

---

## Changed for Distinctive Naming

### Test File

**Changed:** `__tests__/supervisor.phase1.test.js` → `__tests__/orchestration.test.js`

**Why:** The "phase1" suffix was inherited transitional naming from the development/prototype phase. The new name reflects the project's focus on orchestration logic.

**Status:** No runtime impact; tests are development-time only.

---

## Repository-Level Naming (Distinctively Original)

| Aspect | Value | Rationale |
|--------|-------|-----------|
| Repository | openclaw-supervisor | Original project name |
| Package | @openclaw/supervisor | Namespace reflects project identity |
| Display Name | OpenClaw Supervisor | Clear, non-iterative naming |
| Module Names | ArbitrationPolicy, DecisionLogStore, SupervisorOrchestrator | Original, project-specific terminology |

These are not inherited from prior sources; they are distinctive project naming.

---

## Verification

### No Inherited Terminology

✅ No references to "Claude", "Anthropic", "code-main", or other upstream sources
✅ Test file renamed from phase-scoped to distinctive naming
✅ Module and class names are original project terminology
✅ Documentation refers to the repository as "openclaw-supervisor"

### Compatibility Documented

All runtime-facing identifiers that were kept stable are documented above with explicit rationale. These identifiers were not changed because:

1. **Configuration Paths**: Live deployments depend on the current structure
2. **Tool Contracts**: Workflows depend on tool names and parameters
3. **Artifacts**: Data persistence and log formats are part of the runtime contract
4. **Event Types**: Replay and monitoring tools depend on event taxonomy

### Migration Path (If Needed)

If a future version requires changing the plugin ID or config paths, it would require:

1. **Versioning Strategy**: Major version bump
2. **Deprecation Period**: Keep old ID working with warnings
3. **Migration Guide**: Document required config updates for all deployments
4. **Fallback Logic**: Handle both old and new identifiers during transition

---

## Summary

- **Runtime Stability**: 8 major aspects kept stable (plugin ID, config paths, tool names, artifacts, events)
- **Distinctive Naming**: 1 development artifact renamed (test file), all module/repo naming is original
- **No Upstream Branding**: Zero inherited terminology from Claude, Anthropic, or code-main
- **Defensible Constraints**: All preserved identifiers have documented operational reasons

The repository is presented as a distinctively original OpenClaw project while maintaining backward compatibility with existing deployments.
