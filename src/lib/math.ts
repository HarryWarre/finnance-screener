export function sma(data: number[], length: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < length - 1) {
      result.push(NaN);
      continue;
    }
    let sum = 0;
    for (let j = 0; j < length; j++) {
      sum += data[i - j];
    }
    result.push(sum / length);
  }
  return result;
}

export function stdev(data: number[], length: number, smaData?: number[]): number[] {
  const result: number[] = [];
  const meanData = smaData || sma(data, length);
  
  for (let i = 0; i < data.length; i++) {
    if (i < length - 1 || isNaN(meanData[i])) {
      result.push(NaN);
      continue;
    }
    let sumSq = 0;
    for (let j = 0; j < length; j++) {
      const diff = data[i - j] - meanData[i];
      sumSq += diff * diff;
    }
    // PineScript uses population standard deviation by default (n instead of n-1)
    result.push(Math.sqrt(sumSq / length));
  }
  return result;
}

export function highest(data: number[], length: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < length - 1) {
      result.push(NaN);
      continue;
    }
    let max = data[i];
    for (let j = 1; j < length; j++) {
      if (data[i - j] > max) max = data[i - j];
    }
    result.push(max);
  }
  return result;
}

export function lowest(data: number[], length: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < length - 1) {
      result.push(NaN);
      continue;
    }
    let min = data[i];
    for (let j = 1; j < length; j++) {
      if (data[i - j] < min) min = data[i - j];
    }
    result.push(min);
  }
  return result;
}

export interface StatArbResult {
  zScore: number;
  beta: number;
  hurst: number;
  signal: number; // 0 = none, 1 = Long, -1 = Short, 2 = Long (Wait), -2 = Short (Wait), 99 = Excluded
}

/**
 * fZ calculates the Z-Score, Beta, and Hurst exponent for a pair of prices
 * @param y Prices of asset Y (Array)
 * @param x Prices of asset X (Array)
 * @param length Lookback window
 * @param threshold Z-Score threshold
 * @param fund_pass Did both assets pass fundamental filter?
 */
export function calculateStatArb(
  y: number[],
  x: number[],
  length: number,
  threshold: number,
  fund_pass: boolean = true
): StatArbResult {
  if (!y || !x || y.length === 0 || x.length === 0 || x[x.length - 1] === 0) {
    return { zScore: 0, beta: 0, hurst: 0.5, signal: 0 };
  }
  
  if (!fund_pass) {
    return { zScore: 0, beta: 0, hurst: 0.5, signal: 99 };
  }

  // Ensure same length
  const minLen = Math.min(y.length, x.length);
  const truncY = y.slice(y.length - minLen);
  const truncX = x.slice(x.length - minLen);

  if (minLen < length) {
    return { zScore: 0, beta: 0, hurst: 0.5, signal: 0 };
  }

  // Calculate ratio Y/X
  const ratio = truncY.map((vy, i) => vy / truncX[i]);
  const betaArr = sma(ratio, length);
  
  // Calculate spread = Y - Beta * X
  const spread: number[] = [];
  for (let i = 0; i < minLen; i++) {
    spread.push(truncY[i] - (betaArr[i] || 0) * truncX[i]);
  }

  const currentBeta = betaArr[betaArr.length - 1];
  const currentSpread = spread[spread.length - 1];
  const prevSpread = spread[spread.length - 2] || currentSpread;
  const spreadMom = currentSpread - prevSpread;

  const devArr = stdev(spread, length);
  const currentDev = devArr[devArr.length - 1];

  const spreadSmaArr = sma(spread, length);
  const currentSpreadSma = spreadSmaArr[spreadSmaArr.length - 1];

  let zScore = 0;
  if (currentDev !== 0 && !isNaN(currentDev)) {
    zScore = (currentSpread - currentSpreadSma) / currentDev;
  }

  const maxSpreadArr = highest(spread, length);
  const minSpreadArr = lowest(spread, length);
  const currentMax = maxSpreadArr[maxSpreadArr.length - 1];
  const currentMin = minSpreadArr[minSpreadArr.length - 1];

  let rs = 0;
  if (currentDev !== 0 && !isNaN(currentDev)) {
    rs = (currentMax - currentMin) / currentDev;
  }

  let hurst = 0.5;
  if (rs > 0) {
    hurst = Math.log(rs) / Math.log(length);
  }

  let signal = 0;
  if (zScore >= threshold) {
    signal = spreadMom < 0 ? -1 : -2;
  } else if (zScore <= -threshold) {
    signal = spreadMom > 0 ? 1 : 2;
  }

  return {
    zScore: isNaN(zScore) ? 0 : zScore,
    beta: isNaN(currentBeta) ? 0 : currentBeta,
    hurst: isNaN(hurst) ? 0.5 : hurst,
    signal
  };
}
