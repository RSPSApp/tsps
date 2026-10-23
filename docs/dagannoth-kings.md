# Dagannoth Kings

Dagannoth Prime (2266), Rex (2267) and Supreme (2265) with their Spinolyps, in the
Waterbirth Island Dungeon's deepest level, built from the OSRS Wiki
([Dagannoth Kings](https://oldschool.runescape.wiki/w/Dagannoth_Kings),
[Strategies](https://oldschool.runescape.wiki/w/Dagannoth_Kings/Strategies),
[Prime](https://oldschool.runescape.wiki/w/Dagannoth_Prime),
[Rex](https://oldschool.runescape.wiki/w/Dagannoth_Rex),
[Supreme](https://oldschool.runescape.wiki/w/Dagannoth_Supreme),
[Spinolyp](https://oldschool.runescape.wiki/w/Spinolyp)) and checked tick by tick
against live rsprox captures (<https://rsprox.net/database>; submissions 89 and 86
on rev 227, 1856/1863 on rev 227, 3433 on rev 235). The plugin is
`server/plugins/bosses/DagannothKings.plugin.js`, with its units in
`server/plugins/bosses/dagannothkings/`. Ticks count from the attack unless stated.

Reference implementations in other private servers (behaviour oracles only, never
justification on their own): ReasonPS' `DagannothPrime/DagannothRex/DagannothSupreme/
Spinolyp` combat classes (`server reasonps/kronos-server/.../dagannothkings/`) and
combat JSONs, and Near-Reality's spawn data. Where they disagree with the captures
or the Wiki, those win: ReasonPS attacks from range 6, but Prime was captured
hitting at 11 edge tiles; ReasonPS respawns in 25 ticks, but the Wiki says 150 for
all three kings.

| File | What it owns |
| --- | --- |
| `Common.DagannothKings.js` | Ids, tiles, animations, projectiles, sounds, small helpers. |
| `Fight.Prime.DagannothKings.js` | Prime's AoE magic (water wave, max 50, prayable). |
| `Fight.Supreme.DagannothKings.js` | Supreme's multi-target ranged (spine, max 30). |
| `Fight.Rex.DagannothKings.js` | Rex's melee (max 26, walks up to the player). |
| `Fight.Spinolyp.DagannothKings.js` | Spinolyp ranged (poison) and magic (prayer drain). |
| `Dive.Spinolyp.DagannothKings.js` | The submerge/emerge cycle and the non-attackable water. |
| `Area.DagannothKings.js` | The multicombat lairs, aggression ranges, no tolerance. |
| `Entrance.DagannothKings.js` | The Kings' ladder (Standard/Slayer/Private/Peek) and the exits. |
| `Hud.DagannothKings.js` | The boss HUD per king. |

## Evidence

- **rsprox:** `NPC 2265 dagcave_ranged_boss` matches submissions 89 (151 matches),
3433 (109), 1856/86/1863; 2266 and 2267 match the same five. 89 fights at
(2900, 4449) with spawns at Supreme (2906, 4448), Prime (2911, 4451), Rex
(2913, 4445) - the same tiles as `npc-spawns.json`. 3433 fights the same kings at
(2906, 4384), (2911, 4387), (2913, 4381): a second, Slayer-task lair (see below).
- **Prime (89, ticks 4824-4830):** `dagannoth_meganoth_attack_mage (2854)` with
`map_projanim_v2` water-shaped shot (starttime 10, endtime 101 at 11 tiles, angle 20,
heights 55 to 25) and area sound 213 at his tile; the player answers with
`human_shield_defence (1156)` and damage lands ~3 ticks later. Protect from Magic
blocks it (failedspell splash captured) - no prayer bypass anywhere here.
- **Supreme (89, ticks 4827-4829):** `dagannoth_meganoth_attack_range (2855)` with
`echo_dagannoth_spine_spotanim_travel (3167)` (the Leagues echo of
`dagannoth_spine_spotanim_travel (475)`), endtime 76 at ~7 tiles, area sound 227
with the projectile's delay at the player; damage ~2 ticks later.
- **Rex:** walks up to the player and attacks with
`dagannoth_meganoth_attack_melee (2853)`; defend 2852 everywhere.
- **Deaths:** `dagannoth_meganoth_death (2856)`; loot (bones, hide, drops) lands at
the body; killcount "Your Dagannoth Kings kill count is:" (Leagues echo wording in
the logs) with the Combat Achievements firing (Rapid Succession, Toppling the
Diarchy - both already implemented, matching the captures' messages).
- **Entrance (89, tick 4822; 3433, tick ~6125):** `oploc Kings' ladder (3831)` at
(1911, 4367) - a plain teleport to (2900, 4449) after the 89 click, and to
(2900, 4385) after 3433's Slayer-option click, both with no animation. The 89
click opens the "Fight the Raging Echo" modal (Leagues echo flow, not
implemented); the task lair needs no modal.
- **Cache (rev 241):** NPCs 2265/2266/2267; SEQs 2852-2856
(`dagannoth_meganoth_defend/melee/mage/range/death`); spotanims 162
`waterwave_travel`, 475/476 `dagannoth_spine_spotanim_travel[/travel2]`, 474
`dagannoth_arrow_spotanim_hit`, 477 `dagannoth_whirlpool`; loc 3831 (multiloc
whose resolved children 40417/40418 are named "Kings' ladder" with
Standard/Slayer[/Private]/Peek - but only 3831 ever arrives as an interaction,
so only it is hooked; a name hook cannot work as the server-side definition is
unnamed) and 10229 (Climb-up ladders in both lairs); `monsters-complete.json`:
255 HP, max 30/50/26, speed 4, Aggressive, size 3, spinolyps max 10 speed 4
aggressive.
- **Wiki corrections applied:** respawn 150 ticks (90s) over ReasonPS' 25 (the
captures' kill gaps and the strategies' rotation downtime agree); attack range 12
for Prime (captured at 11; ReasonPS says 6) and 10 for Supreme (captured 7+);
aggression Rex 5, Prime/Supreme 7 (Wiki, from the SW tile) over ReasonPS' 6/6/3;
spinolyp magic uses the ranged-defence roll (Wiki + Mod Ash).

## The way in

- **Kings' ladder** (3831 at (1911, 4367)): Standard walks into the public lair at
(2900, 4449); Slayer needs a dagannoth task and walks into the task lair at
(2900, 4385) ("You need to be assigned dagannoths as a Slayer task..." is our
wording, uncaptured); Private is answered as not yet available (follow-up);
Peek counts the public lair ("...no adventurers inside." when empty, uncaptured
wording following the other bosses).
- **Out:** the Climb-up ladders (10229 at (2899, 4449) and (2899, 4385)) walk back
to (1910, 4367). No capture of the exit exists; the destination mirrors the
entrance side.
- **::teleports** lands by the ladder room at (1908, 4367), so every entry starts
outside like the other boss teleports.

## The fight

| King | Style | Animation | Projectile | Speed | Range | Max |
| --- | --- | --- | --- | --- | --- | --- |
| Prime | Magic, AoE 3x3 | 2854 | 162, impact 477 | 4 | 12 | 50 |
| Supreme | Ranged, multi 6x6 | 2855 | 475 | 4 | 10 | 30 |
| Rex | Melee | 2853 | - | 4 | edge | 26 |
| Spinolyp | Ranged 60% / Magic 40% | 2868 | 476 / 124 | 4 | 10 | 10 |

- **Prayers work:** Protect from Magic/Missiles/Melee each cut their king (captured
prayer flicking and the failedspell splash on blocked Prime hits). Nothing here
bypasses protection prayers.
- **Prime's AoE:** players standing next to his target (Chebyshev 1, the Wiki's 3x3)
take the same hit; impact gfx 477 on accurate hits (ReasonPS).
- **Supreme's multi:** players within 3 tiles of his target (the Wiki's 6x6 area;
the facing-direction nuance is a follow-up) take the hit, with the captured 227
impact sound at the target.
- **Rex** walks up and melees edge-adjacent on the 3x3 body.
- **Aggression:** Rex 5 tiles, Prime/Supreme 7 (Wiki, from the SW tile), enforced by
the Area; none of the kings become tolerant (Wiki). Spinolyps use the engine's
default aggression.
- **Death:** 2856, removal 5 ticks later (`deathTicks: 5`), respawn 150 ticks later
(`respawn: 150`, Wiki's 90s), at the world spawns.
- **Boss HUD:** interface 303 per king (varp 1683, varbits 6099/6100, script 2887 as
captured), shown while fighting a player, hidden on the death or on leaving.
- **Loot:** the standard `dagannoth_prime/rex/supreme` tables in
`data/definitions/npc-drops.json` (bones + hide always, rings/daxe 1/128,
pets 1/5000).

## Spinolyps

- **Styles:** 60% ranged (spine 476, poisons, starts at 6 - the engine's poison
severity 30 lands exactly there), 40% magic (124, drains 1 prayer point on a
damaging hit). Both max 10, speed 4 (dumps + Wiki).
- **Magic defence:** the magic rolls ranged accuracy against Ranged defence (Mod
Ash; `accuracyDefenceType`), with magic damage and the Magic splash graphic - the
Kree'arra pattern. Prayer-wise it is Magic: Protect from Magic blocks it.
- **Prayer drain:** 1 point per damaging magic hit; a spectral spirit shield halves
it (coin flip, averaging Mod Ash's 50%).
- **Diving:** on unblocked damage taken (1/3) and after its own attacks (1/7), the
spinolyp plays 2866, becomes its paired water form (5947/5961/5963 to
5946/5948/5962), waits 5 ticks, shifts a couple of tiles and re-emerges with 2864
(ReasonPS; pairing order-matched, estimate). Submerged water cannot be attacked
(Wiki: "You can't attack this npc."), cannot attack, and dying there is not
special-cased beyond the standard drops.
- **Spawns** for both forms already exist in `npc-spawns.json` in both lairs; the
cycle drives them whichever form is up.

## Combat Achievements (cache names, rev 241)

- "Dagannoth Prime/Rex/Supreme Champion" (Medium): 10 kills. "... Adept" (Hard):
25 kills. (Already in the Combat Achievements plugin with kill counting.)
- "Rapid Succession" (Elite): all three within 9 seconds (already implemented;
captured firing in 89).
- "Toppling the Diarchy" (Elite): Rex + one other same tick (already implemented).
- "Death to the Seer/Archer/Warrior King" (Elite): kill while under attack by the
other two (follow-ups, not implemented here).

## Not built

- Rented private instances (ladder Private option).
- Slayer-task-only *attacks* inside the lairs (the task lair gate is the enforced
part; task checks per swing are not modelled - as with the Kraken's task rule).
- Supreme's facing-based cone (radius used instead) and the exact per-cast
projectile ends (they vary with distance as captured; the fitted delays reproduce
the typical landings).
- Wind... elemental weaknesses (Wiki: 35% earth on each king) - no engine support,
as everywhere else.
- The Slayer-lair crack Peek and noted-bones handling for the elite Fremennik diary.
