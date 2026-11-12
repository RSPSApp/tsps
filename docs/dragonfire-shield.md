# Dragonfire shield, ward, wyvern shield and abyssal tentacle worn options

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

## Dragonfire ward and Ancient wyvern shield

The plugin also covers the [Dragonfire ward](https://oldschool.runescape.wiki/w/Dragonfire_ward)
and the [Ancient wyvern shield](https://oldschool.runescape.wiki/w/Ancient_wyvern_shield). Before,
neither had any handler: their worn Check / Activate / Operate answered "Nothing interesting
happens." and nothing could charge them.

| Behaviour | Source |
| --- | --- |
| Ward: Inspect, Check, Empty, Activate, 50 charges, charged by dragonfire and by Bottled dragonbreath, blast up to 25 | Wiki, Dragonfire ward |
| Wyvern shield: Inspect, Check, Empty (same vent message), Operate, blast up to 15, cooldown as the shield's | Wiki, Ancient wyvern shield |
| Wyvern shield is charged by fossils and numulites, not by dragonfire or Bottled dragonbreath | Wiki, Ancient wyvern shield |
| Fossil used on the wyvern shield (small, large and plant fossils, unidentified small): spam message `Your ancient wyvern shield glows more brightly.`, synth_sound 3740, fossil used up | rsprox recording 198 (rev 227, a Leagues world; the only recording of it) |
| Fossil charges: small 1, medium and plant 2, large 3, any unidentified 1, identified rare none; 500 numulites for 1 charge; the worn Recharge uses what the inventory holds | Wiki, Ancient wyvern shield (the Recharge flow and numulite use are read from this one page, not captured) |
| Each charge adds 1 to stab, slash, crush and ranged defence (magic and attack bonuses unchanged); each blast, so each spent charge, takes it off again | Wiki, Dragonfire shield, Dragonfire ward, Ancient wyvern shield |

The item data (from the cache dump) holds the **uncharged** defence bonuses for both the charged
and the uncharged ids of all three shields (a full Dragonfire shield showed stab +20 where the
Wiki has +70 at 50 charges), so a charged shield gave no defence for its charges. The bonus now
comes from a bonus provider: item data plus the saved charges.

## Buff bar cooldown

The buff bar shows each shield's special cooldown (All Settings 132), from the cache's buff structs.
The Dragonfire shield's (struct 3082) reads varbit 6539 and the ward's (839) varbit 6540, both in steps
of 8 ticks, so a blast sends the varbit of the shield that fired. The wyvern shield's (840) has no
varbit: the bar counts it against `map_clock` from the tick it ends on, which only `buff_bar_start`
(script 5931) sets. A wyvern blast sends that with the end tick, and 0 when the recharge ends. A
recharge running at logout comes back on the same shield's cooldown at login. Not recorded: no
capture has a ward or wyvern shield blast.

## Not covered (no source)

- The ward's and the wyvern shield's blast graphics are unrecorded. The ward reuses the Dragonfire
  shield's cast, projectile and impact; the wyvern shield uses the same with its cache cast
  graphic `fossil_wyvern_shield_attack_spotanim` (1402). Their Empty animations are the cache's
  `dragonfire_ward_releasing_charge` (7873) and `fossil_wyvern_shield_release_charge` (7700) with
  the matching release graphic (1168 for the ward, 1401 for the wyvern shield).
- A fossil or numulites used on a full wyvern shield, or fewer than 500 numulites, fall through to
  the default response; the live message is unknown.
- Targets the blast does not work on (the Wiki lists chromatic and metal dragons, wyverns, frost
  dragons and "some bosses", and the pages disagree on metal dragons) and the brace-behind-the-shield
  stall are not implemented.
- The ward absorbing wyvern icy breath (Wiki: it adds a charge) is not wired.
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
- A tentacle's Check with 1,000+ charges: thousands separators assumed.
- The tentacle's degrade message, if any.
