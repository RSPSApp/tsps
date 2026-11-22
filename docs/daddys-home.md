# Daddy's Home

Daddy's Home has been a 1 Quest Point quest since 3 November 2026; before that it was a miniquest. The plugin is
`server/plugins/quests/quests/DaddysHome.Quest.js`, and Yarlo's Construction lecture is
`server/plugins/quests/daddyshome/Lecture.DaddysHome.js`, which plays `server/plugins/quests/data/daddys-home-lecture.json`.

## Sources

- **rsprox capture DaddysHome** (rev 242.1, the user's own recording): the whole quest as a quest, from Marlo's start to
  the crate, and Yarlo's lecture twice (ticks 1583-1766 in the quest, 2235-2366 after it). Tick numbers below are this
  recording's.
- **rsprox.net index**, for what the capture doesn't play (all from before the conversion): 1702 (rev 226), 1723 and
  local 1000152, 1000176 (rev 227), 3218 and 3220 (rev 232), local 1001562 (rev 241).
- **OSRS Wiki**: the quest page, its transcript and the furniture pages. The transcript predates the quest conversion
  and says so. Where it and the capture differ, the capture is followed (the user's call for this quest); the
  differences are listed below.

## Stages (daddyshome_status, varbit 10570)

| Value | Set when | Capture |
| --- | --- | --- |
| 1 | Yes on "Start the Daddy's Home quest?", with Marlo's "Fabulous! ..." and the start message | tick 1460 |
| 2 | Yarlo's "My boy Marlo sent you? ...", with all seven furniture varbits set to 1 | tick 1525 |
| 3 | The player's "I've finished removing all the old furniture." (not the last removal) | tick 1578 |
| 4 | Yarlo's "Now, I was just getting round to telling you ..." after the lecture or the skip | tick 1767 |
| 5 | The "You'll have to take three logs from the crate to the sawmill ..." box | tick 1773 |
| 6 | The sawmill operator makes the waxwood planks | tick 2007 |
| 10 | Yarlo's "That's everything! ..." once all seven pieces are built | tick 2080 |
| 11 | Marlo's "That's wonderful news! ..." | tick 2147 |
| 13 | Past Marlo's last reward line: complete, the scroll, 400 Construction XP, 1,000 coins (house owner) and the crate | tick 2158 |
| 14 | Marlo's crate opened | tick 2181 |

Values 7-9 and 12 are never sent. A save from before this change may hold 9 (everything built), which plays as 6, or 13
with the old `daddys-home:crate-opened` flag, which login moves to 14.

## What the capture fixes

- **Marlo** greets a Mahogany Homes contractor with "Hello - it's lovely to see a Mahogany Homes contractor on their
  rounds! ..." and offers "What's my current construction contract?" (answered by Mahogany Homes through
  `mahogany-homes:contract`). Before joining, he greets with "Welcome to the Varrock branch of Mahogany Homes, ..."
  and offers "Tell me about working for Mahogany Homes." (local 1001562, rev 241). The favour's menu comes back without
  the question just asked (ticks 1426, 1430). "Tell me more about the job." ends in "Start the Daddy's Home quest?"
  Yes/No; Yes has the player say "Tell me where he lives, and I'll do the job." and No "I'd rather not." (ticks 1444-1460).
- **Removal** (ticks 1529-1572): on arrival `human_throw_away` with delay 10 and `demolish_1` or `demolish_2` with delay
  20, then the hotspot a tick later. There is no chat message, and the last removal doesn't move the stage.
- **Before the briefing**, Build says "You should get Yarlo to tell you about the furniture he wants, before you try
  building any." (tick 1537).
- **Yarlo after the removal** adds "You see, I used to be a carpenter myself, ..." and, for a house owner, the player's
  "Is this necessary? I've got a house of my own, in Rimmington, and I've been learning about Construction for a while."
  The town is the house's own (Rellekka in 1702), from Construction's `construction:owns-house` answer.
- **The briefing** uses item boxes: planks and bronze nails, cloth, waxwood logs, then logs and plank (ticks 1769-1773).
- **The lecture** is described below.
- **The building help menu** opens with the player's "I've been working on your furniture.", then comes back after each
  answer without that option. "Look on your World Map to find the sawmill." is graphicbox 633 with graphic 1698 at
  32 x 32 (tick 1791). "How do I build furniture?" shows its tip beside `placeholder_beta_elder_wand` (tick 1784).
- **Building** (ticks 1832-2076): Build opens `poh_furniture_creation` with one entry. It sends script 7988 with
  (1, the piece's obj, 1, "name|materials", whether it can be built), then 1406 (1, 0), and `chatdefault_restoreinput`
  once the menu closes. A pick without the materials shows "You don't have the right materials:<br>" with each
  material and the missing ones in red, as Construction does (tick 1895). Without the tools, Build shows the saw and
  hammer box "You need a saw and hammer in order to make furniture." (local 1000152 tick 2742). The pick plays
  `human_poh_build` (the carpet too) and `poh_build_wood`. Then comes one nail a tick ("You use a nail.", spam), with
  the animation after each nail but the last and the sound on every second. The last nail takes the planks, and the
  piece and its XP come a tick after. A piece without nails takes its materials on the pick. Running out of nails says
  "You don't have enough nails left." (local 1000152 tick 3331). XP: stool 29, chair 57, table 86, bed 207, carpet 45
  (539 in all).
- **The crate** gives three logs with the item box "The crate contains that water-repellent waxwood ..." (tick 1890).
  With too little room it shows the two-item box "... He said you'd need three planks, so you'll need some more
  inventory space." (1723 tick 11752). Once no more waxwood is needed it says "You won't need any more waxwood for Old
  Man Yarlo's furniture." (3218, status 14).
- **The Varrock sawmill operator** keeps its own menu ("Hello there. ...") and, at status 5 only, has "I need some
  waxwood planks for Old Man Yarlo." third (ticks 1971, 2012). The option is added through `npc-dialogue:menu`.
  There is no chat message for the planks.
- **The reward**: the player opens with "I've finished building the new furniture for your dad." Talking again at
  status 11 gives "I haven't forgotten that I promised to pay you for your help. Is this a good time for that?" The
  second reward line ends "Hope you find it all useful." The scroll reads 1 Quest Point, 400 Construction XP,
  1,000 Coins and A crate of supplies (tick 2158). Without a house, Marlo's three lines are rev 227's (local 1000176),
  and the scroll's house line is the Wiki's ("A house in Rimmington").
- **Marlo's crate** gives status 14, `found_gem` and the box "You find a variety of useful Construction supplies."
  with 25 noted planks, 50 mithril nails, 5 noted steel bars, 10 noted oak planks, 8 noted bolts of cloth, 5 house
  tablets and 1 Falador tablet (tick 2181).
- **After the quest** Marlo says "Thanks again for helping my dad. ..." and offers the contract (or "So can I do some
  more building for you?" before joining, 3220) and "Great. I'll leave you to it.". Yarlo offers "Tell me about more
  things I can do with Construction." first: the lecture again, then the player's "Thank you!" (tick 2367).
- **The journal** at status 5 and 10 is the capture's: what is done struck through, the current step in dark blue
  with its names in red.

## The lecture

`daddys-home-lecture.json` was built from the capture with RSProx's instanced-coordinate translation off. The filler
chunk repeats a hundred times, so the translated tiles can't place the camera or the player. Its tiles are offsets
from each copy's south-west corner.

- **Copies**: live rebuilds the map three times (ticks 1585, 1645, 1706). The copies are 10 x 10 (the last 10 x 11)
  chunks of a filler chunk (1848,5696 or 1848,5728), with the rooms at their slots: chunks 1800,5696 and 1800,5704 (both
  planes of the second) at slots 5,4 and 5,5; then six chunks around 1800,5696; then eight around 1800,5728. Each is a
  `QuestScenes` layout copy, and `QuestScenes.swap` replaces one copy with the next without ending the scene. The player
  stands at offset 30,32 (30,36 in the last copy).
- **Steps**: a step starts on the player's continue (the first on "Listen to Yarlo."). The box is empty, the line shows
  `show` ticks later without "Click here to continue", and gains it `continue` ticks in. The step's events (builders
  and their walks, animations and transforms, locs, camera moves, sounds, music, fades, the rebuilds) run at their
  tick from the step's start. They don't wait for a click: the quick and the slow run in the capture differ only where
  the player clicked.
- **The way out**: the last continue fades out, the real map comes back two ticks later on the tile the player stood
  on, and the controls, tabs, camera and fade-in three ticks after that (ticks 1761-1766). The briefing (or "Thank
  you!") follows a tick later.
- **Interrupted** by a logout, a death or a forced move out, the copy goes, the player is back at the start tile and
  the quest stays at status 3 (Wiki: "If you interrupt the cutscene you will have to rewatch it."). A save taken inside
  the copy reloads at the start tile.

## Recorded differences from the Wiki

The capture is followed here, by the user's decision for this quest:

- The Wiki's "Tell me where he lives, and I'll do the job." option is now the "Start the Daddy's Home quest?" prompt.
- Marlo's second reward line: Wiki "... Now, let me tell you some tricks of the trade too...", capture "... Hope you
  find it all useful.". The Wiki's "Marlo rewards you with ..." box is the quest scroll now.
- The crate: Wiki "water-repellant", capture "water-repellent".
- The Varrock operator: the Wiki's "sawmill operator at the Lumberyard" has no "Hello there." and lists the waxwood
  line first; the capture greets with "Hello there." and lists it third. That matches the Wiki's "any other sawmill
  operator" section.
- XP: the Wiki's furniture pages give stool 30, table 87 and chair 58; the capture's drops are 29, 86 and 57.
- "I need some tools." with both tools: the Wiki has no player line; the capture has it.

## Not covered (ours)

- **Lost waxwood**: until the bed is built, the crate gives logs again and the Varrock operator offers the waxwood line
  again to a player at status 6 without the planks. No recording loses them; without this, destroyed planks
  (their only option is Destroy) left the quest impossible to finish.
- **A save between the materials and the build**: the tick the last nail takes the materials, the save already holds the
  piece built and its XP owed (`daddys-home:pending-xp`). The tick after pays it with the varbit, as captured; the first
  tick after a login pays what a restart left owed, once.
- **An interrupted build**: once the last nail (or a nail-less piece's pick) has taken the materials, the piece is built
  and its XP given even if a click, a walk or a logout interrupts the tick before. Without this, the materials were
  lost, which the in-game check found. What live does in that tick isn't recorded.
- **Nail bending** is real ("You accidentally bend a nail.", spam, 194 times in the index), but no source gives its
  rate, so the rate here is ours.
- **Lines with no source**: Marlo's answer to "Tell me about working for Mahogany Homes." (the Wiki's answer to "What
  does this Mahogany Homes company do?"), "Maybe another time." before joining at status 1-9, the answer to "So can I
  do some more building for you?" (Mahogany Homes' own), the sawmill without the three logs, the crate before the
  briefing, Yarlo's tools with a full inventory, "You have already opened Marlo's crate.", and the free-slot refusal for
  the crate.
- **The no-house completion's scroll** in rev 242 isn't captured. The other sawmill operators' refusal (Wiki) isn't
  implemented.
- **The lecture** doesn't send `hidelocops` (the server has no encoder for it yet), the orbs and XP-drops remounts, or
  `cam_shake` resets. The "Is this necessary?" line needs Construction's house.
- **The journal** at stages 1-4, 6 and 11 extends the captured pattern; only stages 5 and 10 are captured.

## Tests

```sh
cd server
node --test --test-concurrency=1 tests/daddys-home.test.cjs
node --test --test-concurrency=1 tests/quest-scene-return-state.test.cjs
```

Both use a real Player, session and connection, the real plugins and map, and real packets (Talk-to, object options,
continues, the build menu's pick, the crate's Open). Stages are seeded checkpoints. A disk save is the real PlayerSave
and JSON codec round trip.
