---
quest: Gertrude's Cat
key: gertrudes_cat
status: passed-with-issues
tested: 2026-11-24
tester: agent
model: claude-opus-5-5
commit:
cache: osrs-242_2026-11-03
start: fresh
travel: travel_to
---

# Gertrude's Cat

Rebuilt from a revision 242 capture of a whole run (the user's own recording, varp 180 0 → 6,
ticks 40-1197; cited below as "the capture") and rsprox.net recording 3222 (revision 232, after the
quest). The Wiki decides where it states a value; the capture decides timing, presentation and
wording the Wiki leaves out.

## What the capture shows

- **Start (ticks 40-65):** varp 180 becomes 1 and "You've started a new quest" is sent as the
  player's "Well, I suppose I could." is continued, before Gertrude's thanks.
- **The boys (ticks 148-290, 765-782):** the talk is worded from the clicked boy's side. From
  Shilop, Shilop says every line and asks for 100 coins himself; from Wilough, Shilop chips in
  ("our secret play area", "10 coins.") and Wilough answers the threat ("If you want to hurt my
  brother..."), and the menu reads "Fluffs loss" without the apostrophe. "You decide it's best not
  to hurt the boy." is a message box. Paying Wilough: an objectbox with the coins, then Shilop's
  "We play at..." and Wilough's broken fence; the coins go and varp 180 becomes 2 as the last line
  is continued (tick 274). Paying Shilop (local recording 1001963, revision 242, ticks 9151-9178):
  the coins go and varp 180 becomes 2 as the objectbox shows, and Shilop gives both directions,
  "I play at..." and the broken fence, after the player's "Fluffs ?". After paying, the clicked boy
  says where Fluffs is (stage 2); once Fluffs is found (recorded at stage 5) the clicked boy
  boasts and the other says "He can you know!", ending in a message box.
- **The broken fence:** see [agility-shortcuts.md](../../agility-shortcuts.md#varrock-broken-fence-the-lumber-yard).
- **Lumber yard search (ticks 386-408):** barrels and the loose crate (locs `gertrudeempty_*`):
  "You search the barrel." / "You search the crate.", BUSY, then "You find nothing." 4 ticks later.
  The mewing crates are `kittens_mew` NPCs: "You search the crate.", then 4 ticks later "You find
  nothing." or the message box "You find a kitten! You carefully place it in your backpack."; the
  kitten is in the backpack once the box is continued (tick 579). Both finds were the same crate
  (3305,3500); the Wiki says each player's crate is fixed and random, which the server follows.
- **Fluffs (ticks 418-525):** Pick-up and Stroke: the player's `human_pickupfloor` on arrival,
  BUSY, two ticks later Fluffs' `cat_attack` with "Hisss!" overhead facing the player, a tick later
  the player's "Ouch!" overhead, and the hint as a message box 4 ticks after that; BUSY clears as the
  box is continued and clicks in between do nothing. Pick-up's hint follows the stage (thirsty,
  hungry, afraid); Stroke is "Perhaps the cat wants something?" at every stage, after the quest too
  (3222 tick 12362). Talk-to is "Miaoww" overhead. After the quest Pick-up is the player's line
  "Oh, it looks like Fluffs has returned. I'd better leave her alone." (3222 tick 12285).
- **Milk and sardine (ticks 449-480):** `human_pickupfloor`, the item goes, and a tick later the
  stage moves (and the empty bucket comes back) with Fluffs' "Mew!" overhead. No chat message.
- **Dropping the kitten (ticks 606-615):** "You place the kitten on the floor.", BUSY, the kitten
  (`lostkitten`) appears on the player's tile and mews a tick later, 6 ticks on the message box
  "The kitten has run off!", and it is gone 2 ticks after the box. It is found in its crate again.
- **Returning the kitten (ticks 665-678):** varp 180 becomes 5 at once; the kitten appears on the
  player's tile; Fluffs purrs at +2 and the kitten at +3; at +6 both walk off towards the ladder for
  five ticks, the kitten leading; at +11 both are gone and "Fluffs has run off home with her
  offspring." shows as a message box. BUSY holds until it is continued.
- **The reward (ticks 852-872):** the hug and "Gertrude gives you a kitten." are message boxes. As
  the second is continued, varp 180 becomes 6, the follower varps are set and the kitten appears
  following the player with "Miaow!" and then "Meeooow!" a tick later. Five ticks on, "... and some
  food!" with the chocolate cake and stew; four ticks after that the quest points, the completion
  message, jingle and scroll (model `kittenobject_dummy`; "1 Quest Point", "1,525 Cooking XP",
  "A Kitten", "A Chocolate Cake", "Some Stew").
- **After the quest (ticks 878-893):** asking Gertrude for another kitten while the first is
  following gets "Aren't you still raising that other kitten?...".
- **The kitten's Interact menu (ticks 918-964, rsprox.net 3219 and 3216):** see
  [Cat Interact](#the-kittens-interact-menu) below.

## Gertrude's kittens after the quest

The Gertrude plugin (`server/plugins/npcs/Gertrude.plugin.js`) sells them, after the Wiki's Gertrude
page: 100 coins, a random colour unless the Ring of Charos(a) is worn (then the colour choice, and
her "[Charm]" option is offered only then). "Yes please." and her right-click "Kitten" (quick buy)
take the coins and hand the kitten over as the reward does: it follows (Transcript:Kitten's
"Meeooow!", "Miaow!"), or goes into the backpack with a follower out, or under the player when that
is full; "Gertrude gives you another kitten." is a message box. She refuses ("Aren't you still
raising...") while a kitten or normal cat (or hell-kitten, hellcat) follows or is in the backpack or
a bank; a bank placeholder is no cat, and an overgrown cat doesn't count. The quick buy without
coins: "I'll want 100 coins for a kitten.".

## The kitten's Interact menu

`server/plugins/npcs/pets/CatInteract.Pets.js`, from the capture (no catspeak amulet) and 3219/3216:

- "Interact with kitten": Stroke, Chase Vermin, Guess age, Shoo away; an adult cat's "Interact
  with cat" has no Guess age (3216 tick 5486).
- **Stroke (918-924):** "You softly stroke your cat.", the player's `human_pickupfloor` and the
  kitten's `cat_rollingover` at once; 3 ticks later "Purr...purr..." overhead with the `purr` sound
  (340) and the player's "That cat sure loves to be stroked." (chathap1). BUSY until it is continued.
  An adult cat: "Who's a good cat then?" and the cat's "Me! Me! Scratch me behind the ears."
  (Transcript:Cat; 3216 tick 5489-5494).
- **Guess age (943-946):** the player's "I wonder how old you are..." (chatneu1), then the message
  box "After taking a good look at your kitten you guess that its age is: 0 minutes. And approximate
  time until fully adult: 3 hours  00 minutes, assuming you look after it." (the double space is
  live's). Both from the growth count (90 seconds each, 120 to adult), rounded down: 3219's "1
  minute"/"2 hours 58 minutes", "28 minutes"/"2 hours 31 minutes", "1 hour 13 minutes"/"1 hour 46
  minutes".
- **Shoo away (952-956; 3219 tick 23993-24012):** "Are you sure you want to shoo away the cat?"
  (Yes I am.|No I'm not.). No: "You choose not to shoo away the cat." (spam). Yes: the player's
  "Shoo cat!" overhead; a tick later "The cat has run away.", the kitten's "Meeeooow!" with sound 339,
  and the follower varps clear.
- **Journal (ticks 73, 278, 601, 703):** the recorded lines for stages 1, 2, 4 and 5.

## Current server implementation

`server/plugins/quests/quests/GertrudesCat.Quest.js` plays the above; the words come from the
"Gertrude's Cat" and "Gertrude" transcript pages as osrsreboxed-db's capture sources correct them.
Ours, with no source:

- Stage 3's journal repeats stage 2's (not recorded); the finished journal strikes every recorded line.
- Fluffs, back from the return scene, is on her spot again for everyone 25 ticks later (live's delay unknown).
- Before the boys are paid, Fluffs' Pick-up gives the stage-2 hint.
- Without 100 coins, "Okay then, I'll pay." ends the talk (neither source shows the boys' answer).
- A full backpack at the reward or the kitten find leaves the item at the player's feet; with a
  follower already out, the kitten goes into the backpack (the Wiki: either a follower or an item).

At the final hand-in an equipped Ring of Charos(a) still offers the server's kitten-colour picker.

## Recorded differences

- The fence's south approach starts from 3308,3491: this cache blocks the fence tile live walks onto.
- Gertrude's Ratcatchers lines ("Did you ever get to talk to those ratcatchers...") still play after
  the quest; the capture's account goes straight to "Is there anything I can do for you?". Whether
  that depends on Ratcatchers' progress is not established.
- Gertrude's chatheads name 7284 (`gertrude_quest`); live names the base 3500, whose varp-180
  transform that is (7284 and 7723 share its head models).
- Fluffs wanders a few tiles in the loft (her spawn has no wander radius set); live she stood still.
- The kitten's feeding still words it differently: live sends "The kitten gobbles up the fish." with
  "Purr!" (capture tick 1189). Left for a follow-up.
- After "Yes I am." live's kitten walks off for 4 ticks and is removed at +5 (3219 tick 24012); ours
  is removed with its "Meeeooow!" at +1.
- The broken fence's north crossing lands on 3308,3493, one tile short of live's 3308,3494: live
  starts on the fence tile, which this cache blocks, so ours starts one tile south and keeps live's
  two-tile move with the climb over the fence (issue 6772).
- No quest rating box (983) follows the scroll, as for every quest on this server.
- The player's "Hello again." keeps the chathead animation another quest's capture recorded (chatneu1);
  this capture has chathap1.

## Findings

- **open** Varp 181's random-crate selection is an approximation.

## Runs

### 2026-11-24 · agent · claude-opus-5-5

- **Start:** fresh account `gcfresh1`, placed beside Gertrude with `::tele` once; 200 coins, a bucket
  of milk and a raw sardine supplied before the baseline. Quest Helper 06da90f followed step by step.
- **Route:** doogle leaves from the ground behind the house, both boys with every option (refuse,
  then pay Shilop), the broken fence both ways, the ladder up and down, every Fluffs option at
  stages 2-5, wrong items, several crates, the kitten dropped and found again, the return, Gertrude.
- **Result:** varp 180 0 → 6; QP 0 → 1, Cooking 0 → 1,525 XP; cake and stew; the kitten following
  (varp 447/448 set, object 1556); rewards once on repeat talks; relog and the saved stage 6 kept.
- **Issues found and fixed in the same branch:** no start message, Fluffs' catspeak talk without
  the amulet after the hand-in, no "Nothing interesting happens." for wrong items, an empty chatbox
  with "Miaoww".
- **Not checked:** the vision screenshots and clip (the headless client did not log in twice);
  the full-inventory reward in game (covered by tests).

### 2026-10-23 · agent · model not recorded

- **Source:** issue [#728](https://github.com/RSPSApp/tsps/issues/728) active (q048); moved here from its ledger on 2026-10-29. Proven against plugin hashes, not a commit, so a later plugin change is not flagged automatically.
- **Start:** fresh.
- **Result:** varp 180 = 6; QP +1, Cooking +1,525 XP, kitten, cake, stew.
- **Checked:** post-quest kitten purchase, relog, logout/offline.
- **Not checked:** Full-bag and cancellation branches unchecked; Overlay not certified.
- **PRs:** [#1124](https://github.com/RSPSApp/tsps/pull/1124).
