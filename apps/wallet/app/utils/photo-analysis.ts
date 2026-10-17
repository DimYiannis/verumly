/**
 * Find the receipt in a phone photo and judge whether the photo is good enough to read. Pure and framework free
 * (typed arrays only, no DOM), so it runs in vitest and in the browser. The browser side lives in `prepare-photo.ts`.
 *
 * Why: the model's time grows with the image size, and a receipt that is a thin strip in a big frame made it run past
 * the worker's timeout (docs/QIANFAN-LIVE-CHECK.md, issue 1). Cropping to the paper before upload fixes that, and a photo
 * that cannot be read is better declined on the phone, with advice, than after minutes of waiting.
 *
 * Method, in order: shrink to a ~600 px copy, mark cells that look like paper (bright and almost colourless, so not
 * the wood, skin or coloured background), keep the largest connected blob, take its bounding box with a margin, then
 * measure size, sharpness and light on the crop. The thresholds are named constants below; docs/decisions/photo-prep.md
 * lists the measurements they were chosen from.
 */

/** RGBA, 4 bytes per pixel, row-major (the layout of canvas `ImageData`). */
export interface PixelImage {
  data: ArrayLike<number>;
  width: number;
  height: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PhotoProblem = 'no_receipt' | 'too_small' | 'too_blurry' | 'too_dark' | 'cut_off';

export interface PhotoMetrics {
  /** crop size in pixels of the original photo */
  cropWidth: number;
  cropHeight: number;
  /** crop area / photo area, and crop width / photo width */
  areaShare: number;
  widthShare: number;
  /** paper blob area / its bounding box area: low for a keyboard or a pattern, ~0.9 for a flat receipt */
  fillRatio: number;
  /** edge steepness of the paper interior (grey, normalised width): p99 gradient / contrast, ~0.6 for a real photo, ~1 rendered, ~0 blurred */
  sharpness: number;
  /** grey level (0 to 255) of the paper: 90th percentile over the interior of the paper blob */
  paperBrightness: number;
  /** 99th minus 1st percentile of grey over the interior of the paper blob */
  contrast: number;
  /** share of crop pixels that are clearly darker than the paper (ink) */
  inkShare: number;
}

export interface PhotoAnalysis {
  found: boolean;
  /** receipt box, with a margin, in pixels of the original photo; the whole photo when nothing was found */
  box: Box;
  quality: { ok: boolean; problems: PhotoProblem[]; metrics: PhotoMetrics };
}

/** The analysis works on a copy with the long side at most this many pixels: fast, and noise averages out. */
export const ANALYSIS_LONG_SIDE = 600;
/** Cell size in analysis pixels: a cell is paper when it is mostly paper coloured, so ink holes do not matter. */
const CELL = 4;
/** Paper is nearly colourless: saturation (max - min) / max up to this. White paper under warm light stays below ~0.15; wood is ~0.5, skin 0.2 to 0.4. */
const SAT_MAX = 0.18;
/** Below this brightness hue is noise, so a pixel counts as colourless (ink and black parts) whatever its saturation. */
const DARK_NEUTRAL = 60;
/** A cell is colourless when at least this share of its pixels are. */
const CELL_COLOURLESS_SHARE = 0.6;
/** A cell cannot be paper under this brightness (0 to 255): too dark to read anyway. */
const PAPER_FLOOR = 90;
/** The bright and the dark class of colourless cells (paper vs a silver laptop) are split by Otsu only when their means differ by this much. */
const SPLIT_MIN_GAP = 40;
/** ... and the smaller class has at least this share of the cells. */
const SPLIT_MIN_SHARE = 0.03;
/** Ignore a bounding-box edge row or column that holds under this share of the busiest one (a thin leak of paper-like pixels). */
const PROJECTION_MIN = 0.05;
/** Margin added around the box, in cells plus a share of the box size, so cell rounding never clips the paper. */
const MARGIN_CELLS = 1;
const MARGIN_SHARE = 0.02;
/** The paper blob must cover at least this share of the frame to count as found (below: a speck, not a receipt). */
const MIN_BLOB_SHARE = 0.002;
/** Blob area / bounding box area: a flat receipt is ~0.9, a tilted strip ~0.6; a keyboard or a pattern is lower. */
const MIN_FILL_RATIO = 0.4;
/** No paper-like cells at all and the frame's 95th percentile brightness under this: the photo is dim, so ask for light instead of reporting no receipt. */
const DIM_FRAME = 120;

/** Smallest receipt width, in original pixels: the real sample (380 px of a 1512 px frame) was read by the model; below ~300 px the text is a few pixels tall. */
export const MIN_RECEIPT_WIDTH = 300;
/** ... and smallest crop area, in original pixels: a 300 px wide sliver is not a receipt. */
export const MIN_CROP_AREA = 100_000;
/** Paper brightness under this (0 to 255) is too dark to read. */
export const MIN_PAPER_BRIGHTNESS = 110;
/** Sharpness (edge steepness, see `measureSharpness`) below this is blurry. Real phone photo: 0.60; blurred by 1 px: 0.25; by 2 px: 0.10. MOCK images: 1.1 sharp, 0.72 at 1 px blur, 0.43 at 2 px. */
export const MIN_SHARPNESS = 0.3;
/** Sharpness is measured with the crop shrunk to at most this width, so a 4000 px photo and a 600 px photo score alike. */
const SHARPNESS_WIDTH = 480;
/** Ink is darker than this share of the paper brightness. */
const INK_LEVEL = 0.7;
/** A crop is blank paper or a wall, not a printed receipt, when it has under this share of ink pixels ... */
const MIN_INK_SHARE = 0.003;
/** ... and under this contrast (p99 - p1, 0 to 255). Print blurred beyond reading has no ink pixels either but keeps a contrast of ~50 (MOCK, 6 px blur), so it is reported as blurry instead. */
const BLANK_CONTRAST = 25;
/** Touching the left or right edge counts as clipped unless the paper spans (nearly) the whole width. */
const FULL_WIDTH_SHARE = 0.9;
/** Order in which the buyer is told about problems. */
const PROBLEM_ORDER: readonly PhotoProblem[] = ['no_receipt', 'too_dark', 'too_small', 'cut_off', 'too_blurry'];

/** Area average of `channels` interleaved values per pixel down to `tw` x `th` (never used to enlarge). */
function shrink(src: ArrayLike<number>, channels: number, w: number, h: number, tw: number, th: number): Float32Array {
  const out = new Float32Array(tw * th * channels);
  const counts = new Float32Array(tw * th);
  const sx = tw / w;
  const sy = th / h;
  for (let y = 0; y < h; y++) {
    const ty = Math.min(th - 1, Math.floor(y * sy));
    for (let x = 0; x < w; x++) {
      const t = ty * tw + Math.min(tw - 1, Math.floor(x * sx));
      const s = (y * w + x) * channels;
      for (let c = 0; c < channels; c++) out[t * channels + c]! += src[s + c]!;
      counts[t]! += 1;
    }
  }
  for (let t = 0; t < tw * th; t++) {
    const n = counts[t]!;
    if (n > 0) for (let c = 0; c < channels; c++) out[t * channels + c]! /= n;
  }
  return out;
}

function percentile(sorted: ArrayLike<number>, p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
}

/** Threshold that splits `values` (0 to 255) into two classes with the largest between-class variance. */
function otsu(values: number[]): { threshold: number; lowMean: number; highMean: number; lowShare: number; highShare: number } {
  const hist = new Float64Array(256);
  for (const v of values) hist[Math.max(0, Math.min(255, Math.round(v)))]! += 1;
  const total = values.length;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i]!;
  let wLow = 0;
  let sumLow = 0;
  let best = { threshold: 0, variance: -1, lowMean: 0, highMean: 0, lowShare: 0, highShare: 0 };
  for (let t = 0; t < 255; t++) {
    wLow += hist[t]!;
    sumLow += t * hist[t]!;
    const wHigh = total - wLow;
    if (wLow === 0 || wHigh === 0) continue;
    const lowMean = sumLow / wLow;
    const highMean = (sumAll - sumLow) / wHigh;
    const variance = wLow * wHigh * (lowMean - highMean) ** 2;
    if (variance > best.variance) best = { threshold: t, variance, lowMean, highMean, lowShare: wLow / total, highShare: wHigh / total };
  }
  return best;
}

interface Blob {
  cells: number;
  /** cell columns and rows (inclusive) */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Largest 8-connected blob of set cells, with its bounding box trimmed by projection so thin leaks do not stretch it. */
function largestBlob(mask: Uint8Array, cw: number, ch: number): Blob | null {
  const label = new Int32Array(cw * ch);
  let bestId = 0;
  let bestSize = 0;
  let id = 0;
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || label[start]) continue;
    id += 1;
    let size = 0;
    stack.push(start);
    label[start] = id;
    while (stack.length > 0) {
      const cur = stack.pop()!;
      size += 1;
      const cx = cur % cw;
      const cy = (cur - cx) / cw;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
          const n = ny * cw + nx;
          if (mask[n] && !label[n]) {
            label[n] = id;
            stack.push(n);
          }
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      bestId = id;
    }
  }
  if (bestId === 0) return null;
  const cols = new Int32Array(cw);
  const rows = new Int32Array(ch);
  for (let i = 0; i < label.length; i++) {
    if (label[i] !== bestId) continue;
    const x = i % cw;
    cols[x]! += 1;
    rows[(i - x) / cw]! += 1;
  }
  const trim = (counts: Int32Array): [number, number] => {
    const limit = Math.max(...counts) * PROJECTION_MIN;
    let lo = 0;
    let hi = counts.length - 1;
    while (lo < hi && counts[lo]! < limit) lo++;
    while (hi > lo && counts[hi]! < limit) hi--;
    return [lo, hi];
  };
  const [x0, x1] = trim(cols);
  const [y0, y1] = trim(rows);
  return { cells: bestSize, x0, y0, x1, y1 };
}

/**
 * Edge steepness of a grey crop: the 99th percentile of the gradient magnitude (forward differences) divided by the
 * contrast (p99 - p1), over the interior of the paper. A sharp printed edge changes by most of the contrast within a pixel or two, so this is ~0.6 for a
 * real phone photo of thermal print and ~1 for a rendered image; blur drives it towards 0. Dividing by contrast keeps a
 * dim photo from being called blurry, and using a high percentile (not a mean over all pixels) keeps it independent of
 * how much text the receipt has. The crop is shrunk to a normalised width first, so photo resolution barely matters.
 */
function measureSharpness(grey: Float32Array, inPaper: Uint8Array, w: number, h: number, contrast: number): number {
  if (w < 2 || h < 2 || contrast <= 0) return 0;
  const gradients = new Float32Array((w - 1) * (h - 1));
  let n = 0;
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const i = y * w + x;
      // both neighbours must be paper, so the paper edge itself is not measured
      if (!inPaper[i] || !inPaper[i + 1] || !inPaper[i + w]) continue;
      gradients[n++] = Math.hypot(grey[i + 1]! - grey[i]!, grey[i + w]! - grey[i]!);
    }
  }
  return percentile(gradients.subarray(0, n).sort(), 0.99) / contrast;
}

function declined(width: number, height: number, problems: PhotoProblem[]): PhotoAnalysis {
  const metrics: PhotoMetrics = { cropWidth: width, cropHeight: height, areaShare: 1, widthShare: 1, fillRatio: 0, sharpness: 0, paperBrightness: 0, contrast: 0, inkShare: 0 };
  return { found: false, box: { x: 0, y: 0, width, height }, quality: { ok: false, problems, metrics } };
}

/**
 * `image` is the photo or a copy of it (a long side of ~1600 px keeps the crop sharp enough to judge); `source` is the
 * size of the original photo when `image` is smaller. The returned box and the size metrics are in original pixels.
 */
export function analysePhoto(image: PixelImage, source: { width: number; height: number } = image): PhotoAnalysis {
  const { width: w, height: h } = image;
  if (w < 1 || h < 1 || image.data.length < w * h * 4) throw new RangeError('pixel buffer does not match the size');
  const scale = Math.min(1, ANALYSIS_LONG_SIDE / Math.max(w, h));
  const aw = Math.max(1, Math.round(w * scale));
  const ah = Math.max(1, Math.round(h * scale));
  const small = shrink(image.data, 4, w, h, aw, ah);

  // per analysis pixel: brightness V = max(r,g,b); colourless = low saturation (or too dark for hue to mean anything)
  const cw = Math.ceil(aw / CELL);
  const ch = Math.ceil(ah / CELL);
  const cellMax = new Float32Array(cw * ch);
  const cellColourless = new Float32Array(cw * ch);
  const cellPixels = new Float32Array(cw * ch);
  const frameV = new Float32Array(aw * ah);
  for (let y = 0; y < ah; y++) {
    for (let x = 0; x < aw; x++) {
      const p = (y * aw + x) * 4;
      const r = small[p]!;
      const g = small[p + 1]!;
      const b = small[p + 2]!;
      const v = Math.max(r, g, b);
      const saturation = v > 0 ? (v - Math.min(r, g, b)) / v : 0;
      const c = Math.floor(y / CELL) * cw + Math.floor(x / CELL);
      frameV[y * aw + x] = v;
      cellPixels[c]! += 1;
      if (v < DARK_NEUTRAL || saturation <= SAT_MAX) cellColourless[c]! += 1;
      if (v > cellMax[c]!) cellMax[c] = v;
    }
  }

  // nothing found in a dim photo is more likely a lighting problem than a missing receipt
  const notFound: PhotoProblem = percentile(frameV.sort(), 0.95) < DIM_FRAME ? 'too_dark' : 'no_receipt';

  // candidate paper: colourless and not dark; a silver laptop is told from white paper by a bimodal brightness split
  const candidates: number[] = [];
  for (let c = 0; c < cw * ch; c++) {
    if (cellColourless[c]! / cellPixels[c]! >= CELL_COLOURLESS_SHARE && cellMax[c]! >= PAPER_FLOOR) candidates.push(c);
  }
  if (candidates.length === 0) return declined(source.width, source.height, [notFound]);
  let paperFrom = 0;
  const split = otsu(candidates.map((c) => cellMax[c]!));
  if (split.highMean - split.lowMean >= SPLIT_MIN_GAP && Math.min(split.lowShare, split.highShare) >= SPLIT_MIN_SHARE) paperFrom = split.threshold + 1;
  const mask = new Uint8Array(cw * ch);
  for (const c of candidates) if (cellMax[c]! >= paperFrom) mask[c] = 1;
  // interior paper cells: all four neighbours are paper too (or the frame edge). The border, where the paper blends into the table, is not measured.
  const inner = new Uint8Array(cw * ch);
  const isPaper = (x: number, y: number) => x < 0 || y < 0 || x >= cw || y >= ch || mask[y * cw + x] === 1;
  for (let cy = 0; cy < ch; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      if (isPaper(cx, cy) && isPaper(cx - 1, cy) && isPaper(cx + 1, cy) && isPaper(cx, cy - 1) && isPaper(cx, cy + 1)) inner[cy * cw + cx] = 1;
    }
  }

  const blob = largestBlob(mask, cw, ch);
  if (!blob || blob.cells / (cw * ch) < MIN_BLOB_SHARE) return declined(source.width, source.height, [notFound]);
  const boxCells = (blob.x1 - blob.x0 + 1) * (blob.y1 - blob.y0 + 1);
  const fillRatio = blob.cells / boxCells;

  // box in analysis pixels with margin, then in image pixels, then in original pixels
  const bw = (blob.x1 - blob.x0 + 1) * CELL;
  const bh = (blob.y1 - blob.y0 + 1) * CELL;
  const mx = MARGIN_CELLS * CELL + MARGIN_SHARE * bw;
  const my = MARGIN_CELLS * CELL + MARGIN_SHARE * bh;
  const ax0 = Math.max(0, blob.x0 * CELL - mx);
  const ay0 = Math.max(0, blob.y0 * CELL - my);
  const ax1 = Math.min(aw, (blob.x1 + 1) * CELL + mx);
  const ay1 = Math.min(ah, (blob.y1 + 1) * CELL + my);
  const touchesLeft = blob.x0 === 0;
  const touchesRight = blob.x1 === cw - 1;
  const toSource = { x: source.width / aw, y: source.height / ah };
  const box: Box = {
    x: Math.round(ax0 * toSource.x),
    y: Math.round(ay0 * toSource.y),
    width: Math.max(1, Math.round((ax1 - ax0) * toSource.x)),
    height: Math.max(1, Math.round((ay1 - ay0) * toSource.y)),
  };
  box.width = Math.min(box.width, source.width - box.x);
  box.height = Math.min(box.height, source.height - box.y);

  // quality on the crop of the (larger) image copy, shrunk to a normalised width
  const ix0 = Math.floor((box.x / source.width) * w);
  const iy0 = Math.floor((box.y / source.height) * h);
  const iw = Math.max(1, Math.min(w - ix0, Math.round((box.width / source.width) * w)));
  const ih = Math.max(1, Math.min(h - iy0, Math.round((box.height / source.height) * h)));
  const grey = new Float32Array(iw * ih);
  for (let y = 0; y < ih; y++) {
    for (let x = 0; x < iw; x++) {
      const p = ((iy0 + y) * w + ix0 + x) * 4;
      grey[y * iw + x] = 0.299 * image.data[p]! + 0.587 * image.data[p + 1]! + 0.114 * image.data[p + 2]!;
    }
  }
  const nw = Math.max(1, Math.min(iw, SHARPNESS_WIDTH));
  const nh = Math.max(1, Math.round((ih * nw) / iw));
  const normal = nw === iw ? grey : shrink(grey, 1, iw, ih, nw, nh);
  // statistics only over pixels in paper cells: the wood or laptop in the margin must not count as ink or contrast
  const inPaper = new Uint8Array(nw * nh);
  const paperValues: number[] = [];
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      const cx = Math.min(cw - 1, Math.floor((((ix0 + ((x + 0.5) * iw) / nw) / w) * aw) / CELL));
      const cy = Math.min(ch - 1, Math.floor((((iy0 + ((y + 0.5) * ih) / nh) / h) * ah) / CELL));
      if (inner[cy * cw + cx]) {
        inPaper[y * nw + x] = 1;
        paperValues.push(normal[y * nw + x]!);
      }
    }
  }
  const sorted = Float32Array.from(paperValues).sort();
  const paperBrightness = percentile(sorted, 0.9);
  const contrast = percentile(sorted, 0.99) - percentile(sorted, 0.01);
  let ink = 0;
  for (const g of paperValues) if (g < INK_LEVEL * paperBrightness) ink += 1;
  const metrics: PhotoMetrics = {
    cropWidth: box.width,
    cropHeight: box.height,
    areaShare: (box.width * box.height) / (source.width * source.height),
    widthShare: box.width / source.width,
    fillRatio,
    sharpness: measureSharpness(normal, inPaper, nw, nh, contrast),
    paperBrightness,
    contrast,
    inkShare: paperValues.length > 0 ? ink / paperValues.length : 0,
  };

  if (fillRatio < MIN_FILL_RATIO || (metrics.inkShare < MIN_INK_SHARE && metrics.contrast < BLANK_CONTRAST)) {
    return { found: false, box: { x: 0, y: 0, width: source.width, height: source.height }, quality: { ok: false, problems: [notFound], metrics } };
  }

  const problems = new Set<PhotoProblem>();
  if (metrics.cropWidth < MIN_RECEIPT_WIDTH || metrics.cropWidth * metrics.cropHeight < MIN_CROP_AREA) problems.add('too_small');
  if (metrics.sharpness < MIN_SHARPNESS) problems.add('too_blurry');
  if (metrics.paperBrightness < MIN_PAPER_BRIGHTNESS) problems.add('too_dark');
  // top and bottom may touch the frame (long receipts); left or right may not, unless the paper spans the whole width
  if ((touchesLeft || touchesRight) && metrics.widthShare < FULL_WIDTH_SHARE) problems.add('cut_off');
  const ordered = PROBLEM_ORDER.filter((p) => problems.has(p));
  return { found: true, box, quality: { ok: ordered.length === 0, problems: ordered, metrics } };
}
