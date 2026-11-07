# Theatre of Blood

The raid beneath Ver Sinhaza, in Entry, Normal and Hard Mode, built from the OSRS Wiki, the cache and rsprox captures (https://rsprox.net/database). The captures set what the game shows (ids, animations, projectiles and their timing, sounds, messages, interfaces); the Wiki decides numbers, because every capture of a raid is on a Leagues or Grid Master world, which change damage, timers and loot. Each unit's header comment says where each of its values comes from. [What isn't verified](#what-isnt-verified) lists the rest.

It is one plugin, `server/plugins/minigames/TheatreOfBlood.plugin.js`, which delegates to one unit per area in `server/plugins/minigames/tob/`.

## Status

| Piece | State | How it was checked |
| --- | --- | --- |
| Parties, modes, the entrance, instancing, barriers and passages | Done | Played over the agent MCP |
| The six rooms in Normal Mode | Done | Solo route played from entry to leaving, fights shortened; see [Tested](#tested) |
| Entry and Hard Mode | Built | See [Tested](#tested) for how far each was played |
| Deaths, the jail, wipes, logouts, teleports, a second party | Done | Played as scenarios; absent members no longer hold a wipe open (unit test) |
| Unclaimed vault loot lost on a new raid or logout, the collection log, the Dawnbringer's drop and pickup, Verzik's hazards at her death | Done | Unit tests (see [Tested](#tested)) |
| Retrieval chest, stats, scoreboard, escape crystal, spectating | Built | Played as scenarios; the interfaces' looks not seen in a client |
| Combat Achievements | Built | The rooms report them; several seen firing in play, most only by unit test or not at all |
| Theatre's items | See [Items](#items) | Avernic defender and kits played; scythe and staff checked against the Wiki's text |

## Layout

| File | What it owns |
| --- | --- |
| `Shared.TheatreOfBlood.js` | Ids, tiles, the room table, the modes and helpers. |
| `Parties.TheatreOfBlood.js` | Parties: members, applicants, the declined, preferences, the mode. |
| `RaidState.TheatreOfBlood.js` | `Raid` and the `Room` base: instancing, rooms in order, barriers, the HUD, deaths and the jail, wipes, Entry's retries, leaving and logouts. |
| `Lobby.*` | The notice board's party list (364) and party information (50), the mode, the Mysterious Stranger's gate, the entrance. |
| `Raid.*` | Barrier, passage and orator objects; deaths and logging back in. |
| `Retrieval.*` | The retrieval chests (602). |
| `Supplies.*` | The supply chests (405), Entry's bandages. |
| `Maiden.*`, `Bloat.*`, `Nylocas.*`, `NylocasWaves.*`, `Sotetseg.*`, `Xarpus.*`, `Verzik.*` | One room each, in all three modes. |
| `Rewards.*` | Verzik's vault, the loot interface (23), the Rewards Chest. |
| `InfoBoard.*` | The strategy table (459). |
| `Stats.*` | Attempts, completions, deaths and best times per mode, the last wave's lines, the scoreboard (363). |
| `CombatAchievements.*` | The 50 tasks' modes, failure lines, and what the raid's end decides. |
| `EscapeCrystal.*` | The crystal in the raid. |
| `Spectate.*` | Abigaila and watching a raid. |
| `Books.*` | The bosses' books and the bookshelves. |
| `Entry.*` | The Blood Moon Rises' encounters. It used to be a solo Entry Mode; that path remains only for a save finished under it. |
| `Commands.*` | Developer commands. |

Other files: `plugins/items/AvernicDefender.plugin.js`; the kits' rows in `plugins/items/data/ornament-kits.json`; `combat-achievements:has-task` in `CombatAchievements.plugin.js`.

The rooms share hooks in `Raid.*`:
- `modifyHit` changes hits on the room's NPCs (caps, immunities, reflections).
- `holdsOn` keeps an NPC alive at 0 hitpoints, so the room can handle it (Verzik's phases, supports, the Maiden's death).
- Scripted NPCs (`__tobScripted`) attack only when their room makes them.

A room reports its tasks with `raid.failTask(task, reason)` and `raid.completeTask(task)`. A task outside the raid's mode is ignored.

## Modes

`Shared.MODES` holds what differs between rooms. A room picks a value with `Shared.byMode(raid, { entry, normal, hard })`.

| | Entry | Normal | Hard |
| --- | --- | --- | --- |
| Team hitpoints | a fifth per player (Wiki: "down to 20%"; fits 2 samples) | 75%, 87.5%, 100% for up to 3, 4, 5 (Wiki) | as Normal |
| A wipe | another attempt, three bandages each; the room starts again | the raid fails | the raid fails |
| Supply chests | ten bandages per chest (not carried over) | points | points, a band lower than Normal (Wiki: fewer; see [What isn't verified](#what-isnt-verified)) |
| Loot (Wiki) | no uniques or pet, 20% common, clue 1/25 | 1/9.1, hilt 8/19, clue 3/25, pet 1/650 | 1/7.7, hilt 7/18, +15% common (+30% inside the target), clue 3.5/25, pet 1/500; inside the target, dust 1/275, Sanguine kit 1/150, Holy kit 1/100 |
| Retrieval | free | 100,000 coins | 100,000 coins |

Hard Mode needs everyone to have a Normal completion (Wiki). The leader picks the mode from the party's screen: "Select a mode. Currently set to Normal Mode." (captured). Its target is 25, 27, 30, 35 and 70 minutes for five to one players (Wiki), on the overall time, stated as "Time to beat: <col=ff0000>35:00</col>" as the first fight starts (captured).

**Hard Mode's bosses and the captures disagree.** The Wiki's infoboxes give Maiden 3500, Bloat 2400, Vasilias 2500, Sotetseg 4000, Xarpus 6000, Verzik 2000/3500/3500, and those are used. Every Hard capture's damage totals fit about 1.5x that (Sotetseg 4502/5252/6002 at 3/4/5 players, Xarpus 6751/7877/9002, Verzik 3000/5250/5250 at five), while Normal raids on the same worlds match the Wiki exactly. They are all Leagues worlds, so the Wiki stands; to follow the captures, change `HITPOINTS` in `Nylocas.*`, `Sotetseg.*` and `Xarpus.*` and `PHASE_HITPOINTS` in `Verzik.*`.

## Instancing

Each raid has one `PrivateArea` over the theatre's map squares, x 3136–3391 and y 4224–4479 on planes 0–3, with rooms at their real coordinates. `world.json` marks the region multi-combat. `npc-spawn-sync.json` skips the region; each raid spawns its own bosses.

## Ver Sinhaza

| What | Where | Notes |
| --- | --- | --- |
| Notice board (32655, Read) | (3662, 3218) | Opens the party list. |
| Theatre of Blood (32653, Enter) | (3678, 3216) | The entrance. |
| Chest (32656, Claim) | (3657, 3215), (3657, 3223) | Item retrieval. |
| Scoreboard (32987, Read) | (3676, 3223) | Statistics. |
| Rewards Chest (41437, Claim) | (3650, 3217) | Loot left behind. |

**First conversation:** someone who hasn't spoken to the Mysterious Stranger is called over at the notice board and the entrance: "Hey. Over here." (captured 234/03285 tick 23906). A completion also counts as having met him. Someone without A Taste of Hope hears the Wiki's initial lines; the quest's unit plays the rest.

**The party list (364).**
- Script 2340 fills rows 0–44 with `name|name|name|name|name|size|preferred size|preferred combat|mode|age`, as captured: no trailing bar.
- The buttons are pause buttons. Refresh, My/Make party and Friends/Clan (varbit 12988) are children 0, 1 and 2 of component 3 (enum 1938), so a click arrives as RESUME_PAUSEBUTTON, handled in `onInterfaceActionClick`. Rows are components 18–62, with a plain "View party" op.
- Varp 1740 (`tob_mycontroller` in the symbols) is 0 for someone in a party, -1 otherwise, as captured.

**A party's information (50).** Every button resumes a child of component 0:

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

Script 2323's footer takes the viewer's rights and the mode (0 Normal, 1 Entry, 2 Hard; captured). Script 2317's members and 2321's applicants are `name|combat|attack|strength|ranged|magic|defence|hitpoints|prayer|completions`. Leaving Ver Sinhaza (other than into the theatre) or logging out leaves the party or withdraws the application.

**The entrance:**
1. Without a party: "You are not in a party..." with "Form or join a party", "Observe a specific party", "Observe recent party" and "Cancel" (captured).
2. Only the leader may go in first: "Your leader, X, must go first."
3. The first time, the death warning (captured), then "Accept the warning and proceed?".
4. Without a crystal: the captured prompt, in the crystal's current name.
5. The leader confirms "Is your party ready? Members: N. Mode: X." (captured).

## The raid

| Room | Arrival | Barrier into the fight | Way on |
| --- | --- | --- | --- |
| The Maiden of Sugadinti | (3220, 4460) | x 3185, from the east | Out by the same barrier, then the passage (3176/3177, 4422) |
| The Pestilent Bloat | (3322, 4448) | x 3304 from the east (x 3287 from the west) | Out by the west barrier, then the passage (3269, 4447/4448) |
| The Nylocas | (3295, 4283) | y 4255, from the north | Passage (3303, 4275/4276) |
| Sotetseg | (3279, 4293) | y 4307, from the south | Passage (3279/3280, 4293) |
| Xarpus | (3170, 4375, 1) | y 4379 from the south (y 4395 from the north) | Out by the north barrier, then the door (3169, 4400, 1); the Dawnbringer's skeleton is on the way (3171, 4397) |
| The Final Challenge | (3168, 4303) | talk to Verzik | Treasure room (3167, 4324) |
| Verzik Vitur's Vault | (3237, 4307) | — | Teleport crystal (3246, 4315) |

A barrier of a room the party has already left lets anyone through.

**Completing a room:** "Wave 'Name' (Normal Mode) complete!<br>Duration: ... Total: ...", times as m:ss.cc, jingle 250, "You feel refreshed as your health is replenished." (all captured). The last wave's lines come from `Stats.*`: its line with "Theatre of Blood completion time" (the challenge time), "Theatre of Blood total completion time" (the overall time), each " (new personal best)" or ". Personal best: t", then "Your completed Theatre of Blood[: Entry Mode|: Hard Mode] count is: N." (captured). Inside Hard's target, "Your party beat the overall target time of m:ss!", worded as the Tombs' capture; no Theatre capture has one.

**Deaths:**
- Inside a fight that isn't won, the player waits in the room's jail. "You have died. Death count: N." and "<name> has died. Death count: N." (captured).
- The room is won: they come back where they crossed in (in Verzik's room, where they fell).
- Everyone jailed: in Entry, the room starts again; otherwise everything goes to the retrieval chest and everyone is put outside at (3677, 3217): "Your party has failed." and "A magical chest has retrieved some of your items. You can collect them from it outside the Theatre of Blood." (captured).
- Items are never dropped in the theatre.

**Logging out** (Wiki): during a fight it counts as a death; logging back in returns the player to their party's room, in the jail if the fight is still on. With an escape crystal carried, one is used up and they return outside (Wiki, 26 March 2025). If the raid has ended, a logout mid-fight is a full death: items to the retrieval chest.

**Teleports** are blocked, except for spectators and by escape crystal.

## The bosses

Each boss's unit is the reference for its numbers and their sources. What's most worth knowing:

- **The Maiden.** Attacks every 10 ticks (Hard, faster with each Matomenos that reaches her, down to 6: a fit from 10 raids). Blood 30% of the time (a fit: 86 of 276). Matomenos: 1 per player in Entry, 2 in Normal, always 10 in Hard. Hard's blood spawns take no damage and their trails stay. Hard's repeated attacks: see [What isn't verified](#what-isnt-verified).
- **The Bloat.** Walks the 12x12 loop, starting either way round. Flies hit everyone it can see for 10–20 every tick (Wiki), so a player has to time going in. They spread between players who can see each other. Hands every 6 ticks, every 4 below 30% (a fit); Hard, from the fight's start. Turn odds are a fit (5 and 6 samples).
- **The Nylocas.** 31 waves, identical in all three modes down to tile and support across 16 captured rooms. The Wiki's chart has three errors, noted in `NylocasWaves.*`. A support's hit is 1 hitpoint and its pool scales with team size (exact against the captures). Hard: Prinkipas on waves 10, 20, 30; wrong-style hits reflect; Vasilias' splash and bounce.
- **Sotetseg.** The realm's path is a column every 2nd row within 5 tiles of the last, as captured. Hard: all but one go to the realm, the maze divided among them (varbit 12269); two death balls.
- **Xarpus.** It begins at the Wiki's figure, which is 75% of its true maximum; the stare comes at a third of its risen hitpoints on the 4-tick beat (14 of 14 samples), not the Wiki's 25%. Absorbed exhumed raise its stats and poison by 1.4% each (an estimate; the Wiki gives no rate, and that's the lowest the captures allow). Hard: poison round the arena's edge, Defence 200, the stare turning to whoever hits it.
- **Verzik.** Any member may start her (captured). Phase 1: blasts behind pillars by a ray from her middle; the Dawnbringer's special, which needed `combat-special:can-use` allowed by the room. Phase 2 and 3's order, timing and tiles as captured in the unit. Hard: rubble, pools for 16 ticks, three-strike dots, a lethal green ball with two or more, a heal of 30% at 5% ("You think this is over?!" captured).

## Supply chests

After Bloat and Sotetseg (Wiki): points by the player's share of the damage, a band lower per death. Open, then Search, shows the supplies (405). One stamina potion per chest. Someone who died in both rooms since the last chest gets only an onion. In Entry the chest gives ten bandages. A bandage (Wiki) heals 20 and 20% run, restores prayer (the Wiki's amount is unknown; ours is a super restore's), cures poison, gives a stamina effect and boosts Attack, Strength and Defence by 15% + 4, Ranged by 10% + 4, Magic by 4.

## The vault

From the Wiki's Monumental chest page, by mode as in [Modes](#modes):
- **The chests:** one per player at the Wiki's tiles in party order. Each is a multiloc on varbits 6450–6454 (`tob_treasureroom_chest_0`–`4`). Opening shows the loot interface (23; inventory 612).
- **A unique** replaces the common loot; "<name> found something special: <item>", both in red (captured).
- **Commons:** three rolls of the 1/30 table, noted. A player who did no damage gets a cabbage and a message (22475).
- **Leaving:** the teleport crystal asks "Make sure you've collected all your stuff!" with "Leave the Theatre." / "Stay in the Theatre." (captured).
- **Unclaimed loot** stays in `tob:loot`, claimed from the Rewards Chest (varbit 11958 `tob_should_have_loot`). It's lost on logging out (Wiki) and on entering another raid (players' reports; the Wiki is silent), and a vault's roll replaces anything older. Lil' Zik is still delivered when the rest is lost. The loot interface's inventory (612) has six slots in the cache, but a target-time Hard roll can hold seven items (three commons, the clue, the dust and both kits); the Wiki gives no rule, so the first six show, Bank-all, Take-all and Discard-all act on those, and the rest move into view as slots empty, with a line saying more are waiting (our wording).
- **The collection log:** its one "Theatre of Blood" category (cache struct 506, 17 items) is fed when the loot interface is opened, and its kill count answers with the player's completions in Entry, Normal and Hard (the cache has no separate ToB log entries for the modes). Lil' Zik still goes through the pet delivery.
- **The strategy table (459):** each wave's time, the MVP, the challenge and overall times, each member's deaths.

## The retrieval chest

Captured (227/01764, 234/03299, 227/01833): `gravestone_retrieval` (602) over inventory 525, as Torfinn's. Its button pays first ("Payment has been taken from your bank: 100,000 x Coins"), then takes whatever fits; the rest waits. That interface is shared with `plugins/bosses/vorkath/Retrieval.Vorkath.js`, so each answers clicks only when it opened it. A second wipe before reclaiming replaces the first lot (Wiki). Everything goes in, including what a death would keep (Wiki). Entry's is free (Wiki).

## Stats

`Stats.*`, in the saved attribute `tob:stats`, per mode: attempts (each entering), completions, deaths, and the best challenge and overall time per team size. The counts stay in `tob:completions` and `tob:entry-completions` (older saves) and `tob:hard-completions`.

The scoreboard (363) has a View tab per mode (varbit 12270 `tob_scoreboard_tab`; script 4492) and a grid of text, components 41–66. No capture opens it, so which cell shows what is read off the labels' order and is unconfirmed. "Global" is the running server's totals since it started, not saved.

## Escape crystal

`EscapeCrystal.*`, from the Wiki:
- **Teleport** gets out, used up. A worn crystal can't.
- **Configure:** use on party members (both must have one; both used up), the inactivity timer (2–300 seconds), and the ring of life when worn.
- **Auto-afk** arms it: any hit, zero included, after that much inactivity or right after logging in; never while moving. Inactivity is `lastInputCycle`.
- Varbits 14838 (`teleport_crystal_afk_mode`), 14849 (`_afk_delay`), 14857 (`_rol`).

No capture shows any of this, so the menu's and the messages' words are ours. The crystal only works here in the Theatre; the Wiki's other activities are left to their own plugins.

## Spectating

From the entrance without a party, or Abigaila (Lumbridge general store, the Grand Exchange): by a member's or spectator's name, or the most recent party; carrying nothing but an oculus orb, not poisoned or diseased (Wiki). A spectator sees the raid's area from the room's `spectate` tile, follows the party's rooms, can't attack and is put out when the raid ends. They leave by teleporting (our rule).

Not built: the rooms' "Arena: View" ledges (a loc with that option exists, id 8718), the camera's chatbox buttons, and the war table. The named-player Friends Only check uses the named participant or spectator's friends list. Recent Party retains its existing admission behavior; its privacy selection is not established here.

## Combat Achievements

All 50 tasks have a mode in `CombatAchievements.*` and a condition somewhere. Captured: the failure lines' wording, sent to whoever doesn't have the task; a Perfect room's failure failing Perfect Theatre; the speed tasks running on the challenge time (Trio Speed-Runner, 17:30, at challenge 15:25.80, overall 17:36.00; 227/01758). Hard's speed tasks say overall time (Wiki). See `docs/combat-achievements.md`.

## Items

| Item | State |
| --- | --- |
| Avernic defender | New: `AvernicDefender.plugin.js`. Hilt on a dragon defender, Dismantle destroys the hilt, Inspect (Wiki). Played. Nothing made it before. |
| Holy and Sanguine ornament kits | New rows in `ornament-kits.json`, charged and uncharged, refunded on Dismantle (Wiki). Holy rapier played. |
| Scythe of Vitur | Existing plugin read against the Wiki: hits, max-hit halving, the well, charges. No change. |
| Sanguinesti staff | Existing plugin read against the Wiki: max hit, leech, charges. No change. |
| Books | `Books.*`: each boss leaves its book for someone without it, and the bookshelves give the first one missing. Their text isn't transcribed, so reading says the writing's too faded. |
| Sanguine dust | Drops from Hard Mode. Lil' Zik's forms are `Dust.Pets.js`'s. |
| Sinhaza shrouds | `Stats.*`: tiers 1-5 at 100, 500, 1000, 1500 and 2000 Normal or Hard completions, from the Mysterious Stranger's "What do you have for me?"; Change moves between earned tiers (Wiki; Transcript:Mysterious Stranger). The refusal of a tier not earned yet is our wording. Unit tested, not played: no account here has 100 completions. |
| Dawnbringer | Its special, and every other, now says "You don't have enough power left." when energy is short, as 24 captures do (`Combat.ts`, `CombatSpecial.ts`). It can also be dropped in Verzik's room during phase 1 and picked up by a teammate (the Wiki's way of passing it), drops on death, and is removed when phase 1 ends or when its holder leaves. |

Xarpus' splat also poisons, starting at 2 (Wiki, Strategies; "You have been poisoned!" captured).

## Tested

Over the agent MCP (2026-11-02). No fight was played at full length: every boss was cut to 1 hitpoint with `set_npc_hitpoints` once its fight began.
- **Solo, Normal:** party through the notice board, the Stranger's gate, the entrance and its prompts, then every room through its real barriers and passages. That includes both of Sotetseg's mazes run to the portal, the Xarpus north barrier, the skeleton and the door, all three of Verzik's phases to her death, the vault's chest, strategy table, bookshelf and crystal, and leaving. The Nylocas room was skipped with `::tobcomplete`. Verzik was finished for real once and skipped once to test the vault.
- **Two players, Normal, Hard and Entry:** the Maiden fought; the Bloat finished with `::tobcomplete`, because a script can't time going in as a player does and its flies kill in about 8 ticks; the Nylocas skipped; Sotetseg's mazes run, then `::tobcomplete`; Xarpus fought; Verzik not reached in these.
- **Scenarios:** a death, the jail and release when the room is won; a team wipe, the retrieval chest refusing without coins, taking the fee, giving back, then empty; logging out mid-fight and rejoining into the jail; a crystal carried at logout; teleports refused; a crystal used on a teammate; auto-afk firing on a hit; two parties at once, each with its own Maiden, unseen and unattackable by the other; spectating the most recent party and teleporting out; the scoreboard; the Avernic defender and a Holy kit.
- **Unit tests (2026-11-03):** a wipe with one member who never entered; unclaimed vault loot lost on entering another raid and on logging out (Lil' Zik still delivered); a seven-item roll showing six, with Discard-all and Take-all leaving the seventh and showing it; the loot interface feeding the collection log and the category's kill count; Verzik's auto-attacks, green ball, yellow strikes and webs doing nothing after `die()`; the Dawnbringer dropped, visible to a teammate, and dropped on death; Hard's supply chest a band lower.

## What isn't verified

- **The real client:** interfaces, looks and timing weren't seen in a client; everything was driven headless.
- **Hard Mode's bosses' hitpoints:** see [Modes](#modes).
- **Hard's supply points:** the Wiki says they're fewer ("usually an average of 15, the highest 18" by Sotetseg), with no rule; here each chest takes a band lower than Normal, which is our fit to that line.
- **Fits from few samples:** Entry's team scaling, Entry's waves' gaps, Entry's forms, Hard's Maiden speed-up, Hard's repeated attacks (×1.15, third in a row, limited to three players or fewer, no sample of it with others alive), Bloat's turn odds, Xarpus' absorption and Entry's numbers, Verzik's Entry team multipliers for 3 and 4 players.
- **Estimates with no source:** the jail's stance (RuneLite's name), the retrieval lot's second-wipe timing, Sotetseg's tornado damage, the Hard realm's sections for three runners, Hard's dots' 80 per strike, Hard Matomenos' blast, each death costing a fifth of a player's standing (unique chance, weighting, commons, tertiaries), the MVP's formula, supply grading.
- **Checked against the Wiki or the cache and left as they are:** the pillars have the cache's 185 hitpoints (NPC 8379) and collapse on phase 2 damaging and stunning adjacent players (Wiki, Supporting Pillar); urnbombs check Protect from Missiles when they land while the blood spell checks Protect from Magic during her animation (Wiki, Verzik Vitur); Sotetseg has no maze immunity in the Wiki (the players who stay in the arena can still attack him); the between-room heal is in captures outside Entry; and a second team wipe before reclaiming replaces the retrieval lot (Wiki, Death mechanics).
- **Our wording, not captured:** the Vyre Orator's lines, "Are you ready to proceed?", the crystal's, the Avernic defender's, Hard's refusal, Entry's retry line, the supply chest's Open line.
- **Not built, for want of a source:**
  - Varbit 6400 `tob_verzik_throne_visible`: no capture changes it, and its values are unknown.
  - The books' text: the Wiki's transcripts are the books' whole text, too much to copy in.
  - The rooms' "Arena: View" ledges: no capture uses one.
  - The Mysterious Stranger's in-raid advice: the old solo mode spawned him in rooms, but no capture has him there.
  - Xarpus' and Verzik's follow-up death forms where the units note them.

## Developer commands

| Command | What it does |
| --- | --- |
| `::tob` | To Ver Sinhaza, by the notice board. |
| `::tobcomplete` | Completes the room your party has reached, removing its NPCs. |
| `::tobroom <room>` | Moves your party to a room (`MAIDEN`, `BLOAT`, `NYLOCAS`, `SOTETSEG`, `XARPUS`, `VERZIK`, `REWARDS`). |

The Theatre of Blood is also in `::teleports` under Minigames.
