export interface BarcodeResult {
  rawValue: string;
  format: string;
}

export interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<BarcodeResult[]>;
}

export interface HistoryItem {
  text: string;
  kind: string;
  time: number;
}

declare global {
  interface Window {
    BarcodeDetector?: {
      new (options?: { formats: string[] }): BarcodeDetectorLike;
      getSupportedFormats?: () => Promise<string[]>;
    };
  }
}

export {};
