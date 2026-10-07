# Revenant Caves

`server/plugins/areas/RevenantCaves.plugin.js` handles the ways in and out of the Revenant Caves (the Forinthry Dungeon): the three entrances with the entry fee, the two exits, and the Revenant cave teleport scroll. It is built from live OSRS captures (rsprox):

- scroll teleports, entrances, exits and the Revenant maledictus;
- the scroll's Config option and every entrance;
- paying the fee;
- dying to a revenant;
- dying to another player in the caves.

The OSRS Wiki ("Revenant Caves", "Cavern (Revenant Caves)", "Crevice (Revenant Caves)", "Stairs (Revenant Caves)", "Revenant cave teleport") covers the rules. Every object, item, interface and varbit below is checked against this cache, and every object sits at its tile in the cache's map (`server/tests/revenant-caves.test.cjs`).

## Entrances and exits

| Link | Object | At | Lands at |
|---|---|---|---|
| Level 17 entrance | 31555 Cavern, Enter | 3073, 3654 | 3197, 10056 |
| Level 26 entrance | 40386 Crevice, Jump-Down | 3067, 3740 | 3187, 10127 |
| Level 40 entrance | 31556 Cavern, Enter | 3124, 3831 | 3241, 10233 |
| Southern exit | 31558 Stairs, Climb-up | 3218, 10058 | 3102, 3655 (beside the trapdoor, 3103, 3655) |
| Northern exit | 43868 Stairs, Climb-up | 3244, 10215 | 3124, 3806 (beside the trapdoor, 3122, 3805) |

All entrances are one-way. The trapdoors (31557) have no options.

- **Entering, fee already paid:** on arrival the player faces the entrance and gets "You've already paid the Revenant Entry Fee.". A tick later comes the teleport, with "You enter the cave and scramble over the rubble." (the crevice: "You jump down into the cavern.").
- **Inside the caves:** varbit 5961 (`singleway_plus_indicator`) is 1, and 0 again on leaving.
- **Exits:** on arrival the player faces the stairs. A tick later: "You climb the stairs and exit the cave." and the teleport. There's no animation.
- **The crevice warning,** the first time:
  - `toplevel_mainmodal_open` (2524) `[-1, -1]` and interface 720 open ("Be careful! It doesn't look like there is a way back up…").
  - 720:17 "Let me jump, and don't warn me again!" sets varbit 6506 (`wilderness_cave_mid_warning`) = 1, and the jump follows on the same tick.
  - 720:18 "I don't want to jump down anymore." closes it.

## The entry fee
- **The prompt:** an item box (interface 193, the coins icon 1004) with "You need to pay a 100,000 coins fee to enter the<br>Revenant Cave.<br>This can be taken from your inventory, bank or both.". Then a chat menu "Pay 100,000 coins Entry Fee?" with "Yes." / "Yes, don't ask again." / "No.".
- **Paying from the bank:** "The entry fee was taken from your bank.", and the player enters on the same tick.
- **"Don't ask again":** no varbit changes, so it's kept server-side. Later entries pay without asking.
- **Losing the fee** (Wiki): a death inside the caves (to anything), or to another player anywhere in the Wilderness.
  - A PvP death in the caves sends "You died to another player in the Revenant Cave, you've lost your entry fee." before "Oh dear, you are dead!".
  - The killer gets the 100,000 coins as loot (Wiki; the capture is from the victim's side).
  - A death to a revenant sends no message.
- **Leaving by the stairs keeps the fee** (Wiki).

## Revenant cave teleport (21802)
- **"Config"** (op 6): a chat menu "Select a teleport location" with "Northern entrance." / "Middle entrance." / "Southern entrance.". The choice goes to varbit 20096 (`rev_cave_tele_location`: 0, 1, 2), then an item box (the scroll) shows "Revenant cave teleports will now teleport you to the<br>northern entrance." (or middle, or southern).
- **"Teleport"** (op 4): the sub-options pick an entrance; a left-click uses the Config choice.
  - The chat menu reads "Teleport to deep Wilderness?" (north and middle) or "Teleport to the Wilderness?" (south), with "Yes, teleport me now." / "No, I want to stay here.". `busy` is 1 meanwhile.
  - On "Yes": animation 3864, map graphic 1039 on the player's tile, area sound 200, and one scroll used. Three ticks later the player arrives and `busy` clears.
  - Landing tiles: north 3128, 3832; middle 3074, 3739; south 3080, 3655.
- **Above Wilderness level 20:** the question still shows, and "Yes" gives "A mysterious force blocks your teleport spell!" + "You can't use this teleport after level 20 wilderness.".

## Implementation notes
- **PvP zone:** the caves are a `pvp` zone in `world.json` (x 3136–3271, y 10036–10249). Before this, no underground Wilderness was PvP here. Levels come from `Wilderness.levelAt`.
- **Fee payment:** coins come from the inventory first, then the bank.
- **The scroll's fifth option:** "Config" is the scroll's fifth inventory option, the slot most items use for Drop or Destroy. The server used to drop on any fifth-option click; now the option's name decides (`ItemActionPacketListener.isDropOption`). "Discard" and "Release" still drop, as before.
- **Saved per player:** the fee, "don't ask again", the scroll's Config choice and the crevice warning. The varbits are sent again on login.
- **Not captured, so the wording is ours:**
  - "No." (it just closes);
  - the messages when the inventory pays ("The entry fee was taken from your inventory.") or both pay ("…from your inventory and bank.");
  - the message when the player can't afford it ("You don't have enough coins to pay the entry fee.");
  - the crevice warning's "Don't ask me this again" toggle (720:20), which toggles varbit 6506.
- **Spam filter:** the enter and exit messages are spam-filter messages in OSRS. The server has no filtered message type yet, so they go out as game messages.
- **Follow-ups:**
  - singles-plus combat (the caves act as singles);
  - revenant combat and drops, the Revenant maledictus, and the Bracelet of ethereum (captured: melee when adjacent, Magic projectile 1415, the self-heal graphic 1221, the Maledictus' area attacks);
  - the 2-tick teleport delay in combat;
  - the Wilderness Slayer Cave, which isn't PvP yet either.
