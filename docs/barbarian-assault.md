# Barbarian Assault

`server/plugins/minigames/BarbarianAssault.plugin.js` plus the units in
`server/plugins/minigames/barbarianassault/`.

## Sources

- Behaviour: [Barbarian Assault](https://oldschool.runescape.wiki/w/Barbarian_Assault),
  [Strategies](https://oldschool.runescape.wiki/w/Barbarian_Assault/Strategies) and
  [Gambles](https://oldschool.runescape.wiki/w/Barbarian_Assault/Gambles).
- Ids: the active cache (`server/target.txt`), read with `yarn dump:widget` and the
  generated `NpcIdentifiers` / `ItemIdentifiers` / `ObjectIdentifiers` files.
- RSProx: the archive was searched for `Barbarian Assault`, the Penance NPC names and
  the BA varbits. There is **no indexed gameplay recording**. Recordings 2908, 2520,
  1521 and 787 only mention BA in achievement-diary/journal text, and 3934 logs in
  with BA role levels and points already set. Timings and numbers therefore come from
  the Wiki; the arena layout and object ids come from the cache.

## Arena

The cache carries two copies of the arena:

| Copy | Bounds | Used by |
| --- | --- | --- |
| `x 1864-1910, y 5448-5490` | southern copy | waves 1-9 |
| `x 1864-1910, y 5384-5426` | northern copy | wave 10 (craters and mushrooms) |

Each match gets a `PrivateArea` covering both copies. The map already places the
launchers, traps, spring, lure cave, machines and caves; the match swaps the two
runner traps for the 2/1/0-charge objects and rebuilds them between waves.

Entry is object 20226 (Barbarian Outpost ladder). The lobby is the surface around
Commander Connad (`2534, 3572`). The Commander's generated `Talk-to` transcript owns
that menu option, so the ladder opens the role prompt (the prompt is titled from
Commander Connad); his `Get-rewards` option opens the reward shop. This is the one
place where the generated dialogue constrains the intended flow.

## Roles and calls

| Role | Calls | Hears |
| --- | --- | --- |
| Attacker | red/green/blue egg | controlled/accurate/aggressive/defensive |
| Collector | attack style | egg colour |
| Defender | poison (tofu/worms/meat) | bait (tofu/crackers/worms) |
| Healer | bait (tofu/crackers/worms) | poison (tofu/worms/meat) |

Calls change every 50 ticks (30 seconds). A horn action sets the partner's heard
call; acting on the old call is a real mistake. Attack styles map as the Wiki says:

| Style | Arrow | Spell |
| --- | --- | --- |
| Controlled | Bullet | Wind |
| Accurate | Field | Water |
| Aggressive | Blunt | Earth |
| Defensive | Barbed | Fire |

Wrong style attacks are refused, deal 2 recoil, and count after the first free one.
Cannon hits are team assists and do not count for the attacker's role points.

## Waves and points

Wave spawns and HP are the Wiki's wave table (initial + reserves). Wave 10 keeps the
normal penance and adds the Queen after all of them die or four minutes pass.

Points for waves 1-9 (Wiki formulas):

- Attacker: `(rangers - 1) + (fighters - 1) - wrong styles` (one wrong hit free).
- Collector: `(eggs collected - exploded) / 4.35`, collected capped at 60.
- Defender: `1.8 * runners killed - 6 * runners escaped` (escapes capped at -10).
- Healer: `0.7 * healers killed + hp replenished / 18 - wrong poison / 4`
  (healing capped at 28, poison penalty at -10).
- Team penalty: -3 per escaped runner, -1 per wrong style (after the free hit), and
  -1 per four wrong poison packs, each capped at -10. A wave pays at least 0.
- Kandarin hard diary pays 10% more (checked from the claimed diary rewards).
- Wave 10 pays 80 in the player's role and 5 in each other role.

Honour points are stored per role (cap 5,000) and mirrored to varbits 4759-4762;
role levels are varbits 3251/3253/3254/3255. The reward shop uses the cache's
`Honour Points` currency, charging the price in every role, and refuses the
Queen-gated armour until the player has a Queen kill. The stock and prices are a
`shops` definition source registered by `Shop.BarbarianAssault.js`; the generated
`shops.json` row keeps only its canonical empty stock and the Commander Connad
binding, so reimporting the canonical data cannot erase the minigame shop.

## Supplies

Everything the arena hands out carries the untradeable and `barbarian-assault:arena`
item meta. A match area refuses player trades (and a global trade guard covers a
member outside the area), arena drops are refused, and cleanup removes only the
arena-marked copies in the inventory *and* the equipment slots, so a player's own
runes, arrows or penance gear are never taken. Reconnect cleanup uses the same
marker, so it also removes arena runes that the old role-item id list missed and
supplies that were equipped before the disconnect.

The four attacker arrows are registered with the combat engine as ordinary bow
ammunition (`Items.rangedAmmoHandler`): a bow resolves them, `checkAmmo` accepts
them only for an attacker in a live match, and the shot consumes the worn stack.
The cache carries no launch spotanim for these items, so they fly with the ordinary
arrow graphic and projectile. Arena arrows are consumed, never dropped, because a
floor drop would leave an untracked copy behind.

## Mechanics

- Collector: eggs drop from penance; the correct colour is the attacker's call.
  Wrong colour explodes (5 damage, counts as exploded). The bag holds 2/4/6/7/8 by
  level. Hoppers load five of each colour; both launchers share the pool.
- Defender: bait is dropped with the item's Drop option. Good bait is the healer's
  current call; a runner eating good bait within one tile of a trap dies and spends
  one charge. Broken traps need a hammer and logs to fix.
- Healer: poisoned food is used on a Penance Healer. The correct poison deals 4 and
  then 1 every five ticks; wrong food is refused with the Wiki message.
- Queen: the collector takes yellow eggs, hands them to the healer (item-on-player),
  the healer dunks them in a poison crater, the attacker adds spikes and hands the
  egg to the defender, the defender dunks it in a lava crater, and the collector
  loads the omega eggs. Each handoff moves cleanup ownership to the holder. Eight
  omega hits kill her.

## Deliberate simplifications

- Firing a launcher is one object click that shoots at the nearest sensible target.
  The cache's turret interface (`495`) is not opened, because the target/ammo
  selection is client-heavy and no recording shows the server side.
- Logs and the hammer for trap repairs are not respawned by this plugin; the
  defender brings them/the world spawn stays as the cache places it.
- The tutorial is not a gate. The Wiki lists no requirements; Captain Cain's
  tutorial dialogue is untouched.
