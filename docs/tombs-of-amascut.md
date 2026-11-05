# Tombs of Amascut

The whole raid, from the Jaltevas pyramid lobby to Osmumten's burial chamber. It is a single plugin, `server/plugins/minigames/TombsOfAmascut.plugin.js`, which delegates to one unit per area in `server/plugins/minigames/toa/`.

## Layout

| File | What it owns |
| --- | --- |
| `Shared.TombsOfAmascut.js` | Room table (spawns, challenge floors, bounds), path table, ids, varbits, and helpers such as fades, tile graphics, projectiles and knockback. |
| `Invocations.TombsOfAmascut.js` | Invocation bitmaps read from cache structs (params 1159/1161/1162), raid level, mode, team lives, time limit and supply factor. |
| `Parties.TombsOfAmascut.js` | Lobby parties: applications, kicks, the party list and party settings. |
| `RaidState.TombsOfAmascut.js` | `Raid` and the `Room` base class: instancing, scaling, points, deaths, team wipes, the HUD and completion. |
| `Lobby.*` | Pyramid entry and exit, the grouping obelisk (772/774), the invocation board (776) and invocation presets. |
| `Raid.*` | Barriers, entries, exits, teleport crystals, Osmumten, safe deaths, ghosts, damage points and the invocation punishments. |
| `Nexus.*` | Path choice and path levels, the helpful spirit's supplies (777) and the supplies bag (778). |
| `Supplies.*` | Nectar, Tears, Ambrosia, Smelling salts, Blessed crystal scarab, Liquid adrenaline, Silk dressing and Honey locust. |
| `Scabaras.*`, `Kephri.*` | Path of Scabaras: the four puzzle variants and Kephri. |
| `Het.*`, `Akkha.*` | Path of Het: the beam and mirror puzzle and Akkha. |
| `Crondis.*`, `Zebak.*` | Path of Crondis: the palm-watering puzzle and Zebak. |
| `Apmeken.*`, `BaBa.*` | Path of Apmeken: Apmeken's Sight and Ba-Ba. |
| `Wardens.*`, `WardensData.TombsOfAmascut.js` | The Wardens: obelisk and core phases (WARDENS_P1) and the final phase (WARDENS_P3). |
| `Rewards.*`, `Loot.TombsOfAmascut.js` | The burial chamber, loot rolls, the loot interface (771) and the lobby retrieval chest. |
| `Summary.*` | The burial chamber's scoreboard: this raid's summary (`toa_raid_summary`, 482). |
| `Items.*` | Masori fortifying, Armadyl to Armadylean plates, Elidinis' ward (f), Thread of Elidinis and keris jewels. |

Tumeken's shadow is a weapon used everywhere, so it lives in `plugins/items/TumekensShadow.plugin.js` ([tumekens-shadow.md](tumekens-shadow.md)). The raid only answers its `toa:in-tombs` question (`Raid.*`), for the passive's ×4.

## Instancing

Each raid has one `PrivateArea` covering the tombs region (x 3520–3967, y 5120–5439, planes 0–3). Rooms stay at their real coordinates. The area isolates NPCs, objects, ground items and clipping per party, so two parties never see each other. `world.json` marks the region multi-combat.

Engine additions this feature needed:

- tile spot animations (`SPOT_ANIM` target type 2) in both the server encoder and the client decoder, used by `sendGraphic`/`sendGlobalGraphic`;
- per-NPC maximum hitpoints (`NPC.setMaxHitpoints`), used for raid scaling and the health bar;
- cache struct params (`CacheDefinitions.getStructParams`), used to read invocations;
- `ForceMovement`, `ForceMovementTask`, `OperationType`, `LocModelType` and `StatementDialogue` on `api.core`;
- a per-NPC defence roll factor (`NPC.setDefenceRollFactor`, read by the accuracy formulas), for the raid-level scaling of defence rolls that some NPCs skip (`scaleDefence: false`);
- the `combat:no-retreat` NPC flag (`Combat.shouldRetreat`), set with `combat:no-regen` on every raid NPC: Akkha, moved about by his own specials, otherwise dropped his target for being far from his spawn tile and stood idle.

## Scaling and points

These follow the wiki's *Tombs of Amascut* mechanics:

- **NPC hitpoints:** base × (1 + 0.4% per raid level) × party factor × path-level factor. The party factor is +90% for each of players two and three, then +60% each. Results are rounded as the Wiki's DPS calculator does: to 10 above 300 HP, to 5 above 100, and not below that. (OpenRune #274's Zebak checkpoints, 580 / 930 / 1,280 solo at raid level 0 / 150 / 300 and 1,760 for two at 150, come out the same.)
- **NPC accuracy and defence:** attack and defence rolls × (1 + raid level / 250), applied to the roll rather than the Defence level, so drains still bite.
- **NPC damage:** the same raid-level and path-level factors, capped at 2.5×.
- **Points:**
  - Everyone starts on 5,000 points, which are taken off again for the loot and the purple chance.
  - Damage dealt × the NPC's points multiplier earns room points, capped at 20,000 a room, the Wardens included (Wiki, Tombs of Amascut: Points). They're added to the total, capped at 64,000, when the room is completed.
  - The room's top scorer gets an MVP bonus of 300 × team size.
  - Puzzle completions are worth Scabaras 300, Apmeken 450 and Crondis 400. These are OpenRune's numbers; the Wiki gives none.
  - A death costs 20% of a player's total (at least 1,000).
  - At the end, each player's loot points go to `TOA_PERSONAL_CONTRIBUTION` (varp 3606).
- **Unique loot:** chance = total party points / (10,500 − 20 × (raid level up to 400 + a third of the next 150)) percent, capped at 55%. At most one unique per raid; the recipient is weighted by personal points. Weights out of 24: Lightbearer 7, Osmumten's fang 7, Elidinis' ward 3, each Masori piece 2, Tumeken's shadow 1. Below raid level 150, the ward, Masori and shadow need an extra 1/50 roll; below 50, so do all uniques.

## Status of the polish (feat/152-toa-polish)

Each room file's header lists its sources (rsprox rev/recording/tick, Wiki) and its estimates. Captures decide what the game shows, the Wiki the numbers, the cache the ids.

### Played over the agent MCP (2 November 2026)

Real objects, NPCs and paths, driven from scripts; nothing below was skipped unless it says so.

- **Puzzles, through their own objects:**
  - Crondis: the container, the waterfalls and the palm, with the crocodiles drinking, at full length (Normal, twice).
  - Het: a beam route found from the room's walls and mirrors, loose mirrors picked up, placed and turned, walls broken, the statue struck. The seal was mined over two phases; the first ran out as it should.
  - Scabaras: lights-out, memory (the sequence read off the plates tick by tick), obelisks (the order survived wrong strikes), addition (the tablet's number walked exactly), the passage, the platform and the matching boards, in two rooms. Het and Scabaras were played in Entry raids of their own; the whole Normal and Expert raids skipped them.
  - Apmeken: roof supports and vents with the real hazards, including a death, the team wipe, the retry and a clean second attempt (Normal).
- **Bosses:** Zebak at full length (Normal). Ba-Ba, Kephri, Akkha (all four thresholds and the final stand) and the Wardens (every phase) to death with their hitpoints cut by `set_npc_hitpoints`.
- **Raids:** Entry solo; Normal solo (Walk the Path, Pathfinder, Quiet and Deadly Prayers, Jog, Lively Larvae); Expert (17 invocations, raid level 305: Zebak, Ba-Ba, Kephri, Akkha and the Wardens, then the chest and the spirit); parties of two; up to four raids at once.
- **The end:** the vault, the sarcophagus reveal, a forced purple, the chest's Take-All with noted items, leaving through the vault spirit, the lobby niche.
- **Escape crystal:** Configure, refused on a teammate until configured, used on a teammate (both crystals used, both told), Teleport out, and a logout holding one.
- **Deaths and leaving:** a party death (the ghost waits at the room's entrance) and the revival when the room is won; a solo wipe and retry; a Hardcore wipe and the retrieval chest (the fee, the items back, the empty line); logging out mid-fight in a party (counted as a death) and rejoining; a solo logout outside a fight (ejected, nothing lost); a Hardcore logout mid-fight (a wipe: three items kept, the rest to the chest); a logout with an escape crystal (the crystal used, the gear kept); teleporting out.

Cheats used in those runs: infinite health (so one player in Ba-Ba's pit with Mind the Gap lived, and was moved out with `::tele`), and `::toaskippuzzle`, `::toaskiptowarden`, `::toaskiptoreward` where a run only needed later rooms.

### Still unverified

- The retrieval chest's line and the crystal's line at login: the player is moved and the items are handled correctly, but the agent MCP's login reply carries no messages at all, so neither line was seen.
- The Auto-afk and ring-of-life modes of the escape crystal.
- Full-length fights other than Zebak, and Normal or Expert with a real death invocation beyond Hardcore.

**Still only from Near-Reality or OpenRune:**
- Apmeken: the needless-fix texts and their full damage; clearing venom on completion. Het: which pickaxe maps to which stored value past rune.
- Scabaras: flip messages and animation; the tablet's refusal; the memory button's messages. Kephri: too many agile scarabs turning eggs into dung; an egg landing on a player; the spitter through prayer.
- Akkha: element cooldowns; lightning's prayer block; the unstable burst's graphic timing. Ba-Ba: solo rock 39; falling rock; sarcophagus shot and Faith's 15%; baboon max 12; the pit rows and deep-pit death.
- Crondis: the first crocodile after a reset. Zebak: the bite through prayer; bleed numbers; the scream's hit; water crocodile bites.
- Wardens: entomb's timing; divine sounds; failed-siphon damage; rock damage; the Kephri phantom's Aerial bonus; ring lightning; clearing attack delay on skulls; Zebak's style flip, Vigilant's and the special's chances.
- Points: puzzle completion points (Scabaras 300, Apmeken 450, Crondis 400). Lobby: the shroud menu, the sack's dialogue, the cavity's text.

**Not built:** the first-raid freed gods and captured gods in the rooms; per-viewer corruption tint.

## NPC animations

Each Tombs of Amascut NPC (11689-11804) has its block and death animations in `npc-combat-defs.json`. Without them, they fell back to the player's block (424) and death (836), so Zebak "blocked" like a human when hit.

- **Block:** none of them has a block or defend animation, except Osmumten's ghosts, so a hit plays nothing.
- **Death:** each uses its own death sequence, identified by its Jagex name in RuneLite's gameval `AnimationID`, for example `NPC_ZEBAK01_DEATH` (9634) and `NPC_KEPHRI_DEATH` (9582). The Near-Reality data gives Zebak and Kephri zombie animations (5568/5569), which aren't used.
- **Scripted deaths:** the bosses' deaths are played by the plugins, and the definitions agree with them.

## Zebak

Checked against OpenRune-Server #274, which was built against a live capture, with the Wiki taking priority. RuneLite's gameval names the ids.

**From the Wiki:**
- Each roar wave hits each rock for 50; a rock has 150 HP and crumbles when it runs out.
- Blood clouds lose 2 for every tile they move, and drain 2 a tick from anyone beside them.
- His Defence drains by at most 20, so never below 50.
- A blood barrage heals him twice the damage it deals.
- A special still queued when he enrages is dropped.

**From OpenRune, where the Wiki gives no figures:**

| What | Value |
| --- | --- |
| Acid | 6-10 a tick, scaled |
| Barrage | 3-5, scaled |
| Bite | Lands 2 ticks after it; Protect from Melee blocks half |
| First attack | After 10 ticks |
| During specials | His autos carry on; the roar holds them 10 ticks at the start and 11 for the scream |
| Great Roar | Throws at tick 1, scream at 33, waves at 36/38/40, rocks cleared at 58 |
| Tidal waves | Throws at 1, tail slam at 5, rocks fall at 7, rows at 14/21/28, done at 45 |
| Jugs | A push rolls them 8 tiles; a hit shatters them a tick later; only the first roar wave chips them |
| Rocks | Placed within (3925, 5401)-(3935, 5415); acid under one is cleared |
| Camera shakes | His death (2 ticks in) and the falling rocks before the waves |

**The volley as OSRS draws it:**
1. The volley rises (2176/2178) from height 200 to 700, arcing at 30.
2. It bursts (2186/2185) at height 750 on a helper NPC, `SPOTANIM_ZEBAK_RANGED01_NPC` (11744), spawned for 3 ticks so it is centred on the split point. A tile graphic's height is one byte, so it can't sit that high.
3. The fragments (2181/2187) drop from 700 to 90 over 90 cycles, arcing at 127.

**Enraged** (below 25%) he becomes `TOA_ZEBAK_ENRAGED` (11732), with the enraged attack animations (9622/9623 melee, 9626/9627 ranged) and the enraged rising projectiles (2177/2179). RuneLite names them for the enrage; OpenRune uses the enraged melee only.

**Not done:** acid that ramps up the longer you stand in it (the Wiki describes it; neither source gives numbers), and the volley's split and impact sounds (RuneLite doesn't name sound ids).

## Simplifications

- **Logout and failure:** see `Raid.onLogout`, `Raid.rejoin` and `Retrieval.*` (built from the Wiki and 227/01762; rejoin not yet played).
- **Restart recovery:** logging in inside the tombs without an active raid returns you to the lobby. The raid exit also returns stranded players to the lobby.
- **Scoreboard:** the burial chamber scoreboard (44942) isn't implemented; the lobby one shows only personal records.

## Checked against the Wiki and the cache

The first version was written without access to the Wiki or the cache, so it followed Near-Reality alone. A later pass checked it against both, along with RuneLite's gameval names (Jagex's own names for animations, spotanims, interfaces, varbits and varps).

**Ids:**
- **Animations:** every boss's matches its name. Zebak's and his tail's melee animations had been swapped.
- **Projectiles and graphics:** all are named and fit.
- **Interfaces 771–778 and 481:** all are the ToA groups they're used as. The boss health HUD (303 at `161:2`, varp 1683, varbits 6099/6100) matches a live capture from the Gemstone Crab.
- **Varbits and varps:**
  - The reward niche (46224) switches on `TOA_SHOULD_HAVE_LOOT` (14319); 14139 was a PvP Arena varbit.
  - Points had been sent to "varbit" 3586, a farming varbit in this cache. Now only each player's final loot points are sent, to `TOA_PERSONAL_CONTRIBUTION` (varp 3606), as OpenRune does.
  - The crocodile wall openings (`TOA_WALL02_CROCODILES04`, 45434) and Zebak's rock steps (`TOA_ZEBAK_CLIMBING_ROCK`, 45509) are the cache's.
- **The obelisk's interfaces:** the party list (772) and details panel (774) are built from pause buttons (`resume_pausebutton`), as OpenRune sets them. Ours had set op1 events, and the member rows always got the leader's view value.
- **The details panel's button numbers** come from its cache scripts: the 12 fixed buttons (enum 4792), members from 12, the applicants' Accept from 36 and Decline from 44 (script 6746), and the invocations from 52 in enum 4664's order (script 6754). Ours had Accept at 20, Decline at 28 and the invocations at 36, so Accept toggled an invocation and the invocation buttons were 16 off. Enum 4664's last two, Blazing Tombs I and II (structs 5892/5893, an event's), aren't offered. Those buttons click through with `.cc_resume_pausebutton` (operand 1: the child found with `cc_find 1` on 774:1). The client used to resume the clicked button itself whatever the operand, so the server never heard those clicks.
- **Options:** every hooked NPC, item and loc option exists in the cache. The supplies bag's are *Open*, *Withdraw 1*, *Withdraw All* and *Resupply*, and now all work.

**Behaviour, against the Wiki:**
- **Raid scaling** (raid level, party size, path level) matches.
- **Zebak:** max hits are now 38 melee and 16 magic/ranged, and a wave hits for 6–10.
- **Kephri:** her attacks speed up with path level, and her fireball's max hit is 24.
- **Ba-Ba:** Protect from Melee fully blocks her melee (since June 2025), and her boulders have 27 and 31 hitpoints at path levels 2 and 4. She is worth 2 points per damage.
- **Zebak's water:**
  - A wave that runs out of floor throws the player into the water (5 tiles, from OpenRune).
  - Swimmers can't attack or run, and climb out by the rock steps.
  - The water crocodiles (11741: bubbles with strength 70, so a max hit of 8 before scaling) bite swimmers every 2 ticks.
  - A bite bleeds 1 time in 4 instead of hitting: 5–10 at once, then 1–8 on each tick spent moving, for 10 ticks. These numbers are OpenRune's; the Wiki only says moving makes it worse.
- **Crondis puzzle:**
  - The palm needs 175 water, plus 125 for each extra player.
  - A crocodile bites for 18, plus 3 for each acid or spear hit in the last 30 seconds, up to 36.
  - Crocodiles go for anyone carrying water nearby, then a watered palm, then someone without a container who hit them.
  - From OpenRune: crocodiles enter from one of three sides, a wave comes every 46–50 ticks, and they wake 4 ticks after spawning.
- **Invocations:**
  - On a Diet blocks all food, honey locusts included.
  - Dehydration blocks every potion that restores health, Guthix rests included.
  - The help invocations cut supplies to 66%, 33% and 10%.
- **Supplies:** the helpful spirit's chaos pack is rolled (1–8 nectar, 0–6 tears, 0–2 salts, with rare ambrosia and adrenaline), and the power pack has 1 liquid adrenaline. A supply used on the bag goes back in (from OpenRune).
- **The Wardens' void art:** the map keeps the collapsed floor's "Void" pieces (45726–45738) on plane 2, above the final arena. OSRS builds the room without them. The final room hides them, so they no longer show before the floor starts falling.
- **Tumeken's shadow:** see [tumekens-shadow.md](tumekens-shadow.md).
- **Ghosts:** a ghost's inventory and worn equipment tabs close until it's revived (from OpenRune).
- **Raid items:** logging in outside a raid strips raid supplies.
- **The chest:** the unique chance and weights, the pet, the Thread of Elidinis, the four keris jewels and the elite clue now use the Wiki's rates.
- **Collection log:** the loot is logged when the chest or sarcophagus is opened; the one Tombs of Amascut category (struct 4378) shows Entry, Normal and Expert completions separately (cache script 2735: varps 2941, 2048 and 2942).
- **The sarcophagus (Wiki):**
  - A unique turns the flames around Osmumten's sarcophagus purple, and its finder opens the sarcophagus to reveal it. Their chest has no common rolls; its tertiaries still drop.
  - The cache drives the vault from one varbit, `TOA_VAULT_SARCOPHAGUS` (14373). It switches the sarcophagus (46220: closed 44825, or purple with Open 44826), the floor glow (46222) and the barrier (46221).
  - Opening it plays `TOA_OSMUMTEN_CHEST_REVEAL` (9505, about 8 ticks), then shows the opened sarcophagus (44934) with `TOA_OSMUMTEN_CHEST_OPEN` (9506).
  - How OSRS hands the item over isn't known, so the unique then joins the finder's loot in the reward interface (771). The opened sarcophagus's Search reopens it.
  - An unopened sarcophagus's unique is kept (persisted) and comes out of the lobby chest.
- **The vault's chests:** each party slot has its own chest (`TOA_VAULT_CHEST_LOC0`–`7`, varbits 14356–14360 and 14370–14372). A player sees their own chest as theirs (2) or emptied (4), and the others as someone else's; another player's chest won't open for them.
- **The burial chamber's scoreboard** (`toa_vault_scoreboard`, Read): rsprox 227/01852, 00581, 01753 and 01845 show it opening this raid's summary, `toa_raid_summary` (482), not the lobby's records board. It shows the nine room times (the Wardens' phases together), the challenge total (their sum) and overall total, the active invocations and the raid level. Script 6590 then adds one row per member, most damage dealt first (every recording orders them so; the reader also dealt the most in each, so reader-first can't be ruled out): name, damage dealt, damage taken, deaths, title struct, -1, rank, party size and whether it is the reader. The titles ("The Brawler", "The Leech": structs with param 1525) are left as -1, which the script draws as "-", because how a member earns each one isn't recorded.
- **Moving NPCs:** Zebak's waves and jugs, Akkha's unstable orbs, Ba-Ba's boulders and the moving Wardens move with collision off, as in Near-Reality. Before, the route finder couldn't move them over tiles the map blocks.

**Still open:**
- **Akkha's damage:** the Wiki's infobox gives a max hit of 55, and the plugin uses 22 for every style. 22 x 2.5 (the +150% damage cap) is exactly 55, so the 55 may be the capped value.
- **Impact graphics:** a few use generic graphics where the cache has dedicated ToA ones. Zebak's are settled: OpenRune's capture-based volley also lands with `FIREBLAST_IMPACT` / `DARKBOW_SMOKE_ARROW_IMPACT`, and `ZEBAK_MAGE_SPLIT` / `ZEBAK_RANGED_SPLIT` are the bursts.
- **Sound ids:** RuneLite has no names for them.
- **Unnamed cache entries:** these keep their numeric constants: Warden charging orb 11769, hidden Warden 11765, departing spirit 11829, blade objects 45748/45749, platform 45606, siphon block 26209.

## Verification

Developer accounts can use `::toa` to teleport to the lobby beneath Necropolis (not from inside a raid).

Developer accounts can use `::toaskippuzzle` inside any of the four pre-boss puzzle rooms.
It completes that room for the party, removes its remaining NPCs, and opens the normal
route to the boss. Use the room exit afterward. It also works before starting the puzzle.
The command uses normal completion, including puzzle points and revival; it does not
complete bosses or work in the lobby or Nexus. Repeating it does not award points again.

`::toaskipboss` is also Developer-only. It completes the current boss encounter for the
party, removes remaining enemies, and preserves Osmumten and the normal route onward.
At the Wardens it first advances to the final phase; use it again after arriving to finish
the raid and unlock the normal reward route. Completion points and rewards still apply.

`::toaskiptowarden` (Developer-only) works in the Nexus. It marks all four paths complete and
rebuilds the Nexus, so the Wardens' entrance opens and the helpful spirit offers supplies.
The skipped paths give no points, so the loot reflects only what was actually fought.

`::toaskiptoreward [points] [raid level]` (Developer-only) works anywhere in a raid. It ends
the raid as if the Wardens fell and takes the party to the chest. Every player gets `points`
loot points (on top of the 5,000 start; 0–59,000, default 20,000). A raid level (0–600), if
given, replaces the invocations' level for the loot rolls. It doesn't add to completion counts.
Words after the numbers force loot for the player using it: `purple` (a unique picked by the
usual weights at that raid level), or one by name (`lightbearer`, `fang`, `ward`, `masori` for
a random piece, `mask`, `body`, `chaps`, `shadow`), and `pet`. For example,
`::toaskiptoreward 30000 500 shadow pet` or just `::toaskiptoreward purple`.

Run `npx tsc --noEmit -p tsconfig.json` in `server`, then load the plugins. With `TS_NODE_TRANSPILE_ONLY=1`, a `node -r ts-node/register` script that calls `PluginManager.loadFromDirectory()` should list `TombsOfAmascut` among the loaded plugins.

In-game follow-up, done by hand:

1. Form a party at the obelisk, set invocations and enter.
2. Clear each path's puzzle and boss.
3. Beat the Wardens and claim the chest.
4. Leave with unclaimed loot and collect it from the lobby chest.
