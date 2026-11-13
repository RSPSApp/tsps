# Teleport tablets

Breaking a teleport tablet (a spell tablet such as Varrock teleport, Teleport to house, or Teleport to boat) uses the `TELE_TAB` teleport type (`server/src/main/typescript/elvarg/game/model/teleportation/TeleportType.ts`). The tablet plugins are `server/plugins/combat/SpellTeleports.plugin.js` and `server/plugins/skills/sailing/BoatTeleport.Sailing.js`.

## What OSRS sends

Facts from a live OSRS capture (rsprox) of a player breaking a Varrock teleport tablet (inventory slot 14). Tick 0 is the tick of the click (`if_buttonx` on `inventory:items`, op 2):

| Tick | Sent |
| --- | --- |
| 0 | varbit `busy` (12393) = 1; animation `poh_smash_magic_tablet` (4069) with delay 16; `synth_sound` 965 with delay 15 |
| 2 | spotanim `poh_absorb_tablet_magic` (678); animation `poh_absorb_tablet_teleport` (4071); the tablet leaves its inventory slot |
| 4 | varbit `busy` = 0; the teleport (to 3212, 3423); animation reset (-1) |
| 5 | animation reset (-1) again |

There is no teleport sound of the player's own: a `sound_area` 200 on tick 1 of the capture is at another tile (a nearby player's teleport).

## Implementation

- `TELE_TAB` plays 4069 (delay 16) on the click with sound 965 (delay 15), then 4071 and spotanim 678 as its middle step, lands with the reset animation and resets again the tick after.
- `TeleportTypeOptions` carries what only some teleports do: their own sound instead of the spell teleport sound, the `busy` varbit, and the repeated end animation.
- `TeleportHandler.teleport` takes an `onMiddle` callback; the tablet plugins use it to remove the tablet on tick 2. The usual checks (Wilderness level, teleblock, busy) still run before anything happens, so a refused tablet is never used up. The tablet's own Wilderness warning asks next, then `TeleportHandler.confirm` (the boat-at-sea warning, All Settings 471), and the tablet breaks only after both (the order every chosen teleport follows is in `TeleportHandler`'s class comment).
- `TeleportTask` runs step 0 when the click is handled and step n on the click's tick + n: `World.process` runs the task pass before it handles packets, so the click's own tick has no task pass left. `TELE_TAB`'s start tick is 4 so that it lands on tick 4, with the absorb (start tick - 2) on tick 2; `NORMAL` (3) and `TELE_SCROLL` (3) land on tick 3 as their captures do. Checked on a running server: Break on tick 12, tablet used up on 14, landing on 16. The tests model this order (the click after tick 0's task pass). Other teleport types are unchanged until a capture of them shows their timing.
- Before this, the tests modelled a click handled before the task pass, which the real loop never does, so tablets were absorbed and landed a tick late: in the client, a tick of nothing between the throw and the absorb (the throw's delay of 16 cycles plus its 880 ms ends exactly on tick 2 in OSRS).
- Every teleport type frees the player on the landing tick (movement, untargetable, click delay), as the capture's `busy` = 0 on tick 4 shows; it used to hold them two more ticks. The release comes before the arrival callback, so a plugin can still hold the player there (boarding a boat, entering a house).
- `server/tests/teleport-tablets.test.cjs` runs a tablet teleport through the real task manager and checks each tick against the table above.

## Which tablets go where

`server/plugins/combat/data/teleport-tablets.json` holds what the spells don't:

- **Spell tablets** land where their spell does, from the standard, Lunar and Arceuus spell tables. The Ape Atoll tablet (`teletab_ape`) is the Arceuus one, so it goes to the Ape Atoll Dungeon, not the town.
- **Redirected house tablets** (`redirects`) land at that town's house portal; Trollheim's lands where the Trollheim spell does. Revert turns one back into a Teleport to house tablet; the scroll of redirection isn't returned (Wiki).
- **Varrock, Camelot and Watchtower** (`alternates`) have their own options: the town, its alternate (Grand Exchange, Seers' Village, Yanille) and Toggle. The alternate and Toggle need the medium Varrock, hard Kandarin or hard Ardougne Diary (Wiki). Toggle makes Break go to the alternate and sets the varbit the spellbook reads for it (`varrock_ge_teleport`, `seers_camelot_teleport`, `yanille_teleport_location`; client script 2615 treats 1 as the alternate). The alternate tiles are the centres of their captured landing squares (see Landing square below).
- **The spells** share this: Varrock, Camelot and Watchtower Teleport's op2 casts to the alternate behind the same diary, and op10 (Configure) changes the default. Client script 2615 sets the other options from the varbit: op1 "Cast" goes to the town, and once the alternate is the default op1 is hidden and op3 "Cast" goes to the town instead. Core already casts op1 and op3; `SpellCast` events now carry the op so the plugin can take op2 and op10 (`PluginSpellCastEvent.opId`).
  - Configure, as captured: a chat menu "Spellbook/portal default: Varrock" with "Change to the Grand Exchange." and "Cancel."; choosing it sets the varbit and says "Your default option is now the Grand Exchange teleport." (back: "Change to Varrock." and "Your default option is now the central Varrock teleport."). Watchtower's menu is "Spellbook/portal default: Yanille" / "Change to the Watchtower" / "Cancel."; its other lines and Camelot's follow the Varrock ones.
  - Without the diary, op2 is refused with "You must complete the medium, hard or elite tier of the Varrock achievement diary to use this feature." (captured); the tablets and the other two spells use the same line with their own tiers and diary.
- **Teleport scrolls** (`scrolls`) use the scroll's Teleport option. Landing tiles come from captures where there are any (Lunar Isle, Pest Control, Iorwerth Camp, Mos Le'Harmless, Watson, Spider cave, Chasm of Fire) and from RuneLite's world map teleport data otherwise. Nardah keeps its tile beside the carpet merchant; its only capture is from a Leagues world.

## Teleport scrolls

Facts from rsprox captures of teleport scrolls (Spider cave, 20 attempts in 14 recordings, rev 237-238; the others agree). Tick 0 is the click:

| Tick | Sent |
| --- | --- |
| 0 | animation `teleport_scroll_open` (3864); map_anim `telescroll_teleport` (1039) on the player's tile; sound 200 (the spell teleport sound); the scroll leaves the inventory; varbit `busy` = 1 |
| 3 | the teleport; animation reset; varbit `busy` = 0 |
| 4 | animation reset again |

`TELE_SCROLL` plays these, with the map_anim sent as a spotanim on the player. The scroll is used up on the click, after the usual teleport checks.

## Standard teleport and jewellery

`TeleportType.NORMAL` (standard spellbook teleports, teleport jewellery, the skull sceptre) follows rsprox captures of Varrock Teleport (rev 235-236) and a necklace of passage rubbed to Wyrmscraig. Tick 0 is the click:

| Tick | Sent |
| --- | --- |
| 0 | animation `human_castteleport` (714); spotanim `teleport_casting` (111) at height 92; `sound_area` 200, range 10, on the caster's tile (heard by players nearby; Grand Exchange and amulet of glory captures); varbit `busy` = 1 (from rev 236); jewellery: "You rub the necklace..." |
| 3 | the teleport; animation reset; varbit `busy` = 0; jewellery uses its charge here ("<col=7f007f>Your necklace of passage crumbles away.</col>" on the last) |
| 4 | animation reset again |

111 plays sequence 667 (12 frames, 89 client cycles), whose lead-in comes before the bubble frames, so the bubble follows the arms on its own. `NORMAL` used to play 308 (only those bubble frames) a tick later with a 15-cycle delay, and 715 on landing; neither is in the captures.

Jewellery charge messages are all `7f007f` and spell the count out ("Your ring of dueling has seven uses left.", "has one use left."); the Slayer ring uses digits ("Your Slayer ring has 7 charges left.") and ends with "Your Slayer ring has worn out.". Last charges: "crumbles to dust." for the games necklace, ring of dueling and Digsite Pendant, "crumbles away." for the necklace of passage and burning amulet. The necklace of passage's fourth Rub destination is Wyrmscraig (cache), landing at 2592, 2220 (captured).

## Not yet done

- The Ancient, Cemetery, Ice plateau and Wilderness crabs tablets' Configure option (no capture). Their Wilderness warning itself is done, set in All Settings ([settings.md](settings.md#wilderness-teleport-warnings)).
- Volcanic mine and Guthixian temple teleports: no capture or RuneLite tile for their landing.
- Quest requirements for using a tablet (Desert Treasure for Ancient tablets, Lunar Diplomacy, Watchtower).
- The tablets' Toggle message isn't captured; the text is ours. So are Camelot's Configure lines and Watchtower's beyond its menu.
- The house portals that "Spellbook/portal default" also sets.

## Landing square

A standard spellbook teleport lands on a random tile of the 5x5 square around its destination, as do its tablet and the Varrock, Camelot and Watchtower alternates (`SpellTeleports.plugin.js`; blocked tiles are skipped). Every own cast in the rsprox captures, followed to its landing:

| Spell | Landings | x | y | Centre |
| --- | ---: | --- | --- | --- |
| Varrock | 36 | 3211-3215 | 3422-3426 | 3213, 3424 |
| Grand Exchange | 334 | 3161-3165 | 3476-3480 | 3163, 3478 |
| Lumbridge | 45 | 3219-3223 | 3216-3220 | 3221, 3218 |
| Falador | 22 | 2963-2967 | 3376-3380 | 2965, 3378 |
| Camelot | 29 | 2755-2759 | 3476-3480 | 2757, 3478 |
| Seers' | 25 | 2724-2728 | 3482-3486 | 2726, 3484 |
| Kourend Castle | 12 | 1639-1643 | 3671-3675 | 1641, 3673 |
| Ardougne | 8 | 2659-2663 | 3300-3304 | 2661, 3302 |
| Civitas illa Fortis | 70 | 1679-1683 | 3131-3135 | 1681, 3133 |
| Trollheim | 9 | 2889-2892 | 3677-3681 | 2890, 3679 (Wiki: square of radius 2) |
| Yanille | 2 | 2583-2585 | 3097-3099 | 2584, 3098 |

The Varrock tablet's Grand Exchange option lands in the same square. Watchtower and Ape Atoll keep their tiles: their captures are too few to place a centre. The Ancient spellbook's teleports land spread out too (Paddewwa 3097-3098, 9881-9884; Kharyrll 3492-3494, 3471-3474), but on too few landings to place their squares; they stay on one tile.

## The house tablet's Group option

Group teleports to a Group Ironman teammate's house (Wiki, Teleport to house), as do the spell's "Group: Choose" (op4) and
"Group: Previous" (op5). SpellTeleports asks `teleports:group-house` whose house (the Group Ironman plugin answers for a
member of a Group Ironman group: `server/docs/group-ironman.md`), and Construction where it stands and whether the player
may go in (`construction:group-house`). The tablet is used up as Break uses it. A player nobody answers for gets live's
refusal: rsprox.net capture 2919 (rev 230) tick 2179, inventory op6 on `poh_tablet_teleporttohouse`, sends the game
message "You are not in an Ironman Group." on the click tick, with no animation or teleport, and the tablet is kept
(`plugins/combat/SpellTeleports.plugin.js`).
