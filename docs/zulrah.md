# Zulrah

Zulrah, built from the OSRS Wiki ("Zulrah", "Zulrah/Strategies", "Snakeling", "Priestess Zul-Gwenwynig", "Sacrificial boat", "Zul-andra teleport") and the cache. Near-Reality's implementation was the reference for what the Wiki leaves out: tiles, animations, projectiles and timings. No live capture has been taken yet. Wherever only Near-Reality's values are used, this page says so, so a capture can check them later.

It is one plugin, `server/plugins/bosses/Zulrah.plugin.js`, which delegates to the units in `server/plugins/bosses/zulrah/`.

## Layout

| File | What it owns |
| --- | --- |
| `ZulrahShared.js` | Ids, tiles, the access varbit and helpers such as the fade and dialogues. |
| `ZulrahRotations.js` | The four rotations as data, and the order phases come in. |
| `ZulrahFight.js` | One player's fight: the shrine, Zulrah rising, its attacks, the tail, the dives. |
| `ZulrahHazards.js` | Venom clouds, snakelings and the snakelings' attacks. |
| `Shrine.*` | The boat, the teleport scrolls, kills and loot, the damage cap, deaths and Zul-Gwenwynig's retrieval. |
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
- Damage is rolled with the player's prayer as the attack starts (Wiki).
- An attack that lands envenoms (venom 6), even through prayer (Wiki).
- Projectiles: Ranged 1044, Magic 1046, from cycle 40, landing at 58 + 5 per tile (Near-Reality).
- Animation 5069.
- The blue form's attacks are Ranged 3 times in 10 (Near-Reality). The Wiki only says Magic is "much more" frequent.
- An attack is skipped (it still counts) when a pillar blocks Zulrah's line of sight. This is not verified: the Wiki only suggests hiding behind a pillar in the blue phase.

**The tail (red form):**
- Zulrah looks at the player's tile, then strikes it 5 ticks later. It aims again at tick 9 and strikes at tick 15 (Near-Reality).
- Anyone within one tile of the aimed tile is hit; two tiles away is safe (Wiki).
- The four tiles beside the pillars, (2263/2264/2272/2273, 3072), are never hit (Near-Reality, the Wiki's safespot).
- In rotations 1 and 2, the first swing never reaches (2274, 3077) on the north-east tip (Near-Reality).
- A hit deals 20-30 typeless damage (Wiki), stuns for 3 seconds, envenoms, and throws the player up to 4 tiles away from Zulrah with anim 1157.
- Near-Reality rolls 0-41; the Wiki says 20-30.
- Which way Zulrah faces, and whether it uses anim 5806 or 5807, follows Near-Reality.

**The Jad phase** alternates Ranged and Magic, starting with the style the Wiki gives for the rotation.

**Damage taken:**
- Hits on Zulrah above 50 become 45-50 (Wiki, Mod Ash).
- Zulrah cannot be attacked from when it dives until it has resurfaced.
- Hits already on their way when it dives land at once. The Wiki says they register "shortly after it resurfaces"; Near-Reality throws them away.
- Melee only reaches it with a halberd (Wiki: since 7 May 2025 it is no longer immune to melee, but only halberds reach it).
  - Zulrah's west place is right beside the island, so a shorter melee weapon is refused with "I can't reach that!".
  - Near-Reality still zeroes all melee damage; that was not carried over.

**Animations:**
- The cache list for Zulrah was guessed wrong: the rise was set as its block animation.
- `npc-combat-defs.json` now gives attack 5069, block 5808 and death 5804, inferred from the sequences' lengths and priorities. For example, 5804 is 49 frames at priority 10, and 5808 is 9 frames at priority 5.
- Snakelings: attack 1741, block 1742, death 2408, spawn 2413.

### Places

Zulrah's south-west tile (Near-Reality):

| Place | Tile |
| --- | --- |
| Middle | (2266, 3073) |
| South | (2266, 3062) |
| West | (2257, 3071) |
| East | (2276, 3072) |

**Facing:** Zulrah faces the player whenever it is up.
- Live (Near-Reality), it turns to the tiles it spits clouds and snakelings at, and toward where its tail will land.
- Our NPC updates have a face-entity field but no face-tile one, so it stays on the player then too. The tail is aimed at the player's tile anyway.

### Rotations

`ZulrahRotations.js` holds the Wiki's four rotations phase by phase: place, form, and what Zulrah does, in order. The test checks them against the Wiki's list.

**The cycle:**
- The fight always opens in the middle in green form with four venom cloud barrages.
- Every rotation ends in the middle in green form with five Ranged attacks and four barrages. The Wiki counts this phase as the first of the next rotation.
- The next rotation is then picked at random, and may be the same one.

**Timing** (Near-Reality):
- Zulrah rises with anim 5071, can be attacked 4 ticks later, and starts its first phase 9 ticks after rising.
- Each step (an attack, a barrage, an orb) starts 3 ticks after the last.
- 3 ticks after a phase's last step it dives (anim 5072). 3 ticks later it moves to its next place in its next form.
- It rises (anim 5073) one tick after that. A teleported NPC is left out of players' views on the tick it teleports, and that tick's animation is never sent, so the rise has to wait for the next one.
- Its next phase starts 3 ticks after it rises (7 after the dive, as in Near-Reality), which is also when it can be attacked again.
- A tail phase takes 18 ticks.

**Not done:**
- The Wiki says rotations after the first can randomly differ from the expected phase.
- It also says long fights (3+ minutes) can have a green form attacking with unpredictable Ranged and Magic.

### Clouds and snakelings

**Venom clouds:**
- A barrage throws two clouds (projectile 1045, landing at 68 or 98 + 5 per tile).
- Each cloud is loc 11700 on the tile south-west of its centre, covering 3x3 (Wiki).
- Anyone inside takes damage every tick without being envenomed (Wiki). It shows as a poison hitsplat; our hitsplats have no venom type.
- A barrage onto a cloud already there makes it last from then.
- Near-Reality's values: 1-4 a hit, lasting 30 ticks.
- The Wiki does not give the damage.

**Snakelings:**
- An orb (projectile 1047, landing at 130 + 5 per tile) becomes a snakeling where it lands.
- Melee is 2045 (max 15); magic is 2046 (max 13, projectile 1230). Both attack every 3 ticks (Wiki). Near-Reality's 15 for the magic one and its speed of 4 were not carried over.
- A quarter are magic (Near-Reality). The Wiki gives no ratio.
- They rise with anim 2413 and attack 3 ticks later.
- They die after 67 ticks (Wiki: 40 seconds) or with Zulrah, and envenom like it.

**Tiles:** where each barrage and orb lands is Near-Reality's. Fixes and caveats:
- Its typo'd (2273, 2075) is (2273, 3075) here.
- A few of its tiles, such as (2273, 3078), are on the shore by the island's north tips.
- A cloud there still covers the tip.
- A snakeling there is stuck, as the Wiki says some are. It still attacks if magic, and dies after its 40 seconds.

### Differences from Near-Reality's rotations

Near-Reality's tables were checked against the Wiki and corrected:
- **The closing phase was missing.** On a repeat, Near-Reality went straight to the four barrages without the five Ranged attacks before them.
- **Rotation 4's last phase had no dive,** so the next rotation started in blue form.
- **Rotation 4's attack counts:** phase 2 is 6 attacks, not 5, and phase 9 is 4 Ranged attacks, not 5.
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
- "Your Zulrah kill count is: N." and "Fight duration: m:ss.xx", timed from Zulrah rising.
- The kill count and personal best are saved.

## Dying

**Held items:**
- What a death at the shrine would drop is held by Priestess Zul-Gwenwynig (Wiki), with the message "Priestess Zul-Gwenwynig has retrieved some of your items. You can collect them from her at the pier in Zul-Andra." (Near-Reality).
- What is kept on death is kept as usual. Untradeables lost anyway stay lost.

**Talk-to** while she holds items: "You left some stuff at Zulrah's shrine when you left earlier." (Near-Reality), then the same as Collect. Otherwise her Wiki transcript plays.

**Collect:**
- It returns the items in the order they dropped (inventory, then equipment), as far as the inventory has room.
- It is free for the first 50 kills, then costs 100,000 coins once per death (Wiki).
- Her line asking for the coins is ours; the Wiki gives none.
- With nothing held: "I'm afraid I don't have anything for you to collect. …" (Near-Reality).

**Losing them:** an unsafe death anywhere else before collecting loses what she holds (Wiki). A death while carrying nothing droppable does not clear them.

**Not done:**
- The Wiki's item-retrieval interface: Collect gives the items straight back.
- The Western Provinces elite diary's daily resurrection.
- A gravestone system. That would be its own piece of work.

## Sounds

Near-Reality's sound effects are played to the player:

| Event | Sounds |
| --- | --- |
| Zulrah's Ranged attack | 213, then 224 as it lands |
| Zulrah's Magic attack | 162, then 163 as it lands |
| Cloud barrage | 796 when spat, 790 when a cloud lands, 795 or 796 when it goes |
| Snakeling orb | 788 when spat, 1930 when it lands |
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

- **Timings:**
  - when each step starts, and the dive and rise;
  - the tail's aim and strike ticks.
- **Shares and amounts:**
  - the blue form's Ranged share;
  - the snakelings' magic share;
  - cloud damage and duration.
- **Placement:** the tiles each barrage and orb lands on.
- **Line of sight:** whether a pillar blocking line of sight skips an attack.
- **Text:** the boat's "Return to Zulrah's shrine?" choice and the priestess's lines.
- **Sounds:** the sound effect ids.
