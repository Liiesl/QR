import jsQR from 'jsqr';
import { createDetector, formatLabel } from '../lib/detector.ts';
import { clearHistory, isURL, loadHistory, saveHistory } from '../lib/history.ts';
import type { BarcodeDetectorLike } from '../lib/types.ts';

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
const result = el('result');
const resultKind = el('resultKind');
const resultText = el('resultText');
const openBtn = el<HTMLAnchorElement>('openBtn');
const copyBtn = el<HTMLButtonElement>('copyBtn');
const shareBtn = el<HTMLButtonElement>('shareBtn');
const historyList = el('historyList');
const historyEmpty = el('historyEmpty');
const historyPanel = el('historyPanel');
const historyBtn = el<HTMLButtonElement>('historyBtn');
const scanBtn = el<HTMLButtonElement>('scanBtn');
const uploadBtn = el('uploadBtn');
const historyClose = el<HTMLButtonElement>('historyClose');
const resultClose = el<HTMLButtonElement>('resultClose');
const clearBtn = el<HTMLButtonElement>('clearBtn');
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

const SVG_ATTRS =
  'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="20" height="20"';
const QR_SVG = `<svg ${SVG_ATTRS}><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 14h3v3h-3zM20 14h1M14 20h1M18 18h3v3h-3z"/></svg>`;

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

function setActionLabel(btn: HTMLElement, text: string): void {
  const inner = btn.querySelector('[data-label]');
  if (inner) inner.textContent = text;
  else btn.textContent = text;
}

function renderHistory(): void {
  const items = loadHistory();
  historyList.innerHTML = '';
  (historyEmpty as HTMLElement).style.display = items.length ? 'none' : 'flex';
  for (const item of items.slice(0, 20)) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'md-history-item';
    b.title = new Date(item.time).toLocaleString();

    const icon = document.createElement('span');
    icon.className = 'md-history-item-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = QR_SVG;

    const wrap = document.createElement('span');
    wrap.className = 'md-history-item-text';
    const primary = document.createElement('span');
    primary.className = 'md-history-item-primary';
    primary.textContent = item.text;
    const secondary = document.createElement('span');
    secondary.className = 'md-history-item-secondary';
    secondary.textContent = `${item.kind || 'QR CODE'} · ${new Date(item.time).toLocaleString()}`;

    wrap.appendChild(primary);
    wrap.appendChild(secondary);
    b.appendChild(icon);
    b.appendChild(wrap);
    b.addEventListener('click', () => showResult(item.text, item.kind || 'QR CODE', true));
    li.appendChild(b);
    historyList.appendChild(li);
  }
}

function showResult(text: string, kind = 'QR CODE', fromHistory = false): void {
  result.hidden = false;
  resultKind.textContent = kind;
  resultText.textContent = text;
  const url = isURL(text);
  openBtn.style.display = url ? '' : 'none';
  if (url) openBtn.href = text;
  if (!fromHistory) {
    saveHistory(text, kind);
    renderHistory();
    try {
      navigator.vibrate?.(120);
    } catch {
      // ignore
    }
  }
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
          showResult(v, formatLabel(codes[0].format || 'qr_code'));
          setStatus('Found — keep scanning', true);
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
    showResult(code.data, 'QR CODE');
    setStatus('Found — keep scanning', true);
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
  createImageBitmap(file)
    .then(async (bitmap) => {
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      ctx.drawImage(bitmap, 0, 0);
      const native = await createDetector();
      if (native) {
        try {
          const codes = await native.detect(canvas);
          if (codes.length > 0 && codes[0].rawValue) {
            showResult(codes[0].rawValue, 'IMAGE');
            setStatus('Decoded from image — resuming live scan');
            fileInput.value = '';
            resumeLive();
            return;
          }
        } catch {
          // fall through
        }
      }
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(img.data, img.width, img.height);
      if (code?.data) {
        showResult(code.data, 'IMAGE');
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

copyBtn.addEventListener('click', () => {
  navigator.clipboard
    .writeText(resultText.textContent ?? '')
    .then(() => {
      setActionLabel(copyBtn, 'Copied');
      window.setTimeout(() => {
        setActionLabel(copyBtn, 'Copy');
      }, 1200);
    })
    .catch(() => {
      setActionLabel(copyBtn, 'Failed');
    });
});

shareBtn.addEventListener('click', () => {
  const text = resultText.textContent ?? '';
  if (navigator.share) {
    navigator.share({ text }).catch(() => {});
  } else {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setActionLabel(shareBtn, 'Copied');
        window.setTimeout(() => {
          setActionLabel(shareBtn, 'Share');
        }, 1200);
      })
      .catch(() => {});
  }
});

clearBtn.addEventListener('click', () => {
  clearHistory();
  renderHistory();
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
  result.hidden = true;
  setNavActive('scan');
  resumeLive();
});

resultClose.addEventListener('click', () => {
  result.hidden = true;
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

renderHistory();
if (!('mediaDevices' in navigator) || !navigator.mediaDevices?.getUserMedia) {
  setStatus('This browser has no camera API — use Upload instead');
  idleHint.textContent = 'No camera API — use Upload instead.';
  retryBtn.hidden = true;
} else {
  void startCamera();
}
