import jsQR from 'jsqr';
import { createDetector, formatLabel } from '../lib/detector.ts';
import { saveHistory, clearHistory, deleteHistoryItem, isURL, loadHistory, relativeTime } from '../lib/history.ts';
import { QR_HISTORY_CHANGED_EVENT, emitQRResult } from '../lib/result-bus.ts';
import { decodeImageBlob } from '../lib/decode-image.ts';
import { consumePendingShare } from '../lib/share-store.ts';
import type { BarcodeDetectorLike, HistoryItem } from '../lib/types.ts';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

const video = el<HTMLVideoElement>('video');
const canvas = el<HTMLCanvasElement>('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
if (!ctx) throw new Error('2d context unavailable');

const stage = el('stage');
const idle = el('idle');
const retryBtn = el<HTMLButtonElement>('retryBtn');
const idleHint = el('idleHint');
const torchBtn = el<HTMLButtonElement>('torchBtn');
const flipBtn = el<HTMLButtonElement>('flipBtn');
const fileInput = el<HTMLInputElement>('fileInput');
const historyList = el('historyList');
const historyEmpty = el('historyEmpty');
const historyNoResults = el('historyNoResults');
const historyPanel = el('historyPanel');
const historyBtn = el<HTMLButtonElement>('historyBtn');
const scanBtn = el<HTMLButtonElement>('scanBtn');
const uploadBtn = el('uploadBtn');
const historyClose = el<HTMLButtonElement>('historyClose');
const clearBtn = el<HTMLButtonElement>('clearBtn');
const historySearch = el<HTMLInputElement>('historySearch');
const historySearchClear = el<HTMLButtonElement>('historySearchClear');
const historyResetSearch = el<HTMLButtonElement>('historyResetSearch');
const historyCount = el('historyCount');
const installBtn = el<HTMLButtonElement>('installBtn');

let stream: MediaStream | null = null;
let raf = 0;
let scanning = false;
let lastTick = 0;
let detector: BarcodeDetectorLike | null = null;
let facingMode = 'environment';
let torchOn = false;
let lastValue = '';
let deferredPrompt: { prompt: () => void; userChoice?: Promise<unknown> } | null = null;

let historyQuery = '';
let historyFilter: 'all' | 'links' | 'text' = 'all';

const SVG_ATTRS =
  'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="20" height="20"';
const QR_SVG = `<svg ${SVG_ATTRS}><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 14h3v3h-3zM20 14h1M14 20h1M18 18h3v3h-3z"/></svg>`;
const LINK_SVG = `<svg ${SVG_ATTRS}><path d="M10 14a4.2 4.2 0 0 0 6 0l3-3a4.24 4.24 0 0 0-6-6l-1.5 1.5"/><path d="M14 10a4.2 4.2 0 0 0-6 0l-3 3a4.24 4.24 0 0 0 6 6l1.5-1.5"/></svg>`;
const IMAGE_SVG = `<svg ${SVG_ATTRS}><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4.5 18 10 12.5l3.5 3.5 2.5-2.5 3.5 3.5"/></svg>`;
const OPEN_SVG = `<svg ${SVG_ATTRS}><path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M19 13.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5.5"/></svg>`;
const COPY_SVG = `<svg ${SVG_ATTRS}><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>`;
const DELETE_SVG = `<svg ${SVG_ATTRS}><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6.5 7l1 13a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1l1-13"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`;
const CHECK_SVG = `<svg ${SVG_ATTRS}><path d="M4.5 12.5 10 18 19.5 6.5"/></svg>`;

function setStatus(msg: string, _live?: boolean): void {
  // No status bar in the UI — mirror to the empty-state hint while it is visible.
  if (!idle.hidden) idleHint.textContent = msg;
}

function setTorchUI(on: boolean): void {
  torchOn = on;
  torchBtn.setAttribute('aria-pressed', String(on));
  torchBtn.setAttribute('data-active', String(on));
  torchBtn.setAttribute('aria-label', on ? 'Turn torch off' : 'Turn torch on');
  const off = torchBtn.querySelector('[data-icon-off]');
  const onIcon = torchBtn.querySelector('[data-icon-on]');
  if (off && onIcon) {
    (off as HTMLElement).hidden = on;
    (onIcon as HTMLElement).hidden = !on;
  }
}

function setNavActive(name: 'scan' | 'upload' | 'history'): void {
  const map: Record<string, HTMLElement> = { scan: scanBtn, upload: uploadBtn, history: historyBtn };
  for (const [key, node] of Object.entries(map)) {
    const active = key === name;
    node.setAttribute('data-active', String(active));
    node.setAttribute('aria-selected', String(active));
  }
}

function itemIcon(item: HistoryItem): string {
  if (item.kind === 'IMAGE') return IMAGE_SVG;
  return isURL(item.text) ? LINK_SVG : QR_SVG;
}

function matchesFilter(item: HistoryItem): boolean {
  if (historyFilter === 'links') return isURL(item.text);
  if (historyFilter === 'text') return !isURL(item.text);
  return true;
}

function renderHistory(): void {
  const all = loadHistory();
  historyCount.textContent = String(all.length);
  clearBtn.toggleAttribute('disabled', all.length === 0);

  const q = historyQuery.trim().toLowerCase();
  const items = all.filter((i) => matchesFilter(i) && (!q || i.text.toLowerCase().includes(q)));

  historyList.innerHTML = '';
  const hasHistory = all.length > 0;
  historyEmpty.hidden = hasHistory;
  (historyEmpty as HTMLElement).style.display = hasHistory ? 'none' : 'flex';
  historyNoResults.hidden = hasHistory && items.length > 0;
  (historyNoResults as HTMLElement).style.display = hasHistory && items.length === 0 ? 'flex' : 'none';

  for (const item of items.slice(0, 20)) {
    const li = document.createElement('li');
    li.className = 'md-history-row';

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'md-history-item';
    open.title = new Date(item.time).toLocaleString();
    open.setAttribute('aria-label', `Open result: ${item.text.slice(0, 80)}`);

    const icon = document.createElement('span');
    icon.className = 'md-history-item-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = itemIcon(item);

    const wrap = document.createElement('span');
    wrap.className = 'md-history-item-text';
    const primary = document.createElement('span');
    primary.className = 'md-history-item-primary';
    primary.textContent = item.text;
    const secondary = document.createElement('span');
    secondary.className = 'md-history-item-secondary';
    secondary.textContent = `${item.kind || 'QR CODE'} · ${relativeTime(item.time)}`;

    wrap.appendChild(primary);
    wrap.appendChild(secondary);
    open.appendChild(icon);
    open.appendChild(wrap);
    open.addEventListener('click', () => {
      emitQRResult({ text: item.text, kind: item.kind || 'QR CODE', fromHistory: true });
    });

    const actions = document.createElement('div');
    actions.className = 'md-history-item-actions';

    if (isURL(item.text)) {
      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'md-icon-button md-icon-button-sm';
      go.innerHTML = OPEN_SVG;
      go.setAttribute('aria-label', `Open link: ${item.text.slice(0, 60)}`);
      go.addEventListener('click', (e) => {
        e.stopPropagation();
        window.open(item.text, '_blank', 'noopener');
      });
      actions.appendChild(go);
    }

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'md-icon-button md-icon-button-sm';
    copy.innerHTML = COPY_SVG;
    copy.setAttribute('aria-label', 'Copy to clipboard');
    copy.addEventListener('click', (e) => {
      e.stopPropagation();
      const original = copy.innerHTML;
      navigator.clipboard
        ?.writeText(item.text)
        .then(() => {
          copy.innerHTML = CHECK_SVG;
          copy.classList.add('is-copied');
          window.setTimeout(() => {
            copy.innerHTML = original;
            copy.classList.remove('is-copied');
          }, 1000);
        })
        .catch(() => {});
    });
    actions.appendChild(copy);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'md-icon-button md-icon-button-sm';
    del.innerHTML = DELETE_SVG;
    del.setAttribute('aria-label', 'Delete this scan');
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteHistoryItem(item.text);
      renderHistory();
    });
    actions.appendChild(del);

    li.appendChild(open);
    li.appendChild(actions);
    historyList.appendChild(li);
  }
}

/** New scans go through the global floating sheet (Layout-owned). */
function announceResult(text: string, kind = 'QR CODE'): void {
  emitQRResult({ text, kind, fromHistory: false });
  setStatus('Found — keep scanning', true);
}

function hideGlobalResult(): void {
  document.getElementById('result')?.setAttribute('hidden', '');
  document.getElementById('scrim')?.setAttribute('hidden', '');
  document.body.classList.remove('md-sheet-open');
}

async function detectFrame(now: number): Promise<void> {
  if (!scanning) return;
  raf = requestAnimationFrame(detectFrame);
  if (now - lastTick < 180) return;
  lastTick = now;
  if (video.readyState !== video.HAVE_ENOUGH_DATA || video.videoWidth === 0) return;

  if (detector) {
    try {
      const codes = await detector.detect(video);
      if (codes.length > 0) {
        const v = codes[0].rawValue;
        if (v && v !== lastValue) {
          lastValue = v;
          announceResult(v, formatLabel(codes[0].format || 'qr_code'));
          window.setTimeout(() => {
            lastValue = '';
          }, 2500);
        }
        return;
      }
    } catch {
      // fall through to jsQR
    }
  }

  const w = video.videoWidth;
  const h = video.videoHeight;
  const scale = Math.min(1, 640 / Math.max(w, h));
  canvas.width = Math.floor(w * scale);
  canvas.height = Math.floor(h * scale);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
  if (code?.data && code.data !== lastValue) {
    lastValue = code.data;
    announceResult(code.data, 'QR CODE');
    window.setTimeout(() => {
      lastValue = '';
    }, 2500);
  }
}

async function stopCamera(): Promise<void> {
  scanning = false;
  cancelAnimationFrame(raf);
  stage.classList.remove('scanning');
  if (stream) {
    for (const t of stream.getTracks()) t.stop();
    stream = null;
  }
  video.srcObject = null;
  torchBtn.disabled = true;
  flipBtn.disabled = true;
  setTorchUI(false);
  idle.hidden = false;
  setStatus('Idle — camera paused');
}

async function startCamera(): Promise<void> {
  if (!window.isSecureContext && location.hostname !== 'localhost') {
    setStatus('Camera needs HTTPS or localhost');
    return;
  }
  await stopCamera();
  setStatus('Requesting camera…');
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
  } catch {
    setStatus('Camera blocked — allow permission then tap Enable camera');
    idle.hidden = false;
    idleHint.textContent = 'Camera blocked — allow permission, then retry.';
    retryBtn.hidden = false;
    return;
  }
  video.srcObject = stream;
  await video.play().catch(() => {});
  idle.hidden = true;
  retryBtn.hidden = true;
  scanning = true;
  lastValue = '';
  stage.classList.add('scanning');
  detector = await createDetector();
  setStatus(detector ? 'Scanning (native) — hold steady' : 'Scanning (fallback) — hold steady', true);

  const track = stream.getVideoTracks()[0];
  const caps = track.getCapabilities?.() as { torch?: boolean } | undefined;
  torchBtn.disabled = !caps?.torch;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    flipBtn.disabled = devices.filter((d) => d.kind === 'videoinput').length < 2;
  } catch {
    flipBtn.disabled = false;
  }
  raf = requestAnimationFrame(detectFrame);
}

retryBtn.addEventListener('click', () => {
  retryBtn.hidden = true;
  void startCamera();
});

torchBtn.addEventListener('click', () => {
  const track = stream?.getVideoTracks()[0];
  if (!track) return;
  const next = !torchOn;
  track
    .applyConstraints({ advanced: [{ torch: next }] } as MediaTrackConstraints)
    .then(() => {
      setTorchUI(next);
    })
    .catch(() => {
      setStatus('Torch not supported on this camera');
      setTorchUI(false);
    });
});

flipBtn.addEventListener('click', () => {
  facingMode = facingMode === 'environment' ? 'user' : 'environment';
  if (scanning) void startCamera();
});

fileInput.addEventListener('click', () => {
  setNavActive('upload');
  if (scanning) void stopCamera();
});

function resumeLive(): void {
  if ('mediaDevices' in navigator && navigator.mediaDevices?.getUserMedia) {
    setNavActive('scan');
    void startCamera();
  }
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (!file) {
    resumeLive();
    return;
  }
  if (scanning) void stopCamera();
  setStatus('Decoding image…');
  decodeImageBlob(file)
    .then((decoded) => {
      if (decoded) {
        announceResult(decoded.text, 'IMAGE');
        setStatus('Decoded from image — resuming live scan');
      } else {
        setStatus('No QR found in that image — resuming live scan');
      }
      fileInput.value = '';
      resumeLive();
    })
    .catch(() => {
      setStatus('Could not read that image — resuming live scan');
      fileInput.value = '';
      resumeLive();
    });
});

async function handleSharedTarget(): Promise<boolean> {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(window.location.search);
  } catch {
    return false;
  }
  if (!params.has('shared')) return false;
  params.delete('shared');
  try {
    const clean = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}${window.location.hash}`;
    window.history.replaceState(null, '', clean);
  } catch {
    // ignore
  }
  if (scanning) await stopCamera();
  setNavActive('scan');
  historyPanel.hidden = true;
  setStatus('Opening shared image…');
  const pending = await consumePendingShare();
  if (!pending) {
    setStatus('No shared image found — starting live scan');
    resumeLive();
    return true;
  }
  // Shared text/URL without files (e.g. link shared from browser).
  if (pending.files.length === 0) {
    const sharedText = pending.url || pending.text || pending.title;
    if (sharedText) {
      announceResult(sharedText, 'SHARED');
      setStatus('Shared text received — resuming live scan');
    } else {
      setStatus('No shared image found — starting live scan');
    }
    resumeLive();
    return true;
  }
  setStatus(`Decoding shared image${pending.files.length > 1 ? ` 1/${pending.files.length}` : ''}…`);
  const found: Array<{ text: string; kind: string }> = [];
  for (const file of pending.files.slice(0, 10)) {
    try {
      const decoded = await decodeImageBlob(file);
      if (decoded) found.push({ text: decoded.text, kind: 'IMAGE' });
    } catch {
      // try next file
    }
  }
  if (found.length > 0) {
    // Save extras silently; announce the first so the sheet shows it.
    for (let i = found.length - 1; i >= 1; i--) {
      try {
        saveHistory(found[i].text, found[i].kind);
      } catch {
        // ignore
      }
    }
    if (found.length > 1) renderHistory();
    announceResult(found[0].text, found[0].kind);
    setStatus(
      found.length > 1
        ? `Decoded ${found.length} images — resuming live scan`
        : 'Decoded shared image — resuming live scan'
    );
  } else {
    setStatus('No QR found in shared image — resuming live scan');
  }
  resumeLive();
  return true;
}

clearBtn.addEventListener('click', () => {
  if (loadHistory().length === 0) return;
  if (!window.confirm('Delete all scan history?')) return;
  clearHistory();
  renderHistory();
});

function setFilter(next: typeof historyFilter): void {
  historyFilter = next;
  for (const chip of document.querySelectorAll<HTMLButtonElement>('.md-chip[data-filter]')) {
    const active = chip.dataset.filter === next;
    chip.setAttribute('data-active', String(active));
    chip.setAttribute('aria-pressed', String(active));
  }
  renderHistory();
}

for (const chip of document.querySelectorAll<HTMLButtonElement>('.md-chip[data-filter]')) {
  chip.addEventListener('click', () => {
    const f = chip.dataset.filter;
    if (f === 'links' || f === 'text' || f === 'all') setFilter(f);
  });
}

historySearch.addEventListener('input', () => {
  historyQuery = historySearch.value;
  historySearchClear.hidden = historyQuery.length === 0;
  renderHistory();
});

historySearch.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    historySearch.value = '';
    historyQuery = '';
    historySearchClear.hidden = true;
    renderHistory();
    historySearch.blur();
  }
});

historySearchClear.addEventListener('click', () => {
  historySearch.value = '';
  historyQuery = '';
  historySearchClear.hidden = true;
  renderHistory();
  historySearch.focus();
});

historyResetSearch.addEventListener('click', () => {
  historySearch.value = '';
  historyQuery = '';
  historySearchClear.hidden = true;
  setFilter('all');
});

historyBtn.addEventListener('click', () => {
  renderHistory();
  historyPanel.hidden = false;
  setNavActive('history');
});

historyClose.addEventListener('click', () => {
  historyPanel.hidden = true;
  setNavActive('scan');
});

scanBtn.addEventListener('click', () => {
  historyPanel.hidden = true;
  hideGlobalResult();
  setNavActive('scan');
  resumeLive();
});

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e as unknown as typeof deferredPrompt;
  installBtn.hidden = false;
});

installBtn.addEventListener('click', () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  deferredPrompt.userChoice?.catch(() => {}).finally(() => {
    deferredPrompt = null;
    installBtn.hidden = true;
  });
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (scanning) void stopCamera();
  } else if (!scanning) {
    void startCamera();
  }
});

// Saves happen in the global sheet owner — re-render whenever it reports one.
window.addEventListener(QR_HISTORY_CHANGED_EVENT, renderHistory);

renderHistory();
if (!('mediaDevices' in navigator) || !navigator.mediaDevices?.getUserMedia) {
  // No camera — still honor an incoming share (image decode needs no camera).
  idleHint.textContent = 'No camera API — use Upload instead.';
  retryBtn.hidden = true;
  setStatus('This browser has no camera API — use Upload instead');
  void handleSharedTarget();
} else if (new URLSearchParams(window.location.search).has('shared')) {
  void handleSharedTarget().then((handled) => {
    if (!handled) void startCamera();
  });
} else {
  void startCamera();
}
