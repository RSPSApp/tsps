# Soulflame horn: Entice

`server/plugins/combat/specials/SoulflameHorn.SpecialAttack.js`. Test:
`server/tests/soulflame-horn-special.test.cjs`.

Entice is a utility special (`skipAttack`): it resolves on the special-bar press, with no target
and no swing. The horn is a Yama unique.

## Live behaviour

[Soulflame horn](https://oldschool.runescape.wiki/w/Soulflame_horn) (Wiki):

- It reaches up to 3 other players within 3 tiles, costing 25% special energy per other player
  affected. The user is empowered too, at no extra cost.
- An empowered player's next melee attack within 10 ticks is a successful hit; this covers melee
  special attacks. For a multi-hit attack only the first accuracy roll is guaranteed. Against
  another player it is a 50% accuracy increase instead.
- Inside Nightmare, Nex, all raids, Royal Titans and Yama everyone, Ironmen included, can receive
  it. Elsewhere a player needs Accept Aid on.
- With no eligible player in range: "You blow your horn into the wind. No-one nearby is able to
  listen." (red), no effect, no flame graphic, no energy spent.
- 4-tick cooldown, independent of the weapon's attack speed.

rsprox captures:

- Recording 3865 (rev 235), the user side. Ticks 428 and 445, nobody near: `<col=ef1020>` refusal
  and seq `soulflame_horn_blow_03_no_fire`, `sa_energy` unchanged. Tick 474, one ally:
  `sa_energy` 1000 -> 750, `<col=3366ff>You encourage nearby allies, which also empowers your next
  melee attack!`, seq `soulflame_horn_blow_03`, spotanim `vfx_soulflame_horn_spotanim01` at height
  100, synth sound 10236; ten ticks later, with no melee attack made,
  `<col=3366ff>The Soulflame horn's effect fades away.`
- The user's `cox/cox_cm_3man_run1` recording, the receiving side (ticks 940, 3105, 3300, 3507,
  3716): `<col=3366ff><name> encourages you with their Soulflame horn, empowering your next melee
  attack!`, spotanim `vfx_soulflame_horn_impact_spotanim01` with delay 30 and synth sound 10236.
  The fade line came only once (3105 -> 3115), when no melee attack had spent the effect. The
  `cox_cm_3man_run2` recording (also rev 239.1) has the same `3366ff` ally line.
- Recording 3865 (rev 235) also holds the receiving side (ticks 729, 789, 862, 875, 941), but its
  ally line is `<col=0000b2>`; its own user and fade lines are `3366ff`. All three recordings have
  `chatbox_transparency` 1, so the background does not explain it: the colour changed between
  rev 235 and 239. The code sends the newer `3366ff`. In 3865 the grant at tick 789 fades at 798,
  9 ticks on (941 -> 951 is 10); the Wiki says 10 ticks, and the code waits 10.

## How it is built

- Allies are the user's local players on the same plane and instance within 3 tiles (Chebyshev),
  alive, and either inside one of the exempt content's areas (matched by the area class name:
  `NightmareDream`, `NexChamber`, `NexInstance`, `CoxMap`, `TheatreArea`, `TheatreOfBloodArea`,
  `TombsOfAmascutArea`, `RoyalTitansArea`, `YamasDomain`) or with the `accept-aid` attribute not
  `false` (AcceptAid.plugin.js keeps it off for Ironmen).
- Each empowered player holds one pending grant; a 10-tick task clears an unspent one with the
  fade line. A newer Entice replaces the grant and its timer.
- `onCombatHitRoll` spends it on the player's next melee roll: `forceAccurate` against an NPC;
  against a player it marks the roll, and a melee attack-roll modifier multiplies that roll's
  attack roll by 1.5 until the roll's `onCombatHitDamage`. `attackMeleeRoll` caches the finished
  roll per cycle, so the plugin clears the attacker's roll cache when the boosted roll starts and
  again when it ends: a roll cached earlier that cycle gets the bonus, and the second hit of a
  multi-hit attack does not (`tests/soulflame-horn-pvp-roll.test.cjs`, a real dragon dagger
  special against a real player).

## Ours

- Configure (radius 0-3, max players 1-20) is not implemented; it always uses 3 tiles and 3 others.
- With energy for fewer allies than are eligible, the nearest that can be paid for are affected.
- A press inside the cooldown does nothing and sends nothing.
- The dragon and burning claws specials (`firstSuccessfulAccuracyDamageRanges`) don't emit the
  roll event, so they neither spend the effect nor get the Wiki's guaranteed second check.
