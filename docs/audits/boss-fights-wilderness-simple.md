# Wilderness/simple boss audit: Chaos Elemental, Chaos Fanatic, Crazy archaeologist, Deranged archaeologist, Zalcano, Shellbane gryphon

An audit of the six implemented fights in this cluster against the OSRS Wiki (the page and its
`/Strategies` subpage) and, where a recording existed, the rsprox captures. Source order is the one
in [server/docs/agents/sources.md](https://github.com/RSPSApp/tsps/blob/main/server/docs/agents/sources.md): the Wiki for behaviour,
the cache for ids, captures as first-hand evidence for what live sends.

Recordings used (all decoded into `%USERPROFILE%\.rsprox\binary` with
`rsprox-decode.ps1`):

| Submission | Revision | Boss | What it actually shows |
| --- | --- | --- | --- |
| 3886 | 224 | Chaos Elemental | five `id=2054` spawn/movement lines near (3267, 3937) and a Wilderness teleport; no fight |
| 3889 | 224 | Chaos Elemental | two spawn lines; no fight |
| 3930 | 236 | Chaos Fanatic | one `id=6619` spawn line; no fight |
| 1463 | 224 | Crazy archaeologist | three `id=6618` spawn lines around the ruins; no fight |
| 1440 | 224 | Chaos Elemental / Chaos Fanatic / Crazy / Deranged | `2054`, `6618`, `6619`, `7806` only as `ReflectionChecker` ids and spawn lines; no fight |
| 83 | 224 | Deranged archaeologist | 172 lines, almost all skilling at the Tar Swamp; no fight |
| 4056 | 237 | Zalcano | entry/peek boxes, mining and throwing lines (already quoted in `zalcano.json`) |
| 4057 | 237 | Zalcano | two fights: swings, tephra, "falls"/"stands", the shockwave and the symbol lines |
| 3456 | 237 | Shellbane gryphon | the Troubled Tortugans gryphon fight on the Little Pearl: whirlwinds, the burst, the corrosive spit |

So only the Shellbane gryphon and Zalcano have fight footage. The four Wilderness bosses have
**no capture of their attacks**, and the corrections below rest on the Wiki and the NPC transcript
(`data/definitions/npc-dialogues.json`) alone. Where the Wiki is silent, the value is left as it
was and listed under "Unverified" rather than guessed at.

## Changed

### Chaos Fanatic — the specials were one merged roll, and the explosion was too weak

The Wiki (Chaos Fanatic, "Fight overview") is unusually precise about his attack roll:

> Following the cooldown, and at the beginning of the fight, there is a 10/15 chance for him to
> launch a standard red attack, 4/15 to launch an explosion, and 1/15 to launch the disarming
> attack.

> The explosion attack is always followed by a 12-attack cooldown during which he can only launch
> the standard red attacks, so players are free to look away from the screen for 24 ticks
> (14.4 seconds) after each explosion.

and its infobox gives `max hit = 21 (Magic attack), 31 (Special attack)`.

`ChaosFanatic.plugin.js` rolled a single 1/3 "special" that was always the explosion, took the
disarm from a separate 1/10 roll in `finished()` (so it fired on the cast tick, not with a
projectile), used four books instead of three, and rolled the explosion's damage 0–25.

Now:

- `chooseAttack(cooldown, roll)` is a pure rule: while the 12-attack cooldown runs, every attack is
  a standard red one; otherwise roll 0–9 standard, 10–13 explosion, 14 disarm.
- The cooldown is kept on the NPC (`chaos-fanatic:cooldown-attacks`) because the engine builds a
  fresh combat method per attack (`singleton: false`).
- The explosion throws **three** green books (551): the player's tile, which one always targets, and
  two of the eight around it, never the same tile twice, and hits for up to **31**.
- The disarm is its own special: one green projectile at the player and the disarm four ticks later,
  still negated by a full inventory (the Wiki's counter).
- His overhead lines are now the transcript's exactly, including `Devilish Oxen Roll!!` (the plugin
  had `Develish`).

Attack speed 2 and the standard 21 come from the NPC's own definition
(`data/definitions/monsters-complete.json`, id 6619), so no override was needed.

### Crazy archaeologist — the books hit one tile, for one too much, and he died silently

The Wiki (Crazy archaeologist, "Fight overview"):

> Periodically, he will yell Rain of knowledge! before launching a special attack, throwing three
> books in an arc towards the player that explode in a 3x3 area. After exploding, one of the books
> will split into two more books on impact, with these also exploding nearby after a delay.

and the infobox gives `max hit = 14 (standard), 24 (special)`.

`CrazyArchaeologist.plugin.js` damaged only players standing exactly on a landing tile, rolled the
special 0–25, had no second volley and no death line.

Now: each book covers its own 3x3 (one roll per book, taken by everyone inside — the Wiki gives no
falloff for him, unlike the Deranged archaeologist's 56/18), the centre book splits into two more
books two ticks later, the roll is 0–24, and `onNpcBeforeDeath` sends his transcript death line
`Ow!` (the Deranged plugin already did this with `Oh!`). The shout is `Rain of knowledge!`, with
the transcript's lower-case k.

### Shellbane gryphon — recorded message colours, and the stun counter-attack

rsprox 3456 has the game's own lines for three of the specials:

```
[2481] <- MessageGame(type=0, message='<col=ff3045>The gryphon aggressively flaps its wings...')
[2526] <- MessageGame(type=0, message='<col=ff3045>The whirlwinds explode outwards in a large gust of wind!')
[2526] <- MessageGame(type=0, message='<col=ff3045>Your armour has started to corrode!</col>')
[2547] <- MessageGame(type=105, message='<col=229628>Your armour stops corroding.</col>')
```

The plugin used `<col=ff0000>` for all four, `</col>` on the two that have none, `00ff00` for the
stop and a full stop instead of the exclamation mark. `data/shellbane-gryphon.json` now carries the
recorded strings; the Wiki's own `{{mes}}` wording supplies `ff3045` for `devastating` and
`regains`, which have no capture.

The Wiki also gives the knockback's counter, which was missing:

> Negating the knockback stuns the boss for 2 ticks (1.2s). During this short window, the player can
> quickly click to attack the boss … if the player does not click to attack the boss while it's
> stunned, they will be knocked back regardless of equipped weight, indicated by the game message
> The gryphon regains its focus and strikes!

`Fight.ShellbaneGryphon.js` now records the stun, `Cave.ShellbaneGryphon.js` listens to the
engine's `combat:attack-started` event and counters it, and an uncountered stun ends with the
`regains` line, up to 30 damage and the same three-tile shove as a normal knockback. Not modelled:
the Wiki's "knock it back one tile" and "one additional attack free of attack delay".

## Per boss

### Chaos Elemental (`ChaosElemental.plugin.js`)

Checked against [Chaos Elemental](https://oldschool.runescape.wiki/w/Chaos_Elemental) and
[Chaos Elemental/Strategies](https://oldschool.runescape.wiki/w/Chaos_Elemental/Strategies). No
capture of the fight exists, so nothing was changed.

| Fact | Wiki | Code |
| --- | --- | --- |
| Max hit / attack speed | 28, 4 ticks | 28 and 4, from the NPC definition (2054) |
| Discord | magic, ranged or melee damage, one of the three at random | `selectAttack` rolls the three styles; the matching impact gfx (869/867/868) plays after the hit |
| Confusion | teleports the player "a short space or several spaces away from it" | a free tile within 4, preferring ones further from the boss, never on it |
| Madness | unequips up to four items, **the weapon first** | weapon slot first, then a shuffled remainder, capped at four, skipped when the inventory cannot take the item |
| Elemental weakness | 50% air | data-driven (`elemental_weakness_type: 1`, 50%) |
| Venom | immune; venom items inflict poison instead | `npc-status-immunities.json`: `immune_venom: true` |
| Projectile travel | the hit lands when the orb does | `Projectile.arrivalCycles(..., 45, 10)` and `ticksToLand` |

The special weighting (1/20 Confusion, 3/20 Madness) and both disarm/teleport messages are the
plugin's own: the Wiki states only that Confusion is used less often than Madness since the 2018
change, and no source gives the numbers or the strings.

### Chaos Fanatic (`ChaosFanatic.plugin.js`)

| Fact | Wiki | Code |
| --- | --- | --- |
| Max hit | 21 standard, 31 special | 21 from the NPC definition; the explosion rolls 0–31 |
| Attack speed | 2 ticks | 2 (NPC definition) |
| Standard attack | red magic projectile, Protect from Magic negates it | projectile 554, magic type |
| Explosion | three green books, one always on the player's tile | three books, 551, target tile first |
| Explosion cooldown | 12 attacks (24 ticks) of standard attacks only | `EXPLOSION_COOLDOWN_ATTACKS` on the NPC |
| Roll | 10/15 standard, 4/15 explosion, 1/15 disarm | `chooseAttack` |
| Disarm | unavoidable green projectile; a full inventory negates it | 551 at the player, applied four ticks later, `isFull()` check |
| Quotes | six transcript lines | the six transcript lines verbatim |

### Crazy archaeologist (`CrazyArchaeologist.plugin.js`)

| Fact | Wiki | Code |
| --- | --- | --- |
| Max hit | 14 standard, 24 special | 14 (NPC definition), 24 (`SPECIAL_MAX_HIT`) |
| Attack speed | 3 ticks | 3 (NPC definition) |
| Attack mix | ranged, melee only when the player is next to him | melee at distance < 2 on a 1/2 roll, ranged otherwise |
| Special | "Rain of knowledge!", three books, 3x3 each, centre book splits into two more | three books (1260), 3x3 per book, two-book burst two ticks later |
| Death line | `Ow!` | `onNpcBeforeDeath` |
| Book projectile / impact gfx | thrown book, ground burst | 1259 / 1260, gfx 157 |
| Melee anim | — | 423 (`HUMAN_UNARMEDKICK`); 425 in the same list is `HUMAN_UNARMED_DEF`, i.e. his block |

### Deranged archaeologist (`DerangedArchaeologist.plugin.js`)

Already right; nothing changed. Re-checked against
[Deranged archaeologist](https://oldschool.runescape.wiki/w/Deranged_archaeologist) and
[its Strategies](https://oldschool.runescape.wiki/w/Deranged_archaeologist/Strategies):

| Fact | Wiki | Code |
| --- | --- | --- |
| Max hit | 25 melee, 25 ranged, 56 special direct, 18+ indirect | NPC definition 25; 56 / 18 |
| Attack speed | 3 ticks | 3 (NPC definition) |
| Special chance | 1/3 per attack, 25-tick cooldown, usable as the first attack | `Misc.getRandom(2) === 0`, `SPECIAL_COOLDOWN_TICKS = 25` |
| Volley | three books, one exactly on the player's tile, four ticks after the shout | `initialSpecialTiles` + `SPECIAL_IMPACT_DELAY_TICKS = 4` |
| Split | the centre book bursts into two more, never on the same square | `burstSpecialTiles` |
| Scatter | typically 5x5, rarely 9x9 | 5x5 (the rare outliers are not modelled) |
| Damage shape | full on the impact tile, up to 18 on the eight around it, no defence or prayer | `explosionDamage` |
| Lines | `Learn to Read!`, `Oh!`, six combat lines | same |

### Zalcano (`Zalcano.plugin.js`, `zalcano/*`, `data/zalcano.json`)

Checked against [Zalcano](https://oldschool.runescape.wiki/w/Zalcano) and
[Zalcano/Strategies](https://oldschool.runescape.wiki/w/Zalcano/Strategies) plus 4056/4057.
Nothing was changed: the figures the Wiki gives are all present.

| Fact | Wiki | Code |
| --- | --- | --- |
| Armour / hitpoints | 300 / 1,000 | `shield: 300`, `hitpoints: 1000` |
| Immune to poison and venom | yes | cleared every tick |
| Down time | 12–16 seconds | `downTicks: [20, 27]` |
| Under her | ~7 a tick (3–10) | `underDamage: [3, 10]` |
| Shockwave | ~10 damage, stun 1–2 ticks, pushes back, destroys all tephra | 10 / 2 / 3 tiles, all three tephra items removed |
| Boulders | 40+ | 30–40 (max 40) |
| Rock blast | up to 28, anyone within a tile of the rock | 28, Chebyshev ≤ 2 from the 3x3's centre |
| Symbols | 2–5 blue, damage after three ticks, up to 26 | `blue: [2, 5]`, `graceTicks: 3`, `max: 26` |
| Blue symbol | +50% tephra damage | `blueMultiplier: 1.5` |
| Golem | 14 hp, heals 50 (scaled by its health), drops 16–24 imbued tephra to the top damager | `golem_zalcano` drop table (16–24), `golemHeal: 50` |
| Throw max hit | `5 + (Smithing + Runecraft) / 14` | `throwMaxHit` |
| Mining max hit | 30/31/32/33 by Mining level, +1 dragon, +2 crystal | `mining.maxHit`, pickaxe bonus |
| Rewards | 5 armour damage to qualify, 31 combined for uniques/pet, 1/2/3 shards, MVP +10% and ashes | `shieldMinimum: 5`, `uniqueMinimum: 31`, shard counts, `mvpBonus: 0.1` |
| Uniques | 1/200, 39/40 tool seed, 1/40 onyx; shard 1/750–1/1500; pet 1/2250 | `uniqueChance: 200`, `seedWeight: 39`, `shardChance: [1500, 750]`, `petChance: 2250` |

### Shellbane gryphon (`ShellbaneGryphon.plugin.js`, `shellbane/*`, `data/shellbane-gryphon.json`)

| Fact | Wiki | Code |
| --- | --- | --- |
| Max hit | 22 melee/ranged, 30 knockback, 50–70 whirlwind | 22 (NPC definition and cap), 0–30, the Whirlwind table |
| Attack speed | 5 ticks | 5 |
| Special cadence | no figure given | every fourth attack (calibrated) |
| Knockback | up to 30, unavoidable, ≥40 kg equipped counters it, 2-tick stun | same; the stun's counter-attack is new |
| Corrosive spit | 3–12 damage six times over 32 ticks, one tile dodges it, unequipping stops it, ~125 ranged defence floors it at 3 | `hits: 6`, `every: 5`, `min: 3`, `max: 12`, `fullDefence: 125` |
| Whirlwind | one every 3 ticks up to 5, stacking, armed 6 ticks after the last, bursting 15 seconds later | `count: 5`, `every: 3`, `armTicks: 6`, `burstTicks: 25`, the damage/radius table |
| Messages | the four recorded lines, plus the Wiki's `devastating`, `heavyEquipment`, `regains` | recorded strings now used |
| Respawn | 20 ticks | `respawnTicks: 20` |

## Unverified / left alone

- **Chaos Elemental special weights and messages.** No Wiki figure and no capture. 1/20 Confusion,
  3/20 Madness, `The Chaos elemental disarms you.` and `...has teleported you.` are the plugin's
  own. Whether Madness and Confusion can both roll on one attack is likewise unstated: the code
  rolls one special per attack.
- **Chaos Fanatic** attack range (8) and the `setAttackDelay(5)` after the explosion: no source.
  The explosion's 12-attack cooldown is counted in attacks, so the delay does not change it.
- **Chaos Fanatic disarm projectile id.** Both specials are described only as "green projectiles",
  so the disarm reuses 551. No capture names the id.
- **Crazy archaeologist** scatter radius (3x3 for the opening books and the burst) and the two-tick
  burst delay: the Wiki says only "in an arc" and "after a delay". The 3x3 damage is one roll per
  book; the Wiki gives no separate adjacent-tile maximum for him.
- **Crazy archaeologist melee animation.** 423 is the only attack animation in the cache's list
  (`[3353, 425, 423, 836]`), so it is used; no capture shows the swing.
- **Deranged archaeologist melee animation.** The cache list is `[425, 3353, 836]`, and 425 is
  `HUMAN_UNARMED_DEF`, so the melee animation is probably not what live plays. There is nothing
  else in the list to use and no capture, so it is unchanged.
- **Shellbane corrosion spacing.** The Wiki says six hits "over the course of 32 ticks"; 3456 shows
  the corrosion splats at ticks 2526, 2533, 2539 and 2545 (about six apart) before the boss died,
  which fits six hits every 6 ticks better than the data's 5. `every: 5` is documented as coming
  from a Wiki capture, so it was left alone — worth re-checking against a longer recording.
- **Shellbane knockback counter, remaining detail.** "Knock it back one tile" and "grants the player
  one additional attack free of attack delay" are not modelled; only the damage, the shove and the
  message are.
- **Zalcano's attack interval** (`every: [8, 12]`), the glowing-rock move (45 ticks), the boulder
  count and the golem walk speed are calibrated estimates; the Wiki gives no intervals and 4057 was
  not measured for them. The red ball that summons a golem is not sent as a projectile (the spawn
  graphic stands in for it).

## Tests

`server/tests/wilderness-simple-bosses.test.cjs` (new) covers the Chaos Fanatic's roll, cooldown,
three books, 31 damage and transcript lines, and the Crazy archaeologist's volley, 3x3 coverage,
burst, 24 damage and `Ow!` death line — both the pure rules and the specials driven against fakes.

`server/tests/shellbane-gryphon.test.cjs` gained the stun: an uncountered heavy knockback is thrown
back with `regains`, and hitting the gryphon inside the window cancels it.

Run:

```
cd server
node --test tests/wilderness-simple-bosses.test.cjs
node --test tests/shellbane-gryphon.test.cjs
node --test tests/deranged-archaeologist.test.cjs
node --test tests/zalcano.test.cjs
```
