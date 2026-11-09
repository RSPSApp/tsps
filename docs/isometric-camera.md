# Isometric Camera plugin

A client plugin hub entry that drives the follow camera the way isometric action RPGs frame
the world. The camera looks down at a fixed, steep angle on a diagonal of the tile grid,
through a true orthographic projection. It turns only in quarter turns and trails the player
softly. It's off by default. The game's scroll-wheel and pinch zoom set how much of the world
is on screen.

| Setting | Range | Default |
| --- | --- | --- |
| Angle | 25–80° | 35° (true isometric; action RPGs sit nearer 50°) |
| Quarter turns | on / off | on |

## How it works

`client/game/plugins/isometric/`. The plugin uses existing camera hooks from
`ClientPluginManager` and adds one new hook.

- **`handleCameraFollow`** places the camera each frame. It sits on the chosen yaw at the
  configured angle, 20 tiles from a point at the player's chest. That point trails the player
  slightly (it catches up at 16 per second), and a jump of more than 6 tiles (a teleport) snaps
  instead of gliding. It switches the camera to orthographic and sets `Camera.orthoZoom` from
  the game's zoom: the framing the classic camera would have at 20 tiles.
- **`transformCameraRotation`** clears the free yaw and pitch from the arrow keys,
  middle-mouse drag and the Camera plugin's easing. It runs every frame, even when the follow
  camera doesn't, so it is also where the camera is handed back (see below).
- **`roofCameraTile`** (new; WebGL `render/camera/roof.ts` and WebGPU
  `webgpu/frameConfig.ts`) changes the tile that roof hiding treats as the camera's. The game
  hides the planes above the player when the line from the camera's tile to the player's
  crosses a roof. This camera is about 16 tiles out and circles the player during a turn, so
  that long line swept across buildings and upper floors flickered. The plugin returns a
  short line pointing at the yaw the camera is settling on. It reaches as far as a one-storey
  roof could still hide the player at this angle (2–8 tiles). Roofs then change at most once
  per turn, and while walking they change only near buildings, as with the classic camera.

## Turning

Each input below turns the view 90°. Turning **Quarter turns** off locks the camera to one
diagonal.

| Input | Turn |
| --- | --- |
| Left / Right arrow | one quarter turn per press |
| Middle-mouse drag, or one finger dragged on a touch screen | one quarter turn for each ~180 px of sideways drag |
| Controller bumpers (LB / RB) | one quarter turn per press |
| Controller right stick, flicked sideways | one quarter turn per flick; it re-arms once the stick is back near the centre |

Controller play belongs to First Person (any other button or the left stick switches it on).
The plugin claims a controller frame only when nothing but the bumpers and the right stick is
in use. Its `handleGamepad` runs before First Person's because the plugin is listed first in
`CORE_PLUGINS`.

## Handing the camera back

| Situation | What the camera does |
| --- | --- |
| A server camera shot (`cam_moveto`, `cam_lookat`, arcs, …) until `cam_reset` | Classic perspective, at the engine's default field of view. A zoom the shot's script sets (signposts set one in the same tick) is kept. The wheel, arrow keys and mouse look can't change the shot. The player's own zoom comes back after `cam_reset`. `Camera` gains `isScripted()` and raw `get/setViewportFovScale()` for this; the latter avoid the rounding of script units. |
| First Person (Backquote, or controller play) | First Person's camera. The isometric camera resumes when it's left. |
| Edit mode (map editor) | Not affected: the editor loads no client plugins. |
| Logged out, hopping | The login screen gets the classic camera back. |
| Plugin turned off | Classic camera. Only what the plugin set (its pitch) is undone, so another mode's own value stays. |

## Orthographic picking

`render/render/interact/menu2.ts`: the orthographic near plane sits thousands of tiles behind
the camera. Click rays started there, outside the scene raycaster's reach (draw distance + 32),
so no loc or NPC was ever hit and only "Walk here" worked. `screenToRay` now moves an
orthographic ray's origin along the ray to the camera's depth, which is where perspective rays
start.

## Draw distance

Zooming out eases into the point where the screen's corners would reach past the draw
distance, less 3 tiles for the fog. The fog's square edge and unbuilt map squares therefore
never come into view. The draw distance is the GPU plugin's (or Low-end Device's) setting when
one is on, otherwise the game's render distance. Low-end Device mode (the default on phones)
draws only 12 tiles out, so the view there stays closer.

The scale is the game's framing and that limit added in quadrature,
`√(framed² + limit²)`, rather than the larger of the two. Every wheel or pinch step still
changes the view: with a hard stop, the zoomed-out half of the zoom range did nothing on phones
and on large windows. Zoomed right in, the limit makes almost no difference.

## Other features

Checked in game with the plugin on:

| Feature | Result |
| --- | --- |
| Clicking NPCs, locs, ground items, walking; right-click menus and hover text | Work (after the picking fix above). |
| Hitsplats, health bars, overhead text, head icons, ground item labels, tile/NPC/object highlights | Project through the camera's matrices, so they sit on their targets. Sizes are fixed in pixels, as with the classic camera. |
| Quest Helper | The step icon and NPC outline sit on the target. The icon keeps its pixel size, so it looks a little larger against the zoomed-out world. |
| Minimap and compass | Follow the yaw through every turn. |
| Fog, scenery LOD, map streaming | Centred on the player, not the camera, so a distant camera changes nothing. |
| Interface 3D models (welcome screen, chatheads, equipment) | Drawn by their own rasterizer, unaffected. |
| Sailing | The camera follows the player on deck; sails and helm can be clicked. |
| Resizable and mobile layouts | Fill the viewport; mobile stays inside Low-end Device's 12-tile draw distance. |

## Known limitations

- **117 HD shadows in wide views:** shadows and detail normals fade from 24 to 48 tiles from
  the player, and the shadow map follows the player. A wide orthographic view at a high
  resolution shows the fade and some shadow flicker at its edge. This is an existing 117 HD
  issue (the stock camera shows it too when zoomed far out).
- **LOD and shadow pop when zoomed far out with a long GPU draw distance:** past the full-detail
  radius (draw distance − 2 tiles, at most 48 with 117 HD), whole 8×8 chunks switch to
  simplified models that 117 HD leaves out of its shadow map. With a long draw distance, the
  orthographic view can reach that radius, and walls and shadows pop as chunks cross it.
- **117 HD ambient occlusion:** HD's SSAO sizes its radius for a perspective projection, so in
  orthographic it shrinks to almost nothing. The fix belongs in 117 HD's shader.
- **cam_skybox:** a script's skybox model is drawn around the camera. In orthographic it
  would not fill the background as it does in the classic camera. Shots that use it hand back
  to the classic camera anyway, but a skybox left on after `cam_reset` would show this.

## Tests

- `client/tests/isometric-camera-plugin.test.ts`: the defaults; driving in orthographic with
  free rotation cleared; quarter turns from the arrow keys, drags and the controller; handing
  back to cutscenes, scripted shots (locked view, a script's own zoom, the player's zoom
  restored), edit mode, logout and plugin shutdown; the zoom-out limit, including Low-end
  Device's draw distance.
- Captures: the vision harness (`client/tests/vision-capture.browser.cjs`) takes
  `--plugin "Isometric Camera"` (or `"117 HD,Isometric Camera"`) and
  `--plugin-config '{"pitch":50}'`.
