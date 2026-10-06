import { isURL, saveHistory } from '../lib/history.ts';
import { QR_RESULT_EVENT, emitQRHistoryChanged, type QRResultDetail } from '../lib/result-bus.ts';

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

// Layout renders the sheet on every page; bail on pages without it.
const result = el('result');
const scrim = el('scrim');
if (result && scrim) {
  const resultKind = el('resultKind');
  const resultText = el('resultText');
  const resultMeta = el('resultMeta');
  const openBtn = el<HTMLAnchorElement>('openBtn');
  const copyBtn = el<HTMLButtonElement>('copyBtn');
  const shareBtn = el<HTMLButtonElement>('shareBtn');
  const resultClose = el<HTMLButtonElement>('resultClose');
  const sheetDrag = el<HTMLButtonElement>('sheetDrag');
  let lastFocused: Element | null = null;
  let expanded = false;
  let dragging = false;
  let suppressClick = false;
  let startY = 0;
  let lastY = 0;
  let dy = 0;
  let startT = 0;
  let lastT = 0;
  let vel = 0;

  function setActionLabel(btn: HTMLElement, text: string): void {
    const inner = btn.querySelector('[data-label]');
    if (inner) inner.textContent = text;
    else btn.textContent = text;
  }

  function setExpanded(v: boolean): void {
    expanded = v;
    result.classList.toggle('md-sheet-expanded', v);
    sheetDrag?.setAttribute('aria-expanded', String(v));
    sheetDrag?.setAttribute('aria-label', v ? 'Collapse result' : 'Expand result');
  }

  function resetDrag(): void {
    dragging = false;
    dy = 0;
    vel = 0;
    result.style.transform = '';
    result.classList.remove('md-sheet-dragging');
  }

  function hide(): void {
    if (result.hidden) return;
    resetDrag();
    setExpanded(false);
    result.hidden = true;
    scrim.hidden = true;
    document.body.classList.remove('md-sheet-open');
    if (lastFocused instanceof HTMLElement) {
      try {
        lastFocused.focus({ preventScroll: true });
      } catch {
        // ignore
      }
    }
    lastFocused = null;
  }

  function show(text: string, kind = 'QR CODE', fromHistory = false): void {
    lastFocused ??= document.activeElement;
    if (resultKind) resultKind.textContent = kind;
    if (resultText) resultText.textContent = text;
    const url = isURL(text);
    if (openBtn) {
      openBtn.style.display = url ? '' : 'none';
      if (url) openBtn.href = text;
    }
    if (resultMeta) {
      resultMeta.textContent = fromHistory ? 'From history' : 'Saved to history';
    }
    if (!fromHistory) {
      saveHistory(text, kind);
      emitQRHistoryChanged();
      try {
        navigator.vibrate?.(120);
      } catch {
        // ignore
      }
    }
    result.hidden = false;
    scrim.hidden = false;
    document.body.classList.add('md-sheet-open');
    resetDrag();
    setExpanded(false);
    try {
      resultClose?.focus({ preventScroll: true });
    } catch {
      // ignore
    }
  }

  window.addEventListener(QR_RESULT_EVENT, (e) => {
    const detail = (e as CustomEvent<QRResultDetail>).detail;
    if (!detail || typeof detail.text !== 'string' || !detail.text) return;
    show(detail.text, detail.kind || 'QR CODE', detail.fromHistory === true);
  });

  resultClose?.addEventListener('click', hide);
  scrim.addEventListener('click', hide);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
  });

  // Drag handle: pull down to dismiss (or collapse when expanded),
  // pull up to expand, tap to toggle. Pointer Events cover touch + mouse.
  sheetDrag?.addEventListener('pointerdown', (e) => {
    if (result.hidden || dragging) return;
    dragging = true;
    startY = e.clientY;
    lastY = e.clientY;
    dy = 0;
    vel = 0;
    startT = performance.now();
    lastT = startT;
    result.classList.add('md-sheet-dragging');
    try {
      sheetDrag.setPointerCapture(e.pointerId);
    } catch {
      // ignore — mouse fallback still tracks via move/up on the button
    }
  });

  sheetDrag?.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const now = performance.now();
    vel = (e.clientY - lastY) / Math.max(1, now - lastT);
    lastY = e.clientY;
    lastT = now;
    dy = e.clientY - startY;
    // Follow the finger down freely; resist upward overshoot.
    const clamped = expanded ? Math.max(dy, -24) : Math.max(dy, -72);
    result.style.transform = `translateY(${clamped}px)`;
  });

  function endDrag(): void {
    if (!dragging) return;
    dragging = false;
    suppressClick = true; // a click follows every pointer tap/drag
    result.classList.remove('md-sheet-dragging');
    result.style.transform = '';
    const dt = performance.now() - startT;
    if (Math.abs(dy) < 10 && dt < 350) {
      setExpanded(!expanded);
      return;
    }
    if (dy > 110 || (dy > 48 && vel > 0.45)) {
      if (expanded) setExpanded(false);
      else hide();
      return;
    }
    if (dy < -64) {
      setExpanded(true);
      return;
    }
    // Otherwise snap back — transform cleared above, state kept.
  }

  sheetDrag?.addEventListener('pointerup', endDrag);
  sheetDrag?.addEventListener('pointercancel', () => {
    resetDrag();
  });

  // Keyboard / assistive tech: Enter/Space toggles (pointer taps handled above).
  sheetDrag?.addEventListener('click', () => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    if (result.hidden || dragging) return;
    setExpanded(!expanded);
  });

  copyBtn?.addEventListener('click', () => {
    navigator.clipboard
      .writeText(resultText?.textContent ?? '')
      .then(() => {
        if (copyBtn) {
          setActionLabel(copyBtn, 'Copied');
          window.setTimeout(() => setActionLabel(copyBtn, 'Copy'), 1200);
        }
      })
      .catch(() => {
        if (copyBtn) setActionLabel(copyBtn, 'Failed');
      });
  });

  shareBtn?.addEventListener('click', () => {
    const text = resultText?.textContent ?? '';
    if (navigator.share) {
      navigator.share({ text }).catch(() => {});
    } else {
      navigator.clipboard
        .writeText(text)
        .then(() => {
          setActionLabel(shareBtn, 'Copied');
          window.setTimeout(() => setActionLabel(shareBtn, 'Share'), 1200);
        })
        .catch(() => {});
    }
  });
}
