# 25th Anniversary event (2026 birthday) native source extraction

The 25th Anniversary event, "25 Years, 25 Mementos", ran from 18 February to
4 March 2026 and was also Old School's 13th birthday. It is the most recent birthday
or anniversary event and has a full Wiki transcript, which main already ships in
`data/definitions/event-dialogues.json`. No rsprox recording covers the activity:
revisions 235-237 hold only the login message about the anniversary, so the Wiki
and the cache are the sources.

`scripts/import-anniversary-definitions.cjs` builds
`plugins/world/seasonal/data/anniversary-2026-archive.json` from a separately
retained reference. The active cache and the pinned rev241 dump are never modified.

Build the server, then run from `server/`:

```powershell
node scripts/import-anniversary-definitions.cjs --reference <reference-folder> --output plugins/world/seasonal/data/anniversary-2026-archive.json
node scripts/import-anniversary-definitions.cjs --reference <reference-folder> --output plugins/world/seasonal/data/anniversary-2026-archive.json --check
```

## Reference layout

- [openrs2 cache 2468](https://archive.openrs2.org/caches/runescape/2468): the rev236
  live cache of 25 February 2026, the middle of the event window. The reference keeps
  its `disk.zip` contents under `full/cache/` and its `keys.json` under `full/`.
- Joshua-F/osrs-dumps commit `7d9e9efe62d91d32345a0ccb0c4da396ea329f8e`
  (`2026-02-25-rev236`): `dump.npc`, `dump.loc`, `dump.obj`, `dump.varbit`, `dump.seq`.
- `SOURCE.json` records the byte length and SHA-256 of each dump, `keys.json`, the
  data file and every index the importer reads. The importer verifies all of them
  before decoding anything.

## What the archive holds

- **Definitions:** the event's 24 usable NPCs and 134 locs, plus BigRedJapan's
  event-era definitions. In rev236 his NPC is a multinpc on `25th_progress`, and only
  values 5-9 give him Talk-to. The bundle also carries three animations:
  `25th_portal_swirl` and the two spotlight pulses. Rev241 reuses their ids for
  Leagues VI and transmutation effects, but their frame groups are byte-identical, so
  the definitions alone restore them (see `ArchivedDefinitionRegistry`'s `seq` kind).
  Every model an archived definition uses is byte-identical in rev241. The one
  exception is BigRedJapan's own model 3189, which his live definition also uses; it
  is recorded as a retained current asset.
- **Placements:** every event-window loc in live map squares. That covers the ritual
  grid and ladder in Varrock, the Party Room tables and the yellow 2026 cake, and the
  bunting, banners, balloons and confetti in Varrock, Falador, Lumbridge, Ardougne and
  the Grand Exchange. A placement is kept unless the same id already stands in the
  same place in rev241.
- **Realm of Memories:** map squares 28_96, 28_97, 29_96 and 29_97 on plane 2. They
  are blank in rev241, so their terrain and all 4,299 locs return as a runtime region
  replacement while the window is open.
- **Varbits:** all 28 `25th_` varbits have the same layout in rev241.

## Excluded, with the reason

- **Old-model Realm creatures and Big Mo:** the dragons, demons, scorpions, orc,
  lizard man, troll, cave bugs, Kalphite Queen, giants and goblin. Rev241 recycled
  their models and frame groups for unrelated content. Definitions cannot bring those
  bytes back, so they are left out rather than drawn with the wrong assets. Restoring
  them needs archived models and frames on the client.
- **The Realm's other residents:** the gnome child, Thrander, Chuck, Pious Pete, the
  gods and the cheerleaders. Their definitions are archived, but no source records
  where they stood (the Wiki gives "map = No"), so they are not spawned.
- **Post-event residents:** Wizard Gary (15634) and Sookie (15589) still stand in the
  house in rev241 after the event. They are permanent world spawns, and the generated
  `npc-spawns.json` lacks them, so they belong in the osrsreboxed-db spawn source.

## Gameplay decisions and what they rest on

- **Window:** `events.json` `anniversary-2026`, from the release cache's timestamp
  (2026-02-18T11:45:07Z) to the removal cache's (2026-03-04T11:45:06Z).
  `::forceevent anniversary-2026 on` runs it off-calendar.
- **Progress values:** `25th_progress` uses the ranges the cache's multinpcs fix:
  collecting is 5-9 (BigRedJapan), Gary waits upstairs at 10-24, the portal shows at
  21-30, Grayzag appears at 25-26 and Wizard Gary at 27-30. Values inside a range
  follow this server's phase order.
- **Memento order:** the Wiki allows any order. The transcript's "Where do we need to
  go?" lines walk a fixed route, so Gary names the first stop still missing.
- **Positions:** Gary's spot, the Realm Gary and both portals come from Wiki map
  pins. No source records the hat's tile beside Gary, the Thief's tile outside
  Aubury's shop, Grayzag's tile in the Realm or the arrival tile, so those are noted
  in `Data.BirthdayAnniversary.js`.
- **No cutscene:** no capture records the portal-opening cutscene or the full-screen
  flashing effects, so the portal simply opens at that transcript step.
- **Missing lines:** the transcript lacks the general store keeper's own lines, so
  those steps are skipped.
- **Rewards:** the helmet, both tabards, the 5x5 hat and two noted half full wine jugs
  are given once per account, all or nothing. Wizard Gary keeps them if the inventory
  is full. The hand-out unlocks the four cosmetics in Diango's catalogue (enum 708, slots
  223-226). A player who finished but never had room gets that unlock when the window closes
  (or at their next login after it), and the reward is then settled so a later window cannot
  give a second set.
- **Slice of birthday cake:** Take gives one. During the event it heals 3. Afterwards,
  eating one deletes every slice with the Wiki's message.
