# Quest journal

What the quest list's "Read journal" opens, from rsprox captures of live OSRS (revisions 224-239)
and the rev 241 cache.

## Native quest list (399)

The browser and RuneLite Gateway use the cache's own quest-list scripts (1340/2633),
rows, colours, headings, sorting, filters and scrollbar. A row's child index is the
quest table's `id` column, not its DB row number or position on screen. Both clients
send that same identity to QuestRuntime; there is no custom quest-list packet or
Gateway row-translation layer.

RSProx [4267](https://rsprox.net/download/4267) enables native operations 1–5 on
399:7. The current cache's row range is 0–217; the operation mask is `0x3e`.
View info, Read journal, Show on map and the two Wiki actions use their native
interfaces/scripts. Pin journal's cache label is dormant: live does not enable OP6.
Capture [3072](https://rsprox.net/download/3072) proves OP5 calls script3300 with
`["Search", "", "", "", "<quest>/Quick guide"]`. OP4's plain canonical page name
uses the same Wiki lookup path; that argument is inferred from the native guide
label and Wiki page naming, not independently captured. The browser implements
CS2 OPENURL through its shared HTTP/HTTPS link-opening boundary and preserves the
native new-window flag.

The active revision241 table contains 184 main quests, 20 miniquests and ten RFD
subquests. Native header variables publish maximum343 Quest Points, main completed
6347/total11877, miniquests completed14162, and subquests completed13987. Earned
Quest Points remain the saved gameplay value. Main and miniquest completion counts
read published native state against the cache threshold. RFD publishes its own
opening, rescue and final-battle states/count; a completed legacy parent restores
its native children without granting rewards or changing saved rescue flags.
Capture [339](https://rsprox.net/download/339) confirms the separate ten-subquest
count; its older revision230 totals are not used as current-cache totals.

Native progress publication preserves existing saved gameplay stages. Repairs cover
Between a Rock, Curse of Arrav, Eagles' Peak, Enlightened Journey, Eyes of Glouphrie,
Forgettable Tale, Fremennik Trials, King's Ransom, Legends' Quest, Swan Song,
Underground Pass, Vale Totems, Watchtower, Creature of Fenkenstrain, Dream Mentor,
Mourning's End I, Lost Tribe and Recruitment Drive. Shield of Arrav binds to its
current native quest bitfield while retaining its separate gang/world variables.
Fairytale II correctly remains unstarted through the pre-acceptance stage10 and
starts at its existing acceptance hook20. See [phase evidence](./quests/native-quest-state-a.md)
and the three native-quest-state regression suites for the preserved checkpoints.

### Content and verification limits

The stock list also displays 13 miniquests without registered gameplay journals.
All have cache metadata for map/Wiki actions; five have canonical overview start
text. Eight have no exact start sentence in the existing Wiki journal source or
bounded recording search: Curse of the Empty Lord, The Enchanted Key, The General's
Shadow, Lair of Tarn Razorlor, Mage Arena I, The Frozen Door, Into the Tombs and
The Fractured Archive. Their missing journal/overview content is rejected without
inventing text. The existing start-text generator was rerun in dry-run mode and
reported no change; candidate recordings1702/1694/3344 only contained started or
completed journals, not the missing overviews. This is a content limitation, not a
claim that every OSRS quest journal is implemented.

Native cache-VM tests cover status phases, saved-state/login/bootstrap replay,
NPC/loc transforms, sibling bits, settings and row actions. Live Gateway checks use
the native revision241 protocol client. Checkpoint MCP tests use declared quest
stages; they are not full natural playthroughs of every repaired quest. These checks
do not establish packet-for-packet timing for every intermediate quest transition.

## A quest not started: the overview (782)

Live OSRS opens `questjournal_overview` (782) for a quest the player has not started, not the
journal. The server sends:

1. `varp latest_quest_journal` (3679): the quest's row in the cache quest table (dbtable 0).
2. `if_opensub toplevel:floater -> questjournal_overview` (overlay).
3. `if_settext questjournal_overview:title "<col=7f0000><quest name></col>"`.
4. `if_setevents questjournal_overview:content_inner` slot 1, op 1 ("Show on Map").
5. `script questjournal_overview_setup` (6821) with `[quest row, start sentence,
   universe, content_inner, content_outer, scrollbar, inner, container, scroll, combat level]`.
   The component order is the one rev 235-237 captures send. The last argument is the player's
   combat level, stored in varc 52.

The setup script builds the rest from the quest's cache row: "I can start this quest by "
(or "miniquest"), then the start sentence, then "Show on Map", Difficulty, Length,
Storyline, Release Year, Requirements and Recommendations, coloured against the player's
stats. The only text the server sends is the start sentence, which it gets from:

- `server/plugins/quests/data/quest-start-text.json`, filled by `yarn sync:quest-start-text`
  from the OSRS Wiki's journal transcripts (`Transcript:<quest>/Journal`), plus the sentences
  live captures recorded for quests with no transcript. The Wiki and capture texts are the same
  for every quest that has both;
- otherwise, the quest's own not-started journal line, `I can start this quest by ...`.

"Show on Map" (content_inner slot 1) opens the world map and runs `script3331
[worldmap:map_noclick, startcoord, mapelement]` from the quest's row.

## A quest started or complete: the journal (119)

`questjournal` (119) with `qj_lines`, `quest_journal_reset` (5240), the title, a line per
`questjournal:qj<n>` and script 2523 `[0, line count]`. In the cache, every line widget's text
is black, so live OSRS colours each line itself: navy `<col=000080>` text, with names and places
in `<col=800000>` and then back to `<col=000080>`. Finished steps are `<str>`, and the
completion line is `<col=ff0000>QUEST COMPLETE!`. The runtime adds the navy to each line, so
quest journals write plain text with `<col=800000>...</col>` highlights.
