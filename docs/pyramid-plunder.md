# Pyramid Plunder

The minigame lives in `server/plugins/minigames/pyramidplunder/` (one unit per part: entrance,
containers, passages, session, Simon, mural). Room data, loot and fitted success chances are in
its `data/pyramid-plunder.json`, from the OSRS Wiki.

## Captured behaviour

From rsprox captures 545, 549, 552, 1788, 1843 and 1857 (rev 227). They are Leagues V
recordings, so their XP is not used; the lines, animations, sounds, varbits and ticks are. Ticks
count from the click.

- **Messages:** every line is a spam message, except "This door leads to a dead end." and
  "You've already opened this door and it leads to a dead end.", which are game messages.
- **`busy` varbit:** set while a search, pick or push runs, and cleared when it ends.
- **Outer panel:** pulls (`human_pickuptable`) at 0, 1 and 2, synth 1220 at 0 and 2, "You use
  your thieving skills to search the stone panel." at 0, `busy` from 1. At 3 the player is moved,
  with "You find a door! You open it successfully." for the way in (its
  `ntk_outside_doorN_state` set to 2) or "You find a door! You open it." for an abandoned room.
- **Urn search:** `urn_search` and `busy` at 1. At 2, `urn_search_success` and "You successfully
  loot the urn!", or `urn_search_bit`. A loot plays synth 1217 at 4, and at 5 the artefact, the
  urn's `ntk_urnN_state` and `busy` off. A bite lands at 4: the damage, synth 797 and "You've
  been bitten by something moving inside the urn.".
- **Grand Gold Chest:** at 1, `human_pickuptable`, synth 1215, `ntk_golden_chest_state` 1 and the
  artefact. The Pharaoh's sceptre is shown in an item box, "You have found the Pharaoh's
  Sceptre.", as the player is moved out.
- **Sarcophagus:** `busy` at 1. At 2, the first `ntk_tomb_push_loop` with `ntk_sarcophagus_push`
  1 and `busy` off. Then a push every tick until the lid moves: `ntk_tomb_open`, area sound 1218
  (range 5), `ntk_sarcophagus_state` 2 and `busy`. Five ticks later come the artefact,
  `ntk_sarcophagus_state` 1, `ntk_sarcophagus_push` 0 and `busy` off. No chat line.
- **Tomb doors:** a pick plays `human_pickuptable`, synth 87 and the lockpick line. A failure says
  "Your attempt fails." on the same tick. A pick that works also sets `ntk_doorN_state` 1 and area
  sound 54 (range 5), holds `busy` from 1, and at 3 says the door is a dead end or moves the
  player to the next room.
- **Speartrap:** "You carefully try..." at 1, work at 2 and 4 (synth 1220), the result at 6 (synth
  2387), `ntk_trap_active` 0 at 8.
- **Rooms:** `ntk_current_room_level` is the room plus one. Leaving sets it back to 2 and
  `ntk_thieving_required` to 21, and closes the outer panel's door.

## Not captured

Check for Snakes, Charm Snake, the scarab swarm, the mummy, the sarcophagus's Strength
refusal and the sceptre with a full pack keep the wording in `Common.PyramidPlunder.js`.

## From the Wiki

- **Sceptre on a failed push:** the sceptre is rolled whether the sarcophagus opens or not (since
  2023), so every failed push rolls the room's chance too, and finding it ends the run with no
  artefact (https://oldschool.runescape.wiki/w/Sarcophagus_(Pyramid_Plunder)).
- **Scarab trap damage:** the Grand Gold Chest's trap deals 1-4 damage
  (https://oldschool.runescape.wiki/w/Pyramid_Plunder), not a fixed amount.
