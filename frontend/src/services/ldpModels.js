export function buildTransitionMatrix(digits) {
  const m = Array.from({ length: 10 }, () => Array(10).fill(0))
  for (let i = 1; i < digits.length; i++) {
    m[digits[i - 1]][digits[i]]++
  }
  return m
}

export function buildTrigramMatrix(digits) {
  const m = {}
  for (let i = 2; i < digits.length; i++) {
    const key = `${digits[i - 2]},${digits[i - 1]}`
    if (!m[key]) m[key] = Array(10).fill(0)
    m[key][digits[i]]++
  }
  return m
}

export function digitDistribution(digits) {
  const dist = Array(10).fill(0)
  for (const d of digits) dist[d]++
  return dist
}

export function frequencyModel(digits) {
  const dist = digitDistribution(digits)
  const total = dist.reduce((a, b) => a + b, 0) || 1
  return dist.map((c) => c / total)
}

export function markovModel(digits) {
  if (digits.length < 2) return Array(10).fill(0.1)
  const last = digits[digits.length - 1]
  const m = buildTransitionMatrix(digits)
  const row = m[last]
  const sum = row.reduce((a, b) => a + b, 0)
  if (sum === 0) return Array(10).fill(0.1)
  return row.map((c) => c / sum)
}

export function trigramModel(digits) {
  if (digits.length < 3) return Array(10).fill(0.1)
  const lastTwo = `${digits[digits.length - 2]},${digits[digits.length - 1]}`
  const m = buildTrigramMatrix(digits)
  const row = m[lastTwo]
  if (!row) return Array(10).fill(0.1)
  const sum = row.reduce((a, b) => a + b, 0)
  if (sum === 0) return Array(10).fill(0.1)
  return row.map((c) => c / sum)
}

export function gapModel(digits) {
  const probs = Array(10).fill(0)
  const lastPos = {}
  for (let i = 0; i < digits.length; i++) {
    lastPos[digits[i]] = i
  }
  if (Object.keys(lastPos).length < 10) return Array(10).fill(0.1)
  const currentPos = digits.length - 1
  let totalGap = 0
  const gaps = []
  for (let d = 0; d < 10; d++) {
    const gap = currentPos - (lastPos[d] ?? 0)
    gaps.push(gap)
    totalGap += gap
  }
  if (totalGap === 0) return Array(10).fill(0.1)
  for (let d = 0; d < 10; d++) {
    probs[d] = gaps[d] / totalGap
  }
  return probs
}

export function oddEvenModel(digits) {
  if (digits.length === 0) return { odd: 0.5, even: 0.5 }
  let oddCount = 0
  for (const d of digits) {
    if (d % 2 === 1) oddCount++
  }
  const oddProb = oddCount / digits.length
  return { odd: oddProb, even: 1 - oddProb }
}

export function highLowModel(digits) {
  if (digits.length === 0) return { high: 0.5, low: 0.5 }
  let highCount = 0
  for (const d of digits) {
    if (d >= 5) highCount++
  }
  const highProb = highCount / digits.length
  return { high: highProb, low: 1 - highProb }
}

export function rangeModel(digits) {
  const ranges = [
    { name: '0-2', min: 0, max: 2, probs: [1 / 3, 1 / 3, 1 / 3, 0, 0, 0, 0, 0, 0, 0] },
    { name: '3-6', min: 3, max: 6, probs: [0, 0, 0, 1 / 4, 1 / 4, 1 / 4, 1 / 4, 0, 0, 0] },
    { name: '7-9', min: 7, max: 9, probs: [0, 0, 0, 0, 0, 0, 0, 1 / 3, 1 / 3, 1 / 3] },
  ]
  const dist = digitDistribution(digits)
  const total = dist.reduce((a, b) => a + b, 0) || 1
  let bestRange = null
  let bestScore = -1
  for (const r of ranges) {
    let score = 0
    for (let d = r.min; d <= r.max; d++) score += dist[d]
    score /= total
    if (score > bestScore) {
      bestScore = score
      bestRange = r
    }
  }
  return bestRange ? bestRange.probs : Array(10).fill(0.1)
}

export function ensembleModel(digits, weights = null) {
  if (digits.length === 0) return { probs: Array(10).fill(0.1), confidence: 0, metadata: {} }
  const models = weights || {
    frequency: 0.15,
    markov: 0.15,
    trigram: 0.10,
    gap: 0.15,
    range: 0.15,
    oddEven: 0.10,
    highLow: 0.10,
    momentum: 0.10,
  }
  const results = {
    frequency: frequencyModel(digits),
    markov: markovModel(digits),
    trigram: trigramModel(digits),
    gap: gapModel(digits),
    range: rangeModel(digits),
  }
  results.oddEven = oddEvenModel(digits)
  results.highLow = highLowModel(digits)
  results.momentum = momentumModel(digits)

  const probs = Array(10).fill(0)
  const metadata = {}
  for (const [name, probsArr] of Object.entries(results)) {
    const w = weights ? (weights[name] ?? 0.1) : 0.1
    if (name === 'oddEven' || name === 'highLow') {
      for (let d = 0; d < 10; d++) {
        if (name === 'oddEven') {
          probs[d] += (d % 2 === 1 ? probsArr.odd : probsArr.even) * w
        } else {
          probs[d] += (d >= 5 ? probsArr.high : probsArr.low) * w
        }
      }
      metadata[name] = { ...probsArr }
    } else {
      for (let d = 0; d < 10; d++) {
        probs[d] += probsArr[d] * w
      }
      metadata[name] = { top: probsArr.indexOf(Math.max(...probsArr)), prob: Math.max(...probsArr) }
    }
  }

  const maxProb = Math.max(...probs)
  const sumProb = probs.reduce((a, b) => a + b, 0)
  const predicted = probs.indexOf(maxProb)
  const confidence = sumProb > 0 ? maxProb / sumProb : 0

  return { probs, predicted, confidence, metadata }
}

export function momentumModel(digits) {
  if (digits.length < 5) return Array(10).fill(0.1)
  const recent = digits.slice(-5)
  const dir = recent[recent.length - 1] - recent[0]
  const probs = Array(10).fill(0.02)
  if (Math.abs(dir) <= 2) {
    const center = recent[recent.length - 1]
    for (let d = Math.max(0, center - 1); d <= Math.min(9, center + 1); d++) {
      probs[d] = 0.15
    }
  } else if (dir > 0) {
    for (let d = 5; d < 10; d++) probs[d] = 0.12
    for (let d = 0; d < 5; d++) probs[d] = 0.08
  } else {
    for (let d = 0; d < 5; d++) probs[d] = 0.12
    for (let d = 5; d < 10; d++) probs[d] = 0.08
  }
  return probs
}

export function predictOddEven(digits) {
  const oe = oddEvenModel(digits)
  const predicted = oe.odd > oe.even ? 'odd' : 'even'
  const confidence = Math.max(oe.odd, oe.even)
  return { predicted, confidence, odd: oe.odd, even: oe.even }
}

export function predictHighLow(digits) {
  const hl = highLowModel(digits)
  const predicted = hl.high > hl.low ? 'high' : 'low'
  const confidence = Math.max(hl.high, hl.low)
  return { predicted, confidence, high: hl.high, low: hl.low }
}

export function computeAccuracy(predictions) {
  if (predictions.length === 0) return { correct: 0, total: 0, pct: 0 }
  const correct = predictions.filter((p) => p.correct).length
  return { correct, total: predictions.length, pct: (correct / predictions.length) * 100 }
}
