# Known Limitations — Portfolio v0.1

This document records confirmed limits of the current implementation. They are intentionally documented rather than hidden by release-polish changes.

## Rendering

- **High-altitude ocean horizon:** the finite recentered ocean mesh can expose horizon artifacts from unusually high camera positions. Portfolio capture should use the normal showcase altitude range.
- **Night distance readability:** moonlit far-water structure is less readable than the daylight and twilight presentation.
- **Environment capture precision:** the procedural environment cubemap currently uses RGBA8. Extremely bright highlights and very subtle mip gradients have less dynamic range than a half-float capture.
- **Cloud model:** clouds are a procedural sky layer, not volumetric clouds with true multi-scattering or self-shadowed volume integration.
- **Finite analytical rain ripples:** visible rain rings use a pool of 32 analytical events rather than a persistent height-field simulation.
- **No coastline or floating reference objects:** the deliberate sky-and-open-ocean composition can make absolute scale difficult to judge.

## Frozen Experimental Features

- **Foam / whitecaps:** the foam strength defaults to zero. Existing debug code remains available, but foam is not part of the Portfolio v0.1 presentation.
- **Volumetric sun shafts:** the experimental shaft path remains disabled because its procedural focusing produced visible periodic artifacts.
- **Caustics and particles:** caustics, bubbles, and underwater particles are not implemented.

## Audio

- Audio requires a user gesture and starts disabled because of browser autoplay policies.
- Procedural rain and ocean audio are designed for an open-water ambience; they do not simulate shoreline breaking waves, thunder, binaural propagation, or object-based spatial audio.
- Audio character varies across browsers and output devices because the implementation uses the native Web Audio pipeline.

## Browser and Performance

- WebGL2 and hardware acceleration are required.
- The ocean uses a dense single plane rather than a quadtree or GPU LOD system. Integrated GPUs and high-DPR displays may need a smaller browser window for stable frame cadence.
- Runtime diagnostics report CPU frame cadence and Three.js renderer statistics, not accurate GPU frame time.
- The current bundle keeps Three.js and shader source in one main chunk, so initial download size is larger than a code-split application.

## Portfolio Capture Guidance

- Capture the default, sunset, rain, storm, and underwater scenes on the same browser/GPU used for final review.
- Avoid presenting high-altitude horizon views as representative output.
- Verify audio separately; still images cannot demonstrate the procedural audio system.
