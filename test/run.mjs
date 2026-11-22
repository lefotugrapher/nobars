// End-to-end test: loads the real unpacked extension into Chrome for Testing,
// plays a 16:9 clip on a 16:10 MacBook-shaped viewport, and checks screen pixels.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, CHROME, ROOT, serve, pixels, classify } from './lib.mjs';

const W = 1512, H = 945; // MacBook Pro 14" fullscreen area below the notch (16:10)
const PORT = 8765;
const EXT = path.join(ROOT, 'extension');
const SHOTS = path.join(ROOT, 'test', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const srv = await serve(path.join(ROOT, 'test'), PORT);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nobars-'));
const ctx = await chromium.launchPersistentContext(profile, {
  executablePath: CHROME,
  headless: true,
  viewport: { width: W, height: H },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--autoplay-policy=no-user-gesture-required'],
});
let sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
const setCfg = (c) => sw.evaluate((c) => chrome.storage.sync.set(c), c);

let pass = 0, fail = 0;
const results = [];
function check(name, cond, detail) {
  (cond ? pass++ : fail++);
  results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  -> ' + detail}`);
}

async function shot(page, name) {
  const png = await page.screenshot();
  fs.writeFileSync(path.join(SHOTS, name + '.png'), png);
  const px = pixels(png, W, H);
  return (x, y) => classify(px(x, y));
}

async function waitPlaying(frame) {
  await frame.waitForFunction(() => { const v = document.querySelector('video'); return v && v.readyState >= 3 && v.currentTime > 0.2; }, null, { timeout: 15000 });
}

// Edge sample points for a fullscreen screen
const E = { top: [W * 0.15, 4], bottom: [W * 0.15, H - 4], left: [4, H * 0.3], right: [W - 4, H * 0.3] };
const edges = (s) => Object.fromEntries(Object.entries(E).map(([k, [x, y]]) => [k, s(x, y)]));

async function fullscreenCase(file, mode, { inIframe = false } = {}) {
  await setCfg({ mode, scope: 'fullscreen', skipExtreme: true, disabledSites: [] });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/${file}`);
  let frame = page.mainFrame();
  if (inIframe) { await page.waitForSelector('#f'); frame = page.frames().find((f) => f.url().includes('yt.html')) || (await (await page.$('#f')).contentFrame()); }
  await waitPlaying(frame);
  // Before fullscreen: extension must not touch the windowed player (scope = fullscreen)
  const pre = await frame.evaluate(() => document.querySelector('video').hasAttribute('data-nobars'));
  check(`${file}${inIframe ? ' (iframe)' : ''} [${mode}] untouched before fullscreen`, !pre, 'transform applied outside fullscreen');
  await frame.click('#fs');
  await frame.waitForFunction(() => !!document.fullscreenElement);
  await page.waitForTimeout(900);
  const s = await shot(page, `${path.basename(file, '.html')}${inIframe ? '-iframe' : ''}-${mode}`);
  const e = edges(s);
  const tag = `${file}${inIframe ? ' (iframe)' : ''} [${mode}]`;
  if (mode === 'off') {
    check(`${tag} has black bars (baseline)`, e.top === 'black' && e.bottom === 'black', JSON.stringify(e));
  } else if (mode === 'fill') {
    check(`${tag} top edge = video top (no bar)`, e.top === 'yellow', JSON.stringify(e));
    check(`${tag} bottom edge = video bottom (no bar)`, e.bottom === 'cyan', JSON.stringify(e));
    check(`${tag} sides cropped, not black`, !['black', 'green', 'blue'].includes(e.left) && !['black', 'green', 'blue'].includes(e.right), JSON.stringify(e));
  } else if (mode === 'stretch') {
    check(`${tag} all 4 video edges touch screen edges`, e.top === 'yellow' && e.bottom === 'cyan' && e.left === 'green' && e.right === 'blue', JSON.stringify(e));
  }
  const scroll = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight, innerWidth, innerHeight]);
  check(`${tag} no page scrollbars introduced`, scroll[0] <= scroll[2] + 1, JSON.stringify(scroll));
  if (mode !== 'off') {
    // Site re-writes inline style every 700ms (like YouTube) — must survive
    await page.waitForTimeout(1600);
    const s2 = await shot(page, `${path.basename(file, '.html')}${inIframe ? '-iframe' : ''}-${mode}-later`);
    check(`${tag} still filled after site relayout`, s2(...E.top) === 'yellow', s2(...E.top));
    // Exit fullscreen → restored
    await frame.evaluate(() => document.exitFullscreen());
    await page.waitForTimeout(500);
    const after = await frame.evaluate(() => { const v = document.querySelector('video'); return [v.hasAttribute('data-nobars'), v.style.transform]; });
    check(`${tag} restored after exiting fullscreen`, !after[0] && !after[1], JSON.stringify(after));
  }
  await page.close();
}

for (const mode of ['off', 'fill', 'stretch']) {
  await fullscreenCase('yt.html', mode);
  await fullscreenCase('contain.html', mode);
  await fullscreenCase('iframe.html', mode, { inIframe: true });
}

// Windowed 16:10 player, scope = everywhere: fills the player, never spills onto the page
for (const mode of ['off', 'fill', 'stretch']) {
  await setCfg({ mode, scope: 'always', skipExtreme: true, disabledSites: [] });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/windowed.html`);
  await waitPlaying(page.mainFrame());
  await page.waitForTimeout(700);
  const s = await shot(page, `windowed-${mode}`);
  const tag = `windowed 16:10 player [${mode}]`;
  const inTop = s(300, 153), inBot = s(300, 646), inL = s(203, 400), inR = s(996, 400);
  const outs = [s(600, 146), s(600, 655), s(196, 400), s(1004, 400)];
  if (mode === 'off') check(`${tag} has bars inside player (baseline)`, inTop === 'black' && inBot === 'black', `${inTop} ${inBot}`);
  if (mode === 'fill') check(`${tag} fills player top+bottom`, inTop === 'yellow' && inBot === 'cyan', `${inTop} ${inBot}`);
  if (mode === 'stretch') check(`${tag} stretches to all 4 player edges`, inTop === 'yellow' && inBot === 'cyan' && inL === 'green' && inR === 'blue', `${inTop} ${inBot} ${inL} ${inR}`);
  check(`${tag} nothing painted outside player`, outs.every((c) => c === 'white'), outs.join(','));
  await page.close();
}

// Vertical 9:16 video with "skip extreme" on: left alone rather than zoomed 3x
{
  await setCfg({ mode: 'fill', scope: 'fullscreen', skipExtreme: true, disabledSites: [] });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/vertical.html`);
  await waitPlaying(page.mainFrame());
  await page.click('#fs');
  await page.waitForTimeout(900);
  const a = await page.evaluate(() => document.querySelector('video').hasAttribute('data-nobars'));
  check('vertical 9:16 video skipped (skip extreme on)', !a, 'was zoomed');
  await setCfg({ skipExtreme: false });
  await page.waitForTimeout(600);
  const s = await shot(page, 'vertical-fill-forced');
  check('vertical 9:16 fills when skip extreme off', s(4, H / 2) !== 'black', s(4, H / 2));
  await page.close();
}

// Per-site disable + live mode switch + toast while fullscreen
{
  await setCfg({ mode: 'fill', scope: 'fullscreen', skipExtreme: true, disabledSites: [] });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/yt.html`);
  await waitPlaying(page.mainFrame());
  await page.click('#fs');
  await page.waitForTimeout(800);
  await setCfg({ mode: 'stretch', toastAt: Date.now() }); // what the ⌥⇧F shortcut does
  await page.waitForTimeout(300);
  const toast = await page.evaluate(() => [...document.fullscreenElement.querySelectorAll('div')].some((d) => d.textContent.startsWith('NoBars:')));
  check('shortcut toast visible inside fullscreen', toast, 'no toast');
  await page.waitForTimeout(400);
  const m = await page.evaluate(() => document.querySelector('video').getAttribute('data-nobars'));
  check('live mode switch fill -> stretch without reload', m === 'stretch', m);
  await setCfg({ disabledSites: ['localhost'] });
  await page.waitForTimeout(500);
  const d = await page.evaluate(() => document.querySelector('video').hasAttribute('data-nobars'));
  check('per-site disable turns it off instantly', !d, 'still applied');
  await page.close();
}

// Popup renders and writes settings
{
  await setCfg({ mode: 'fill', scope: 'fullscreen', skipExtreme: true, disabledSites: [] });
  const extId = sw.url().split('/')[2];
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 300, height: 340 });
  await page.goto(`chrome-extension://${extId}/popup.html`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, 'popup.png'), fullPage: true });
  await page.click('[data-mode="stretch"]');
  await page.click('[data-scope="always"]');
  await page.waitForTimeout(200);
  const c = await sw.evaluate(() => chrome.storage.sync.get(null));
  check('popup saves mode + scope', c.mode === 'stretch' && c.scope === 'always', JSON.stringify(c));
  await page.close();
}

await ctx.close();
srv.close();
fs.rmSync(profile, { recursive: true, force: true });
console.log(results.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
