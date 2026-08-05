export function buildTransitionMatrix(digits: number[]): number[][] {
  const m = Array.from({ length: 10 }, () => Array(10).fill(0));
  for (let i = 1; i < digits.length; i++) {
    m[digits[i - 1]][digits[i]]++;
  }
  return m;
}

export function buildTrigramMatrix(digits: number[]): Record<string, number[]> {
  const m: Record<string, number[]> = {};
  for (let i = 2; i < digits.length; i++) {
    const key = `${digits[i - 2]},${digits[i - 1]}`;
    if (!m[key]) m[key] = Array(10).fill(0);
    m[key][digits[i]]++;
  }
  return m;
}

export function digitDistribution(digits: number[]): number[] {
  const dist = Array(10).fill(0);
  for (const d of digits) dist[d]++;
  return dist;
}

export function frequencyModel(digits: number[]): number[] {
  const dist = digitDistribution(digits);
  const total = dist.reduce((a, b) => a + b, 0) || 1;
  return dist.map((c) => c / total);
}

export function markovModel(digits: number[]): number[] {
  if (digits.length < 2) return Array(10).fill(0.1);
  const last = digits[digits.length - 1];
  const m = buildTransitionMatrix(digits);
  const row = m[last];
  const sum = row.reduce((a, b) => a + b, 0);
  if (sum === 0) return Array(10).fill(0.1);
  return row.map((c) => c / sum);
}

export function trigramModel(digits: number[]): number[] {
  if (digits.length < 3) return Array(10).fill(0.1);
  const lastTwo = `${digits[digits.length - 2]},${digits[digits.length - 1]}`;
  const m = buildTrigramMatrix(digits);
  const row = m[lastTwo];
  if (!row) return Array(10).fill(0.1);
  const sum = row.reduce((a, b) => a + b, 0);
  if (sum === 0) return Array(10).fill(0.1);
  return row.map((c) => c / sum);
}

export function gapModel(digits: number[]): number[] {
  const probs = Array(10).fill(0);
  const lastPos: Record<number, number> = {};
  for (let i = 0; i < digits.length; i++) {
    lastPos[digits[i]] = i;
  }
  if (Object.keys(lastPos).length < 10) return Array(10).fill(0.1);
  const currentPos = digits.length - 1;
  const gaps: number[] = [];
  let totalGap = 0;
  for (let d = 0; d < 10; d++) {
    const gap = currentPos - (lastPos[d] ?? 0);
    gaps.push(gap);
    totalGap += gap;
  }
  if (totalGap === 0) return Array(10).fill(0.1);
  for (let d = 0; d < 10; d++) {
    probs[d] = gaps[d] / totalGap;
  }
  return probs;
}

export function oddEvenModel(digits: number[]): { odd: number; even: number } {
  if (digits.length === 0) return { odd: 0.5, even: 0.5 };
  let oddCount = 0;
  for (const d of digits) {
    if (d % 2 === 1) oddCount++;
  }
  const oddProb = oddCount / digits.length;
  return { odd: oddProb, even: 1 - oddProb };
}

export function highLowModel(digits: number[]): { high: number; low: number } {
  if (digits.length === 0) return { high: 0.5, low: 0.5 };
  let highCount = 0;
  for (const d of digits) {
    if (d >= 5) highCount++;
  }
  const highProb = highCount / digits.length;
  return { high: highProb, low: 1 - highProb };
}

interface RangeDef {
  name: string;
  min: number;
  max: number;
  probs: number[];
}

export function rangeModel(digits: number[]): number[] {
  const ranges: RangeDef[] = [
    { name: "0-2", min: 0, max: 2, probs: [1 / 3, 1 / 3, 1 / 3, 0, 0, 0, 0, 0, 0, 0] },
    { name: "3-6", min: 3, max: 6, probs: [0, 0, 0, 1 / 4, 1 / 4, 1 / 4, 1 / 4, 0, 0, 0] },
    { name: "7-9", min: 7, max: 9, probs: [0, 0, 0, 0, 0, 0, 0, 1 / 3, 1 / 3, 1 / 3] },
  ];
  const dist = digitDistribution(digits);
  const total = dist.reduce((a, b) => a + b, 0) || 1;
  let bestRange: RangeDef | null = null;
  let bestScore = -1;
  for (const r of ranges) {
    let score = 0;
    for (let d = r.min; d <= r.max; d++) score += dist[d];
    score /= total;
    if (score > bestScore) {
      bestScore = score;
      bestRange = r;
    }
  }
  return bestRange ? bestRange.probs : Array(10).fill(0.1);
}

export interface EnsembleResult {
  probs: number[];
  predicted: number;
  confidence: number;
  metadata: Record<string, unknown>;
}

export function momentumModel(digits: number[]): number[] {
  if (digits.length < 5) return Array(10).fill(0.1);
  const recent = digits.slice(-5);
  const dir = recent[recent.length - 1] - recent[0];
  const probs = Array(10).fill(0.02);
  if (Math.abs(dir) <= 2) {
    const center = recent[recent.length - 1];
    for (let d = Math.max(0, center - 1); d <= Math.min(9, center + 1); d++) {
      probs[d] = 0.15;
    }
  } else if (dir > 0) {
    for (let d = 5; d < 10; d++) probs[d] = 0.12;
    for (let d = 0; d < 5; d++) probs[d] = 0.08;
  } else {
    for (let d = 0; d < 5; d++) probs[d] = 0.12;
    for (let d = 5; d < 10; d++) probs[d] = 0.08;
  }
  return probs;
}

export function ensembleModel(digits: number[], weights: Record<string, number> | null = null): EnsembleResult {
  if (digits.length === 0) return { probs: Array(10).fill(0.1), predicted: 0, confidence: 0, metadata: {} };
  const results: Record<string, number[] | { odd: number; even: number } | { high: number; low: number }> = {
    frequency: frequencyModel(digits),
    markov: markovModel(digits),
    trigram: trigramModel(digits),
    gap: gapModel(digits),
    range: rangeModel(digits),
  };
  results.oddEven = oddEvenModel(digits);
  results.highLow = highLowModel(digits);
  results.momentum = momentumModel(digits);

  const probs = Array(10).fill(0);
  const metadata: Record<string, unknown> = {};
  for (const [name, probsArr] of Object.entries(results)) {
    const w = weights ? weights[name] ?? 0.1 : 0.1;
    if (name === "oddEven" || name === "highLow") {
      for (let d = 0; d < 10; d++) {
        if (name === "oddEven") {
          probs[d] += (d % 2 === 1 ? (probsArr as { odd: number; even: number }).odd : (probsArr as { odd: number; even: number }).even) * w;
        } else {
          probs[d] += (d >= 5 ? (probsArr as { high: number; low: number }).high : (probsArr as { high: number; low: number }).low) * w;
        }
      }
      metadata[name] = { ...(probsArr as object) };
    } else {
      const arr = probsArr as number[];
      const max = Math.max(...arr);
      for (let d = 0; d < 10; d++) {
        probs[d] += arr[d] * w;
      }
      metadata[name] = { top: arr.indexOf(max), prob: max };
    }
  }

  const maxProb = Math.max(...probs);
  const sumProb = probs.reduce((a, b) => a + b, 0);
  const predicted = probs.indexOf(maxProb);
  const confidence = sumProb > 0 ? maxProb / sumProb : 0;

  return { probs, predicted, confidence, metadata };
}

export function predictOddEven(digits: number[]): { predicted: string; confidence: number; odd: number; even: number } {
  const oe = oddEvenModel(digits);
  const predicted = oe.odd > oe.even ? "odd" : "even";
  const confidence = Math.max(oe.odd, oe.even);
  return { predicted, confidence, odd: oe.odd, even: oe.even };
}

export function predictHighLow(digits: number[]): { predicted: string; confidence: number; high: number; low: number } {
  const hl = highLowModel(digits);
  const predicted = hl.high > hl.low ? "high" : "low";
  const confidence = Math.max(hl.high, hl.low);
  return { predicted, confidence, high: hl.high, low: hl.low };
}

export function computeAccuracy(predictions: { correct: boolean }[]): { correct: number; total: number; pct: number } {
  if (predictions.length === 0) return { correct: 0, total: 0, pct: 0 };
  const correct = predictions.filter((p) => p.correct).length;
  return { correct, total: predictions.length, pct: (correct / predictions.length) * 100 };
}