/**
 * Prepare a receipt photo in the browser before it is uploaded: find the receipt, crop to it, shrink it, and decline a
 * photo that cannot be read. The analysis is `photo-analysis.ts` (pure, tested in vitest); this file adds the browser parts
 * (decode, canvas, JPEG export) and the crop plan, which is pure and tested too.
 *
 * Why: the model's time grows with the image, and a receipt that is a thin strip in a big frame ran past the worker's
 * timeout (docs/QIANFAN-LIVE-CHECK.md, issue 1).
 */
import { analysePhoto, type Box, type PhotoAnalysis, type PhotoProblem } from './photo-analysis.ts';

/** Longest side of the uploaded image in pixels. Never upscaled. */
export const MAX_OUTPUT_SIDE = 2000;
/** JPEG quality of the re-encoded photo. */
export const JPEG_QUALITY = 0.85;
/** The analysis runs on a copy with the long side at most this: enough to judge sharpness of a thin strip, cheap to read back. */
const ANALYSIS_COPY_SIDE = 1600;
/** A box covering at least this share of the photo's width and of its height means the photo is already tight: no crop. */
const TIGHT_SHARE = 0.95;

export type PrepareProblem = PhotoProblem | 'unreadable';

export interface PrepareInfo {
  /** size of the file that will be uploaded */
  width: number;
  height: number;
  bytes: number;
  /** size of the photo as chosen */
  sourceWidth: number;
  sourceHeight: number;
  cropped: boolean;
}

export type PrepareResult = { ok: true; file: Blob; info: PrepareInfo } | { ok: false; problems: PrepareProblem[] };

export interface PhotoPlan {
  /** region of the source photo to keep, in source pixels */
  crop: Box;
  output: { width: number; height: number };
  cropped: boolean;
  /** the source file can be uploaded as it is: nothing to crop, small enough, and not a JPEG */
  keepOriginal: boolean;
}

/**
 * What to do with an accepted photo. A JPEG is always re-encoded, even when nothing is cropped: that bakes the EXIF
 * orientation into the pixels (the model must see the receipt upright) and drops the EXIF metadata, GPS included.
 * PNG and WebP that are already tight and small enough are uploaded untouched, so their bytes do not change.
 */
export function planPhoto(analysis: PhotoAnalysis, source: { width: number; height: number; type: string }): PhotoPlan {
  const tight = analysis.box.width >= TIGHT_SHARE * source.width && analysis.box.height >= TIGHT_SHARE * source.height;
  const crop: Box = tight ? { x: 0, y: 0, width: source.width, height: source.height } : analysis.box;
  const scale = Math.min(1, MAX_OUTPUT_SIDE / Math.max(crop.width, crop.height));
  const output = { width: Math.max(1, Math.round(crop.width * scale)), height: Math.max(1, Math.round(crop.height * scale)) };
  return { crop, output, cropped: !tight, keepOriginal: tight && scale === 1 && source.type !== 'image/jpeg' };
}

function canvasOf(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas is not available');
  return ctx;
}

function toJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  // executor form: `Promise.withResolvers` is not in this project's ES2023 lib (and is missing from Safari before 17.4)
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('could not encode the photo'))), 'image/jpeg', JPEG_QUALITY);
  });
}

/** Decode (EXIF orientation applied), analyse, then crop at full resolution, shrink and export JPEG. */
export async function preparePhoto(file: File): Promise<PrepareResult> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return { ok: false, problems: ['unreadable'] };
  }
  try {
    const source = { width: bitmap.width, height: bitmap.height, type: file.type };
    const scale = Math.min(1, ANALYSIS_COPY_SIDE / Math.max(source.width, source.height));
    const copy = canvasOf(Math.max(1, Math.round(source.width * scale)), Math.max(1, Math.round(source.height * scale)));
    const copyCtx = context(copy);
    copyCtx.drawImage(bitmap, 0, 0, copy.width, copy.height);
    const pixels = copyCtx.getImageData(0, 0, copy.width, copy.height);
    const analysis = analysePhoto({ data: pixels.data, width: pixels.width, height: pixels.height }, source);
    if (!analysis.quality.ok) return { ok: false, problems: analysis.quality.problems };

    const plan = planPhoto(analysis, source);
    if (plan.keepOriginal) {
      const info: PrepareInfo = { width: source.width, height: source.height, bytes: file.size, sourceWidth: source.width, sourceHeight: source.height, cropped: false };
      return { ok: true, file, info };
    }
    const out = canvasOf(plan.output.width, plan.output.height);
    const outCtx = context(out);
    // white behind transparent PNG pixels: JPEG has no alpha
    outCtx.fillStyle = '#fff';
    outCtx.fillRect(0, 0, out.width, out.height);
    outCtx.imageSmoothingQuality = 'high';
    outCtx.drawImage(bitmap, plan.crop.x, plan.crop.y, plan.crop.width, plan.crop.height, 0, 0, out.width, out.height);
    const blob = await toJpeg(out);
    const name = `${file.name.replace(/\.[^./\\]+$/, '') || 'receipt'}.jpg`;
    const prepared = new File([blob], name, { type: 'image/jpeg' });
    const info: PrepareInfo = { width: out.width, height: out.height, bytes: prepared.size, sourceWidth: source.width, sourceHeight: source.height, cropped: plan.cropped };
    return { ok: true, file: prepared, info };
  } finally {
    bitmap.close();
  }
}
