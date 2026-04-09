# OpenClaw Supervisor — Usage Guide

Think of the supervisor as a traffic controller for your tasks. You decide how much care a task deserves. The supervisor handles the rest.

---

## The two tools you use

**`supervisor_run`** — how you send a task into the supervised lane.

**`supervisor_status`** — how you check what happened after.

That's it. Everything else is policy set once in config.

---

## The one habit that makes everything easier

Always set a `runId`. It doesn't have to be clever — just something you'll recognise later. Without it, tracking a run in the output files is harder than it needs to be.

```
runId: "deploy-check-001"
runId: "risk-review-apr26"
runId: "refactor-decision-01"
```

---

## Choosing importance — the main dial

`importanceLevel` is the most important input. It tells the supervisor how much care to apply.

| If the task is... | Use... |
|---|---|
| Routine, low stakes, fast turnaround needed | `low` |
| Normal production work | `medium` |
| High stakes, needs confidence, auditability matters | `high` |

`high` typically triggers multi-worker fanout. `low` keeps it fast and cheap. When in doubt, use `medium`.

---

## Real task examples

---

### Quick lookup or routine question

You need a fast answer. Stakes are low. One worker is fine.

```
Use tool supervisor_run with:
  task: "Summarise the last 5 entries in the changelog and list any breaking changes."
  importanceLevel: low
  runId: "changelog-summary-001"
```

What happens: single worker, minimal retry, result returned quickly.

---

### Production decision with some risk

You want a solid answer but don't need to go all-out.

```
Use tool supervisor_run with:
  task: "Review this config change and tell me if there are any risks before I apply it to the live node."
  importanceLevel: medium
  runId: "config-review-apr26"
```

What happens: single worker by default, retry kicks in if output is weak, verification runs if the outcome is flagged.

---

### High-stakes decision — you need confidence and a paper trail

Multiple workers, deterministic arbitration, full run files written to disk.

```
Use tool supervisor_run with:
  task: "Analyse this deployment plan and give me the top 3 risks ranked by severity. Be specific."
  importanceLevel: high
  runId: "deploy-risk-001"
```

What happens: multi-worker fanout, bounded retry, arbitration selects the best answer, `events.jsonl` and `final.json` written so you can inspect exactly what happened.

---

### Override the default strategy for one run

You have a routine task but this time you want two workers because the output matters more than usual. Use `fanoutHint` to steer just this run without changing your global config.

```
Use tool supervisor_run with:
  task: "Draft the rollback procedure for this week's release."
  importanceLevel: medium
  fanoutHint: multi
  runId: "rollback-draft-001"
```

---

### Route to a specific agent identity

You have multiple agent identities configured and need a particular one for this task.

```
Use tool supervisor_run with:
  task: "Check the security posture of this API endpoint."
  importanceLevel: high
  workerAgentId: "security-agent"
  runId: "api-security-001"
```

---

## After the run — checking what happened

```
Use tool supervisor_status with:
  limit: 5
```

Returns your last 5 runs with their final status. Quick sanity check after any supervised task.

---

## Reading the result

| Status | What it means |
|---|---|
| `success` | Clean result, accepted without flags |
| `disagreement` | Workers gave different answers — arbitration picked the best one |
| `lowConfidence` | Answer accepted but flagged as weak — worth a human look |
| `error` | No usable result — check the run files |
| `missing-final` | Run directory found but final.json unreadable — inspect manually |

---

## When something looks wrong — inspect the run files directly

```bash
# see what is in the run folder
ls -1 ~/.openclaw/supervisor/runs/deploy-risk-001/

# read the full event history
cat ~/.openclaw/supervisor/runs/deploy-risk-001/events.jsonl

# read the final decision
python3 -m json.tool < ~/.openclaw/supervisor/runs/deploy-risk-001/final.json
```

The run files don't lie. If the status is unexpected, start here before changing anything.

---

## Three ready-to-use profiles

**Fast** — routine work, speed over caution:
```
importanceLevel: low
fanoutHint: single
```

**Balanced** — normal production work:
```
importanceLevel: medium
```

**Critical** — high stakes, full auditability:
```
importanceLevel: high
fanoutHint: multi
```

---

## All supervisor_run inputs at a glance

| Input | Required | What it does |
|---|---|---|
| `task` | Yes | The actual work instruction |
| `runId` | Recommended | Your label for this run — used in files and status output |
| `importanceLevel` | Yes | `low`, `medium`, or `high` — controls how much care is applied |
| `fanoutHint` | Optional | `single` or `multi` — overrides fanout strategy for this run only |
| `workerAgentId` | Optional | Forces a specific agent identity for this run |

---

## One-line decision guide

- Stakes low, speed matters → `low`
- Normal work → `medium`
- Consequences matter, you want a record → `high`
- Need to override strategy for one run only → add `fanoutHint`
- Need a specific agent identity → add `workerAgentId`
- Always → set `runId`

---

## Troubleshooting

Start with the run files. They contain the full event history and final decision.

If those don't explain the problem, see [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

If the node is live and something is wrong, run the rollback script before making any other changes:

```bash
./scripts/rollback-plugin.sh
```

---

*Files in this repo are clean. No secrets, no surprises. Use at your own risk. The grid stays alive.*
