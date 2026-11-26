# Portfolio v0.1 Release Checklist

Last updated: 2026-11-07 (Asia/Tokyo)

## Automated and Local Checks Completed

- [x] TypeScript project check succeeds.
- [x] `npm run build` succeeds with Vite 7.3.6.
- [x] Production `index.html`, CSS, and JavaScript return HTTP 200 from `vite preview`.
- [x] Generated asset URLs are relative and no localhost or absolute local filesystem paths were found in source or documentation.
- [x] Production browser console contained no warning or error entries during the automated pass.
- [x] Showcase UI is the default and Advanced/Debug is hidden.
- [x] Controls Help opens, matches `CameraController`, and closes correctly.
- [x] Calm Day, Sunset, Rain, and Storm presets interpolate through `EnvironmentController`.
- [x] Reset restores environment/debug/audio defaults without resetting camera position.
- [x] Reset Camera is separate from environment reset.
- [x] Audio starts from a user gesture, reports a running `AudioContext`, and Reset returns to muted state without replacing the context.
- [x] WebGL2 and initialization failures have visible fallback messages.
- [x] Renderer DPR remains capped at 2 and resize updates renderer size and camera aspect.
- [x] Renderer, GUI, audio, geometry, materials, rain resources, and cubemap render target are connected to disposal.
- [x] Foam and sun shafts remain disabled by default.

## Automated Browser Baseline

Environment: Codex in-app browser, 1280 × 720 production preview. This is a CPU cadence comparison, not GPU timing and not a substitute for testing the target portfolio browser/GPU.

| Scene | Mode | FPS | CPU frame interval | Draw calls | Triangles |
|---|---:|---:|---:|---:|---:|
| Calm Day | Final | ~20 | ~50 ms | 3 | 275,328 |
| Sunset | Final | ~20 | ~50 ms | 3 | 275,328 |
| Rain | Final | ~20 | ~50 ms | 3 | 275,328 |
| Storm | Final | ~20 | ~50 ms | 3 | 275,328 |
| Calm Day | Physical | ~20 | ~50 ms | 3 | 275,328 |
| Underwater test camera | Final | ~28 | ~36 ms | 2 | 275,328 |

These historical readings used simulation intervals capped at 50 ms, so low frame rates were overstated. Draw calls and triangles covered only the final scene pass. Current diagnostics use elapsed frame intervals and include cubemap capture on refresh frames. Repeat the measurements on the target device before citing a baseline.

## Manual Checks Still Required Before Publication

- [ ] Record FPS and frame pacing in current Chrome/Edge on the intended discrete or integrated GPU.
- [ ] Inspect Day, Sunset, and Night for visual regressions at the target viewport.
- [ ] Inspect Rain and Storm particles, reflections, and audio on the target browser.
- [ ] Test underwater and slow surface crossing with the real camera controls.
- [ ] Compare Physical, Palette, and Final at matched camera positions.
- [ ] Resize between common desktop and mobile-width viewports.
- [ ] Test audio mute/resume and output character on headphones and speakers.
- [ ] Capture the five real portfolio screenshots listed in `portfolio.md`.
- [ ] Record the suggested portfolio video sequence.
- [ ] Add author identity, contribution statement, repository URL, and license.
- [ ] Deploy `dist/` to the chosen static host and verify the deployed URL.
