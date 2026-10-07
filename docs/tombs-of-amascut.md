# Tombs of Amascut

The whole raid, from the Jaltevas pyramid lobby to Osmumten's burial chamber. It is a single plugin, `server/plugins/minigames/TombsOfAmascut.plugin.js`, which delegates to one unit per area in `server/plugins/minigames/toa/`.

## Layout

| File | What it owns |
| --- | --- |
| `ToaShared.js` | Room table (spawns, challenge floors, bounds), path table, ids, varbits, and helpers such as fades, tile graphics, projectiles and knockback. |
| `ToaInvocations.js` | Invocation bitmaps read from cache structs (params 1159/1161/1162), raid level, mode, team lives, time limit and supply factor. |
| `ToaParties.js` | Lobby parties: applications, kicks, the party list and party settings. |
| `ToaRaid.js` | `Raid` and the `Room` base class: instancing, scaling, points, deaths, team wipes, the HUD and completion. |
| `Lobby.*` | Pyramid entry and exit, the grouping obelisk (772/774), the invocation board (776) and invocation presets. |
| `Raid.*` | Barriers, entries, exits, teleport crystals, Osmumten, safe deaths, ghosts, damage points and the invocation punishments. |
| `Nexus.*` | Path choice and path levels, the helpful spirit's supplies (777) and the supplies bag (778). |
| `Supplies.*` | Nectar, Tears, Ambrosia, Smelling salts, Blessed crystal scarab, Liquid adrenaline, Silk dressing and Honey locust. |
| `Scabaras.*`, `Kephri.*` | Path of Scabaras: the four puzzle variants and Kephri. |
| `Het.*`, `Akkha.*` | Path of Het: the beam and mirror puzzle and Akkha. |
| `Crondis.*`, `Zebak.*` | Path of Crondis: the palm-watering puzzle and Zebak. |
| `Apmeken.*`, `BaBa.*` | Path of Apmeken: Apmeken's Sight and Ba-Ba. |
| `Wardens.*`, `ToaWardensData.js` | The Wardens: obelisk and core phases (WARDENS_P1) and the final phase (WARDENS_P3). |
| `Rewards.*`, `ToaRewards.js` | The burial chamber, loot rolls, the loot interface (771) and the lobby retrieval chest. |
| `Items.*` | Masori fortifying, Armadyl to Armadylean plates, Elidinis' ward (f), Thread of Elidinis, keris jewels and Tumeken's shadow charges. |
| `Shadow.*` | Tumeken's shadow in combat: its built-in spell and its passive. |

## Instancing

Each raid has one `PrivateArea` covering the tombs region (x 3520–3967, y 5120–5439, planes 0–3). Rooms stay at their real coordinates. The area isolates NPCs, objects, ground items and clipping per party, so two parties never see each other. `world.json` marks the region multi-combat.

Engine additions this feature needed:

- tile spot animations (`SPOT_ANIM` target type 2) in both the server encoder and the client decoder, used by `sendGraphic`/`sendGlobalGraphic`;
- per-NPC maximum hitpoints (`NPC.setMaxHitpoints`), used for raid scaling and the health bar;
- cache struct params (`CacheDefinitions.getStructParams`), used to read invocations;
- `ForceMovement`, `ForceMovementTask`, `OperationType`, `LocModelType` and `StatementDialogue` on `api.core`.

## Scaling and points

These follow the wiki's *Tombs of Amascut* mechanics:

- **NPC hitpoints:** base × (1 + 0.4% per raid level) × party factor × path-level factor. The party factor is +90% for each of players two and three, then +60% each. Results are rounded as the Wiki's DPS calculator does: to 10 above 300 HP, to 5 above 100, and not below that. (OpenRune #274's Zebak checkpoints, 580 / 930 / 1,280 solo at raid level 0 / 150 / 300 and 1,760 for two at 150, come out the same.)
- **NPC accuracy and defence:** attack and defence rolls × (1 + raid level / 250), applied to the roll rather than the Defence level, so drains still bite.
- **NPC damage:** the same raid-level and path-level factors, capped at 2.5×.
- **Points:**
  - Everyone starts on 5,000 points, which are taken off again for the loot and the purple chance.
  - Damage dealt × the NPC's points multiplier earns room points, capped at 20,000 a room (60,000 for the Wardens, from OpenRune). They're added to the total, capped at 64,000, when the room is completed.
  - The room's top scorer gets an MVP bonus of 300 × team size.
  - Puzzle completions are worth Scabaras 300, Apmeken 450 and Crondis 400. These are OpenRune's numbers; the Wiki gives none.
  - A death costs 20% of a player's total (at least 1,000).
  - At the end, each player's loot points go to `TOA_PERSONAL_CONTRIBUTION` (varp 3606).
- **Unique loot:** chance = total party points / (10,500 − 20 × (raid level up to 400 + a third of the next 150)) percent, capped at 55%. At most one unique per raid; the recipient is weighted by personal points. Weights out of 24: Lightbearer 7, Osmumten's fang 7, Elidinis' ward 3, each Masori piece 2, Tumeken's shadow 1. Below raid level 150, the ward, Masori and shadow need an extra 1/50 roll; below 50, so do all uniques.

## Behaviour taken only from Near-Reality

The OSRS Wiki and the cache weren't reachable when this was first written, so Near-Reality's ToA code was the behaviour oracle. The following still come from it alone, where the Wiki gives no numbers (see *Checked against the Wiki and the cache*):

- Every boss's attack timings, special-attack cycles, tile patterns and base damage numbers. This includes the Wardens' orb paths, rotating-blade tiles, wheel, isolation, skull-bomb and floor-collapse tables (`ToaWardensData.js`), and Akkha's orb paths and quadrants.
- Wardens phase two: only the Warden's current style (magic or ranged) breaks its shield. Core damage passes through ×5, and the core stays out for 21/29/37/45/53 ticks depending on remaining health.
- Points multipliers on Warden NPCs: obelisk 1.5, Warden 2, final Warden 2.5.
- The common loot table's items and divisors, fossilised dung below 1,500 points, and the deathless kits and remnants. (The quantity factor above raid level 300 matches the Wiki.)
- Tumeken's shadow charge cost (2 soul + 5 chaos per charge, 20,000 maximum), the Masori and Armadyl plate counts and experience, and the ward's 10,000 soul runes.
- The lobby scoreboard (46071, interface 775), filled as OpenRune does:
  - A tab per mode (`TOA_SCOREBOARD_TAB`) shows your attempts, completions and deaths, and your best overall and challenge times for each team size.
  - These are recorded from now on: an attempt when a raid starts, a death on each death, and times on completion.
  - The world columns show "-", since there are no world-wide records.
- The lobby's shroud chest (46080): Icthlarin's shroud tiers at 100/500/1000/1500/2000 Normal+Expert completions, and the tier 5 hood (Wiki; the menu is OpenRune's).
- The pickaxe cavities (45468 in Het's room, 49566 in the lobby) keep one pickaxe per player. It's shown in the wall by `TOA_PICKAXE_STORED` (varbit 14440, its place in OpenRune's list plus one). Bronze is turned away ("Het will provide"). Deposit stores the best held or wielded pickaxe; using one on the cavity stores that one.
- The Scabaras puzzle room's shortcuts between its north and south paths (the Wiki only says they exist):
  - The Passage (45343) is crawled through from (3548, 5276) or (3548, 5284).
  - The Platform (45396) is jumped across from (3560, 5277) or (3560, 5283).
- Attack delay:
  - Striking a Scabaras obelisk, or an energy siphon with melee, stops the attack and leaves no attack delay, so the next one can be hit at once.
  - When the final Warden sends its skulls, every player's attack is stopped and their delay cleared the same way.
  - Kephri's eggs keep the normal delay; Near-Reality doesn't clear it for them either.

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

- **Tumeken's shadow:** it plays no cast or impact sound (the ids aren't known), and it refuses every player target rather than only those outside minigames. Accurate's invisible +3 Magic isn't applied.
- **Apmeken:** the corruption special is disabled, as it is in Near-Reality.
- **Wardens phase three floor:** collapsed rows push players back onto the remaining floor rather than becoming unwalkable.
- **The pet:** the Wiki gives its formula but not its exact raid level scaling beyond thresholds at 400 and 550; it uses a third of the levels between them.
- **Logout and failure:** logging out leaves the raid with no rejoin, and a failed raid keeps your items. OSRS sends them to a retrieval chest in the lobby for a fee; there's no retrieval chest yet.
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
- **Tumeken's shadow (Wiki):**
  - It casts only its built-in spell: max hit floor(Magic / 3) + 1, every 5 ticks, from 8 tiles (10 on Longrange), one charge a cast, with the usual damage-based Magic experience.
  - Its definition (`item-gameplay.json`): +35 magic attack, +20 magic defence and +1 prayer, two-handed, 85 Magic to wield. It uses the powered staff's styles (`POWERED_STAFF`, cache weapon category 24: Accurate, Accurate, Longrange). Before, it had no entry, so it fell back to unarmed with no bonuses.
  - Its passive multiplies the worn gear's magic attack and magic damage bonuses by 3, or by 4 in the tombs. Magic damage is capped at 100%.
  - It can't be used against players.
  - The cast is OpenRune's: `TOA_SOT_CAST_B` (9493) with `TUMEKENS_SHADOW_CASTING` / `_TRAVEL` / `_IMPACT` (2125–2127). The hit lands as the projectile arrives.
- **Ghosts:** a ghost's inventory and worn equipment tabs close until it's revived (from OpenRune).
- **Raid items:** logging in outside a raid strips raid supplies.
- **The chest:** the unique chance and weights, the pet, the Thread of Elidinis, the four keris jewels and the elite clue now use the Wiki's rates.
- **The sarcophagus (Wiki):**
  - A unique turns the flames around Osmumten's sarcophagus purple, and its finder opens the sarcophagus to reveal it. Their chest has no common rolls; its tertiaries still drop.
  - The cache drives the vault from one varbit, `TOA_VAULT_SARCOPHAGUS` (14373). It switches the sarcophagus (46220: closed 44825, or purple with Open 44826), the floor glow (46222) and the barrier (46221).
  - Opening it plays `TOA_OSMUMTEN_CHEST_REVEAL` (9505, about 8 ticks), then shows the opened sarcophagus (44934) with `TOA_OSMUMTEN_CHEST_OPEN` (9506).
  - How OSRS hands the item over isn't known, so the unique then joins the finder's loot in the reward interface (771). The opened sarcophagus's Search reopens it.
  - An unopened sarcophagus's unique is kept (persisted) and comes out of the lobby chest.
- **The vault's chests:** each party slot has its own chest (`TOA_VAULT_CHEST_LOC0`–`7`, varbits 14356–14360 and 14370–14372). A player sees their own chest as theirs (2) or emptied (4), and the others as someone else's; another player's chest won't open for them.
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
