# Shader Effects

Optional screen shaders that react to the game: hits taken and landed, spells, ranged shots,
special attacks, level-ups, poison and low health, plus a set of always-on looks (colour grades,
grain, scanlines and so on). Off by default; turn it on in the plugin list.

## How it fits together

```
game events ──> ShaderFxPlugin ──> ShaderFxState ──fill()──> uniform block (40 floats)
                                                                 │
        117 HD (WebGPU, linear HDR)  ── shaderFxPass.ts ◄────────┤
        core WebGPU (display colour) ── shaderFxPass.ts ◄────────┤
        WebGL (display colour)       ── render/render/shaderFx.ts┘
```

- **`ShaderFxPlugin`** only watches the game and keeps a few decaying impulses in
  **`ShaderFxState`**. It does no drawing. Hits come from the actor hitsplat feed (the engine's
  `onHitsplat` hook only sees hits on players), graphics from `subscribeActorGraphics`,
  projectiles from `subscribeProjectiles`, and hitpoints, special energy, poison (varp 102) and
  levels are polled on the game tick.
- **`ShaderFxState.fill(out, settings, now)`** writes the frame's uniforms and returns whether
  any effect would change the picture. When it returns false nothing is recorded, so the plugin
  costs nothing while off or idle. The clock is passed in, so the state is testable without a GPU.
- The plugin exposes itself to the renderers through `ClientPlugin.shaderFx()`.

## The three paths

| Path | Where | Input |
| --- | --- | --- |
| 117 HD | `hdPostProcess.ts`, between depth of field and tonemap | linear HDR |
| Core WebGPU (HD off) | `WebGPURenderer.render`: world into an intermediate target, effects into FXAA's target or the canvas | display colour |
| WebGL | `render/render/frame/render.ts` present step: effects replace the frame copy, or draw into an intermediate target that FXAA reads | display colour |

The WGSL (`render/webgpu/shaders/shaderfx.wgsl.ts`) and the GLSL
(`render/shaders/frame-shaderfx.frag.glsl`) are ports of each other. Both work in linear light:
display-colour input is linearised on every read and encoded again on the way out
(`grade.z` is 1 for display colour in WGSL; the GLSL is always display colour).

## Adding an effect

1. Add a toggle to `ShaderFxConfig.ts` and its field to `ShaderFxSettings`.
2. If it needs an input, add a slot to the uniform block (`FxSlot`) and fill it in
   `ShaderFxState.fill`. Keep the block a whole number of vec4s.
3. Add the effect to **both** shaders. `tests/shader-fx-plugin.test.ts` checks the WGSL declares
   every uniform field the state fills.
4. Add the trigger in `ShaderFxPlugin` if it needs a game event.

WGSL reserves some words (`cast` is one): the spell uniform is called `spell`.
