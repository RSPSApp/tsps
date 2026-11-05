# Canoes

Issue [#799](https://github.com/RSPSApp/tsps/issues/799). The plugin supports the free-to-play
River Lum network and the members River Dougne network introduced on 1 April 2026. These
networks are separate. Canoe state is private to the player, survives walking/teleporting away,
and clears on logout, use, or starting at another station. Axe storage survives logout and
preserves the item's metadata, including charges.
Death or logout during the departure fade clears the recovery marker, so a later login
does not move the player away from their normal respawn or logout position.

## Evidence

- [Canoe](https://oldschool.runescape.wiki/w/Canoe) and
  [Canoe Station](https://oldschool.runescape.wiki/w/Canoe_Station), fetched through the Wiki
  API on 24 October 2026: levels 12/27/42/57; shaping XP 30/60/90/150; ranges one/two/three/all;
  stored or carried/wielded usable axes; single-use canoes; only Wakas enter Ferox or the
  Wilderness pond. A log can leave Ferox for Edgeville. The pond is one-way. Shaping's
  bronze-through-rune probability pairs and the first four tree chopping pairs are published
  on these pages. High-tier tree chopping probabilities are not published; this implementation
  fells the tree on the first attempt for mithril and better axes.
- [RSProx 4005](https://rsprox.net/download/4005), revision 237, 3 April 2026: complete River
  Dougne journeys in both directions. Confirms `canoe_river`, `canoe_startfrom`, player-specific
  station states `0 -> 9 -> 10 -> type -> type+4 -> type+10 -> 0`, shaping widget 416 and map
  952. Log/dugout/stable/waka buttons are 20/18/12/11; map buttons 7/12/17/22/27.
  Carving uses the axe-specific `human_canoeing_carve_*` animation for four ticks per attempt;
  pushing uses `canoeing_pushing_into_water` and `canoeing_station_animations`, then becomes
  ready after two ticks. Captured landings: Castle Wars 2436,3134; Tree Gnome Village
  2485,3188; zoo 2577,3261; Chaos Druid Tower 2571,3360; stronghold 2523,3408. All five sinking
  object placements come from the same recording.
- [RSProx 4045](https://rsprox.net/download/4045), revision 237, 9 April 2026: Edgeville
  construction, assistant Store-axe (including missing-axe refusal), Waka carving and travel
  to Barbarian Village at 3109,3415. Confirms assistant and missing-tool messages.
- [RSProx 1710](https://rsprox.net/download/1710), revision 227: Champions' Guild arrival
  3199,3344. [RSProx 1723](https://rsprox.net/download/1723), revision 227: Edgeville arrival
  3128,3503. Decode errors later in these older recordings do not affect the canoe sections.
- Current cache `osrs-241_2026-10-20`: `dump:loc` confirms every tree placement, `Gamevals`
  resolves all loc/varbit/animation/NPC identifiers, and `dump:widget 416`, `952`, `953` plus
  clientscripts 3093/3095/3103–3108/7886/7891 confirm native controls, level filtering and
  destination availability. The obsolete map 57 is deliberately unused. Every axe's carve
  animation is checked against the cache in the focused test.

Raw recordings and decoded account details stay outside the repository.

## Checking

Run `yarn build` in `server`, then `node --test tests/canoes.test.cjs`. Coverage includes all
440 route/type pairs, current-cache identifiers, requirements, construction/XP, duplicate
clicks, interruption, private rowing/arrival, logout recovery and stored-item metadata.
Live checks on this worktree's agent MCP (49808) completed Edgeville Waka to Barbarian Village
and Castle Wars log to Tree Gnome Village through native object options and widget packets.
Both journeys reset station/type/cutscene/minimap state, released movement and allowed walking
from the landing. Marten stored a rune axe, that stored axe felled Ferox's tree with an empty
inventory, and withdrawal returned the axe. The provisional Ferox tile was live-walked and
checked inside the enclave boundary. Server build and 20 focused/adjacent tests pass.

## Limits

Lumbridge, Ferox and pond arrivals are adjacent cache-bank tiles checked for collision,
not recorded OSRS landing coordinates. Their sinking positions are likewise provisional.
The rowing scene uses the captured source map, camera, west-facing rowing animation, the
`fov_clamp`/`draw_distance_max_override` variables, the river sound (2728, 16 loops) and the
captured scenery: four NPCs stepping north through the map one tile a tick, the three that reach
y 4522 deleted on +7 and replaced further south (scenery_1 at 1821,4500 on +7, bullrush 1820,4501
and leaf 1819,4505 on +10). Every ride in RSProx 4005 is the same 26-tick scene whatever the
distance. The first Chop-down swing waits three ticks after the click lands, and the tree falls
with sound 2734, as captured. The underground Wilderness tunnel transition is not reproduced,
and the station walk-to-chop-tile live does before swinging is not reproduced either. The Wilderness confirmation uses the existing chatbox prompt with a
one-way warning; the captured native Wilderness warning interface was unavailable.
Assistant right-click storage works; generated NPC teaching transcripts are not rewritten.
