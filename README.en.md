# Finite Palette Ocean — Portfolio v0.1

[日本語版](README.md)

A browser-based procedural ocean environment built with TypeScript, Three.js, GLSL, and the Web Audio API. The project explores a physically coherent baseline—waves, atmosphere, weather, reflection, water volume, and surface crossing—followed by palette-guided stylization inspired by a dynamic 16-color palette.

The scene is generated at runtime. It does not require image textures, prerecorded ambience, a backend, or external scene assets.

## Features

- Directional swell and wind-wave fields with deep-water dispersion
- Procedural atmosphere, sun, moon, twilight, clouds, rain, and environment reflection
- Physical, tone-mapped, palette, and palette-with-dithering rendering modes
- Water absorption, scattering, refraction, seabed visibility, and underwater surface optics
- Continuous camera transitions between air and water
- Procedural ocean and rain audio with air/underwater filtering
- Showcase presets for calm daylight, sunset, rain, and storm
- Compact public controls with the full diagnostic interface kept behind an Advanced mode

Foam and experimental sun shafts remain disabled in Portfolio v0.1.

## Technology Stack

- TypeScript 5
- Three.js / WebGL2
- GLSL vertex and fragment shaders
- Vite
- lil-gui
- Native Web Audio API

## Installation

Requirements:

- Node.js `^20.19.0 || >=22.12.0`
- A current WebGL2-capable desktop browser
- Hardware acceleration enabled in the browser

```bash
npm ci
npm run dev
```

Open the local URL printed by Vite.

## Development

```bash
npm run dev
```

The application runs entirely in the browser. Environment changes are interpolated through `EnvironmentController`; public presets do not write shader uniforms directly.

## Production Build

```bash
npm run build
npm run preview
```

The static output is written to `dist/`. Vite uses relative asset paths, so the build can be hosted at a domain root, a repository subdirectory, or a generic static file host without assuming a future repository name.

## Controls

| Input | Action |
|---|---|
| Left mouse drag | Change yaw and pitch together for free observation |
| Right mouse drag upward/downward | Move vertically in world space; rise or dive |
| `W` / `S` | Move forward/backward horizontally using camera yaw |
| `H` | Hide or restore the control panel |
| Reset Camera button | Return to the initial portfolio view |

The camera controller intentionally has no wheel zoom or keyboard vertical movement.

## Showcase Controls

The interface starts in English. Use **Language** at the top of the control panel to switch between **English**, **简体中文**, and **日本語**. The advanced controls, help, notifications, and error messages switch with the rest of the interface. Scene settings stay in place when the language changes. Reloading returns the interface to English.

The showcase panel includes the following controls.

- Language
- Time of Day
- Weather / Rain
- Wind
- Rendering Mode
- Audio Enable / Mute
- Master Volume
- Calm Day, Sunset, Rain, and Storm presets
- Reset to Default
- Reset Camera
- Controls Help

Choose **Advanced / Debug** from the Interface selector to reveal shader diagnostics, wave internals, atmosphere and water coefficients, underwater debug views, audio diagnostics, and lightweight runtime statistics.

## Rendering Modes

1. **Physical** — continuous linear physical shading without palette mapping
2. **Physical + Tone Mapping** — exposure and tone compression applied to the physical result
3. **Palette** — semantic palette-guided stylization
4. **Final / Palette + Dithering** — palette-guided output with restrained ordered dithering

The final image is not claimed to contain strictly sixteen output colors. Continuous physical lighting, semantic palette matching, blending, and color-space conversion remain part of the pipeline.

## Audio

Audio is disabled by default. Select **Enable Audio / Mute** from the UI to create or resume the `AudioContext` from a user gesture, as required by browser autoplay rules.

The audio engine generates ocean rumble, broadband water movement, non-periodic surge, rain texture, and droplet transients procedurally. Camera depth relative to the animated surface continuously crossfades between air and filtered underwater buses. No prerecorded audio files are loaded.

Resetting the showcase mutes audio and restores its volume defaults without creating a second `AudioContext`.

## Technical Overview

### Procedural Wave Field

Large swell and wind-driven main waves are evaluated as directional Gerstner-style components using deep-water dispersion. Smaller scales are represented by irregular directional normal detail. Rain ripples use a bounded analytical ring pool.

### Procedural Atmosphere and Clouds

The sky combines simplified Rayleigh/Mie responses, horizon haze, solar and lunar direction, and domain-warped procedural clouds. The same environment state drives the visible sky and the reflection capture. At sunset, the sun stays visible as the rendered ocean surface gradually covers its disc.

### Shared Environment Cubemap

A small procedural cubemap captures the sky for surface reflections, underwater refraction, and aerial perspective near the horizon. When **Enable Environment Reflection** is off, underwater refraction and aerial perspective still follow changes in time and weather. Water reflection selects mip levels based on surface roughness and uses separate analytical sun and moon highlights.

### Palette-Guided Rendering

Physical radiance is tone mapped and optionally matched against a dynamic palette using material semantics for sky, water, clouds, highlights, and foam. Ordered dithering is applied only in the final mode.

### Water Volume and Underwater Optics

The water path uses absorption, scattering, directional underwater illumination, refraction, exact water-to-air Fresnel, total internal reflection, and a procedural seabed. Surface traces and camera-medium hysteresis support continuous waterline crossing.

### Procedural Audio

Persistent Web Audio nodes generate layered ocean and rain signals. Weather values drive their gain and spectral character; camera depth controls air/water crossfades and underwater low-pass filtering.

## Loading, Compatibility, and Diagnostics

- WebGL2 support is checked before renderer creation.
- Initialization and shader compilation errors appear on screen.
- If the WebGL context is lost, the interface shows a recovery message. After restoration, the renderer rebuilds all six cubemap faces before drawing its first frame and clears the message once that frame renders successfully.
- Device pixel ratio is capped at `2` and recalculated on resize.
- Advanced diagnostics expose CPU frame cadence, approximate frame time, renderer resolution, draw calls, and triangle count. These values are not GPU timing measurements.
- Audio startup failures are non-blocking and do not stop the WebGL scene.

## Static Deployment

Upload the contents of `dist/` to any static host. No backend or environment variables are required. The deployment should serve `index.html` and the generated `assets/` directory from the same location.

Examples include GitHub Pages, Cloudflare Pages, Netlify, Vercel static hosting, or a conventional web server. Portfolio v0.1 has been prepared for deployment but this repository does not claim a completed external deployment.

## Known Limitations

See [docs/known-limitations.md](docs/known-limitations.md).

## Portfolio Capture

Shot planning, screenshot names, and a suggested short video sequence are documented in [docs/portfolio.md](docs/portfolio.md). All published screenshots should be captured from the running project; external reference imagery should not be presented as project output.

Automated checks, the in-app performance comparison, and remaining manual release gates are tracked in [docs/release-checklist.md](docs/release-checklist.md).

## Credits and Development Process

- Three.js and its type definitions
- lil-gui
- Vite and TypeScript

Development used AI coding agents as implementation and review assistants. Their work included code generation, debugging suggestions, refactoring support, and documentation drafting under iterative human direction and visual review. The project author should add a personal contribution statement before publication rather than treating generated text as proof of individual authorship.

## License

No public license has been selected. Add an explicit license before redistributing the source as an open-source project.
