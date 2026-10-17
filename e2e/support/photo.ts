import type { Page } from '@playwright/test';

export interface PhonePhotoOptions {
  /** frame size in pixels, e.g. a phone camera */
  frame: { width: number; height: number };
  /** width of the receipt in the frame; omit for a table with no receipt */
  receiptWidth?: number;
  /** CSS blur radius in px, applied to the whole photo */
  blur?: number;
  /** 1 = as is, 0.3 = dim */
  brightness?: number;
}

/**
 * A phone-style photo made at test time in the page's own canvas (nothing is committed): a noisy wood-coloured table with
 * a laptop corner and a finger, and the given receipt image laid on it. Returned as JPEG bytes, like a phone camera.
 */
export async function phoneStylePhoto(page: Page, receipt: Buffer, options: PhonePhotoOptions): Promise<Buffer> {
  const base64 = await page.evaluate(
    async ({ receiptB64, opts }) => {
      const { width, height } = opts.frame;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      // wood: base colour, grain stripes, then speckle
      ctx.fillStyle = 'rgb(172,112,62)';
      ctx.fillRect(0, 0, width, height);
      for (let y = 0; y < height; y += 6) {
        ctx.fillStyle = `rgba(${90 + (y % 40)},55,25,${0.08 + ((y * 7) % 10) / 100})`;
        ctx.fillRect(0, y, width, 2 + (y % 3));
      }
      for (let i = 0; i < width * height * 0.01; i++) {
        ctx.fillStyle = `rgba(60,30,10,${Math.random() * 0.25})`;
        ctx.fillRect(Math.random() * width, Math.random() * height, 2, 2);
      }
      ctx.fillStyle = 'rgb(150,150,156)'; // laptop
      ctx.fillRect(width * 0.82, height * 0.2, width * 0.2, height * 0.5);
      ctx.fillStyle = 'rgb(226,186,166)'; // finger
      ctx.fillRect(0, height * 0.45, width * 0.05, height * 0.1);
      if (opts.receiptWidth) {
        const bytes = Uint8Array.from(atob(receiptB64), (c) => c.charCodeAt(0));
        const image = await createImageBitmap(new Blob([bytes]));
        const w = opts.receiptWidth;
        const h = Math.round((image.height * w) / image.width);
        ctx.drawImage(image, Math.round((width - w) / 2), Math.round((height - h) / 2), w, h);
      }
      const out = document.createElement('canvas');
      out.width = width;
      out.height = height;
      const outCtx = out.getContext('2d')!;
      outCtx.filter = `blur(${opts.blur ?? 0}px) brightness(${opts.brightness ?? 1})`;
      outCtx.drawImage(canvas, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/jpeg', 0.9));
      const buf = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (let i = 0; i < buf.length; i += 30_000) binary += String.fromCharCode(...buf.subarray(i, i + 30_000));
      return btoa(binary);
    },
    { receiptB64: receipt.toString('base64'), opts: options },
  );
  return Buffer.from(base64, 'base64');
}
