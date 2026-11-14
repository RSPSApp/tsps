---
quest: The Frozen Door
key: the_frozen_door
status: in-progress
tested:
tester: agent
model: claude-sonnet-5-5
commit:
cache: osrs-242_2026-11-03
start: fresh
travel: travel_to
---

# The Frozen Door

Implemented from the OSRS Wiki raw wikitext, the generated messenger conversations, the revision 242 cache and two RSProx captures (801 and 806, revision 234). Not yet played in a
client; `server/tests/frozen-door.test.cjs` drives every part through the real dispatchers and the real transcript player.

## Sources

| Page / evidence | sha256 (first 16) or id |
| --- | --- |
| [The Frozen Door](https://oldschool.runescape.wiki/w/The_Frozen_Door) raw wikitext (fetched 2026-11-14) | `ed934dd3556cf699` |
| [Transcript:The Frozen Door](https://oldschool.runescape.wiki/w/Transcript:The_Frozen_Door) raw wikitext | `f22e3c465e5b46bb` |
| [Transcript:Important letter](https://oldschool.runescape.wiki/w/Transcript:Important_letter) raw wikitext | `3dca954e66cca3d0` |
| Messenger (The Frozen Door), Important letter, Ashuelot Reis, Frozen key (The Frozen Door) pages, raw wikitext | `bc71b6bd11313408`, `829299150ade697e`, `52070944fee825c5`, `4e020d6c035a03f7` |
| Generated `npc-dialogues.json` page "Messenger (The Frozen Door)" (five variants) | untouched, used as is |
| RSProx capture 801 (revision 234, 2025-10-19, 2.61 MB; download sha256 `dc17c61919d23323`) | assemble box, unlock message, Ashuelot's first conversation, the journal at the key stage, 11295 and varbit 13182 |
| RSProx capture 806 (revision 234, 2025-10-19, 1.70 MB; `7e7394245b1f0a70`) | Ashuelot's safe-room conversation, "I should probably talk to Ashuelot first." |

## Cache facts used (revision 242, probes run on HF)

- Quest-table id 165 (not 164: that is A Kingdom Divided), members, no quest points, end state 10, requires row 27 = Desert Treasure I; 70 Agility, Hitpoints, Ranged and Strength are listed there too
  but the Wiki marks them "Questreqstart: No", so the letter is gated on Desert Treasure I only.
- Varbits (all in varp 3264): `frozen_door` 13175 (bits 0-5, the stage), `frozen_door_armadyl/bandos/zamorak/saradomin_piece` 13176-13179, `nex_message_destroyed` 13181 (three bits), `nex_story_npc` 13182 (two bits).
- NPCs: `nex_messenger` 11287 (no options, not a multi-NPC), `nex_story_npc_1op` 11288 (Talk-to), `nex_story_npc_3op` 11289 (Talk-to, Bank, Collect), and the multi-NPCs on varbit 13182:
  `nex_story_npc_outer` 11295 (11288 at 0, hidden otherwise) and `nex_story_npc_inner` 11296 (11288 at 1, 11289 at 2, hidden otherwise). Items: `nex_message` 26366, `nex_frozen_key` 26356,
  `nex_frozen_key_armadyl/bandos/zamorak/saradomin` 26358/26360/26362/26364. All looked up by name; the test checks the ids.
- The cache names no stage values between started and complete: **1** = letter read, **2** = key assembled, **3** = door unsealed (speak to Ashuelot), **10** = complete. Our choice.

## What it does

- **Letter and messenger.** After Desert Treasure I a messenger (11287, visible only to the player) appears beside the player and speaks at once, as he has no option to click; the generated first-delivery
  conversation plays and the Important letter is added. Reading the letter shows the Wiki's text and starts the miniquest when the reader closes it. Destroying it unread (varbit 13181 counts, 1 to 4 and up)
  brings him back with the Wiki's matching conversation; after it is read nothing more is delivered ("won't be able to reobtain it").
- **Key pieces** drop only while the miniquest is started and not complete (`NpcDrops.plugin.js` `QUEST_REQUIREMENT_BY_ITEM` plus this plugin's `npc-drops:quest-item` answer). This changes the generated drops'
  behaviour: the four pieces used to drop for everyone (the dump has only the note "only dropped during The Frozen Door miniquest", no typed requirement). The "deal the most damage" rule is not modelled.
- **Key and door** (Nex plugin, `Prison.Nex.js`): the assemble and stuck-door boxes and the unlock message are now the Wiki's and the capture's words; both events are announced to this plugin, which moves the
  stages and the piece flags.
- **Ashuelot Reis** (`frozen-door.json`, transcribed from the Transcript): first conversation at the entry room (21 lines, "departs for the inner section", the quest completes), "I can't let you go in there."
  at the outer prison door until then, the safe-room conversation (intro, then Tell me more about Nex / bank / collect / I need to go; bank and collect use the existing bank and collection-box handlers), and the
  banking form (11289) after the intro.
- Journal: the capture's text for the key stage, ours for the rest.

## Findings, approximations and what is not done

- **guard** The messenger comes only when the player is on dry land (Fossil Island's sea floor; the Wiki: "will no longer appear underwater"), not in a conversation, an open interface, a fight, an instance or a book, and with a free backpack slot; otherwise he is tried again 40-120 ticks later. The letter counts as held only once it is in the backpack, and a login clears the flag if the letter is in neither the backpack nor the bank (so a lost letter brings another).
- **legacy** A player who unsealed the door before this quest existed gets no letter and is set to the door's stage at login; Ashuelot completes the quest for them from any stage.

- **approximation** The messenger's timing has no Wiki or capture source ("appears randomly near the player"): he comes 100-400 ticks after a login (30-120 after finishing Desert Treasure I, 20-60 after a letter
  is destroyed), at most one at a time, leaves after the delivery or 150 ticks, and the letter is recorded as held so relogging never brings a second. The capture has no messenger text.
- **approximation** The letter opens in the book interface (the capture has no letter); the "started" chat message is the one other miniquests use.
- **approximation** Stages 1-3 and the journal text outside the key stage; piece flags (13176-13179) update at login, when the key is assembled and when the journal is built, not when a piece is picked up.
- **approximation** The Nex story branch ("other" on the Wiki) ends the conversation; the first safe-room visit plays the intro and later visits go straight to the menu (the Wiki does not say).
- **approximation** The outer Ashuelot (11295) stands at (2855, 5226), beside the door's arrival tile; the captures were not decoded for positions. The safe-room one (11296) keeps the old tile (2904, 5205).
- **fixed** The Nex plugin's Assemble hooks used lower-case piece names (`Frozen key piece (armadyl)`) from `nex.json`, which never matched the cache's `Frozen key piece (Armadyl)`: item actions match the name exactly, so Assemble did nothing in game (found by the in-game run). `keyPieceNames` in `nex.json` now carries the cache's spelling.
- **changed** The fixed 11289 spawn is replaced by the multi-NPCs 11295/11296 in `npc-spawns.json`.
- **not done** The barrier check "I should probably talk to Ashuelot first." (capture 806) lives in `Chamber.Nex.js`, which another open pull request edits; the "most damage" rule; the completion scroll text
  of a miniquest; the Wiki's League region note; in-client rendering of the letter and the quest list.

## Runs

HF jobs (see the pull request for ids and heads): the quest test passes and fails on the failing-first commit; the Nex, God Wars, drop, spawn and quest regression files equal the base; the in-game harness over the agent MCP
covers the messenger's first delivery, reading the letter, the pieces and the key, the door, Ashuelot's first and safe-room conversations and relogs. Not played in a client.
