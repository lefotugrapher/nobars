import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
const require = createRequire(import.meta.url);

// playwright-core: local install, or PLAYWRIGHT_CORE=/path/to/playwright-core
function loadPlaywright() {
  const tries = [process.env.PLAYWRIGHT_CORE, 'playwright-core', 'playwright'].filter(Boolean);
  for (const t of tries) { try { return require(t); } catch (_) {} }
  throw new Error('playwright-core not found: run `npm i -D playwright-core` or set PLAYWRIGHT_CORE');
}
export const { chromium } = loadPlaywright();

// Branded Google Chrome ignores --load-extension, so use Chrome for Testing / Chromium.
// CHROME_PATH=... overrides; otherwise pick the newest one in the Playwright cache.
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
  const dirs = fs.existsSync(cache) ? fs.readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => +b.split('-')[1] - +a.split('-')[1]) : [];
  for (const d of dirs) {
    for (const arch of ['chrome-mac-arm64', 'chrome-mac']) {
      const p = path.join(cache, d, arch, 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
      if (fs.existsSync(p)) return p;
    }
  }
  throw new Error('Chrome for Testing not found: run `npx playwright install chromium` or set CHROME_PATH');
}
export const CHROME = findChrome();
export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

export function serve(dir, port) {
  const types = { '.html': 'text/html', '.webm': 'video/webm', '.js': 'text/javascript', '.png': 'image/png' };
  const srv = http.createServer((req, res) => {
    const p = path.join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(dir) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    const data = fs.readFileSync(p);
    const range = req.headers.range;
    const type = types[path.extname(p)] || 'application/octet-stream';
    if (range) {
      const [s, e] = range.replace('bytes=', '').split('-');
      const start = +s, end = e ? +e : data.length - 1;
      res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
      return res.end(data.subarray(start, end + 1));
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': data.length, 'Accept-Ranges': 'bytes' });
    res.end(data);
  });
  return new Promise((r) => srv.listen(port, () => r(srv)));
}

// Decode a PNG buffer to RGB via ffmpeg; returns pixel getter.
export function pixels(png, w, h) {
  const raw = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { input: png, maxBuffer: 1 << 28 });
  return (x, y) => { const i = (Math.round(y) * w + Math.round(x)) * 3; return [raw[i], raw[i + 1], raw[i + 2]]; };
}

export function classify([r, g, b]) {
  const near = (c, t) => Math.abs(c[0] - t[0]) < 70 && Math.abs(c[1] - t[1]) < 70 && Math.abs(c[2] - t[2]) < 70;
  const px = [r, g, b];
  if (r < 40 && g < 40 && b < 40) return 'black';
  if (near(px, [255, 255, 0])) return 'yellow';
  if (near(px, [0, 255, 255])) return 'cyan';
  if (near(px, [0, 255, 0])) return 'green';
  if (near(px, [0, 0, 255])) return 'blue';
  if (near(px, [255, 0, 170])) return 'magenta';
  if (r > 230 && g > 230 && b > 230) return 'white';
  return `rgb(${r},${g},${b})`;
}
