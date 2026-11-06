# 2026 Easter event: The brave chocolate egg

`plugins/world/EasterEvents.plugin.js` runs the [2026 Easter event](https://oldschool.runescape.wiki/w/2026_Easter_event):
find the Easter Bunny's runaway chocolate egg, Archibald, around Varrock. It is the most recent
Easter event, and the only one whose scenery, items and varbits are all still live in the active
rev241 cache. The 2025 event would need an instanced Rabbit Hole, three cutscenes and about ten
NPCs that the current cache no longer has.

## Window

The scheduler's `easter-2026` entry in `plugins/world/data/events.json` covers the Wiki dates,
25 March to 23 April 2026 (UTC midnight to midnight; the Wiki gives dates, not update times).
`::forceevent easter-2026 on` opens it for testing. Closing the window, `::forceevent easter-2026 off`
and server shutdown all restore the world exactly. Progress is kept, so a reopened window resumes it.

## Sources

| What | Source |
| --- | --- |
| Steps, rewards, locations, the LOWE code | Wiki: 2026 Easter event, Scribbled notes, Egg box, Archibald, Event rewards#Easter |
| Every line, choice and condition | osrsreboxed-db `2026 Easter event` transcript (Wiki Transcript:2026 Easter event), imported into `data/definitions/event-dialogues.json` |
| Easter Bunny spawn 3159,3458,0 facing east | RSProx rev237 recordings 03988-04042 (`npc_info` adds `easter26_easter_bunny`) |
| Retired NPCs, the lock dataset, original map placements | Event-active cache 2509 (1 April 2026, rev237) and osrs-dumps `9b30ba07` |

`node scripts/import-seasonal-definitions.cjs --event easter-2026 --reference <holiday-cache-2026-04-01> --output plugins/world/seasonal/data/easter-2026-archive.json`
regenerates the archive (`--check` verifies it). The reference folder holds the dumps and the cache
2509 groups listed in its `SOURCE.json` manifests, each verified by size and SHA-256, then by the
pinned reference-table CRCs. The importer asserts:

- the four NPCs whose ids were reused after the event (the Bunny, the vault Archibald and its
  catchable form, the church-cutscene Archibald) and nothing else;
- every 2026 Easter loc and obj is still the live definition at its id. All eleven items were retuned
  after the event; the archive records their CRCs and the live definitions stay authoritative;
- the 2026 varbit layouts, the archived NPCs' animations and models are unchanged in rev241;
- the lock row `combination_lock_dataset_alphabetic_easter26` uses dial rows 4, 2, 1, 3, which are
  still live and spell LOWE;
- 51 original placements: the eight hunt scenery swaps plus the start set-piece of 2023 Easter
  decorations south of the Grand Exchange. Each records the ordinary map rows it replaced (same
  tile and loc slot). Unrelated later map edits in those squares are left alone.

## Behaviour

- Progress is one saved integer (`easter-events:2026-progress`): notes found, whether the latest is
  read, which egg box is held, caught and complete. The step numbering is server-side; only the
  native `easter26_hunt_loc1..8` and `easter26_first_clue_picked` varbits reach the client, and
  they decide which scenery holds Archibald for that player.
- Each hunt search plays only while Archibald is at that location for the player, and needs both
  hands free and a free inventory slot, as the transcript's conditions say. Reading the notes shows
  the current hint; the Bunny's hint lines depend on whether it has been read.
- An egg box or the runaway egg that is no longer held anywhere (destroyed, incinerated or
  otherwise lost) sends the player back to the place it was found, as the items' Destroy text
  says; lost scribbled notes come back from the Bunny.
- The locked egg box opens the native combination lock (809) over the archived dataset, sent as a
  client DB row override under virtual row 144392. A league character's client keeps one override
  set, so there the row joins the Leagues payload (`league:content-rows`). A wrong code gives the
  transcript's chat line, "That didn't seem to work."
- Completion needs room for Archibald, plus the two noted Easter eggs at 25 hours of play
  (`player:lifetime-seconds`). Without room the transcript's line says how many slots are missing
  and nothing changes. Completion hands over the runaway egg, unlocks every Easter reward from
  2013-2026 at Diango (`holiday-rewards:unlock`), and opens the event scroll after the closing line.

## Known gaps

- The vault Archibald's tile (3191,9827,0) is inferred: no recording or coordinate source places
  him, and the Wiki says only that he sits next to the vault gate.
- The church wall "cutscene" plays the archived Archibald's fall animation for the searching player.
  The Wiki's camera shot is not reproduced, for lack of a source for its camera or timing.
- The event scroll's title and reward lines follow the Wiki's reward list; the scroll's exact
  wording and any completion jingle are not captured.
- Archibald's own item options (Interact, Paint, menagerie and toy box storage) belong to holiday
  reward item behaviour, not this event.
