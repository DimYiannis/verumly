import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { analysePhoto, MIN_RECEIPT_WIDTH, type PhotoAnalysis, type PixelImage } from '../app/utils/photo-analysis.ts';

/** Deterministic noise so a failing threshold is reproducible. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

type Rgb = [number, number, number];
interface Scene {
  width: number;
  height: number;
  /** the paper, in pixels; may extend past the frame (clipped) */
  paper?: { x: number; y: number; width: number; height: number };
  /** a silver laptop and a patch of skin, as in the real sample */
  clutter?: boolean;
  brightness?: number;
}

const WOOD: Rgb = [172, 112, 62];
const PAPER: Rgb = [236, 236, 240];
const INK: Rgb = [32, 32, 36];

/** Brown noisy background, optional laptop and finger, white paper with printed lines of text (3 px bars, 9 px apart). */
function render(scene: Scene): PixelImage & { data: Uint8ClampedArray } {
  const { width, height } = scene;
  const rand = rng(7);
  const data = new Uint8ClampedArray(width * height * 4);
  const paint = (x: number, y: number, [r, g, b]: Rgb, noise: number) => {
    const o = (y * width + x) * 4;
    const n = (rand() - 0.5) * 2 * noise;
    const k = scene.brightness ?? 1;
    data[o] = (r + n) * k;
    data[o + 1] = (g + n) * k;
    data[o + 2] = (b + n) * k;
    data[o + 3] = 255;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // wood grain: slow horizontal stripes on top of pixel noise
      const grain = Math.sin(y / 9) * 10;
      paint(x, y, [WOOD[0] + grain, WOOD[1] + grain * 0.7, WOOD[2] + grain * 0.4], 14);
      if (scene.clutter && x > width * 0.78 && y > height * 0.15 && y < height * 0.8) paint(x, y, [150, 150, 156], 5);
      if (scene.clutter && x < width * 0.06 && y > height * 0.4 && y < height * 0.6) paint(x, y, [226, 186, 166], 5);
    }
  }
  const p = scene.paper;
  if (p) {
    for (let y = Math.max(0, p.y); y < Math.min(height, p.y + p.height); y++) {
      for (let x = Math.max(0, p.x); x < Math.min(width, p.x + p.width); x++) {
        // 3 px ink bar every 9 px, each line a random run inside the paper margins
        const line = Math.floor((y - p.y) / 9);
        const inBar = (y - p.y) % 9 < 3;
        const lineRand = rng(line + 1);
        const start = 12 + Math.floor(lineRand() * 30);
        const end = p.width - 12 - Math.floor(lineRand() * 60);
        const ink = inBar && line % 5 !== 4 && x - p.x > start && x - p.x < end && ((x - p.x) % 7) < 5;
        paint(x, y, ink ? INK : PAPER, 3);
      }
    }
  }
  return { data, width, height };
}

/** Separable box blur: a stand-in for defocus or motion. */
function blur(image: PixelImage, radius: number): PixelImage {
  const { width, height } = image;
  const src = image.data;
  const out = new Uint8ClampedArray(width * height * 4);
  const tmp = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        let n = 0;
        for (let d = -radius; d <= radius; d++) {
          const xx = Math.min(width - 1, Math.max(0, x + d));
          sum += src[(y * width + xx) * 4 + c]!;
          n += 1;
        }
        tmp[(y * width + x) * 4 + c] = sum / n;
      }
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        let n = 0;
        for (let d = -radius; d <= radius; d++) {
          const yy = Math.min(height - 1, Math.max(0, y + d));
          sum += tmp[(yy * width + x) * 4 + c]!;
          n += 1;
        }
        out[(y * width + x) * 4 + c] = sum / n;
      }
    }
  }
  return { data: out, width, height };
}

function describeBox(a: PhotoAnalysis): string {
  return `${a.box.x},${a.box.y} ${a.box.width}x${a.box.height}`;
}

describe('analysePhoto on synthetic photos', () => {
  const STRIP = { x: 520, y: 0, width: 380, height: 1512 };

  it('finds a thin receipt strip on a noisy wood table with a laptop and a finger, and crops it with a small margin', () => {
    const a = analysePhoto(render({ width: 1512, height: 1512, paper: STRIP, clutter: true }));
    expect(a.found).toBe(true);
    expect(a.quality.problems).toEqual([]);
    expect(a.quality.ok).toBe(true);
    // contains the paper, with a margin that is small compared with the paper
    expect(a.box.x, describeBox(a)).toBeLessThanOrEqual(STRIP.x);
    expect(a.box.x + a.box.width).toBeGreaterThanOrEqual(STRIP.x + STRIP.width);
    expect(a.box.x).toBeGreaterThan(STRIP.x - 60);
    expect(a.box.x + a.box.width).toBeLessThan(STRIP.x + STRIP.width + 60);
    // top and bottom touch the frame: a long receipt, not cut off
    expect(a.box.y).toBe(0);
    expect(a.box.height).toBe(1512);
    expect(a.quality.metrics.widthShare).toBeLessThan(0.4);
  });

  it('works on a downscaled copy and reports the box in original pixels', () => {
    const original = { width: 1512, height: 1512 };
    const copy = render({ width: 756, height: 756, paper: { x: STRIP.x / 2, y: 0, width: STRIP.width / 2, height: 756 } });
    const a = analysePhoto(copy, original);
    expect(a.found).toBe(true);
    expect(a.box.x).toBeLessThanOrEqual(STRIP.x);
    expect(a.box.x + a.box.width).toBeGreaterThanOrEqual(STRIP.x + STRIP.width);
    expect(a.box.height).toBe(1512);
    expect(a.quality.metrics.cropWidth).toBe(a.box.width);
  });

  it('a receipt that fills the frame is not shrunk', () => {
    const a = analysePhoto(render({ width: 800, height: 1000, paper: { x: 0, y: 0, width: 800, height: 1000 } }));
    expect(a.found).toBe(true);
    expect(a.quality.problems).toEqual([]);
    expect(a.box).toEqual({ x: 0, y: 0, width: 800, height: 1000 });
  });

  it('a small receipt on a big table is too_small', () => {
    const a = analysePhoto(render({ width: 1512, height: 1512, paper: { x: 600, y: 500, width: 200, height: 320 } }));
    expect(a.found).toBe(true);
    expect(a.quality.problems).toEqual(['too_small']);
    expect(a.quality.metrics.cropWidth).toBeLessThan(MIN_RECEIPT_WIDTH);
  });

  it('a blurred receipt is too_blurry, the sharp one is not', () => {
    const sharp = render({ width: 1512, height: 1512, paper: STRIP, clutter: true });
    expect(analysePhoto(blur(sharp, 5)).quality.problems).toEqual(['too_blurry']);
    // so blurred that no ink is left is still a receipt that needs a sharper photo, not "no receipt"
    const heavy = analysePhoto(blur(blur(sharp, 8), 8));
    expect(heavy.found).toBe(true);
    expect(heavy.quality.problems).toContain('too_blurry');
    expect(analysePhoto(sharp).quality.problems).toEqual([]);
  });

  it('a dim photo is too_dark', () => {
    const a = analysePhoto(render({ width: 1512, height: 1512, paper: STRIP, clutter: true, brightness: 0.4 }));
    expect(a.quality.problems).toEqual(['too_dark']);
    expect(a.found).toBe(true);
    expect(analysePhoto(render({ width: 800, height: 800, brightness: 0.15 })).quality.problems).toEqual(['too_dark']);
  });

  it('an empty table is no_receipt, and the box is the whole frame', () => {
    const a = analysePhoto(render({ width: 1512, height: 1512, clutter: true }));
    expect(a.found).toBe(false);
    expect(a.quality.problems).toEqual(['no_receipt']);
    expect(a.box).toEqual({ x: 0, y: 0, width: 1512, height: 1512 });
  });

  it('a blank sheet with nothing printed is no_receipt', () => {
    const blank = render({ width: 1000, height: 1000, paper: { x: 200, y: 100, width: 600, height: 800 } });
    for (let y = 0; y < 1000; y++) for (let x = 0; x < 1000; x++) if (x >= 200 && x < 800 && y >= 100 && y < 900) for (let c = 0; c < 3; c++) blank.data[(y * 1000 + x) * 4 + c] = [236, 236, 240][c]!;
    const a = analysePhoto(blank);
    expect(a.quality.problems).toEqual(['no_receipt']);
  });

  it('paper clipped on the left or right is cut_off; top and bottom may touch the frame', () => {
    const right = analysePhoto(render({ width: 1512, height: 1512, paper: { x: 1100, y: 0, width: 380 + 150, height: 1512 } }));
    expect(right.quality.problems).toEqual(['cut_off']);
    const left = analysePhoto(render({ width: 1512, height: 1512, paper: { x: -150, y: 0, width: 600, height: 1512 } }));
    expect(left.quality.problems).toEqual(['cut_off']);
    // a long receipt touching top and bottom only is fine (first test); clipped at the bottom only too
    const bottom = analysePhoto(render({ width: 1512, height: 1512, paper: { x: 520, y: 300, width: 380, height: 1400 } }));
    expect(bottom.quality.problems).toEqual([]);
  });

  it('rejects a buffer that does not match the size', () => {
    expect(() => analysePhoto({ data: new Uint8ClampedArray(8), width: 10, height: 10 })).toThrow(RangeError);
  });
});

describe('analysePhoto on the MOCK receipt images', () => {
  const dir = fileURLToPath(new URL('../../../fixtures/receipts-nl/mock/', import.meta.url));
  const files = readdirSync(dir).filter((f) => f.endsWith('.png'));

  it('has the six MOCK images', () => {
    expect(files).toHaveLength(6);
  });

  it.each(files)('%s passes as an already cropped receipt, not shrunk', (file) => {
    const png = PNG.sync.read(readFileSync(`${dir}${file}`));
    const a = analysePhoto({ data: png.data, width: png.width, height: png.height });
    expect(a.quality.problems).toEqual([]);
    expect(a.found).toBe(true);
    expect(a.quality.metrics.areaShare).toBeGreaterThan(0.95);
    expect(a.box).toEqual({ x: 0, y: 0, width: png.width, height: png.height });
  });
});
