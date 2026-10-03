# Wintertodt

The Wintertodt, built from the OSRS Wiki (the October 2024 rework, with its warmth meter and reward cart), live rsprox captures, and the cache. Near-Reality's port served as a reference for structure and for details nothing else records; those are marked below. It is one plugin, `server/plugins/minigames/Wintertodt.plugin.js`, which delegates to one unit per area in `server/plugins/minigames/wintertodt/`.

Status:
- **Done:**
  - the Doors of Dinh, the round controller, points and the HUD;
  - roots, kindling, braziers, pyromancers, herbs, potions and the crates;
  - warmth and the Wintertodt's five attacks;
  - the reward cart and its loot;
  - the `::teleports` entry and developer commands.
- **Not done:**
  - Ignisia's exchange;
  - the discontinued supply crate item;
  - the tome of fire's pages;
  - combat achievements and the diary;
  - the fletching knife's faster kindling.

## Layout

| File | What it owns |
| --- | --- |
| `WintertodtShared.js` | Ids, varbits, tiles, zones, the safe area, and helpers such as the fade and the one-per-player skilling action. |
| `WintertodtRound.js` | The world's one round: energy, the break, points, the HUD, the end of a round. |
| `WintertodtCorners.js` | Each corner's brazier state and pyromancer health, chatter and green bolts. |
| `WintertodtWarmth.js` | The warmth meter, warm clothing, damage formulas, regeneration and the cold's kill. |
| `WintertodtAttacks.js` | The Wintertodt's five attacks and their timing. |
| `WintertodtEffects.js` | Temporary locs, projectiles and graphics for everyone in the prison. |
| `WintertodtRewards.js` | One search of the reward cart. |
| `Doors.*` | The Doors of Dinh, the HUD zones, leaving the prison, login and logout. |
| `Braziers.*` | Lighting, fixing and feeding braziers. |
| `Supplies.*` | Roots, kindling, herbs, the crates, rejuvenation potions, Brew'ma, and supplies shattering when dropped. |
| `Pyromancers.*` | Healing the pyromancers. |
| `Cart.*` | The reward cart's Search, Check and Big-search. |
| `Commands.*` | Developer commands. |

**Changes outside the plugin:**
- **Core: `Mobile.showHitsplat(damage, { mine, others }, health)`.** It shows a hitsplat that changes no hitpoints, with its own cache hitsplat ids and health bar. The cold on the warmth meter uses it, as do the pyromancers' own 14 health. `HitDamage` carries the ids and `PlayerSession` writes them.
- **Core: item-on-object runs the object route hook** (`onObjectRoute`), as clicking a loc does, so a plugin's approach tile also holds when an item is used on the loc.
- **`Food.plugin.js`** emits `food:eaten` (`{ player, itemId, heal }`) for any plugin that reacts to eating.
- **`Pets.plugin.js`** lists the phoenix (item 20693, follower 7370 as in the captures).
- **`npc-spawns.json`:** the pyromancers face their braziers and stand still.

## The round

There is one Wintertodt per world, running from server start whether anyone is there or not.
- **Break:** 100 ticks between rounds, counted down on varbit 7980 (capture).
- **Start:** energy 3500 and the storm loc becomes 29308 "Howling Snow Storm" at (1627, 4004) (capture).
- **Drain:** each pyromancer whose brazier is lit drains 1% (35) every 14 ticks (Wiki). That is 2.5 a tick, or the capture's 20 every 2 ticks with all four lit.
- **Recovery:** with every brazier out, the energy recovers 1% every 35 ticks (Wiki). One lit brazier stops the recovery, even if its pyromancer is down.
- **End:** at 0 energy the round ends:
  - The storm becomes 29309 "Quiescent Snow Storm".
  - The braziers reset to unlit (29312).
  - The pyromancers say "We can rest for a time."
  - The break starts again.

The corners, in the HUD's order: south-west, north-west, north-east, south-east.

| Corner | Brazier | Pyromancer |
| --- | --- | --- |
| South-west | (1620, 3997) | (1619, 3996) |
| North-west | (1620, 4015) | (1619, 4018) |
| North-east | (1638, 4015) | (1641, 4018) |
| South-east | (1638, 3997) | (1641, 3996) |

Plugins can follow the round with the custom events `wintertodt:round-start` and `wintertodt:round-end`.

## Points and the end of a round

| Activity | Points (Wiki) |
| --- | --- |
| Lighting a brazier | 25 |
| Feeding a bruma root | 10 |
| Feeding bruma kindling | 25 |
| Repairing a brazier | 25 |
| Healing a pyromancer | 75 |

Reaching 500 points mid-round: "You have helped enough to earn a supply crate." The wording predates the reward cart but is still live (capture).

At the end of a round, each player inside the prison gets the following.

**Under 500 points:** "You did not earn enough points to be worthy of a gift from the citizens of Kourend this time."

**500 points or more**, in this order (capture):
1. Firemaking XP of level x 100, and "You have gained 9900 Firemaking XP."
2. "Your subdued Wintertodt count is: <col=ff0000>598</col>." Varp 1528 counts the kills.
3. The rewards owed, on varbit 11435, and "You're owed an additional 2 rewards from the reward cart. You're now owed 2 rewards."

**Rewards owed (Wiki):**
- 500 points owes two.
- Every further 500 guarantees one more.
- The points past the last 500 give that share of a chance at another. For example, 1200 points gives 3, with a 40% chance of a 4th.
- The cart holds at most 8,000.

The capture's 580 points gave 2.

The kill count and rewards owed are persisted attributes (`wintertodt:kills`, `wintertodt:rewards-owed`), sent to their varp and varbit on login. A round's points are not saved.

## The Doors of Dinh

The Doors of Dinh are loc 29322 at (1627, 3964).

**Enter:**
- Needs 50 Firemaking (Wiki).
- From the capture:
  1. The screen fades out with interface 174 on the atmosphere overlay and script 948 (50 cycles).
  2. Two ticks later you move inside and the screen fades back in.
- You land within (1627-1633, 3977-3983).

**Leaving:**
- Leaving lands you within (1628-1631, 3955-3956) (capture).
- Between rounds the doors ask nothing (capture).
- Mid-round they ask "Are you sure you want to leave?" with "Leave and lose all progress." / "Stay." (Near-Reality; not yet captured).
- Leaving or logging out loses the round's points (Wiki), and the prison's supplies vanish: bruma roots, kindling, herbs and rejuvenation potions. Any still carried at login go too.
- At the end of a round, bruma roots and kindling are taken from everyone in the prison.

**Peek:** "The Wintertodt has X% energy left. There are N players within the prison." The Wiki describes it but gives no wording, so this text is Near-Reality's.

**Under 50 Firemaking:** "You require at least 50 Firemaking to take on the Wintertodt." (Near-Reality; not yet captured).

Logging in inside the prison puts you outside the doors.

## The HUD

The HUD is interface 396 on the HUD overlay. It stays up inside the prison (1600-1663, 3968-4031) and in the camp south of it (1600-1663, 3904-3967).

**Scripts:**
- Script 1433 shows the points and warmth groups inside the prison.
- Script 1432 hides them in the camp.
- Script 1421 runs every other tick with ten ints:

  | Arg | What it holds |
  | --- | --- |
  | 1 | Points |
  | 2 | Energy (0-3500) |
  | 3-6 | Each corner's pyromancer: 1 healthy |
  | 7-10 | Each corner's brazier: 0 broken, 1 unlit, 2 lit |

  Between rounds it sends `0, 0, 1, 1, 1, 1, 1, 1, 1, 1`.

**Varbits:**
- Varbit 7980 counts the break down. Script 2755 times it at 30 client cycles a unit.
- Varbit 11434 is warmth, from 0 to 1000. It is full on entering.

## The braziers

The brazier locs are 29312 (unlit, Light), 29313 (broken, Fix) and 29314 (burning, Feed).

**Approach:** the cache puts walls (loc 24720) on each brazier's outer sides. Yet the captures show players lighting and feeding the south-east brazier from (1638, 3996) and (1639, 3996), on the far side of those walls, so live's collision there differs. A click or item use therefore walks to the nearest open tile beside the 3x3, on any side, and acts from there.

**Light:**
- Needs a tinderbox or bruma torch, carried or worn (Wiki).
- The brazier can't be lit while its pyromancer is down: "Heal the Pyromancer before lighting the brazier." (Near-Reality).
- It takes 2 ticks: anim 7174 with a bruma torch (capture), 733 with a tinderbox (Near-Reality).
- Reward: "You light the brazier.", 25 points and 6x Firemaking level XP.
- Everyone who starts lighting before the brazier changes gets the reward (Wiki).

**Fix:**
- Needs a hammer: "You need a hammer to fix this brazier.".
- Takes 2 ticks with anim 3676 (Near-Reality): "You fix the brazier." and 25 points.
- 4x Construction level XP only for players who own a house (Wiki), read from the house location varbit 2187.

**Feed:**
- Anim 832, one item every 3 ticks, kindling first (capture).
- A root gives 10 points and 3x Firemaking XP; kindling gives 25 points and 3.8x.
- Ends with "You have run out of bruma roots.".

**Pyromancer:**
- 14 health (Wiki). She waits 2-8 ticks after her brazier is lit or she is healed before she drains again (Wiki: "roughly 1-5 seconds").
- While draining, she sends a green bolt (NPC 7373) from the brazier toward the storm every other tick.
- Lines (Wiki transcript), about every 10-14 ticks:
  - "Light this brazier!", "Fix this brazier!", or the chant "Yemalo shi cardito!" with anim 4432;
  - "Arg, it got me!" with anim 7627 as she falls;
  - while she is down, one of five lines at random.

## Healing pyromancers

- "Help", or a rejuvenation potion used on her, heals her fully for one dose, taken from the potion with the fewest doses (Wiki). It earns 75 points.
- Other items: "That's no use!". At full health: "No need! I'm fine thanks.". Between rounds: "Looks like it's quiet for now. I don't need help, but thank you." (transcript).
- Help without a potion opens Near-Reality's statement.

## Roots, kindling, herbs and the crates

**Bruma roots** (loc 29311, Chop):
- "You swing your axe at the roots." then "You get a bruma root." every 3 ticks (capture), with 0.3x Woodcutting level XP.
- Better levels and axes succeed more often, reaching every try at 99 with a dragon axe.
- Uses the Woodcutting plugin's best usable axe; without one: "You do not have an axe which you have the woodcutting level to use.".
- When the inventory is full: "Your inventory is too full to hold any more roots.".
- Between rounds: "There's no use for bruma roots at this time." (capture).

**Kindling** (knife on a root):
- One every 4 ticks with anim 1248, 0.6x Fletching level XP, and "You carefully fletch the root into a bundle of kindling." (capture).
- Refused in the safe area: "Your hands are too cold to fletch here - move closer to the braziers.".

**Sprouting Roots** (29315, Pick):
- A bruma herb every 3 ticks with anim 2282 (Near-Reality).
- No Farming XP since the rework (Wiki).

**Crates:**

| Option | Gives | Loc |
| --- | --- | --- |
| Take-hammer | Hammer | 29316 |
| Take-knife | Knife | 29317 |
| Take-axe | Bronze axe | 29318 |
| Take-tinderbox | Tinderbox | 29319 |
| Take-concoction / Take-5 / Take-10 | Unfinished potions | 29320 |

- The tool crates give one only while you have none (Wiki).
- "You take a knife from the crate." is captured; the other messages are Near-Reality's.

**Rejuvenation potions:**
- A herb on an unfinished potion makes a (4), with 0.1x Herblore level XP. Outside the prison: "You can only do that within the influence of the Bruma tree." (Wiki).
- Brew'ma mixes every pair at once when you use either ingredient on them.
- Drink restores 30% warmth.

**Dropping:** roots, kindling, herbs and potions shatter instead of landing (Near-Reality).

## Warmth

Warmth is varbit 11434, from 0 to 1000. It is full on entering, and entering with fewer than four warm items gives "You feel the cold wind strike you as you enter; perhaps you should find some warmer clothes." (Wiki).

**Damage**, rounded down (Wiki). FM is the base Firemaking level, W the warm items worn (at most 4) and B the braziers lit (at most 3):

| Attack | Formula |
| --- | --- |
| Standard | `(16 - W - min(2B, 6)) x 100 / FM` |
| Brazier | `2 x floor((10 - W) x 100 / FM)` |
| Area | `3 x floor((10 - W) x 100 / FM)` |

The hitsplat shows that number (75 to yourself, 76 to others), and the meter loses ten times as much (capture: 6, 12 and 18 at 99 Firemaking with four warm items). The health bar is 79, 30 wide.

**Warm clothing** is matched by cache name against the Wiki's list, including its (t), (r), (i) and (or) variants.

**Restoring:**
- Food that heals 4 or more restores 35%, except triangle sandwiches and wine. This uses `food:eaten`.
- A potion dose restores 30%.
- Regeneration is 8% plus 1% per warm item, every 100 ticks (Wiki: per minute; the capture's +120 came on a 100-tick beat).

**At 0:** "<col=ef1020>The cold of the Wintertodt has overcome you!" and a hit for all your hitpoints (capture). It is an ordinary, unsafe death.

## The Wintertodt's attacks

None reach the safe area by the doors. Its outline is Near-Reality's polygon.

**Rolls (Wiki):**
- Standard and area attacks go ahead when a roll up to 3500 is under the energy left, so they fade as the round goes on.
- Brazier and pyromancer attacks go ahead when the roll is over the energy left, so they grow.

**Beats (captures):** area attacks start on a 20-tick beat and the others on a 5-tick beat.

**Standard attack rate (captures):** the cold hits came 10-15 ticks apart at high energy but 25-65 apart below 60%. A linear roll would hit every 10-17 ticks down to 40%, which the captures don't show. Using the energy's share cubed as the chance on each 5-tick beat fits them far better: about every 10 ticks at full energy, 28 at 60%, 80 at 40%, and rarely below that. This matches the Wiki's "very rarely near the end".

| Attack | What happens |
| --- | --- |
| Standard | "The cold of the Wintertodt seeps into your bones.", with a 10-tick cooldown. It interrupts fletching and feeding, not chopping (Wiki). |
| Small brazier | Snowfall (26690) on the brazier's centre, with bolt 501 and graphic 502. 4 ticks later the brazier goes out and anyone feeding it gets "The brazier has gone out.". |
| Large brazier | Snowfall on the centre and its four sides. 4 ticks later the brazier breaks, and everyone within 2 tiles of its centre takes brazier damage: "The brazier is broken and shrapnel damages you.". |
| Pyromancer | Snowfall on her. 3 ticks later she takes 7-13. |
| Area | Varbit 5354 pulses for the target. Snowfall goes on their tile and the four diagonals, with bolt 501. 3 ticks later spot projectiles 1310 and graphics 1311/502 land. 3 ticks after that, icicle 29324 and snow 29325 stay 7 ticks, and anyone in the 3x3 takes area damage ("The freezing cold attack of the Wintertodt's magic hits you."), as does a pyromancer in it. The target's 3x3 must have no collision at all and not overlap another area attack (Wiki: not next to an obstacle). |

A random corner is picked for a brazier or pyromancer attack; it only lands on a lit brazier or a healthy pyromancer. Large attacks are a quarter of brazier attacks, roughly the captures' share. Bolts come from (1630, 4007).

## The reward cart

The cart is loc 55423 in the camp, a multiloc on varbit 11435:

| Rewards owed | Loc |
| --- | --- |
| 0 | 55411 |
| 1-9 | 55412 |
| 10-24 | 55413 |
| 25-49 | 55414 |
| 50-99 | 55415 |
| 100 | 55416 |

- **Search:** anim 11758, one reward 3 ticks later: "You found some loot: 11 x Raw shark" (capture).
- **Big-search:** up to 10 rewards in one search, or every reward left when fewer are owed.
- **Check:** "You are owed 2 more rewards from the cart." or "You aren't owed any rewards from the cart.".
- **Taking the last one:** the message box "You think you've taken as much as you're owed from the reward cart.".

**Loot (Wiki, "Reward Cart" and the Module:Wintertodt supply crate behind its calculator).** Uniques are tried in order, stopping at the first hit:

| Unique | Chance | Notes |
| --- | --- | --- |
| Phoenix | 1/5000 | Through the Pets plugin's `npc-drops:roll`. |
| Dragon axe | 1/10000 | |
| Tome of fire (empty) | 1/1000 | |
| Warm gloves | 1/150 | A magic seed once you own three. |
| Bruma torch | 1/150 | 2-3 torstol seeds once you own three. |
| Pyromancer piece | 1/150 | The piece owned least; ties go garb, hood, robe, boots. |
| Burnt pages | 1/45 | 7-29. |

Otherwise the main table:
- 3/25 each for gems, herbs, seeds, logs, ores and fish;
- 5/25 for 2000-4999 coins;
- 1/25 each for 3-5 saltpetre and 3-5 dynamite.

A skill table tries its items best first, each at `interpolate(level, low, high) / 256` with the module's values. The level is Crafting, Herblore, Farming, Woodcutting, Mining or Fishing. Materials come noted; seeds don't need to be.

## Not captured yet

These follow the Wiki and Near-Reality until a capture says otherwise:
- **Pyromancer:** her fall and healing. The 7-13 damage per hit is chosen so that two hits take her 14 health, as the Wiki says.
- **Fixing:** the fix animation.
- **Warmth restore:** the exact values from food and potions.
- **Text:** the drink message ("You drink some of your rejuvenation potion."), the crate messages other than the knife's, and Brew'ma's.

## Developer commands

| Command | What it does |
| --- | --- |
| `::wintertodt` | To the camp, outside the doors. |
| `::wtstart` | Ends the break and starts a round. |
| `::wtenergy <0-3500>` | Sets the energy during a round; 0 ends it. |
| `::wtpoints <points>` | Adds points to your round, inside the prison. |
| `::wtwarmth <0-1000>` | Sets your warmth. |
| `::wtrewards <count>` | Sets the rewards the cart owes you. |
| `::wtinfo` | Your warm items, warmth, the damage each attack would do now, and the cold's chance. |
| `::wtlight` | Lights every brazier and heals every pyromancer. |
| `::wtattack <area\|small\|large\|pyro>` | Makes the Wintertodt attack you, or the corner nearest you. |
