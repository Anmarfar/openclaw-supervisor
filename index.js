import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildLogRoot, hashText } from "./DecisionLogStore.js";
import { runSupervised } from "./SupervisorOrchestrator.js";

function clampBinaryPolicy(value, fallback) {
  if (!Number.isInteger(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function getPluginConfig(api) {
  const raw = api.pluginConfig ?? {};
  return {
    gateEnabled: raw.gateEnabled === true,
    gateEnvVar: typeof raw.gateEnvVar === "string" && raw.gateEnvVar.trim()
      ? raw.gateEnvVar
      : "OPENCLAW_SUPERVISOR_ENABLED",
    defaultFanout: raw.defaultFanout === "multi" ? "multi" : "single",
    highImportanceFanout: raw.highImportanceFanout === "single" ? "single" : "multi",
    maxRetriesPerWorker: clampBinaryPolicy(raw.maxRetriesPerWorker, 1),
    verificationOnFlaggedCases: raw.verificationOnFlaggedCases !== false,
    maxVerificationWorkers: clampBinaryPolicy(raw.maxVerificationWorkers, 1),
  };
}

function parseBooleanOverride(value) {
  if (value === undefined || value === null) return null;

  const normalized = String(value).toLowerCase().trim();
  if (!normalized) return null;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  return null;
}

function resolveGate(pluginConfig, env = process.env) {
  const envValue = parseBooleanOverride(env[pluginConfig.gateEnvVar]);
  if (envValue === false) {
    return {
      enabled: false,
      source: `env:${pluginConfig.gateEnvVar}`,
      reason: "env override forced off",
    };
  }

  if (envValue === true) {
    return {
      enabled: true,
      source: `env:${pluginConfig.gateEnvVar}`,
      reason: "env override forced on",
    };
  }

  if (pluginConfig.gateEnabled === true) {
    return {
      enabled: true,
      source: "config:gateEnabled",
      reason: "plugin config enabled",
    };
  }

  return {
    enabled: false,
    source: "default-off",
    reason: "plugin config disabled",
  };
}

function textResult(text, details = {}) {
  return { content: [{ type: "text", text }], details };
}

function buildIdempotencyKey({ runId, workerId, task, workerAgentId }) {
  return `supervisor:${runId}:${workerId}:${workerAgentId}:${hashText(task)}`;
}

function normalizeLimit(limit) {
  if (!Number.isFinite(limit)) return 10;
  return Math.max(1, Math.min(50, Math.floor(limit)));
}

function parseRunSnapshot(runId, finalRaw) {
  try {
    const final = JSON.parse(finalRaw);
    return {
      runId,
      finalStatus: final.finalStatus,
      selectedWorkerId: final.decision?.selectedWorkerId ?? null,
      lowConfidence: final.decision?.lowConfidence ?? null,
      retriesScheduled: final.attemptSummary?.retriesScheduled ?? 0,
      totalAttempts: final.attemptSummary?.totalAttempts ?? 0,
      timestamp: final.timestamp ?? null,
    };
  } catch {
    return {
      runId,
      finalStatus: "missing-final",
      selectedWorkerId: null,
      lowConfidence: null,
      retriesScheduled: 0,
      totalAttempts: 0,
      timestamp: null,
    };
  }
}

async function readSupervisorStatus(stateDir, limit = 10) {
  const runsRoot = join(stateDir, "supervisor", "runs");
  let entries = [];
  try {
    entries = await readdir(runsRoot, { withFileTypes: true });
  } catch {
    return {
      runsRoot,
      totalRuns: 0,
      latest: [],
    };
  }

  const runDirs = entries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, limit);

  const latest = await Promise.all(
    runDirs.map(async (runId) => {
      try {
        const finalRaw = await readFile(join(runsRoot, runId, "final.json"), "utf8");
        return parseRunSnapshot(runId, finalRaw);
      } catch {
        return parseRunSnapshot(runId, "");
      }
    }),
  );

  return {
    runsRoot,
    totalRuns: entries.filter(entry => entry.isDirectory()).length,
    latest,
  };
}

function normalizeWorkerStatus(waitResult, output) {
  const status = typeof waitResult?.status === "string"
    ? waitResult.status.toLowerCase().trim()
    : "";

  if (status === "error" || status === "timeout") {
    return "error";
  }

  if (status === "ok") {
    return "success";
  }

  if (output) {
    return "success";
  }

  return "error";
}

function extractAssistantOutput(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return "";

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== "object") continue;

    const role = typeof message.role === "string" ? message.role.toLowerCase().trim() : "";
    if (role && role !== "assistant") continue;

    if (typeof message.text === "string" && message.text.trim()) {
      return message.text.trim();
    }

    if (typeof message.content === "string" && message.content.trim()) {
      return message.content.trim();
    }

    if (Array.isArray(message.content)) {
      const text = message.content
        .map((part) => {
          if (typeof part === "string") return part;
          if (part && typeof part === "object" && typeof part.text === "string") return part.text;
          return "";
        })
        .join("\n")
        .trim();
      if (text) return text;
    }
  }

  return "";
}

export default {
  // Plugin ID is "supervisor-phase1" (not renamed) because existing OpenClaw
  // deployments depend on this identifier in their config at:
  //   plugins.entries.supervisor-phase1.*
  // The repository is named "openclaw-supervisor" reflecting the project's
  // distinctive identity, but the runtime plugin ID is kept stable for
  // backward compatibility with deployed systems.
  id: "supervisor-phase1",
  name: "OpenClaw Supervisor",
  register(api) {
    const pluginConfig = getPluginConfig(api);

    const runTool = {
      name: "supervisor_run",
      label: "Supervisor Run",
      description: "Orchestrate a task with multi-worker coordination, deterministic arbitration and durable decision logs.",
      parameters: {
        type: "object",
        properties: {
          task: { type: "string" },
          runId: { type: "string" },
          importanceLevel: { type: "string", enum: ["low", "medium", "high"] },
          fanoutHint: { type: "string", enum: ["single", "multi"] },
          workerAgentId: { type: "string" }
        },
        required: ["task"],
        additionalProperties: false
      },
      async execute(_toolCallId, params) {
        const runtimeConfig = await api.runtime.config.loadConfig();
        const stateDir = api.runtime.state.resolveStateDir();
        const gate = resolveGate(pluginConfig);
        const requestedRunId = typeof params.runId === "string" && params.runId.trim()
          ? params.runId.trim()
          : "<runId>";
        const expectedLogRoot = buildLogRoot(stateDir, requestedRunId);

        if (!gate.enabled) {
          return textResult(
            [
              "Supervisor gate is off.",
              `effectiveGate: ${gate.enabled}`,
              `gateSource: ${gate.source}`,
              `gateReason: ${gate.reason}`,
              `expectedLogRoot: ${expectedLogRoot}`,
              `pluginEnabledHint: enable plugins.entries.supervisor-phase1.enabled and set plugins.entries.supervisor-phase1.config.gateEnabled=true or ${pluginConfig.gateEnvVar}=1`,
            ].join("\n"),
            {
              effectiveGate: gate.enabled,
              gateSource: gate.source,
              gateReason: gate.reason,
              expectedLogRoot,
            },
          );
        }

        const identity = api.runtime.agent.resolveAgentIdentity(runtimeConfig);
        const baseAgentId = identity?.id || "main";
        const workerAgentId = typeof params.workerAgentId === "string" && params.workerAgentId.trim()
          ? params.workerAgentId.trim()
          : baseAgentId;

        const runId = typeof params.runId === "string" && params.runId.trim() ? params.runId.trim() : randomUUID();

        const finalResult = await runSupervised({
          request: {
            runId,
            taskId: `task-${runId}`,
            task: String(params.task),
            importanceLevel: params.importanceLevel,
            fanoutHint: params.fanoutHint,
          },
          stateDir,
          pluginConfig,
          runWorker: async ({ task, workerId }) => {
            const sessionKey = `agent:${workerAgentId}:subagent:supervisor:${runId}:${workerId}`;
            const idempotencyKey = buildIdempotencyKey({
              runId,
              workerId,
              task,
              workerAgentId,
            });
            const launched = await api.runtime.subagent.run({
              sessionKey,
              idempotencyKey,
              message: task,
              deliver: false,
            });
            const settled = await api.runtime.subagent.waitForRun({
              runId: launched.runId,
              timeoutMs: api.runtime.agent.resolveAgentTimeoutMs(runtimeConfig),
            });

            let output = "";
            if (settled?.status === "ok") {
              const session = await api.runtime.subagent.getSessionMessages({
                sessionKey,
                limit: 10,
              });
              output = extractAssistantOutput(session?.messages);
            }

            const status = normalizeWorkerStatus(settled, output);
            return {
              workerId,
              status,
              output,
              model: settled?.model ?? null,
              errorMessage: typeof settled?.error === "string" && settled.error ? settled.error : null,
            };
          },
        });

        return textResult(
          [
            `runId: ${finalResult.runId}`,
            `finalStatus: ${finalResult.finalStatus}`,
            `gateSource: ${gate.source}`,
            `selectedWorkerId: ${finalResult.decision.selectedWorkerId ?? "none"}`,
            `disagreement: ${finalResult.decision.disagreement}`,
            `lowConfidence: ${finalResult.decision.lowConfidence}`,
            `rationale: ${finalResult.decision.rationale}`,
          ].join("\n"),
          {
            ...finalResult,
            gateSource: gate.source,
          },
        );
      },
    };

    const statusTool = {
      name: "supervisor_status",
      label: "Supervisor Status",
      description: "Show recent supervisor runs and compact diagnostics for rollout and operator checks.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number" },
        },
        additionalProperties: false,
      },
      async execute(_toolCallId, params) {
        const stateDir = api.runtime.state.resolveStateDir();
        const status = await readSupervisorStatus(stateDir, normalizeLimit(params?.limit));

        const lines = [
          `runsRoot: ${status.runsRoot}`,
          `totalRuns: ${status.totalRuns}`,
        ];

        for (const item of status.latest) {
          lines.push(
            [
              `runId=${item.runId}`,
              `finalStatus=${item.finalStatus}`,
              `selectedWorkerId=${item.selectedWorkerId ?? "none"}`,
              `lowConfidence=${item.lowConfidence ?? "n/a"}`,
              `retries=${item.retriesScheduled ?? 0}`,
              `attempts=${item.totalAttempts ?? 0}`,
            ].join(" "),
          );
        }

        return textResult(lines.join("\n"), status);
      },
    };

    api.registerTool(runTool);
    api.registerTool(statusTool);

    api.logger.info("supervisor-phase1 registered");
  },
};

export { buildIdempotencyKey, extractAssistantOutput, getPluginConfig, normalizeWorkerStatus, parseBooleanOverride, readSupervisorStatus, resolveGate };
