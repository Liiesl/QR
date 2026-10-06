/** Global floating result sheet bus — any page can announce a scan result. */

export const QR_RESULT_EVENT = 'qr:result';
export const QR_HISTORY_CHANGED_EVENT = 'qr:history-changed';

export interface QRResultDetail {
  text: string;
  kind?: string;
  /** True when re-opened from history — do not re-save. */
  fromHistory?: boolean;
}

export function emitQRResult(detail: QRResultDetail): void {
  window.dispatchEvent(new CustomEvent<QRResultDetail>(QR_RESULT_EVENT, { detail }));
}

export function emitQRHistoryChanged(): void {
  window.dispatchEvent(new CustomEvent(QR_HISTORY_CHANGED_EVENT));
}
