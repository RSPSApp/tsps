# Stealing valuables (House Robbery)

Civitas illa Fortis's house robbery: [Stealing valuables](https://oldschool.runescape.wiki/w/Stealing_valuables) on the
Wiki. Code: `server/plugins/skills/thieving/HouseRobbery.Thieving.js` (the owners, doors, searching, getting caught) and
`HouseRobberyCrew.Thieving.js` (the urchins' house information and Oriana's trade-in), both units of the Thieving plugin.
Data: `server/plugins/skills/data/house-robbery.json`. Tests: `server/tests/thieving-house-robbery.test.cjs`,
`thieving-house-robbery-crew.test.cjs`, and the window case in `loc-teleports.test.cjs`.

House keys come from pickpocketing Wealthy citizens (`docs/thieving.md`). The words the urchins and Oriana say are the
generated transcripts (`npc-dialogues.json`), with osrsreboxed-db's capture corrections: the live information flow,
and the refusals below 50 Thieving.

## Sources

- **rsprox captures** (rsprox.net). Breaking in, searching and the window: 1102 (two break-ins), 1104, 1105 (two),
  3275. The owners' cycle, also from 1106, 1108 and 4054. All of these are Leagues VI worlds, except 3275, which is
  Grid Master. Leagues multiplied XP by 12 and later valuables by 10; Grid Master multiplied XP by 5. The values here
  are the base ones, and they match the Wiki.
- **The Wiki** for what no capture shows: the requirements (50 Thieving, Children of the Sun), getting caught (about
  90% of that house's valuables lost), the "still near the door" and "escorted out" lines, the full-inventory line,
  the arrow lasting about 7 seconds, Gladiator rank (free information, 65 coins a valuable), and relogging inside.

## The owners' cycle

One house is vacant at a time. In the captures the next owner leaves 10-17 ticks after the last door reopened, and
never the same house twice running.

- **Leaving.** The owner says their line every tick while walking out:
  - Lavinia: "I need to get a few things from the bazaar."
  - Victor: "Time to go check how rich I am!"
  - Caius: "Lovely day for a stroll."

  On the outside tile, the next tick, they lock up. They play `human_picklock_cagedoor_alt`, with sound 2407
  (delay 5, range 10) on that tile. The door becomes `varlamore_thieving_house_door_locked` (51998), at its captured
  rotation, and sound 43 plays at the door. Then they walk to their errand spot.
- **Away.** From the lock to "Ah, there they are!" is 302-313 ticks (Wiki: 180-190 s).
- **The return**, counted from the whistle tick W (1102, 1104, 1105):

| Tick | What happens |
| --- | --- |
| W | The house's urchin (Lucia for Lavinia, Rufus for Victor, Ava for Caius) says "\*Whistle\*". A player inside gets `<col=ff289d>You hear someone outside spot the homeowner coming back!` and synth sound 1569. |
| W+5 | `human_grind`, "Now where did I put my keys...", sound 1735 at the door. |
| W+10 | The pick animation, "Ah, there they are!", sound 2407 (delay 5). |
| W+15 | The door is `varlamore_thieving_house_door_open` again, with sound 44. |
| W+16 | The owner steps inside. Anyone still in the house is caught. |
| W+18 | A remark with `emote_think` ("There's mud all over the floor!", "It smells funny in here...", "Something isn't right here..."), or, if someone was caught, "What are you doing here?" / "How did you get in here?" |
| W+21 | After a catch, `emote_angry` and "Guards! Guards!" / "Help! Thieves!". |

## Breaking in

Open (op1) on the vacant house's Locked Door, from its outside tile (1102, 1104, 1105, 3275):

- **On arrival:**
  - the pick animation;
  - one House keys used;
  - synth sound 2407 (delay 5);
  - varbit `varlamore_thieving_house_broke_in` 0→1, which also turns the window multiloc into the one with Exit;
  - the hint arrow cleared.
- **Two ticks later:**
  - "Your key opens the locked door and you sneak in. The key gets stuck and snaps as the door opens." (spam);
  - the move onto the door tile;
  - synth sound 2419;
  - 1 Thieving XP.

The door reads the boosted level: base 45 boosted to 53 got in on 1102. The urchins and Oriana read the base level.

## Searching

Search on a chest, wardrobe or jewellery case of the house the player broke into:

- **The first search of an object** sets `varlamore_thieving_house_loot_progress` to 28-32, sends "You start to search
  through the chest..." (or wardrobe, or jewellery case) and plays `varlamore_thieving_search`. Switching objects
  re-rolls it.
- **Every 3 ticks after that** the varbit drops by 1 and the animation plays again. A success gives:
  - 1 valuable and 45 XP;
  - "You find some valuable items." and sound 2582;
  - +1 to varp `varlamore_thieving_house_valuables_lifetime`;
  - varbit `varlamore_thieving_house_most_valuables` raised to that house's count when it beats the record.
- **The shiny object.** 43-85 ticks after the current object was started, or after the last shiny was taken, another
  object shines:
  - `<col=a53fff>You notice something shine somewhere else in the house.`;
  - a hint arrow on the object (centre, height 70), and varbit `current_hint_arrow` 6;
  - sound 3147.

  Searching it within 12 ticks gives:
  - `<col=229628>You grab a bunch of valuables!`;
  - `human_pickuptable_walkmerge_noheld`;
  - 14 valuables, 630 XP and sound 2115;
  - its rolls re-set, with no start line.

  Then that object's own rolls carry on 3 ticks later.

## Leaving

- **The window** is LocTeleports' captured "Climb out of the window?" exit. After the whistle it goes straight out
  with no question (1102, 1104, 1105). LocTeleports asks content first, through "loc-teleports:ask". The arrival ends
  the visit: `broke_in` goes back to 0.
- **Caught** (Wiki): the thief is put on the door's outside tile and keeps a tenth of the valuables taken in that
  house. Valuables brought in are kept.
- **Escorted out** (Wiki): anyone in a house when its owner locks up gets "You are escorted out of the house as the
  owner has locked the door." (red) and is put outside.
- **A relog inside** (Wiki) puts the player outside the door.

## The urchins and Oriana

- **Below 50 base Thieving**, the variant the osrsreboxed-db corrections add (1102):
  - an urchin says "I'm rather busy here, and you don't seem like the thieving type. Beat it!", and the player
    "Rude.";
  - Oriana says "Sorry, but I'm rather busy here keeping lookout.";
  - then, from either, the message box "You need `<col=990000>`50 Thieving`</col>` to take part in House Robbery.".

  Check (op3) on an urchin at that level shows the box alone.
- **The information** (1105):
  - The first lookup is free. Later ones cost 15 valuables, on "Pay 15 valuables for information?". Gladiator rank
    (8,000 Glory) makes every lookup free (Wiki).
  - The urchin names the vacant house ("Looks like Caius isn't home right now. Go quickly!"), or the next to go ("I
    hear that Victor might be leaving his house soon.").
  - Varbit `varlamore_thieving_house_last_checked` holds the house number told: 1 Lavinia, 2 Victor, 3 Caius.
  - "Yes please." puts a hint arrow (height 100) over the owner's outside door tile.
- **Oriana:**
  - Her first meeting sets varbit `varlamore_thieving_house_stranger_met`, so her multinpc (spawned as
    `varlamore_dodgy_character_multi`) shows "Oriana" with Trade-in.
  - Trade-in, valuables used on her, or "Sure thing." in her offer opens "How many valuables would you like to hand
    in? `<col=990000>`(0 - N)". Each valuable is 55 coins (65 with Gladiator rank).
  - Then the coins-and-valuables box "You hand in X valuable items for Y coins." and "There ya go! Don't spend it all at
    once." (1102, 1104, 1105).
- **Oli's stew** (1098): the stew goes, its item box shows, and Oli's lines follow.

## Ours

These are not from any source:

- **The success chance per search roll.** The captures show about 2 in 3 at 45-58 Thieving and every roll at 74 and
  above. Ours is 0.65 at 50, rising in a line to 1 at 74.
- **When an object's rolls run out** at 0, the search stops. Clicking the object being searched carries on with its
  rolls.
- **The house interiors** (for catching and relogging) are rectangles drawn from the map's roofs, doors and windows.
- **The owner:**
  - counts as near the door within 8 tiles of it;
  - walks back 40 ticks before the whistle;
  - is put on the outside tile if a walk hasn't got there;
  - is put out after 20 ticks if blocked on the way out.

  The first owner leaves 10-17 ticks after start-up.
- **Opening the door when it can't be used:** a Locked Door whose house isn't the vacant one, or opening without house
  keys, gets "Nothing interesting happens." (no line is recorded or on the Wiki). The quest gate reuses the
  pickpocket's "You need to complete Children of the Sun before you can do that.".
- **Being caught has no message:** none is recorded.
- **Check** (op3) at 50+ Thieving plays the information part of the urchin's talk, without the greeting. No capture
  shows it.

## Not covered

- **The extra finds:** "You find something extra valuable: X" (jewellery up to diamond, the blessed bone statuette),
  sound 2655. The captures show three of them (1104, 1105), and neither source gives rates.
- **"Yes, don't ask me again."** pays like "Yes." but doesn't stop the question.
- **Rocky** (1/206,777 per house).
- **The owner's idle animations** on their errand.
- **The door's invisible blocking locs** while the owner steps in.
- **The urchin's door hint arrow** being reset before the whistle.
- **Oriana's first meeting:** `stranger_met` is set as the conversation opens (the runtime builds its lines up front),
  not on "The name's Oriana". The chat heads say "Dodgy Character" all through it.
