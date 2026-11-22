# NoBars — Fill Video to Screen (Chrome extension)

Removes the black bars you get when a 16:9 video plays fullscreen on a 16:10 MacBook screen
(or any screen shape). Works on YouTube, embedded players (iframes), Netflix-style players, and
generic HTML5 video.

## Install (once)
1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** → pick the `extension` folder in this repo
4. Pin the NoBars icon (puzzle-piece menu → pin)

## Use
- Go fullscreen on any video → bars are gone (default mode **Fill**).
- **YouTube button**: a NoBars button sits in the player controls, left of theatre/fullscreen.
  Click it to cycle **Fill → Stretch → Off**; the icon shows the current mode (also works in fullscreen).
- **⌥⇧F** (Option+Shift+F) cycles **Fill → Stretch → Off** — works while fullscreen, shows a toast.
  Change it at `chrome://extensions/shortcuts`.
- Popup:
  - **Fill** – zooms until no bars, crops a sliver off the sides (no distortion). 16:9 on 16:10 crops ~10% width.
  - **Stretch** – fills exactly, no crop, picture ~11% taller-squashed on a 16:10 screen.
  - **Off** – original.
  - **Fullscreen only / Everywhere** – Everywhere also fills windowed/theatre players (clipped to the player box).
  - **Skip vertical / extreme videos** – leaves 9:16 Shorts-style videos alone instead of zooming 3×.
  - **Enabled on <site>** – per-site off switch.

On the external monitor (16:9) nothing changes because there are no bars to remove.

## How it works
`content.js` measures where the picture is actually painted inside each `<video>` (respecting
`object-fit` and the site's own inline sizing, e.g. YouTube's letterbox maths), then applies a
CSS `transform` so the picture covers the screen/player. It never fights the site's layout code,
re-applies if the site rewrites the video's style, and restores everything when you exit fullscreen.

## Tests
Needs `playwright-core` (`npm i -D playwright-core`, or point `PLAYWRIGHT_CORE` at an existing copy) and
Chrome for Testing (`npx playwright install chromium`, or set `CHROME_PATH`).
```
node test/run.mjs          # 57 checks: YouTube-like, Netflix-like, iframe embed, windowed, vertical, popup
node test/youtube-live.mjs # real YouTube in headless Chrome (needs network)
node test/yt-button.mjs    # real YouTube: player button injected, cycles modes, works in fullscreen
```
Uses Chrome for Testing from the Playwright cache with the unpacked extension loaded, plays a
16:9 clip with coloured edges on a 1512×945 (MacBook 14" fullscreen) viewport and checks pixels.
Screenshots land in `test/shots/`.
