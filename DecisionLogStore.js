import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const SUPERVISOR_SCHEMA_VERSION = 1;
const RUN_ARTIFACTS = Object.freeze({
  events: "events.jsonl",
  final: "final.json",
});

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function splitJsonLines(raw) {
  if (!raw) return [];
  return raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(parseJson)
    .filter(Boolean);
}

async function ensureDirectory(logRoot) {
  await mkdir(logRoot, { recursive: true });
}

function createRunArtifacts(logRoot) {
  const eventsFile = join(logRoot, RUN_ARTIFACTS.events);
  const finalFile = join(logRoot, RUN_ARTIFACTS.final);

  return {
    async appendEvent(event) {
      await ensureDirectory(logRoot);
      await appendFile(eventsFile, `${JSON.stringify(event)}\n`, "utf8");
    },
    async writeSummary(result) {
      await ensureDirectory(logRoot);
      await writeFile(finalFile, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    },
    async loadEvents() {
      const raw = await readFile(eventsFile, "utf8");
      return splitJsonLines(raw);
    },
    async loadSummary() {
      const raw = await readFile(finalFile, "utf8");
      return JSON.parse(raw);
    },
  };
}

function reduceReplayState(state, event) {
  const next = { ...state, eventCount: state.eventCount + 1 };

  if (event?.eventType === "ArbitrationComputed") {
    next.arbitration = {
      disagreement: Boolean(event.disagreement),
      lowConfidence: Boolean(event.lowConfidence),
      selectedWorkerId: event.selectedWorkerId ?? null,
      rationale: event.rationale ?? "",
    };
  }

  if (event?.eventType === "RunFinalized") {
    next.finalized = true;
  }

  return next;
}

function buildReplayPayload(summary, reducedState) {
  if (!summary || !reducedState?.arbitration) return null;

  return {
    runId: summary.runId,
    disagreement: reducedState.arbitration.disagreement,
    lowConfidence: reducedState.arbitration.lowConfidence,
    selectedWorkerId: reducedState.arbitration.selectedWorkerId,
    rationale: reducedState.arbitration.rationale,
    finalStatus: summary.finalStatus,
    finalOutputHash: summary.finalOutputHash,
    retriesScheduled: summary.attemptSummary?.retriesScheduled ?? 0,
    totalAttempts: summary.attemptSummary?.totalAttempts ?? 0,
    verificationWorkersUsed: summary.attemptSummary?.verificationWorkersUsed ?? 0,
    eventCount: reducedState.eventCount,
  };
}

export function hashText(text) {
  return createHash("sha256").update(text ?? "").digest("hex");
}

export function buildLogRoot(stateDir, runId) {
  return join(stateDir, "supervisor", "runs", runId);
}

export async function appendDecisionEvent(logRoot, event) {
  const artifacts = createRunArtifacts(logRoot);
  await artifacts.appendEvent(event);
}

export async function writeFinalResult(logRoot, result) {
  const artifacts = createRunArtifacts(logRoot);
  await artifacts.writeSummary(result);
}

export async function readDecisionEvents(logRoot) {
  const artifacts = createRunArtifacts(logRoot);
  return artifacts.loadEvents();
}

export async function readFinalResult(logRoot) {
  const artifacts = createRunArtifacts(logRoot);
  try {
    return await artifacts.loadSummary();
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function replayRunDecision(logRoot) {
  const [events, summary] = await Promise.all([
    readDecisionEvents(logRoot).catch(() => null),
    readFinalResult(logRoot),
  ]);

  if (!events || !summary) return null;

  const reduced = events.reduce(
    reduceReplayState,
    { arbitration: null, finalized: false, eventCount: 0 },
  );

  return buildReplayPayload(summary, reduced);
}
