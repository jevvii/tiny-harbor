# Tiny Harbor

A living miniature island village, rendered as a tilt-shift tabletop diorama in three.js. Everything is procedural: the island, the houses, the boats, the water, the sky, the weather and the sound. There are no models, textures, fonts or other dependencies beyond three.js itself.

## Run it

```bash
python3 -m http.server 8080
```

Then open <http://127.0.0.1:8080/>.

A local server is required because the page uses ES modules. Use a recent Chrome, Edge, Firefox or Safari with WebGL 2.

## Publish to GitHub Pages

The site is plain static files with relative paths, so it works unchanged at a project URL such as `https://<username>.github.io/tiny-harbor/`. `.nojekyll` is included so Pages serves the tree as-is.

1. Create an empty repository on GitHub. A public repository gets Pages on the free plan.
2. From this folder, commit and push:

   ```bash
   git init
   git add .
   git commit -m "Tiny Harbor"
   git branch -M main
   git remote add origin https://github.com/<username>/tiny-harbor.git
   git push -u origin main
   ```

3. On GitHub, open **Settings → Pages**. Under **Build and deployment**, set **Source** to **Deploy from a branch**, choose **main** and **/ (root)**, then save.
4. Open `https://<username>.github.io/tiny-harbor/` when the first deployment finishes. It usually takes under a minute.

There is no build step and nothing to install. The only external request is the pinned three.js 0.170.0 import map from jsDelivr. To update the site, push to `main`; Pages redeploys automatically.

If you would rather deploy through Actions, set **Source** to **GitHub Actions** and add a Pages workflow; the branch deployment above needs no workflow file.

## Controls

- **Drag** to orbit the island.
- **Scroll** or **pinch** to zoom.
- Leave it alone for ten seconds and the camera drifts slowly around the harbor again.
- **Click a boat, cottage, the windmill or the lighthouse** to glide in close and read a small note about it.
- **Click the empty sea** to return to the whole island, or use *Return to the whole island* on the note card.
- **Time slider**: scrub through the full day. The clock and phase label follow.
- **Speed buttons** (`½×` to `4×`): how fast the 60-second day passes. Time scrubs pause the clock until you pick a speed again.
- **Weather**: *Clear*, *Rain* or *Snow*.
- **Sound**: off by default. It fades in procedural surf, wind and a distant harbor bell.

## What happens

- A one-minute day: dawn mist, bright noon, golden sunset, then a blue night with stars and a moon.
- Windows and street lamps come on one by one at dusk. The lighthouse sweeps a soft beam over the water at night, and fireflies rise from the grass.
- Three boats sail slow loops, pause at the pier and set off again.
- Chimney smoke, circling gulls, jumping fish, foam at the beach, swaying trees and grass.
- Rain darkens the sky and the sea, sends down drops and ripples, and leaves the streets glossy. Snow falls softly and slowly whitens the roofs.
- Tilt-shift depth of field, soft shadows, hemisphere fill, gentle night bloom, ACES Filmic tone mapping and sRGB output.

## Video mode

Open <http://127.0.0.1:8080/?record=1>.

The page renders a fixed 1080 × 1350 (4:5) canvas with the UI hidden and plays a deterministic 40-second film:

1. Dawn, wide shot through mist.
2. The boats leave the harbor.
3. A close pass at the windmill under the noon sun.
4. Sunset, as the windows light up.
5. Night, the lighthouse beam and the fireflies.
6. Rain begins.
7. A slow pull back to the whole island.

The camera, time of day and weather cues are all keyed to the frame number, and simulation uses a fixed 1/60 s step, so two plays follow the same timeline and reproduce the same scene state frame for frame. The film stops on the last frame. (It is a real-time canvas piece, not a video encoder; capture it with a screen recorder, or step frames with the test hook below.)

## Verification and screenshots

The required states are in `screenshots/`:

- `dawn.png`
- `noon.png`
- `sunset.png`
- `night.png`
- `rain.png`
- `snow.png`
- `mobile.png` (390 × 844 phone viewport, UI fit checked)

Film stills, stepped from the 40-second timeline:

- `film-0.png` (dawn through mist)
- `film-7_2.png` (boats leaving the harbor)
- `film-12_6.png` (noon windmill pass)
- `film-26_2.png` (night, the lighthouse beam and lit windows)
- `film-36_4.png` (rain over the night harbor)
- `film-40.png` (final pull-back)

Verified in headless Chromium at 1600 × 1000: no console errors; cottages, windmill, lighthouse and boats all focus and return to the home view; the hover cursor, time slider and clock, speed buttons, weather buttons and sound toggle all respond; idle auto-orbit starts after ten real seconds. Record mode produces a fixed 1080 × 1350 canvas with the UI hidden. The phone layout at 390 × 844 fits without horizontal overflow, and clicking a cottage there works.

A development hook is exposed for testing:

```js
window.__tinyHarbor.setDayTime(0.72);   // 0..1 through the day
window.__tinyHarbor.pauseTime(true);
window.__tinyHarbor.setWeather('rain');
window.__tinyHarbor.renderOnce();
```

In record mode, `window.__tinyHarbor.filmStill(seconds)` renders an exact frame of the film and pauses the loop. It steps the film forward one frame at a time from its current frame, so weather ramps, boat departures and particle positions match what a viewer would see at that moment. Request stills in ascending order.

Add `&paused=1` (`?record=1&paused=1`) to hold the film on frame zero until it is stepped, which is how the stills above were captured.

### Measured on this machine

Measured in headless Chromium with SwiftShader (software WebGL) at 1600 × 1000: **~1.2 fps** (median of four samples, 0.77–3.39 fps). That number reflects CPU rasterization, not the scene's cost on a GPU, so it is not a meaningful 60 fps measurement and should not be read as the frame rate on a real laptop. The same frame measured 3,209 draw calls and 150,629 triangles, with 353 shadow casters.

The scene is built to hit 60 fps on hardware WebGL through instancing for trees and grass, merged geometry for static props, a 2048 shadow map for the sun (and a 1024 map for the moon), a 0.34-unit minimum size for shadow casters, and a device pixel ratio capped at 2. That target was not benchmarked on a GPU here, only on software rendering.

### Determinism

The film timeline is keyed to the frame number, day/night state is a pure function of time, and weather uses a fixed 1/60 s step, so two plays produce identical simulation state at the same frame. Rendering is not bit-identical across separate browser/GPU contexts: two captures of the same frame can differ by minor rasterization rounding. Repeated renders from the same live page are byte-identical.
