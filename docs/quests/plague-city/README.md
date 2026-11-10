---
quest: Plague City
key: plague_city
status: passed-with-issues
tested: 2026-11-10
tester: agent
model: claude-opus-5-5
commit:
cache: osrs-242_2026-11-03
start: fresh
travel: travel_to, ::tele between legs
---

# Plague City

Aligned with a complete live run, start to finish: rsprox captures, revision 242 recording
`20261110T113734-5ab63b4` (ticks below are that recording's). Issue
[#3976](https://github.com/RSPSApp/tsps/issues/3976).

## Capture facts the plugin relies on

**Boxes.** Hand-outs show in an item box (objectbox 193) with the item: the dwellberries (124), the
gas mask (127), the picture (382), the book (405, 424), the scruffy note (649), the hangover cure
(672), the warrant (682), the key (742), the rope (243), and the chocolatey milk and cure as they are
mixed (654, 658: "You mix the chocolate into the bucket." / "You mix the snape grass into the
bucket."). Statements show in a message box (229): Alrena's paste (125), each bucket of water
(160-181, broken after "You pour water onto the soil."), the dig (188), the grill (221, "The grill is
too secure.<br>You can't pull it off alone."), the pipe (317), the manhole (332), the black cross
(518, broken after "The door won't open."), the sneak-in (734) and the locked basement door (762).

**Stages (varp 165).** 1 as Edmond is asked about the dwellberries (60); 2 with the mask (126);
3 on Edmond's four-buckets line (147); 4-7 a bucket each; 8 three ticks after the dig (191); 9 as
the rope is tied (242); 10 at the end of the grill scene (301); 20 as Jethick knows the picture,
before the book is offered (384); 21 at the Rehnisons' door (423); 22 on Martha's first line (431);
23 on Milli's "boarded up building" line (456); 24 on the mourner's "apply to the head mourner, or I
suppose Bravek" (544); 25 on Bravek's "If they keep it short." (604); 26 with the note on the third
talk to Bravek (649; the first two only show his headache); 27 as Bravek drinks the cure (672);
28 once Elena's last line is continued (798); 29 with the reward (883).

**Varbits.** `plaguecity_dug_mud_pile` 1785 and `plaguecity_can_see_edmond_up_top` 1783 go to 1 with
the dig (191); 1783 picks which of Edmond's two spawns the client shows (6204 in the garden at 0,
6205 in the sewer at 1) and goes back to 0 as Elena is freed, with `plaguecity_elena_at_home` 1784 to
1 (798). `plaguecity_checked_grill` 1786 on the first pull (221), `plaguecity_pipe` 1787 1 a tick after
the tie (243) and 2 at the scene's end (301), `plaguecity_key_asked` 9103 on Elena's "there may be
one around somewhere" (765).

**Animations and sounds.** Pour 2283 + 2446; dig 830 + 1470; grill pull 3192 + 72; rope tie 3191 +
1731; Milli's `gnome_cry` 12039 with her "*sniff*" line (454); Alrena becomes 4251 while mixing and
4250 with the mask (125-126), back four ticks later; Bravek becomes 4253 as he gulps (672-675).

**The dig (188-194).** Spade on the soft mud: the animation, the fade out and the box; three ticks
later the player is on 2518,9759 in the sewer, the fade comes back in and the box shows again.

**The grill scene (266-304).** "Alright, let's get to it..." then a fade out over an empty message
box; three ticks later a copy of the sewer (rebuild_region from 2496,9728) with the player on
2514,9740 facing 2514,9738, Edmond (4256) on 2514,9741, and the grill and the tied rope replaced by
the animated ropes 11416/11412/11414; the camera (2518,9744 h375 looking at 2511,9738 h125, rates 90)
and the fade in a tick later; three ticks after that both play `lift_and_pull` 3187, the player says
"1... 2... 3... Pull!", the ropes play 3189/3188 and sound 1730; six ticks later Edmond's Jethick
line and the player's answer; then a fade out and, two ticks on, the real sewer at 2514,9740 with
the pipe open.

**Travel.** The pipe (2542 at 2514,9737): without a worn gas mask Edmond's "I can't let you enter
the city without your gas mask on." (340); with it the player moves 2514,9739 -> 2514,9736 by an
exactmove (cycles 30 and 126) with `plaguecity_human_doublepipesqueeze` 3195 (delay 30) and sound
2489, the box and fade a tick later, and five ticks after that stands on 2529,3304 in West Ardougne
with the manhole open (2544 with its cover 2545 at 2529,3302) and sound 75 (322). The manhole down
(332-336): 827, box and fade, 2514,9739 three ticks later. The mud pile (877-878): 828, then
2566,3331 a tick later with a filterable "You climb up the mud pile.". The Rehnisons' stairs (445,
474): 2527,3331 on floor 1 and back, "You walk up/down the stairs."; the plague house's (747, 833):
2537,9670 and 2536,3271, "You walk down/up the stairs...".

**Doors.** The Rehnisons' door (2537), Bravek's door (2528), the plague house's doors (37321) and
Elena's cell door (2526) are pass-through doors: an invisible blocker on the doorway, the open leaf
on the tile past it, the player walks one tile and the door is back two ticks later (424-426,
614-616, 734-736, 752-754). Elena's door from inside opens with no word (757, 827); from outside
without the key it is "The door is locked." with sound 2402 and her plea (762), with the key
"You unlock the door." (752, 788), and the key is kept.

**The warrant (716-736).** At the door the mourner speaks first (no black cross box). Talking to
him: the warrant line, "This is highly irregular. Please wait...", then he turns to the other
mourner (2534,3273) and asks overhead, two ticks later the answer, the box, and the player walks
in on 2540,3272. Both mourners stand still throughout.

**Elena.** Talk-to through her cell's wall answers "I can't reach that!" (775).

**The reward (882-891).** The quest scroll shows the gas mask and "1 Quest Point", "2,425 Mining
XP", "An Ardougne Teleport Scroll"; Edmond takes the warrant, the key, the note and the picture (the
worn mask stays). Asked again with the scroll carried he only thanks the player (889-891).

**West Ardougne.** Taking the gas mask off, or wearing another hat, there: "You should leave your
gas mask on while you're in West Ardougne." (393, 563). Plague City keeps it on until Biohazard starts; from then
Biohazard's own rule does (RSPSApp/tsps#4169).

**Chatbox pages.** Lines break in font 497 at 380 pixels (`ChatTextLayout`): every one of the
recording's 151 chat and item box lines breaks where live's does, and four lines are one box
(Bravek's headache line, 630).

## Findings

- **fixed** Talking to Elena through the locked cell bars fell into unrelated dialogue and printed the door's locked message; she now gives her Plague City plea without the door message. Fixed in #3796.
- **fixed** The whole quest against the live run above (issue #3976): boxes, stage timing, the dig,
  the grill scene, pipe/manhole/mud pile/stairs travel, pass-through doors, the warrant sneak-in,
  Elena's cell, the reward and the gas mask rule.
- **open** Dialogue data (osrsreboxed-db): Jethick's first talk with the picture skips the king
  conversation live plays first (372-380); his repeat talk ("again") stops before offering the book
  again, which live does (397-405); the clerk's menu after "Rather you than me!" lacks live's third
  option "This is urgent though! Someone's been kidnapped!" (597-602). Until the data has them, a
  player without the book hears Jethick's first conversation again.

## Runs

### 2026-11-10 · agent · claude-opus-5-5

- **Source:** fresh account, natural route over the agent MCP, compared with the recording above.
- **Result:** complete (stage 29), reward and item removal as captured.
- **Not checked:** visuals of the grill scene in the web client (instance rendering).
