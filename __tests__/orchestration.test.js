import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { arbitrate } from "../ArbitrationPolicy.js";
import {
  SUPERVISOR_SCHEMA_VERSION,
  buildLogRoot,
  readDecisionEvents,
  readFinalResult,
  replayRunDecision,
} from "../DecisionLogStore.js";
import { runSupervised } from "../SupervisorOrchestrator.js";
import pluginEntry from "../index.js";
import {
  buildIdempotencyKey,
  extractAssistantOutput,
  normalizeWorkerStatus,
  readSupervisorStatus,
  resolveGate,
} from "../index.js";

const CONFIDENT_OUTPUT = "The capital of France is Paris, and that answer is verified.";

function successWorker(output, model = "openai/gpt-5.1") {
  return async ({ workerId }) => ({
    workerId,
    status: "success",
    output,
    model,
  });
}

test("single-worker path writes success status", async () => {
  const root = await mkdtemp(join(tmpdir(), "oc-supervisor-"));
  try {
    const result = await runSupervised({
      request: { runId: "run-1", taskId: "task-1", task: "capital of france" },
      stateDir: root,
      pluginConfig: { defaultFanout: "single", highImportanceFanout: "multi" },
      runWorker: successWorker(CONFIDENT_OUTPUT),
    });

    assert.equal(result.finalStatus, "success");
    assert.equal(result.decision.disagreement, false);
    assert.equal(result.decision.lowConfidence, false);

    const logRoot = buildLogRoot(root, "run-1");
    const events = await readDecisionEvents(logRoot);
    assert.ok(events.length >= 6);
    for (const event of events) {
      assert.equal(event.schemaVersion, SUPERVISOR_SCHEMA_VERSION);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("multi-worker disagreement is detected deterministically", async () => {
  const root = await mkdtemp(join(tmpdir(), "oc-supervisor-"));
  let count = 0;
  try {
    const result = await runSupervised({
      request: {
        runId: "run-2",
        taskId: "task-2",
        task: "compute",
        fanoutHint: "multi",
      },
      stateDir: root,
      pluginConfig: { defaultFanout: "single", highImportanceFanout: "multi" },
      runWorker: async ({ workerId }) => {
        count += 1;
        return {
          workerId,
          status: "success",
          output: count === 1 ? "Option A from worker one is detailed and long." : "Option B from worker two is detailed and long.",
          model: "openai/gpt-5.1",
        };
      },
    });

    assert.equal(result.finalStatus, "disagreement");
    assert.equal(result.decision.disagreement, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("low-confidence output is detected", () => {
  const decision = arbitrate([
    { workerId: "w1", status: "success", output: "not sure", latencyMs: 10 },
  ]);
  assert.equal(decision.lowConfidence, true);
});

test("replay is metadata-only and deterministic", async () => {
  const root = await mkdtemp(join(tmpdir(), "oc-supervisor-"));
  try {
    await runSupervised({
      request: { runId: "run-3", taskId: "task-3", task: "capital of france" },
      stateDir: root,
      pluginConfig: { defaultFanout: "single", highImportanceFanout: "multi" },
      runWorker: successWorker(CONFIDENT_OUTPUT),
    });

    const logRoot = buildLogRoot(root, "run-3");
    const first = await replayRunDecision(logRoot);
    const second = await replayRunDecision(logRoot);

    assert.ok(first);
    assert.deepEqual(first, second);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("plugin tool is gated off by default", async () => {
  delete process.env.OPENCLAW_SUPERVISOR_ENABLED;

  const registered = [];
  const api = {
    pluginConfig: {},
    logger: { info() { }, warn() { }, error() { }, debug() { } },
    registerTool(tool) {
      registered.push(tool);
    },
    runtime: {
      config: {
        async loadConfig() {
          return {};
        },
      },
      state: {
        resolveStateDir() {
          return "/tmp/openclaw-state";
        },
      },
    },
  };

  pluginEntry.register(api);
  assert.equal(registered.length, 2);

  const runTool = registered.find(tool => tool.name === "supervisor_run");
  assert.ok(runTool);

  const result = await runTool.execute("tool-1", { task: "hello" });
  const text = result.content?.[0]?.text || "";
  assert.match(text, /gate is off/i);
  assert.match(text, /gateSource: default-off/i);
  assert.match(text, /expectedLogRoot: .*supervisor\/runs\//i);
});

test("config gate enables tool when env override is absent", () => {
  const gate = resolveGate({ gateEnabled: true, gateEnvVar: "OPENCLAW_SUPERVISOR_ENABLED" }, {});

  assert.equal(gate.enabled, true);
  assert.equal(gate.source, "config:gateEnabled");
});

test("false-like env override forces gate off over config", () => {
  const gate = resolveGate(
    { gateEnabled: true, gateEnvVar: "OPENCLAW_SUPERVISOR_ENABLED" },
    { OPENCLAW_SUPERVISOR_ENABLED: "off" },
  );

  assert.equal(gate.enabled, false);
  assert.equal(gate.source, "env:OPENCLAW_SUPERVISOR_ENABLED");
});

test("true-like env override forces gate on over config", () => {
  const gate = resolveGate(
    { gateEnabled: false, gateEnvVar: "OPENCLAW_SUPERVISOR_ENABLED" },
    { OPENCLAW_SUPERVISOR_ENABLED: "1" },
  );

  assert.equal(gate.enabled, true);
  assert.equal(gate.source, "env:OPENCLAW_SUPERVISOR_ENABLED");
});

test("unknown env override value falls back to config gate", () => {
  const gate = resolveGate(
    { gateEnabled: true, gateEnvVar: "OPENCLAW_SUPERVISOR_ENABLED" },
    { OPENCLAW_SUPERVISOR_ENABLED: "maybe" },
  );

  assert.equal(gate.enabled, true);
  assert.equal(gate.source, "config:gateEnabled");
});

test("append-first events file keeps line-separated json events", async () => {
  const root = await mkdtemp(join(tmpdir(), "oc-supervisor-"));
  try {
    await runSupervised({
      request: { runId: "run-4", taskId: "task-4", task: "capital of france" },
      stateDir: root,
      pluginConfig: { defaultFanout: "single", highImportanceFanout: "multi" },
      runWorker: successWorker(CONFIDENT_OUTPUT),
    });

    const raw = await readFile(join(buildLogRoot(root, "run-4"), "events.jsonl"), "utf8");
    const lines = raw.split("\n").map(line => line.trim()).filter(Boolean);
    assert.ok(lines.length >= 6);
    for (const line of lines) {
      JSON.parse(line);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("worker throw still finalizes with final.json and error status", async () => {
  const root = await mkdtemp(join(tmpdir(), "oc-supervisor-"));
  try {
    const result = await runSupervised({
      request: { runId: "run-5", taskId: "task-5", task: "fail once" },
      stateDir: root,
      pluginConfig: { defaultFanout: "single", highImportanceFanout: "multi" },
      runWorker: async () => {
        throw new Error("invalid agent params: must have required property 'idempotencyKey'");
      },
    });

    assert.equal(result.finalStatus, "error");
    assert.equal(result.decision.selectedWorkerId, null);

    const logRoot = buildLogRoot(root, "run-5");
    const events = await readDecisionEvents(logRoot);
    const finalJson = JSON.parse(await readFile(join(logRoot, "final.json"), "utf8"));

    assert.ok(events.some(event => event.eventType === "WorkerCompleted" && event.status === "error"));
    assert.ok(events.some(event => event.eventType === "RunFinalized" && event.finalStatus === "error"));
    assert.equal(finalJson.finalStatus, "error");
    assert.equal(finalJson.decision.selectedWorkerId, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("supervisor_run sends deterministic idempotencyKey to subagent runtime", async () => {
  const registered = [];
  let subagentRunArgs = null;
  let subagentGetSessionArgs = null;
  const api = {
    pluginConfig: { gateEnabled: true },
    logger: { info() { }, warn() { }, error() { }, debug() { } },
    registerTool(tool) {
      registered.push(tool);
    },
    runtime: {
      config: {
        async loadConfig() {
          return {};
        },
      },
      state: {
        resolveStateDir() {
          return "/tmp/openclaw-state";
        },
      },
      agent: {
        resolveAgentIdentity() {
          return { id: "main" };
        },
        resolveAgentTimeoutMs() {
          return 1000;
        },
      },
      subagent: {
        async run(args) {
          subagentRunArgs = args;
          return { runId: "subagent-run-1" };
        },
        async waitForRun() {
          return {
            status: "ok",
            error: undefined,
          };
        },
        async getSessionMessages(args) {
          subagentGetSessionArgs = args;
          return {
            messages: [
              { role: "assistant", content: [{ type: "text", text: CONFIDENT_OUTPUT }] },
            ],
          };
        },
      },
    },
  };

  pluginEntry.register(api);
  const result = await registered[0].execute("tool-2", {
    task: "Return READY",
    runId: "run-6",
    workerAgentId: "main",
  });

  assert.equal(result.details.finalStatus, "success");
  assert.equal(
    subagentRunArgs.idempotencyKey,
    buildIdempotencyKey({
      runId: "run-6",
      workerId: "run-6-w1",
      task: "Return READY",
      workerAgentId: "main",
    }),
  );
  assert.equal(subagentGetSessionArgs.sessionKey, "agent:main:subagent:supervisor:run-6:run-6-w1");
});

test("worker status treats returned text as success without explicit completed status", () => {
  assert.equal(normalizeWorkerStatus({ status: "ok" }, "READY"), "success");
  assert.equal(normalizeWorkerStatus({ status: "timeout" }, "READY"), "error");
  assert.equal(normalizeWorkerStatus({ status: "error" }, "READY"), "error");
});

test("assistant output extraction supports common session message shapes", () => {
  assert.equal(extractAssistantOutput([{ role: "assistant", text: "READY" }]), "READY");
  assert.equal(
    extractAssistantOutput([{ role: "assistant", content: [{ type: "text", text: "READY" }] }]),
    "READY",
  );
  assert.equal(extractAssistantOutput([{ role: "user", text: "ignore" }]), "");
});

test("weak output triggers bounded retry and records retry events", async () => {
  const root = await mkdtemp(join(tmpdir(), "oc-supervisor-"));
  let calls = 0;
  try {
    const result = await runSupervised({
      request: { runId: "run-7", taskId: "task-7", task: "answer clearly" },
      stateDir: root,
      pluginConfig: {
        defaultFanout: "single",
        highImportanceFanout: "multi",
        maxRetriesPerWorker: 1,
      },
      runWorker: async ({ workerId }) => {
        calls += 1;
        return {
          workerId,
          status: "success",
          output: calls === 1 ? "READY" : CONFIDENT_OUTPUT,
          model: "openai/gpt-5.1",
        };
      },
    });

    assert.equal(result.finalStatus, "success");
    assert.equal(result.attemptSummary.retriesScheduled, 1);
    assert.equal(result.attemptSummary.totalAttempts, 2);

    const events = await readDecisionEvents(buildLogRoot(root, "run-7"));
    assert.ok(events.some(event => event.eventType === "RetryScheduled"));
    assert.ok(events.some(event => event.eventType === "RetryCompleted"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("supervisor_status tool returns recent runs", async () => {
  const registered = [];
  const root = await mkdtemp(join(tmpdir(), "oc-supervisor-"));
  try {
    const runId = "run-status-1";
    await runSupervised({
      request: { runId, taskId: `task-${runId}`, task: "capital of france" },
      stateDir: root,
      pluginConfig: { defaultFanout: "single", highImportanceFanout: "multi" },
      runWorker: successWorker(CONFIDENT_OUTPUT),
    });

    const api = {
      pluginConfig: { gateEnabled: true },
      logger: { info() { }, warn() { }, error() { }, debug() { } },
      registerTool(tool) {
        registered.push(tool);
      },
      runtime: {
        config: {
          async loadConfig() {
            return {};
          },
        },
        state: {
          resolveStateDir() {
            return root;
          },
        },
      },
    };

    pluginEntry.register(api);
    const statusTool = registered.find(tool => tool.name === "supervisor_status");
    assert.ok(statusTool);

    const result = await statusTool.execute("tool-status", { limit: 5 });
    assert.match(result.content?.[0]?.text ?? "", /totalRuns:/i);
    assert.equal(Array.isArray(result.details?.latest), true);
    assert.ok(result.details.latest.some(item => item.runId === runId));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("deterministic tie-break picks lexical workerId under disagreement", () => {
  const decision = arbitrate([
    {
      workerId: "worker-b",
      status: "success",
      output: "Alpha response includes enough detail for confidence and clarity.",
    },
    {
      workerId: "worker-a",
      status: "success",
      output: "Bravo response includes enough detail for confidence and clarity.",
    },
  ]);

  assert.equal(decision.disagreement, true);
  assert.equal(decision.selectedWorkerId, "worker-a");
});

test("malformed events lines are ignored while valid records are preserved", async () => {
  const root = await mkdtemp(join(tmpdir(), "oc-supervisor-"));
  try {
    const logRoot = buildLogRoot(root, "run-malformed");
    await mkdir(logRoot, { recursive: true });
    await writeFile(
      join(logRoot, "events.jsonl"),
      [
        JSON.stringify({ schemaVersion: 1, eventType: "RunStarted", runId: "run-malformed" }),
        "{ this is not valid json",
        JSON.stringify({ schemaVersion: 1, eventType: "RunFinalized", runId: "run-malformed" }),
      ].join("\n") + "\n",
      "utf8",
    );

    const events = await readDecisionEvents(logRoot);
    assert.equal(events.length, 2);
    assert.equal(events[0].eventType, "RunStarted");
    assert.equal(events[1].eventType, "RunFinalized");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("single-worker flagged run dispatches one verification worker", async () => {
  const root = await mkdtemp(join(tmpdir(), "oc-supervisor-"));
  const seenWorkerIds = [];
  try {
    const result = await runSupervised({
      request: { runId: "run-verify-single", taskId: "task-verify-single", task: "answer clearly" },
      stateDir: root,
      pluginConfig: {
        defaultFanout: "single",
        highImportanceFanout: "multi",
        maxRetriesPerWorker: 0,
        verificationOnFlaggedCases: true,
        maxVerificationWorkers: 1,
      },
      runWorker: async ({ workerId }) => {
        seenWorkerIds.push(workerId);
        if (workerId.endsWith("-w1")) {
          return { workerId, status: "success", output: "READY", model: "openai/gpt-5.1" };
        }
        return { workerId, status: "success", output: CONFIDENT_OUTPUT, model: "openai/gpt-5.1" };
      },
    });

    assert.equal(result.attemptSummary.verificationWorkersUsed, 1);
    assert.ok(seenWorkerIds.some(id => id.endsWith("-wv1")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("multi-worker runs do not dispatch verification worker", async () => {
  const root = await mkdtemp(join(tmpdir(), "oc-supervisor-"));
  const seenWorkerIds = [];
  try {
    const result = await runSupervised({
      request: {
        runId: "run-verify-multi",
        taskId: "task-verify-multi",
        task: "compare answers",
        fanoutHint: "multi",
      },
      stateDir: root,
      pluginConfig: {
        defaultFanout: "single",
        highImportanceFanout: "multi",
        maxRetriesPerWorker: 0,
        verificationOnFlaggedCases: true,
        maxVerificationWorkers: 1,
      },
      runWorker: async ({ workerId }) => {
        seenWorkerIds.push(workerId);
        return {
          workerId,
          status: "success",
          output: workerId.endsWith("-w1") ? "Option one with detail." : "Option two with detail.",
          model: "openai/gpt-5.1",
        };
      },
    });

    assert.equal(result.attemptSummary.verificationWorkersUsed, 0);
    assert.equal(seenWorkerIds.some(id => id.endsWith("-wv1")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("replay returns null when final.json is missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "oc-supervisor-"));
  try {
    const logRoot = buildLogRoot(root, "run-missing-final");
    await mkdir(logRoot, { recursive: true });
    await writeFile(
      join(logRoot, "events.jsonl"),
      JSON.stringify({
        schemaVersion: 1,
        eventType: "ArbitrationComputed",
        runId: "run-missing-final",
        disagreement: false,
        lowConfidence: false,
        selectedWorkerId: "run-missing-final-w1",
        rationale: "Selected worker.",
      }) + "\n",
      "utf8",
    );

    const replay = await replayRunDecision(logRoot);
    assert.equal(replay, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readFinalResult returns null for missing file but throws on malformed JSON", async () => {
  const root = await mkdtemp(join(tmpdir(), "oc-supervisor-"));
  try {
    const missingLogRoot = buildLogRoot(root, "run-missing-final-read");
    const missing = await readFinalResult(missingLogRoot);
    assert.equal(missing, null);

    const malformedLogRoot = buildLogRoot(root, "run-malformed-final-read");
    await mkdir(malformedLogRoot, { recursive: true });
    await writeFile(join(malformedLogRoot, "final.json"), "{ invalid json", "utf8");

    await assert.rejects(
      () => readFinalResult(malformedLogRoot),
      { name: "SyntaxError" },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("replay succeeds with ArbitrationComputed plus final.json even without RunFinalized", async () => {
  const root = await mkdtemp(join(tmpdir(), "oc-supervisor-"));
  try {
    const logRoot = buildLogRoot(root, "run-replay-no-finalized-event");
    await mkdir(logRoot, { recursive: true });

    await writeFile(
      join(logRoot, "events.jsonl"),
      [
        JSON.stringify({ schemaVersion: 1, eventType: "RunStarted", runId: "run-replay-no-finalized-event" }),
        JSON.stringify({
          schemaVersion: 1,
          eventType: "ArbitrationComputed",
          runId: "run-replay-no-finalized-event",
          disagreement: false,
          lowConfidence: false,
          selectedWorkerId: "run-replay-no-finalized-event-w1",
          rationale: "Selected worker.",
        }),
      ].join("\n") + "\n",
      "utf8",
    );

    await writeFile(
      join(logRoot, "final.json"),
      JSON.stringify({
        schemaVersion: 1,
        runId: "run-replay-no-finalized-event",
        taskId: "task-run-replay-no-finalized-event",
        finalStatus: "success",
        finalOutputHash: "abc",
        attemptSummary: { retriesScheduled: 0, totalAttempts: 1, verificationWorkersUsed: 0 },
      }, null, 2) + "\n",
      "utf8",
    );

    const replay = await replayRunDecision(logRoot);
    assert.ok(replay);
    assert.equal(replay.runId, "run-replay-no-finalized-event");
    assert.equal(replay.finalStatus, "success");
    assert.equal(replay.selectedWorkerId, "run-replay-no-finalized-event-w1");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("status snapshot marks run as missing-final when final artifact is unreadable", async () => {
  const root = await mkdtemp(join(tmpdir(), "oc-supervisor-"));
  try {
    const badRunRoot = join(root, "supervisor", "runs", "run-unreadable-final");
    await mkdir(badRunRoot, { recursive: true });
    await mkdir(join(badRunRoot, "final.json"), { recursive: true });

    const status = await readSupervisorStatus(root, 10);
    const item = status.latest.find(entry => entry.runId === "run-unreadable-final");
    assert.ok(item);
    assert.equal(item.finalStatus, "missing-final");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
