/**
 * Kinder Mal-App — finger painting for iPad
 * Square canvas + coloring templates with per-template paint persistence
 */
(function () {
  'use strict';

  const COLORS = [
    { name: 'Rot', hex: '#E63946' },
    { name: 'Orange', hex: '#FF8C42' },
    { name: 'Gelb', hex: '#FFD60A' },
    { name: 'Grün', hex: '#52B788' },
    { name: 'Türkis', hex: '#00B4D8' },
    { name: 'Blau', hex: '#4361EE' },
    { name: 'Lila', hex: '#9B5DE5' },
    { name: 'Rosa', hex: '#FF6B9D' },
    { name: 'Braun', hex: '#8B5E3C' },
    { name: 'Dunkelgrau', hex: '#4A4A4A' },
    { name: 'Weiß', hex: '#FFFFFF', white: true },
  ];

  /* Set A — CC0/PD coloring-page line art (viewBox 0 0 100 100). blank = no lines. */
  const TEMPLATES = [
    {
      id: 'leer',
      name: 'Leeres Blatt',
      blank: true,
      icon: '', /* truly empty — no page/frame outline */
    },
    { id: 'kuh', name: 'Kuh', file: './templates/kuh.svg' },
    { id: 'schwein', name: 'Schwein', file: './templates/schwein.svg' },
    { id: 'schaf', name: 'Schaf', file: './templates/schaf.svg' },
    { id: 'huhn', name: 'Huhn', file: './templates/huhn.svg' },
    { id: 'traktor', name: 'Traktor', file: './templates/traktor.svg' },
    { id: 'apfel', name: 'Apfel', file: './templates/apfel.svg' },
    { id: 'ball', name: 'Ball', file: './templates/ball.svg' },
    { id: 'haus', name: 'Haus', file: './templates/haus.svg' },
    { id: 'sonne', name: 'Sonne', file: './templates/sonne.svg' },
    { id: 'blume', name: 'Blume', file: './templates/blume.svg' },
  ];

  const PAINT_ALPHA = 1;
  const STROKE_MM = 8;
  const STORAGE_KEY = 'ava-malt-paintings-v1';
  const STORAGE_TMPL_KEY = 'ava-malt-current-template';

  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  // alpha:false contexts start black — paint white before any snapshot
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const swatchesEl = document.getElementById('swatches');
  const clearBtn = document.getElementById('clear-btn');
  const mmRef = document.getElementById('mm-ref');
  const appEl = document.getElementById('app');
  const stageEl = document.getElementById('stage');
  const stageWrap = document.getElementById('stage-wrap');
  const templateOverlay = document.getElementById('template-overlay');
  const templateBtnsEl = document.getElementById('template-btns');

  let currentColor = COLORS[0].hex;
  let currentTemplateId = TEMPLATES[0].id;
  /** @type {Map<number, { lastX: number, lastY: number }>} */
  const activePointers = new Map();
  let dpr = 1;
  let canvasReady = false;

  /** @type {Record<string, HTMLCanvasElement>} */
  const paintBuffers = {};

  function mmToCssPx(mm) {
    const tenMm = mmRef.getBoundingClientRect().width || 37.8;
    return (tenMm / 10) * mm;
  }

  function strokeWidthDevicePx() {
    return mmToCssPx(STROKE_MM) * dpr;
  }

  function getTemplate(id) {
    return TEMPLATES.find((t) => t.id === id) || TEMPLATES[0];
  }

  function makeBuffer(w, h) {
    const buf = document.createElement('canvas');
    buf.width = Math.max(1, w);
    buf.height = Math.max(1, h);
    const bctx = buf.getContext('2d', { alpha: false });
    bctx.fillStyle = '#FFFFFF';
    bctx.fillRect(0, 0, buf.width, buf.height);
    return buf;
  }

  function ensureBuffer(id, w, h) {
    let buf = paintBuffers[id];
    if (!buf) {
      buf = makeBuffer(w, h);
      paintBuffers[id] = buf;
      return buf;
    }
    if (buf.width === w && buf.height === h) return buf;

    // Resize preserving content (centered cover into new square)
    const next = makeBuffer(w, h);
    const nctx = next.getContext('2d');
    // Fit old square into new square
    nctx.drawImage(buf, 0, 0, buf.width, buf.height, 0, 0, w, h);
    paintBuffers[id] = next;
    return next;
  }

  function saveCurrentToBuffer() {
    const buf = ensureBuffer(currentTemplateId, canvas.width, canvas.height);
    const bctx = buf.getContext('2d');
    bctx.globalAlpha = 1;
    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.drawImage(canvas, 0, 0);
  }

  function loadBufferToCanvas(id) {
    const buf = ensureBuffer(id, canvas.width, canvas.height);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(buf, 0, 0, canvas.width, canvas.height);
    ctx.restore();
    applyStrokeStyle();
  }

  function templateSvgMarkup(t, forOverlay) {
    const fill = forOverlay ? '#1a1a1a' : 'currentColor';
    if (t.blank) {
      // Truly empty: no overlay paths, no page/frame icon in the button
      if (forOverlay || !t.icon) return '';
      return (
        '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        t.icon +
        '</svg>'
      );
    }
    // Licensed line-art SVGs use filled black strokes (potrace); recolor for icons.
    const inner = String(t.svgInner || '')
      .replace(/fill="#1a1a1a"/g, 'fill="' + fill + '"')
      .replace(/fill='#1a1a1a'/g, "fill='" + fill + "'")
      .replace(/fill="#000000"/g, 'fill="' + fill + '"')
      .replace(/fill="#000"/g, 'fill="' + fill + '"');
    return (
      '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" fill="' +
      fill +
      '" stroke="none">' +
      inner +
      '</svg>'
    );
  }

  async function loadAllTemplateSvgs() {
    await Promise.all(
      TEMPLATES.filter((t) => t.file).map(async (t) => {
        try {
          const res = await fetch(t.file);
          const raw = await res.text();
          const m = /<svg[^>]*>([\s\S]*)<\/svg>/i.exec(raw);
          t.svgInner = m ? m[1].trim() : '';
        } catch (_) {
          t.svgInner = '';
        }
      })
    );
  }

  function updateTemplateOverlay() {
    const t = getTemplate(currentTemplateId);
    templateOverlay.innerHTML = templateSvgMarkup(t, true);
  }

  function buildPalette() {
    swatchesEl.innerHTML = '';
    COLORS.forEach((c, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'swatch' + (c.white ? ' white' : '') + (i === 0 ? ' active' : '');
      btn.style.setProperty('--c', c.hex);
      btn.setAttribute('aria-label', c.name);
      btn.dataset.color = c.hex;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        selectColor(c.hex, btn);
      });
      btn.addEventListener('pointerdown', (e) => e.stopPropagation());
      swatchesEl.appendChild(btn);
    });
  }

  function buildTemplates() {
    templateBtnsEl.innerHTML = '';
    TEMPLATES.forEach((t) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className =
        'template-btn' +
        (t.blank ? ' blank-btn' : '') +
        (t.id === currentTemplateId ? ' active' : '');
      btn.setAttribute('aria-label', 'Vorlage: ' + t.name);
      btn.dataset.template = t.id;
      btn.innerHTML = templateSvgMarkup(t, false);
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        selectTemplate(t.id, btn);
      });
      btn.addEventListener('pointerdown', (e) => e.stopPropagation());
      templateBtnsEl.appendChild(btn);
    });
  }

  function selectColor(hex, btn) {
    currentColor = hex;
    applyStrokeStyle();
    swatchesEl.querySelectorAll('.swatch').forEach((el) => {
      el.classList.toggle('active', el === btn);
    });
  }

  function selectTemplate(id, btn) {
    if (id === currentTemplateId) return;
    // Persist current painting, then switch
    saveCurrentToBuffer();
    persistToStorage();
    currentTemplateId = id;
    loadBufferToCanvas(id);
    updateTemplateOverlay();
    templateBtnsEl.querySelectorAll('.template-btn').forEach((el) => {
      el.classList.toggle('active', el.dataset.template === id);
    });
    try {
      sessionStorage.setItem(STORAGE_TMPL_KEY, id);
    } catch (_) {}
  }

  function squareStageSize() {
    // clientWidth/Height include padding — subtract it for the content box
    const cs = window.getComputedStyle(stageWrap);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const w = stageWrap.clientWidth - padX;
    const h = stageWrap.clientHeight - padY;
    return Math.max(40, Math.floor(Math.min(w, h)));
  }

  function resizeCanvas() {
    const side = squareStageSize();
    dpr = window.devicePixelRatio || 1;
    const px = Math.max(1, Math.round(side * dpr));

    // Save current visible paint into buffer before resizing (skip first init)
    if (canvasReady && canvas.width > 0 && canvas.height > 0) {
      saveCurrentToBuffer();
    }

    stageEl.style.width = side + 'px';
    stageEl.style.height = side + 'px';

    canvas.width = px;
    canvas.height = px;
    canvas.style.width = side + 'px';
    canvas.style.height = side + 'px';

    // Resize all buffers to new square size
    TEMPLATES.forEach((t) => {
      ensureBuffer(t.id, px, px);
    });

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    loadBufferToCanvas(currentTemplateId);
    applyStrokeStyle();
    updateOrientationClass();
    updateIconRotation();
    canvasReady = true;
  }

  function applyStrokeStyle() {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = strokeWidthDevicePx();
    ctx.strokeStyle = currentColor;
    ctx.fillStyle = currentColor;
    ctx.globalAlpha = PAINT_ALPHA;
  }

  /** Draw a continuous opaque segment; interpolate when the pointer jumps. */
  function strokeSegment(x0, y0, x1, y1) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dist = Math.hypot(dx, dy);
    const maxStep = Math.max(2, strokeWidthDevicePx() * 0.4);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    if (dist <= maxStep) {
      ctx.lineTo(x1, y1);
    } else {
      const n = Math.ceil(dist / maxStep);
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        ctx.lineTo(x0 + dx * t, y0 + dy * t);
      }
    }
    ctx.stroke();
  }

  function paintTapDot(x, y) {
    const r = strokeWidthDevicePx() / 2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function updateOrientationClass() {
    const portrait = window.matchMedia('(orientation: portrait)').matches;
    appEl.classList.toggle('portrait', portrait);
    appEl.classList.toggle('landscape', !portrait);
  }

  /**
   * Keep template icons upright relative to the user.
   * With short-edge rails, CSS reflow already keeps screen-up = user-up;
   * --icon-rot stays 0. If a UA reports an angle mismatch, adjust here.
   */
  function updateIconRotation() {
    // Square stage + short-edge rails: screen top is always "up" for the user.
    // Icons and overlay SVGs are drawn upright in viewBox → no extra rotate needed.
    document.documentElement.style.setProperty('--icon-rot', '0deg');
  }

  function canvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * dpr,
      y: (e.clientY - rect.top) * dpr,
    };
  }

  function startStroke(e) {
    if (activePointers.has(e.pointerId)) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    const p = canvasPoint(e);
    activePointers.set(e.pointerId, { lastX: p.x, lastY: p.y });

    applyStrokeStyle();
    // Filled circle for tap — avoids short-line + first-move double paint
    paintTapDot(p.x, p.y);

    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (_) {}
  }

  function moveStroke(e) {
    const state = activePointers.get(e.pointerId);
    if (!state) return;
    const p = canvasPoint(e);
    applyStrokeStyle();
    strokeSegment(state.lastX, state.lastY, p.x, p.y);
    state.lastX = p.x;
    state.lastY = p.y;
  }

  function endStroke(e) {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.delete(e.pointerId);
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch (_) {}
    // Persist when this finger lifts (others may still be drawing)
    saveCurrentToBuffer();
    persistToStorage();
  }

  function clearCanvas() {
    // Clear only the current template's paint
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    applyStrokeStyle();

    const buf = ensureBuffer(currentTemplateId, canvas.width, canvas.height);
    const bctx = buf.getContext('2d');
    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.globalAlpha = 1;
    bctx.fillStyle = '#FFFFFF';
    bctx.fillRect(0, 0, buf.width, buf.height);

    persistToStorage();
  }

  function persistToStorage() {
    try {
      const data = {};
      Object.keys(paintBuffers).forEach((id) => {
        data[id] = paintBuffers[id].toDataURL('image/png');
      });
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      sessionStorage.setItem(STORAGE_TMPL_KEY, currentTemplateId);
    } catch (_) {
      // Quota / private mode — ignore
    }
  }

  function restoreFromStorage() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      Object.keys(data).forEach((id) => {
        if (!TEMPLATES.some((t) => t.id === id)) return;
        const img = new Image();
        img.onload = () => {
          const buf = ensureBuffer(
            id,
            canvas.width || img.width,
            canvas.height || img.height
          );
          const bctx = buf.getContext('2d');
          bctx.fillStyle = '#FFFFFF';
          bctx.fillRect(0, 0, buf.width, buf.height);
          bctx.drawImage(img, 0, 0, buf.width, buf.height);
          if (id === currentTemplateId) {
            loadBufferToCanvas(id);
          }
        };
        img.src = data[id];
      });
      const savedT = sessionStorage.getItem(STORAGE_TMPL_KEY);
      if (savedT && TEMPLATES.some((t) => t.id === savedT)) {
        currentTemplateId = savedT;
      }
    } catch (_) {}
  }

  // Pointer events
  canvas.addEventListener('pointerdown', startStroke);
  canvas.addEventListener('pointermove', moveStroke);
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);
  canvas.addEventListener('pointerleave', (e) => {
    if (activePointers.has(e.pointerId)) endStroke(e);
  });

  canvas.addEventListener(
    'touchstart',
    (e) => {
      e.preventDefault();
    },
    { passive: false }
  );
  canvas.addEventListener(
    'touchmove',
    (e) => {
      e.preventDefault();
    },
    { passive: false }
  );

  clearBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    clearCanvas();
  });
  clearBtn.addEventListener('pointerdown', (e) => e.stopPropagation());

  document.addEventListener(
    'touchmove',
    (e) => {
      e.preventDefault();
    },
    { passive: false }
  );

  let resizeTimer = null;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resizeCanvas, 50);
  }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 150));

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js?v=21').catch(() => {});
    });
  }

  // Init
  buildPalette();
  try {
    const savedT = sessionStorage.getItem(STORAGE_TMPL_KEY);
    if (savedT && TEMPLATES.some((t) => t.id === savedT)) {
      currentTemplateId = savedT;
    }
  } catch (_) {}

  loadAllTemplateSvgs().then(() => {
    buildTemplates();
    updateTemplateOverlay();
    // Resize may have run early; refresh overlay icons once SVGs are ready
    buildTemplates();
  });
  resizeCanvas();
  restoreFromStorage();
})();
