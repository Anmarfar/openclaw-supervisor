# Changelog

## [1.0.1] - 2026-04-09

### Finalization and Safety Pass

- Standardized runtime naming to `supervisor` and `plugins.entries.supervisor.*` across active repo surfaces
- Removed stale migration archive files and archive directory from published docs surface
- Tightened publication safety language around token handling and machine-specific disclosure
- Updated operator and troubleshooting docs to align with current scripts and manifest

## [1.0.0] - 2026-04-09

### Initial Release

**Features:**
- Multi-worker orchestration with single/multi fanout strategies
- Dimension-based deterministic arbitration (delivery, certainty, consensus, substance)
- Durable append-first event logs in JSONL format
- Final decision artifacts with attempt summary and rationale
- Optional verification on flagged cases (low confidence, disagreement)
- Configurable retry policy per worker
- Controlled gate enable/disable with environment variable override
- Health diagnostics via supervisor_status tool
- Full test coverage (24 tests)

**Components:**
- ArbitrationPolicy: Dimension-based outcome evaluation
- DecisionLogStore: Artifact I/O and replay
- SupervisorOrchestrator: Execution lifecycle
- Gateway integration: supervisor_run and supervisor_status tools

**Configuration Options:**
- gateEnabled
- gateEnvVar
- defaultFanout
- highImportanceFanout
- maxRetriesPerWorker
- verificationOnFlaggedCases
- maxVerificationWorkers

**Artifact Format:**
- events.jsonl (append-first event history)
- final.json (decision with attempt summary)
- Schema version 1

### Clean Room Implementation

This is a clean-room implementation with materially different internal decomposition from prior versions:

- Arbitration replaced from weighted scoring to dimension-based evaluation
- Decision log store replaced from direct file helpers to artifact API + reducer pattern
- Orchestrator replaced from nested closures to explicit execution phases
- All external contracts (tool names, events, artifact shape) preserved for compatibility
- Added 6 validation tests for new architecture behaviors
- Added 2 regression tests for edge cases

See [ARCHITECTURE.md](./docs/ARCHITECTURE.md) for design rationale.

---

*All versions use semantic versioning: MAJOR.MINOR.PATCH*
