---
quest: Sea Slug
key: sea_slug
status: passed
tested: 2026-11-10
tester: agent
model: claude-opus-5-5
commit: fix/4117-sea-slug
cache: osrs-242_2026-11-03
start: fresh
travel: walk_to
---

# Sea Slug

A fresh account played the quest 0 to 12 on `fix/4117-sea-slug` against a full revision 242 RSProx
capture of the quest (`20261110T112750-5ab63b4`, ticks 12-450). The boat trips, doors, Kent's grab,
the kick and both cutscenes now play as the capture does
([#4117](https://github.com/RSPSApp/tsps/issues/4117)).

## What live does (RSProx capture, revision 242, 2026-11-10)

- **Stages** are varp 159 `seaslugquest`, 0-12. With the swamp paste already in the pack the hand-in
  goes 1 -> 3 (tick 38) on "You give Holgart the swamp paste."; Kennith's talks move 3 -> 4 (143),
  7 -> 8 (327) and 9 -> 10 (354), the platform Holgart's 4 -> 5 (172), Kent's 5 -> 6 (196), the
  torch 6 -> 7 (297), the kick 8 -> 9 (340), the crane 10 -> 11 (399), Caroline 11 -> 12 (448).
- **Holgart's Travel** exists from the boat repair on: Witchaven's Holgart 5071 is 7324 (no Travel)
  for varp 159 0-2 and 7789 (Talk-to, Travel) from 3, and the capture uses it at stage 3 (tick 78).
  The island boat 5069 (220) and the platform Holgart (the world's 6241, which shows 5070 while
  `slug2_npc_track1` 2614 is 0; tick 420) travel too.
- **Every crossing** fades out on the click (or on the last line), two ticks later shows
  `seaslug_boat_travel` 461 over `toplevel_mainmodal_open` [3750175, 42] with song 147 and jingle 172
  and the route's layer (10 Witchaven -> platform, 11 platform -> Witchaven, 12 platform -> island,
  13 island -> platform), and lands; the message box comes 8 ticks after the click (9 to the island,
  11 to Witchaven). Landings: 2782,3273 (platform), 2800,3320 (island), 2722,3305 (Witchaven).
- **The boat repair** (ticks 38-61): fade out with the hand-in; at +3 a cutscene in a copy of the
  8 x 8 zones from 2688,3264 (plane 0), the player at 2716,3300, Holgart in the water (5072) at
  2718,3300 facing south; at +4 he steps to 2719,3300 with seq 4786 (delay 45), "Right me hearty.
  Let's get this boat fixed.", sound 3026 (delay 45), the camera to 2711,3292 (500) looking at
  2717,3299 (200), fade in; at +13 "Huzzah! We've fixed the leaky old tub." and he becomes 5068;
  fade out at +17, the real map at +20 with the player at 2720,3302, fade in at +21.
- **The doors** of Kennith's cabin (2767,3285,1) and Bailey's house (2768,3276,0) are ordinary:
  `slug2_village_poordoor` 18168 goes and `fai_barbarian_poordooropen` 11617 stands one tile west,
  rotation 1, with sound 62 (ticks 122, 240). Kennith is talked to from 2765,3286 inside; from
  outside the cabin it is "I can't reach that!" (131). Kennith never moves off 2766,3288.
- **Kent** (ticks 190-210, the player held all through): the talk closes on "Please go back and get
  my boy..."; three ticks later "[player] wait!"; the tick after its continue Kent plays spotanim 790
  and seq 4807 with sound 3025 (delay 10); "\*slooop\*" two ticks later, "He pulls a sea slug from
  under your top." two after that, then the sea slug 1466 on the player's tile (theirs only) and
  "A few more minutes..." / "Yuck! Thanks Kent.".
- **Bailey's torch** (248): "Here." then an item box with the unlit torch 596, "Bailey gives you a
  torch."; the torch is added after it.
- **Broken glass on damp sticks** (276): seq 4809 and spotanim 791 and sound 3023, all delay 15; the
  damp sticks become dry sticks and the glass is kept. Rub-together (297): the three messages and
  sound 3028.
- **The ladder** up with the lit torch (303): "The fishermen seem afraid of your torch." on arrival.
- **The kick** (334-340): "You kick the loose panel." with seq 4804 and sound 3024, "The wood is
  rotten and crumbles away..." three ticks later, "leaving an opening..." three after that.
- **Kennith** after the wall: each line once (348-353); at stage 10 Talk-to is the game message
  "He doesn't seem interested in talking." (357).
- **The crane** works from its controls on the north side: from 2769,3287 (west of it) it is "I need
  to get closer to use that." (365); from 2771,3291 (375) the player steps to 2772,3291, the screen
  fades (378), and at +3 a held box "Kennith scrambles through the broken wall..." over a copy of the
  5 x 5 zones from 2752,3264; Kennith 5063 at 2767,3289 (+5), 2768,3289 (+6); the player turns the
  crane (seq 4795, loc anim 4796 on 18327, sound 3021) at +8; Kennith rides it as 5062 from 2770,3289
  (+13); seq 4797, the crane is 18326 and sound 3020 at +14; fade out at +21, the real platform at
  +24 and "Down below, you see Holgart collect the boy from the crane and lead him away to safety."
- **The reward** (448-450): varp 159 12, 1 quest point, oyster pearls 413; jingle 154; the scroll
  shows the sea slug 1466 with "1 Quest Point", "7,175 Fishing XP", "Fishing Platform Access" and
  "Some Oyster Pearls".

## Findings

- **fixed** The cabin and Bailey's doors moved the player inside instead of opening; 18168 had no
  open leaf in the door catalogue. Fixed in the #4117 PR.
- **fixed** Holgart's trips teleported without the boat map; Travel exists mid-quest in live too, so
  it stays (issue point 2's expectation differs from the capture). Fixed in the #4117 PR.
- **fixed** Kent's grab, the kick animation, the boat repair and the crane cutscenes were missing;
  the paste went on the condition, before Holgart's lines; the glass was consumed; the transcript
  repeated Kennith's lines and lacked the torch box (RSPSApp/osrsreboxed-db Sea Slug capture source).
- **open** Ours: the platform Holgart's Travel at stage 4 takes the island leg (the capture only
  shows the Talk-to there); climbing the ladder without a lit torch at stages 6-10 plays the Wiki's
  smack lines (not captured); the whole north row of the crane counts as its controls.

## Runs

### 2026-11-10 · agent · claude-opus-5-5

- **Start:** fresh account at Witchaven with `::tele`; swamp paste supplied with `::item`.
- **Route:** Caroline, Holgart (hand-in and repair cutscene), Talk-to sail to the platform, ladder,
  cabin door, Kennith, platform Holgart to the island, Kent (grab), Holgart Travel back, Bailey's
  door and torch, glass and sticks, rub, ladder, Kennith, kick, Kennith, crane from the west
  (refused) and the north (cutscene), ladder, Holgart Travel to Witchaven, Caroline.
- **Result:** varp 159 0 -> 1 -> 3 -> ... -> 12, 1 quest point, oyster pearls, 7,175 Fishing XP.
  A server restart (out of memory, unrelated) mid-run lost stages 7-11, which were replayed. The
  two cutscenes were also recorded in the headless web client.
- **Not checked:** Quest Helper's headless route; RuneLite through the gateway; the full-bag torch
  drop and the lost-torch branch in game (unit-tested).
