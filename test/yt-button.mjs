// Live check: NoBars button sits in YouTube's player controls, cycles modes, works in fullscreen.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { chromium, CHROME, ROOT } from './lib.mjs';
const W = 1512, H = 945, EXT = path.join(ROOT, 'extension'), SHOTS = path.join(ROOT, 'test', 'shots');
const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'nb-ytb-')), { executablePath: CHROME, headless: true, viewport: { width: W, height: H }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--autoplay-policy=no-user-gesture-required'] });
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
await sw.evaluate(() => chrome.storage.sync.set({ mode: 'fill', scope: 'fullscreen', disabledSites: [] }));
const p = await ctx.newPage();
const errs = []; p.on('console', (m) => { if (/nobars|TrustedHTML/i.test(m.text())) errs.push(m.text()); });
await p.goto('https://www.youtube.com/watch?v=aqz-KE-bpKQ', { waitUntil: 'domcontentloaded' });
await p.waitForSelector('.nobars-ytp-btn', { timeout: 20000 });
// Fresh test profile gets YouTube's cookie lightbox; decline non-essential and wait for it to go
for (let i = 0; i < 20; i++) {
  const r = p.locator('ytd-consent-bump-v2-lightbox button', { hasText: /^\s*Reject all\s*$/ }).first();
  if (await r.isVisible().catch(() => false)) { await r.click(); await p.waitForTimeout(1500); break; }
  await p.waitForTimeout(1000);
}
let ok = 0, bad = 0; const out = (n, c, d = '') => { c ? ok++ : bad++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  -> ' + d}`); };
const info = await p.evaluate(() => { const b = document.querySelector('.nobars-ytp-btn'); const r = b.getBoundingClientRect(); const s = b.querySelector('svg').getBoundingClientRect(); const fsb = document.querySelector('.ytp-fullscreen-button').getBoundingClientRect(); return { count: document.querySelectorAll('.nobars-ytp-btn').length, mode: b.dataset.mode, label: b.getAttribute('aria-label'), btn: [r.width, r.height].map(Math.round), svg: [s.width, s.height].map(Math.round), sameRow: Math.abs((r.top + r.height / 2) - (fsb.top + fsb.height / 2)) < 4, leftOfFs: r.right <= fsb.left + 1, next: b.nextElementSibling && b.nextElementSibling.className }; });
console.log(info);
out('button injected once into player controls', info.count === 1);
out('button in same row, left of fullscreen', info.sameRow && info.leftOfFs, JSON.stringify(info));
out('button shows current mode (fill)', info.mode === 'fill', info.mode);
// controls screenshot (windowed)
await p.evaluate(() => window.scrollTo(0, 0));
const pr = await (await p.$('#movie_player')).boundingBox();
for (let i = 0; i < 6; i++) { await p.mouse.move(pr.x + 300 + i * 20, pr.y + pr.height - 30); await p.waitForTimeout(60); }
const ctrl = await p.$('.ytp-chrome-bottom'); const bb = await ctrl.boundingBox();
await p.screenshot({ path: path.join(SHOTS, 'yt-controls.png'), clip: { x: bb.x + bb.width - 420, y: bb.y, width: 420, height: bb.height } });
// fullscreen, then click button to cycle
await p.click('.ytp-fullscreen-button'); await p.waitForFunction(() => !!document.fullscreenElement); await p.waitForTimeout(1200);
const st = async () => p.evaluate(() => [document.querySelector('.nobars-ytp-btn').dataset.mode, document.querySelector('video').getAttribute('data-nobars')]);
out('fullscreen fill applied', (await st())[1] === 'fill', JSON.stringify(await st()));
for (const want of ['stretch', 'off', 'fill']) {
  await p.mouse.move(700, 500); await p.mouse.move(720, 880); await p.waitForTimeout(300);
  await p.click('.nobars-ytp-btn'); await p.waitForTimeout(700);
  const [btnMode, vidMode] = await st();
  out(`click → ${want} (button + video)`, btnMode === want && (want === 'off' ? vidMode === null : vidMode === want), `${btnMode}/${vidMode}`);
  if (want === 'stretch') await p.screenshot({ path: path.join(SHOTS, 'yt-fullscreen-button.png') });
  const bb2 = await (await p.$('.nobars-ytp-btn')).boundingBox();
  await p.screenshot({ path: path.join(SHOTS, `yt-icon-${want}.png`), clip: { x: bb2.x - 150, y: bb2.y - 4, width: 260, height: bb2.height + 8 } });
}
out('still fullscreen after clicks (click did not leak to player)', await p.evaluate(() => !!document.fullscreenElement));
const stored = await sw.evaluate(() => chrome.storage.sync.get('mode'));
out('click saved to settings (popup in sync)', stored.mode === 'fill', JSON.stringify(stored));
out('no Trusted Types / script errors', errs.length === 0, errs.join(' | '));
await ctx.close();
console.log(`\n${ok} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
