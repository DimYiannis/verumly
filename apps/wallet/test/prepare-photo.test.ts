import { describe, expect, it } from 'vitest';
import type { PhotoAnalysis } from '../app/utils/photo-analysis.ts';
import { MAX_OUTPUT_SIDE, planPhoto } from '../app/utils/prepare-photo.ts';

function analysis(box: { x: number; y: number; width: number; height: number }): PhotoAnalysis {
  return {
    found: true,
    box,
    quality: { ok: true, problems: [], metrics: { cropWidth: box.width, cropHeight: box.height, areaShare: 0, widthShare: 0, fillRatio: 1, sharpness: 1, paperBrightness: 230, contrast: 150, inkShare: 0.05 } },
  };
}

describe('planPhoto', () => {
  it('crops a strip out of a bigger frame and keeps its size when it is under the limit', () => {
    const plan = planPhoto(analysis({ x: 466, y: 0, width: 439, height: 1512 }), { width: 1512, height: 1512, type: 'image/jpeg' });
    expect(plan).toEqual({ crop: { x: 466, y: 0, width: 439, height: 1512 }, output: { width: 439, height: 1512 }, cropped: true, keepOriginal: false });
  });

  it('a photo that is already tight is not cropped; a small PNG is uploaded untouched', () => {
    const plan = planPhoto(analysis({ x: 0, y: 0, width: 768, height: 960 }), { width: 768, height: 960, type: 'image/png' });
    expect(plan).toMatchObject({ crop: { x: 0, y: 0, width: 768, height: 960 }, cropped: false, keepOriginal: true });
  });

  it('a box that covers 95% of both sides counts as tight, and the whole photo is kept (no pixels thrown away)', () => {
    const plan = planPhoto(analysis({ x: 10, y: 20, width: 740, height: 930 }), { width: 768, height: 960, type: 'image/webp' });
    expect(plan.cropped).toBe(false);
    expect(plan.crop).toEqual({ x: 0, y: 0, width: 768, height: 960 });
  });

  it('a tight JPEG is still re-encoded: orientation baked in, EXIF (GPS) dropped', () => {
    const plan = planPhoto(analysis({ x: 0, y: 0, width: 800, height: 1000 }), { width: 800, height: 1000, type: 'image/jpeg' });
    expect(plan).toMatchObject({ cropped: false, keepOriginal: false, output: { width: 800, height: 1000 } });
  });

  it('shrinks so the long side is at most 2000 px, keeping the aspect ratio, and never upscales', () => {
    const big = planPhoto(analysis({ x: 0, y: 0, width: 3000, height: 4000 }), { width: 3000, height: 4000, type: 'image/png' });
    expect(big.output).toEqual({ width: 1500, height: MAX_OUTPUT_SIDE });
    expect(big.keepOriginal).toBe(false);
    const cropped = planPhoto(analysis({ x: 1000, y: 0, width: 1200, height: 4000 }), { width: 3000, height: 4000, type: 'image/jpeg' });
    expect(cropped.output).toEqual({ width: 600, height: MAX_OUTPUT_SIDE });
    const small = planPhoto(analysis({ x: 100, y: 100, width: 400, height: 500 }), { width: 1000, height: 1000, type: 'image/jpeg' });
    expect(small.output).toEqual({ width: 400, height: 500 });
  });
});
