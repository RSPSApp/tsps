---
quest: Merlin's Crystal
key: merlins_crystal
status: in-progress
tested:
tester: agent
model: claude-opus-5-5
commit:
cache: osrs-242
start: fresh
travel: travel_to
---

# Merlin's Crystal

Rebuilt from a whole run of the quest on live, the user's RSProx capture `MerlinsCrystal.bin`
(revision 242, SHA-256 `ad1b5def…c771bbbe`), with two other players' revision 242 runs up to the
Lady of the Lake's test from the local index (1001800: bread on the first visit; 1001994: the wrong
incantation). Ticks below are the capture's unless a recording id is given. The test is
`server/tests/merlins-crystal-capture.test.cjs`; the dialogue additions are RSPSApp/osrsreboxed-db
(capture-sources and structure annotations for "Merlin's Crystal", and a parser fix for a menu option
guarded by `{{tcond}}`).

## Capture facts

- **Progress:** varp 14 (`arthur`) 0 → 7 at ticks 423 (Yes to Arthur), 649 (Gawain's "She lives in
  her stronghold..." continued), 731 (Lancelot's "two ways in" line as it shows), 1216 (Morgan's
  last ritual line continued), 1576 (Thrantax's deed line continued), 2053 (the crystal shatters),
  2097 (Arthur's line continued). Nothing else the quest does moves a varp or varbit.
- **Start:** "You've started a new quest" comes between the Yes and "I will see what I can do
  then." (423).
- **Knights:** the entrapment questions at stage 1 (447-624), the keep at 2-3 (Pelleas, Bedivere,
  Palomedes at stage 3, 573-604), Excalibur at 4-6 (Palomedes 1631, Gawain at stage 6, 1689); their
  own pages after the quest (2108-2242), Gawain's "after Merlin's Crystal and Holy Grail" one with
  Holy Grail not started. At stage 2 Gawain has his own menu "Any idea how to get into Morgan Le
  Faye's stronghold? / Hello again." (656-660).
- **Journal:** seven snapshots (437, 668, 781, 1495, 1674, 1981, 2067), sent as live wrote each
  line. At stage 4 the Excalibur and bat bones lines are struck while carried.
- **The crate (854-971):** Hide-in (op 2) on 63 at 2801,3442; "Yes." plays the climb (827, delay
  10) and the fade out; two ticks later a one-chunk copy of 2776,9848 (rebuild_region), the minimap
  and cutscene_status on, the tabs closed and the fade in; the boxes are continued at the player's
  pace; "No." to getting out waits and asks again; "Yes." fades out over 15 cycles, the keep
  (2778,3401,0) a tick later, and five ticks after the Yes the box "You climb out of the crate." with
  the minimap, camera, tabs and fade back.
- **The keep:** stairs land on 2769,3407,1 / 2769,3401,2 up and 2769,3397,1 / 2769,3403,0 down
  (1029-1252). The large front doors (71/72) give "The door is securely locked. You will have to
  find another way in." (1264).
- **Sir Mordred (1046-1229):** his last hit leaves him on 0 (headbar fill 0) and Morgan Le Faye
  appears beside him at 2770,3403,2 in a puff of smoke (86, height 124), facing the player, who
  turns to her. "No. He deserves to die.": "You kill Mordred." (game message), his death
  (fai_varrock_guard_death 6490), Morgan gone with his body two ticks later. "Ok then." and the
  end of her information: "Morgan Le Faye vanishes." (box, a puff), Mordred whole again. Her three
  questions are one menu, the option just asked left out each time it comes back (1216-1229).
- **The candle (1338-1357):** the first talk is his terms even with wax on the player; his next
  "Have you got any wax yet?"; the candle takes the wax's slot. After the wrong incantation his
  opening line again (1001994 tick 17618). The tinderbox lights it in its slot with no message (1937).
- **Excalibur (1458-1642):** the Lady leaves "I seek the sword Excalibur." out while the player has
  the sword (1733). The jeweller's door: the first time the beggar (3532) appears on 3016,3247 and
  pleads, the door stays shut, and he is gone when the talk ends (1600-1603); after that the door
  opens and he waits there (1617). The bread goes as "You give the bread to the beggar." is continued
  (1635), the beggar becomes the Lady on her box (1637), the sword arrives as her last line is
  continued and she is gone (1642). 1001800 gives the bread on the first visit.
- **The words (1836):** Check on the chaos altar (61) shows the inscription box; the same each time.
- **The ritual (1945-1958):** bat bones dropped on 2780,3515 are not dropped; the player walks two
  tiles west, and three ticks after the drop Thrantax (3518) appears on the symbol facing south, with
  the smoke puff (86) and its sound (1930), and the box "Suddenly a mighty spirit appears!". The
  three incantations come in a new order each time (1953; 1001994). The wrong words (1001994
  17478-17522): his roar continued, the lit candle goes and he attacks (ghost tendril 5540), gone
  about 32 ticks later. A box closed by a second drop (1001800 23238) leaves him there a while.
- **The crystal (2052-2059):** Smash with Excalibur wielded: the two game messages, the swing (390)
  and sound 2656, the crystal gone (loc_del) and Merlin on its tile facing the player, his three
  lines, the box, Merlin gone as it closes. After the quest the crystal is back: "You have already
  freed Merlin from the giant crystal." (2263).
- **The end (2093-2103):** 6 quest points, 1,000 Firemaking XP and the scroll (Excalibur's model);
  then Arthur offers Holy Grail. Merlin's workshop door: "The door won't open." with Holy Grail not
  started (2185).
- **Chat heads:** every line's animation is in `plugins/quests/data/chathead-animations.json`.

## Not capture-verified (Wiki)

- The wrong-incantation Thrantax fight's length is one sample (32 ticks); the Wiki says only that he
  despawns shortly.
- The beehive (Transcript:Beehive), the Excalibur reclaim for 500 coins (Excalibur), Mordred
  regaining his hitpoints when the plea is walked away from (Sir Mordred), the smash failures
  (the quest transcript), the ritual's two refusals (the quest transcript).
- Gawain's answer to "Any idea how to get into Morgan Le Faye's stronghold?" at stage 2 is the Wiki's
  answer to the same question one menu earlier; the capture took "Hello again.".

## Ours

- The unstruck bat bones journal line; the completed journal; the start sentence.
- A crate ride whose chat is closed puts the player back by the crates; a logout in it does too.
- Mordred's plea only at stage 3; at other stages he dies as anyone does.
- The workshop door opens once Holy Grail has started.

## Findings

- **fixed** The old plugin played the Wiki transcript with the crate as one long talk, Morgan after
  Mordred's death, the knights' Excalibur lines from stage 3 and a black candle message live doesn't
  send; this rework aligns them with the capture.

## Runs

No natural playthrough recorded yet on this rework.
