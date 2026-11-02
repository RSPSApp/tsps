# God Wars Dungeon

The God Wars Dungeon and its four generals (General Graardor, Kree'arra, Commander Zilyana, K'ril Tsutsaroth), built from the OSRS Wiki, rsprox captures (https://rsprox.net/database) and the cache. Nex and the Ancient Prison are a plugin of their own (docs/nex.md); Zaros's essence is kept here with the others. It is one plugin, `server/plugins/bosses/GodWars.plugin.js`, with one unit per part in `server/plugins/bosses/godwars/` and its data in `godwars/data/godwars.json`.

## Layout

| File | What it owns |
| --- | --- |
| `Common.GodWars.js` | The data, the factions, essence, the generals' kill counts, small helpers. |
| `Rules.GodWars.js` | The pure access rules (boulder, entrance rope, boss doors). |
| `Dungeon.GodWars.js` | The dungeon as one multi-combat Area: the overlay, the way in and out, essence, aggression, resetting empty chambers. |
| `Chambers.GodWars.js` | The boss doors, the private chambers and the altars. |
| `Crossings.GodWars.js` | The way into each stronghold. |
| `Combat.GodWars.js` | Attacks built from captured specs, the chamber's "attack on sight", Armadyl's melee rule. |
| `Bandos/Armadyl/Saradomin/Zamorak.GodWars.js` | Each general's and bodyguards' attacks. |

## Essence

OSRS calls the kill count "Essence" in the dungeon, and so does tsps.

| What | How |
| --- | --- |
| Overlay | `godwars_overlay` (406) at overlay_atmosphere while in the dungeon or a private chamber. It draws the counters from their varbits itself. |
| Counters | `godwars_counter_armadyl` 3973, `_bandos` 3975, `_saradomin` 3972, `_zamorak` 3976. |
| Earning | One per follower of a god killed; generals and bodyguards count (Wiki). Followers are id ranges in the data file. |
| Limit | 4,000 (Wiki). |
| Kept | On logout (Wiki). |
| Cleared | When the player leaves the dungeon. As captured, the counters drop to 0 on the way back down the entrance rope. |

## Aggression

Every monster in the dungeon attacks on sight, whatever the player's combat level, unless the player wears something of its god; one item per god is enough (Wiki). The generals and bodyguards ignore god items and attack anyone who comes into their chamber.

### God items

Each god's `protectionItems` in the data file is the Wiki's protection table for it ([God Wars Dungeon](https://oldschool.runescape.wiki/w/God_Wars_Dungeon), "God equipment", read 28 October 2026), written as the cache's item names and compared without case. Zaros's list (`ancient`) is there too. The same list drives aggression, the altar's Prayer boost, `godwars:kill`'s `godItems` and anything else that calls `godItemCount`.

- **Variants:** a cache name that is a listed name plus a bracketed suffix counts as that item: `(or)`, `(l)`, `(u)`, `(uncharged)`, `(Deadman)`, `(g)`, `(t)`. The Wiki sends these pages to the base item's page, and those pages say the item counts (Craw's bow, Thammaron's sceptre, the Holy Scythe of Vitur, the halos, Monk's robe (t)).
- **Ids:** the painted heraldic helm and kiteshield and the god rune scimitars are called "Rune heraldic helm", "Rune kiteshield" and "Rune scimitar" in the cache, the same names as the other crests' copies and the plain scimitar. These go in `protectionItemIds`: `poh_helmet_saradomin_rune` 8488, `poh_shield_saradomin_rune` 8738, `rune_scimitar_saradomin` 23332, and 8494, 8744 and 23334 for Zamorak. The table names only the rune helm and kiteshield, so the steel and adamant painted copies are not listed.
- **No keywords:** the Wiki has no "anything with the god's name" rule, so names aren't matched by keyword. The name keywords used before missed the books, symbols, blessings and the god's other items. They also counted items the table leaves out: the Corrupted armadyl godsword and the Saradomin and Zamorak banners.

This needs a generic core hook: `Area.npcAggression(player, npc)` returns false (never), true (always, past the level and tolerance checks) or null (the usual rules).

## The way in

| Step | What happens | Source |
| --- | --- | --- |
| Boulder, crack | Troll Stronghold (Dad defeated); the boulder needs 60 Strength or Agility. | Wiki |
| Hole | The first visit ties a rope (varbit `godwars_entrance_rope` 3966, kept for good). After that: "You climb down the rope.", the ladder animation (828), the move to (2882, 5311, 2) a tick later. | capture |
| Rope back up | Back to the surface by the hole. | |

## Strongholds

All need a level of 70 (Wiki). Ticks count from arrival.

| Stronghold | Crossing | Captured |
| --- | --- | --- |
| Bandos | Big door (26461), with a hammer | Gong animation 7214; at +3 sound 71 and a step west. From the west side the door just opens. |
| Armadyl | Pillar (26380), crossbow and mithril grapple | "You fire your grapple at the pillar..."; at +1 `dorgesh_xbow_swing` 6067, grapple spot 1036, sounds 2928 and 3503, the pillar's swing 6072; exact-moves at +4 (cycles 15-29) and +5 (0-21); "...and swing safely to the other side." Without a grapple: "You need a mithril grapple-tipped bolt with a rope to do that." |
| Saradomin | Two rocks (26561, 26562), a rope each | Tie-rope spends a rope and sets `godwars_saradomin_rope1/2` (3967/3968) for good. Climb-down: "You climb down the rope.", the move a tick later. The ropes back up are in loc-teleports. |
| Zamorak | Ice bridge (26518) | A swim (6993, sound 3862) at +3, out at +8: "Dripping, you climb out of the water." Going north also "The extreme evil of this area leaves your Prayer drained." and Prayer drops to 0. |

## Boss doors

The cache's door is a multiloc on varbit `godwars_entrance` (11708): 0 shows Open / Peek, 1 shows Open (normal) / Open (private) / Peek. OSRS sets it with the Hard Combat Achievements; tsps has none, so everyone gets it at login.

| Option | What happens | Source |
| --- | --- | --- |
| Open (normal) | 40 essence is spent: "The door devours the life-force of 40 followers of Bandos that you have slain." Short of essence, an ecumenical key melts into the door: "Your ecumenical key melts into the door." The door swings open for two ticks (26506 and 26507 in place of the door) and the player is moved inside. | key message, door locs and timing: capture; the essence line: OSRS text, no capture |
| Locked | "This door is locked by the power of Armadyl! You will need to collect the essence of at least 40 of his followers before the door will open." | capture (15 there, the Grandmaster tier's number) |
| Ironman | While someone is in the shared chamber: "There appears to be someone fighting in there already. As an Ironman, you'd do better with your own room." | capture |
| Open (private) | The same essence or key, plus 150,000 coins (the Hard tier's price). `godwars_fader_init` (343) fades the overlay; a tick later the chamber is rebuilt and the player is inside; varbit `godwars_instance` (11709) is 1 there. | capture |
| Peek | "You peek inside the door and see no adventurers in the room." With someone inside, the count (our wording). | capture |
| From inside | Open lets the player out. | |

### Private chambers

A `TemplatedInstanceArea` per player, a copy of the cache map around the chamber on every plane, unturned, as captured for Bandos (13x9 chunks from chunk 352, 663). The other three use a box of the same size around their chamber. The general and bodyguards spawn from `npc-spawns.json`'s rows in the chamber and come back 150 ticks after they die. Leaving by the door or the altar, teleporting, dying or logging out ends the chamber; logging out (or a server stop) leaves the player outside the door.

### Shared chambers

The world's spawns. The generals and bodyguards respawn after 150 ticks (Wiki). Once nobody is left in a chamber, its general and bodyguards heal and their Defence is restored (Wiki: "If all players leave, his health and stats will be reset").

## Altars

| Option | What happens | Source |
| --- | --- | --- |
| Pray | Not in combat: "You need to be out of combat to use this altar." Once every 10 minutes: "The gods blessed you recently. They will ignore your prayers for another N minutes." Restores Prayer to the maximum plus one per item of the god worn: "You recharge your Prayer points." | Wiki; no capture, the texts as OSRS has them |
| Teleport | Out of the chamber to the door's outer tile, in combat too. In a private chamber this ends it. | Wiki |

## The fights

Animations, spot animations, projectiles and sounds are from the captures. Projectiles keep the captured launch cycle, arc (angle), start offset (progress) and heights; their flight grows per tile as measured (for example Steelwill 46 + 10 per tile, Grimspike 46 + 5). A projectile attack's hit lands as the projectile does, a melee hit on the attack's tick. Kill counts: "Your General Graardor kill count is: N." (captured) on varps `total_bandos_kills` 1504, `_armadyl_` 1503, `_saradomin_` 1505, `_zamorak_` 1506.

| NPC | Attacks |
| --- | --- |
| General Graardor | 2/3 melee (7018, sound 3871, 60); 1/3 a ground slam (7021, spot 1203, projectile 1202) on everyone in the chamber, 15-35, only in melee range (Wiki). |
| Sergeants | Strongstack melee (6154, sound 469); Steelwill magic (7071, spot 1216, projectile 1217, sound 3868); Grimspike ranged (7073, spot 1219, projectile 1220, sound 3841). |
| Kree'arra | One animation (6980, sound 3870) throwing a ranged tornado (1199, 69) or a magic blast (1200, 21, against Ranged defence) at everyone in the chamber; the captures show them equally often. |
| Flock | Skree magic (6955, spot 1194, projectile 1201, impact 1195); Geerin ranged (6956, projectile 1192); Kilisa melee (6957). Melee only reaches Armadyl's followers with a halberd or salamander: "Kree'arra is flying too high for you to attack using melee." (captured wording). |
| Commander Zilyana | Melee range only; half melee (6967, sound 2503, 27), half a magic strike (6970, sound 3856, target spot 1221) for 10-20 (Wiki). |
| Her bodyguards | Starlight melee (6376, sound 3888); Growler magic (7037, spot 1182, projectile 1183); Bree ranged (7026, spot 1185, projectile 1190). |
| K'ril Tsutsaroth | 2/3 melee (6948, sound 3866, 46), 1/3 magic (6950, spot 1224, projectile 1225, 10-30). Against Protect from Melee, one melee attack in nine is "YARRRRRRR!": 35-49 through the prayer, half the Prayer points drained (Wiki). |
| His demons | Tstanon melee (64, sound 397); Zakl'n ranged (7077, spot 1222, projectile 1223); Balfrug magic (4630, spot 1226, projectile 1227). |

`npc-combat-defs.json` had the human punch and block (422/424) for Kree'arra, Zilyana and K'ril and a generic death sound; they now have their own animations and captured death sounds (Graardor 3838, Kree'arra 3839, Zilyana 3860, K'ril 3864, the sergeants 471). Wingman Skree's attack is the cannon (6955), not Geerin's spear.

Where sounds were played at the same moment by two bodyguards in every capture (Armadyl's and Saradomin's ranged and magic guards attack together), which sound belongs to which is a guess.

## Testing

`::essence [amount] [god]` (administrators) sets one god's essence (bandos, armadyl, saradomin, zamorak or ancient), or every god's; with no amount it sets 40.

## Not done

- Kree'arra's melee (only when nobody attacks him, per the Wiki) and his knock-back.
- Monsters of different gods fighting each other.
