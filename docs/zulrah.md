# Zulrah

Zulrah, built from the [OSRS Wiki](https://oldschool.runescape.wiki/w/Zulrah) and [rotation guide](https://oldschool.runescape.wiki/w/Zulrah/Strategies), cache definitions and RSProx captures. Near-Reality's implementation is still the reference for values the captures do not settle, such as attack timings and many projectile placements.

Captures reviewed (77 fights, all on Leagues or Grid Master worlds, so damage numbers are not used from them):
- RSProx #3276 (Grid Master): a whole rotation 4, its closing phase, and rotation 2's phases 2-8 (phases numbered as the Wiki does, the opening being phase 1).
- #1157 (Leagues VI): rotation 1's phases 2-7.
- #1161 (Leagues VI, 23 kills) and #820 (Grid Master, 47 kills): the opening and every rotation's first phases.
- #3342: four one-phase kills and the warning at 50 kills that future item returns cost 100,000 coins.
- None shows the daily resurrection.

Places are read relative to the middle place and the boat's landing tile (the fights are instanced): the player lands at (2268, 3068) in every one.

It is one plugin, `server/plugins/bosses/Zulrah.plugin.js`, which delegates to the units in `server/plugins/bosses/zulrah/`.

## Layout

| File | What it owns |
| --- | --- |
| `Shared.Zulrah.js` | Ids, tiles, the access varbit and helpers such as the fade and dialogues. |
| `Rotations.Zulrah.js` | The four rotations as data, and the order phases come in. |
| `Fight.Zulrah.js` | One player's fight: the shrine, Zulrah rising, its attacks, the tail, the dives. |
| `Hazards.Zulrah.js` | Venom clouds, snakelings and the snakelings' attacks. |
| `Shrine.*` | The boat, the teleport scrolls, kills and loot, the damage cap, deaths and Zul-Gwenwynig's retrieval interface. |
| `Resurrection.Zulrah.js` | The Elite Western Provinces Diary's daily safe resurrection during an active fight. |
| `Commands.*` | Developer commands. |

## Getting there

**Access is open.** The Wiki's Regicide requirement and the High Priestess's permission are not checked. Login sets varbit 4391 to 3, and two things read it:
- The pier's boat is multiloc 10068 at (2214, 3056). At 3 it becomes the Sacrificial boat (46242, Board and Quick-Board).
- The priestess is multinpc 2124. At 3 she becomes Zul-Gwenwynig (2033, Talk-to and Collect).

The server resolves both per player, so the options are handled by name.

**The boat:**
- Board asks "Return to Zulrah's shrine?" (Near-Reality); Quick-Board goes straight.
- It refuses while Zul-Gwenwynig holds the player's items: "I've got some stuff you left at the shrine earlier. …" (Near-Reality).
- The screen fades, the player lands at (2268, 3068), and "The priestess rows you to Zulrah's shrine, then hurriedly paddles away." shows.
- Zulrah rises as soon as that dialogue is closed or the player moves (Wiki).
- Live, Board also locks the camera to watch Zulrah rise. Our protocol has no camera packets, so both options behave the same.

**The shrine:**
- It is a private area over the real island, (2250-2285, 3055-3085), multi-way, as the Inferno is.
- Teleporting, dying or logging out ends the fight and removes everything.
- Logging back in on the shrine, with no fight left, puts the player at the pier (2213, 3056), Near-Reality.

**Teleports:**
- `::teleports` has Zulrah under Bosses, landing at the Zul-andra teleport destination (2196, 3056), Wiki.
- The Zul-andra teleport scrolls from Zulrah's loot have their Teleport option.

## The fight

### Forms and attacks

| Form | NPC | Attacks (Wiki) | Defence (cache) |
| --- | --- | --- | --- |
| Green (serpentine) | 2042 | Ranged | Magic -45, Ranged +50 |
| Red (magma) | 2043 | The tail, typeless | Magic 0, Ranged +300 |
| Blue (tanzanite) | 2044 | Magic, sometimes Ranged | Magic +300, Ranged 0 |

**Ranged and Magic attacks:**
- Every 3 ticks, max hit 41.
- The Wiki says that after 3 minutes green-form attacks can unpredictably use Ranged or Magic. Not modelled: in #3276 both green phases past 3 minutes are all Ranged (10 of 10 attacks).
- Damage is rolled with the player's prayer as the attack starts (Wiki).
- An attack that lands envenoms (venom 6), even through prayer (Wiki).
- Projectiles: Ranged 1044, Magic 1046, from cycle 40 to 90 at any distance, heights 92 to 12, slope 0, progress 0 (rsprox; it prints the heights four times over, 370 and 50).
- Animation 5069.
- The blue form's attacks are Ranged 3 times in 10 (Near-Reality). The captures agree: 41 of 121 blue attacks were Ranged.
- An attack is skipped (it still counts) when a pillar blocks Zulrah's line of sight. This is not verified: the Wiki only suggests hiding behind a pillar in the blue phase.

**The tail (red form):**
- Zulrah looks at the player's tile, then strikes it 5 ticks later (sound 2720). It aims again 7 ticks after the first and strikes 5 ticks after that; the dive, or the next step, comes 8 ticks after the second aim (rsprox, 19 tail phases; Near-Reality had 9 and 15).
- Anyone within one tile of the aimed tile is hit; two tiles away is safe (Wiki).
- The four tiles beside the pillars, (2263/2264/2272/2273, 3072), are never hit (Near-Reality, the Wiki's safespot).
- In rotations 1 and 2, the first swing never reaches (2274, 3077) on the north-east tip (Near-Reality).
- A hit deals 20-30 typeless damage (Wiki; the two recorded hits were 22 and 28), stuns for 3 seconds with "You're stunned!", envenoms, and throws the player west with anim 1157: 2 tiles after anim 5806, 1 after 5807. All four recorded throws went west, wherever the player stood (Near-Reality threw them up to 4 tiles away from Zulrah).
- Near-Reality rolls 0-41; the Wiki says 20-30.
- Which way Zulrah faces, and whether it uses anim 5806 or 5807, follows Near-Reality.

**The Jad phase** alternates Ranged and Magic, starting with the style the Wiki gives for the rotation.

**Damage taken:**
- Hits on Zulrah above 50 become 45-50 (Wiki, Mod Ash).
- Zulrah cannot be attacked from when it dives until it has resurfaced.
- Hits already on their way when it dives land together 6 ticks after the dive, 3 ticks after it resurfaces (rsprox, 63 of 63; the Wiki: "shortly after it resurfaces"). This uses the hit queue's generic `holdIncomingFor`.
- Melee only reaches it with a halberd (Wiki: since 7 May 2025 it is no longer immune to melee, but only halberds reach it).
  - Zulrah's west place is right beside the island, so a shorter melee weapon is refused with "I can't reach that!".
  - Near-Reality still zeroes all melee damage; that was not carried over.

**Animations:**
- The cache list for Zulrah was guessed wrong: the rise was set as its block animation.
- `npc-combat-defs.json` now gives attack 5069, block 5808 and death 5804, inferred from the sequences' lengths and priorities. For example, 5804 is 49 frames at priority 10, and 5808 is 9 frames at priority 5.
- Snakelings: attack 1741, block 1742, death 2408, spawn 2413.

### Places

Zulrah's south-west tile (Near-Reality, east and west corrected from the captures):

| Place | Tile |
| --- | --- |
| Middle | (2266, 3073) |
| South | (2266, 3062) |
| West | (2256, 3071) |
| East | (2276, 3071) |

**Facing:** Zulrah faces the player while it is up, except that it turns to the tile it spits a cloud or orb at, or whips its tail toward, until its next attack (rsprox: a face-angle with the face on the player cleared).

### Rotations

`Rotations.Zulrah.js` holds the Wiki's four rotations phase by phase: place, form, and what Zulrah does, in order. The regression suite checks them against the Wiki's list.

**The cycle:**
- The fight always opens in the middle in green form with four venom cloud barrages.
- Every rotation ends in the middle in green form with five Ranged attacks and four barrages. The Wiki counts this phase as the first of the next rotation.
- The next rotation is then picked at random, and may be the same one.
- The Wiki also warns that after the first rotation, a phase can differ from the expected phase. The available recordings did not capture this, and the Wiki does not specify the selection or odds, so this extra phase deviation is not modeled yet.

**Timing** (rsprox, 77 fights):
- Zulrah rises with anim 5071 and starts its first phase 11 ticks after rising (75 of 77; 13 in the others).
- It can be attacked 4 ticks after any rise.
- Each step (an attack, a barrage, an orb) starts 3 ticks after the last.
- A run of barrages or orbs takes a tick more before an attack or the dive (4 ticks, 63 of 63). Where orbs turn into barrages, or the other way, some phases wait that extra tick and others don't; the rotations mark those with a `wait` step. So does the closing phase between its attacks and its barrages (one recording).
- 3 ticks after a phase's last attack it dives (anim 5072); 4 after a barrage or orb.
- 3 ticks after the dive it moves to its next place in its next form and rises (anim 5073, sound 2496), all in one tick: a telejump.
- Its next phase starts 3 ticks after it rises.
- A tail phase takes 15 ticks.

**Still open:** the post-first-rotation phase deviation above. Its selection and probability need a longer RSProx capture or a more exact source before implementing it without inventing encounter behavior.

### Clouds and snakelings

**Venom clouds:**
- A barrage throws two clouds (projectile 1045): the first from cycle 40 to 90, the second from 45 to 120 at slope 10, both heights 92 to 5, aimed at the cloud's south-west tile (rsprox). They land 3 and 4 ticks after the barrage.
- Each cloud is loc 11700 on the tile south-west of its centre, covering 3x3 (Wiki).
- Anyone inside takes damage every tick without being envenomed (Wiki). It shows as a poison hitsplat; our hitsplats have no venom type.
- A barrage onto a cloud already there makes it last from then.
- Near-Reality's values: 1-4 a hit, lasting 30 ticks.
- The Wiki does not give the damage.

**Snakelings:**
- An orb (projectile 1047, cycle 40 to 120, heights 92 to 5) becomes a snakeling where it lands, 4 ticks later (rsprox).
- Melee is 2045 (max 15); magic is 2046 (max 13, projectile 1230 from cycle 10 to 30, heights 15 to 16, progress 92, rsprox). Both attack every 3 ticks (Wiki). Near-Reality's 15 for the magic one and its speed of 4 were not carried over.
- About half are magic (rsprox: 38 of 77). Near-Reality had a quarter.
- They rise with anim 2413 and attack 3 ticks later.
- They die after 67 ticks (Wiki: 40 seconds) or with Zulrah, turning into 2047 as they do (rsprox), and envenom like it.

**Tiles:** where each barrage and orb lands is Near-Reality's, checked against the captures for the opening, the closing phase, all of rotation 4, rotation 1's phases 2-7 and rotation 2's phases 2-8. Fixed from them: the opening barrages' (2272, 3069) (Near-Reality: 3070), the order of the opening's clouds, and the orb at (2273, 3078) in rotation 1 phase 4 and rotation 2 phase 5 (Near-Reality: 3077). Rotation 1 phase 7's (2273, 3077) is unrecorded and left as it was. Other fixes and caveats:
- Its typo'd (2273, 2075) is (2273, 3075) here.
- A few of its tiles, such as (2273, 3078), are on the shore by the island's north tips.
- A cloud there still covers the tip.
- A snakeling there is stuck, as the Wiki says some are. It still attacks if magic, and dies after its 40 seconds.

### Differences from Near-Reality's rotations

Near-Reality's tables were checked against the Wiki and corrected:
- **The closing phase was missing.** On a repeat, Near-Reality went straight to the four barrages without the five Ranged attacks before them.
- **Rotation 4's last phase had no dive,** so the next rotation started in blue form.
- **Rotation 4's attack counts:** phase 2 is 6 attacks, not 5. Phase 9 (middle, green) stays at Near-Reality's 5 Ranged attacks: both rotation-4 runs in #3276 have 5.
- **Rotation 1's typo'd cloud tile** (above).

## A kill

**On the kill:**
- Zulrah dies with anim 5804.
- Its snakelings die and its clouds clear (Wiki).
- Attacks already thrown still land (Wiki).

**Loot:**
- The loot lands under the player (Wiki), through the drop plugin's new `npc-drops:location` event.
- Zulrah rolls its table twice a kill, tertiary drops excluded (Wiki). The drop plugin now takes a table-level `rolls`, set for Zulrah in its Wiki corrections.

**After the kill:**
- A Zul-Andra teleport scroll (11701) appears beside the player (Wiki), on the first free tile from north-east (Near-Reality).
- Reading it asks "Leave Zulrah's shrine?" (Near-Reality), then teleports to Zul-Andra with the scroll animation 3864 and graphic 1039 (Near-Reality, both in the cache).

**Messages:**
- "Your Zulrah kill count is: N." and "Fight duration: m:ss.xx", 6 ticks after the death animation starts (its death ticks). The duration reads 3 ticks less than Zulrah's rise to its death animation (rsprox, 24 kills).
- The kill count and personal best are saved.

## Dying

**Held items:**
- What a death at the shrine would drop is held by Priestess Zul-Gwenwynig (Wiki), with the message "Priestess Zul-Gwenwynig has retrieved some of your items. You can collect them from her at the pier in Zul-Andra." (Near-Reality).
- What is kept on death is kept as usual. Untradeables lost anyway stay lost.

**Talk-to** while she holds items: "You left some stuff at Zulrah's shrine when you left earlier." (Near-Reality), then the same as Collect. Otherwise her Wiki transcript plays.

**Collect:**
- Collect opens the shared `gravestone_retrieval` interface; Take and Examine work per item, and the button pays the fee or takes everything that fits. The interface behavior reuses the captured Vorkath retrieval widget; no Zulrah-specific interface capture was found, so this part is inferred from the shared cache interface.
- It is free for the first 50 kills, then costs 100,000 coins once per death (Wiki).
- Ultimate Ironmen retrieve items directly, free, without opening the interface (Wiki).
- Her line asking for the coins is ours; the Wiki gives none.
- With nothing held: "I'm afraid I don't have anything for you to collect. …" (Near-Reality).

**Losing them:** an unsafe death anywhere else before collecting loses what she holds (Wiki). A death while carrying nothing droppable does not clear them.

**Daily resurrection:** with the Elite Western Provinces Diary complete, the first lethal hit during an active Zulrah fight each day restores all skills and lets the same fight continue. The limit resets at 00:00 UTC, but the player must log in after reset before using it again. It prevents the death, making the rescue safe for Hardcore accounts (Wiki). No capture of the rescue was available.

## Sounds

Sound effects played to the player (Near-Reality's unless marked):

| Event | Sounds |
| --- | --- |
| Zulrah's Ranged attack | 213, then 224 as it lands |
| Zulrah's Magic attack | 162, then 163 as it lands |
| Cloud barrage | 790 when spat, 1930 when a cloud lands (rsprox), 795 or 796 when it goes |
| Snakeling orb | 788 when spat, 797 when it lands (rsprox) |
| Resurfacing | 2496 (rsprox) |
| Tail strike | 2720 (rsprox) |
| Snakelings' attacks | Melee 794; Magic 224, then 794 as it lands |

## Not carried over from Near-Reality

- Combat achievements, the boss timer, the advent calendar and loot broadcasts.
- The cannon restriction: this server has no cannon to place.
- The magic snakeling's max hit of 15, its attack speed of 4, and a melee snakeling attacking from 6 tiles away. The Wiki gives 13, 3 and melee range.
- Its 0-41 tail damage. The Wiki gives 20-30.

## Data and shared changes

- `npc-combat-defs.json`: animations for Zulrah's three forms and both snakelings.
- `plugins/npcs/NpcDrops.plugin.js`:
  - tables can have `rolls`;
  - the `npc-drops:location` event lets a plugin move where loot lands;
  - Zulrah's two rolls are set in its Wiki corrections.
- `plugins/interface/TeleportInterface.plugin.js`: Zulrah under Bosses.

## Developer commands

| Command | What it does |
| --- | --- |
| `::zulrah` | To the Zul-Andra pier. |
| `::zulrahfight [1-4]` | Straight onto the shrine, optionally forcing the first rotation. Zulrah rises when you move. |
| `::zulrahkill` | Kills the Zulrah you are fighting. |

## Unverified (for a capture to settle)

- **Timings:** settled by the captures above, except why some orb-to-barrage switches wait a tick and others don't, and what happens to a phase's attacks when the player is out of reach as it starts (in #3276 two such phases had 2 and 3 attacks instead of 4, the first one late).
- **Placement:** the tiles of phases no capture reaches (rotation 1 phases 8-10, rotation 2 phases 9-10, rotation 3 past phase 3).
- **Line of sight:** whether a pillar blocking line of sight skips an attack.
- **Text:** the boat's "Return to Zulrah's shrine?" choice and the priestess's lines.
- **Sounds:** the sound effect ids.
- **Rare mechanics:** the Wiki's long-fight green style switch (not seen in 10 recorded attacks) and the extra phase deviation after the first rotation are not implemented pending evidence for their selection and odds.
- **Retrieval UI and resurrection:** the shared cache interface was captured for Vorkath, not Zulrah; the Zulrah-specific UI and daily rescue behavior still need direct capture confirmation.
