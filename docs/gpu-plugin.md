# GPU plugin

A client plugin hub entry modelled on RuneLite's GPU plugin: graphics settings that players can
change and that are kept across sessions. It's off by default. While it's on, its settings
replace the renderer defaults, the browser quality profile and the dev panel's controls.

| Setting | Range | Default |
| --- | --- | --- |
| Anti-aliasing | Disabled, FXAA, MSAA x2, x4, x8, x16 | MSAA x4 |
| Draw distance | 25–160 tiles (above 90 needs 117 HD) | 25 |
| FPS limit | 0–1000, 0 for no cap | 240 |
| Colour banding | 0–100% | 0 |

## How it works

`client/game/plugins/gpu/`: `GpuPlugin.settings()` returns the resolved settings, or nothing
while the plugin is off. The renderers ask for them every frame, so a change applies straight
away and nothing has to be pushed or undone when the plugin is turned off.

- **Draw distance** replaces `OsrsClient.renderDistance` in the render-distance resolvers of
  both renderers and in scene picking. The full-detail (LOD) radius follows it at 2 tiles less,
  as the dev panel's slider does. Device caps for phones and low-end devices still apply.
- **FPS limit** replaces the client's own cap in `GameRenderer.getEffectiveFpsLimit`, including
  the cache's mobile battery cap. Hidden tabs still drop to 30 fps.
- **Colour banding** is the shaders' `u_colorBanding`, with the dev panel's mapping:
  `255 − 2 × percent`. 255 is smooth.

## Anti-aliasing

**WebGL:** MSAA sets the scene framebuffer's sample count, capped at the GPU's `MAX_SAMPLES`.
When the count changes, the framebuffer is rebuilt on the next frame. FXAA uses the existing
present pass.

**WebGPU:** core WebGPU only has 1 and 4 samples, so every MSAA level draws at x4.
- **MSAA:** the world pass draws into multisampled colour and depth targets
  (`render/webgpu/msaaTargets.ts`), and the colour resolves into the pass's normal target.
  Every pipeline that draws in the world pass is created with `createScenePipeline`
  (`render/webgpu/multisample.ts`): the main world pipelines, actors and tile markers. It's
  swapped for its x4 twin with `withSampleCount`, and the twin is built the first time it's
  needed. A new world-pass pipeline must be created the same way, or validation fails while
  MSAA is on.
- **117 HD:** SSAO, depth of field and grass need single-sampled depth, and WebGPU can't
  resolve depth. A fullscreen pass copies sample 0 into the scene depth texture after the
  world pass. Grass draws after the resolve, so its edges aren't multisampled.
- **FXAA:** without HD, the world draws into an offscreen texture that `FxaaPass`
  (`render/webgpu/fxaa.ts`, moved out of HD) presents to the canvas. With HD, the plugin's
  choice replaces HD's own Anti-aliasing toggle in its post chain.

## Not included

- **Texture filtering:** the base WebGPU world textures have no mipmaps, and the shaders
  sample level 0. HD's "Texture filtering" option already covers mipmaps and anisotropic
  filtering on WebGPU. WebGL's filter modes are still in the dev panel.
- **Scene resolution:** Stretched Mode already has this setting.

## Tests

`client/tests/gpu-plugin.test.ts`: the settings mapping and clamping, and how
multisampled twins are built and reused.
