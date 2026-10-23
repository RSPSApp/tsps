# The Mimic

The elite/master clue casket boss in the arena below Watson's house, built from
the OSRS Wiki ([The Mimic](https://oldschool.runescape.wiki/w/The_Mimic)) with
Near-Reality's fight cross-checked mechanic by mechanic. Near-Reality is a leaked dump with no
license: a behaviour oracle only, no code was ported. Where only NR attests a value,
the Shipped cell says NR-only.

The plugin is `server/plugins/bosses/Mimic.plugin.js`, units in
`server/plugins/bosses/mimic/`.

| File | What it owns |
| --- | --- |
| `Shared.Mimic.js` | Ids (cache gamevals), arena tiles, candy table, anims. |
| `State.Mimic.js` | Per-casket identity, origin, original clue-roll count, remaining attempts and victory; saved loss ledger for dropped/grave-held caskets. |
| `Lair.Mimic.js` | PrivateArea over the real arena (multicombat, so boss + minions can pile one player), entry (casket on strange casket), keyhole exit behind the "Are you sure you wish to leave?" confirm, stomp ticks, cleanup. |
| `Challenge.Mimic.js` | `Challenge` on the casket form (7979) wakes the boss (8633). |
| `Fight.Mimic.js` | Attack script: melee crush, candy volley, minions, stomp hits, death cleanup. |
| `Minions.Mimic.js` | Minion attacks: ranger fire-arrow flight + synced hits, mage Earth Wave cast/flight/impact + synced hits. |
| `Reward.Mimic.js` | Chest Open messages + rolls: kill suppresses ground drops and marks defeated; leave/death with the fight on spends one roll (simultaneous free); Open outside pays one table pass per remaining roll with attempt-scaled quantities and consumes the chest. |

Already in data (not this plugin): combat stats (`monsters-complete.json`: 8633 max 23/speed 3, minions 40 hp), drops (`npc-drops.json`: `the_mimic`, `the_mimic_2`), spawns (open-world 8633 left alone), animations (`npc-animations.json`; boss block explicitly -1, it has no flinch), ranger projectile (`npc-combat-defs.json`: 8636 → 1574; NR-oracle value triangulated as lit fire arrow from bronze-tier strength and the orange streak, still awaiting a capture), mage projectile (8637 → 165, Earth Wave: the Wiki green; max 16 from the dump), Slayer/task gating (none per Wiki), kill tracking (`bosses.json`: Mimic varp 2221), the strange casket object (34733) and keyhole (34727).

## Triangulation (Near-Reality vs Wiki)

| Mechanic | Near-Reality | Wiki | Shipped |
| --- | --- | --- | --- |
| Entry: mimic casket on strange casket (Watson upstairs) | casket item + keyhole exit to Watson | present casket to strange casket in Watson's house | item-on-object, teleport to private arena |
| Casket form 7979, `Challenge` → attackable 8633 | `MimicPlugin`, owner check | casket comes to life | transform + aggro (no owner check: owner-only spawn + private area) |
| Melee crush, max 23, anim 8308 | `attackType == 2`, `melee()` | max hit 23, Crush style | crush max 23 via `applyStyleDamage` |
| Attack choice per swing | in melee 0 candy / 1 follow / 2 crush, else 0 candy / 1 follow (`Utils.random` inclusive) | crush in melee, sweets + advance otherwise | same thirds in melee; out-of-melee volleys wait a uniform 2-4 swing gap (NR's coin flip clusters back-to-back); walking is the engine's close-in routing via the combat:close-in flag |
| Candy volley, anim 8309: six tiles (own + 5), 3 pink + red/green/blue | `findLocations` + `immutableCandyList` | six candies, 3 purple, red/blue/green spawn minions | same 6-tile volley, same colour order |
| Pink on tile: 8-12 damage | `Hit(8, 12)` if still on tile | "about 10" unless you step away | 8-12 if still on tile at landing |
| Red→Warrior, Green→Ranger, Blue→Mage; max one each; no drops; respawn next volley | `spawnIfAbsent`, no drop tables | minions drop nothing, killing them pointless | same caps; minions have no drop tables |
| Stomp under boss: 1-1-1-2-2-2… cap 6/tick, resets away | damage counter per player | exact same scaling | per-tick in area, same scaling |
| Boss death kills minions | `clearThirdAgeMonsters` | — (implied) | same |
| Private instance, keyhole exit | dynamic region copy | instanced fight | PrivateArea over the real room (TSPS has no region copier) |
| 87 Slayer / task gate | none | none | none |

## The fight

- **Enter:** use item 23184 (Mimic casket) on the strange casket upstairs in Watson's
  house → private arena at (2719, 4314, 1), casket form waiting at (2718, 4319, 1).
- **Challenge** the casket: it becomes the 5x5 boss and attacks.
- Each swing the boss crushes, holds, or lobs candy (a third each in
  melee; half holds, half candy out of melee, volleys on uniform gaps), while
  it walks toward you until beside you. Parked on a corner it sidesteps into
  crush range instead of volleying. Move off pink tiles; ignore minions.
- **Melee** in reach (crush, max 23, Protect from Melee helps); otherwise candy volleys.
  Move off pink tiles; ignore minions.
- **Stomp:** don't stand under it.
- **Death:** loot rolls from the drop tables; minions die with it; leave via the
  keyhole to Watson's house, by the strange casket (1645, 3570, 1). Logging out
  or leaving ends the fight.

## To verify

`::item 23184`, use it on the strange casket, `Challenge`, survive: melee hits ~23s,
candy volleys of six with minion spawns, escalating stomps, joint minion death.

## Casket state

The [Mimic item page](https://oldschool.runescape.wiki/w/Mimic) permits juggling
and carrying several Mimics. Each casket therefore has its own identity and saved
state. Arena entry binds that identity; moving or dropping the item cannot charge
another casket, transfer a victory or refund a failed attempt. The player save
retains a ledger for an item that is temporarily absent. Recovery reconciles the
item and ledger downward. A simultaneous player/boss death retains the victory
without spending an attempt. Opening uses the clicked inventory slot.

Five elite or six master attempts are distinct from the original4–6 elite or
5–7 master clue rolls. Each failure removes one original reward roll. Legacy items
stored only an elite-style count; migration preserves their prior default of five
original rolls rather than inventing a master origin. Corrupt state is rejected.

Original clue roll ranges come from the complete unmodified canonical
`clue-caskets.json` artifact, exporter commit `2d2965fb`, SHA256
`98564db4cee328d18898be7562877ff34a53106af472052375a12438f6e4ea56`.
The state and session tests cover multiple caskets, loss recovery, simultaneous
death, the clicked slot, corrupt metadata and the real player save/load path.

## Not yet implemented

- **Casket acquisition:** elite/master reward caskets don't open in TSPS yet (no clue
  system), so the entry item is `::item`-only for now.
- **Reward delivery:** engine tables (Wiki-sourced Elite `the_mimic` +
  Master `the_mimic_2`, incl. the Always plank) roll on kill but pay on Open
  outside the arena: one full pass plus one extra-rolls pass per remaining roll
  (no double plank), consumable quantities floored to max × rolls/5 (Wiki tiers),
  one "little extra reward" line for the first non-plank drop, and the clue
  loot window (group 73) as display. Six chances master, five elite (fresh
  chests default elite); every leave or death with the fight on costs one,
  simultaneous death does not; at zero the chest disappears. The obtain line ("The chest turned out to be
  the Mimic!") waits on the clue system with acquisition, pity counters and
  acquisition integration. Origin/attempt state is implemented above. Tertiary scroll case, ring rate shift and base4–6 elite/5–7 master clue rolls
  are follow-ups with the same.
- **Death retrieval fee** (NR: 90k at the strange casket) and the boss timer.
