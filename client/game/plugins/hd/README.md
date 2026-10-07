# 117 HD

Opt in through **xRSPS → 117 HD**. Disabled on fresh installs; explicit choices
persist in browser storage. No renderer restart is needed.

The plugin adapts 117 HD lighting, regional environments, fog, material parameters,
textures, normal maps, animated object lights and directional shadows to PicoGL.
Current materials/assets come from `117HD/RLHD` at
`38d4082ca5a7ed77324484ce287659a4eb7758c2`. The environment/light data retains the
existing `elvarg-web-client` port.

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
The 256px texture array uses trilinear mipmaps and up to 8x anisotropic filtering.
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

Run `yarn test:hd` in `client`. To generate the optional WebGL browser check:
`yarn test:hd /tmp/elvarg-hd-shader-check.html`.

117HD-derived data/assets use the license at
`textures/LICENSE-117HD.txt`; texture credits are in `textures/000_licenses.txt`.
To refresh materials from a local upstream checkout:
`python3 client/scripts/hd/import-materials.py /path/to/RLHD` from the repo root.
