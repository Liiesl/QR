import type { BarcodeDetectorLike } from './types.ts';

const WANTED = ['qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e'];

export async function createDetector(): Promise<BarcodeDetectorLike | null> {
  try {
    if (!('BarcodeDetector' in window) || !window.BarcodeDetector) return null;
    let supported = WANTED;
    try {
      if (window.BarcodeDetector.getSupportedFormats) {
        supported = await window.BarcodeDetector.getSupportedFormats();
      }
    } catch {
      // keep defaults
    }
    const formats = WANTED.filter((f) => supported.includes(f));
    return new window.BarcodeDetector({ formats: formats.length ? formats : ['qr_code'] });
  } catch {
    return null;
  }
}

export function formatLabel(format: string): string {
  return format.toUpperCase().replace(/_/g, ' ');
}
