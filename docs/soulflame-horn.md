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
  The fade line came only once (3105 -> 3115), when no melee attack had spent the effect.

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
  attack roll by 1.5 until the roll's `onCombatHitDamage`.

## Ours

- Configure (radius 0-3, max players 1-20) is not implemented; it always uses 3 tiles and 3 others.
- With energy for fewer allies than are eligible, the nearest that can be paid for are affected.
- A press inside the cooldown does nothing and sends nothing.
- The dragon and burning claws specials (`firstSuccessfulAccuracyDamageRanges`) don't emit the
  roll event, so they neither spend the effect nor get the Wiki's guaranteed second check.
