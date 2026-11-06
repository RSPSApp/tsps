# 2025 Halloween event (Spook-a-thon) sources

`plugins/world/HalloweenEvents.plugin.js` runs the 2025 Halloween event, the
Spook-a-thon Decoration Contest, while `EventScheduler` announces the
`halloween-2025` window (`plugins/world/data/events.json`). Staff force it with
`::forceevent halloween-2025 on|off|auto`.

## Why this event

The 2025 event is the most recent Halloween event with complete sources: its
full transcript is already in `data/definitions/event-dialogues.json`
("2025 Halloween event"), the active cache still holds its items, scenery and
`hw25_*` varbits, and a cache from inside the event window is archived. The
2026 event has no transcript in the dialogue catalogue yet.

## Archived definitions

`scripts/import-halloween-definitions.cjs` builds
`plugins/world/seasonal/data/halloween-2025-archive.json` from a separate
reference directory, reusing the helpers of `import-seasonal-definitions.cjs`.

- **Cache:** Jagex revision 235 from 29 October 2025,
  [OpenRS2 cache 2341](https://archive.openrs2.org/caches/runescape/2341), inside
  the event window (15 October to 5 November 2025). Symbols come from
  Joshua-F/osrs-dumps commit `66c30c57851c09422bad2b87848a2aa72a142926`.
- **Reference layout:** `SOURCE.json` with `dump.npc/loc/obj/varbit/seq`, and
  `archives/SOURCE.json` listing `255-2`, `255-5`, `255-7`, `2-6`, `2-9`, `2-10`,
  `2-12`, `2-14`, `keys.json` and the map groups for `l49_51` and `l50_51`. Every
  file's size and SHA256 are verified, then the reference-table CRCs.
- **Bundle:** the eight event NPCs whose ids were reused after the event
  (event, Seth and cutscene chairs, the two stray dogs, the cutscene Death,
  Seth and Fred), and the three event-only decorations that the active cache
  retired to `Null` (spooky picture, wall lamp and scarecrow, restored at their
  own ids 31222-31224).
- **Live definitions:** the reward items, the reward chair follower, every
  scenery loc and the 12 `hw25_*` varbit layouts are checked against the active
  cache instead of archived. Locs are compared as decoded types, since rev241
  re-encodes unchanged rev235 definitions. Changed animations are recorded,
  not archived; no referenced model changed.
- **Scene:** the event map's seasonal placements at Fred's farm and Groats'
  farm (the four `hw25_*` decorations, reused `hw22_*` dressing, autumn leaves
  and the holiday map icon), and the 16 current objects the event map lacked on
  those tiles, which are removed while the scene shows. Unrelated later map
  edits in the same squares are left alone.

```powershell
node scripts/import-halloween-definitions.cjs --reference <reference-folder> --output plugins/world/seasonal/data/halloween-2025-archive.json --check
```

## Behaviour sources

- **Steps, wording, conditions:** the transcript, played as exported. Its two
  "above" jumps (Diango's second visit, Fred's "I'm ready for the judgement!")
  and Seth's lost-picture branch are resolved in osrsreboxed-db (navigation
  anchors and a reviewed correction, RSPSApp/osrsreboxed-db#46) and imported from
  its `master` at `bb8d4d39`. Fred, Seth, Sarah, Death and
  Diango keep their ordinary Talk-to when the event is off or when the player
  answers "No." to the event question.
- **Rewards:** Wiki 2025 Halloween event. Grim reaper top, bottoms and gloves,
  Spooky chair, Spooky pumpkin lantern, 2 noted pumpkins and 2 of each noted
  halloween mask. The tradeable items need 24 hours of play time
  (`player:lifetime-seconds`); a younger account claims them from Fred later.
  Diango unlocks every earlier Halloween reward (Wiki Event rewards, Halloween
  section) when he first discusses the lantern, and the 2025 rewards at
  completion.
- **Halloween items for the contest:** the Wiki gives the rule (three worn
  Halloween items, the lantern held separately) and one exclusion: 2024
  cosmetics do not count. The set is every earlier Halloween reward Diango
  returns except the 2024 ones, the original halloween masks and the 2025
  outfit.
- **Spooky chairs:** the 14 Draynor Manor tiles are the Wiki's location list.
  rsprox recordings 234/00831, 234/03275 and 234/03280 show the same number of
  chairs wandering those rooms. The dropped reward chair follows for 20 ticks
  (Wiki Spooky chair). Spin plays one of the cache's five
  `hw25_chair_spin` synths.
- **Cow pen:** the dance emotes are the emotes whose sequence is a dance
  (Dance, Jig, Spin, Headbang, Zombie Dance, Smooth and Crazy dance, Crab
  dance). The pen bounds come from the cow spawns north of Sarah's house.

## Known limits

- No recording covers Fred, Seth, Sarah, Death or the judging. The cutscene
  actors' positions, the camera framing and the event-complete scroll's model
  are provisional. Death's "puff of smoke" exit (a Wiki image caption only) is
  not shown.
- The Wiki says the event's costume override turned every stray dog into a
  bat; the archived dog definitions are installed but not substituted for the
  world's stray dogs.
- A wrong quiz answer follows NpcDialogues' shared reading of the transcript's
  "previous options": Death's event question is asked again and the quiz
  restarts from its first question. Answered questions stay recorded.
- The dropped chair does not check the Wiki's no-follower areas, and Spin has
  no player animation (none is sourced).
- The three decorations are restored only while the archive is installed; a
  picture, lamp or scarecrow kept past the window shows as the cache's retired
  item until the next window (as the Christmas serving platter does).
- A decoration or lantern counts as lost when it is not in the inventory,
  equipment or bank. Items in a gravestone, Death's coffer or a looting bag are
  not counted, so one lost on death can be replaced and later recovered.
- The modules follow the Christmas dinner's layout (`seasonal/*.HalloweenEvents.js`,
  data in `seasonal/data/`), not a folder named after the plugin.
- Scape Scared plays on the login screen during Halloween events only; it has
  no in-game unlock, so the event changes no music.
