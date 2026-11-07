# Hallowed Sepulchre

The five-floor Agility minigame under Darkmeyer. Behaviour comes from two live rsprox runs in the osrs-captures index: 1862 (Leagues V, rev 227, floors 1-4, five runs) and 3299 (Grid Master, rev 234, floors 1-5). Both worlds multiply XP (1862 x16, 3299 x15), so the plugin divides it back out. The OSRS Wiki fills in what the recordings don't show: the coffin loot, the level requirements, the token and the skill obstacles' items.

It covers the lobby, the entry, the five floors with their obstacles and traps, the timer, the coffins and leaving.

## Layout

| File | What it owns |
| --- | --- |
| `HallowedSepulchre.plugin.js` | Registers the parts and the saved attributes. |
| `hallowedsepulchre/Common.HallowedSepulchre.js` | The data, the recorded fades (174 with scripts 948/951), the timer HUD (668), chat helpers, spam lines and weighted rolls. |
| `hallowedsepulchre/Run.HallowedSepulchre.js` | The run: one `TemplatedInstanceArea` per floor and its layout, the timer, crediting a floor, leaving, logout and login recovery, and the floor 5 barriers. |
| `hallowedsepulchre/Lobby.HallowedSepulchre.js` | The lobby stairs, the warning box and "don't ask again", the Mysterious Stranger's tutorial and shards, the crystal shard, the Hallowed token, and the obelisks and return stairs. |
| `hallowedsepulchre/Obstacles.HallowedSepulchre.js` | Drops, middle stairs, platforms, the F4 gate, the F5 stepping stones, the F2 stones and the floor stairs. Also the route hook that walks to each obstacle's start tile. |
| `hallowedsepulchre/Skills.HallowedSepulchre.js` | The grapple pillars, the bridge, the portal and the brazier. |
| `hallowedsepulchre/Coffins.HallowedSepulchre.js` | The coffins and the Grand Hallowed Coffin, with the Wiki loot. |
| `hallowedsepulchre/Traps.HallowedSepulchre.js` | The traps: fire, crossbow, sword and lightning statues, the strange tiles, hits and respawns. |
| `data/hallowed-sepulchre.json` | Floors and layouts, tiles, varbits, messages, XP and loot. Each value is noted as recorded, derived or Wiki. |

The shop ("Mysterious Hallowed Goods", 1455) is generated data, and `Shopkeepers.plugin.js` already opens it from the Stranger's Trade.

## How a run goes (recorded)

- **The lobby stairs (38452).**
  - Before the Stranger's tutorial (varbit 10408), he stops you.
  - After it, the warning box shows, then "Are you sure you wish to enter?" with "Yes." / "Yes, and don't ask again." / "No.". The second option saves varbit 10409.
  - 52 Agility is needed.
- **Each floor.**
  - The fade. +1: the minimap goes off. +3: the player is in a new instance of the floor's 96x96 source area (12x12 chunks, planes 0-3), on one of the recorded layouts. A layout is a start tile plus the `*_state` varbits that show which skill obstacles are out.
  - +4: "You venture (further) down into the Hallowed Sepulchre.", music 674, and the fade in.
  - +6: the HUD. +7: the timer's first tick.
- **The timer, in game ticks.**
  - It starts at 202 on floor 1, and each floor adds 200.
  - It runs every tick, with warnings at 2:30, 1:00, 0:30 and 0:10.
  - The floor's last obstacle (a platform, the gate or the stones) stops it: varbit 10413 and script 3443.
  - At 1 the HUD closes and the floor is sealed. The next tick sends "…the door to the next floor closes." (F1-F4) or "…a magical barrier activating." (F5).
- **The floor stairs.**
  - +2: "You have completed Floor N … Total completions: N.", then the time line. A personal best is saved in varbits 10406/10407/10410/10411, with the time as whole seconds (rev 234).
  - Then the Agility XP, and down to the next floor.
- **Leaving.**
  - An obelisk's Exit asks "Are you sure you wish to leave?". Quick-exit doesn't ask and goes a tick later.
  - A finished floor is credited.
  - +2: "The obelisk teleports you back to the lobby of the Hallowed Sepulchre.", at (2400, 5982).
  - A crystal shard lands at (2399, 5981) after 3 ticks.
  - Logging out puts the player in the lobby, and so does a server stop, at the next login.

## Obstacles

- **Drops and middle stairs.** All seven recorded drops land by their face: f0 at +1,-3; f1 at -3,+1; f2 at +1,+3; f3 at +3,+1. The unrecorded floor 4 north drop uses the same rule. The three recorded middle stairs are as recorded. Floor 1's east stairs mirror the west ones about x 2272. Floor 2's north and south stairs can't be derived, and no recorded layout uses them.
- **Platforms.** Two hops of two tiles, 2 ticks apart, each with `human_jump_stones` and 12/27 cycles. Coming from the far side: "You don't see any reason to go back that way.".
- **Pillars.** Pairs two tiles apart. The swing crosses them from five tiles out on one side to five on the other, starting from the end the player can walk to (a breadth-first search over the instance's collision). This reproduces the recorded F3 swing, 2413 → 2408 → 2403.
- **Bridge.** Repair it (Construction 56, 2 planks, 5 nails, a saw and a hammer), then cross from a tile past one end to a tile past the other. Recorded: 5981 → 5975.
- **Portal.** Power it with the best Enchant spell the player can cast, then pass through the middle tile of the five-wide frame. Recorded: x 2386, 5839 → 5843.
- **Brazier.** Recorded only refusing ("You need to bring a suitable offering…"). Lighting it uses the Wiki's 2 vampyre dust (1 with the Hallowed symbol) and gives 200 Prayer XP.
- **Coffins.**
  - +2 the picklock; +5 "You successfully disarm the trap on the coffin!" and 200 Thieving XP; +6 "You push the coffin lid aside."; +8 the loot, with one "received a drop" line per item.
  - The loot is the Wiki's: marks by floor, a low/mid/high tier, and the strange old lockpick.
  - The Grand Hallowed Coffin needs 84 Thieving. Its loot is 8-10 marks, the high table, and Ring of endurance at 1/200.
- **The floor 5 barriers.** `hallowed_final_chest_barrier` (39540) is a multiloc on the timer varbit. Both its variants are solid in the cache, so the floor lifts their collision until the timer runs out.

## Traps (recorded)

Each floor finds its traps among the cache map's locs in its own instance. Every cycle counts from the floor's start, so a floor plays the same on every run.

- **Fire (Wizard statues).**
  - Floors 1-2: 38409-38412 fire every 8 ticks; 38413-38415 never fire.
  - Floors 3-5: each statue tile is in group A, B or both (a table from the recordings).
  - Each statue burns the blast tile in front of it (38427), two ticks after its ready.
  - Standing on the blast as it starts is a hit; stepping onto it while it burns is a hit the tick after.
- **Crossbows.**
  - Three lanes per statue: floors 1-2 shoot one random lane, floors 3-5 two.
  - The bolt starts 4 tiles out (5 for tier 3) and sweeps 3 or 4 tiles a tick to its lane's recorded end, then goes.
- **Swords.** The 3x3 sword goes out at the tier's step to the far point, holds, comes back, and is caught 2 ticks later. Meanwhile the statue shows its `_thrown` loc. Each statue has its own row in the data.
- **Lightning (floors 4-5).** A checkerboard in front of the statue: a 3x3 X, or 5x3 on floor 5. It stuns ("You are stunned!") for 2 ticks and never damages.
- **Strange tiles.** A forward tile pushes the player on along their corridor, a backward one back, 3-7 tiles as far as walkable. A tile fires the tick after the player arrives, unless it is resting; then it waits for its next telegraph.
- **Hits.**
  - Damage is 1-3, 2-4 or 3-5 by the trap's tier.
  - Without the ring, the recorded death animation and fade occur at +2, the checkpoint move at +4, and the HUD returns at +7. The HUD alone does not establish the exact movement-unlock tick.
  - The timer doesn't stop.
  - The checkpoints are the recordings' 23 corridor zones; elsewhere the floor's last landing is used.
  - On floor 3's layout B, the level-1 corridor uses the west drop's landing, as live (varbit 10395).
  - An equipped Hallowed ring prevents environmental-trap damage and skips the ordinary death/fade recovery, returning to the existing modeled checkpoint. This faster return is a TSPS interpretation of the [ring's effect](https://oldschool.runescape.wiki/w/Hallowed_ring); exact ring timing and every ring-specific return tile have not been captured. A separate lightning stun still holds movement.

## Not yet

- The tool storage interface (666).
- Death handling beyond the run ending (no recording has a death inside).
- The ambient NPCs.
- The clue and Mysterious page tertiaries.

## Tests

`server/tests/hallowed-sepulchre.test.cjs` builds real floor instances from the cache. It covers:
- the entry and its menu; the layouts and the timer;
- every obstacle kind;
- the recorded pillar, bridge and portal crossings, and the drop face rule;
- the pillar start found by walking;
- the coffins and loot tables;
- the obelisk, the shard, the token and logout;
- double clicks; leaving mid-fade; teleporting away during the entry;
- the floor 5 barriers;
- the traps: the recorded fire pair, bolt lane (2260 → 2246) and owl sword, a lightning patch, pads, checkpoints, stepping in a tick late, and holds not carrying over.
