# Portfolio Showcase Plan — v0.1

## One-Sentence Introduction

Finite Palette Ocean is a fully procedural browser environment that connects atmosphere, weather, ocean reflection, underwater optics, stylized palette rendering, and generative ambience through one shared environmental state.

## Design Goal

The project aims for **physically coherent procedural stylization**: the physical scene should remain understandable without stylization, while palette mapping and dithering provide a recognizable visual language without replacing the underlying natural relationships.

## Three Core Technical Highlights

1. **Unified procedural environment signal** — sun, atmosphere, clouds, weather, environment cubemap, and water reflection are driven by the same time and weather state.
2. **Multi-scale ocean and water transition** — macro swell, directional wind waves, optical normal detail, rain rings, water volume, and continuous air/water surface crossing are evaluated without prerecorded simulation assets.
3. **Physical-to-stylized pipeline** — continuous physical lighting can be inspected directly, tone mapped, or passed through semantic palette-guided rendering and restrained dithering.

## Key Challenges and Current Solutions

### Stable Horizon Reflection

Near-horizon reflection directions are clamped to a safe upper hemisphere, cloud reflection fades toward the horizon, and rough distant reflection uses a restrained environment mip and atmosphere approximation.

### Surface Crossing and Underwater Optics

Dynamic wave height, analytical surface traces, camera-medium hysteresis, water-to-air Fresnel, refraction, and TIR use shared conventions to reduce waterline discontinuities.

### Procedural Detail Without Obvious Repetition

Wind-aligned mid/high surface detail uses irregular directions, frequencies, phase offsets, low-frequency warping, and distance-aware anti-aliasing. Experimental periodic sun shafts remain disabled rather than being hidden with blur.

## Suggested Video Sequence

Target length: 45–70 seconds.

1. **0–8 s — Calm introduction:** default view, slow left-drag camera movement, Final mode.
2. **8–16 s — Physical comparison:** switch from Final to Physical and pause long enough to show the underlying lighting.
3. **16–25 s — Sunset:** select Sunset, hold the horizon while the environment interpolates.
4. **25–35 s — Rain and storm:** select Rain, then Storm; show rain particles, water response, and reflection changes.
5. **35–48 s — Surface crossing:** right-drag downward slowly through the animated surface and hold at shallow depth.
6. **48–58 s — Underwater:** look upward through the dynamic surface, then horizontally toward volume scattering.
7. **58–70 s — Return:** rise above water, restore Calm Day or the showcase defaults, and end on the title view.

Record the real browser output. Do not substitute external ocean footage or generated concept art.

## Screenshot Checklist

Use a consistent 16:9 viewport and record the browser, GPU, resolution, and rendering mode used.

- `01-calm-ocean-final.png` — default or Calm Day, Final mode
- `02-sunset-twilight-final.png` — Sunset, Final mode
- `03-rain-storm-final.png` — Rain or Storm, Final mode
- `04-underwater-physical.png` — shallow underwater, Physical mode
- `05-physical-vs-final.png` — matched camera comparison, Physical and Final

Optional technical captures:

- Environment reflection diagnostic
- Water transmittance or Snell/TIR diagnostic
- Showcase UI versus Advanced/Debug UI

## Capture Procedure

1. Run a production preview with `npm run build` followed by `npm run preview`.
2. Reset to Showcase Defaults and Reset Camera.
3. Select the desired preset and wait for environment interpolation to settle.
4. Hide the UI with `H` for clean beauty shots, or keep it visible for an interface shot.
5. Capture from the actual running project at native browser resolution.
6. Re-enable UI and record the preset, rendering mode, and any non-default setting used.

## Known Limits to Avoid Misrepresenting

- High-altitude ocean horizon artifacts remain outside the normal showcase camera range.
- Night far-water readability is not the strongest portfolio view.
- Foam and experimental sun shafts are intentionally disabled.
- Clouds are procedural sky layers rather than volumetric clouds.
- Audio requires a user click and cannot be represented by screenshots.

See [known-limitations.md](known-limitations.md) for the complete release list.

## Author Notes Before Publication

- Add the author name, role, project dates, and contact/portfolio link.
- Add a concise personal contribution statement.
- Select a source-code license if the repository will be public.
- Replace this planning checklist with verified screenshots only after they have been captured from the final build.
