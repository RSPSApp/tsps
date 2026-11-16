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
  special attacks. For a multi-hit attack only the first accuracy roll is guaranteed, except
  dragon and burning claws: their first check is ordinary and their second check is affected.
  Against another player it is a 50% accuracy increase instead. Applying that PvP replacement
  to the same second claw check is inferred from these adjacent Wiki rules; there is no local
  capture establishing the PvP check order.
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
- First-successful specials use `combat:first-successful-accuracy`, emitted once before any
  accuracy check. Its `specialId` is captured with the active traits before prepare hooks can
  change the attacker's selected special; `accuracyRolls` holds fresh per-check overrides for
  this resolution. The horn spends its grant immediately, including when the first claw check
  lands and the second is never reached. Dragon/burning claws select index 1; Vesta's single-range
  Spear Wall uses index 0. PvP scales only that check through `withAccuracyScale(1.5, roll)`,
  after cached base rolls, with `finally` restoring the scope. No state waits for a damage hook,
  and the ordinary roll/damage listeners do not receive new first-successful branch calls.

## Verification of the claw integration

- Native path: special orb/bar → `NetworkBuilder` → `CombatSpecial.activate` → horn grant;
  inventory equip → `EquipPacketListener`/`WeaponInterfaceManager`; Attack NPC/player →
  `NPC_ACTIONS`/`PlayerOptionPacketListener` → `Combat` → special method `hits` → `PendingHit`
  → local accuracy overrides → existing formula/range split → queued impact/client sync.
- `tests/soulflame-horn-pvp-roll.test.cjs`: 17 real Player/NPC/PendingHit checks pass. Actual
  item-definition, special and equipment plugins initialize through their production APIs;
  transport and deterministic accuracy RNG are controlled. Tests cover both claw branches,
  first-success consumption, second-check-only PvP scaling with/without a cached roll,
  same-cycle follow-ups, one-HP caps, grant replacement/expiry, an intervening prepare-hook
  special reassignment, Vesta's single-range control and ordinary dragon dagger rolls.
- The focused horn/melee-special/Vesta/dragon-dagger run initially passed 60 of 61 checks;
  the remaining existing area-name check needed Git grep on PATH and its MSYS runtime outside
  the Windows sandbox, then passed separately. Three additional cap/replacement checks brought
  the real-object horn file from 14 to 17 passing checks. No full suite was run.
- The original all-plugin test fixture briefly opened an unrelated admin listener through its
  startup hook; shutdown completed with process exit, and a read-only port check found no
  remaining listener. The horn integration fixture now initializes only its required plugins.
- Independent review passed four additional real scenarios with no findings in the inspected
  paths: the real EquipPacketListener path preserves Entice through a ranged attack, and actual Vesta
  immunity/CombatFactory/HitQueue impact rejects damage while a later roll remains unscaled.
- Two rendered clients verified native horn equip/activation, 25% energy per eligible ally,
  encouragement/fade feedback, dragon/burning claw equip, orb activation and NPC Attack.
  The NPC hits resolved as `[7,0,0,0]` and `[4,3,0]`, capped to existing Man NPCs' seven HP;
  inspected screenshots show the special animations and hitsplats. The burning sequence
  consumed 25% for the horn plus 35% for the claws, leaving 40%.
- A native two-player Wilderness fight passed the real attack-permission gate and used the
  actual player Attack packet. The first run retained MCP's default developer protection:
  visible/resolved damage did not reduce player HP. A focused repeat explicitly enabled
  `::mortal` for both fixture accounts and acknowledged the client inventory update plus
  server claw equipment before attacking. The claw hit `[14,7,3,4]` reduced target HP
  `99→85→78→75→71` across its two impact ticks; applied-damage observers and the rendered
  HP display agree. A separate ordinary follow-up in the protected run used the plain
  13,310 attack roll. Controlled stats, items, energy and positions are fixture setup;
  equipment, horn/special activation, targeting, walking and logout used native controls.
- Both native claw runs landed their first check, so the second-check guarantee/PvP multiplier
  was configured but unused. Deterministic real-object tests establish those hidden check
  semantics; screenshots do not establish accuracy probabilities. Audible playback was not
  checked. Recording 3865 supports horn feedback, not the claw accuracy rule; the CoX recordings
  cited above were unavailable for this validation.
- Native logouts saved both anonymous fixture inventories. The final `gameUpdate 5` countdown
  completed persistence and exited normally; owned server/client/browser processes stopped
  and all five assigned ports were clear. An earlier interrupted wrapper stop had no graceful
  receipt and is not used as evidence of graceful shutdown.

## Ours

- Configure (radius 0-3, max players 1-20) is not implemented; it always uses 3 tiles and 3 others.
- With energy for fewer allies than are eligible, the nearest that can be paid for are affected.
- A press inside the cooldown does nothing and sends nothing.
