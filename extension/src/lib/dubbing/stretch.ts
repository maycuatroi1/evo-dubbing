const WINDOW_SEC = 0.05;
const SEARCH_SEC = 0.015;

function hann(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  return w;
}

function bestOffset(
  guide: Float32Array,
  refStart: number,
  target: number,
  search: number,
  windowLen: number,
  stride: number
): number {
  const maxStart = guide.length - windowLen;
  const fallback = Math.max(0, Math.min(maxStart, target));
  if (refStart < 0 || refStart + windowLen > guide.length) return fallback;

  const lo = Math.max(0, target - search);
  const hi = Math.min(maxStart, target + search);
  let bestP = fallback;
  let bestScore = -Infinity;
  for (let p = lo; p <= hi; p++) {
    let score = 0;
    for (let n = 0; n < windowLen; n += stride) {
      score += guide[p + n] * guide[refStart + n];
    }
    if (score > bestScore) {
      bestScore = score;
      bestP = p;
    }
  }
  return bestP;
}

export function timeCompress(ctx: AudioContext, buffer: AudioBuffer, rate: number): AudioBuffer {
  if (rate <= 1.01 || buffer.duration < 0.2) return buffer;

  const sr = buffer.sampleRate;
  let windowLen = Math.round(WINDOW_SEC * sr);
  if (windowLen % 2 === 1) windowLen++;
  const synthesisHop = windowLen >> 1;
  const analysisHop = Math.round(synthesisHop * rate);
  const search = Math.round(SEARCH_SEC * sr);
  const stride = Math.max(1, windowLen >> 9);
  const win = hann(windowLen);

  const outLen = Math.max(1, Math.floor(buffer.length / rate));
  const capacity = outLen + windowLen;

  const guide = buffer.getChannelData(0);
  const positions: number[] = [0];
  let prevP = 0;
  let frame = 1;
  while (frame * synthesisHop + windowLen <= capacity) {
    const target = frame * analysisHop;
    if (target + windowLen >= buffer.length) break;
    const best = bestOffset(guide, prevP + synthesisHop, target, search, windowLen, stride);
    positions.push(best);
    prevP = best;
    frame++;
  }

  const out = ctx.createBuffer(buffer.numberOfChannels, outLen, sr);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const input = buffer.getChannelData(ch);
    const acc = new Float32Array(capacity);
    for (let f = 0; f < positions.length; f++) {
      const outPos = f * synthesisHop;
      const inPos = positions[f];
      for (let n = 0; n < windowLen; n++) acc[outPos + n] += input[inPos + n] * win[n];
    }
    out.copyToChannel(acc.subarray(0, outLen), ch);
  }
  return out;
}
