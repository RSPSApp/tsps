# 117 HD

Opt in through **xRSPS → 117 HD**. Disabled on fresh installs; explicit choices
persist in browser storage. No renderer restart is needed.

Lamp glass and torch flames use emissive source faces while their frames retain normal
lighting. Source glow and nearby light spill are 25% dimmer than the initial preview.
WebGPU bloom picks up the bright source faces; WebGL keeps the same glowing cores
and warm light spill. `SMOKE_HD_LIGHTS=1` checks live lantern uniforms and screenshots.
Set the test account to `3092 3502 0` via the worktree's MCP to view Edgeville's lamps.

The plugin adapts 117 HD lighting, regional environments, fog, material parameters,
textures, normal maps, animated object lights and directional shadows to PicoGL.
Current materials/assets come from `117HD/RLHD` at
`38d4082ca5a7ed77324484ce287659a4eb7758c2`. The environment/light data retains the
existing `elvarg-web-client` port.

The local preview replaces 11 material families with CC0 Poly Haven photographs:
grass, earth, sand, gravel, castle/red brick, weathered wood, thatch, slate,
clay tiles and cobbles. See `textures/local/sources.json` for source URLs and
output hashes, and `textures/local/LICENSE.txt` for licence information.
Colour maps use compact WebP; normal maps use lossless WebP. Grass, castle brick
and thatch colour maps use a small separate 512px array; the remaining 43 images
stay at 256px. Together the arrays occupy about 20 MiB with mipmaps, compared
with 17 MiB for the original pack. No additional draw calls or shader texture
samples are added. Grass keeps its existing terrain normal. Ground albedo removes
broad photographic blotches while preserving fine contrast and the cache's hues.
Natural ground uses a small, continuous UV warp to break exact one-tile repeats;
it stays fixed in world space as the camera/player moves. Paved patterns retain
straight courses. Masonry uses world-aligned UVs instead of resetting or stretching
the photograph on each cache model face. Other model materials retain cache UVs.

Ground recipes cover grass, dirt, sand, gravel, rock, snow, wood, carpets, brick,
marble, tiles and paving. Untextured terrain carries the recipe in its unused U
coordinate; its original colour, geometry and face priorities are preserved.
Terrain normals interpolate neighbouring height-map normals. Player and NPC
normals blend across shared body vertices and are rebuilt from each animated
pose. Rest-pose vertex groups and normal storage are reused; opaque and alpha
geometry share one normal calculation per pose. Actor vertices carry normals and
their original unshaded colours in an extra four bytes; the HD toggle replaces
baked shading with smooth lighting.
The local player reuses the existing pose cache across shadow and scene passes.
Architecture uses geometric normals, with detail from material normal maps.
Both texture arrays use trilinear mipmaps and up to 8x anisotropic filtering.
Dry grass, soil, sand, gravel and roofs are matte, including the wood-grain
material used by wooden roofs. Rough planks and masonry use subtle highlights.
Reflections use upstream's Phong gloss and the sun's colour
and intensity. HD model textures replace baked directional shading with neutral
brightness, avoiding double shading on brick walls.

Floor water (normal maps, foam, caustics, seabed and shorelines) is 117 HD's
and follows this toggle; with HD off, water uses the vanilla cache texture. HD replacements use a separate texture
array, leaving the original textures available immediately on disable.

Point lights cover the nearest 16 on the active plane. The 2048px shadow map uses
3x3 filtering and a texel-snapped projection. World depth updates at 15 Hz, with immediate
refreshes on teleports, plane changes, environment changes and roof/draw-distance
changes. Missing/loading replacement images retain the cache texture, and layer
zero remains the shared white fallback. Each frame copies cached world depth and
adds current actor shadows, so moving bodies cannot receive shadows from their
previous positions or poses. Smooth normals use triangle facing rather than a
camera-facing flip, keeping silhouette lighting continuous. Shadow bias uses the
geometric face normal. Opaque shadow draws skip material sampling
and normal calculations; cutout shadows retain texture alpha. Point-light searches
refresh at 30 Hz, or immediately after moving a tile or changing planes. Integer terrain corners
fetch only their own height-map normal instead of all four neighbouring normals.
Fragments outside a point light's radius skip its lighting calculation, and matte
materials skip specular calculations.

Compatibility limits: architecture normals remain geometric; area-specific terrain
recolouring, height fixes, seasonal themes and displacement maps are not ported.
Default floor recipes retain the cache's blended colours.

HD scenery distance supports up to 160 tiles through **Debug → Distance → View**.
Static map loading expands to cover that view without widening the server's
simulation window. Static scenery is grouped into 8×8-tile chunks, with cached
bounds and separate full/far geometry selected per chunk. Visible ranges retain
multi-draw batching; single-draw devices coalesce contiguous terrain ranges.
The HD full-detail radius is capped at 48 tiles. Material normal maps, local
lights and detailed shadows fade between 24 and 48 tiles; distant surfaces use
albedo, geometric/terrain normals and ambient/sun lighting.
Automatic HD fog scales with the configured distance: a 25-tile view keeps
scenery clear until 19.5 tiles and fades to the clear colour at 24.75 tiles;
a 160-tile view uses a wider, stronger 24–120-tile fade. Intermediate distances
blend continuously between these settings. The smooth ramp reduces distant
texture detail gradually. Fully obscured chunks are culled on
the CPU, and remaining fully fogged fragments skip texture/material work.
Ready HD albedo replacements also skip the redundant cache-texture sample.
Manual fog-start settings still apply.
Roof pieces include reverse-facing indices that reuse their original vertices
and UVs, so looking up through the eaves sees the roof underside instead of
sky. This also applies with HD disabled and to far/animated roof geometry.

Map workers build simplified distant terrain and merge the remaining static
scenery once per load or loc rebuild. Smooth untextured 2×2 floor patches use a
coarser mesh with exact edges against detailed patches and neighbouring chunks.
Water, bridges, material transitions, ground beneath scenery and abrupt height
changes retain their original triangles. Only closed props without ground contouring
cluster interior vertices in quarter-tile cells and discard collapsed faces;
open meshes, floor meshes, ground-conforming meshes (including baked ModelData
contours) and outer planes retain their exact geometry
so adjoining ditch, wall and roof pieces stay joined. Distant batches omit the
existing low-detail decoration/interior categories. Nearby models are never
mutated. Ground items remain in the full-detail tier. Larger distances require
more loaded maps and extra cached mesh memory; actual FPS gains depend on the scene.

Shadow passes cull against the light's frustum rather than the camera or scenery
radius. They include loaded off-screen casters and retain full geometry. The
shadow projection remains capped at 48 tiles, with cached world depth and current
actor poses as before.

WebGPU's **117 HD** settings also include three independent switches, on by default:
**Texture filtering** enables mipmaps, 8× anisotropic filtering and the 512px detail assets;
turning it off restores 256px bilinear sampling. **Anti-aliasing** applies FXAA
after tone mapping and before the HUD, with a shorter search span and half-strength blend
to retain texture contrast. **Depth-aware AO** filters and upsamples
half-resolution ambient occlusion using scene depth to preserve object edges; turning it off
restores the original half-resolution box blur. It requires **Ambient occlusion** to be on.
These switches apply immediately and persist with the other plugin settings.

WebGPU also uses the same 8-tile chunk bounds, fog/camera culling, full/far scenery meshes,
terrain draw coalescing and distant-lighting fade as WebGL. Full and far draws share the
baked vertex/index buffers; animated objects update both tiers. Shadows cull full-detail
loaded scenery against the light frustum, including off-screen casters. World depth refreshes
at 15 Hz (or immediately after moving two tiles, changing plane/environment/distance/roofs),
then copies to a target with current actor shadows each frame. Unchanged actor data skips
the texture upload. Boat decks retain full geometry in their moving coordinate space.

Run `yarn test:hd` in `client`. To generate the optional WebGL browser check:
`yarn test:hd /tmp/elvarg-hd-shader-check.html`.
The focused distance/mesh checks can be run with
`node --import tsx tests/scenery-distance.test.ts` in `client`.

The existing browser smoke test also checks these WebGPU paths, including GPU pixel fixtures,
live toggle changes, camera motion and resize:
`CLIENT_URL='http://localhost:<worktree-port>/?username=<name>&password=<pass>&mobile=1' SMOKE_ENABLE_HD=1 SMOKE_EXPECT_HD=1 SMOKE_EXPECT_WORLD=1 SMOKE_HD_QUALITY=1 node client/tests/webgpu-smoke.browser.cjs`.
Screenshots are saved in `client/tests/artifacts/`.
Add `SMOKE_HD_OPTIMISATIONS=1` on a desktop URL (omit `mobile=1`) to check default-detail
scenery draw savings at 25/90/160 tiles and shadow-cache refreshes. Mobile profiles keep
their existing distance caps.

117HD-derived data/assets use the license at
`textures/LICENSE-117HD.txt`; texture credits are in `textures/000_licenses.txt`.
To refresh materials from a local upstream checkout:
`python3 client/scripts/hd/import-materials.py /path/to/RLHD` from the repo root.
The local overrides survive that refresh. To recreate their images, run
`python3 client/scripts/hd/import-local-materials.py /tmp/hd-material-sources`
with Pillow and NumPy installed, then rerun the upstream importer. Missing 1K
source maps are fetched from Poly Haven; originals remain outside the game bundle.
