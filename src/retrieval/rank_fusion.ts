import { RetrievalIntent } from "../core/types";

export interface RankedCandidate {
  id: string;
  semanticRank?: number;
  semanticScore?: number;
  lexicalRank?: number;
  lexicalScore?: number;
  graphScore?: number;
  rerankScore?: number;
  sourceType?: string;
  timestamp?: number;
  decayMultiplier?: number;
  finalScore: number;
  reason: string;
}

export function calculateRRFScore(
  rank: number,
  weight = 1.0,
  k = 60
): number {
  return weight / (k + rank);
}

export function calculateTimeDecay(
  timestamp?: number,
  halfLifeDays = 14,
  minDecayFloor = 0.1,
  referenceTime = Date.now()
): number {
  if (!timestamp || timestamp <= 0) return 1.0;

  const ageMs = Math.max(0, referenceTime - timestamp);
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const decay = Math.pow(2, -ageDays / halfLifeDays);
  return Math.max(minDecayFloor, Math.min(1.0, decay));
}

export function reciprocalRankFusion(
  semanticRankings: Array<{ id: string; score: number; sourceType?: string; timestamp?: number }>,
  lexicalRankings: Array<{ id: string; score: number; sourceType?: string; timestamp?: number }>,
  graphRankings: Array<{ id: string; score: number; sourceType?: string; timestamp?: number }> = [],
  intent: RetrievalIntent = "general",
  k = 60,
  halfLifeDays = 14
): RankedCandidate[] {
  const candidateMap = new Map<string, RankedCandidate>();

  semanticRankings.forEach((item, rank) => {
    let semanticWeight = 1.0;
    if (intent === "exact_symbol") semanticWeight = 0.6;
    if (intent === "architecture" && item.sourceType === "architecture")
      semanticWeight = 1.5;

    const rrfScore = semanticWeight / (k + rank + 1);

    candidateMap.set(item.id, {
      id: item.id,
      semanticRank: rank + 1,
      semanticScore: item.score,
      sourceType: item.sourceType,
      timestamp: item.timestamp,
      finalScore: rrfScore,
      reason: `Semantic match (Cosine: ${item.score.toFixed(3)}, Rank: #${rank + 1})`,
    });
  });

  lexicalRankings.forEach((item, rank) => {
    let lexicalWeight = 1.0;
    if (intent === "exact_symbol") lexicalWeight = 2.5;
    if (intent === "implementation") lexicalWeight = 1.3;

    const rrfScore = lexicalWeight / (k + rank + 1);

    const existing = candidateMap.get(item.id);
    if (existing) {
      existing.lexicalRank = rank + 1;
      existing.lexicalScore = item.score;
      existing.finalScore += rrfScore;
      if (!existing.timestamp && item.timestamp) {
        existing.timestamp = item.timestamp;
      }
      existing.reason += ` + Lexical match (Rank: #${rank + 1})`;
    } else {
      candidateMap.set(item.id, {
        id: item.id,
        lexicalRank: rank + 1,
        lexicalScore: item.score,
        sourceType: item.sourceType,
        timestamp: item.timestamp,
        finalScore: rrfScore,
        reason: `Lexical match (Rank: #${rank + 1})`,
      });
    }
  });

  graphRankings.forEach((item, rank) => {
    let graphWeight = 1.2;
    if (intent === "architecture") graphWeight = 2.2;

    const rrfScore = graphWeight / (k + rank + 1);

    const existing = candidateMap.get(item.id);
    if (existing) {
      existing.graphScore = item.score;
      existing.finalScore += rrfScore;
      if (!existing.timestamp && item.timestamp) {
        existing.timestamp = item.timestamp;
      }
      existing.reason += ` + Graph Relation connection`;
    } else {
      candidateMap.set(item.id, {
        id: item.id,
        graphScore: item.score,
        sourceType: item.sourceType,
        timestamp: item.timestamp,
        finalScore: rrfScore,
        reason: `Graph architectural relation connection`,
      });
    }
  });

  const now = Date.now();
  for (const candidate of candidateMap.values()) {
    const decay = calculateTimeDecay(candidate.timestamp, halfLifeDays, 0.1, now);
    candidate.decayMultiplier = decay;
    candidate.finalScore = candidate.finalScore * decay;
    if (decay < 0.99) {
      candidate.reason += ` [TimeDecay: ${(decay * 100).toFixed(0)}%]`;
    }
  }

  return Array.from(candidateMap.values()).sort(
    (a, b) => b.finalScore - a.finalScore
  );
}
