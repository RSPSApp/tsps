# Kraken

Kraken and Cave krakens in the Kraken Cove, built from the OSRS Wiki
([Kraken](https://oldschool.runescape.wiki/w/Kraken),
[Cave kraken](https://oldschool.runescape.wiki/w/Cave_kraken)). No rsprox capture
covers this fight yet; tiles and animations below are from the cache and
`data/definitions`, timings marked estimate are guesses.

The plugin is `server/plugins/bosses/Kraken.plugin.js`, with its units in
`server/plugins/bosses/kraken/`.

| File | What it owns |
| --- | --- |
| `Shared.Kraken.js` | Ids (cache gamevals via `NpcIdentifiers`), surfacing animations, small helpers. |
| `Disturb.Kraken.js` | Disturbing whirlpools to surface them; the boss also wakes nearby tentacles. |
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
- **Whirlpool (496)** two ways to wake (Wiki): use a **fishing explosive** (6660/6664, one
  consumed — estimate) on it for an instant wake, or Disturb it once all four tentacle
  whirlpools are disturbed. Disturbing it early says "Nothing happens." (estimate).
  Either way it becomes **Kraken (494)**, anim 7135, aggros, with nearby tentacle whirlpools
  (~10 tiles, estimate) surfacing with it (boss at (2278, 10034), its four whirlpools at
  (2275/2284, 10034/10038)).
- **Styles:** Magic is the only reliable damage (Wiki). Ranged deals 1/7th on 492/494/5535;
  Melee lands for 0 with "You can't attack it properly like that." (Wiki).
- **Typeless:** the Kraken and its tentacles ignore Protect from Magic (Wiki); cave krakens
  stay prayable.
- **Respawn:** deaths come back as whirlpools via the engine (transformation cleared before
  the respawn is queued).

## Private room

The crevice's Private option asks for 25,000 coins from either inventory or bank;
the room is visible only to its owner and closes when they leave. The choice of
payment source, prompt wording and closing on any completed teleport are this
server's policies, rather than captured retail wording or internal-teleport rules.
The public Enter and Use options remain available. [Jagex's original update](https://secure.runescape.com/m=news/boss-pets-sets-chat--more?oldschool=1)
describes the fee, payment sources and room lifetime.

Peek remains unimplemented: it reports the number of players in the public boss
room on OSRS, but this server's broad Kraken Cove area also includes the exterior.
The boss-room membership boundary has not been established here. The cove's
attack hook checks the player's Kraken task; the existing Slayer combat checks
also apply.

## To verify

`::teleports` Bosses tab now lists Kraken (lands inside the cove at (2280, 10016), by the
boss-pool crevice). Or `::tele 2280 10016`, then Enter the crevice. Disturb a
whirlpool, it surfaces and attacks; melee/ranged splash, Magic damages; kill it and a
whirlpool respawns.
