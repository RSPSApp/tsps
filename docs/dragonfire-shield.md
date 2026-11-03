# Dragonfire shield and abyssal tentacle worn options

Issue [#2165](https://github.com/RSPSApp/tsps/issues/2165): a worn Dragonfire shield's Check and
Activate, and a worn Abyssal tentacle's Check, took the item off.

## Cause

`NetworkBuilder` unequipped the item for any equipment-tab click that no plugin handled. Only op1
is Remove; ops 2+ are the item's worn options (cache params 451+). Neither item had a plugin
handling them, so every one of these clicks fell through to Remove. Now only op1 unequips; an
unhandled worn option says "Nothing interesting happens." and leaves the item worn.

## Evidence

Two rev 242 RSProx recordings of live OSRS (the user's own sessions, 3 November 2026). The
first covers the DFS's inventory and worn options, a blast at a guard, Empty, Bottled
dragonbreath and the tentacle's Check; the second a dragonfire breath charging the emptied
shield from 0 to 1. The rsprox.net index has no attempts at these. Cache names from the pinned
[osrs-dumps snapshot](https://github.com/Joshua-F/osrs-dumps/tree/6e5033af6215963581a51b348f452320ff18f0f6/config).

| Action | Live response |
| --- | --- |
| DFS Inspect (inventory), Check (worn) | `The shield has 50 charges.`; uncharged: `The shield has no charges.` |
| DFS Activate (worn) | varp `sa_attack` (301) 0 -> 2; clicked again 2 -> 0 |
| Activate while recharging | `You must let the shield cool down before using it again.` |
| Next attack while armed | replaces the attack: `sa_attack` 2 -> 0, varbit `dragonfire_shield_recharge` (6539) 0 -> 24, seq 6696, spotanim 1165, area sound 3761 (range 10); projectile 1166 at 80 -> 85 client cycles, heights 120; impact spotanim 1167 delay 85 height 120; area sound 161 at the target, delay 85; one charge used (50 -> 49) |
| Hit | 3 ticks later at 1 tile (9 damage) |
| Defence xp | 36 on the blast tick for 9 damage (4 per damage) |
| Recharge | varbit 6539 falls by 1 every 8 ticks (24 steps, 192 ticks; Mod Ash on the Wiki) |
| DFS Empty (inventory) | `You vent the shield's remaining charges harmlessly into the air.`, seq 6700, spotanim 1168, sound 3760; the shield becomes uncharged |
| Bottled dragonbreath on the uncharged shield | `You charge your shield using the bottled dragonbreath.`; Inspect then reports 50 |
| Dragonfire on the worn uncharged shield (green dragon, second recording) | same tick as the breath: `Your shield absorbs most of the dragon fire!` then `Your dragonfire shield glows more brightly.` (both spam), seq 6695 delay 30, spotanim 1160 (`shield_charge_one`) delay 30, sounds 3750 then 3740; the worn shield becomes the charged one; 5 damage the next tick |
| Tentacle Check (inventory op, worn op2) | `Your abyssal tentacle can perform 955 more attacks.` |

From the [Wiki](https://oldschool.runescape.wiki/w/Dragonfire_shield): 50 charges at most, a
10-tile range, 25 max hit (3 against a player with an anti-dragon shield), accuracy from the
attacker's Defence against the target's Magic defence, Protect from Magic does not help, and
`Your dragonfire shield is already fully charged.`. The
[tentacle](https://oldschool.runescape.wiki/w/Abyssal_tentacle) has 10,000 charges, one per attack
including misses, and becomes the kraken tentacle at none; the
[(or) tentacle](https://oldschool.runescape.wiki/w/Abyssal_tentacle_(or)) also gives back its kit.

## Not covered (no source)

- The blast's exact accuracy formula is unpublished; `(Defence + 9) * 64` against the target's
  magic defence roll stands in.
- Flight time beyond one tile: the recording only has a 1-tile blast. Each extra tile adds 5
  client cycles here.
- Absorbing: only 0 -> 1 is captured. The other four charge graphics (1161-1164) are assumed
  to follow in tens of charges after the absorb (11-20 -> two ... 41-50 -> five). At 50 the
  Wiki's fully-charged message is sent and nothing plays; neither is captured. The brace stall
  the Wiki mentions did not show in the capture and is not implemented.
- Absorbing is wired to the shared dragonfire helper (`combat:dragonfire-breath` from
  `DragonfireProtection.js`, used by chromatic and metallic dragons) and Elvarg. Vorkath, the
  King Black Dragon and wyvern icy breath have their own breath code and do not send it yet.
- The per-charge defence bonuses and the targets the blast does not work on (dragons,
  wyverns, some bosses) are not implemented. Both shields' item data carry the full
  50-charge bonuses today.
- A tentacle's Check with 1,000+ charges: thousands separators assumed.
- The tentacle's degrade message, if any.
