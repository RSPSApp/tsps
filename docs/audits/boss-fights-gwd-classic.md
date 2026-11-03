# Classic boss audit: God Wars generals, Corporeal Beast, Dagannoth Kings, Kalphite Queen, Giant Mole, Vorkath

An audit of six classic boss clusters against the OSRS Wiki (the boss page and its `/Strategies`
subpage) and, where a recording existed, the rsprox captures. Source order is the one in
[server/docs/agents/sources.md](https://github.com/RSPSApp/tsps/blob/main/server/docs/agents/sources.md): the Wiki for behaviour, the
cache for ids, captures as first-hand evidence of what live sends.

Recordings used (all decoded from `%USERPROFILE%\.rsprox\binary`):

| Submission | Format | Boss | What it shows |
| --- | --- | --- | --- |
| 801 | transcriber (`[tick]` + `[sequence]`/`[map_projanim_v2]`/`[say]`) | Kree'arra, Commander Zilyana, K'ril Tsutsaroth | attack cadence, attack mix, both Kree projectiles, the generals' cries |
| 3282 | packet dump (`NpcInfo` extended info) | General Graardor | melee/slam mix, `7018`/`7021` sequences, a 6-tick attack gap |
| 3359 | packet dump | Corporeal Beast | 4-tick attack cadence, the three magic attacks, drain/leech messages |
| 3365 | packet dump | Corporeal Beast | a kill and its drops only (no fight detail) |
| 3433 | packet dump | Dagannoth Kings | each king's 4-tick cadence and sequence ids |
| 95 | packet dump | Kalphite Queen | 4-tick cadence, the `6240`/`6234` attack sequences, the `6270` molt |
| 1857 | packet dump | Vorkath | venom-breath messages, protection messages |
| 89, 1851, 3279, 555, 787 | packet dump | Dagannoth Kings / Vorkath | cross-checks only |

No Giant Mole recording exists in the corpus (`5779` and `6499` never appear), so that fight is
Wiki-only. 8058 (Vorkath's active id) could not be downloaded: `rsprox.net/download/8058` returns
something that is not gzip, so the decoder rejects it.

Captures 3282, 3359/3365, 3433 and 95 are from event/Leagues-style worlds ("Welcome to Old School
RuneScape: Grid Master!", and bosses dying in a handful of ticks), so they are used for **cadence,
sequence ids and messages** only — never for damage, hitpoints or respawn, which those worlds
change. In 3282 a Graardor dies and respawns every 25 ticks, and in 3433 the Kings respawn every 60;
the Wiki's 150 is what the code keeps.

## Changed

### K'ril Tsutsaroth — the prayer smash always lands

`plugins/bosses/godwars/Zamorak.GodWars.js` rolled the special through the ordinary accuracy roll,
so it could miss. The Wiki (`K'ril Tsutsaroth/Strategies`, "Prayer Smash") says:

> "He will yell `{{Overhead|YARRRRRRR!}}` when using his prayer smash, **always** dealing 35-49 damage
> and draining his target's current prayer points by half, rounded down."

and the boss page adds "as well as draining half of the player's current prayer points, rounded
down". `Combat.GodWars.js` now understands `alwaysHits`, which builds the `PendingHit` with
`rollAccuracy: false` (the same route the engine's guaranteed hits take), and `SLAM` sets it, so the
hit is 35-49 every time and still passes through Protect from Melee. Graardor's slam is deliberately
**not** marked: the Wiki says it hits "upon successfully hitting the player", i.e. it rolls accuracy.

### God Wars — an emptied chamber reset only Defence

`plugins/bosses/godwars/Dungeon.GodWars.js` already healed a chamber's general and bodyguards when
the last player left, but restored only `DEFENCE`. Every general page says "If all players leave,
his health and stats will be reset" (Graardor; Kree'arra, Zilyana and K'ril word it the same), and
stat-draining specials other than defence drains exist (Arclight drains Attack, Strength and
Defence; the BGS walks Defence → Strength → Prayer → Attack → Magic → Ranged). `resetChamber` now
restores all five combat stats to their definition maxima.

### Giant Mole — respawn was the default 25 ticks, not the Wiki's 16

The infobox gives `respawn = 16`; `GiantMole.plugin.js` never set it, so the NPC definition kept the
engine default of 25. `setRespawn` now applies 16 at server startup.

### Vorkath — the Dragon Slayer II form's ranged cap was the post-quest one

The infobox gives `max hit1 = 30 (Magic), 32 (Ranged), 32 (Melee), 80 (Dragonfire), 121
(Dragonfire Bomb/Special), 41 (Rapid Fire/Special)` for the post-quest form and `max hit2 = 30
(Magic), 28 (Ranged), 32 (Melee), 72 (Dragonfire), 121 (…)` for the quest form. Both forms shared
`RANGED_MAX = 32`. `Shared.Vorkath.js` gained `rangedMaxForId`/`rangedMaxForNpc` (28 for 8060, 32
for 8061) and `Combat.Vorkath.js` caps a ranged hit with it. The quest form's dragonfire cap (72)
is *not* changed — see "Remaining".

## Per boss

### General Graardor (`GodWars.plugin.js`, `godwars/Bandos.GodWars.js`, `data/godwars.json`)

Checked (General Graardor, General Graardor/Strategies):

| Fact | Wiki | Code |
| --- | --- | --- |
| Melee max hit | 60 | `SMASH.maxHit = 60` |
| Ground slam | 15-35, equal chance per number | `SLAM.minHit/maxHit = 15/35`, `applyStyleDamage` rolls the range flat |
| Slam frequency | 1/3 (2/3 melee) | `randomInclusive(0, 2) === 0` |
| Slam reach | "can only use it if he is within melee range of his current target" | the general's method keeps `reach = 1` |
| Slam targets | every player in the chamber | `room: true` + `chamberPlayers` |
| Attack speed | 6 | cache/`monsters-complete` 6 |
| Hitpoints / respawn | 255 / 150 | 255 / `setRespawns` 150 |
| Bodyguards | melee/magic/ranged, max 15/15/21, speed 5 | definitions 15/15/21, speed 5 |
| Empty chamber | health and stats reset | was Defence only — **fixed** |

Capture 3282 (`NpcInfo` sequence extended info for the indices holding `id=2215`): `7018` (melee)
38 times, `7021` (slam) 26 times, `7020` (death) 62 times, `7019` (defend) between attacks. One
spawn's attacks land on ticks 3487 and 3493 — a 6-tick gap, the Wiki's speed. The 38:26 split is
59:41 rather than 67:33, which for 64 attacks is inside sampling noise (1.4σ), so the Wiki's 2/3 is
kept.

### Kree'arra (`godwars/Armadyl.GodWars.js`)

Checked (Kree'arra, Kree'arra/Strategies):

| Fact | Wiki | Code |
| --- | --- | --- |
| Ranged / magic max hit | 69 / 21 | `TORNADO.maxHit = 69`, `BLAST.maxHit = 21` |
| Melee max hit | 25 (infobox), "up to 26" (Strategies) | **not implemented** |
| Magic accuracy | "rolls its MAGIC accuracy against your RANGED defence" (Mod Ash) | `accuracyAs: "RANGED"` |
| Both attacks | hit all players in the room | `room: true` |
| Attack speed | 3 | cache 3; capture 905 → 908 → 911 → 914 → 917 |
| Attack mix | not stated | 50/50; capture 152 ranged (`1199`) vs 161 magic (`1200`) |
| Projectile | — | capture: `starttime=51, endtime=116, angle=15, progress=64, startheight=172, endheight=124` for both `1199` and `1200`; code `start 51, base 60, perTile 8` gives 116 at 7 tiles |
| Melee-only with halberd/salamander | yes | `deniesMelee` |
| Battle cries | non-verbal | not implemented (capture: `[say] text="Skreeeee!"`) |

### Commander Zilyana (`godwars/Saradomin.GodWars.js`)

| Fact | Wiki | Code |
| --- | --- | --- |
| Melee / magic max hit | 27 / 20 with a minimum of 10 | `STRIKE.maxHit = 27`, `LIGHT.minHit/maxHit = 10/20` |
| Magic only at melee distance | "She will only use her magic attacks at melee distance" | general's method keeps `reach = 1` |
| Attack speed | 2 | cache 2; capture 5290 (magic) → 5292 (melee) |
| Attack mix | not stated | 50/50; capture 82 melee (`6967`) vs 84 magic (`6970`) |
| Hitpoints / respawn | 255 / 150 | 255 / 150 |
| Bodyguards | Starlight melee, Bree ranged, Growler magic | same, with their captured projectiles |

### K'ril Tsutsaroth (`godwars/Zamorak.GodWars.js`)

| Fact | Wiki | Code |
| --- | --- | --- |
| Melee / magic max hit | 46 / 10-30 | `SWIPE.maxHit = 46`, `FLAMES.minHit/maxHit = 10/30` |
| Special | 35-49, "always", through Protect from Melee, drains half current Prayer (rounded down) | `SLAM.minHit/maxHit = 35/49`, `throughPrayer`, half of the current level; **now always hits** |
| Special frequency | 1/9 of melee attacks while the target prays melee | `randomInclusive(0, 8) === 0` after the 2/3 melee roll |
| Attack mix | 2/3 melee, 1/3 magic | same; capture 45 melee (`6948`) vs 20 magic (`6950`) |
| Magic reach | "his magic attack can only be used against players in melee range" | `reach = 1` |
| Attack speed / respawn | 6 / 150 | cache 6 / 150 |
| Poison | "Yes (16)" | comes from the monster dump, untouched here |

The drain message the plugin sends ("K'ril Tsutsaroth slams through your protection prayer,
leaving you feeling drained.") is **not** in the Wiki and no capture in this corpus shows it (801
has no `YARRRRRRR!`: the players were not praying melee, or he died too fast). It is left as it was.

### Corporeal Beast (`CorporealBeast.plugin.js`, `corporealbeast/*`)

Checked (Corporeal Beast, Corporeal Beast/Strategies, Dark energy core):

| Fact | Wiki | Code |
| --- | --- | --- |
| Melee / magic max hit | 33 / 65 | `MELEE.max = 33`, `MAGIC.plain.max = 65` |
| Draining magic | up to 55, drains Magic or Prayer 1-2, heals half the damage | `MAGIC.drain`, `drainOnLanding` |
| Splitting magic | 40 on the tile, 30 beside; six splits, 30/20 | `MAGIC.split`, `SPLIT` |
| Stomp | 30-51, every 7 ticks, no prayer stops it | `STOMP`, `TIMER = 7`, raw `HitDamage` |
| Attack speed | 4 | capture: attacks on 19, 23, 27, 31, 35, 39, 43, 47, 51, 55 and 78, 82, 86, 90, 94, 98, 102, 106 |
| Attack mix out of melee range | each magic attack a third | capture 1680/1679/1681 = 314/293/274 |
| Protect from Magic | takes a third off | `PROTECT_MAGIC_KEEPS = 2/3` |
| Damage reduction | 50% for melee/ranged unless a Corpbane weapon on stab | `halved` |
| Empty-room regen | 75, +10 each 7 ticks; 5 per player at 8+ | `REGEN` |
| Stat restore | once per 20 ticks | `STAT_RESTORE_TICKS = 20` |
| Dark core | 1/8 on a 32+ hit or on an attack below 1,000 HP; 5-13 every 2 ticks; heals the Beast | `DarkCore` (`SPAWN`, `LEECH`) |
| Respawn | 50 | `RESPAWN_TICKS = 50` |

Capture 3359 quotes, verbatim:

```
[144] <- MessageGame(type=105, name=null, message='Your Prayer has been slightly drained!')
[225] <- MessageGame(type=105, name=null, message='Your Prayer has been slightly drained!')
[281] <- MessageGame(type=105, name=null, message='The dark core creature steals some life from you for its master.')
[283] <- MessageGame(type=105, name=null, message='The dark core creature steals some life from you for its master.')
[285] <- MessageGame(type=105, name=null, message='The dark core creature steals some life from you for its master.')
[401] <- MessageGame(type=105, name=null, message='Your Magic has been slightly drained!')
```

Both drain lines and the core's leech line match the plugin, and the leech lines two ticks apart
match `LEECH.every = 2`.

### Dagannoth Kings (`DagannothKings.plugin.js`, `dagannothkings/*`, `data/dagannoth-kings.json`)

Checked (Dagannoth Kings, Dagannoth Kings/Strategies, each king, Spinolyp):

| Fact | Wiki | Code |
| --- | --- | --- |
| Max hits | Rex 26, Prime 50, Supreme 30 | `maxHit` 26/50/30 (also the definitions) |
| Attack speed | 4 each | cache 4; capture 3433: Prime 211 → 215, Supreme 207 → 211, Rex 287 → 291 |
| Hitpoints / respawn | 255 / 150 | definitions 255 / 150 |
| Aggression range | Rex 5, Prime and Supreme 7 tiles from the south-western tile | `AGGRO_TILES` 5/7/7 |
| Prime's attack | 3x3 around his target | `PRIME_SPLASH_RADIUS = 1` |
| Supreme's attack | "any player standing within the 6x6 area around his target" | `SUPREME_SPLASH_RADIUS = 3` (7x7) — see "Remaining" |
| Spinolyp | max 10, poison starts at 6, magic drains 1 Prayer, 100 HP | definitions 10/100; `SPINOLYP_PRAYER_DRAIN = 1` |
| Spinolyp dive | "become non-attackable … emerge again after a while" | `Dive.Spinolyp` (cadence has no source, marked as an estimate in the file) |

Sequence ids confirmed by 3433: `2852` defend, `2853` Rex melee, `2854` Prime magic, `2855`
Supreme ranged, `2856` death — all already in the data file.

### Kalphite Queen (`KalphiteQueen.plugin.js`, `kalphitequeen/Encounter.KalphiteQueen.js`)

Checked (Kalphite Queen, Kalphite Queen/Strategies):

| Fact | Wiki | Code |
| --- | --- | --- |
| Hitpoints | 510 across two 255 phases | `KQ_HITPOINTS = 255` per form, restored on transform |
| Ranged and magic accuracy | 100% | `forceKqAccuracy` (melee still rolls) |
| Ranged prayer drain | 1 point if the roll is above 0, even when Protect from Missiles blocks the damage | `rangedPrayerDrains` records positive rolls before protection |
| Max hit / speed | 31 / 4 | definition 31 / 4; capture 95: `6240` on 5133 and 5137, `6234` on 5167, 5171, 5175 |
| Attack mix | adjacent 50% melee / 25% ranged / 25% magic; otherwise 50/50 | exactly that (Mod Ash quote on the Strategies page) |
| Ranged splash | hits players next to the target | `canAttackSecondaryTarget(..., 1)` |
| Magic | "bounces from player to player" | chained `PendingHit`s along the projectile chain |
| Coccoons | 1/20 per hit near a cocoon hatches a worker | `hatchWorker` on `onCombatHitRoll` |
| Respawn | 50 | `setRespawn(50)` |
| Transform | molt, then the airborne form | `6270` (`KALPHITE_UPDATE_FLYING_QUEEN_EMERGING`) at tick 5150, airborne attacks from 5167 |

### Giant Mole (`GiantMole.plugin.js`)

Wiki-only (Giant Mole, Giant Mole/Strategies); no recording exists.

| Fact | Wiki | Code |
| --- | --- | --- |
| Max hit / speed / HP | 21 / 4 / 200 | definitions 21 / 4 / 200 |
| Burrow | 25% per player attack while between 5% and 50% HP | `BURROW_SUBSPOT_COUNT = 4`, fraction bounds 0.05/0.5 |
| Burrow triggers | includes hits of 0, but not a magic splash; poison never | `watchBurrow` skips reflected hits and green (poison) masks; a splash applies no hit |
| Burrow floor | stops digging at or below 10 HP | `BURROW_HP_FLOOR = 10` |
| Burrow spots | the lair's 13 fixed tiles | `BURROW_LOCATIONS` (13) |
| Respawn | 16 | was the default 25 — **fixed** |
| Instance | 25,000 coins (12,500 with the Hard CA, halved for ironmen) | **not implemented** (see "Remaining") |

### Vorkath (`Vorkath.plugin.js`, `vorkath/*`)

Checked (Vorkath, Vorkath/Strategies, Dragonfire/Vorkath):

| Fact | Wiki | Code |
| --- | --- | --- |
| Max hits, post-quest | 32 melee, 32 ranged, 30 magic, 80 dragonfire, 121 fireball, 41 rapid fire | `MELEE_MAX/RANGED_MAX/MAGIC_MAX/FIREBALL_MAX/RAPID_MAX` |
| Max hits, quest form | 32 melee, **28** ranged, 30 magic, 72 dragonfire | ranged **fixed**; dragonfire still 80 (see "Remaining") |
| Attack speed | 5 | `ATTACK_SPEED_TICKS = 5` |
| Pattern | six standards, one special, six standards, the other special | `STANDARDS_BEFORE_SPECIAL = 6`, alternating specials |
| Dragonfire table | 80/50 unprotected, 20 shield, 30 prayer, 70/40 antifire, 60/30 super, 10 shield+antifire, 0 shield+super, 20 prayer+antifire, 10 prayer+super, 10 shield+prayer+antifire, 0 shield+prayer+super | `dragonfireCaps` reproduces every row |
| Rapid fire | 25-41 regardless of dragonfire protection; one shot a tick at the tile the player stands on | `RAPID_MIN/RAPID_MAX`, `tickAcid` |
| Acid pools | "up to 10 damage, which Vorkath will leech as health" | `POOL_MIN/POOL_MAX = 1/10`, `healNpc` |
| Acid phase damage | all damage to her halved | `modifyHit` `PHASE_ACID` |
| Spawn | 38 HP, explodes for up to 60 by remaining HP, she is immune until it resolves, Crumble Undead one-shots it | `SPAWN_HITPOINTS`, `spawnExplosionDamage`, `PHASE_SPAWN`, `crumbleSpawn` |
| Spawn landing | "always lands ten tiles away from the player" | `SPAWN_LAND_DISTANCE = 8` (see "Remaining") |
| Venom breath | "Inflicts venom if not immune" | `poisonEntity(target, 6, 2)` — orb type 2 is venom, starting at 6 |
| Prayer breath | "Deactivates all prayers upon impact" | `PrayerHandler.deactivatePrayers` |

Capture 1857 quotes the venom and protection lines exactly as the plugin sends them:

```
[4626] <- MessageGame(type=105, name=null, message='Your prayers resist some of the dragon's venomous breath!')
[4626] <- MessageGame(type=105, name=null, message='Your super antifire potion helps to protect you from the dragon's venomous breath!')
[4626] <- MessageGame(type=0, name=null, message='You have been poisoned by venom!')
```

The plugin's own breath lines ("Your prayers resist some of the dragon's venomous breath!" and the
super-antifire line) are byte-identical. The engine's venom message is "You have been poisoned!"
(core `CombatFactory.poisonEntity`), not the capture's "You have been poisoned by venom!" — a core
message shared by every venom source, so it is out of this cluster's files.

The `Shared.Vorkath.js` header's claim of 61 recordings could not be re-checked in full here; 1857,
1851, 3279, 555 and 787 were decoded and 1857 was read for this audit.

## Remaining / unverified

* **Kree'arra's melee attack (25 or 26) is missing.** The Wiki is explicit ("if no one is targeting
  Kree'arra, he will fly up to players to use Melee attacks as well"; "dealing up to 26 damage"),
  but no capture in the corpus shows it (`npc-captured-animations.json` lists only `6978` defend,
  `6979` death and `6980` wind attack for `3162`), so the animation and the exact trigger ("no one
  targeting her") would have to be invented. Left out deliberately.
* **Kree'arra's knockback** — "Both of these attacks hit all players in the room, and can knock the
  player back a tile unless they are standing in the corners of the chamber" — is not implemented.
* **Corporeal Beast's occasional 3-tick attack** ("it can occasionally attack 3 ticks after its
  last") is not implemented; capture 3359 shows only 4-tick gaps, so the trigger has no source.
* **Vorkath's spawn landing distance**: the Wiki says ten tiles, the code uses eight from 297 of 317
  spawns in the recordings the file cites. Player coordinates in packet dumps are only sent when a
  player moves (low-resolution packed positions otherwise), so this audit could not re-measure it.
  The code keeps the capture-derived 8 and falls back through 7, 9, 6 and 10 when 8 is blocked.
* **Vorkath's quest-form dragonfire cap (72)** is not applied: the Wiki's protection table
  (`Dragonfire/Vorkath`) is only given for the post-quest form, so the quest form's resisted value
  (the "failed the accuracy roll" number, 50 after the quest) is unknown. Only the ranged cap was
  changed.
* **Vorkath's venom chance**: the plugin applies venom on half the venom-breath hits
  (`Math.random() < 0.5`); the Wiki only says it inflicts venom, and the capture cannot show a rate
  once the player is already venomed.
* **Vorkath's first special** follows five standard attacks in the recordings (the code's
  `FIRST_SPECIAL_HEAD_START = 1`) while the Wiki says six; the capture-derived value is kept.
* **Dagannoth Supreme's splash**: the Wiki's "6x6 area around his target" cannot be a symmetric box
  around a single tile; the code uses radius 3 (7x7) and notes the facing nuance as a follow-up.
  Capture 3433 has no projectile packets, so it cannot settle it.
* **K'ril's prayer-drain message** is not in the Wiki and not in the captures; left as it was.
* **Giant Mole instances** (25,000 coins, 12,500 with the Hard Combat Achievements, halved for
  ironmen) and the light-source extinguishing on a burrow are not implemented; the plugin says so.
* **Corporeal Beast's damage-reduction overlay** (varbit 999) and the KQ's cosmetic overhead
  protection prayers were not re-verified here.

## Verification

* `node --check` on `plugins/bosses/godwars/Combat.GodWars.js`,
  `plugins/bosses/godwars/Zamorak.GodWars.js`, `plugins/bosses/godwars/Dungeon.GodWars.js`,
  `plugins/bosses/GiantMole.plugin.js`, `plugins/bosses/vorkath/Shared.Vorkath.js` and
  `plugins/bosses/vorkath/Combat.Vorkath.js`.
* `node --test tests/god-wars-dungeon.test.cjs` — 9 pass, including the two new tests (K'ril's
  smash skips the accuracy roll and lands 35-49 through the prayer; an empty chamber restores every
  drained stat).
* `node --test tests/giant-mole.test.cjs` — 25 pass, including the new respawn test.
* `node --test tests/vorkath-combat.test.cjs` — 20 pass, including the new quest-form ranged cap
  test.
* `node --test tests/corporeal-beast.test.cjs` (22), `tests/dagannoth-kings.test.cjs` (12) and
  `tests/kalphite-queen.test.cjs` (21) — all pass, unchanged.
