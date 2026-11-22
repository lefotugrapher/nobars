// Live check on real YouTube (needs network). Fullscreens a 16:9 video on a 16:10 viewport.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { chromium, CHROME, ROOT, pixels } from './lib.mjs';
const W = 1512, H = 945, EXT = path.join(ROOT, 'extension');
const url = process.argv[2] || 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';
const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'nb-yt-')), { executablePath: CHROME, headless: true, viewport: { width: W, height: H }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--autoplay-policy=no-user-gesture-required'] });
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
const p = await ctx.newPage();
await p.goto(url, { waitUntil: 'domcontentloaded' });
// Decline non-essential cookies if YouTube's consent dialog shows (it can appear late)
const reject = p.getByRole('button', { name: /^Reject all$/ }).first();
await reject.waitFor({ state: 'visible', timeout: 12000 }).then(() => reject.click()).catch(() => console.log('no consent dialog'));
await p.waitForTimeout(1500);
await p.waitForSelector('video', { timeout: 30000 });
await p.waitForFunction(() => { const v = document.querySelector('video'); return v && v.videoWidth > 0; }, null, { timeout: 30000 });
await p.evaluate(() => document.querySelector('video').play().catch(() => {}));
await p.waitForTimeout(2500);
const total = async (name, mode) => {
  await sw.evaluate((m) => chrome.storage.sync.set({ mode: m, scope: 'fullscreen' }), mode);
  await p.waitForTimeout(1200);
  const png = await p.screenshot(); fs.writeFileSync(path.join(ROOT, 'test', 'shots', name + '.png'), png);
  const px = pixels(png, W, H);
  // fraction of near-black pixels in top/bottom 30px bands
  let blk = 0, n = 0;
  for (let x = 20; x < W; x += 15) for (const y of [5, 15, 25, H - 6, H - 16, H - 26]) { const [r, g, b] = px(x, y); n++; if (r < 22 && g < 22 && b < 22) blk++; }
  const info = await p.evaluate(() => { const v = document.querySelector('video'); const r = v.getBoundingClientRect(); return { attr: v.getAttribute('data-nobars'), vid: [v.videoWidth, v.videoHeight], t: +v.currentTime.toFixed(1), rect: [r.left, r.top, r.width, r.height].map(Math.round), style: v.getAttribute('style'), fit: getComputedStyle(v).objectFit, fsEl: document.fullscreenElement && (document.fullscreenElement.id || document.fullscreenElement.tagName), n: document.querySelectorAll('video').length }; });
  return { mode, blackInBars: (blk / n).toFixed(2), ...info };
};
await p.click('#movie_player', { position: { x: 200, y: 200 } }).catch(() => {});
await p.keyboard.press('f');
await p.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 8000 });
console.log(await total('youtube-off', 'off'));
console.log(await total('youtube-fill', 'fill'));
console.log(await total('youtube-stretch', 'stretch'));
await ctx.close();
