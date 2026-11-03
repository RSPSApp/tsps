# Slayer boss audit: Cerberus, Alchemical Hydra, Grotesque Guardians, Kraken, Thermonuclear smoke devil, Skotizo

An audit of the six implemented Slayer-boss fights against the OSRS Wiki (page and `/Strategies`)
and, where a recording existed, the rsprox captures. Source order is the one in
[server/docs/agents/sources.md](https://github.com/RSPSApp/tsps/blob/main/server/docs/agents/sources.md): Wiki for behaviour, cache for
ids, captures as first-hand evidence for what live sends.

Recordings used (all decoded from `%USERPROFILE%\.rsprox\binary`):

| Submission | Revision | Boss | What it shows |
| --- | --- | --- | --- |
| 1151 | 237 | Kraken (instanced cove) | surfacing, attack cadence, hit timing |
| 1161 | 237 | Thermonuclear smoke devil | attack cadence, animation |
| 3329 | 235 | Skotizo | chant, summon effects, attack cadence |
| 1144 | 237 | Grotesque Guardians (instanced roof) | Dusk's attack cadence in phases 2 and 4, the blinding attack |

Rejected as evidence: 1754 is a Leagues V recording of `Dusk (Echo)` (`id=7888`, `NameChangeExtendedInfo(name='Dusk (Echo)')`), not the Slayer Tower roof; 1521 holds a single spawn of `8615` (a walk-past); 3323 has two matches for `7286` and no fight. No recording exists for Cerberus.

## Changed

### Kraken — ranged damage was truncated away

`plugins/bosses/kraken/MagicOnly.Kraken.js` divided a ranged roll by seven and floored it, so a
1–6 roll became 0. The Wiki (Kraken, Kraken/Strategies, citing Mod Ash, 6 September 2023) says:

> "If you rolled 0 damage, it stays as 0. If you rolled >=1 damage, it's divided by 7, with a
> floor of 1. Accuracy is not affected."

A ranged hit now divides by seven with a floor of one unless the roll was zero
(`rangedDamage`). Magic is still untouched and melee still zeroes the hit and sends
`You can't attack it properly like that.` (both unchanged and correct).

### Alchemical Hydra — an incorrect vent did not empower it

The Wiki says the phase's shield "can be removed if it is lured over a vent on the floor which
spews chemical liquid. However, the vent must be the correct one … otherwise the Hydra's damage
is increased by up to 50%", and its infobox gives `max hit3 = 35 (default), 52 (empowered)`.
`Fight.AlchemicalHydra.js` only sent the `empowered` message; the max hit stayed 35.

Now `eruptVents` sets `empowered`, `Fight.maxHit()` returns 52 while empowered (55 enraged,
35 otherwise), and `Combat.AlchemicalHydra.js` caps its roll at that value. `changePhase()` clears
it with the shield, as each phase reapplies the reduction. The data gained
`combat.empoweredMaxHit: 52`.

Also added: the Wiki's overhead on the correct vent — "The Hydra will
`{{overhead|Roaaaaaaaaaaar!}}` when hit by the correct vent" — sent as a `forceChat` from
`messages.roar` next to the existing (unverified) player message.

## Per boss

### Cerberus (`Cerberus.plugin.js`, `cerberus/*`, `data/cerberus.json`)

Checked (Cerberus, Cerberus/Strategies):

| Fact | Wiki | Code |
| --- | --- | --- |
| Max hit, all three styles | 23 | 23 |
| Attack speed | 6 ticks | 6 |
| Triple attack | first attack, then after every ten attacks | attacks 1, 11, 21 … |
| Triple order and spacing | magic, ranged, then melee 2 ticks apart; the bite lands at any distance | same |
| Souls | below 400 hp, every 7th attack | same |
| Lava | below 200 hp, every 5th attack | same |
| Priority | triple > souls > lava | same |
| Skip chance | 10% chance of an ordinary attack instead | 0.1 |
| Soul damage / drain | 30, 22 with Elysian; 30 prayer, 15 with spectral, 20 with Ward, 10 with both | same |
| Lava pools | one under the target plus two elsewhere; 10 on landing, 15 every 2 ticks while stood on, only the tile (not 3x3) | same |
| Pools go when she dies | yes | yes |
| Lava reductions | 12 with an anti-dragon shield, 11 with super antifire; the landing hit is not reduced | same |
| Unattackable while sitting; full heal when the arena empties | yes | yes |
| Slayer xp | 690 | 690 |

Discrepancies:

1. **Fire wall not implemented.** "If a player has recently fought the boss, a line of fire will
   spawn between the entrance and the boss; stepping over this will deal 5 damage each way."
   There is no loc id for the flames in `data/cerberus.json` and no captured geometry, so this
   audit did not add one — a guess would be inventing the line. Left as a known gap.
2. Souls spawn "from behind the archaic skull" in a row whose tiles are marked unsourced in the
   data (`_row`). The row and its west-to-east order match the Wiki's attack order but not a
   verified spawn pattern.
3. The two non-target pools are placed within ±3 tiles of the player; the Wiki says "two at
   random parts of the area". Not changed (the current spread is neither confirmed nor
   contradicted by a capture).
4. The Wiki contradicts itself on the respawn (infobox `15`, prose "nine seconds"). Respawn comes
   from the world spawn data, not this plugin.

No changes.

### Alchemical Hydra (`AlchemicalHydra.plugin.js`, `alchemicalhydra/*`, `data/alchemical-hydra.json`)

Checked (Alchemical Hydra, /Strategies):

| Fact | Wiki | Code |
| --- | --- | --- |
| Phases | 825 / 550 / 275 hp, three heads | same |
| Shield | 75% reduction per phase, dropped by the correct vent | 0.25 multiplier, per phase |
| Wrong vent | damage up to +50% (35 -> 52) | **fixed** |
| Attack count | three auto-attacks, then the special, then every nine | 4, 13, 22 … |
| Style switch | every three basics (every attack enraged) | same |
| Enraged opener | opposite of the last style used | same |
| Max hit / speed | 35, 6 ticks; 55, 4 ticks enraged | same |
| Poison | 3x3 splatter up to 7, pools up to 12 a tick, poison 6 targeted / 4 otherwise | same |
| Lightning | four currents from the corners, up to 22, binds; a phase change dissipates them | same |
| Fire | 5x5 walls to the player's sides, tracking fire up to 25 then 5 x 5 burn, ~7 ticks idle | same |

Discrepancies:

1. **Empowered vent did nothing but send a message** — fixed (above).
2. **Flame-phase stun not implemented.** "Once it reaches the centre, it will inflict a stun on
   the player, but they can still attack it." No duration is given anywhere the audit could find
   (the 2022 change only removed the "You're stunned!" spam), so no stun was invented.
3. Enraged poison always throws one blob; the Wiki says "there is a possibility of one poison blob
   being launched rather than five", i.e. it is random. The probability is not given, so this was
   left alone.
4. The infobox gives phases 1 and 2 as two hits (`17x2`, `26x2` empowered); the code rolls a single
   hit capped at 35. The two readings agree on the total, and no capture confirms the split, so it
   was left alone.
5. The side walls deal a flat 10 (`wallDamage`, marked calibrated) and apply no burn; the Wiki's
   "Getting hit by any of the fires will result in the player taking up to 25 damage, followed by a
   subsequent burn of 5 damage for 5 hits" may cover them too. Ambiguous, left alone.

### Grotesque Guardians (`GrotesqueGuardians.plugin.js`, `grotesqueguardians/*`, `data/grotesque-guardians.json`)

Checked (Grotesque Guardians, /Strategies):

| Fact | Wiki | Code |
| --- | --- | --- |
| Phase changes | ~50% each (450 hp each per the 2022 hitpoint change) | 225 |
| Dawn, phase 1 | two ranged hits of 9, kick of 15, immune to non-halberd melee | same |
| Stone ball | 3x3, up to 15, 10-tick freeze | same |
| Rockfall | 9-10 rocks, edges up to 22, direct hit stuns 10 ticks | 9 rocks, 22, 10 |
| Lightning | 5-10 a tick on or adjacent, one always on the player | same |
| Energy spheres | three, 90 hp each to Dawn | same |
| Prison | 3x3 cell, one missing flame, 5 ticks, up to 65, heals Dusk, Dusk invulnerable during the first | same |
| Trample | under Dusk in phases 2 and 4, up to 40 | 30-40 |
| Dusk phase 4 ranged | first orb fixed at 60% of max, second rolls 0..rolled; prayer halves both | same |
| Dusk phase 4 style | 2/3 the unprayed style first, then 1/6 (1/3 if prayed against) | same |
| Prayer | melee ~80% off, ranged halved | `/5` melee, `/2` ranged |

Discrepancies:

1. **The prison does not drag the player.** The main page says "he will immediately use his prison
   attack, dragging the player somewhere within the arena"; the code builds the cell on the tile
   the player already stands on. The destination rule ("sometimes … to the edges") is not
   specified, so no teleport was invented.
2. Dusk's blinding/explosion cadence is `every: 6` attacks, marked calibrated. Capture 1144 shows
   Dusk slashing in phase 2 at ticks 293, 299, 305, 311, 317 and 328 (6-tick intervals) and one
   `GG_DUSK_ATTACK_SPECIAL` (`7792`) after them, i.e. a six-attack cycle, though in the seventh
   slot rather than replacing the sixth. One Leagues speed kill is not enough to move the counter,
   so it is left alone; the Strategies page's "after attacking once … three attacks before needing
   to back away" reads shorter than either.
3. Lightning vortices may overlap in the code; the Wiki says they "do not stack on each other".
   Cosmetic, left alone.

No changes. Capture 1144 also confirms the 6-tick attack speed used for both phases (Dusk's
slashes at 293-317, and `GG_DUSK_ENRAGE_ATTACK_RANGED` at 418 and 424 in phase 4).

### Kraken (`Kraken.plugin.js`, `kraken/*`)

Checked (Kraken, Kraken/Strategies, Cave kraken):

| Fact | Wiki | Code / capture |
| --- | --- | --- |
| Max hit | 28 boss, 2 a tentacle | from the NPC definitions |
| Attack speed | 4 ticks | 4; capture 1151 plays the boss's attack sequence every 4 ticks |
| Typeless magic | Protect from Magic does nothing | `Typeless.Kraken.js` |
| Ranged | 1/7 with a floor of 1 | **fixed** |
| Melee | refused, `You can't attack it properly like that.` | same |
| Surfacing | fishing explosive, or all four tentacle whirlpools then the large one | same |
| Surfacing animation | — | 7135 `SLAYER_KRAKEN_ARISE` in the capture; 3860 is `TENTACLE_MONSTER_SPAWN` |
| Respawn | 10-14 ticks | `getDefinition().getRespawn()`, unverified |

Capture 1151 (rev 237, instanced cove, `x=10534,z=6066`):

```
[3536] <- NpcInfo(updates={50396=LowResolutionToHighResolution(id=496, ... x=10534, z=6066 ...),
                   50397=LowResolutionToHighResolution(id=5534, ...)})
[3553] <- NpcInfo(updates={50396=Active(x=10534, z=6066, level=0, steps=[], moveSpeed=STATIONARY,
                   extendedInfo=[SpotanimExtendedInfo(spotanims={0=Spotanim(id=2732, delay=61,
                   height=124, loop=null)}), SequenceExtendedInfo(id=7135, delay=0),
                   TransformationExtendedInfo(id=494)], jump=false)})
[3556] <- NpcInfo(updates={... 50396=Active(... SequenceExtendedInfo(id=3992, delay=0) ...)})
[3560] <- NpcInfo(updates={... 50396=Active(... SequenceExtendedInfo(id=3992, delay=0) ...)})
```

`3992` is `SWAN_QUEEN_SPELLCAST` (the Kraken's attack animation in this cache's names) and repeats
at 3556, 3560, 3564 … — 4 ticks apart, confirming the speed.

Discrepancies:

1. **Ranged damage truncated to 0 for rolls of 1-6** — fixed (above).
2. The Wiki says "Unlike most monsters, damage will be inflicted **before** the projectile reaches
   the player, rather than on impact", but `Fight.Kraken.js` lands the hit with the projectile.
   The capture does not corroborate the Wiki: with the local player (`764`) at the captured
   distance, hitsplats follow each attack animation by 2 ticks (`3556` -> `3558`, `3560` ->
   `3562`, `3564` -> `3566` …), i.e. on arrival. Left unchanged and recorded as a conflict.
3. Respawn (10-14 ticks) and the 25,000 gp private instance are not modelled here (the instance is
   already documented as a follow-up).

### Thermonuclear smoke devil (`ThermonuclearSmokeDevil.plugin.js`, `thermonuclear/*`, `data/thermonuclear-smoke-devil.json`)

Checked (Thermonuclear smoke devil, /Strategies):

| Fact | Wiki | Code / capture |
| --- | --- | --- |
| Max hit | 8 | 8 (`monsters-complete`, engine cap) |
| Attack speed | 2 ticks | 2; capture 1161 plays animation 3847 every 2 ticks |
| Range | 8 tiles | 8 |
| Typeless | protection prayers do nothing | `Typeless.ThermonuclearSmokeDevil.js` |
| Smoke | gas mask / facemask / slayer helmet required | Slayer gear data |
| Walk-through | always walks through monsters and players | area `process` sets the flag |
| Respawn | 15 | from the NPC definition, not re-checked in this audit |

Capture 1161 (rev 237, `x=2361,z=9456`):

```
[5808] <- NpcInfo(updates={11887=LowResolutionToHighResolution(id=499, spawnCycle=0, x=2361, z=9456, ...)})
[5817] <- ... SequenceExtendedInfo(id=3847, delay=0) ...
[5819] <- ... SequenceExtendedInfo(id=3847, delay=0) ...
[5821] <- ... SequenceExtendedInfo(id=3847, delay=0) ...
```

`3847` is `LORE_DUST_DEVIL_ATTACK`, so the captured cadence is 2 ticks.

Discrepancies: none found in what is implemented. One engine-level gap: the Wiki says the attack
is "magical ranged" — "the attack accuracy is decided by the ranged attack bonuses of the
thermonuclear smoke devil and the magic defence bonuses of the player" — while the method reports
`CombatType.MAGIC`, so accuracy uses the NPC's magic level (1) rather than its ranged level (310).
There is no magical-ranged combat type or accuracy hook to use, so this audit did not restructure
combat for one boss.

### Skotizo (`Skotizo.plugin.js`, `skotizo/*`, `data/skotizo.json`)

Checked (Skotizo, /Strategies, Awakened Altar):

| Fact | Wiki | Code / capture |
| --- | --- | --- |
| Hitpoints, summon point | 450, three minions after two thirds gone | 450, summon at 150 |
| Altar reduction | 25% each, cap 100%; 15% each with Arclight/Emberlight, cap 60% | same |
| Altar cooldown | one minute | 100 ticks |
| Arclight/Emberlight | disable an awake altar in one hit (not Silverlight/Darklight) | same |
| Chant and summon | "Gar mulno ful taglo!", three spawns, smoke and sound | same; capture 3329 |
| Dark ankou | one at a time while an altar is awake | same |
| Melee preference, no approach | "tends to prefer using melee while in melee distance", "does not approach" | 0.75 in reach, never steps in |
| Attack speed | infobox "Random" | 6; capture 3329 shows 6-tick pairs |

Capture 3329 (rev 235):

```
[12014] <- NpcInfo(updates={57241=Active(x=13600, z=2588, level=0, steps=[], moveSpeed=STATIONARY,
                   extendedInfo=[SayExtendedInfo(text='Gar mulno ful taglo!'), SpotanimExtendedInfo(...)] ...
[12014] <- UpdateZonePartialEnclosed(zoneX=40, zoneZ=48, level=0, packets=[MapAnim(id=188, delay=0,
                   height=0, xInZone=6, zInZone=6)])
[12014] <- UpdateZonePartialEnclosed(zoneX=56, zoneZ=40, level=0, packets=[SoundArea(id=1930, delay=0,
                   loops=1, radius=5, size=0, xInZone=0, zInZone=4), ...])
[11863] magic animation 69; [11869] melee animation 4680   (6 ticks apart)
[12107] magic animation 69; [12113] melee animation 4680   (6 ticks apart)
```

Discrepancies: none found. The infobox's "attack speed = Random" is not reproduced (a fixed 6),
but every observed pair of attacks is exactly 6 ticks apart, so the fixed value is at least
consistent with the capture; the random element (if any) has no published distribution.

## Verification

- `node --check` on every edited file, plus a JSON parse of `data/alchemical-hydra.json`.
- From `server/`: `node --test tests/boss-fights-slayer-audit.test.cjs` — 5 tests, covering the
  Kraken seventh (including the floor of one and the zero case) and the Hydra's empowered/correct
  vent, roar, phase reset and enraged max hit. The test requires the plugin files directly, so it
  needs no `yarn build`.

## Not verified / left open

- Cerberus fire wall (5 damage a crossing) — missing, no loc id or captured geometry.
- Cerberus non-target lava pool placement and the souls' row.
- Alchemical Hydra flame-phase stun, the enraged one-blob probability, the `17x2` phase-1/2 hits,
  and the fire walls' damage/burn.
- Grotesque Guardians prison drag, Dusk's explosion cadence, overlapping lightning vortices.
- Kraken respawn timing, the private instance, and the Wiki's pre-impact damage claim.
- Thermonuclear smoke devil accuracy model (ranged attack vs magic defence).
- Skotizo's "random" attack speed.
