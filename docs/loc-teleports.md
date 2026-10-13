# Loc teleports from captures

Ladders, stairs, caves, holes and tunnels that did nothing in tsps (or went the wrong way) now move the player as live OSRS does: the same destination, animation, sound, fade and timing. They come from the [rsprox capture database](https://rsprox.net/database), not from a hand-written list.

- **Data:** `server/plugins/world/data/loc-teleports.json`, one entry per loc placement and option.
- **Trapdoors:** `server/plugins/world/data/loc-swaps.json`, trapdoors whose Open and Close swap the loc for its other state.
- **Plugin:** `server/plugins/world/LocTeleports.plugin.js` plays the entries.
- **Sync:** `server/scripts/sync-loc-teleports.cjs` writes the data from the captures. Its rules are in `server/scripts/loc-teleport-matching.cjs`, and its lasting decisions in `server/plugins/world/data/loc-teleport-sync.json`.

## The captures

The capture index lists every loc option that moved the player, per loc and clicked tile:

```sh
python3 rsprox_index.py loc-teleports --out loc-teleports.json
```

Per loc: the destinations (and the tile the player clicked from, for locs used from either side), the tick of the move, the player's animation, sounds, whether the screen faded, the messages of attempts that didn't move anyone, a dialogue choice on the way, and labels for instances, boats, agility shortcuts and Leagues or event worlds. Ticks count from the player arriving at the loc.

## The sync

```sh
cd server
yarn build
yarn sync:loc-teleports --captures loc-teleports.json            # dry run: what it would add, and why the rest is left out
yarn sync:loc-teleports --captures loc-teleports.json --write    # add them
yarn sync:loc-teleports --captures loc-teleports.json --report report.json   # every loc's outcome
```

**What tsps does now:** each captured loc is clicked in a headless world with every plugin loaded. The player stands on the tile the capture shows they clicked from, has 99 in every skill, and for a multiloc the varbit shows the variant with the option. The sync then compares where they end up with the capture.

**Taken** when all of these hold:
- **The kind:** a ladder, staircase, steps, trapdoor, manhole, rope, cave, hole, tunnel or crevice, or a door, gate, doorway, passageway or entrance that moves the player, by the loc's name in the rev 241 cache. A door that only opens in place never moves anyone, so it isn't captured.
- **What tsps does:** nothing, or Ladders takes it and goes nowhere or elsewhere.
- **One destination:** or one per side, for a staircase used from either end.
- **No requirement:** no attempt was turned away, or the gate is decided (see [Gates](#gates)). Messages of attempts that didn't move anyone count as a refusal unless they are something else going on:
  - status lines the game colours (prayer drained, potion effects, diary and Slayer task completions);
  - level-ups, food and potions, poison, chat channels, music unlocks, the desert's thirst;
  - "I can't reach that!" (the click never got there);
  - other features' own lines (a seed pod, an ectophial, a boat docking).

**Left out**, with the reason in the dry run:
- **Labelled locs:** instances, boats and agility shortcuts. Leagues and event worlds count as the normal game, apart from `league*` content.
- **Already right:** tsps already goes there.
- **Another plugin's loc:** Agility, quests, the Stronghold of Security, the Werewolf course. Content that claims a ladder through `ladders:climb` counts as its owner.
- **Travel networks:** one loc with far-apart destinations and no dialogue, where an interface picks the destination: spirit trees and the Magic Mushtrees have their own plugins ([spirit-trees.md](spirit-trees.md)); the shipyard portal is Sailing's.
- **Dialogue choices:** "Climb up or down?" where the captures saw only one answer. Ladders keeps asking.
- **Several destinations from one tile:** something other than where the player stands decides.
- **Decisions:**
  - Sailing and the shipyard;
  - minigame, raid and boss areas (Theatre of Blood, Guardians of the Rift, Tempoross, Giants' Foundry and more);
  - holiday events;
  - the Dagannoth Kings' ladder, which picks a boss instance;
  - Fossil Island's underwater caves, which need diving gear;
  - one ladder only seen on a Leagues world.

Nothing is removed, and the plugin's own entries are ignored while probing, so a second run adds nothing.

## The first run (2026-10-09)

From 4,282 recordings: **346 locs** added.
- **By name:** 91 ladders, 67 stairs, 28 caves, 27 cave entrances, 24 staircases, 14 ropes, 12 trapdoors, 11 steps, 11 tunnels and more.
- **Fades:** 63 fade the screen.
- **Two-way:** 4 are used from either side.

Examples:
- **Caves:** the Tlati dragon nest cave, the Haunted Mine, Lithkren, the Wilderness boss caves, Waterbirth and the Dagannoth Kings' dungeon levels, the Hunter Guild's cave and ropes, the Smoke Devil and Stronghold Slayer caves.
- **Ladders and stairs:** Varrock Museum's basement stairs, the Lunar galleon's pier, cellar ladders that led to the wrong floor (the one at 3084,9672 went up a floor underground instead of to the surface), the Arceuus library stairs (Ladders asked "which way?" where the game goes one way).

Every entry was clicked again with the plugin loaded, and all 346 land where live OSRS does (the open trapdoors in their opened state).

## Gates

Locs live OSRS turned some players away from need their requirement before they can be added. It's decided by hand in `loc-teleport-sync.json` under `requirements` (from the Wiki), with the captured refusal. The sync copies it into the entries, including ones already in the data, and the plugin checks the gates in order before the move.

**Requirement kinds:**
- a total level;
- worn items (any one set);
- an item used on the loc once before, which stays (a rope tied to a crevice).

**Refusal kinds:**
- a game message;
- a message box;
- an NPC's line.

| Loc | Requirement | Refusal (captured) |
| --- | --- | --- |
| Chaos Temple ladder (2939, 3518) | Total level 500 | "You need a skill total of 500 and a set of Zamorak robes equipped to go upstairs." |
| | Zamorak monk robes or Zamorak robe top and legs, worn | The Monk of Zamorak: "You better dress appropriately, if you want to go up there!" |
| Mos Le'Harmless underwater stairs (3788, 9254) | A fishbowl helmet and diving apparatus worn, or the Medallion of the Deep | "You cannot go diving without your diving helmet and diving apparatus!" |
| The Elid crevice (all three tiles) | A rope used on it once | A message box: "That looks too steep to safely climb down with just your bare hands." |

The skill total's number is scrubbed in the captures (`#`), so 500 comes from the Wiki. Using a rope on the crevice ties it and goes down ("You climb down the rope."), as do later climbs; the rope isn't used up, as captured.

**The second run (2026-10-09):** the sharper refusal rule let 47 of the 175 refused locs through.
- **8 added:** Araxxor's outer web tunnel, Venenatis's cave exit, the Myreque lab stairs, the Stronghold Slayer cave's exit tunnel, the Lost Tribe cellar hole, a Fossil Island cave staircase, the Contact! boss ladder, and Enakhra's temple ladder (tsps went to the wrong floor).
- **12** tsps already handles (Barrows' crypt stairs).
- **The rest** fall to other rules.

The three gates above were added too: 357 entries. Most of the 128 still refused belong to minigames, raids, quests or other plugins (ToA's raid entry, the Royal Titans, the Werewolf course), or aren't ladders, stairs or caves.

## Doors, gates and passageways (2026-10-09)

The third run took the doors, gates, doorways, passageways and entrances that move the player: **61 locs**, 418 entries in all.
- **Tarn's Lair:** its 26 passageways.
- **Prifddinas:** the city gates in and out (Song of the Elves, which this server doesn't have, so they open).
- **Quest areas:** Enakhra's four secret entrances, the Lithkren vault's broken doors, the Lunar Diplomacy base's solid doors, the Dorgesh-Kaan bone door, the Monkey Madness II cavern, the Crypt of Tonali.
- **The Dorgesh-Kaan train:** the dwarf and goblin station doorways.
- **Osman's gates:** the four seasonal ones.
- **Smaller:** the Imcando crypt doors, the Quetzacalli gates, the ruins entrance near Falador.

**Left out by decision:**
- **Minigames and bosses:** the Mage Training Arena's teleports, Zalcano, Nex, ToA, the Royal Titans.
- **The Brimhaven Dungeon's entrance:** a fare paid through a dialogue.
- **The Kalphite Lair's entrances:** a rope used on them is used up and sets the `kalphite_chamber_entrance_rope` varbit, which shows the roped version, so that state has to be kept.
- **The Myreque hideout's doors:** In Search of the Myreque gates them.

## Locs that ask first (2026-10-09)

Some options ask a question before moving the player. The captures record only the answer picked, so each question and its full option list come from the recordings (the `chatbox_multi_init` script's arguments) and are decided by hand in `loc-teleport-sync.json` under `dialogues`.
- **`go`:** the options that lead to the captured destination.
- **`ladder`:** hands a direction the captures never saw to Ladders, which finds it on the map.
- **`answer`:** the ticks counted from the answer. The captured ticks count from arriving, so they include reading the question.

| Loc | Question and options | From the answer |
| --- | --- | --- |
| Varlamore thieving houses' windows (3) | "Climb out of the window?" Yes. / No. | climb and sound on tick 1, out on tick 2 |
| The cliff door (2445, 3165) | "Climb down the cliff?" Yes. / No. | fade on tick 1, down on tick 5 |
| The Gnome Stronghold's fence opening (Monkey Madness II) | "Leave the Gnome Stronghold?" Yes. / Yes, and don't ask again. / No. | fade on tick 1, out on tick 3 |
| The row boat off the island (2786, 3536) | "Do you want to leave the island?" Yes / No | fade on tick 0, across on tick 2 |
| The Cook's guild's middle ladder | "Climb up or down the ladder?" Climb Up. (captured) / Climb Down. (Ladders) | climb on tick 0, up on tick 1 |
| The Waterbirth dungeon's iron ladder | "Climb up or down the ladder?" Climb Down. (captured) / Climb Up. (Ladders) | as the other ladder (its answer isn't recorded) |

"Yes, and don't ask again." goes on like Yes. It doesn't stop the question being asked next time.

**Left for their own work:**
- **The damaging Fossil Island mushroom jump:** it hurts the player.
- **Callisto's cave:** a 50,000-coin fee.
- **The boat networks:** Fossil Island's rowboats, the Myreque boats between Burgh de Rott, Meiyerditch, the Icyene Graveyard and Slepe. Their rides run longer than the capture window, so the arrival isn't recorded for every stop.
- **Owned by other plugins:** the Wilderness agility pipe, Wintertodt's door, the Revenant caves' fee, the Edgeville lever.

## Exits, lifts and wells (2026-10-09)

Locs of other kinds that are a plain move are taken by name, under `include` in `loc-teleport-sync.json`: **14 locs**, 440 entries in all.
- **Exits:** the Fossil Island Slayer cave, the Brimhaven Dungeon, a Wilderness boss escape cave, the Lighthouse dungeon.
- **The Haunted Mine's lifts** (4).
- **The Regicide temple's wells** (2).
- **Tapoyauik's lift platforms** (2).
- **Desert Treasure II:** the war-room rubble.
- **Zanaris's crop circle** to Puro-Puro. The wandering crop circles are hidden by a varbit on this server.

**Runecrafting altars' exit portals** (11): "Use" inside an altar now leads back outside its ruins, with sound 200 and "You step through the portal...", in the Runecrafting plugin, which owns the altars. The landing tiles are its ruins tiles. They match the captured exits for the earth, fire, water, nature and cosmic altars exactly; the other six are walkable. The captures' other exits, to the Temple of the Eye, are Guardians of the Rift's.

**Rune Essence mine portals** (loc 34825, Use): back to where the player stood when a wizard teleported them in (Wiki), which the Runecrafting plugin records on the way in (`runecrafting:essence-mine-return`, saved). As captured (rev 226-228): on arrival "You step through the portal..." with the portal casting Curse at the player (projectile 109, graphic 110), and the teleport and sound 200 a tick later. With nothing recorded, the landing is beside Aubury (3252, 3400), a captured exit. OSRS puts each player in their own copy of the mine and uses portal NPCs there (3087, 9411, shown through 3086 by varbit 2313); tsps keeps the shared mine and its portal locs.

**Not taken, and why:**
- **Owned by other systems:**
  - the cosmic altar's ruins need a talisman or tiara (Runecrafting's);
  - the Dig Site winch needs a rope tied (Dig Site is a quest here);
  - the Great Brain Robbery statue leads underwater.
- **Boats:**
  - Fossil Island's rowboats: the barge and Digsite trips were never recorded;
  - the Myreque boat network: Burgh de Rott, Meiyerditch, Icyene Graveyard and Slepe. Three of its four boats only show at Myreque quest stages this server doesn't have. Their rides are a fade, the move 10 ticks later, and the fade back in on tick 12, for when those quests exist.
- **What's left that does nothing** (about 160):
  - **Agility-style obstacles (about 110):** Meiyerditch's floorboards, shelves and walls; Isafdar's tripwires, leaves and hand-holds; Tarn's Lair's pillars and ledges; the Lunar area's bridges and walls; Ghosts Ahoy's rocks; Enakhra's sand piles; God Wars' ice bridges and rock ropes; Mort Myre's tree bridges; the Agility Arena; the Fremennik rope bridges; stepping stones. They need levels, xp, failure chances and damage, which belong in the agility shortcuts.
  - **The rest:**
    - Hunter pitfalls (the Hunter skill);
    - the Runecrafting ruins' Enter (a talisman or tiara);
    - travel carts and boats (fares);
    - Zanaris's fairy ring;
    - Recipe for Disaster's Sq'irk trees and portal;
    - quest one-offs (Surok's portal, the penguin base, Sins of the Father's walls, Zogre's barricade, the Holy barrier);
    - the Wise Old Man's telescope;
    - Sarachnis's web (needs slashing).

## Quest plugins that took every copy of a loc

Two quest plugins handled a loc by id alone, so every placement of it went to the quest's spot:
- **Monk's Friend:** its thieves' cave ladder is the ordinary cellar ladder (17385, `ladder_from_cellar`). Every such ladder without a better handler sent the player to the cave exit in Ardougne, among them the cellar under the trapdoor north of Paterdomus (3405, 9907) and two cellars at (2837, 9927) and (2845, 9925). It now only takes the cave's own ladder (2561, 9622).
- **In Search of the Myreque:** all five Mort Myre cave tunnels (5046) led to one tile. The quest no longer handles them, and each goes where the captures show.

The sync had left these ladders and tunnels alone as another plugin's. With the quests fixed, the captures cover them.

## The Karamja volcano

The Karamja and TzHaar plugins skipped the volcano dungeon: the rocks went straight to the TzHaar city, and the city's exit straight to the surface. Now it goes as in the game:
- **The rocks** (2856, 3168): into the dungeon, below the side the player stands on (captured: from 2855 to (2855, 9568), from 2858 to (2858, 9568)).
- **The dungeon's cave entrance** (2863, 9571): to the TzHaar city at (2480, 5175), the tile the city's exit is used from in the captures. The entrance itself has none.
- **The city's exit** (2479, 5176): back into the dungeon at (2862, 9572), as captured.
- **The climbing rope** (2856, 9569): up beside the rocks, on the side it's climbed from. It has no capture and mirrors the way down; it only goes up, so Ladders no longer asks which way.

Gemstone Crab's cave and the Stronghold of Security's ladders differ from the captures because their plugins handle them, and they work as intended. The Wyvern cave shortcut is left as it is.

## Trapdoors

Many trapdoors have to be opened before they can be climbed down: Open swaps the loc for an open trapdoor with Climb-down, and Close swaps it back. The captures show it for 7 trapdoors, written by hand into `loc-swaps.json` with the captured message, animation, sound and ticks:
- Draynor's (`vampire_trap1`);
- the common trapdoor used in many places (`trapdoor`);
- Port Phasmatys (`ahoy_trapdoor`) and its brewery;
- the Champions' Guild;
- the Myreque hideout;
- the Paterdomus mausoleum.

For Draynor's: "You open the trapdoor." a tick after arriving, the open-chest animation and sound a tick later, the open trapdoor on tick 3. The swap is seen by everyone, as the game sends it to the whole area. Draynor's open trapdoor has no Close in the rev 241 cache, so it stays open.

Plugins that own a trapdoor (Edgeville's, the Werewolf course's) load first and keep it; Varrock's manholes stay with Misthalin. An open trapdoor is only on the map once opened, so the sync opens it while probing its Climb-down.

## Playing an entry

The click is handled the tick after the player arrives, so each captured tick comes one tick earlier from the click:
1. **The animation's tick:** the animation and sound, and the fade out when there is one.
2. **A tick later:** the minimap goes off.
3. **The captured tick:** the move.
4. **After the move:** the fade back in a tick later, and the overlay closed two ticks after that.

Movement is blocked meanwhile. The sequence stops if the player is moved, dies or logs out.

**Stairs without an animation:** live OSRS turns the player towards the stairs a tick after they arrive and moves them later, with no animation. The Arceuus library stairs move them on tick 3 in both recordings, Varrock Museum's on tick 2.

**Taking the click:**
- **Locs nobody else handles:** the plugin's generic object hook takes the click when the clicked tile and option have an entry, or the loc and option have a trapdoor swap.
- **Ladders and stairs Ladders handles:** Ladders asks other plugins first (`ladders:climb`), and an entry answers before Ladders guesses from the map. See [climbing.md](climbing.md).

**Free-to-play worlds:** the plugin isn't members-only, because free-to-play ladders are in the data. FreeToPlay already moves anyone who ends up in a members area back to free land.

## Not done yet

- **Boats, portals, doors, gates and barriers:** fares, quests and requirements; among them the Holy barrier under Paterdomus, which needs Priest in Peril (no capture of the refusal yet).
- **The Kalphite Lair's rope** (a consumed rope and a varbit kept per player), and **the Brimhaven Dungeon's fare.**
- **Gates still to decide:** the Agility Arena ladder (a minute's wait after leaving), Cavey Davey's cave (a warning dialogue), and the refused locs that aren't ladders, stairs or caves.
- **Climb dialogues:** ladders whose "Climb" asks up or down, with both answers.
- **The Prifddinas agility tree ladder:** the Agility plugin sends the player to the city's coordinates on another part of the map, where the capture goes to (2269, 3393, 2).
