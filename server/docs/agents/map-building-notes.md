# Map building notes

Field notes for building with the map-editing tools ([map-editing.md](map-editing.md) is the
tool reference). The tools can report a build as perfect — every object placed, every height
set — while it looks wrong in game. These notes are what earlier builds learned about the
difference, so the next one starts from what works.

**Keep this file growing.** When a build teaches you something — an object that renders badly,
one that works, a terrain trick, a tool quirk — add it to the right section below, with the ids
and how you checked it (screenshot, in-game, cache dump). Correct an entry that turns out wrong;
say what changed rather than deleting it quietly. Short rows beat paragraphs.

## Workflow that works

For a village or town: clear the sites and road strips of loose scenery first, paint the roads,
build the houses (doors to the road) and fields, then decorate and add people last.

1. **Find a site.** `observe` lists only named objects; unnamed walls, fences and ground
   decoration are invisible to it. Count what is really there with a dry run:
   `clear_area { x1, y1, x2, y2, includeCache: true, dryRun: true }`.
2. **Check the region budget** before planning terrain: paint one tile, read `terrainBytes`,
   then `clear_terrain` it (the region drops back to the cache and its file is deleted).
3. **Build a test piece and screenshot it** before building at scale: a 4×4 box of each wall
   candidate, a few floor patches. `vision_screenshot` is the only check of the look; `observe`
   and `describe_tile` only confirm the data.
4. **Build from data you generated**, not hand-typed tiles: compute the placements in a script
   and send them in one `place_objects` call; paint terrain in row runs.
5. **Screenshot the result from several sides**, then fix and repeat.
6. Clean up test pieces with the default `clear_area` (spawn-file placements only) and
   `clear_terrain`.
7. **Add what you learned to this file** before you report the build done: new ids that render
   well or badly, tool quirks, a site's budget. Skipping this is how the next agent repeats
   your mistakes.

## Screenshots (`vision_screenshot`)

| Quirk | What to do |
| --- | --- |
| It logs the player in through a headless client with password `vision1234` (or `VISION_BOT_PASSWORD`) | Use a dedicated camera account created with that password |
| The player must be logged out first; `logout` is refused for 16 ticks after combat | Teleport, then `logout` on the same tick, before anything aggressive engages |
| After a capture the session lingers for a while | Poll `list_players` and retry `logout` before the next capture |
| Zoom is fixed and close: about 10 tiles of view | Stand within ~10 tiles of what you want to see; take several shots |
| Yaw: 0 faces north, 512 east, 1024 south, 1536 west. Pitch 512 is straight down | Pitch 250–330 shows walls and depth; 450+ for layout |
| Desert heat and aggressive NPCs (jackals) keep a camera in combat | Pick camera tiles away from them |
| **Upper storeys and roofs vanish in low shots** | The game's roof removal (`client/game/roof/RoofVisibility.ts`): with the camera pitch under 310, if the camera's tile or the line from camera to player crosses any tile flagged indoors (flag 4), every plane above the player's is hidden, screen-wide. Keep buildings with indoor floors out of that line, or judge upper floors from a high camera |
| Tall buildings do not fit | The fixed zoom cannot take in a two-storey house and its roof from any angle; check roofs on one-storey builds or from above |

## Loc sizes

| Loc | Shape | Width × depth × height (top) | Notes |
| --- | --- | --- | --- |
| 44884 Emir's low wall | 0 | 36 × 128 × 96 | A third of a house wall |
| 3152 Emir's tall wall | 0 | 32 × 128 × 240 | |
| 23818 Varrock house wall | 0 | 28 × 128 × 293 | |
| 24175 Falador white | 0 | 31 × 128 × 293 | Same height as Varrock's house wall |
| 23780 Varrock city wall | 0 | 28 × 128 × 302 | |
| 16519 "Castle wall" | 10 | 129 × 129 × 381 (top 288) | A full-tile block taller than any wall piece: the slabs of the first Colosseum |
| 4501 (varrock-house window guess) | 4 | 52 × 26 × 48, top 184 | A small piece mounted high: the wall lamp the screenshot showed |
| 15552 slate roof | 12-21 | slopes 128 × 128 × 96 | Flat tops (17) have no height |

| Finding | Detail |
| --- | --- |
| Size does not catch a wrong piece of the right size | `capture_style` picked corner 4657 for the Varrock city wall from a nearby building; it is wall-sized, so no size warning. The screenshot caught it |
| Many stand-ins share a size | 166 locs are within 16 units of the Varrock house wall in shape 0: `find_similar_locs` gives a shortlist, the screenshot picks |

## Generators

| Finding | Detail |
| --- | --- |
| Varrock's hip roof | One roof loc for every shape (15552, slate). Ring of eaves (18 edges, 19 corners), then a ring of slopes per plane (12, corners 16), flat tops (17) where one tile is left across or the planes run out. Every piece faces outward: south 1, east 0, north 3, west 2; corners SW 1, SE 0, NE 3, NW 2. `hipRoof` reproduces varrock-house-a's roof tile for tile |
| Floors and flags in a house | Indoor tiles: floor overlay 81 and flag 4 on every storey (the roof hides when you are under it); flag 16 on the roof plane over the whole footprint |
| Top-down screenshots show a hole in the middle of a roof | Real houses too (pasted varrock-house-a): the camera, not the build. Judge roofs from an angle |
| A generated door opens | Varrock's door 11773 placed by `build_house` opens to 11774 and the player walks in |
| Varrock windows | 4501 is a small wall lamp. Seeded Varrock houses use 23826, the actual shape-0 window wall in the same footprint. |
| Graveyard path overlay 1 in the desert | Renders light grey, not brown dirt |
| Overlay 343 (Pollnivneach's street) | Renders as light sand in the desert: a good desert street. Al Kharid's 26 reads green-grey |
| **`includeCache` clears your own placements too** | It razes everything in the rectangle. Clearing desert rubble off a road after decorating took the well, benches, crates, a signpost and a palm with it. Clear roads and sites first, then decorate |
| Desert scenery under a village | Rubble, sand ripples and two rockslide boulders sat on the planned roads. Clear road strips and building sites (`includeCache`), then paint |
| A small village (slot 70, around 3424, 2976) | Two crossing roads and a paved square (well, market stalls, benches, crates), seven generated houses (three two-storey) with doors to the road, a pasted Varrock house, the market tent, a fenced wheat farm, a cow pen, a graveyard, palms, villagers. About 1,000 bytes of terrain per house; the region went from 42.8 KB to under 49 KB |
| Checked by screenshot | Two Varrock-style houses (1 and 2 storeys), a fenced graveyard, a fenced wheat farm |
| **Ladders are used from one side** | A ladder's access mask (11794: 30) leaves one side open, north at rotation 0, turning clockwise per rotation (east 1, south 2, west 3); the route finder calls it unreachable from any other side (`[object-route] unreachable` in the server log). Varrock's ladder uses 3 because its room reaches it from the west. A ladder's rotation must point its open side at the walkway |
| **Climbing needs no code** | `ClimbLinks` finds a ladder's other end in `MapObjects` (an opposite climb option a plane up or down, within 4 tiles), and placed objects are there too: a Climb-up ladder below and a Climb-down ladder on the same tile above climb both ways |
| Furniture faces | Against the south wall rotation 2, west 3, north 1, east 0 (Varrock's house). A 1x2 bed or range turns its footprint with it, so against the west wall a bed lies across the room, head to the wall, as the game's do |
| Levelling a house next to another | Each house's blend rings re-sloped its neighbour's edge, so the neighbour's walls tilted again. The blend now skips tiles on or next to an indoor floor (flag 4) |
| Walls on uneven ground | Each wall piece stands on the heights of its two end corners, so the same house on ground varying by ~14 has walls stepping up and down and a bent eave line; levelled first, its walls run straight (screenshots side by side at 3424-3439, 2946). A tile's height is its south-west corner: levelling must include one row north and one column east of the footprint |
| **Upper-plane heights are gaps** | On planes 1-3 a stored height is the gap above the plane below, in eighths of a unit (`SceneBuilder.ts`); unset, the client uses 240. Varrock's house stores 37 per storey (its walls are 293 tall) and 12 per roof ring above (a slope rises 96). With the default 240 a one-storey house's walls stuck up through its eaves and each roof ring floated ~100 above the last: the roof looked unattached. `build_house` sets both from the wall's and roof's sizes (`loc-sizes.json`); `paste_template` now always copies them |
| **Wall corners** | Walls that sit outside the room meet only at a point at each corner. Varrock's houses fill it with a small corner piece: shape 1, the wall's own loc, on the tile diagonally outside, rotated to the corner (0 NW, 1 NE, 2 SE, 3 SW of its tile). `wallPath` adds them on outside corners; without them each corner was an open slit |
| Tiles with no stored height | Common in the desert. Levelling sets them inside the footprint and leaves them alone in the blend ring, where the client keeps generating their height |

## Styles

| Style | Source | Notes |
| --- | --- | --- |
| `falador-white` | Falador castle | Wall 24175 for every role; door 24058, gate 53281. Fort with towers checked by screenshot |
| `varrock-city-wall` | Varrock's south wall | Wall 23780, crenellated; corner overridden to 23780 (the capture picked 4657 from a nearby house). Faces one side only |
| `varrock-house` | Varrock house at 3218,3383 | Wall 23818, door 11773, roof 15552; floor overridden to 81 (the margin took in the street's 173); window guess 4501 is a wall lamp |
| `lumbridge-castle` | Lumbridge castle | Wall 1911, door 1535 |
| `emir-sandstone` | Emir's Arena | Wall overridden to 44884 (low wall); the most common piece there is the wooden fence 3125 |
| `lumbridge-fence` | Lumbridge cow field | Fence 980 with gate 1558; a pen with a gate checked by screenshot |
| `lumbridge-cottage`, `draynor-cottage` | Lumbridge inn at 3227,3229 and Ned's cottage at 3095,3254 | The eaves and slopes use different loc IDs. The inn uses 1790 and 1924, Ned's cottage uses 1791 and 1643. |
| `falador-house`, `seers-timber`, `canifis-timber` | East Falador at 3024,3350, Seers' anvil block at 2702,3485 and Canifis inn at 3472,3489 | Shape-0 window locs 24189, 25899 and 24376. Canifis needs 24379 for its shape-1 corners. |
| `al-kharid-sandstone` | Northwest Al Kharid at 3268,3177 | Sandstone wall 1415, classic roof 1925 and eaves 1791. |
| `warriors-stone`, `cooks-stone`, `crafting-stone` | Warriors' Guild at 2837,3536, Cooks' Guild at 3137,3442 and Crafting Guild at 2927,3273 | Main walls 23949, 2554 and 1904. Furnishing sets draw from armour, ranges, potter's wheels and related locs in those map squares. |
| `barbarian-timber`, `edgeville-ruins`, `draynor-manor` | Barbarian Village at 3071,3425, Edgeville ruins at 3078,3467 and Draynor Manor at 3094,3358 | Timber 11558 has no shape 1. Ruin masonry variants 1624–1626 were all placed in the native Edgeville map. Manor wall 11512 uses the same slate roof family as Ned's cottage. |

A capture guesses roles from what is most common in the rectangle, so a rectangle that takes
in a neighbour's building can pick that building's piece; check the result and override with
`roles`.

## Templates

| Finding | Detail |
| --- | --- |
| Most mainland houses are two storeys | Locs on planes 0-1 (rooms), roofs on planes 2-3; capture all four planes |
| A building can lean on another structure | Varrock house at 3229,3381 uses the city wall as its south wall: a tight capture left a black gap, a margin pulled in a stretch of crenellated city wall |
| `find_buildings` finds by roof | Tents and stalls with roof pieces count too: 3200,3421 is Varrock's striped tent, not a house |
| Furniture is mostly interactive | A default paste is an empty shell; `interactive: "keep"` brings chairs, beds and ladders; untested whether copied ladders and doors work, since handlers can be tied to the original tiles |
| Catalog (`client/game/plugins/editmode/generation/templates/`) | `varrock-house-a` (8×7), `varrock-house-west` (11×9 with margin), `varrock-tent` (7×7); all checked by screenshot, also rotated |

## Walls

- **Use real wall pieces, not scenery.** A wall loc placed as type 10 is a freestanding slab
  turned by `face`; around a curve it becomes a ring of loose panels with gaps. Place walls on
  tile edges: shape 0 (straight; rotation 0 west, 1 north, 2 east, 3 south) and shape 2 for two
  edges of one tile (L corner; 0 west+north, 1 north+east, 2 east+south, 3 south+west). A tile's
  wall slot holds one wall, so two edges need the L, not two straights.
- **A wall piece shows its finished face to the tile it sits on.** Varrock's city wall sits
  on the tiles outside the city. Put the same piece on the tile across the edge (the opposite
  rotation) and you see its back: Varrock's city wall renders as a black slab, Falador's white
  stone as a plain untextured face. `build_wall` takes `facing`/`side` for this; when a wall
  looks black or flat in a screenshot, flip it.
- **Diagonal walls (shape 9)**: read off Falador castle, a south-west to north-east chain uses
  rotation 0 or 2, north-west to south-east 1 or 3; the pair differ in which face is finished.
  Falador (2963,3334 to 2964,3335) and Lumbridge castle (3215,3209 to 3216,3210) place a
  shape-1 piece of the same rotation on the thick side of a seam. Draw walls and `build_wall`
  add this piece when their style has one. Barbarian timber uses its native shape-9 pieces
  without separate joints, as in Barbarian Village at 3084,3427 and 3085,3428.
- **Edge-walling a region**: for every tile inside the shape, put a wall on each edge facing an
  outside tile (one edge → shape 0, two → shape 2). That closes ellipses and boxes with no gaps
  and leaves openings wherever you skip an edge.
- **Castle walls in the cache are unnamed**, so `search_objects` and `yarn dump:loc <name>` will
  not find them. Read them off a real building: run a `clear_area` dry run per tile over it and
  collect the type 0/2/3/9 ids.

| Loc | Shapes seen on that building | Look (checked by screenshot) |
| --- | --- | --- |
| 24175 (Falador castle) | 0, 1, 3, 9 | White stone wall, joins cleanly; the Colosseum facade |
| 24242, 24243, 24244 (Falador) | 0 | Same plain white wall as 24175 |
| 44884 (Emir's Arena) | 0 | **Low** sandstone wall; seat risers, podiums, low enclosures |
| 3152 (Emir's Arena) | 0, 2 | Tall sandstone wall |
| 3125 (Emir's Arena) | 0, 1, 3, 9 | Wooden fence, not stone |
| 1911 (Lumbridge castle) | 0, 1, 2, 3, 9 | Dark grey stone |
| 23824 (Varrock palace) | 0, 1 | Grey stone, blocky |
| 16519 `Castle wall` | 10 only (placed twice in the map: an agility obstacle) | Freestanding slab; passes in a short straight run, breaks up on curves. Not a wall piece |
| 2832 `Battlement` | 10 only | Dark rounded block |

## Other objects

| Loc | Verdict |
| --- | --- |
| 724 `Standing torch` | Good: a lit torch on a pole |
| 562 `Statue of a warrior`, 563 `Statue of a king` | Good: grey statue on a plinth |
| 860 `Flagpole` | Good: tall pole with a blue flag |
| 29115 `Marble bench` | Placed fine; not yet checked close up |
| 2106 `Archway` | Renders as a dark flat square; avoid |
| 11017 `Brazier` | Dark spiky blob; use 724 instead |
| `Pillar` (6283, 3×3), `Column` (5228) | Huge dark monoliths; avoid at scale |
| `Marble wall` (5907) | Player-owned-house object; brown wood outside |
| `Tower` (1939) | Brown ruined wooden cone, not a stone tower |
| `Fountain` (153) | Dark spiky shape |
| `White Tree patch` (9210) | A black spiky bush, not a tree |

## Ground and height

| Finding | Detail |
| --- | --- |
| Overlay 227 (Emir's Arena floor) | Bright sand; good for arenas |
| Overlays 171 (Varrock square), 137 (Falador square), 26 (Al Kharid palace), 3 (Lumbridge courtyard) | All render as dark grey or green-grey flat paint in the open; they read as paving only next to their own buildings |
| A painted area with no texture | Reads as a flat plateau, not a floor; often leaving the ground's own underlay looks better |
| Height is smoothed across tile corners | Steps of 8+ per tier blur into one slope with a cliff edge (a "mesa"). Steps of about 4, with a low wall (44884) on each step edge, read as tiers |
| Larger height value | Higher ground |
| Tiles with no stored height | `describe_tile` reports `height: null`; the client generates them. `set_height` replaces them |

## Sites and budgets

| Place | Notes |
| --- | --- |
| Lumbridge (region 12850) | About 60 KB of terrain from the cache alone; roughly 5 KB left for edits |
| Desert east of Pollnivneach (region 13614, around 3412, 2976) | 42.8 KB from the cache; almost no objects; flat enough. Desert heat applies and jackals are aggressive. The Colosseum stands here |
| Most of the mainland (Falador fields, Varrock east, Draynor, Seers', Ardougne, wilderness) | 90–220 objects per 40×34 site; expect to clear or build around scenery |

## NPCs for set dressing

| Ids | Notes |
| --- | --- |
| 12834–12839 `Gladiator` | Combat 0, not aggressive; 12837+ are size 2 |
| 11533–11535 `Citizen`, 1223 `Spectator` | Combat 0; good crowds with `wanderRadius: 0` |
| 2481 `Minotaur` | Combat 12, not aggressive |
