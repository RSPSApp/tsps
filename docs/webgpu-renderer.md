# WebGPU renderer

Goal: the client renders through WebGPU when the browser supports it, and falls back to the
existing WebGL2/PicoGL renderer when it does not, with no user-visible difference once each
stage lands. Staged so the game is never less playable than it is today.

Status legend: **done**, **in progress**, **planned**.

## Where things are today
- `Renderer` (`client/game/render/Renderer.ts`) owns the canvas, resize and the frame scheduler.
- `GameRenderer` (`client/game/GameRenderer.ts`) is the game-level shell: `MapManager`, camera
  input, cache init, map streaming policy. It is already generic over `MapSquare`.
- `WebGLOsrsRenderer` (`client/render/WebGLOsrsRenderer.ts`) is the only concrete backend. Its
  frame loop lives in `client/render/render/` and drives PicoGL directly (`host.app`, `host.gl`,
  `host.*Program`).
- Textures/meshes are built backend-neutral on the CPU (`SdMapData`, `TextureLoader`) and only
  uploaded with backend-specific calls.
- Selection is `getAvailableRenderers()` in `client/game/GameRenderers.ts` — synchronous, WebGL
  only.

## Architecture

```
Renderer                     frame scheduler (unchanged)
  └─ GameRenderer<T>         game shell: MapManager, input, cache, streaming policy
       ├─ WebGLOsrsRenderer  existing backend, all passes
       └─ WebGPURenderer     new backend (client/render/webgpu/)
```

Rules that keep the port cheap:

1. **CPU-side data is the interface.** `SdMapData` vertex/index bytes, draw ranges, model-info
   textures, heightmaps, watermasks, `TextureLoader` pixels and `draw.ts` actor packing stay
   shared. Only uploads and draw dispatch differ per backend.
2. **One backend at a time owns the canvas.** No mixed contexts. Stages that are not ported yet
   are simply unavailable under WebGPU, not silently broken.
3. **Opt-in first, default last.** `?renderer=webgpu` selects the new backend until Stage 7.
   `PREFER_WEBGPU_DEFAULT` in `GameRenderers.ts` flips the default when parity is reached.
4. **Fallback is serverless and automatic.** If WebGPU is requested (URL or default) but no
   adapter can be obtained, the client logs and uses WebGL.

## Directory layout

```
client/render/webgpu/
  WebGPURenderer.ts        device/context life cycle, frame loop, selection entry
  WebGPUMapSquare.ts       MapSquare implementation: GPU buffers per map + draw
  WorldResources.ts        shared textures (atlas, materials, water), scene + map uniforms
  sceneExtension.ts        plugin hook: extra WGSL slots, group(1) resources and passes
  shaders/
    index.ts               createMainShaderModule(device, { alpha, ext, depth }) — WGSL sources
    main.vert.wgsl.ts      port of shaders/main.vert.glsl + includes
    main.frag.wgsl.ts      port of shaders/main.frag.glsl + includes
```

## Frozen bind group layout (main world pass)

Matches the WebGL `main`/`mainAlpha` programs. Changes here need both a shader and a
`WorldResources.ts` update in the same commit.

| group | binding | resource | format / type |
| --- | --- | --- | --- |
| 0 | 0 | `SceneUniforms` uniform | struct, 264 bytes (see below) |
| 1 | 0 | `u_textures` | `texture_2d_array<f32>`, `rgba8unorm` |
| 1 | 1 | `u_textureMaterials` | `texture_2d<u32>`, `rgba8uint` |
| 1 | 2 | `u_waterTextures` | `texture_2d_array<f32>`, `rgba8unorm` |
| 1 | 3 | `u_heightMap` | `texture_2d_array<i32>`, `r16sint` |
| 1 | 4 | `u_waterMask` | `texture_2d_array<f32>`, `rgba8unorm` |
| 1 | 5 | filtering sampler | `repeat` addressing, `linear` |
| 1 | 6+ | scene extension resources (extended pipelines only) | see `sceneExtension.ts` |
| 2 | 0 | `MapUniforms` uniform, **dynamic offset** | per draw range, 256-byte stride |
| 3 | 0 | `u_modelInfoTexture` | `texture_2d<u32>`, `rgba16uint` |
| 3 | 1 | `u_heightMap` (per map) | `texture_2d_array<i32>`, `r16sint` |
| 3 | 2 | `u_waterMask` (per map) | `texture_2d_array<f32>`, `rgba8unorm` |

Chrome's WebGPU adapter caps `maxBindGroups` at 4, so a scene extension extends group(1) instead
of taking a fifth bind group: its pipelines use an extended group(1) layout, and
`WorldResources.selectExtension` swaps the pipeline pair and the map-draw bind group per frame.

`SceneUniforms` byte layout (std140-compatible; 264 bytes of data, WGSL fixes the struct size at
272 bytes, which is what the buffer and `minBindingSize` use):

| offset | field |
| --- | --- |
| 0 | `u_viewProjMatrix: mat4x4<f32>` |
| 64 | `u_viewMatrix: mat4x4<f32>` |
| 128 | `u_projectionMatrix: mat4x4<f32>` |
| 192 | `u_skyColor: vec4<f32>` |
| 208 | `u_sceneHslOverride: vec4<f32>` |
| 224 | `u_cameraPos: vec2<f32>` |
| 232 | `u_playerPos: vec2<f32>` |
| 240 | `u_renderDistance: f32` |
| 244 | `u_fogDepth: f32` |
| 248 | `u_currentTime: f32` |
| 252 | `u_brightness: f32` |
| 256 | `u_colorBanding: f32` |
| 260 | `u_isNewTextureAnim: f32` |

`MapUniforms` element layout (96 bytes used, 256-byte stride):

| offset | field |
| --- | --- |
| 0 | `u_worldEntityTransform: mat4x4<f32>` |
| 64 | `u_mapPos: vec2<f32>` |
| 72 | `u_timeLoaded: f32` |
| 76 | `u_sceneBorderSize: i32` |
| 80 | `u_worldEntityOpacity: f32` |
| 84 | `u_roofPlaneLimit: f32` |
| 88 | `u_drawId: u32` (the draw-range index, replaces WebGL `u_drawIdOverride`) |
| 92 | `u_isWorldEntity: u32` (`u_worldEntityTransform != identity` in WebGL) |

Vertex layout is identical to WebGL: attribute 0 = `uint32x3` at offset 0, stride 12, integer
(`a_vertex`), indices `uint32`. `instance_index` replaces `gl_InstanceID`. `DrawRange[0]` is a
byte offset into the index buffer; WebGPU `drawIndexed` needs `DrawRange[0] / 4` as its
first-index. Clip space differs (GL z ∈ [-w, w], WebGPU z ∈ [0, w]) so the vertex shader remaps
`z = (z + w) * 0.5` before output.

## Stages

### Stage 0 — backend selection and fallback (done)

- `OsrsRendererType` becomes `"webgl" | "webgpu"`; `createRenderer` constructs either backend.
- `WebGPURenderer.isSupported()` is synchronous (`navigator.gpu`); `pickRendererType()` is async
  and tries `navigator.gpu.requestAdapter()` before preferring WebGPU. Any failure falls back to
  WebGL with a console warning.
- `?renderer=webgl|webgpu` forces a backend (invalid/unsupported values are ignored).
- `OsrsClientApp` uses the async picker instead of `getAvailableRenderers()[0]`.
- Exit: `?renderer=webgpu` on a supported browser constructs `WebGPURenderer`; on Firefox
  (no WebGPU) the same URL silently boots WebGL. Verified by
  `client/tests/webgpu-smoke.browser.cjs` with `SMOKE_RENDERER=webgl`.

### Stage 1 — device, present path, scene uniforms (done)

- `WebGPURenderer.init()`: adapter/device, canvas context configure, depth texture, scene
  uniform buffer + bind group, resize handling.
- `render()`: refresh camera matrices and the scene UBO, clear to the sky colour, submit.
- Map streaming drives `MapManager` so `visibleMaps` fills exactly as WebGL does.
- Exit: empty sky-coloured world at 60fps in the game, no validation errors.

### Stage 2 — main game world pass (done)

Scope is the pass `renderOpaquePass` + `renderTransparentPass` covers for terrain and locs:

- `WorldResources`: built from `initCache` (the texture loader only exists after phased
  loading, the same reason WebGL re-runs `initTextures` there). Uploads the world texture atlas
  (`createTextureArray` equivalent: 64-layer preload plus per-map `uploadMapTextures` streaming),
  material lookup texture, water atlas; scene + map uniform buffers.
- `WebGPUMapSquare`: vertex/index buffers, model-info textures, heightmap and watermask arrays,
  bind groups, per-range draws for terrain, doors and locs.
- WGSL port of `main.vert.glsl` / `main.frag.glsl` and their includes (vertex unpack, HSL,
  fog, material, height map, water).
- Transparent pass = alpha ranges with src-alpha blending; roof culling skips ranges whose plane
  exceeds `u_roofPlaneLimit` (replaces the scissor trick).
- Not in this stage: LOD/interact range variants beyond opaque/alpha, texture mipmap
  regeneration, loc/door/ground-item geometry refreshes, actors, world entities, overlays,
  login UI.
- Exit met: terrain, doors and locs render textured, fogged and camera-followed in-world under
  `?renderer=webgpu` at ~60fps, validation-clean.

### Stage 3 — actors (done)

- `client/render/webgpu/actors/`: actor data texture (RGBA16UI, 2 texels/actor), per-map NPC
  geometry, NPC/player/GFX pipelines and WGSL (`shaders/actor.wgsl.ts`; projectiles draw
  through the GFX pipeline), plus player posing (`actorPlayers.ts`). Keyframe poses that only
  move whole labels are posed on the GPU, as in WebGL's `PlayerRenderer`: one rest mesh per
  appearance with a label per vertex, plus one row of 3x4 label matrices per distinct pose this
  frame (`u_poseTexture`, group(3) binding 1; `u_poseRow` per draw). Skeletal, alpha/colour and
  re-centred poses fall back to the CPU mesh path. This keeps animation smoothing (a new pose
  every client cycle) from rebuilding a mesh per player per frame.
- Reuses `DynamicNpcAnimLoader`, `GfxCache`/`GfxManager`, `ProjectileManager`, `SceneBuffer`
  and the packing logic of `render/render/draw.ts` (ported).
- NPCs use per-frame dynamic geometry; GFX and projectiles share one GPU geometry cache.
- Not in this stage: static per-map NPC frame baking (WebGPU map streaming loads with
  `loadNpcs: false`), instances/world entities, first-person arms, actor frame sounds.
- Exit met: players, NPCs, GFX and projectiles visible at correct scale and positions under
  `?renderer=webgpu`, validation-clean. Note: vertex stride differs per pipeline (16 bytes for
  NPC/player, 12 for GFX/projectile) — keep this in mind when adding actor geometry.

### Stage 4 — in-world overlays (done)

- `client/render/webgpu/overlays/`: shared screen-quad layer, ground item labels + meshes,
  hitsplats, health bars, overhead text/prayer, click cross, tile text, tile marker, interact
  highlight (NPC targets).
- Entry population ported from the WebGL frame loop (`render.ts:866-1427`); the renderer's
  `registerHitsplat` and the health-bar update methods feed it.
- Known gaps: tile-text hover stays dormant (no WebGPU hover pick path yet), interact
  highlight lacks loc targets (needs loc metadata on `WebGPUMapSquare`), collision-flag
  adapter returns 0.

### Stage 5 — frame presentation and UI (done, FXAA skipped)

- `client/render/webgpu/ui/`: hosts and drives the existing widget stack (its own WebGL2 + 2D
  canvases, DOM-composited) via `client/widgets/gl/widgetsOverlayFactory.ts`, which is also used
  by the WebGL init path (behaviour unchanged).
- Login/loading/system-update render as DOM canvas layers; login input is routed to the same
  `osrsClient` handlers; the welcome screen blacks out the world as WebGL does.
- `flushPackets` lives in `WebGPURenderer.render` (same point as the WebGL loop).
- Not in this stage: the offscreen scene texture + present blit + FXAA (still optional); the
  widget GL context is still WebGL2 (one extra context, by design).

### Stage 5.5 — plugin scene extensions, 117 HD (done)

- Plugins extend the WebGPU scene through one hook, `ClientPlugin.createWebGPUSceneExtension`
  (`client/render/webgpu/sceneExtension.ts`), the counterpart of the WebGL
  `transformSceneProgram` / `beforeSceneRender` / `configureSceneDrawCall` hooks. An extension
  fills fixed WGSL slots in the world and actor shaders (declarations, varyings, end of the
  vertex entry, texture sample, palette, shade, floor water), appends resources to group(1) from
  binding 6, and is used on frames where `isActive()` is true: the core compiles an extended
  twin of every world and actor pipeline and `WorldResources.selectExtension` picks per frame.
- With a `depth` shader the core also builds depth pipelines: the same placement as the scene
  entries, then the extension's `sceneDepthPosition(viewPos)` and `fs_depth`.
  `beforeScene(renderer, encoder)` records the extension's own pass and fills it with
  `renderer.drawSceneDepth(pass)` (world opaque, world alpha, actors).
- Only one extension is supported (the first offered); composing several needs per-extension
  binding/location ranges.
- 117 HD is the only extension: `client/game/plugins/hd/webgpu/` holds the WGSL
  (`hd-lighting.wgsl.ts`, port of `hd-lighting.glsl`; `hdSceneShaders.ts`, port of
  `HdShader.ts`'s injections) and `HdWebGPU.ts` (HdUniforms, material lookup, HD texture array,
  2048px shadow map, lights via `collectHdLights`, environment via
  `resolveHdEnvironmentForRegion`). The shadow map is read with v = 1 - y: WebGPU texture rows
  start at NDC y = +1, so a GL-style lookup mirrors every shadow.
- Weather (the other plugin with WebGL render hooks) is not ported.

### Stage 5.6 — world entity decks (boats) (done)

- `client/render/webgpu/worldEntity.ts` is the port of `render/render/worldEntity.ts`:
  REBUILD_WORLDENTITY builds the deck as an instance-style square under a reserved map id
  (200 + entityIndex) and registers it with MapManager as a world-entity map (never pruned,
  always visible, excluded from world-tile lookups).
- The shared `WorldEntityAnimator` places each deck: `render/render/worldEntityMotion.ts` is
  called each frame and composed with the camera view matrix.
- `WebGPUMapSquare.setWorldEntityTransform` writes that matrix and `u_isWorldEntity` into every
  MapUniforms entry, so the deck draws at the boat as WebGL does.
- The actor uniforms take the same matrix and the world-entity fog bypass; deck players and NPCs
  are packed from the ECS `worldViewId` (`WebGPUActors.packDeckActors`).
- `updateFollowCamera` projects the controlled player's deck coordinates to the boat
  (`projectDeckToWorld`), and `OverlayHost` exposes the animator so deck overhead text, the
  click cross and terrain picks (`getWorldEntityAdjustedTerrainRay`) anchor at the drawn deck.
- Not ported: deck hitsplats/health bars (WebGL does not project those either).

### Stage 6 — streaming and polish

Loc/door/ground-item geometry refreshes, instances, map square GC, quality
profiles (MSAA, resolution scale), profiler/GPU timing, `DrawBackend` equivalent (multi-draw
via indirect or instanced, only if measured), FXAA/blit if wanted. Exit: parity checklist for
streaming parity with WebGL.

### Stage 7 — default flip

`PREFER_WEBGPU_DEFAULT = true`; keep `?renderer=webgl` as an escape hatch. Exit: a release
with WebGPU default on Chrome/Edge/Safari 26+ and WebGL elsewhere.

## Verification

- `yarn --cwd client test` (assert tests) and `tsc --noEmit` for the client.
- `client/tests/webgpu-smoke.browser.cjs`: launches headless Chrome (muted,
  `--enable-unsafe-webgpu`), boots the dev client at the worktree port, fails on any console
  error or `[webgpu]`/validation error, and captures a screenshot (`SMOKE_SCREENSHOT` names it).
  - Renderer + frames: `node client/tests/webgpu-smoke.browser.cjs`
  - World (terrain/doors/locs/actors): `CLIENT_URL='http://localhost:3101/?username=<name>&password=<pass>' SMOKE_EXPECT_WORLD=1 node client/tests/webgpu-smoke.browser.cjs`
  - Fallback: `SMOKE_RENDERER=webgl ...` asserts the WebGL backend still comes up.
  - 117 HD on: add `SMOKE_ENABLE_HD=1 SMOKE_EXPECT_HD=1` (enables `osrsClient.hdPlugin` at
    runtime); combine with `SMOKE_RENDERER=webgl` for the WebGL reference.
  - Add `&mobile=1` to skip the click-gated welcome screen and go straight to the world.
- Manual: `scripts/wt ls`, `yarn start`, open
  `http://localhost:<client port>/?renderer=webgpu` — the login screen works, accounts are
  created on first login.

## Open questions

- Safari 26 WebGPU is available; MSAA resolve and `depth24plus-stencil8` availability differ.
  Stage 6 decides per-profile constraints.
- Multi-draw: WebGPU has no `WEBGL_multi_draw`; draw-range looping is fine until profiling says
  otherwise. Browser `drawIndirect` + compute compaction only if needed.
- Shader sources: `ts-shader-loader` only handles `.glsl`. WGSL lives in `.ts` template literals
  to avoid touching the CRA/craco build.
