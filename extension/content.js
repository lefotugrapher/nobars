// NoBars content script: scales <video> elements so the picture covers its
// player/screen with no black bars. Works by measuring where the picture is
// actually drawn and applying a CSS transform, so it doesn't fight the site's
// own layout code (YouTube, Netflix, Twitch, embeds, etc.).
(() => {
  if (window.__noBarsLoaded) return;
  window.__noBarsLoaded = true;

  const DEFAULTS = { mode: 'fill', scope: 'fullscreen', skipExtreme: true, disabledSites: [] };
  const EXTREME_SCALE = 1.5;   // beyond this (e.g. vertical video on a wide screen) we leave it alone
  const EPS = 0.004;
  const PROPS = ['transform', 'transform-origin', 'clip-path'];

  let cfg = { ...DEFAULTS };
  const videos = new Set();
  const applied = new WeakMap();   // video -> { transform, origin, clip }
  let rafPending = false;

  // ---------- helpers ----------
  function topHost() {
    try { return window.top.location.hostname; } catch (_) {}
    const ao = location.ancestorOrigins;
    if (ao && ao.length) { try { return new URL(ao[ao.length - 1]).hostname; } catch (_) {} }
    return location.hostname;
  }
  const HOST = topHost();

  function enabled() {
    return cfg.mode !== 'off' && !(cfg.disabledSites || []).includes(HOST);
  }

  function fsElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function deepContains(outer, node) {
    while (node) {
      if (node === outer) return true;
      node = node.parentNode || node.host || null;
    }
    return false;
  }

  function viewportRect() {
    return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  }


  // Outside fullscreen: the box the picture should fill is the player around the video.
  function playerRect(v, b) {
    let best = b;
    let el = v.parentElement;
    for (let i = 0; el && i < 6; i++, el = el.parentElement) {
      const r = el.getBoundingClientRect();
      const contains = r.left <= b.left + 1 && r.top <= b.top + 1 &&
        r.right >= b.right - 1 && r.bottom >= b.bottom - 1;
      if (!contains) break;
      if (r.width * r.height > b.width * b.height * 2.2) break; // that's the page, not the player
      best = r;
    }
    return { left: best.left, top: best.top, width: best.width, height: best.height };
  }

  function parsePos(str, axis) {
    const parts = (str || '50% 50%').trim().split(/\s+/);
    const p = parts[axis] || '50%';
    if (p.endsWith('%')) return parseFloat(p) / 100;
    if (p === 'left' || p === 'top') return 0;
    if (p === 'right' || p === 'bottom') return 1;
    return 0.5;
  }

  function clearStyle(v) {
    for (const p of PROPS) v.style.removeProperty(p);
  }

  function restore(v) {
    if (applied.has(v)) {
      clearStyle(v);
      applied.delete(v);
      v.removeAttribute('data-nobars');
    }
  }

  // ---------- core ----------
  function update(v) {
    if (!v.isConnected) { videos.delete(v); restore(v); return; }
    const vw = v.videoWidth, vh = v.videoHeight;
    const fs = fsElement();
    const inFs = !!fs && (fs === v || deepContains(fs, v));
    if (!enabled() || !vw || !vh || (cfg.scope === 'fullscreen' && !inFs)) { restore(v); return; }

    // Measure the untransformed box (same frame, no paint in between → no flicker).
    clearStyle(v);
    const br = v.getBoundingClientRect();
    if (br.width < 80 || br.height < 45) { restore(v); return; }
    const b = { left: br.left, top: br.top, width: br.width, height: br.height, right: br.right, bottom: br.bottom };

    // Where the picture is actually painted inside the element.
    const cs = getComputedStyle(v);
    let cw, ch;
    const fit = cs.objectFit;
    if (fit === 'fill' || fit === 'cover') { cw = b.width; ch = b.height; }
    else if (fit === 'none') { cw = vw; ch = vh; }
    else {
      let s = Math.min(b.width / vw, b.height / vh);
      if (fit === 'scale-down') s = Math.min(1, s);
      cw = vw * s; ch = vh * s;
    }
    const cx = b.left + (b.width - cw) * parsePos(cs.objectPosition, 0);
    const cy = b.top + (b.height - ch) * parsePos(cs.objectPosition, 1);

    // The area the picture should cover.
    let t;
    // In fullscreen the browser pins the fullscreen element to the whole viewport — and some
    // sites (YouTube) fullscreen <html>, whose bounding rect is not the screen — so use the viewport.
    if (inFs) t = viewportRect();
    else t = playerRect(v, b);
    if (t.width < 1 || t.height < 1) { restore(v); return; }

    let kx = t.width / cw, ky = t.height / ch;
    if (cfg.mode === 'fill') kx = ky = Math.max(kx, ky);
    if (cfg.skipExtreme && Math.max(kx, ky) / Math.min(kx, ky) > EXTREME_SCALE && cfg.mode === 'stretch') { restore(v); return; }
    if (cfg.skipExtreme && cfg.mode === 'fill') {
      const fitK = Math.min(t.width / cw, t.height / ch);
      if (kx / fitK > EXTREME_SCALE) { restore(v); return; }
    }

    const ox = cx - b.left + cw / 2, oy = cy - b.top + ch / 2;      // picture centre, local px
    const dx = (t.left + t.width / 2) - (cx + cw / 2);
    const dy = (t.top + t.height / 2) - (cy + ch / 2);

    if (Math.abs(kx - 1) < EPS && Math.abs(ky - 1) < EPS && Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
      restore(v); return; // already fills — nothing to do
    }

    const transform = `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px) scale(${kx.toFixed(5)}, ${ky.toFixed(5)})`;
    const origin = `${ox.toFixed(2)}px ${oy.toFixed(2)}px`;

    // Outside fullscreen, clip to the player so the zoomed picture never spills onto the page.
    let clip = '';
    if (!inFs) {
      const qx = (X) => ox + (X - b.left - ox - dx) / kx;
      const qy = (Y) => oy + (Y - b.top - oy - dy) / ky;
      const l = Math.max(0, qx(t.left)), r = Math.max(0, b.width - qx(t.left + t.width));
      const tp = Math.max(0, qy(t.top)), bt = Math.max(0, b.height - qy(t.top + t.height));
      clip = `inset(${tp.toFixed(2)}px ${r.toFixed(2)}px ${bt.toFixed(2)}px ${l.toFixed(2)}px)`;
    }

    v.style.setProperty('transform', transform, 'important');
    v.style.setProperty('transform-origin', origin, 'important');
    if (clip) v.style.setProperty('clip-path', clip, 'important');
    v.setAttribute('data-nobars', cfg.mode);
    applied.set(v, { transform, origin, clip });
  }

  function updateAll() {
    rafPending = false;
    for (const v of videos) {
      try { update(v); } catch (e) { /* never break the page */ }
    }
  }

  function schedule() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(updateAll);
  }

  // ---------- tracking ----------
  const ro = new ResizeObserver(schedule);
  const styleMo = new MutationObserver((recs) => {
    for (const r of recs) {
      const st = applied.get(r.target);
      // Site rewrote the style attribute and wiped ours → re-apply.
      if (st && r.target.style.getPropertyValue('transform') !== st.transform) { schedule(); return; }
      if (!st) { schedule(); return; }
    }
  });

  function track(v) {
    if (videos.has(v)) return;
    videos.add(v);
    ro.observe(v);
    if (v.parentElement) ro.observe(v.parentElement);
    styleMo.observe(v, { attributes: true, attributeFilter: ['style', 'class'] });
    for (const ev of ['loadedmetadata', 'resize', 'playing', 'emptied']) v.addEventListener(ev, schedule);
    schedule();
  }

  function scanRoot(root) {
    root.querySelectorAll('video').forEach(track);
  }

  function deepScan(root, depth = 0) {
    if (depth > 6) return;
    scanRoot(root);
    root.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) deepScan(el.shadowRoot, depth + 1); });
  }

  let scanTimer = 0;
  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => { scanTimer = 0; scanRoot(document); ensureYtButton(); }, 250);
  }

  const domMo = new MutationObserver((recs) => {
    for (const r of recs) {
      for (const n of r.addedNodes) {
        if (n.nodeType === 1 && (n.tagName === 'VIDEO' || n.firstElementChild)) { scheduleScan(); return; }
      }
    }
  });

  function start() {
    domMo.observe(document.documentElement || document, { childList: true, subtree: true });
    scanRoot(document);
    let ticks = 0;
    setInterval(() => {
      // Videos inside shadow DOM (some custom players) aren't seen by querySelectorAll.
      if (videos.size === 0 && ++ticks % 3 === 0 && document.body) deepScan(document);
      if (videos.size) schedule(); // cheap safety net for players that move the video without resizing it
      ensureYtButton(); // YouTube rebuilds its controls on some navigations
    }, 1000);
  }

  for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) document.addEventListener(ev, () => {
    schedule();
    setTimeout(schedule, 120); // some players lay out a beat after entering fullscreen
    setTimeout(schedule, 500);
  }, true);
  window.addEventListener('resize', schedule);

  // ---------- toast ----------
  const LABEL = { fill: 'Fill (crop to screen)', stretch: 'Stretch', off: 'Off' };
  function toast(text) {
    const fs = fsElement();
    let host;
    if (fs && fs.tagName !== 'IFRAME' && fs.tagName !== 'VIDEO') host = fs;
    else if (!fs && window === window.top) host = document.body;
    if (!host) return;
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = 'position:fixed;z-index:2147483647;top:24px;left:50%;transform:translateX(-50%);' +
      'background:rgba(20,20,22,.82);color:#fff;font:600 14px/1.2 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;' +
      'padding:10px 16px;border-radius:999px;pointer-events:none;backdrop-filter:blur(8px);' +
      'box-shadow:0 4px 20px rgba(0,0,0,.35);transition:opacity .3s;opacity:1';
    host.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; }, 1100);
    setTimeout(() => el.remove(), 1500);
  }

  // ---------- YouTube player button ----------
  const IS_YT = /(^|\.)youtube(-nocookie)?\.com$/.test(location.hostname);
  const ORDER = ['fill', 'stretch', 'off'];
  const SVGNS = 'http://www.w3.org/2000/svg';
  // 24x24 icons, white like YouTube's own. Built with DOM APIs (YouTube enforces Trusted Types, no innerHTML).
  const FRAME = 'M2.5 5h19v14h-19zM4.5 7v10h15V7z'; // 2px screen outline (evenodd)
  const PINK = '#ff4d84', WHITE = '#fff';
  const ICONS = {
    // arrows pushing the picture to top + bottom = fill
    fill: [[FRAME, WHITE], ['M12 7.8l-3.2 3.4h6.4zM12 16.2l-3.2-3.4h6.4z', PINK]],
    // arrows pushing out left + right = stretch
    stretch: [[FRAME, WHITE], ['M5.8 12l3.4-3.2v6.4zM18.2 12l-3.4-3.2v6.4z', PINK], ['M9 11h6v2H9z', PINK]],
    // letterboxed picture = off
    off: [[FRAME, WHITE], ['M4.5 9.5h15v5h-15z', WHITE]],
  };
  let ytBtn = null;

  function siteOff() { return (cfg.disabledSites || []).includes(HOST); }

  function paintYtButton() {
    if (!ytBtn) return;
    const mode = siteOff() ? 'off' : cfg.mode;
    const label = 'NoBars: ' + (siteOff() ? 'Off on this site' : LABEL[mode]) + ' (click to change)';
    ytBtn.setAttribute('aria-label', label);
    ytBtn.setAttribute('data-tooltip-title', label); // YouTube's own tooltip
    ytBtn.setAttribute('data-title-no-tooltip', 'NoBars');
    ytBtn.dataset.mode = mode;
    const svg = ytBtn.firstChild;
    while (svg.firstChild) svg.firstChild.remove();
    for (const [d, color] of ICONS[mode]) {
      const p = document.createElementNS(SVGNS, 'path');
      p.setAttribute('d', d);
      p.setAttribute('fill', color);
      p.setAttribute('fill-rule', 'evenodd');
      svg.appendChild(p);
    }
    ytBtn.style.opacity = mode === 'off' ? '0.75' : '1';
  }

  function ensureYtButton() {
    if (!IS_YT) return;
    const fsBtn = document.querySelector('.ytp-chrome-bottom .ytp-fullscreen-button');
    if (!fsBtn) return;
    if (ytBtn && ytBtn.isConnected && ytBtn.parentElement === fsBtn.parentElement) return;
    if (ytBtn) ytBtn.remove();
    const b = document.createElement('button');
    b.className = 'ytp-button nobars-ytp-btn';
    b.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;vertical-align:top';
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    // YouTube's control glyphs are ~24px in both the old and new player UIs
    svg.setAttribute('width', '24');
    svg.setAttribute('height', '24');
    svg.style.cssText = 'width:24px!important;height:24px!important;pointer-events:none;flex:none';
    b.appendChild(svg);
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const patch = siteOff()
        ? { disabledSites: cfg.disabledSites.filter((h) => h !== HOST), mode: cfg.mode === 'off' ? 'fill' : cfg.mode }
        : { mode: ORDER[(ORDER.indexOf(cfg.mode) + 1) % ORDER.length] };
      Object.assign(cfg, patch);
      paintYtButton();
      schedule();
      try { chrome.storage.sync.set({ ...patch, toastAt: Date.now() }); } catch (_) {}
    });
    // Sit just left of the theatre-mode button (or fullscreen if there's no theatre button)
    const size_ = fsBtn.parentElement.querySelector(':scope > .ytp-size-button');
    fsBtn.parentElement.insertBefore(b, size_ || fsBtn);
    ytBtn = b;
    paintYtButton();
  }

  // ---------- settings ----------
  function loadCfg(cb) {
    try {
      chrome.storage.sync.get(DEFAULTS, (c) => { cfg = { ...DEFAULTS, ...c }; cb && cb(); });
    } catch (_) { cb && cb(); }
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      for (const k of Object.keys(changes)) cfg[k] = changes[k].newValue;
      schedule();
      paintYtButton();
      if (changes.toastAt || changes.mode) {
        const off = (cfg.disabledSites || []).includes(HOST);
        toast('NoBars: ' + (off ? 'Off on this site' : LABEL[cfg.mode] || cfg.mode));
      }
    });
  } catch (_) {}

  loadCfg(() => {
    if (document.documentElement) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
  });
})();
