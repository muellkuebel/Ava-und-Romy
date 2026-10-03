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
  const STORAGE_KEY = 'ava-und-romy-paintings-v1';
  const STORAGE_TMPL_KEY = 'ava-und-romy-current-template';
  const LEGACY_STORAGE_KEY = 'ava-malt-paintings-v1';
  const LEGACY_STORAGE_TMPL_KEY = 'ava-malt-current-template';
  const IDB_NAME = 'ava-und-romy';
  const IDB_STORE = 'kv';
  const IDB_VERSION = 1;

  function openPaintDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function idbGet(key) {
    return openPaintDb().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(IDB_STORE, 'readonly');
          const req = tx.objectStore(IDB_STORE).get(key);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        })
    );
  }

  function idbSet(key, value) {
    return openPaintDb().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(IDB_STORE, 'readwrite');
          tx.objectStore(IDB_STORE).put(value, key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        })
    );
  }

  function readLegacyPaintingsRaw() {
    try {
      return (
        localStorage.getItem(STORAGE_KEY) ||
        localStorage.getItem(LEGACY_STORAGE_KEY) ||
        sessionStorage.getItem(STORAGE_KEY) ||
        sessionStorage.getItem(LEGACY_STORAGE_KEY) ||
        null
      );
    } catch (_) {
      return null;
    }
  }

  function readLegacyTemplateId() {
    try {
      return (
        localStorage.getItem(STORAGE_TMPL_KEY) ||
        localStorage.getItem(LEGACY_STORAGE_TMPL_KEY) ||
        sessionStorage.getItem(STORAGE_TMPL_KEY) ||
        sessionStorage.getItem(LEGACY_STORAGE_TMPL_KEY) ||
        null
      );
    } catch (_) {
      return null;
    }
  }

  function clearLegacyPaintStorage() {
    try {
      [STORAGE_KEY, LEGACY_STORAGE_KEY].forEach((k) => {
        localStorage.removeItem(k);
        sessionStorage.removeItem(k);
      });
      [STORAGE_TMPL_KEY, LEGACY_STORAGE_TMPL_KEY].forEach((k) => {
        localStorage.removeItem(k);
        sessionStorage.removeItem(k);
      });
    } catch (_) {}
  }

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
  const colorWheel = document.getElementById('color-wheel');
  const templateWheel = document.getElementById('template-wheel');
  const colorWheelHit = document.getElementById('color-wheel-hit');
  const templateWheelHit = document.getElementById('template-wheel-hit');
  const peekPicsEl = document.getElementById('peek-pics');
  let shredding = false;
  let shredAudio = null;
  let clearFromPointer = false;

  const PEEK_IDS = ['blume', 'sonne', 'haus', 'traktor'];
  /* After a wheel opens, ignore the click that lands on a button underneath. */
  let suppressRailClick = false;

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
      const face = document.createElement('span');
      face.className = 'swatch-face';
      btn.appendChild(face);
      // pointerdown: Farbe auch wechseln, während ein anderer Finger noch malt
      // (iOS liefert oft keinen click, solange eine Touch-Geste aktiv ist)
      const pick = (e) => {
        if (suppressRailClick && e.type === 'click') return;
        e.preventDefault();
        e.stopPropagation();
        selectColor(c.hex, btn);
      };
      btn.addEventListener('pointerdown', pick);
      btn.addEventListener('click', pick);
      swatchesEl.appendChild(btn);
    });
  }

  function buildPeek() {
    if (!peekPicsEl) return;
    peekPicsEl.innerHTML = PEEK_IDS.map((id) => {
      const t = getTemplate(id);
      return '<span class="peek-pic">' + templateSvgMarkup(t, false) + '</span>';
    }).join('');
  }

  function openRail(which) {
    appEl.classList.add(which === 'colors' ? 'colors-open' : 'templates-open');
    const hit = which === 'colors' ? colorWheelHit : templateWheelHit;
    if (hit) hit.setAttribute('aria-expanded', 'true');
    suppressRailClick = true;
    window.setTimeout(() => {
      suppressRailClick = false;
    }, 450);
  }

  function closeRails() {
    appEl.classList.remove('colors-open', 'templates-open');
    if (colorWheelHit) colorWheelHit.setAttribute('aria-expanded', 'false');
    if (templateWheelHit) templateWheelHit.setAttribute('aria-expanded', 'false');
  }

  function bindWheel(el, which) {
    if (!el) return;
    const go = (e) => {
      e.preventDefault();
      e.stopPropagation();
      openRail(which);
    };
    el.addEventListener('pointerdown', go);
    el.addEventListener('click', go);
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
      btn.innerHTML = '<span class="tpl-face">' + templateSvgMarkup(t, false) + '</span>';
      const pick = (e) => {
        if (suppressRailClick && e.type === 'click') return;
        e.preventDefault();
        e.stopPropagation();
        selectTemplate(t.id, btn);
      };
      btn.addEventListener('pointerdown', pick);
      btn.addEventListener('click', pick);
      templateBtnsEl.appendChild(btn);
    });
    buildPeek();
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
    currentTemplateId = id;
    loadBufferToCanvas(id);
    updateTemplateOverlay();
    templateBtnsEl.querySelectorAll('.template-btn').forEach((el) => {
      el.classList.toggle('active', el.dataset.template === id);
    });
    persistToStorage();
  }

  const MIN_SANE_SIDE = 50;
  let resizeRetryRaf = 0;
  let resizeRetryCount = 0;
  const MAX_RESIZE_RETRIES = 120; /* ~2s at 60fps */

  function squareStageSize() {
    // clientWidth/Height include padding — subtract it for the content box
    const cs = window.getComputedStyle(stageWrap);
    const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const w = stageWrap.clientWidth - padX;
    const h = stageWrap.clientHeight - padY;
    return Math.floor(Math.min(w, h));
  }

  function scheduleResizeRetry() {
    if (resizeRetryRaf) return;
    if (resizeRetryCount >= MAX_RESIZE_RETRIES) return;
    resizeRetryCount += 1;
    resizeRetryRaf = requestAnimationFrame(() => {
      resizeRetryRaf = 0;
      resizeCanvas();
    });
  }

  function resizeCanvas() {
    const side = squareStageSize();
    // iPad PWA: first open often has stage-wrap at 0/tiny until layout settles
    if (!(side >= MIN_SANE_SIDE)) {
      scheduleResizeRetry();
      return;
    }
    resizeRetryCount = 0;
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

  function isUiEvent(e) {
    const t = e.target;
    if (!t || !t.closest) return false;
    // Open rails swallow misses (padding included) so a gap cannot collapse them.
    if (appEl.classList.contains('colors-open') && t.closest('#palette')) return true;
    if (appEl.classList.contains('templates-open') && t.closest('#templates')) return true;
    return !!t.closest(
      '#color-wheel, #template-wheel, #color-wheel-hit, #template-wheel-hit, .swatch, .template-btn, #clear-btn'
    );
  }

  /** Canvas bitmap point. `inside` is the white sheet (CSS box), not the black bezel. */
  function canvasPointFromClient(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    if (!(rect.width > 0) || !(rect.height > 0)) {
      return { x: 0, y: 0, inside: false };
    }
    const x = (clientX - rect.left) * (canvas.width / rect.width);
    const y = (clientY - rect.top) * (canvas.height / rect.height);
    const inside =
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom;
    return { x, y, inside };
  }

  function segmentHitsCanvas(x0, y0, x1, y1) {
    const w = canvas.width;
    const h = canvas.height;
    if (Math.max(x0, x1) < 0 || Math.max(y0, y1) < 0) return false;
    if (Math.min(x0, x1) > w || Math.min(y0, y1) > h) return false;
    return true;
  }

  function startStroke(e) {
    if (shredding) return;
    if (isUiEvent(e)) return;
    if (activePointers.has(e.pointerId)) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();

    // Painting (even if the finger is still on the black bezel) puts the rails away.
    closeRails();

    const p = canvasPointFromClient(e.clientX, e.clientY);
    activePointers.set(e.pointerId, {
      lastX: p.x,
      lastY: p.y,
      inside: p.inside,
      painted: p.inside,
    });

    if (p.inside) {
      applyStrokeStyle();
      // Filled circle for tap — avoids short-line + first-move double paint
      paintTapDot(p.x, p.y);
    }

    try {
      appEl.setPointerCapture(e.pointerId);
    } catch (_) {}
  }

  function moveStroke(e) {
    const state = activePointers.get(e.pointerId);
    if (!state) return;
    const p = canvasPointFromClient(e.clientX, e.clientY);
    // Ink stays on the bitmap. A stroke that starts on the black bezel is clipped
    // to the sheet as soon as the segment crosses onto it.
    if (segmentHitsCanvas(state.lastX, state.lastY, p.x, p.y)) {
      applyStrokeStyle();
      strokeSegment(state.lastX, state.lastY, p.x, p.y);
      state.painted = true;
    }
    state.lastX = p.x;
    state.lastY = p.y;
    state.inside = p.inside;
  }

  function endStroke(e) {
    const state = activePointers.get(e.pointerId);
    if (!state) return;
    activePointers.delete(e.pointerId);
    try {
      appEl.releasePointerCapture(e.pointerId);
    } catch (_) {}
    if (!state.painted) return;
    // Persist when this finger lifts (others may still be drawing)
    saveCurrentToBuffer();
    persistToStorage();
  }

  function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /** Paper-shredder hum/rip. Synthesized; stretched to match the pull. Kept quiet. */
  function playShredSound(durationSec) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      if (!shredAudio) shredAudio = new AC();
    } catch (_) {
      return;
    }
    const actx = shredAudio;
    const dur = Math.max(0.4, Math.min(3.2, durationSec || 1.85));
    const start = () => {
      const sr = actx.sampleRate;
      const n = (sr * dur) | 0;
      const buffer = actx.createBuffer(1, n, sr);
      const data = buffer.getChannelData(0);
      let hp = 0;
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const white = Math.random() * 2 - 1;
        hp = hp * 0.72 + white * 0.28;
        lp = lp * 0.9 + white * 0.1;
        const attack = Math.min(1, t / 0.04);
        const release = t > dur - 0.28 ? Math.max(0, (dur - t) / 0.28) : 1;
        const rip = 0.45 + 0.55 * Math.abs(Math.sin(2 * Math.PI * (18 + 12 * (t / dur)) * t));
        const crackle = hp * rip;
        const motor = Math.sin(2 * Math.PI * 58 * t) * 0.14 * (0.6 + 0.4 * Math.sin(2 * Math.PI * 14 * t));
        const grind = Math.sin(2 * Math.PI * (90 + 40 * Math.sin(2 * Math.PI * 3.2 * t)) * t) * 0.05;
        data[i] = (crackle * 0.58 + lp * 0.16 + motor + grind) * attack * release * 0.38;
      }
      const src = actx.createBufferSource();
      src.buffer = buffer;
      const filter = actx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 220;
      filter.Q.value = 0.55;
      const gain = actx.createGain();
      gain.gain.value = 0.3;
      src.connect(filter);
      filter.connect(gain);
      gain.connect(actx.destination);
      src.start();
    };
    if (actx.state === 'suspended') {
      actx.resume().then(start).catch(() => {});
    } else {
      start();
    }
  }

  function shredderBarHtml(widthPx) {
    const W = 860;
    const H = 74;
    let down = '';
    let up = '';
    const n = 18;
    const span = 760;
    const x0 = 50;
    for (let i = 0; i < n; i++) {
      const x = x0 + (i + 0.5) * (span / n);
      const tw = 18;
      down +=
        '<polygon points="' +
        (x - tw / 2) +
        ',14 ' +
        (x + tw / 2) +
        ',14 ' +
        x +
        ',26" fill="#111"/>';
      const x2 = x + tw / 2;
      up +=
        '<polygon points="' +
        (x2 - tw / 2) +
        ',60 ' +
        (x2 + tw / 2) +
        ',60 ' +
        x2 +
        ',48" fill="#1a1a1a"/>';
    }
    return (
      '<svg viewBox="0 0 ' +
      W +
      ' ' +
      H +
      '" width="' +
      widthPx +
      '" height="' +
      Math.round((widthPx * H) / W) +
      '" aria-hidden="true" preserveAspectRatio="none">' +
      '<rect x="8" y="6" width="16" height="62" rx="3" fill="#121212" stroke="#555"/>' +
      '<rect x="836" y="6" width="16" height="62" rx="3" fill="#121212" stroke="#555"/>' +
      '<rect x="22" y="0" width="816" height="16" rx="3" fill="#2c2c2c" stroke="#666" stroke-width="1"/>' +
      '<rect x="22" y="58" width="816" height="16" rx="3" fill="#1a1a1a" stroke="#555" stroke-width="1"/>' +
      down +
      up +
      '<circle cx="36" cy="8" r="2" fill="#0a0a0a"/>' +
      '<circle cx="824" cy="8" r="2" fill="#0a0a0a"/>' +
      '<circle cx="36" cy="66" r="2" fill="#0a0a0a"/>' +
      '<circle cx="824" cy="66" r="2" fill="#0a0a0a"/>' +
      '</svg>'
    );
  }

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function canvasToPngBlob(source) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (blob) => {
        if (settled) return;
        settled = true;
        resolve(blob || null);
      };
      const timer = window.setTimeout(() => finish(null), 700);
      try {
        // Synchronous encode so a missing toBlob callback cannot stall the shredder.
        if (typeof source.toDataURL === 'function') {
          const data = source.toDataURL('image/png');
          const comma = data.indexOf(',');
          const bin = atob(comma >= 0 ? data.slice(comma + 1) : '');
          const arr = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          window.clearTimeout(timer);
          finish(new Blob([arr], { type: 'image/png' }));
          return;
        }
        if (typeof source.toBlob === 'function') {
          source.toBlob((blob) => {
            window.clearTimeout(timer);
            finish(blob || null);
          }, 'image/png');
          return;
        }
        window.clearTimeout(timer);
        finish(null);
      } catch (_) {
        window.clearTimeout(timer);
        finish(null);
      }
    });
  }

  /**
   * Draw the coloring-page lines onto an already-copied paint bitmap.
   * Paint is copied synchronously by the caller before clearCanvas.
   * A slow or failed SVG decode must not stall the shredder.
   */
  function compositeTemplate(copy) {
    return new Promise((resolve) => {
      let url = '';
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (url) {
          try { URL.revokeObjectURL(url); } catch (_) {}
          url = '';
        }
        resolve();
      };
      const timer = window.setTimeout(finish, 450);
      try {
        const svgEl = templateOverlay && templateOverlay.querySelector('svg');
        if (!svgEl) {
          window.clearTimeout(timer);
          finish();
          return;
        }
        const clone = svgEl.cloneNode(true);
        clone.setAttribute('width', String(copy.width));
        clone.setAttribute('height', String(copy.height));
        clone.setAttribute('preserveAspectRatio', 'none');
        if (!clone.getAttribute('xmlns')) {
          clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        }
        const xml = new XMLSerializer().serializeToString(clone);
        url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
        const img = new Image();
        img.onload = () => {
          window.clearTimeout(timer);
          try {
            copy.getContext('2d').drawImage(img, 0, 0, copy.width, copy.height);
          } catch (_) {}
          finish();
        };
        img.onerror = () => {
          window.clearTimeout(timer);
          finish();
        };
        img.src = url;
      } catch (_) {
        window.clearTimeout(timer);
        finish();
      }
    });
  }

  /**
   * Copy the painted sheet (color) before clearCanvas wipes it, then
   * composite the template lines on top. The pixel copy is synchronous.
   * Always resolves, never throws.
   */
  function sheetSnapshot() {
    try {
      const w = canvas.width;
      const h = canvas.height;
      if (!(w > 0) || !(h > 0)) return Promise.resolve(null);
      const copy = document.createElement('canvas');
      copy.width = w;
      copy.height = h;
      const cctx = copy.getContext('2d');
      if (!cctx) return Promise.resolve(null);
      cctx.fillStyle = '#ffffff';
      cctx.fillRect(0, 0, w, h);
      try {
        cctx.drawImage(canvas, 0, 0);
      } catch (_) {}
      return compositeTemplate(copy).then(() => canvasToPngBlob(copy));
    } catch (_) {
      return Promise.resolve(null);
    }
  }

  function runShredAnimation(blob) {
    return new Promise((resolve) => {
      let finished = false;
      let url = '';
      let layer = null;
      const prevOverflow = stageEl.style.overflow;
      const prevZ = stageEl.style.zIndex;
      const prevBg = stageEl.style.background;
      const cleanup = () => {
        if (finished) return;
        finished = true;
        if (url) {
          try { URL.revokeObjectURL(url); } catch (_) {}
          url = '';
        }
        if (layer && layer.parentNode) layer.remove();
        canvas.style.visibility = '';
        if (templateOverlay) templateOverlay.style.visibility = '';
        stageEl.style.overflow = prevOverflow;
        stageEl.style.zIndex = prevZ;
        stageEl.style.background = prevBg;
        resolve();
      };

      try {
      if (prefersReducedMotion()) {
        cleanup();
        return;
      }
      const rect = stageEl.getBoundingClientRect();
      if (!(rect.width > 2) || !(rect.height > 2)) {
        cleanup();
        return;
      }
      if (blob) url = URL.createObjectURL(blob);
      const W = rect.width;
      const H = rect.height;
      const barW = Math.round(W * 1.075);
      const barH = Math.max(42, Math.round(barW * (74 / 860)));
      const stripN = 16;
      const lengthFrac = [0.62, 1, 0.74, 0.93, 0.58, 0.86, 0.7, 0.98, 0.66, 0.9, 0.78, 0.84, 0.6, 0.96, 0.72, 0.88];
      const SHRED_MS = 1900;
      const FALL_MS = 900;
      const HOLD_MS = 140;
      const FLIP_MS = 720;

      layer = document.createElement('div');
      layer.className = 'shred-fx';
      layer.setAttribute('aria-hidden', 'true');

      const paper = document.createElement('div');
      paper.className = 'shred-paper';
      const paperArt = document.createElement('img');
      paperArt.className = 'shred-art';
      paperArt.alt = '';
      paperArt.draggable = false;
      if (url) paperArt.src = url;
      paperArt.style.width = W + 'px';
      paperArt.style.height = H + 'px';
      paper.appendChild(paperArt);

      const pull = document.createElement('div');
      pull.className = 'shred-pull';
      const strips = [];
      const stripArts = [];
      for (let i = 0; i < stripN; i++) {
        const strip = document.createElement('div');
        strip.className = 'shred-hang';
        const col = W / stripN;
        const gap = Math.max(4, col * 0.14);
        const left = i * col + gap / 2;
        const sw = Math.max(4, col - gap);
        strip.style.left = left + 'px';
        strip.style.width = sw + 'px';
        // Straight cut at the bottom — no torn fringe.
        const art = document.createElement('img');
        art.className = 'shred-art';
        art.alt = '';
        art.draggable = false;
        if (url) art.src = url;
        art.style.width = W + 'px';
        art.style.height = H + 'px';
        art.style.left = -left + 'px';
        strip.appendChild(art);
        pull.appendChild(strip);
        strips.push(strip);
        stripArts.push(art);
      }

      const bar = document.createElement('div');
      bar.className = 'shred-bar';
      bar.style.width = barW + 'px';
      bar.style.height = barH + 'px';
      bar.style.marginLeft = -barW / 2 + 'px';
      bar.innerHTML = shredderBarHtml(barW);

      const page = document.createElement('div');
      page.className = 'shred-page';
      try {
        const lines = templateSvgMarkup(getTemplate(currentTemplateId), true);
        if (lines) {
          const holder = document.createElement('div');
          holder.className = 'shred-page-lines';
          holder.innerHTML = lines;
          page.appendChild(holder);
        }
      } catch (_) {}

      layer.appendChild(paper);
      layer.appendChild(pull);
      layer.appendChild(bar);
      layer.appendChild(page);

      const TUCK = 3;
      const applyCut = (cutY, feed, reveal) => {
        const paperH = Math.max(0, Math.min(H, cutY));
        paper.style.height = paperH + 'px';
        paper.style.opacity = paperH > 0.5 ? '1' : '0';
        paperArt.style.transform = 'translate3d(0,' + feed + 'px,0)';
        bar.style.top = cutY + 'px';
        bar.style.opacity = cutY < H + 4 && cutY > -barH - 2 ? '1' : '0';
        // Strips leave the slot at the bottom lip of the shredder, black behind them.
        const exitY = cutY + barH - TUCK;
        pull.style.top = exitY + 'px';
        const room = Math.max(0, H - exitY);
        pull.style.height = room + 8 + 'px';
        // Same mapping as the sheet: screen Y shows image Y - feed, including the
        // span hidden inside the shredder.
        const artTop = feed - exitY;
        const grow = 0.28 + 0.72 * Math.max(0, Math.min(1, reveal));
        const cap = Math.min(room, H * 0.62 * grow + 10);
        // Stay visible while any of the strip still overlaps the sheet,
        // including once the slot has slipped just past the top edge.
        const showPull = exitY < H - 1 && exitY + Math.max(cap, 12) > -2;
        pull.style.opacity = showPull ? '1' : '0';
        for (let i = 0; i < stripArts.length; i++) {
          strips[i].style.height = Math.max(8, cap * lengthFrac[i]) + 'px';
          stripArts[i].style.transform = 'translate3d(0,' + artTop + 'px,0)';
        }
      };

      // Cover the live sheet only once the snapshot can paint, then wipe
      // underneath. Clearing earlier flashes a blank page.
      const startVisual = () => {
        if (finished) return;
        stageEl.style.overflow = 'hidden';
        stageEl.style.zIndex = '8';
        stageEl.style.background = '#000';
        stageEl.appendChild(layer);
        applyCut(H - barH * 0.35, 0, 0);
        canvas.style.visibility = 'hidden';
        if (templateOverlay) templateOverlay.style.visibility = 'hidden';
        try { clearCanvas(); } catch (_) {}
        const t0 = performance.now();
      const tick = (now) => {
        if (finished) return;
        try {
          const raw = Math.min(1, (now - t0) / SHRED_MS);
          const e = easeInOutCubic(raw);
          // Shredder travels from near-bottom up and exits off the top.
          const cutY = H - barH * 0.35 - (H - barH * 0.35 + barH + 8) * e;
          // Sheet content feeds downward into the slot at the same time.
          const feed = (H * 0.38) * e;
          applyCut(cutY, feed, e);
          if (raw < 1) {
            requestAnimationFrame(tick);
            return;
          }
          // Shredder has left the top. Strips drop straight down off the sheet.
          applyCut(-barH - 10, H * 0.38, 1);
          bar.style.opacity = '0';
          paper.style.opacity = '0';
          pull.style.opacity = '1';
          pull.style.overflow = 'visible';
          let maxStrip = 0;
          for (let i = 0; i < strips.length; i++) {
            maxStrip = Math.max(maxStrip, strips[i].offsetHeight || 0);
          }
          pull.style.height = maxStrip + 4 + 'px';
          const fromTop = parseFloat(pull.style.top) || 0;
          const distance = H - fromTop + 12;
          const tFall = performance.now();
          const fallTick = (now2) => {
            if (finished) return;
            const fraw = Math.min(1, (now2 - tFall) / FALL_MS);
            const g = fraw * fraw;
            pull.style.top = fromTop + distance * g + 'px';
            if (fraw < 1) {
              requestAnimationFrame(fallTick);
              return;
            }
            pull.style.opacity = '0';
            window.setTimeout(() => {
              if (finished) return;
              page.classList.add('shred-page-flip');
              window.setTimeout(cleanup, FLIP_MS + 40);
            }, HOLD_MS);
          };
          requestAnimationFrame(fallTick);
        } catch (_) {
          cleanup();
        }
      };
        requestAnimationFrame(tick);
        window.setTimeout(cleanup, SHRED_MS + FALL_MS + HOLD_MS + FLIP_MS + 800);
      };

      if (!url) {
        startVisual();
      } else {
        const preload = new Image();
        let started = false;
        const go = () => {
          if (started) return;
          started = true;
          startVisual();
        };
        preload.onload = go;
        preload.onerror = go;
        preload.src = url;
        if (preload.complete && preload.naturalWidth > 0) go();
        window.setTimeout(go, 500);
      }
      } catch (_) {
        cleanup();
      }
    });
  }

  function shredAndClear() {
    if (shredding) return;
    shredding = true;
    // If anything in the chain never settles, painting must come back.
    const unlockTimer = window.setTimeout(() => {
      shredding = false;
    }, 6400);
    const done = () => {
      window.clearTimeout(unlockTimer);
      shredding = false;
    };
    try {
      playShredSound(1.9);
    } catch (_) {}
    let snap;
    try {
      // Copies pixels synchronously, then resolves with a blob.
      // The live canvas stays until the shred layer covers it.
      snap = sheetSnapshot();
    } catch (_) {
      snap = Promise.resolve(null);
    }
    Promise.resolve(snap)
      .then((blob) => runShredAnimation(blob))
      .catch(() => {})
      .then(() => {
        try { clearCanvas(); } catch (_) {}
        done();
      }, () => {
        try { clearCanvas(); } catch (_) {}
        done();
      });
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

  function snapshotPaintings() {
    const data = {};
    Object.keys(paintBuffers).forEach((id) => {
      data[id] = paintBuffers[id].toDataURL('image/png');
    });
    return data;
  }

  let persistTimer = 0;
  function persistToStorage() {
    // Debounce rapid endStroke / template switches a bit
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistToStorageNow();
    }, 40);
  }

  function persistToStorageNow() {
    const payload = {
      paintings: snapshotPaintings(),
      currentTemplateId,
      savedAt: Date.now(),
    };
    idbSet(STORAGE_KEY, payload).catch(() => {
      // Fallback: localStorage (may fail on quota with large canvases)
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload.paintings));
        localStorage.setItem(STORAGE_TMPL_KEY, currentTemplateId);
      } catch (_) {}
    });
    try {
      localStorage.setItem(STORAGE_TMPL_KEY, currentTemplateId);
    } catch (_) {}
  }

  function applyPaintingsData(data) {
    if (!data || typeof data !== 'object') return;
    Object.keys(data).forEach((id) => {
      if (!TEMPLATES.some((t) => t.id === id)) return;
      const src = data[id];
      if (!src) return;
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
      img.src = src;
    });
  }

  function restoreFromStorage() {
    return idbGet(STORAGE_KEY)
      .then((payload) => {
        if (payload && payload.paintings) {
          if (
            payload.currentTemplateId &&
            TEMPLATES.some((t) => t.id === payload.currentTemplateId)
          ) {
            currentTemplateId = payload.currentTemplateId;
          }
          applyPaintingsData(payload.paintings);
          return;
        }
        // Migrate one-time from older session/local storage
        const raw = readLegacyPaintingsRaw();
        const savedT = readLegacyTemplateId();
        if (savedT && TEMPLATES.some((t) => t.id === savedT)) {
          currentTemplateId = savedT;
        }
        if (!raw) return;
        const data = JSON.parse(raw);
        applyPaintingsData(data);
        // Save into IndexedDB and drop legacy keys
        persistToStorageNow();
        clearLegacyPaintStorage();
      })
      .catch(() => {
        try {
          const raw = readLegacyPaintingsRaw();
          const savedT = readLegacyTemplateId();
          if (savedT && TEMPLATES.some((t) => t.id === savedT)) {
            currentTemplateId = savedT;
          }
          if (raw) applyPaintingsData(JSON.parse(raw));
        } catch (_) {}
      });
  }

  // Pointer events on the whole app, so a stroke may start on the black bezel
  // and continue onto the white sheet. The sheet clips the ink.
  document.addEventListener('pointerdown', startStroke);
  document.addEventListener('pointermove', moveStroke);
  document.addEventListener('pointerup', endStroke);
  document.addEventListener('pointercancel', endStroke);

  document.addEventListener(
    'touchstart',
    (e) => {
      if (isUiEvent(e)) return;
      e.preventDefault();
    },
    { passive: false }
  );
  document.addEventListener(
    'touchmove',
    (e) => {
      e.preventDefault();
    },
    { passive: false }
  );

  const clearPick = (e) => {
    if (suppressRailClick && e.type === 'click') return;
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'pointerdown') {
      clearFromPointer = true;
      shredAndClear();
      return;
    }
    if (clearFromPointer) {
      clearFromPointer = false;
      return;
    }
    shredAndClear();
  };
  clearBtn.addEventListener('pointerdown', clearPick);
  clearBtn.addEventListener('click', clearPick);

  let resizeTimer = null;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resizeCanvas, 50);
  }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 150));

  // After layout: double rAF (Safari/iPad often has 0-size stage-wrap on first paint)
  function afterLayout(fn) {
    requestAnimationFrame(() => {
      requestAnimationFrame(fn);
    });
  }
  afterLayout(resizeCanvas);
  window.addEventListener('load', () => {
    resizeCanvas();
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', onResize);
  }
  if (typeof ResizeObserver !== 'undefined' && stageWrap) {
    const ro = new ResizeObserver(() => onResize());
    ro.observe(stageWrap);
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js?v=31').catch(() => {});
    });
  }

  // Flush paintings when leaving the app (Home Screen / Safari tab close)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      clearTimeout(persistTimer);
      if (canvasReady) {
        saveCurrentToBuffer();
        persistToStorageNow();
      }
    }
  });
  window.addEventListener('pagehide', () => {
    clearTimeout(persistTimer);
    if (canvasReady) {
      saveCurrentToBuffer();
      persistToStorageNow();
    }
  });

  bindWheel(colorWheel, 'colors');
  bindWheel(templateWheel, 'templates');
  bindWheel(colorWheelHit, 'colors');
  bindWheel(templateWheelHit, 'templates');
  requestAnimationFrame(() => {
    appEl.classList.add('motion-on');
  });

  // Init
  buildPalette();
  try {
    const savedT = readLegacyTemplateId();
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
  restoreFromStorage().then(() => {
    // Template may have been restored — refresh buttons/overlay
    buildTemplates();
    updateTemplateOverlay();
    if (canvasReady) loadBufferToCanvas(currentTemplateId);
  });
})();
