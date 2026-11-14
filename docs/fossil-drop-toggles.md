# Fossil drop toggles (Peter)

Peter at the Fossil Island Museum Camp (npc `fossil_panner`, 7772) stops or restarts the
unidentified fossils a player gets on the island. Plugin: `server/plugins/npcs/Peter.plugin.js`.

## Live behaviour (rsprox captures, rec 3040, rev 231)

- **Toggle Fossils** (op3) opens a menu at once: "Toggle rare or normal fossils?" with
  `Rare.` / `Normal.` (ticks 2610, 3696, 3799, 3838, 3889). Peter's one-line answer comes on the
  pick, and the varbit flips on the same tick as that line:
  - `Rare.` while on: `fossil_drop_rare_blocked` (8353) 0 -> 1; while off: 1 -> 0 (tick 3801).
  - `Normal.` while on: `fossil_drop_blocked` (2526) 0 -> 1 (tick 3840); while off: 1 -> 0 (tick 3891).
- **Talk-to** -> "Talk about fossils." -> rare or normal -> "Yes I'm sure.": the varbit flips
  when Peter's confirming line shows, after the player's own "Yes I'm sure." (tick 2634 set,
  tick 2968 cleared). "Actually, I've changed my mind." / "Nevermind" change nothing.

The words are the Wiki transcript page "Peter" (`npc-dialogues.json`); the plugin answers its
"currently toggled on/off" conditions from the player's saved flags.

## What the toggles block

- Rare: the unidentified rare fossil. Normal: the unidentified small, medium and large fossils.
  Numulite is not a fossil drop.
- Fossil sources ask `fossil-island:fossil-drop` (`{ player, itemId, blocked }`) before giving
  one. Today that is the drift net roll (`skills/hunter/DriftNets.Hunter.js`) and the Volcanic
  Mine boulder side find (`minigames/volcanicmine/Boulder.VolcanicMine.js`).
- Ours: a blocked roll gives nothing in its place; no capture shows a blocked roll.
