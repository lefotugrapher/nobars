const DEFAULTS = { mode: 'fill', scope: 'fullscreen', skipExtreme: true, disabledSites: [] };
const $ = (s) => document.querySelector(s);
let cfg = { ...DEFAULTS };
let host = '';

function render() {
  document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === cfg.mode));
  document.querySelectorAll('[data-scope]').forEach((b) => b.classList.toggle('on', b.dataset.scope === cfg.scope));
  $('#skipExtreme').checked = !!cfg.skipExtreme;
  $('#siteOn').checked = !cfg.disabledSites.includes(host);
  $('#siteRow').style.display = host ? '' : 'none';
  $('#host').textContent = host || 'this site';
}

function save(patch) {
  Object.assign(cfg, patch);
  chrome.storage.sync.set(patch);
  render();
}

document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => save({ mode: b.dataset.mode })));
document.querySelectorAll('[data-scope]').forEach((b) => b.addEventListener('click', () => save({ scope: b.dataset.scope })));
$('#skipExtreme').addEventListener('change', (e) => save({ skipExtreme: e.target.checked }));
$('#siteOn').addEventListener('change', (e) => {
  const set = new Set(cfg.disabledSites);
  if (e.target.checked) set.delete(host); else set.add(host);
  save({ disabledSites: [...set] });
});
$('#shortcuts').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

chrome.commands.getAll((cmds) => {
  const c = cmds.find((x) => x.name === 'cycle-mode');
  if (c) $('#kbd').textContent = c.shortcut || 'not set';
});

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  try {
    const u = new URL(tabs[0].url);
    if (u.protocol === 'http:' || u.protocol === 'https:') host = u.hostname;
  } catch (_) {}
  chrome.storage.sync.get(DEFAULTS, (c) => { cfg = { ...DEFAULTS, ...c }; render(); });
});
