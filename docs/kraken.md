# Kraken

Kraken and Cave krakens in the Kraken Cove, built from the OSRS Wiki
([Kraken](https://oldschool.runescape.wiki/w/Special:PermanentLink/15383981),
[Cave kraken](https://oldschool.runescape.wiki/w/Cave_kraken)) and two revision 237
RSProx recordings of one player in a private room on a Leagues VI world.
[237/1150](https://rsprox.net/download/1150) · [237/1151](https://rsprox.net/download/1151)

The plugin is `server/plugins/bosses/Kraken.plugin.js`, with its units in
`server/plugins/bosses/kraken/`.

| File | What it owns |
| --- | --- |
| `Shared.Kraken.js` | Ids (cache gamevals via `NpcIdentifiers`), surfacing animations, small helpers. |
| `Disturb.Kraken.js` | Disturb interactions and the fishing explosive throw and wake. |
| `MagicOnly.Kraken.js` | Style rules: Ranged 1/7th, Melee immune with the Wiki message; Magic unaffected. |
| `Typeless.Kraken.js` | Boss + tentacles ignore Protect from Magic (Wiki typeless); cave krakens stay prayable. |
| `Crevice.Kraken.js` | Crevice 537 Enter into the boss pool (2280, 10022), Crevice 538 Use back out (2280, 10016). No squeeze animation captured, so none plays (estimate). |
| `Instance.Kraken.js` | Private-room ownership, actors and teardown. |
| `Fight.Kraken.js` | Attack script for 492/494/5535: Magic, Fire-Wave-like projectiles (156 boss, 162 cave/tentacle; real spotanims in rev 241), impacts 157/163, splash on miss. Speeds/max hits stay the dump's. |
| `Area.Kraken.js` | Kraken Cove multicombat over the Slayer-area box, so boss + tentacles can pile one player. |
| `Respawn.Kraken.js` | No mid-fight trickle: tentacles killed while the boss is up stay dead; killing the boss kills the rest and respawns all five whirlpools together on the boss timer. |
| `Loot.Kraken.js` | Boss loot lands on a fixed verified shore tile (2280, 10031), not in the water under the body. |

Already in data (not this plugin): combat stats (`monsters-complete.json`: Kraken 494,
87 Slayer, max hit 28, magic), drops (`npc-drops.json`: `kraken`, `cave_kraken`),
spawns (`npc-spawns.json`: cave whirlpools 493, boss whirlpool 496 at (2278, 10034) with
four tentacle whirlpools 5534 around it, surfaced Mimic 8633 elsewhere), animations
(`npc-animations.json`: 7135 surfaces cave/boss, 3860 surfaces a tentacle), Slayer level
enforcement (`Combat.Slayer`), cannon rules (`cannon-restrictions.json`: Kraken Cove),
teleports (`loc-teleports.json`: cave entrance/exit 30177/30178), kill tracking
(`bosses.json`: Kraken).

## The fight

- **Whirlpool (493)** Disturb: becomes **Cave kraken (492)**, anim 7135, aggros the disturber.
  Fishing explosives do nothing here (Wiki).
- **Reach:** the pools sit in water with no adjacent tile, past the engine's 2-tile water fallback, so Disturb works from up to 10 tiles with line of sight (estimate; the engine still enforces the sight line).
- **Whirlpool (5534)** Disturb: becomes **Enormous Tentacle (5535)**, anim 3860, aggros.
- **Whirlpool (496)** wakes from a fishing explosive or from Disturb after the four
  nearby tentacle whirlpools have surfaced. Disturbing the boss early says "Nothing happens."
  (estimate). The boss starts at (2278, 10034) and its four tentacle whirlpools are
  at (2275/2284, 10034/10038).
- **Fishing explosive:** spend one from the selected inventory slot on the throw. The player plays sequence 385
  (`human_throw`) with spotanim 50 (`vial_launch`) at height 96. Projectile 49
  (`vial_travel`) starts at the player's tile and targets the centre of the whirlpool.
  It starts at cycle 28 with angle 50, progress 32 and heights 163/0. Its end cycle
  is 46 + 35 per tile to the nearest tile of the 5×5 whirlpool. Sound 2379 plays
  with the same delay. TSPS implements the throw mechanics and omits the recorded game message.
- **Wake from three tiles:** all four tentacles rise eight ticks after the throw
  with sequence 3860 and begin attacking with sequence 3618 the following tick.
  The boss rises with sequence 7135 two ticks after the tentacles. That gap is two
  ticks in 109 observed throws and one in R1150 (11519–11520). R1151 (3623–3633)
  shows the usual timing. The Wiki's immediate-wake wording describes bypassing
  the four Disturb interactions. [Fishing explosive](https://oldschool.runescape.wiki/w/Special:PermanentLink/15347755) · [Enormous Tentacle](https://oldschool.runescape.wiki/w/Special:PermanentLink/15368757)
- **Styles:** Magic is the only reliable damage (Wiki). Ranged deals 1/7th on 492/494/5535;
  Melee lands for 0 with "You can't attack it properly like that." (Wiki).
- **Typeless:** the Kraken and its tentacles ignore Protect from Magic (Wiki); cave krakens
  stay prayable.
- **Respawn:** the boss whirlpool and all four tentacle whirlpools return together
  10–14 ticks after the boss is removed. The public cove uses the
  [Kraken infobox](https://oldschool.runescape.wiki/w/Special:PermanentLink/15383981).
  A lone tentacle killed while the boss is down uses its own definition's delay.

## Private room

The crevice's Private option asks for 25,000 coins from either inventory or bank;
the room is visible only to its owner and closes when they leave. The choice of
payment source, prompt wording and closing on any completed teleport are this
server's policies, rather than captured retail wording or internal-teleport rules.
The public Enter and Use options remain available. [Jagex's original update](https://secure.runescape.com/m=news/boss-pets-sets-chat--more?oldschool=1)
describes the fee, payment sources and room lifetime.

Floor items in the private room last 30 minutes, as specified in the
[17 August 2017 update](https://oldschool.runescape.wiki/w/Update:Runes_and_Ammunition_%26_Log_In_Screen_Competition!).
Leaving the room still destroys its remaining floor items.

TSPS uses the same 10–14 tick joint respawn in the private room. All 108 observed
private respawns across the two Leagues VI recordings were in that range, including
R1150 11304–11315 and R1151 3610–3621 and 3717–3731. The Kraken Wiki prose says the
private respawn is slower than the public respawn and gives no private figure.
Timing in an ordinary-world private room remains unverified.

Peek remains unimplemented: it reports the number of players in the public boss
room on OSRS, but this server's broad Kraken Cove area also includes the exterior.
The boss-room membership boundary has not been established here. The cove's
attack hook checks the player's Kraken task; the existing Slayer combat checks
also apply.

## Estimates

- **Longer throws.** Tentacles rise two ticks after the projectile's end cycle
  rounded up to a game tick, and the boss follows two ticks later. The formula
  matches R1151 3538–3553 at eight tiles and R1150 11209–11227 at ten tiles as
  well as the repeated three-tile throws. Other distances were unobserved.
- **Respawn selection.** TSPS draws uniformly from the five ticks for each boss
  respawn. The observed counts for 10 through 14 ticks were 13, 22, 26, 24 and 23.
- **Overlapping throws and exit.** A second explosive while a wake is pending
  has no effect and costs no item. Leaving before the tentacles rise cancels
  the wake and the thrown explosive stays spent. The captures show one throw
  per spawn and no departure with a throw in flight.

## Combat Achievements

The Kraken's five tasks (cache task structs):

| Task | Tier | How it finishes |
|---|---|---|
| Kraken Adept | Hard | 20 kills, from the kill count. |
| Unnecessary Optimisation | Hard | Kill all four tentacles, then the Kraken. They may die before it is woken, as the Wiki allows. A tentacle killed while the Kraken is down respawns as its whirlpool on its own timer, and stops counting once it is back. Each tentacle counts for whoever killed it last. The tentacles that die with the Kraken respawn with it, so they never carry into the next fight. |
| Krakan't Hurt Me | Hard | 25 kills in one private room. |
| Ten-tacles | Elite | 50 kills in one private room. |
| One Hundred Tentacles | Master | 100 kills in one private room. |

The streaks count the Kraken kills in the room you rented. The room closes when you leave it,
whether you walk out, teleport, die or log out, and a new rental starts at 0. Kills in the
open cove don't count. `plugins/bosses/kraken/CombatAchievements.Kraken.js`, tested by
`server/tests/kraken-combat-achievements.test.cjs`.

## To verify

`::teleports` Bosses tab now lists Kraken (lands inside the cove at (2280, 10016), by the
boss-pool crevice). Or `::tele 2280 10016`, then Enter the crevice. Disturb a
whirlpool, it surfaces and attacks; melee/ranged splash, Magic damages; kill it and a
whirlpool respawns.
