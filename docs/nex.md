# Nex and the Ancient Prison

Nex (https://oldschool.runescape.wiki/w/Nex) and the Ancient Prison under the God Wars Dungeon, built from rsprox captures (https://rsprox.net/database), the OSRS Wiki and the cache. One plugin, `server/plugins/bosses/Nex.plugin.js`, with one unit per part in `server/plugins/bosses/nex/` and its data in `server/plugins/bosses/data/nex.json`.

The captures are all from Grid Master and Leagues worlds (revision 234): recordings 806, 807, 808 and 3284 (38 kills, all in private fights), 801 (the prison, the public barrier and Peek) and 819 (the Ancient Forge and the anvil). They are trusted for packets, animations, graphics, sounds, messages and timing; damage, max hits, accuracy, costs and drops come from the Wiki. Leagues-only noise in them is ignored (`league_guardian` 12589, seqs 386/390/10634, spotanim 3068, relic messages). Where neither records something, it is marked **ours** below, or **RSPS-only** where no OSRS source has it (unverified: to check against a capture when one shows it).

## Layout

| File | What it owns |
| --- | --- |
| `Common.Nex.js` | The data, saved attributes, ancient essence, shouts, sounds, projectiles, styled hits, typeless damage and heals. |
| `Prison.Nex.js` | The prison's Area, the frozen key and doors, the prison's two doors, the plaque, the scoreboard, the altar. |
| `Chamber.Nex.js` | The public chamber's Area and arena, the barrier's state, Pass (normal) and Peek, the spawn timer. |
| `Instance.Nex.js` | Private fights: Pass (private), starting and joining, the instance and its arena. |
| `Fight.Nex.js` | A fight in either arena: the spawn, phases, targeting and movement, hits on her, the HUD, music, Wrath, kill counts. |
| `Attacks.Nex.js` | Her standard attacks and the prayer rules, Soul Split and Turmoil. |
| `Specials.Nex.js` | Her specials and what they leave on players (the virus, the darkness, freezes, the ice prison), the blood reavers. |
| `Mages.Nex.js` | Fumus, Umbra, Cruor and Glacies. |
| `Loot.Nex.js` | Shares, the MVP and each player's loot. |
| `Reclaim.Nex.js` | The reclaim chests. |
| `Items.Nex.js` | Ecumenical key shards, the Zaryte crossbow, nihil dust. |
| `Forge.Nex.js` | The Ancient Forge and Torva repair at the anvil. |
| `CombatAchievements.Nex.js` | Her kill count for Combat Achievements and her eleven tasks. |
| `Commands.Nex.js` | Developer commands. |

Changes outside the plugin:
- **God Wars:** `godwars.json` gains `ancient` (Zaros's essence, varbit 13080, the prison's followers 11290-11293). It is in `Common.GodWars.essenceGods`, so the overlay shows it, the climb down clears it, `::essence 40 ancient` sets it, and it is saved. `Dungeon.inGodWars` counts any Area with `isGodWarsArea` (the prison and both chambers), so the essence overlay stays up through the frozen door.
- **Combat Achievements:** `combat-achievements:tier` `{ player, tier: "Hard" }` comes back with `unlocked`, for content behind a tier (private fights). "Nex" is counted by event (`monsters.json`).
- **`npc-combat-defs.json`:** Nex's forms (attack 9180, no block, death 9184), the mages (1979/424/836), the prison's minions and both blood reavers (9194/9196/9192).
- **`npc-spawns.json`:** the prison's spiritual warriors, rangers and mages were the God Wars factions' ids (2210/2242/3161); they are the prison's own (11290/11291/11292), as captured. Ashuelot Reis is 11289, the form with Bank and Collect.
- **`music-data.json`:** region 11601 (the barrier, safe room and chamber) plays "The Ancient Prison" (709), as captured; the fight changes it.
- **`item-gameplay.json`:** damaged Torva can't be worn (Wiki).
- **`npc-drops.json`:** her table's paired drops ("dropped together" on the Wiki) are one entry each with a `bonus_drops` item.

## The Ancient Prison

| What | Behaviour | Source |
| --- | --- | --- |
| Area | Part of the God Wars Dungeon: the essence overlay stays up. Multi-combat. The chamber is cut out of its boundary (an actor keeps an area while inside it). | Wiki, ours |
| Followers | Spiritual warriors, rangers, mages and blood reavers attack anyone not wearing a Zarosian item (by name: "ancient ", "zaryte ", "torva ", "virtus ", "... of darkness", ring of endurance; not the ancient hilt). Each one killed in the prison is a point of ancient essence. | Wiki |
| Logging out | In the prison proper or a chamber: back in the entry room. | Wiki |
| Frozen key | The four generals' pieces "Assemble" into the frozen key (26356). Using it on the Frozen Door (42840/42841) from the God Wars side unseals the door for good (`nex:frozen-door-unlocked`); without it, one of six laments. The two messages are ours. | Wiki, ours |
| Frozen Door | Fade, the move two ticks later, fade back (the God Wars doors' fade). The prison side (42931/42932) leads back up. | ours |
| Outer prison door (42933) | First time: "Go through the door? It could be dangerous." Yes. / Yes, and don't ask again. / No. Then the turn east, the door swinging open (26506 and 26507) with sounds 71 and 70, the step through. | capture |
| Inner prison door (42934) | Into the safe room: 40 ancient essence (spent) or an ecumenical key ("Your ecumenical key melts into the door."). Short: "This door is locked by an ancient power!<br>You need to collect at least 40 Ancient essence before it will open." Then the same swing. Out is free. | capture, Wiki |
| Ashuelot Reis | 11289: Talk-to, Bank, Collect. | cache |
| Plaque | Its verse (a message box). | ours |
| Scoreboard | Your kills and deaths; the world's kills, deaths and best time over public and private fights, saved in `data/saves/nex-scoreboard.json` (plugins have no world store; as the Doom's). | ours |
| Altar (42965) | Pray: not in combat ("You need to be out of combat to use this altar.", RSPS-only); Prayer restored, and with a Zarosian item worn also hitpoints, run and special attack energy ("Your affinity to the Empty Lord energizes you further."); once every ten minutes. Teleport: out to the safe room's door (from a private fight, out of the instance), "You are teleported to a place of relative safety." (RSPS-only). | Wiki, RSPS-only, ours |

## The barrier and the chamber

The barrier at (2909, 5202) is a multiloc on varbit 13184 (`nex_barrier`), as captured: **1** outside it (Pass (normal), Pass (private), Peek), **2** inside with no fight, **3** during one (no options). While a public fight is on, the tile holds the busy version (42968). Its options are hooked by op slot on 42967/42968 (the placed multiloc's own name is "null").

| What | Behaviour | Source |
| --- | --- | --- |
| Pass (normal) | Into the public chamber, unless a fight is on: "The fight with Nex is already in progress. You'll have to wait until the next fight begins." A player whose items wait in a reclaim chest is asked first. From inside: "You can only exit by using the altar." | capture, ours |
| Peek | "There are 2 adventurers on the other side of the barrier.<br>Nex is imbued with smoke." | capture |
| Spawn | 54 ticks after the first player is in; 37 ticks after each kill while anyone is there. | capture (private fights) |
| Pass (private) | "Select an option": "Start a private fight (your friends will be able to join you).", "Join a private fight.", "Do nothing." | capture |
| Starting | Needs the Hard Combat Achievements and 100,000 coins (Wiki; the Grid Master captures took no fee). The warning: "You are about to begin an encounter with Nex. Dying during this encounter will not be considered a safe death. After entering, you won't be able to leave using the barrier. Instead, you'll need to use the altar to teleport out. Are you sure you wish to begin?", then "Are you sure you wish to begin?" Yes. / Yes, and don't ask again. / No. (the last answer sets varbit 13183 and skips it from then on). Then `godwars_fader_init` (343) [1, 1, 1, 406:19]; a tick later the chamber is rebuilt (8x6 chunks from chunk 360, 648), varbit `godwars_instance` (11709) is 1, the barrier 2, the player at the chamber's door. | capture, Wiki |
| In the instance | The safe room's door, plaque, scoreboard, chest and the anvil are their option-less copies (42855-42858, 42860). Music goes silent (147). | capture |
| Joining | "Whose fight would you like to join? You must be on their friends list." The owner must have the player as a friend and no fight may be on. The refusals for no fight and not a friend are ours. | capture, ours |
| Lifetime | While anyone is in it; the last one out ends it. | ours (not captured) |

## The fight

`Fight.Nex.js` runs one fight in an arena: the public chamber (real tiles) or an instance (its copies). Ticks below count from "AT LAST!".

### The spawn (captured, identical in all 38 kills)

| Tick | What happens |
| --- | --- |
| 0 | "AT LAST!" (overhead and in the chatbox as Nex's line, like all her shouts). Her spawning form 11279 at (2924, 5202) facing west, seq 9182, sound 5303. Music 710 "Zaros Zeitgeist", with 710 and 711 unlocked. The HUD opens for her. |
| 5, 9, 13, 17 | "Fumus!", "Umbra!", "Cruor!", "Glacies!": she turns to the corner, seq 9189/9188/9189/9188, sound 5275/5211. The mage appears at its corner ((2913, 5215), (2937, 5215), (2937, 5191), (2913, 5191)) facing her: spotanim 409, seq 1979, sound 198, and its power to her: projectile 2010 (30 to 120 cycles, angle 3, heights 35 to 48) with sound 5286 (delay 30). |
| 21 | "Fill my soul with smoke!": her fighting form 11278. Hits do nothing until her first attack ("Nex is immune to your attacks!"). |
| 25 | Her first attack, always the virus. |

### Phases

| Phase | Line | Mage | Call | Floor | Specials (lane 1, lane 2) |
| --- | --- | --- | --- | --- | --- |
| Smoke | "Fill my soul with smoke!" | Fumus | 80% | 75% | virus, Smoke Dash |
| Shadow | "Darken my shadow!" | Umbra | 60% | 55% | Embrace Darkness, Shadow Smash |
| Blood | "Flood my lungs with blood!" | Cruor | 40% | 35% | Blood Siphon, Blood Sacrifice |
| Ice | "Infuse me with the power of ice!" | Glacies | 20% | 15% | Ice Prison, Containment |
| Zaros | "NOW, THE POWER OF ZAROS!" | - | - | - | none |

- A mage's killer gets 2 ancient essence (captured: varbit 13080 up 2).
- At the call ("Fumus, don't fail me!") the mage becomes vulnerable and fights; before it, "Fumus is currently immune to your attacks." She still takes damage down to the floor, then nothing ("Nex is immune to your attacks!") until the mage dies (captured).
- The mage dies (seq 836), the next phase's line comes a tick later and its mage sends her its power again; the dead mage is gone two ticks after its death (captured).
- An attack every 4 ticks; every 6th is a special, the phase's first 4 ticks after its line (captured). Each phase alternates its two specials and the next phase carries on in the lane of the last one used: virus leads to darkness, siphon and the ice prison; the dash to the smash, the sacrifice and containment (captured).
- Umbra's death ends the darkness; Cruor's kills the reavers, who heal her their hitpoints (Wiki).
- Zaros: seq 9179, spotanim 2016, 500 hitpoints back as a heal hitsplat (captured). Soul Split (11280) from her first attack, Deflect Melee (11281) four attacks later, none (11278) four after that, and round (captured as far as the fights went; the Wiki for the cycle).
- Her Defence can be lowered by 10 at most (Wiki). The engine's regeneration is off for her and the mages (their attacks are the fight's).
- Every hit on her: sound_area 5304 (captured).
- She keeps her target for four attacks, then the nearest other player in range (Wiki). Out of range she walks; after 9 ticks unable to attack she flies (seq 9187, a 30-cycle glide) to beside her target, immune meanwhile (captured; the Wiki for the immunity).

### Her attacks (`Attacks.Nex.js`)

Projectiles start at 46 cycles and land 10 a tile later, angle 5, progress 84 (captured); the hit lands with them. Heights are the packet's: the captures' `map_projanim_v2` prints them four times over (the same rune arrow is 40/36 in v1, 163/146 in v2). Impact graphics at their captured heights (smoke 100, Zaros and the splash 124, the rest 0). She keeps facing her target at any range (`interaction:keep`).

| Attack | Seq | Sound | Projectile, heights | Impact | Rules (Wiki) |
| --- | --- | --- | --- | --- | --- |
| Smoke | 9189 | 5256 | 1997, 25 to 24 | 1998 + 5277 | Magic, max 33, everyone; poisons (8). |
| Shadow | 9189 | 5200 | 1999, 35 to 32 | synth 5288 | Ranged, everyone, max 60 beside her down to 2 at 10 tiles; drains prayer. |
| Blood | 9188 | 5302 | 2000, 12 to 10 | 2001 + 5194 | Magic, max 33, her target and the 3x3 around them; heals her a quarter a tick later (sound 5281). |
| Ice | 9188 | 171 | 2004, 15 to 12 | 2005 + 168 | Magic, max 33, everyone; drains prayer; freezes 15 ticks unless praying magic ("You have been frozen!"). |
| Zaros | 9189 | 5285 | 2007, 25 to 24 | 2008 + 5185 | Magic, max 33, everyone; drains prayer. Protect from Magic blocks half, a quarter if raised after she cast. |
| Melee | 9180 | - | - | - | Max 27 beside her (not diagonally), three in a row then not a fourth; Protect from Melee blocks 80% (two thirds in the Zaros phase). |
| Miss | | | | spotanim 85 + 227 | |

- **Soul Split:** a projectile 2009 from the hit player back to her (0 to 60 cycles, heights 30 to 48) with synth 5237; she heals a fifth of the hit (**ours**) with sound 5281 (captured).
- **Deflect Melee:** a melee hit on her does nothing and half comes back (**ours**): "Nex deflects your damage back at you!" (captured).
- **Turmoil:** on her melee hits only, about one in four (captured: 23 of about 100): projectile 2010 to the player (0 to 30, heights 48 to 30) with synth 5193, their combat levels down 2 the next tick with synth 5280 (captured; the drain is **ours**).

### Specials (`Specials.Nex.js`)

| Special | Captured | Wiki / ours |
| --- | --- | --- |
| Virus | "Let the virus flow through you!", seq 9188, sound 5211. A tick later "You become surrounded by smoke clouds!". Coughs ("*Cough*", spotanim 1103 at height 160, synth 5213) 2, 5 and 8 ticks in, each 4 prayer and 4 of a stat; "The smoke clouds around you dissipate." 11 ticks in. | Wiki: the player furthest away with the least magic defence; spreads to anyone beside a coughing player ("Someone has spread some smoke clouds to you!" is ours); a gas mask, facemask or slayer helmet halves it; the best attack style's levels are drained. |
| Drag | When a smoke spell lands: "Nex draws you in...", the player beside her (a plain move), seq 7208, synth 3537; the next tick "You've been injured and can't use protection prayers!". | Wiki: someone 2-6 tiles away, 1/4 (1/8 praying magic). Protection prayers go off and stay blocked for 5 seconds (the engine's prayer-block timer, as Sever's); the message only when one was on (RSPS-only). |
| Smoke Dash | "There is..." with seq 9178 (delay 80) and no target; the turn to an aisle 2 ticks in; "NO ESCAPE!" at 5; at 6 to the aisle's end, 10 tiles out, and an exact move back to (2924, 5202) over 0-60 cycles; seq -1 at 9; her next attack at 12. | Wiki: up to 50 to anyone in the aisle. Nobody was ever hit in the captures, so the rest is RSPS-only: a tick into the charge everyone in the aisle is thrown (seq 1157, a forced move over cycles 30-80) to 3 tiles past her tile along the dash (ours: stopping on the last walkable tile), and the next tick "Nex dashes into you and knocks you out of the way!" and the hit. |
| Shadow Smash | "Fear the shadow!", seq 9186, a shadow (42942) under each player; 4 ticks later 29733 in its place with map animation 383 and sound 5220 (range 4), "Nex's shadow consumes you!" for anyone still on it; gone at 13. | Wiki: up to 50. |
| Embrace Darkness | "Embrace darkness!", seq 9182, sound 5240, "Darkness begins to surround Nex.". Script 5313 every tick, 50 (darkest) to 200 by distance, easing 40 a tick, 255 at the end; after 7 ticks at 50 "The darkness starts to engulf you!" and 9-17 a tick (synth 5295); 31 ticks or the phase's end, "The darkness recedes.". | The distances for each shade are ours. |
| Blood Siphon | "A siphon will solve this!", seq 9183, spotanim 2015; 8 ticks kneeling, every hit healing her. One reaver (11294) solo or duo: spotanim 2017, sound 4497; Blood Blitz with seq 9194, projectile 372, impact 373; death seq 9192. | Wiki: hitting a reaver heals you half; a reaver per three players (ours) up to 8. Reaver max hit 20 is ours; a reaver heals itself a quarter of its damage (RSPS-only). |
| Blood Sacrifice | "I demand a blood sacrifice!", sound 5223, synth 5192 and the tint (0-210, hue 0, saturation 6, lightness 28, weight 112) on the marked player, "Nex has marked you for a blood sacrifice! RUN!". 6 ticks later "You managed to escape..." or "You failed to escape...": seq 9188, sound 5182, projectile 2002 to each player hit, impact 2003 + 5239, "Nex unleashes a blood sacrifice!" to the others, her heal. | Wiki: 7 tiles to escape; up to 50 to the marked player and 12 to those beside them, a third of their prayer; she heals the damage. |
| Containment | "Contain this!", seq 9186; 5 ticks later icicles (42943) around her 5x5 and 26209 under her, sound 5199; anyone inside: "Nex's icicles spike you to the spot!", the injured message, seq 1114, synth 5297, the hit a tick later; gone after 10. | Wiki: up to 60, halved by Protect from Missiles. RSPS-only: anyone inside is held (no moving or acting) for 10 ticks. |
| Ice Prison | "Die now, in a prison of ice!", seq 9188, sound 5244, projectile 2006; on landing stalagmites (42944) around the target and 26209 under them, "You've been trapped in an ice prison!" and the injured message; 8 ticks later "The ice prison shatters and pierces your flesh!" (synth 5287) and the hit a tick after. Attack on a stalagmite: "You're frozen and unable to free yourself!" from inside, "Your weapon is unsuitable to break the ice." (bows, two-handers), "You fail to destroy the icicle!" / "You manage to destroy the icicle!" (sound 5272), "You've been freed from the ice prison!". | Wiki: up to 75; stab or crush. RSPS-only: stalagmites only on free tiles, anyone standing on one pushed a tile outward (seq 1157), the trapped player held (no moving or acting) until it shatters, the breaker's own attack animation; the break chance (25% rising to 100% with the stab or crush bonus up to 130) is RSPS-only too. |

### The mages (`Mages.Nex.js`)

A cast every 5 ticks with seq 1979, max 29, only once called (captured; the Wiki for the hit).

| Mage | Sound | Projectile | Impact | Effect (Wiki) |
| --- | --- | --- | --- | --- |
| Fumus | 183 | 390 (51, angle 16, heights 43 to 31) | 391 | Poison. |
| Umbra | 178 | - | 383 (delay 60) | "You have been blinded!" (captured); Attack down 15%. |
| Cruor | 106 | - | 377 | Heals himself a quarter. |
| Glacies | 171 | 368 (heights 43 to 0) | 369 | Freeze for 6 ticks (Mod Ash's 5-tick gap). |

### Wrath and the kill (captured)

| Tick | What happens |
| --- | --- |
| 0 | "Taste my wrath!" and her dying form 11282. |
| 1 | Seq 9184. |
| 4 | Map animation 2013 at her centre, projectiles 2012 to the ring 2 tiles out (angle 32, 16-28 cycles) with map animations 2014 where they land, sounds 5236 (delay 60) and 5241 (delay 90). |
| 5 | The HUD fades out (and clears four ticks later, BossHud). |
| 7 | Up to 50 to anyone in the 5x5 around her (Wiki), she is gone, the barrier back to 2. "Your Nex kill count is: N.", "Fight duration: m:ss. Personal best: m:ss" (or "(new personal best)"), the loot under her, "You were the MVP for this fight!". Varp 3269 (`total_nex_kills`). Music silent (147). |

**HUD:** BossHud (`boss-hud:*`) for everyone in the arena from "AT LAST!", npc id following her form (11279, 11278, 11280, 11281); BossHud's default colours are hers (25600/576/800, captured).

## Loot (`Loot.Nex.js`, Wiki)

Rolled on her table in `data/definitions/npc-drops.json` (the Wiki's drops), shared out by damage as the Wiki's drop mechanics describe:
- Everyone present with at least 1% of the damage to Nex, her mages and the reavers (the Wiki: "a set amount of minimum damage", no figure; 1% is ours).
- "Two common drops are guaranteed after each kill": two rolls of her main table make the kill's lump, and each player gets their share of its quantities.
- Uniques "1/43 ... divided by contribution": each player rolls the unique entries with their chance scaled by their share; the separate rolls (blood essence, rune sword, nihil shards, ...) and tertiaries (elite clue, Nexling) likewise.
- The MVP gets +10% quantities and unique chance, and the big bones (her table's always-drop).
- Each player's drops go through `npc-drops:roll` (collection log, Ironman rules) and onto the floor for them.
- Her table pairs the drops the Wiki says come together (sharks with prayer potions, Saradomin brews with super restores) as one entry with a bonus drop, so a main roll always lands (12 entries).

## Reclaim chests (`Reclaim.Nex.js`)

A death in either chamber: what would drop goes to the chests (42854) instead; 100,000 coins to reclaim (Wiki); dying again first loses it. The empty chest's message box is captured; the death message, the barrier's warning and the rest are ours.

## The Ancient Forge and Torva (`Forge.Nex.js`, rec 819)

- **Ancient Forge (42966), Use:** "Melt down your Bandos chestplate into 3 Bandosian components?" (tassets: 2) Yes. / No.; "You use the forge to melt the armour down into some components.", seq 899, synth 2725, the components three ticks later. Otherwise "You don't have anything suitable to put in the forge." or "You require more inventory space to do that."
- **Anvil (28563), Smith:** "Repair your Torva platebody with 2 Bandosian components?" Yes. / No.; "You set to work on the Torva platebody...", seq 898 every 4 ticks; on the 12th tick an object box with the repaired piece, "You use 2 Bandosian components to repair your Torva platebody. You feel mentally and physically exhausted.", and the Smithing XP. "You don't have anything suitable to repair your Torva platebody with." / "You need 2 Bandosian components to repair your Torva platebody.". Wiki: Smithing 90, a hammer, 2,250 XP; helm 1, body 2. Legs 2 and the Strength and Prayer drain (to about 36% and 10%, in three steps) come from one capture; the level and hammer refusals are ours.

## Items (`Items.Nex.js`, Wiki)

- 50 ecumenical key shards Combine into a key; three keys at most.
- The nihil horn on an Armadyl crossbow with 250 nihil shards makes the Zaryte crossbow (6 ticks, no skill); the prompt and message are ours.
- A pestle and mortar grinds a nihil shard into nihil dust.

## Combat Achievements (`CombatAchievements.Nex.js`)

Her kill count goes through `combat-achievements:kill` (Nex Veteran and Nex Master finish from it). After each kill, for everyone there: Nex Survivors (nobody died), Nex Trio / Nex Duo (three / two or fewer at the start), A siphon will solve this (she never healed from the siphon), Contain this! (nobody hurt by an ice special), There is no escape! (nobody hit by the dash), Shadows Move... (nobody hit by the smash), Perfect Nex (all four) and I should see a doctor (someone coughing at the kill). Names and wording from the cache.

## Commands

| Command | What it does |
| --- | --- |
| `::nex` | To the safe room, the frozen door unsealed and 40 ancient essence. |
| `::nexspawn` | Nex now in your chamber (public or private). |
| `::nexphase <2-5>` | Skips to a phase. |
| `::nexspecial <name>` | A special now (virus, dash, smash, darkness, siphon, sacrifice, containment, prison). |
| `::nexhp <n>` | Her hitpoints. |
| `::nexend` | Ends the fight without a kill. |

## Not done

- Ashuelot Reis's dialogue (rec 801 has his story) and varbit 13182.
- The scoreboard's interface (ours is a message box).
- Nex's examine and her pet's metamorphosis.
