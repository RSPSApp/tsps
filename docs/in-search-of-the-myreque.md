# In Search of the Myreque

`server/plugins/quests/quests/InSearchOfTheMyreque.Quest.js`, with its parts in
`server/plugins/quests/insearchofthemyreque/`:

| Unit | Contents |
|---|---|
| `Bridge` | the Hollows rope bridge: the trees, the rung repairs, walking the repaired bridge |
| `Hideout` | Vanstrom's cutscene in the hideout and the Skeleton Hellhound fight |

The quest file keeps the dialogue hooks (variants, conditions, the Curpile quiz), the boats, the doors, the
hidden wall, the basement ladder and the journal.

**Sources:**
- **an rsprox capture** of a whole live playthrough, start to completion (revision 242, recorded 2026-11-19,
  including two failed quiz attempts). The ticks below are that recording's;
- **the OSRS Wiki:** "In Search of the Myreque" (walkthrough and notes) and its transcript, which the dialogue
  data is imported from;
- **this cache:** ids, the loc and NPC multis and their varbits.

Where the Wiki and the recording disagree, the Wiki's value is kept and the difference is listed under
[Recorded differences](#recorded-differences).

## Stages and varbits (captured)

Varp 387 (`routequest`):

| Stage | When (tick) |
|---|---|
| 5 | "Yes." to Vanstrom's start question (93) |
| 10 | Cyreg's first conversation, on "Surely if I was a vampyre..." (392) |
| 15 | Cyreg persuaded, after "I suppose you do make a point." (585) |
| 20 | "Here are some planks for you." (601) |
| 25 | the boat arrives at the Hollows (637) |
| 52 | "I've come to help the Myreque. I've brought weapons." to Curpile (735) |
| 55 | the third correct answer (1063) |
| 60 | Open on the doors in the earth (1081) |
| 65 | Veliaf's first talk, after "Yes, and he told me to seek you out..." (1129) |
| 67 | "You give the weapons to Veliaf." (1295) |
| 70 | the cutscene opens (1301) |
| 71-80 | one after another as the cutscene ends (1372) |
| 85 | a tick after the hound dies (1459) |
| 90 | Veliaf's after-the-hound talk, after "That's very useful. Thanks." (1502) |
| 95 | Search on the hidden wall (1574) |
| 97 | the basement ladder (1582) |
| 100, 105, 110 | the Stranger's last lines; completion (1614-1617) |

The cache's completion threshold is 105 (quest DB row 79), so the plugin completes at 105.

Varbits:
- **173 / 174** (`routequestionscorrect` / `routequestionsanswered`): each quiz answer bumps 174 and, when right,
  173; both go back to 0 as the next attempt starts (858, 954).
- **176-178** (`bridgerung1-3`) and **3928** (`route_bridgecomplete`, one bit per rung: 1, 3, 7 as the rungs are
  repaired in order). Completing the quest sets all four (1617), so the bridge stays repaired.
- **396** (`thsfm_vanstrom_hide`): 1 as the cutscene opens. The pub's stranger (NPC 6269) shows Vanstrom (5056) at
  0 and the plain Stranger (5055) at 1.
- **2496** (`thsfm_spoken_allmyreque`): a bit per member on their first talk: Sani 1, Harold 2, Radigad 4,
  Polmafi 8, Ivan 16.
- **542** (`cutscene_status`): 1 for the cutscene (1301-1372).

## Mort'ton and the boat

- **Cyreg's Travel** (op 3, 621): the 10-coin fare and the fade on the click. The next tick the side tabs close,
  the "morytania boatride" jingle (137), `swamp_boatjourney` (321) and the box "You board the boat and journey to
  the Hollows." with no continue. Fourteen ticks later the move to (3498,3380). A tick after that: stage 25, the
  box "You arrive at the Hollows.", the tabs back, 321 shut and the fade back in.
- **Board on the Mort'ton boat** (6969, 894): Cyreg asks first: "I'll have to charge you ten gold to cover the
  loan of the boat. Is that okay?", then the menu "Yes, I'll pay the ten gold." / "No, I won't use the boat.". The
  fare goes with the answer and the ride is the same.

## The rope bridge

- **The trees** (loc 5003 at (3502,3426) and (3502,3431)): varbit 3928 shows them as "Tree" with Climb (op 2)
  until all three rungs are repaired, then with Cross-bridge (op 1). Up: `human_reachforladder` (828) on the click,
  "You climb up the tree." and the move the next tick ((3502,3425) to (3502,3427); 665-666). Down:
  `human_pickupfloor` (827) with "You climb down the tree." and the move the next tick ((3502,3430) to
  (3502,3432); 684-685).
- **Repair** on a broken rung (26245-26247 at (3502,3428-3430), op 1): `pest_repair_quick` (15168) and
  `hammer_wood` (2101) three times, 0, 20 and 40 client cycles apart. Three ticks later "You repair a section of
  the bridge.", one plank and 75 steel nails go, the rung's varbit and its 3928 bit are set, and the player walks
  one tile onto the rung (668-681).
- **Walking:** the player walks the repaired bridge from the landing to the top rung (837). The map keeps the
  rungs' floor-decoration clipping for everyone; a player on the bridge is in a private area of their own (it
  counts as the main world, so nobody is hidden) that clears it on the landing and their repaired rungs.

## Curpile Fyod

- **The quiz:** each question is the menu's title, with five answers ending "I don't know." (745-1060).
- **The knock-out** (778-791, 882-895): the box "Curpile knocks you out and takes you back to Mort'ton." with no
  continue, Curpile's `human_sword_slash` (390) and `hacksword_slash` (2500); a tick later the player's
  `human_staff_block` (415), `stunned_thieving` (245, height 124) and `stunned` (2727); a tick later
  `human_death_backwards` (837) and the fade; the minimap off a tick after that; the move to (3522,3285) seven
  ticks after the box; three ticks later the fade back in and the box again, now with continue.
- **The refusal punch** (698): "Curpile punches you.", 3 damage and `human_unarmedpunch` (422) on the player.

## The hideout

- **The doors in the earth** (5061 at (3509,3447)): `human_pickuptable` (832) and stage 60 on the click; the next
  tick the open doors (5062, 5063), `iron_door_open` (71) and the fade; two ticks later the move to (3500,9811)
  (1081-1084). No message.
- **The tunnel in** (5046 at (3492,9823), played by loc-teleports): two ticks after the arrival on (3505,9832)
  Harold starts "Hey! Who are you and why are you here?" by himself (1103-1105).
- **The hand-in:** "You give the weapons to Veliaf." as a box with the longsword and the mace (1295).
- **The cutscene** (1298-1372), in a copy of the hideout (`rebuild_region`). From Veliaf's thanks: the fade; three
  ticks later stage 70, the player on (3506,9839), the members in their cutscene forms (Veliaf 9621 (3505,9839),
  Harold 9625 (3504,9837), Sani 9623 (3508,9836), Radigad 9627 (3511,9834), Polmafi 9629 (3512,9838), Ivan 9631
  (3511,9842)), `cam_forceangle` (160, 960) and the camera (move (3506,9845) 555, look (3505,9832) 85); the fade
  in two ticks later; the mist (5057) on (3504,9832) two ticks after that; Harold's "What the..." six ticks after
  the scene opens.
  - After "Vampyre!": `mist_loop_test` (4374); the mist drifts two tiles north; three ticks on it is Vanstrom
    (9632) on (3505,9835), `vyrelord_transform_pt2` (8745) and `mory_vanstrom_mist_transform_return` (4358).
  - Each blood barrage, after "We're dead!" (Sani) and before "And now...": Vanstrom faces the victim a tick after
    the line, `vyrelord_barrage` (8704) with `mory_vanstrom_blood_range_attack` (4415) and `blood_cast` (106) the
    next tick, the impact two ticks on (`spell_blood_barrage_impact` 377 and `human_unarmed_def` 425, `female_hit`
    506 / `human_hit` 513 and `blood_barrage_impact` 102), the hit (Sani 30, Harold 40) and the death; the next
    line eight ticks after the one before.
  - After "And now... A little gift for the rest of you.": `vyrelord_summon` (8722) and `entangle_cast_and_fire`
    (151); `summon_skeletalhound` (1189); the hound (5054) on (3505,9836) with `skeleton_hound_summon` (1498);
    `vyrelord_transform_pt1_loop` (15167) and `mory_vanstrom_mist_transform` (4394); Vanstrom becomes the mist on
    (3504,9834), which drifts two tiles south and goes. Twelve ticks after the line the cutscene ends: stage 80,
    the controls and tabs back, the copy's tunnel becomes "Cave entrance" with Escape and Quick-escape (38094) on
    (3505,9831), and the hound attacks.
- **The kill** (1458-1465): stage 85 a tick later with the fade, out of the copy onto (3506,9837) two ticks on,
  the fade back in two ticks after that, and Veliaf starts "Sani... Harold... That murderer killed them!" by
  himself two ticks later. No message.
- **The hidden wall** (5052 at (3480,9837), from (3480,9836); 1574): stage 95, the wall becomes `inviswall` (38848)
  and the inactive wall (5053) stands open on (3480,9836) with rotation 0, `door_open` (62), and the player walks
  one tile north; two ticks later the wall is back. No message.
- **The ladder** (5054 at (3477,9846); 1581-1582): `human_reachforladder` (828), and the next tick stage 97 and the
  move to (3495,3465). No message.
- **The reward scroll** shows the steel sword (1281).

## Ours (no source)

- The north tree refuses until all three rungs are repaired, with the old text; Cross on the landing crosses a
  fully repaired bridge from bank to bank. No capture tries either.
- The copy's Escape and Quick-escape crawl out to the main cave like the hideout's tunnel; a logout or death in
  the copy comes back to (3492,9824), and a grave goes there too (Wiki: "Dying in the chamber will cause your
  gravestone to appear outside of the room").
- A player who left the fight finds the hound waiting on (3505,9834) when they crawl back in (Wiki: it "respawn[s]
  close to the entrance once you re-enter"); the tile is ours.
- Quick-board, or a worn Ring of Charos(a), skips Cyreg's fare question.
- The wall pass from the north side mirrors the captured one from the south.

## Recorded differences

The recording's live dialogue differs from the Wiki transcript in many places; the transcript's words are kept.
The main ones:
- Cyreg's persuasion has no druid-pouch check in the recording ("...if you're happy to pay a fee of ten gold, you
  can use my boat... you'll need to fetch six wooden planks first.", 585-593), and he asks for the fee again on
  "Okay, I'm ready to go." (612). The transcript's pouch condition and its "You show the boatman your druid pouch."
  are kept (Wiki: "The player will show him the druid pouch").
- Curpile's question lines are "Okay, here's ya first question. ...", "Right then, here's ya second question. ..."
  and "Okay, time for tha third and final question. ..."; the transcript's "Okay, [first/second/third and final]
  question." is filled with the ordinal. The answers' acknowledgements differ slightly too ("That's tha first
  question done.").
- Veliaf's first talk, the after-the-hound talk and the Stranger's last lines are reworded, and the recording has
  no "Sorry Harold, you too!".
- The recording sends stage 110 after 105 at completion; the plugin stays at 105, the cache's threshold.
- Live holds the chat with an empty box during each cutscene beat; the transcript runner closes the chatbox for
  those ticks instead.
