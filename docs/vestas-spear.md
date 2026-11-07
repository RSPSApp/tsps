# Vesta's spear (bh) - Spear Wall

Source: the OSRS Wiki page for Vesta's spear (https://oldschool.runescape.wiki/w/Vesta%27s_spear), fetched
while writing this change. No rsprox recording of the weapon exists in the index, so the Wiki is the only
evidence.

## Behaviour

- Costs 50% special attack energy.
- The first hit rolls up to the full max hit. Two ticks later a second hit deals 50% to 75% of the first
  hit's damage (the minimum was raised from 25% in January 2025). A missed first hit leaves a second hit of 0.
- For 8 ticks from the use the wielder is immune to melee and ranged attacks, even after switching weapons.
  The Wiki does not mention magic, so magic hits still land.
- A successful hit takes one tick off the wielder's next attack delay.

## In the server

`plugins/combat/specials/VestasSpearBh.SpecialAttack.js` registers the special with two hitsplats
(`hitDelayTicks: [0, 2]`), the second computed from the first by `distributeDamage`. The immunity is the
`vestas-spear:immune-until` process cycle, checked in an `onPlayerHitModify` hook when a hit lands, so a hit
that was already in flight when the 8 ticks ended is not blocked and one that lands inside them is.
The attack delay is cut in `handleAfterHitEffects` when the hit landed.

Checked in game over the agent MCP: the first hit landed the tick after the use, the second two ticks later
(25 then 14 of 60; 13 then 7 of 150), a hit landing inside the 8 ticks did 0 and the first one after did damage,
and the next normal swing came 4 ticks after the special (the cache gives the weapon speed 5).

## Not covered

- The weapon's area restriction (Daimon's Crater, Castle Wars, Clan Wars, Soul Wars, the Fight Pit, the POH and
  Clan Hall combat rings) is not enforced.
- Vesta's spear (Deadman Mode) keeps its own special file; this change does not touch it.
