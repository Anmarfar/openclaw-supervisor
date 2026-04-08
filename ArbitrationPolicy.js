import { createHash } from "node:crypto";

const MIN_CONFIDENCE_LENGTH = 20;
const UNCERTAINTY_MARKERS = [
  "i'm not sure",
  "i am not sure",
  "i don't know",
  "i do not know",
  "uncertain",
  "not enough information",
];

function normalizeText(text) {
  return String(text ?? "").trim().replace(/\s+/g, " ");
}

function digestNormalizedText(text) {
  return createHash("sha256").update(normalizeText(text)).digest("hex");
}

export function isLowConfidence(text) {
  const cleaned = normalizeText(text);
  if (cleaned.length < MIN_CONFIDENCE_LENGTH) return true;

  const lower = cleaned.toLowerCase();
  return UNCERTAINTY_MARKERS.some(marker => lower.includes(marker));
}

export function isWeakOutput(text) {
  return isLowConfidence(text);
}

function deliveryTier(outcome) {
  if (outcome?.status !== "success") return 0;
  return normalizeText(outcome?.output).length > 0 ? 2 : 1;
}

function certaintyTier(output) {
  if (!output) return 0;
  if (isWeakOutput(output)) return 0;
  if (output.length < 60) return 1;
  return 2;
}

function substanceScore(output) {
  if (!output) return 0;
  return Math.min(200, output.length);
}

function buildConsensusMap(outcomes) {
  const map = new Map();
  for (const outcome of outcomes) {
    if (outcome?.status !== "success") continue;
    const output = normalizeText(outcome.output);
    if (!output) continue;
    const key = digestNormalizedText(output);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

function buildAssessment(outcome, consensusMap) {
  const output = normalizeText(outcome?.output);
  const hasOutput = output.length > 0;
  const outputHash = hasOutput ? digestNormalizedText(output) : null;
  const consensusCount = outputHash ? (consensusMap.get(outputHash) ?? 1) : 0;
  const delivery = deliveryTier(outcome);
  const certainty = certaintyTier(output);
  const substance = substanceScore(output);

  const score =
    (delivery * 1000)
    + (certainty * 300)
    + (Math.min(4, consensusCount) * 60)
    + substance;

  return {
    workerId: outcome?.workerId,
    status: outcome?.status,
    output,
    weakOutput: certainty === 0,
    hasOutput,
    outputHash,
    delivery,
    certainty,
    consensusCount,
    substance,
    score,
  };
}

function compareAssessments(left, right) {
  if (right.delivery !== left.delivery) return right.delivery - left.delivery;
  if (right.certainty !== left.certainty) return right.certainty - left.certainty;
  if (right.consensusCount !== left.consensusCount) return right.consensusCount - left.consensusCount;
  if (right.substance !== left.substance) return right.substance - left.substance;
  return String(left.workerId).localeCompare(String(right.workerId));
}

function chooseWinner(assessments) {
  const ranked = [...assessments].sort(compareAssessments);
  const selected = ranked.find(item => item.status === "success" && item.hasOutput) ?? ranked[0] ?? null;
  return { ranked, selected };
}

function detectDisagreement(successful) {
  const hashes = successful
    .map(item => normalizeText(item.output))
    .filter(Boolean)
    .map(digestNormalizedText);
  return new Set(hashes).size > 1;
}

function detectLowConfidence(selected, ranked, disagreement) {
  if (!selected) return true;
  if (selected.delivery < 2) return true;
  if (selected.certainty === 0) return true;

  if (disagreement) {
    const runnerUp = ranked.find(item => item.workerId !== selected.workerId) ?? null;
    if (!runnerUp) return false;

    const similarlyStrong =
      runnerUp.delivery === selected.delivery
      && runnerUp.certainty === selected.certainty
      && Math.abs(runnerUp.substance - selected.substance) < 25;

    if (similarlyStrong && selected.consensusCount <= 1) return true;
  }

  return false;
}

export function arbitrate(outcomes) {
  if (!Array.isArray(outcomes) || outcomes.length === 0) {
    return {
      selectedWorkerId: null,
      selectedOutput: null,
      disagreement: false,
      lowConfidence: true,
      rationale: "No worker outcomes provided.",
    };
  }

  const successful = outcomes.filter(outcome => outcome?.status === "success");
  if (successful.length === 0) {
    return {
      selectedWorkerId: null,
      selectedOutput: null,
      disagreement: false,
      lowConfidence: true,
      rationale: "All workers failed or timed out.",
      rankedOutcomes: [],
    };
  }

  const consensusMap = buildConsensusMap(successful);
  const assessments = outcomes.map(outcome => buildAssessment(outcome, consensusMap));
  const { ranked, selected } = chooseWinner(assessments);
  const disagreement = detectDisagreement(successful);
  const lowConfidence = detectLowConfidence(selected, ranked, disagreement);

  return {
    selectedWorkerId: selected.workerId,
    selectedOutput: selected.output,
    disagreement,
    lowConfidence,
    rationale: disagreement
      ? `Workers disagreed across ${successful.length} successful results. Selected ${selected.workerId} (score=${selected.score}).`
      : `Workers agreed. Selected ${selected.workerId} (score=${selected.score}).`,
    rankedOutcomes: ranked.map(item => ({
      workerId: item.workerId,
      status: item.status,
      score: item.score,
      weakOutput: item.weakOutput,
      hasOutput: item.hasOutput,
      outputHash: item.outputHash,
    })),
  };
}
