# Shader Effects

Optional screen shaders that react to the game: hits taken and landed, spells, ranged shots,
special attacks, level-ups, poison and low health, freezes and roots, teleports, valuable drops and
active prayers, plus a set of always-on looks (colour grades, grain, scanlines, ink outlines and so on). Off by default; turn it on in the plugin list.

## How it fits together

```
game events ──> ShaderFxPlugin ──> ShaderFxState ──fill()──> uniform block (56 floats)
                                                                 │
        117 HD (WebGPU, linear HDR)  ── shaderFxPass.ts ◄────────┤
        core WebGPU (display colour) ── shaderFxPass.ts ◄────────┤
        WebGL (display colour)       ── render/render/shaderFx.ts┘
```

- **`ShaderFxPlugin`** only watches the game and keeps a few decaying impulses in
  **`ShaderFxState`**. It does no drawing. Hits come from the actor hitsplat feed (the engine's
  `onHitsplat` hook only sees hits on players), graphics from `subscribeActorGraphics`,
  projectiles from `subscribeProjectiles`, and hitpoints, special energy, poison (varp 102) and
  levels are polled on the game tick. Ice and root graphics on you (Ice Rush to Barrage; Bind,
  Snare, Entangle) are statuses, not spell glows. Prayer auras read the prayer varbits each tick,
  and the aura follows the player's own model: on the WebGPU renderers (117 HD and core) the
  controlled player's posed geometry is drawn into a frame-sized r8 mask (`playerMask.ts`,
  `WebGPUActors.drawPlayerMask`, the actor shader's `fs_mask`) before the effects pass, and the
  shader glows outward from it with wisps rising. The WebGL renderer has no mask and falls back to
  a generic figure shape around the player's screen spot; the plugin asks the scene for that spot
  every frame the aura shows. A teleport winds up when its graphic plays on you (a teleport
  graphic, not an animation: the ancient teleport shares one with the ancient combat spells), and
  lands when you then jump six tiles or more between two ticks. A jump with no wind-up before it
  (a ladder, a trapdoor into a dungeon, an instance, a boat, `::tele`) is not a landing and plays
  no warp. If no landing follows within 3.6 s the wind-up fades out. Loot flashes come from the
  ground item store and are limited to real drops: only a new stack that is yours (self or group
  ownership), worth price times quantity over the threshold, made within the last few ticks (a
  region snapshot's re-adds and stacks you walk back to are old), and not an item that just left
  your inventory or worn items (your own drop, your death pile) counts. Stacks are judged two
  game ticks after they appear, so that inventory change has arrived; a snapshot's despawn and
  re-add within 100 ms is ignored too. Nothing counts before the session's first tick message:
  the login snapshot arrives ahead of it, and your own stacks in it cannot be told from drops.
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

## While off or idle

Nothing is allocated while the plugin is off, on any path, and `fill` makes no objects per frame.
The prayer aura's extras follow the same rule: the player silhouette pipelines are built the
first time an aura shows, and the frame-sized mask target is freed the first frame no aura wants
it (a player who never turns on a prayer never pays for either).

## Adding an effect

1. Add a toggle to `ShaderFxConfig.ts` and its field to `ShaderFxSettings`.
2. If it needs an input, add a slot to the uniform block (`FxSlot`) and fill it in
   `ShaderFxState.fill`. Keep the block a whole number of vec4s.
3. Add the effect to **both** shaders. `tests/shader-fx-plugin.test.ts` checks the WGSL declares
   every uniform field the state fills.
4. Add the trigger in `ShaderFxPlugin` if it needs a game event.

WGSL reserves some words (`cast` is one): the spell uniform is called `spell`.
