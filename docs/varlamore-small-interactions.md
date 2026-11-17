# Varlamore small interactions

Five Varlamore interactions that the Leagues tasks of issue #6108 depend on. Each one emits an event on
the tick the live league task completes (see server/docs/leagues.md, Tasks). Sources are the
rsprox captures (rsprox.net recordings 1098 and 1105, revision 237, Leagues VI) and the OSRS Wiki.

| Interaction | Plugin | Event |
|---|---|---|
| Dairy Buffalo: Milk | `objects/DairyBuffalo.plugin.js` | `dairy-buffalo:milked` { player } |
| Bird bath: Drink-from | `objects/BirdBath.plugin.js` | `bird-bath:drank` { player, outcome } |
| Beautiful tree stump / log / rock: Admire | `objects/BeautifulScenery.plugin.js` | `scenery:admired` { player, object } |
| Stew used on Oli | `npcs/OliStew.plugin.js` | `oli:fed-stew` { player, npc } |
| Aldarin vineyard: grapevines and the grape barrel | `world/Vineyard.plugin.js` | `vineyard:barrel-handed-in` { player } |

## Dairy Buffalo

The Dairy Buffalo is a loc at Ortus Farm (52576) and at Kastori (57212). Its name carries a colour tag.

Recording 1098 tick 14560 shows the Milk, 2 ticks after the arrival. All of these happen on that one tick:
- the player plays `milk_buffalo`;
- synth 372 plays;
- the spam line "You milk the buffalo." appears;
- the empty bucket becomes a bucket of milk.

Recording 1105 tick 14237 clicked Milk and got no response, presumably because no empty bucket was carried.

Ours: with no empty bucket, the player gets the dairy cow's recorded line, "You'll need an empty bucket to
collect the milk." No buffalo recording shows a message there, and a bottomless milk bucket isn't filled.

## Bird bath

The bird bath is loc 52394. The Transcript:Bird bath page and recording 1098 (ticks 14874-14897) give this sequence:
- Drink-from opens the chat menu "Drink from the bird bath?" with the options "Yes." and "No.".
- Yes plays `poh_pool_drink_silent` (10415) and synth 2401, and closes the menu.
- Two ticks later, one of four outcomes happens at random:

| Outcome | Player's line | Effect |
|---|---|---|
| 1 | "I don't know why I did that..." | nothing |
| 2 | "Well I'm not really sure what I expected. I hope I didn't contract any horrible diseases..." | 1 damage |
| 3 | "Well that was disgusting! It had dirt, sticks and leaves in it! I do feel oddly invigorated though..." | Defence +2 |
| 4 | "Eugh! I don't feel too good..." | poison, severity 2 |

Only the poison outcome is recorded. Its order is: the poison first ("You have been poisoned!", varp 102
set to 2), then the line with the `chatsad1` chathead. The chatheads of the other outcomes are ours.

The Wiki adds that a bowl, jug, bucket or vial used on the bath gets "There really isn't enough water
in here to do that."

## Beautiful scenery

The beautiful tree stump (57113), log (57112) and rock (57114) stand in the Auburn Valley. Recording
1098 tick 16910 shows the player turning to the loc on the arrival, then one tick later sitting down
(`emote_sit_loop`, 10061) with the message.

The message follows the Wiki ("You stop and admire the scenery.", Beautiful rock). Recording 1098 tick
16911 shows "You stop to admire the scenery." instead. That is the recorded difference.

Not covered: the run energy restore. The Wiki gives 20% run energy, and its own message, for admiring the
same piece a passing Vale Totems ent admires. That needs the ents walking between the totem sites.

## Oli and the stew

Recording 1098 tick 15381 shows stew used on Oli (13318). On the arrival the stew leaves the inventory
and an item box shows it with "You give the stew to Oli and he gets it down in a flash.". The league
task completes on that tick. The conversation then continues one line per click:

| Speaker | Line | Chathead |
|---|---|---|
| Oli | "Thanks! That sure is tasty!" | `chathap1` |
| Player | "Do you want some... more?" | `chatquiz1` (the player also plays `emote_think`) |
| Oli | "No, I'm not greedy!" | `chatang1` |

## Aldarin vineyard

Sources: recording 1098 (ticks 11955-16598), recording 1105, and the Wiki's Vineyard foreman, Grape
barrel and Grapevine pages.

**Ripe vines**
- A player arriving in Aldarin gets four ripe vines of their own (1098 tick 11955, the quetzal landing).
  This happens before they have a barrel.
- The vines are kept across logins: 1105 resumes with the same four.
- Each ripe vine sparkles every tick while it is within about 53 tiles: `map_anim_specific` with
  `league_trophy_glint_spotanim_silent` (3005) at height 50 on the vine's tile.

**Picking**
- Pick on a ripe vine happens on the arrival. The player is set busy and plays `picking_mid_short`.
- A tick later, synth 2581 plays (delay 28).
- Two ticks after the arrival, the message arrives and that vine is picked. The message is "You pick some
  grapes and place them in your grape barrel (N/4).", and for the fourth set "Your grape barrel is now
  full. You should return it to the Vineyard foreman." in `<col=229628>`.
- Pick on an unripe vine, also on the arrival: "Those grapes don't look ripe enough to pick yet.".

**The barrel**
- Check: "The grape barrel is empty." / "The grape barrel is full. You should return it to the Vineyard
  foreman.".
- A new barrel from the foreman starts empty. If the player's batch was already picked from (a barrel lost
  part-full), a fresh batch of four ripens with it, or the barrel could never be filled (ours). An
  untouched batch stays, as live keeps the vines ripened on arrival.
- With no room for the 5 noted grapes at the hand-in, they land at the player's feet (ours, unrecorded).

**Handing it in**
- The foreman's full-barrel dialogue variant plays when the player carries a full barrel.
- On his "Great work! Here, keep some grapes as payment." line, the player gets 5 noted grapes, the
  barrel empties and four new vines ripen.

Ours and recorded differences (besides the two above):
- **Which vines ripen** is ours. Live numbers its ripe vines in the 6-bit varbits 11343-11346
  (`aldarin_grapes_position_1..4`) by an index list the cache doesn't carry. The six indices recorded are
  6 = 1355,2933; 9 = 1364,2933; 10 = 1354,2931; 14 = 1356,2929; 16 = 1358,2913; 21 = 1361,2909. This
  server picks from every Pick grapevine of the three vineyards and sends no position varbit.
- **Check on a partly filled barrel** and **Pick with no barrel** use our own lines.
- **When the vines refresh**: live ripened one new vine on the tick the barrel filled (1098 tick 16588),
  and the other three at the hand-in. The Wiki says they refresh only after the turn-in, which this
  server follows.
