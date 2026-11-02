---
quest: Cook's Assistant
key: cooks_assistant
status: passed
tested: 2026-11-01
tester: agent
model: claude-opus-5-5
commit: b7fb0e92d
cache: osrs-241_2026-10-20
start: fresh
travel: travel_to
---

# Cook's Assistant

A fresh account completed the quest by the normal route, travelling only with `travel_to`
after being placed in the kitchen, and the conversation matches rsprox capture 1718 box for box.
Repeat talk and relog hold. The "Where do I find..." branches have no capture and weren't played.

## Findings

- **open** Chat text wraps at a fixed character count rather than where live breaks its lines
  (shared `Misc.wrapText`), and the chat quest link is always `081190` where 1718 sent `0ab0ff`.
- **fixed** Against rsprox 1718 (rev 227) and 4156 (rev 238): the completed journal's wording, the
  missing "You've started a new quest" line, chat-head animations, completion jingle 152, and the
  ingredients leaving the inventory on continuing past the hand-over box.
- **fixed** Against the Wiki transcript only (no capture): the "You still need to get" message box.

## Capture audit

Rsprox 1718, ticks 7072-7095, carries the start and the all-ingredients hand-in in one conversation.
The live run on this server matches it box for box: speakers, text, options, item box objects 1933
and 1927, varp 29 going 0 → 1 on continuing past "Yes, I'll help you.", 1 → 2 on continuing past the
last line, scroll item 1891, 1 quest point, 300 Cooking XP.

No capture has the in-progress journal, the not-started journal, or the "Talking to the Cook again"
and "Where do I find..." branches, so those rest on the Wiki transcript alone.

## Runs

### 2026-11-01 · agent · claude-opus-5-5 · natural route

- **Start:** fresh account placed in the kitchen with `::tele` before the baseline (varp 29 = 0,
  varp 101 = 0, Cooking 1 with 0 XP, empty inventory). No items supplied; `travel_to` only after that.
- **Route:** Cook > "What's wrong?" > "Yes." > "Actually, I know where to find this stuff" (varp 29:
  0 → 1, with the started-quest message). Pot from the kitchen, bucket from the cellar, milk from the
  Dairy cow, grain from the field by the mill, hopper and controls on the mill's top floor, flour
  from the bin. Handed in milk and flour, fetched an egg from the coop at 3185,3297, handed that in.
- **Result:** varp 29: 1 → 2, varp 101: 0 → 1, Cooking level 4 and the completed-quest message. No
  `travel_to` leg came back blocked or with a note.
- **Repeat:** the Cook plays his post-quest dialogue with no second reward. **Relog:** stage, quest
  points and XP persisted.
- **Not checked:** the "Where do I find..." branches, head animation packets on the wire (covered at
  the event level by `server/tests/chathead-animations.test.cjs`).

### 2026-11-01 · agent · claude-opus-5-5 · capture comparison

- **Start:** fresh accounts placed with `::tele`, ingredients supplied with `::item`. This run
  compares the conversation with rsprox 1718; it isn't a play of the route.
- **Route:** all three ingredients in one conversation; separately, empty-handed start, then a
  return with nothing and a return with milk.
- **Result:** as in "Capture audit". Inventory held 3 items through the hand-over box and 0 at the
  next line. After milk, the box lists "A pot of flour", "An egg".

### 2026-10-29 · agent · claude-opus-5-5

- **Start:** fresh account (quest varp 29 = 0, no quest points, Cooking 1) placed in
  Lumbridge Castle's kitchen with `::tele` (the only teleport). Run on
  [#1511](https://github.com/RSPSApp/tsps/pull/1511)'s `travel_to`, over the quest code
  of `15e0e9b82`; the user watched it in a client.
- **Route:** Cook > "What's wrong?" > "Yes." started the quest (varp 29: 0 → 1). Pot from the
  kitchen floor; bucket from the castle cellar (kitchen trapdoor down, ladder up); egg from
  the chicken pen north of the castle (gate); milk from the Dairy cow in the cow field east
  of the farm (gate, "You milk the cow."); grain from the wheat field by Mill Lane Mill
  (gate, "You pick some grain."); mill large door, ladders to the top floor, grain in the
  hopper, Operate on the controls, ladders down, Empty on the flour bin ("You fill a pot
  with the last of the flour in the bin.").
- **Result:** the hand-in dialogue took all three ingredients; varp 29: 1 → 2, quest points
  (varp 101): 0 → 1, Cooking XP: 0 → 300 (level 1 → 4). All match the OSRS Wiki.
- **Not checked:** repeat Cook dialogue after completion, relog, handing in ingredients
  over several visits, the "Where do I find..." help branches.

### 2026-10-25 · community (thehardcorenoobs1234) · model not recorded

- **Source:** community report ([#1257](https://github.com/RSPSApp/tsps/issues/1257)); moved
  here from its ledger on 2026-10-29. No issue reported.
- **Not checked:** single account/run report; no full Quest Helper, recovery, multiplayer,
  dialogue, event or cutscene parity claim.
