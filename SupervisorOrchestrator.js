import {
  SUPERVISOR_SCHEMA_VERSION,
  appendDecisionEvent,
  buildLogRoot,
  hashText,
  writeFinalResult,
} from "./DecisionLogStore.js";
import { arbitrate, isWeakOutput } from "./ArbitrationPolicy.js";

function clampBinary(value, fallback) {
  if (!Number.isInteger(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function deriveFanout(request, pluginConfig) {
  if (request.fanoutHint === "multi") {
    return { strategy: "multi", workerCount: 2, reason: "fanoutHint requested multi." };
  }

  if (request.fanoutHint === "single") {
    return { strategy: "single", workerCount: 1, reason: "fanoutHint requested single." };
  }

  if (request.importanceLevel === "high") {
    const single = pluginConfig.highImportanceFanout === "single";
    return {
      strategy: single ? "single" : "multi",
      workerCount: single ? 1 : 2,
      reason: "importanceLevel high.",
    };
  }

  const single = pluginConfig.defaultFanout !== "multi";
  return {
    strategy: single ? "single" : "multi",
    workerCount: single ? 1 : 2,
    reason: "default fanout policy.",
  };
}

function buildExecutionPlan(request, pluginConfig) {
  const fanout = deriveFanout(request, pluginConfig);
  const workers = Array.from(
    { length: fanout.workerCount },
    (_, index) => ({ workerId: `${request.runId}-w${index + 1}`, verification: false }),
  );

  return {
    runId: request.runId,
    taskId: request.taskId,
    task: request.task,
    fanout,
    workers,
    retryPolicy: {
      maxRetriesPerWorker: clampBinary(pluginConfig?.maxRetriesPerWorker, 1),
    },
    verificationPolicy: {
      enabled: pluginConfig?.verificationOnFlaggedCases !== false,
      maxWorkers: clampBinary(pluginConfig?.maxVerificationWorkers, 1),
    },
  };
}

function createAttemptSummary() {
  return {
    totalAttempts: 0,
    retriesScheduled: 0,
    verificationWorkersUsed: 0,
    workers: {},
  };
}

function shouldRetryOutcome(outcome) {
  if (!outcome || outcome.status !== "success") return { retry: true, reason: "worker-error" };
  if (isWeakOutput(outcome.output)) return { retry: true, reason: "weak-output" };
  return { retry: false, reason: null };
}

function createArtifactWriter(logRoot) {
  return {
    async emit(event) {
      await appendDecisionEvent(logRoot, {
        schemaVersion: SUPERVISOR_SCHEMA_VERSION,
        ...event,
      });
    },
    async writeFinal(finalResult) {
      await writeFinalResult(logRoot, finalResult);
    },
  };
}

async function announceRunStart(plan, artifacts) {
  await artifacts.emit({
    eventType: "RunStarted",
    runId: plan.runId,
    taskId: plan.taskId,
    timestamp: new Date().toISOString(),
    inputHash: hashText(plan.task),
  });

  await artifacts.emit({
    eventType: "FanoutDecided",
    runId: plan.runId,
    strategy: plan.fanout.strategy,
    workerCount: plan.fanout.workerCount,
    reason: plan.fanout.reason,
    timestamp: new Date().toISOString(),
  });
}

async function attemptWorker(workerPlan, context) {
  const {
    runId,
    task,
    runWorker,
    retryPolicy,
    attemptSummary,
    artifacts,
  } = context;

  const maxAttempts = retryPolicy.maxRetriesPerWorker + 1;
  let terminalOutcome = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await artifacts.emit({
      eventType: "WorkerDispatched",
      runId,
      workerId: workerPlan.workerId,
      attempt,
      verification: workerPlan.verification,
      timestamp: new Date().toISOString(),
    });

    const startedAt = Date.now();
    let rawOutcome;
    try {
      rawOutcome = await runWorker({
        task,
        runId,
        workerId: workerPlan.workerId,
        attempt,
        verification: workerPlan.verification,
      });
    } catch (error) {
      rawOutcome = {
        workerId: workerPlan.workerId,
        status: "error",
        output: "",
        model: null,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }

    terminalOutcome = {
      ...rawOutcome,
      attempt,
      verification: workerPlan.verification,
      latencyMs: Date.now() - startedAt,
    };

    attemptSummary.totalAttempts += 1;
    attemptSummary.workers[workerPlan.workerId] = {
      attempts: attempt,
      finalStatus: terminalOutcome.status,
      verification: workerPlan.verification,
    };

    await artifacts.emit({
      eventType: "WorkerCompleted",
      runId,
      workerId: workerPlan.workerId,
      attempt,
      verification: workerPlan.verification,
      status: terminalOutcome.status,
      model: terminalOutcome.model ?? null,
      outputHash: terminalOutcome.output ? hashText(terminalOutcome.output) : null,
      errorMessage: terminalOutcome.errorMessage ?? null,
      latencyMs: terminalOutcome.latencyMs,
      timestamp: new Date().toISOString(),
    });

    const retryDecision = shouldRetryOutcome(terminalOutcome);
    const canRetry = retryDecision.retry && attempt < maxAttempts;
    if (!canRetry) {
      if (attempt > 1) {
        await artifacts.emit({
          eventType: "RetryCompleted",
          runId,
          workerId: workerPlan.workerId,
          attemptsUsed: attempt,
          terminalStatus: terminalOutcome.status,
          retryReason: retryDecision.reason,
          verification: workerPlan.verification,
          timestamp: new Date().toISOString(),
        });
      }
      break;
    }

    attemptSummary.retriesScheduled += 1;
    await artifacts.emit({
      eventType: "RetryScheduled",
      runId,
      workerId: workerPlan.workerId,
      fromAttempt: attempt,
      toAttempt: attempt + 1,
      retryReason: retryDecision.reason,
      verification: workerPlan.verification,
      timestamp: new Date().toISOString(),
    });
  }

  return terminalOutcome;
}

async function runPlan(plan, runWorker, artifacts, attemptSummary) {
  const results = [];
  for (const workerPlan of plan.workers) {
    const result = await attemptWorker(workerPlan, {
      runId: plan.runId,
      task: plan.task,
      runWorker,
      retryPolicy: plan.retryPolicy,
      attemptSummary,
      artifacts,
    });
    results.push(result);
  }
  return results;
}

function shouldUseVerification(plan, decision) {
  if (!plan.verificationPolicy.enabled) return false;
  if (plan.verificationPolicy.maxWorkers <= 0) return false;
  if (plan.fanout.workerCount !== 1) return false;
  return decision.lowConfidence || decision.disagreement;
}

async function evaluateRun(plan, primaryResults, runWorker, artifacts, attemptSummary) {
  const results = [...primaryResults];
  let decision = arbitrate(results);

  if (shouldUseVerification(plan, decision)) {
    const verificationWorker = {
      workerId: `${plan.runId}-wv1`,
      verification: true,
    };
    const verificationResult = await attemptWorker(verificationWorker, {
      runId: plan.runId,
      task: plan.task,
      runWorker,
      retryPolicy: plan.retryPolicy,
      attemptSummary,
      artifacts,
    });

    attemptSummary.verificationWorkersUsed += 1;
    results.push(verificationResult);
    decision = arbitrate(results);
  }

  return { decision, results };
}

function toFinalStatus(decision) {
  if (decision.selectedWorkerId === null) return "error";
  if (decision.disagreement) return "disagreement";
  if (decision.lowConfidence) return "lowConfidence";
  return "success";
}

async function finalizeRun(plan, decision, attemptSummary, artifacts) {
  await artifacts.emit({
    eventType: "ArbitrationComputed",
    runId: plan.runId,
    disagreement: decision.disagreement,
    lowConfidence: decision.lowConfidence,
    selectedWorkerId: decision.selectedWorkerId,
    rationale: decision.rationale,
    rankedOutcomes: decision.rankedOutcomes,
    timestamp: new Date().toISOString(),
  });

  const finalResult = {
    schemaVersion: SUPERVISOR_SCHEMA_VERSION,
    runId: plan.runId,
    taskId: plan.taskId,
    finalStatus: toFinalStatus(decision),
    finalOutputHash: hashText(decision.selectedOutput),
    decision,
    attemptSummary,
    timestamp: new Date().toISOString(),
  };

  await artifacts.emit({
    eventType: "RunFinalized",
    runId: plan.runId,
    finalStatus: finalResult.finalStatus,
    finalOutputHash: finalResult.finalOutputHash,
    timestamp: new Date().toISOString(),
  });

  await artifacts.writeFinal(finalResult);
  return finalResult;
}

export async function runSupervised({ request, runWorker, stateDir, pluginConfig }) {
  const logRoot = buildLogRoot(stateDir, request.runId);
  const plan = buildExecutionPlan(request, pluginConfig);
  const artifacts = createArtifactWriter(logRoot);
  const attemptSummary = createAttemptSummary();

  await announceRunStart(plan, artifacts);
  const primaryResults = await runPlan(plan, runWorker, artifacts, attemptSummary);
  const { decision } = await evaluateRun(plan, primaryResults, runWorker, artifacts, attemptSummary);

  return finalizeRun(plan, decision, attemptSummary, artifacts);
}
