const DEFAULTS = { mode: 'fill', scope: 'fullscreen', skipExtreme: true, disabledSites: [] };
const ORDER = ['fill', 'stretch', 'off'];

// No install-time default writing: every reader uses get(DEFAULTS), so missing keys
// fall back safely and we can never clobber a setting the user just changed.

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== 'cycle-mode') return;
  const { mode } = await chrome.storage.sync.get(DEFAULTS);
  const next = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
  await chrome.storage.sync.set({ mode: next, toastAt: Date.now() });
});
