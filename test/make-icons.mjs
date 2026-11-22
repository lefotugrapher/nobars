import { chromium, CHROME, ROOT } from './lib.mjs';
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff4d84"/><stop offset="1" stop-color="#ff1f5a"/></linearGradient></defs>
<rect x="4" y="4" width="120" height="120" rx="28" fill="#18181c"/>
<rect x="16" y="30" width="96" height="68" rx="8" fill="url(#g)"/>
<path d="M64 46v-10m0 0l-7 7m7-7l7 7M64 82v10m0 0l-7-7m7 7l7-7" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
<path d="M52 64l18-11v22z" fill="#fff"/></svg>`;
const b = await chromium.launch({ executablePath: CHROME });
const p = await b.newPage();
for (const s of [16, 32, 48, 128]) {
  await p.setViewportSize({ width: s, height: s });
  await p.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${s}" height="${s}" `)}</body></html>`);
  await p.screenshot({ path: `${ROOT}/extension/icons/icon${s}.png`, omitBackground: true });
}
await b.close();
console.log('icons ok');
