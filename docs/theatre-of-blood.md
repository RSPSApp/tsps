# Theatre of Blood

The raid beneath Ver Sinhaza, built from the OSRS Wiki, the cache and rsprox captures (https://rsprox.net/database; 15 recordings of the theatre, all on Leagues or Grid Master worlds). The captures set what the game shows (animations, projectiles and their timing, sounds, messages, interfaces); the numbers follow the Wiki, since those worlds change damage and timers. What neither gives is listed under [Estimates](#estimates).

It is one plugin, `server/plugins/minigames/TheatreOfBlood.plugin.js`, which delegates to one unit per area in `server/plugins/minigames/tob/`.

## Status

| Phase | What | State |
| --- | --- | --- |
| 1 | Ver Sinhaza, parties, the entrance, instancing, barriers and passages, the Vyre Orators, deaths and the jail, wipes and the retrieval chest, logouts, teleports, the HUD | Done, tested |
| 2 | The Maiden of Sugadinti and the Pestilent Bloat, the supply chests | Built, untested |
| 3 | The Nylocas (its waves from the Wiki) and Sotetseg | Built, untested |
| 4 | Xarpus, the Dawnbringer and Verzik Vitur | Built, untested |
| 5 | The vault's monumental chests, the Rewards Chest, completion counts | Built, untested |

Normal mode only. The party carries a `mode` and `TobShared.MODES` holds the per-mode numbers, so Entry and Hard mode can be added later. The Theatre's items (scythe and sanguinesti charges, ornament kits, the Avernic defender, the books) are a separate piece of work.

`::tobcomplete` still completes the room the party is in, to skip a boss while testing.

## Layout

| File | What it owns |
| --- | --- |
| `TobShared.js` | Ids, tiles, the room table, modes and helpers. |
| `TobParties.js` | Parties: members, applicants, the declined, preferences. |
| `TobRaid.js` | `Raid` and the `Room` base: instancing (its Area blocks teleports, and attacks by the jailed and by scripted NPCs), rooms in order, barriers, the HUD, deaths and the jail, wipes, leaving and logouts. |
| `Lobby.*` | The notice board's party list (364) and party information (50), the HUD in Ver Sinhaza, the entrance. |
| `Raid.*` | Barrier, passage and orator objects; deaths, escape crystals and logging back in. |
| `Retrieval.*` | The retrieval chests in Ver Sinhaza. |
| `Supplies.*` | The supply chests and their interface (405). |
| `Maiden.*`, `Bloat.*`, `Nylocas.*`, `Sotetseg.*`, `Xarpus.*`, `Verzik.*` | One room each. `NylocasWaves.js` holds the Nylocas waves. |
| `Rewards.*` | Verzik's vault, the loot interface (23) and the Rewards Chest in Ver Sinhaza. |
| `Commands.*` | Developer commands. |

Each boss file starts with a comment listing where each of its numbers comes from. The rooms share three hooks in `Raid.*`:
- `modifyHit` changes hits on the room's NPCs (caps, immunities, reflections).
- `holdsOn` keeps an NPC alive at 0 hitpoints, so the room can handle it (Verzik's phases, falling supports and pillars).
- Scripted NPCs (`__tobScripted`) attack only when their room makes them.

A room's fight starts when the leader crosses its barrier (for Verzik, when the leader says yes to her). The Maiden appears then; the other bosses wait in their rooms from the start.

## Instancing

Each raid has one `PrivateArea` over the theatre's map squares, x 3136–3391 and y 4224–4479 on planes 0–3, with rooms at their real coordinates, as for Tombs of Amascut. `world.json` marks the region multi-combat. The bosses that `npc-spawns.json` placed there (Maiden, ten Matomenos, Bloat, Vasilias, Sotetseg, Xarpus, Verzik) were removed: each raid spawns its own. `npc-spawn-sync.json` skips the region, so the Wiki spawn sync doesn't put them back.

Bosses' hitpoints scale with the team size (Wiki): 75% for up to three players, 87.5% for four, 100% for five.

## Ver Sinhaza

Ver Sinhaza's NPCs (the Vyre Orators, the Mysterious Stranger and others) were already spawned.

| What | Where | Notes |
| --- | --- | --- |
| Notice board (32655, Read) | (3662, 3218) | Opens the party list. |
| Theatre of Blood (32653, Enter) | (3678, 3216) | The entrance. |
| Chest (32656, Claim) | (3657, 3215), (3657, 3223) | Item retrieval. |

**The party list (364).**
- Script 2340 fills rows 0–44 with `name|name|name|name|name|size|preferred size|preferred combat|mode|age|`.
- The viewer's own leader is shown in white. Parties already in the theatre aren't listed.
- **The buttons are pause buttons.** Refresh, My/Make party and Friends/Clan (varbit 12988) are components 64, 66 and 67. Clicking one runs script 890, which resumes child 0, 1 or 2 of component 3 (enum 1938). The server gets RESUME_PAUSEBUTTON with that parent and child, so the plugin hooks `onInterfaceActionClick` (the child arrives in `action`), not a button op.
- **Rows** are components 18–62 (enum 1937, 45 rows). Each has a plain "View party" op (script 5220), needing the op-1 flag on its component.
- Varp 1740 is 0 for someone in a party, -1 otherwise.

**A party's information (50).** Every button is a pause button that resumes a child of component 0. Enum 1939 maps the buttons to children 0–6. Kick/Quit (script 2319) resumes 7 + row, and Accept/Decline (script 2330) 12 + row and 22 + row:

| Slot | Button |
| --- | --- |
| 0 | Back |
| 1 | Refresh |
| 2 | Unblock |
| 3 | Preferred size |
| 4 | Preferred combat level |
| 5 | Apply / Withdraw / Leave / Disband |
| 6 | Mode |
| 7–11 | Members (the leader removes them) |
| 12–21 | Accept applicants |
| 22–31 | Decline applicants |

- Script 2317 writes each member's line (`name|combat|attack|strength|ranged|magic|defence|hitpoints|prayer|completions|`).
- Script 2321 writes each applicant's line, for members and applicants only.
- Script 2323 writes the footer: the viewer's rights (0 can apply, 1 member, 2 leader, 3 applicant, 4 declined), the preferences and the mode.
- A declined player can't apply again until the leader unblocks.
- A party holds five members and ten applicants.
- The client shows a pressed pause button as waiting until the interface is redrawn, so every click redraws it.
- Scripts 2319, 2327 and 2330 use the dot form, `.cc_resume_pausebutton`, so the client's handler resumes the dot widget for operand 1.

**The HUD (28)** sits on the overlay. In Ver Sinhaza, varbit 6440 is 1 with a party and 0 without, and component 12 lists the names. Leaving Ver Sinhaza (other than into the theatre) or logging out leaves the party or withdraws the application.

**The entrance:**
1. Without a party: "You are not in a party..." with "Form or join a party" (the list) or Cancel.
2. Only the leader may go in first: "Your leader, X, must go first."
3. The first time, the death warning, then "Accept the warning and proceed?". Accepting is remembered.
4. Without an escape crystal: buy one (the Mysterious Stranger's shop, 1240), enter without, or enter and don't ask again.
5. The leader confirms "Is your party ready? (Members: N)". The others are told "X has entered the Theatre of Blood. Step inside to join them..." and follow through the entrance.

## The raid

The rooms, in order:

| Room | Arrival | Barrier into the fight | Way on |
| --- | --- | --- | --- |
| The Maiden of Sugadinti | (3219, 4459) | x 3185, from the east | Passage (3176/3177, 4422) |
| The Pestilent Bloat | (3322, 4448) | x 3304 from the east (x 3287 from the west) | Passage (3269, 4447/4448) |
| The Nylocas | (3295, 4283) | y 4255, from the north | Passage (3303, 4275/4276) |
| Sotetseg | (3279, 4293) | y 4307, from the south | Passage (3279/3280, 4293) |
| Xarpus | (3170, 4375, 1) | y 4379 from the south (y 4395 from the north) | Door (3169, 4400, 1) |
| The Final Challenge | (3168, 4303) | — | Treasure room (3167, 4324), spawned once Verzik is beaten |
| Verzik Vitur's Vault | (3237, 4307) | — | — |

The barriers and passages are in the cache's map. Each room's Vyre Orator is a loc (32756, or 32757 for the seated one) placed when the party reaches the room.

**Barriers (Pass):**
- The leader starts a room's fight ("Is your party ready to fight?").
- Once a fight is on, anyone may join it. Nobody leaves until it's won: "You must stay and fight!" (also from the orator).

**Passages (Enter, Quick-Enter):**
- Only once the room is completed ("You can't proceed until the challenge is complete.").
- The first through builds the next room and tells the others "X has advanced to Wave N. Join them...". Later ones follow into the party's room.
- Enter asks "Are you ready to proceed?" first.

**Completing a room:**
- "Wave 'Name' complete! Duration: m:ss Total: m:ss" (Verzik's room without the total).
- Everyone's hitpoints, prayer, special attack and run energy are restored, and the dead are released.

**Deaths:**
- Inside a fight that isn't won, the player waits in the room's jail with the purgatory stance (8070, RuneLite's `TOB_PURGATORY_STANCE`). Their inventory and equipment tabs are closed: "If your party survives the wave, you will respawn."
- The room is won: they come back where they crossed into the fight (in Verzik's room, where they fell).
- Everyone jailed fails the raid three ticks later. Everything a death wouldn't keep goes to the retrieval chest, and everyone is put outside at (3677, 3217) and restored. "Your party has failed."
- Elsewhere a death costs nothing: back at the room's entrance.
- Items are never dropped in the theatre.

**Logging out** (Wiki):
- During a fight it counts as a death. Logging back in returns the player to their party's room, in the jail if the fight is still on.
- If the raid has ended, a logout mid-fight is a full death: items to the retrieval chest.
- A logout outside a fight is safe: back at the party's room, or outside.

**Teleports** are blocked ("You can't teleport from the Theatre of Blood."). An escape crystal (22517, Teleport) gets out and is used up.

**Resigning:** the Vyre Orator's Talk-to or Resign: "There is no penalty for resigning now."

**The HUD in the raid:**
- Varbit 6440 is 2, and 6441 is the player's slot.
- Script 2301 sends the five names. Varbits 6442–6446 hold each slot's state: 1–27 health (hitpoints capped at 99), 30 dead, 31 elsewhere.
- The room's health bar: varbit 6447 is its kind (1 regular, 2 disabled, 3 cyan), and 6448/6449 its current and maximum hitpoints over 10.

## The bosses

Normal-mode numbers (Wiki) unless marked otherwise; see [Captured](#captured) and [Estimates](#estimates) for the rest.

**Animations:** every theatre NPC (8338–8389, except the spectator Abigaila) has an entry in `npc-combat-defs.json`.
- Blocks are `-1`: RuneLite names no block animation for any of them except Verzik's first form (8110, `VERZIK_PHASE1_DEFEND`).
- Attacks and deaths the engine doesn't play are `-1`. Without an entry, NPCs fall back to the player's punch, block and death (422/424/836) or to guessed animations.

### The Maiden of Sugadinti
- She attacks every 10 ticks, with Blackstorm or blood.
- **Blackstorm** targets the nearest player and always lands, for up to 36.5 + 3.5 × the Matomenos that reached her. Protect from Magic halves it. Half the time it drains stats by (damage + 1) / 5.
- **Blood** puts splats on every player's tile plus two near one of them. A splat hurts for 10 + 2 × those Matomenos, heals her and drains prayer. It can become a blood spawn (10%, or 20% if stood on; at most eight). Blood spawns leave trails that hurt and heal her.
- **At 70%, 50% and 30%** she changes form, and two Matomenos per player (at most ten) walk to her. Each one that reaches her heals her for twice its hitpoints. Freezing them stops them.

### The Pestilent Bloat
- It walks round the tank. While it walks, flies hit everyone it can see for up to 20 every tick (75% with Protect from Missiles), and damage dealt to it is halved.
- It walks for 34–42 ticks (38–46 the first time), then sleeps for 32 ticks and stomps on the 30th.
- It can turn round at most once every 32 ticks.
- Below 90%, hands fall while it walks. Between 40% and 60% it runs; below 40% each hit switches between walking and running.

### The Nylocas
- Thirty-one fixed waves from the east, south and west lanes come every 4 ticks. Waves stall while 12 nylocas are alive (24 from wave 20).
- **The waves** (`NylocasWaves.js`) come from the Wiki's table. Its colours give each flickering nylocas's styles in order; it shows the first two, 4 ticks each, then fights as the worded style. In wave 21's west lane the words disagree with the colours; the colours are used.
- **Each nylocas** takes damage only from its own style.
  - Small: 11 hitpoints, max hit 17. Big: 22 and 24, splitting into two small ones of any style.
  - They blow up 30 seconds after appearing (up to 18 or 21).
  - Most go for the four supports; the aggressive ones (8348–8353) go for the team.
- **Supports:** each one that falls hits the team for up to 50. The last one falling kills everyone.
- **Nylocas Vasilias** (2500) follows the last wave. It changes style every 10 ticks, which stops everyone's attack, and hits up to 70 every 4 ticks. Its melee is fully blocked by prayer; the other prayers leave 17 of 70. A hit in the wrong style is turned back on the attacker and heals it.

### Sotetseg
- It stands still and attacks every 5 ticks.
- **Melee:** a horn lunge at someone beside it, up to 45 (22 through prayer), landing a tick late.
- **Balls:** up to 50, fully blocked by the right prayer. One that isn't blocked turns protection prayers off for 3 seconds. The first (magic) ball splits into a magic and a ranged one aimed at two others.
- **The big ball** comes after 10 balls. It is shared by the 3×3 round its target and kills a lone target when two or more are in the room.
- **The maze**, at 66.6% and 33.3%:
  1. One player is taken to the Shadow Realm ("Sotetseg chooses you..."), on plane 3 at x 3354–3367, y 4311–4325. The others are pulled to (3274, 4307).
  2. The runner follows the red path (our generator) to the portal (33037), taking 1–3 every 7 ticks.
  3. The runner's tile glows red (33035) on the real maze. The others take 6.67% of their hitpoints + 15 every tick on a wrong tile, and so does anyone beside them.
  4. From the fourth row a tornado (8389) follows the path.
  5. Clearing the maze restores its Defence.

### Xarpus
- **Recovery:** it starts at 75% and doesn't attack. Exhumed (32743) rise and heal it every tick nobody stands on them: 12 for a trio and 15 for four (7, 8 and 18 for one, two and five are estimates).
- **Poison:** it spits every 4 ticks. The splat poisons the 3×3 round it, splashes on, and stays as acidic miasma (32744), which hurts 4–8 every tick. Standing under it hurts up to 9.
- **Counter:** at 25% it screeches and stares at a quadrant, turning every 8 ticks. Each hitsplat from that quadrant comes back as 50–75 poison.
- **The Dawnbringer:** once Xarpus is beaten, the skeleton (32741) in the room's north alcove gives it.

### Verzik Vitur
The leader starts the fight by talking to her; varp 1748 gives her that Talk-to (14795).
1. **Phase 1** (2000, every 14 ticks):
   - Only the Dawnbringer's special hurts her properly: other hits are capped at 10 (melee) or 3.
   - Her blast hits anyone she can see for up to 137 (half through Protect from Magic). Players behind a pillar are hidden; the pillar takes the blast instead and collapses when out of hitpoints, for up to 70 on anyone beside it.
2. **Phase 2** (3500, every 4 ticks):
   - She brings the pillars down and flies to the middle; the Dawnbringer falls apart.
   - She body-slams anyone under her, throws urns at tiles (44, halved by Protect from Missiles) and chains a lightning ball through the team.
   - She calls nylocas, which chase and explode and are hurt only by their style, and Nylocas Athanatos, which heals her unless hit with a poisoned weapon.
   - Below 35% she adds blood spells and calls Matomenos; for three seconds after a call, hits heal her.
3. **Phase 3** (3500, every 7 ticks):
   - She walks and attacks with melee (63, everyone beside her target), ranged and magic (33, half through prayer, at everyone).
   - Every fifth attack is a special, in turn: nylocas, webs, safe spots, the green ball.
   - Below 20% she attacks every 5 ticks and sends a tornado after each player. It takes half their hitpoints and heals her three times that.
- Then the treasure-room door (32738) opens, and everyone's completion count goes up: "Your completed Theatre of Blood count is: N."

## Supply chests

After Bloat and Sotetseg (Wiki):
- **Points:** each player gets supply points (varbit 6460) by their share of the damage, a band lower per death. Points carry over to the second chest.
- **The chest:** Open, then Search, shows the supplies (405). The stock and prices are enums 1952/1953.
- **Limits:** one stamina potion per chest. Someone who died in both rooms since the last chest gets only an onion.

## The vault

Verzik Vitur's vault (`Rewards.*`), from the Wiki's Monumental chest page:
- **The chests:** one monumental chest per player, at the Wiki's tiles in party order (the order is an estimate).
  - Each is a multiloc (33086–33090) on varbits 6450–6454: 0 a teammate's, 1 a teammate's with a unique, 2 the player's, 3 the player's with a unique.
  - Opening one shows the loot interface (23; inventory 612): Bank-all, Take-all, Discard-all, and Take per item.
- **Uniques:** 1 in 9.1 for the team without deaths, given to one player weighted by damage and deaths. Weights: hilt 8/19, rapier, staff and the three Justiciar pieces 2/19 each, scythe 1/19. A unique replaces the common loot.
- **Commons:** three rolls of the 1/30 table, noted. A player who did no damage gets a cabbage and a message.
- **Tertiaries:** an elite clue (3/25) and Lil' Zik (1/650).
- **Leaving:** the teleport crystal (32996, Use) leaves the theatre.
- **Unclaimed loot** stays in the attribute `tob:loot` and is claimed from the Rewards Chest (41437, varbit 11958) by the bank in Ver Sinhaza. The Wiki says it's lost on logging out; here it's kept.

## The retrieval chest

After a wipe (or a logout mid-fight whose raid ended), the stored items wait in the chest for 100,000 coins (Wiki). A second wipe before reclaiming replaces them, so the first lot is lost (Wiki). Items that don't fit in the inventory go to the bank. The items are listed in the attribute `tob:retrieval`.

An empty chest says "The chest seems to be empty. If it did have any of your items, but you died before collecting them, they'll now be lost." (not captured).

## Captured

From the rsprox recordings (ticks counted from the action or the attack):

- **Arrivals:** the Maiden (3220, 4460), the Bloat (3322, 4448), the Nylocas (3295, 4283), Xarpus (3170, 4375, plane 1), the vault (3237, 4307). OSRS builds the theatre as an instance; the captures map Sotetseg's arrival to (3294, 4315) and Verzik's to (3168, 4299), which are enclosed in this cache's static map, so those two keep their estimates.
- **Entering:** "You enter the Theatre of Blood (Normal Mode)...", sound 1952 and the fade to "The Theatre awaits..."; the move a tick later, then the fade in with the room's name. The others read "<name> has entered the Theatre of Blood (Normal Mode). Step inside to join him..." ("her" for a woman).
- **Barriers and passages:** "Your leader, <name>, must go first.", "Is your party ready to fight?" with "Yes, let's begin." / "No, don't start yet.", "Some of your party don't seem to have arrived yet. If you proceed, they will be abandoned.", "You must stay and fight!" (also said by the Vyre Orator), "<name> has advanced to Wave N. Join him...".
- **Completing a room:** "Wave '<room>' (Normal Mode) complete!<br>Duration: ... Total: ..." in red, jingle 250, and "You feel refreshed as your health is replenished.".
- **Interfaces, scripts and varbits:** the party list (364), the party (50), the HUD (28, on overlay_atmosphere), the supply chest (405), the loot (23); scripts 2301 (the HUD's names), 2306 (fade), 2307 (portal), 2308 (Sotetseg's fade), 2317/2321/2323/2340 (the party screens); varbits 6440-6449 (the HUD and the room's bar) and 6460 (supply points).
- **Music:** each room's track on arrival: the Maiden 570, the Bloat 578, the Nylocas 580, Sotetseg 584, Xarpus 567, Verzik 566, the vault 582.
- **Facing:** the Maiden spawns facing east, Verzik, Sotetseg and the others south; the Matomenos face south-west from the north wall and north-west from the south.
- **The room's bar:** varbits 6447-6449 with a maximum of 1000, the value in thousandths of the boss's hitpoints (1 normal, 2 greyed during Xarpus' recovery and Sotetseg's maze, 3 cyan for Verzik's first phase).
- **Supply chests:** closed through the fight, swapped for the open chest (32759, Search) the moment the room is won.
- **The treasure room door:** used from two tiles south of it, (3167, 4322); the row between is the throne's step.
- **Resigning:** "There is no penalty for resigning now." with "Resign and leave the Theatre." / "Do not resign.".
- **The bosses:**
  - **Maiden:** an attack every 10 ticks; Blackstorm (1577) leaves 109 cycles in and flies 10 per tile at height 0; blood (1578) leaves at 20 (the two extra splats at 45) and flies 15 per tile; sounds 176 and 3547; the Matomenos' ten spawn tiles.
  - **Bloat:** the flies (1568, and 1569 for the small ones) land 30 cycles after they leave, whatever the distance.
  - **Nylocas:** 7989/7999/8004 at players, 7990/8001/8004 on a support; ranged projectiles (1559/1561) leave at 39 and magic (1609/1610) at 25, 10 cycles per tile; detonations 7992/8000/8006 with 1565-1567; Vasilias' arrival (8075) and its attacks every 4 ticks with the ranged and magic animations.
  - **Sotetseg:** an attack every 5 ticks; 8138 melee (sound 4015), 8139 the balls (sound 3539); the ball (1606) lands 203 cycles in and splits off the player it hits into a magic (1606) and a ranged (1607) ball at two others; the big ball (1604) lands 480 cycles in; a wrong maze tile turns red (33036) with explosion 505, sound 3970 and a zap (1603) at whoever it hurts; the realm's drain (1608).
  - **Xarpus:** a spit every 4 ticks (8059, sound 4018); the spit (1555) and its splashes, the exhumed's orb (1550) and the guano under it (1557), each with its own timing and arc; "Screeeeech!" at 25%.
  - **Verzik:** phase 1's blast (1580) leaves two ticks after her animation, 15 cycles per tile; phase 2's urns (1583), lightning (1585), blood (1591), purple ball (1586) and the Athanatos' globules (1587/1588, landing 22 cycles in), with her sounds (1514, the bounce's 1021/3201, the heal's 684); phase 3's ranged (1593) and magic (1594) on the animation's tick, the webs (1601, up to 10 cycles apart), the power blast (1596), the green ball (1598); "You think you can defeat me?" as the pillars fall, "Behold my true nature!" for phase 3, "I'm not finished with you just yet!" at 20%.
  - **Death sounds:** the Bloat 3971, Xarpus 3549, Verzik 4008.

## Estimates

Neither the Wiki, the cache nor the captures give these:

- **Tiles:** Sotetseg's and Verzik's arrival tiles ((3168, 4298) is solid in this cache, so Verzik's arena's south edge (3168, 4303) is used); every room's orator, spectator and jail tiles, Verzik's treasure-room door, and the spot outside the entrance. One of Xarpus' jail tiles, (3183, 4387), is open floor while the others are wall alcoves.
- **Dialogue (our wording):** the entrance's warnings and the crystal question, the Vyre Orator's other lines, the passage's "Are you ready to proceed?", "You can't teleport from the Theatre of Blood.", the supply chest's and the empty retrieval chest's messages, the Dawnbringer's.
- **Bosses:**
  - **Maiden:** blood 1 time in 4 (the captures show about one throw in five attacks); splats lasting 10 ticks; the blood-spawn roll; trails.
  - **Bloat:** the loop's corners; flies spreading to neighbours; the hands' count, timing and stun; the odds of turning.
  - **Nylocas:** the supports' tiles, attack spots and 500 hitpoints; Vasilias' spawn tile; where the lanes start (the tunnels are solid in the map); which supports each lane goes for; explosions reaching a tile round them; the supports' animations (8073/8074, RuneLite's names; no capture has one falling).
  - **Sotetseg:** melee or magic half the time beside it; the maze generator and the realm's tiles; the pulled-to and return tiles; the tornado's 35-45; a solo big ball's 70; the big ball's damage between the Wiki's 121 (two players) and 188 (five); where the portal stands.
  - **Xarpus:** the exhumed's timing (every 13/8/8/4/4 ticks for 1-5 players), their 11-tick life and heals (20/16/12/9/6); the splash rules; the pauses round the phases; the quadrant corners.
  - **Verzik:** her tiles and the pillars'; the blast on a pillar (40-60); phase 2's attack order, the nylocas' fuse (25 ticks) and falloff (63/26/8), Athanatos' life and heals, the blood spell's max (29), the Matomenos' tiles; phase 3's web spin (35 ticks; webs burst after 12 for up to 40), the safe spots' 80, the green ball's bounces; phase 2's projectiles land on whole ticks in the captures, so their per-tile rates are fitted.
  - **The vault:** the chests' order and facing, inventory 612, the opening animation (536).
- **Rules:**
  - Completing a room restores special attack and run energy too.
  - The jailed return to where they crossed in; the jail tiles are used in turn.
  - A wipe needs everyone in the party jailed, so someone who stayed outside the fight keeps the raid going.
- **Supply points:** the grading by damage share.
- **Vault:** each death costing a fifth of a player's standing (in the unique chance, the unique weighting, common amounts and tertiaries); the Rewards Chest's varbit values.

## Not done yet

- Spectating, and Abigaila.
- The Mysterious Stranger's first conversation before the notice board.
- The retrieval interface: the chest uses a dialogue.
- The escape crystal's Configure, auto-activation, use on a teammate, and its worn mode.
- Xarpus' absorbed exhumed don't raise its stats or poison damage.
- MVP points, the personal and party stats, the scoreboard, and combat achievements.
- Entry and Hard mode, and the Theatre's items (separate work).

## Developer commands

| Command | What it does |
| --- | --- |
| `::tob` | To Ver Sinhaza, by the notice board. |
| `::tobcomplete` | Completes the room your party has reached. |
| `::tobroom <room>` | Moves your party to a room (`MAIDEN`, `BLOAT`, `NYLOCAS`, `SOTETSEG`, `XARPUS`, `VERZIK`, `REWARDS`). |

The Theatre of Blood is also in `::teleports` under Minigames.
