import { derivService } from "./derivService";
import {
  ensembleModel,
  predictOddEven,
  predictHighLow,
  buildTransitionMatrix,
} from "./ldpModels";

const PATTERNS_2D = Array.from({ length: 100 }, (_, i) => String(i).padStart(2, "0"));

export interface PatternHeatmapEntry {
  count: number;
  predicted: number;
  confidence: number;
  probs: number[];
}

export function buildPatternHeatmap(digits: number[]): Record<string, PatternHeatmapEntry> {
  const heatmap: Record<string, { count: number; nextDigit: number[] }> = {};
  for (const p of PATTERNS_2D) {
    heatmap[p] = { count: 0, nextDigit: Array(10).fill(0) };
  }
  for (let i = 2; i < digits.length; i++) {
    const pattern = `${digits[i - 2]}${digits[i - 1]}`;
    if (heatmap[pattern]) {
      heatmap[pattern].count++;
      heatmap[pattern].nextDigit[digits[i]]++;
    }
  }
  const result: Record<string, PatternHeatmapEntry> = {};
  for (const [pattern, data] of Object.entries(heatmap)) {
    if (data.count < 1) continue;
    const total = data.nextDigit.reduce((a, b) => a + b, 0);
    if (total === 0) continue;
    const probs = data.nextDigit.map((c) => c / total);
    const maxProb = Math.max(...probs);
    const predicted = probs.indexOf(maxProb);
    result[pattern] = { count: data.count, predicted, confidence: maxProb, probs };
  }
  return result;
}

export interface TrendAnalysis {
  direction: string;
  description: string;
  last: number | null;
  avg: string | null;
  mode: number | null;
  streak: { digit: number | null; count: number };
}

export function analyzeRecentTrend(digits: number[]): TrendAnalysis {
  if (digits.length < 5) {
    return {
      direction: "neutral",
      description: "Not enough data",
      last: digits[digits.length - 1] ?? null,
      avg: null,
      mode: null,
      streak: { digit: null, count: 0 },
    };
  }
  const recent = digits.slice(-20);
  const last = recent[recent.length - 1];
  const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const freq = Array(10).fill(0);
  for (const d of recent) freq[d]++;
  const mode = freq.indexOf(Math.max(...freq));

  let streakCount = 0;
  for (let i = digits.length - 1; i >= 0; i--) {
    if (digits[i] === last) streakCount++;
    else break;
  }

  const dir = last - recent[recent.length - Math.min(5, recent.length)];
  let direction = "neutral";
  let description = "Flat trend - no clear direction";
  if (Math.abs(dir) >= 3) {
    direction = dir > 0 ? "up" : "down";
    description = dir > 0 ? "Strong upward trend ↗" : "Strong downward trend ↘";
  } else if (Math.abs(dir) >= 1) {
    direction = dir > 0 ? "slight_up" : "slight_down";
    description = dir > 0 ? "Slight upward trend ↗" : "Slight downward trend ↘";
  }

  return {
    direction,
    description,
    last,
    avg: avg.toFixed(1),
    mode,
    streak: { digit: last, count: streakCount },
  };
}

export interface AiRecommendation {
  action: string | null;
  confidence: number;
  reason: string;
  direction: string | null;
  tradeType: string | null;
  targetDigit: number | null;
  signal: string | null;
  ensemble: ReturnType<typeof ensembleModel>;
  oe: ReturnType<typeof predictOddEven>;
  hl: ReturnType<typeof predictHighLow>;
  heatmap: Record<string, PatternHeatmapEntry>;
  trend: TrendAnalysis;
}

export function computeAiRecommendation(digits: number[]): AiRecommendation {
  if (digits.length < 5) {
    return {
      action: null,
      confidence: 0,
      reason: "Analysing recent patterns…",
      direction: null,
      tradeType: null,
      targetDigit: null,
      signal: null,
      ensemble: { probs: Array(10).fill(0.1), predicted: 0, confidence: 0, metadata: {} },
      oe: { predicted: "even", confidence: 0.5, odd: 0.5, even: 0.5 },
      hl: { predicted: "low", confidence: 0.5, high: 0.5, low: 0.5 },
      heatmap: {},
      trend: {
        direction: "neutral",
        description: "Analysing recent patterns…",
        last: null,
        avg: null,
        mode: null,
        streak: { digit: null, count: 0 },
      },
    };
  }

  const windowed = digits.slice(-200);
  const ensemble = ensembleModel(windowed);
  const oe = predictOddEven(windowed);
  const hl = predictHighLow(windowed);
  const heatmap = buildPatternHeatmap(windowed);

  const lastTwo = windowed.slice(-2);
  const patternKey = lastTwo.length === 2 ? `${lastTwo[0]}${lastTwo[1]}` : null;
  const patternSignal = patternKey && heatmap[patternKey] ? heatmap[patternKey] : null;

  const trend = analyzeRecentTrend(windowed);

  let callScore = 0;
  let putScore = 0;
  const reasons: string[] = [];

  if (oe.confidence > 0.55) {
    if (oe.predicted === "odd") {
      callScore += oe.confidence * 0.3;
      reasons.push(`Odd bias (${(oe.confidence * 100).toFixed(0)}%)`);
    } else {
      putScore += oe.confidence * 0.3;
      reasons.push(`Even bias (${(oe.confidence * 100).toFixed(0)}%)`);
    }
  }

  if (hl.confidence > 0.55) {
    if (hl.predicted === "high") {
      callScore += hl.confidence * 0.3;
      reasons.push(`High bias (${(hl.confidence * 100).toFixed(0)}%)`);
    } else {
      putScore += hl.confidence * 0.3;
      reasons.push(`Low bias (${(hl.confidence * 100).toFixed(0)}%)`);
    }
  }

  if (patternSignal && patternSignal.confidence > 0.15) {
    const pConf = patternSignal.confidence;
    if (patternSignal.predicted >= 5) {
      callScore += pConf * 0.25;
    } else {
      putScore += pConf * 0.25;
    }
    reasons.push(`Pattern →${patternSignal.predicted} (${(pConf * 100).toFixed(0)}%)`);
  }

  if (trend.direction === "up") {
    callScore += 0.1;
    reasons.push("Up trend");
  } else if (trend.direction === "down") {
    putScore += 0.1;
    reasons.push("Down trend");
  }

  const predictedDigit = ensemble.predicted;
  if (predictedDigit >= 5) {
    callScore += ensemble.confidence * 0.15;
  } else {
    putScore += ensemble.confidence * 0.15;
  }

  const total = callScore + putScore;
  const confidence = total > 0 ? Math.max(callScore, putScore) / total : 0;

  const threshold = 0.52;
  let action: string | null = null;
  let direction: string | null = null;
  let signal: string | null = null;
  let reason = "Insufficient signal strength";

  if (confidence >= threshold) {
    if (callScore > putScore) {
      action = "CALL";
      direction = "CALL";
      signal = "RISE";
      reason = reasons.join(" · ");
    } else {
      action = "PUT";
      direction = "PUT";
      signal = "FALL";
      reason = reasons.join(" · ");
    }
  }

  const tradeType = oe.confidence > hl.confidence ? "EVEN/ODD" : "OVER/UNDER";
  const targetDigit =
    oe.confidence > hl.confidence ? (oe.predicted === "odd" ? 1 : 0) : hl.predicted === "high" ? 9 : 0;

  return {
    action,
    confidence: Math.round(confidence * 100),
    reason,
    direction,
    tradeType,
    targetDigit,
    signal,
    ensemble,
    oe,
    hl,
    heatmap,
    trend,
  };
}

export function computeSignals(digits: number[]) {
  return computeAiRecommendation(digits);
}

export { derivService };