# Minigame and home teleports

The Minigame Teleport spell (all four spellbooks) and the home teleports (Lumbridge, Edgeville, Lunar, Arceuus) share the long "home teleport" cast. Built from the OSRS Wiki ("Minigame Teleport", "Home Teleport") and two live OSRS captures (rsprox): a Nightmare Zone teleport, and a Rat Pits teleport followed by a second cast on cooldown.

## What OSRS sends

**Casting Minigame Teleport** (`magic_spellbook:teleport_minigame_arceuus`, 218:9 in the live game; our cache, revision 237, has the spell on 218:8 for every spellbook, so the server matches it by its cache name):

- varbit `busy` (12393) = 1;
- the minigames interface (951) opens on the main modal (`toplevel_pre_eoc:mainmodal`, 164:16).

**Choosing a minigame** (`minigames:minigame_n`, op 1) is tick 0 of the cast. The list is built by the client from the cache: enum 5924 maps list position to component (951:25 down to 951:5), enum 5923 maps list position to a row of db table 214, whose column 1 names the minigame (951:13 is Nightmare Zone, 951:11 Rat Pits). The cast, the same in both captures:

| Tick | Sent |
| --- | --- |
| 0 | `busy` = 0; animation and graphic reset; the interface closes |
| 1 | graphic 800 (`aide_chalk_circle`), animation 4847 (`aide_drawing_chalk_circle`); area sound 193, range 4 |
| 7 | animation 4850 (`aide_sitting_down_crosslegged`); area sound 196 |
| 13 | graphic 802 (`aide_player_book_get`), animation 4853 (`aide_player_getting_book`); area sound 194 |
| 17 | graphic 803 (`aide_player_book_portal`) at height -10 (65526), animation 4855 (`aide_reciting_incantation`); area sound 195 |
| 21 | `busy` = 1; graphic 804 (`aide_player_teleport`), animation 4857 (`aide_player_teleporting`) |
| 24 | `busy` = 0; the teleport; varp 888 = the current `date_minutes` (varp 3078); animation and graphic reset |
| 25 | animation reset again |

**Rat Pits** closes the list and opens the chatbox menu (interface 219, script 58) "Which rat pit would you like to visit?" with "Ardougne (kittens)", "Varrock (grown cats)", "Keldagrim (overgrown cats)", "Port Sarim (wily cats)" and "Cancel". `busy` stays 1 until the choice, which is then tick 0.

**Landing tiles in the captures:** Nightmare Zone (2609, 3121), the Ardougne rat pit (2565, 3320). The Wiki gives (2609, 3114) and (2561, 3320); the server uses the captured tiles and the Wiki's for the rest.

**On cooldown**, the cast only sends: "You must wait another 20 minutes before you can use the minigame teleports." (cast again right after landing). Varp 888 holds the minute of the last minigame teleport; varp 892 the last home teleport (RuneLite names them `LAST_MINIGAME_TELEPORT` and `LAST_HOME_TELEPORT`).

## Implementation

- `server/plugins/combat/HomeTeleportSequence.js`: the cast above. Before tick 21, walking or combat interrupts it (Wiki); no teleport and no cooldown. From tick 21 the player is held until landing.
- `server/plugins/interface/MinigameTeleports.plugin.js`: the spell, the list, the enum mapping, Rat Pits' menu, requirements and the 20-minute cooldown (varp 888, saved per player).
- `server/plugins/combat/HomeTeleports.plugin.js`: the four home teleports with one shared 30-minute cooldown (varp 892); on cooldown, "You need to wait another N minutes to cast this spell." (OSRS). Destinations from the Wiki: Lumbridge (3222, 3218), Edgeville (a random tile of 3087-3090, 3501-3504), Lunar Isle (2094, 3913), Arceuus (within 2 tiles of 1700, 3882). They used to be instant teleports in the core spell tables.
- `server/plugins/world/DateMinutes.plugin.js`: varp 3078, minutes since 1970, on login and each new minute; the teleport varps are sent on login.
- `server/data/definitions/minigame-teleports.json`: destinations and requirements per minigame (Wiki). Members-only minigames, skill and combat levels and quests are checked (a quest not implemented yet doesn't block). Requirements the server doesn't track ("visited Keldagrim", "spoken to the Entrance Guardian", NMZ's five quests) are listed as notes. The refusal messages are ours; no capture shows them.
- `ArchiveTypeLoader.getCount()` now returns the highest id + 1 instead of the archive's file count: item ids have gaps, so the last ids (the Minigame Teleport spell items among them) were missed by loops over 0..count.
- `server/tests/minigame-teleports.test.cjs` checks the cast tick by tick, interrupts, the enum mapping against the cache, both cooldown messages and Rat Pits' menu.
