import jsQR from 'jsqr';
import { createDetector, formatLabel } from './detector.ts';

export interface DecodedImage {
  text: string;
  kind: string;
}

/** Max dimension for decoding — bounds memory/CPU on large shared photos. */
const MAX_DIM = 1600;

export async function decodeImageBlob(blob: Blob): Promise<DecodedImage | null> {
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return null;
  }
  try {
    const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.floor(bitmap.width * scale));
    const h = Math.max(1, Math.floor(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);

    // Native path first (BarcodeDetector handles QR + barcodes).
    try {
      const native = await createDetector();
      if (native) {
        try {
          const codes = await native.detect(canvas);
          if (codes.length > 0 && codes[0].rawValue) {
            return { text: codes[0].rawValue, kind: formatLabel(codes[0].format || 'qr_code') };
          }
        } catch {
          // fall through to jsQR
        }
      }
    } catch {
      // ignore — jsQR fallback below
    }

    try {
      const img = ctx.getImageData(0, 0, w, h);
      const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
      if (code?.data) return { text: code.data, kind: 'QR CODE' };
    } catch {
      return null;
    }
    return null;
  } finally {
    try {
      bitmap.close();
    } catch {
      // ignore
    }
  }
}
