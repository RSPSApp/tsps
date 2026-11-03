# Projectile audit (issue #1808)

Rune javelins fired from a ballista appeared on the player for one client cycle and then
vanished. The cause was the ballista special attack: it hard-coded the **dragon** javelin's
travel spotanim (`1301`, model 31497) and passed an end time (`30`) before its launch time
(`70`). The server clamped the end to `71`, so the client drew the dragon javelin at the caster
for one cycle and removed it. A normal attack used `205` (rune javelin) correctly.

Everything below was checked against the RSProx captures in `~/.rsprox/binary` (notably
recording **4288**, revision 239, and the projanim summary from 3277/3030/3279/4014/4017/4031/
4032/4037/801/722/475/4121), RuneLite's cache `SpotanimID` names, and the OSRS Wiki.

## Fixes

### Ballista (the reported bug)

| Item | Before | After | Source |
| --- | --- | --- | --- |
| Special projectile | dragon javelin `1301` | equipped javelin (`205` rune, `1386` amethyst, …) | RSProx 4288: `silvthrill_javelin_travel (3806)` on a ballista shot |
| Special timing | `70` -> `30` (clamped to `71`) | `42` -> `44 + 3 × tiles` | RSProx 4288: start 42, end 65/68/71/74/77 at d7–d11 |
| Normal trajectory | `41` -> `46 + 5 × tiles`, heights 44/35, angle 16, progress 64 | `42` -> `44 + 3 × tiles`, heights 155/177, angle 14, progress 120 | RSProx 4288 |
| Impact | none | `ballista_special (344)` on the target at the projectile's arrival, height 177 | RSProx 4288: `[spotanim] id=ballista_special (344), delay=<projectile end>, height=177` |
| Special sound | crossbow shot `2695` | Powershot `2536` | Wiki: Heavy ballista sound effects |

The ballista's existing hit delay (`2 + floor((1 + d) / 6)` ticks) already matched
`ceil((44 + 3d) / 30)`, so it now agrees with the projectile.

### Ammunition IDs

| Ammunition | Before | After | Evidence |
| --- | --- | --- | --- |
| Broad arrow | travel `11`, launch `20` (steel arrow) | travel `326`, launch `325` | `SLAYER_BROAD_ARROW_TRAVEL/LAUNCH`; RSProx projanim 326 |
| Morrigan's javelin | `200` (bronze javelin) | `1620` | `MORRIGANS_JAVELIN_TRAVEL`; its model is 35982, not the shared 3144 |
| Silvthrill javelin | `1301` (dragon javelin) | `3806` | `SILVTHRILL_JAVELIN_TRAVEL`; RSProx 4288 |
| Amethyst javelin | missing | `1386`, +135 ranged strength | `AMETHYST_JAVELIN_TRAVEL`; Wiki: Amethyst javelin |
| Poisoned javelins | missing | p/p+/p++ variants for every metal, amethyst and dragon | Item IDs from `ItemIdentifiers`; the same ammunition and spotanim |
| Crossbow bolts | every bolt played launch `955` (hunter crossbow) | no launch graphic | RSProx sends only the travel spotanim (27/696/1468); 955 is `HUNTER_XBOW_LAUNCH` |
| Crossbow arc | angle 16, progress 64 (the `Projectile` defaults) | angle 5, progress 11 | RSProx `crossbowbolt_travel (27)` and `dttd_bone_crossbowbolt_travel (696)` |

### Ammunition that should fire but didn't

Worn items with no ammunition entry refused to fire with "You don't have any ammunition to fire".
Rules are from the Wiki; ids and strengths from the cache.

| Ammunition or weapon | Before | After |
| --- | --- | --- |
| Poisoned arrows, bolts and darts (p/p+/p++) | no entry | fire as the plain item; poison still comes from the worn item, and dragon bolts and amethyst darts now have a poison type |
| Lit fire arrows | no entry | fire as the plain arrow, with its spotanims |
| Broad bolts | on item `13280`, the Max cape | `11875`; amethyst broad bolts (`21316`) fire as broad bolts |
| Blurite, silver and barbed bolts | no entry | added to the crossbows that fire them |
| Crossbow, Phoenix crossbow, blurite crossbow | no weapon entry | bronze bolts only; blurite crossbow also fires blurite bolts |
| Hunters' crossbow, hunters' sunlight crossbow | no weapon entry | kebbit bolts; antler bolts |
| Ogre bow, ogre and brutal arrows | no entry | ogre bow fires ogre arrows and brutal arrows up to mithril; comp ogre bow fires all of them |
| Karil's crossbow 100/75/50/25, rune crossbow (or), dragon crossbow (cr) | no weapon entry | same as the base weapon |

### One-cycle protection

`PacketSender.sendProjectile` no longer accepts an end at or before `launch + 1`. If content
passes one, it falls back to the ordinary 5-cycles-a-tile flight instead of sending a one-cycle
flash at the caster. This is the class of bug behind #1808 (and the Zaryte crossbow special).

### Other special attacks

| Special | Before | After |
| --- | --- | --- |
| Morrigan's javelin, Phantom Strike | `1622` (Araxxor's magic projectile) | `1620` (Morrigan's javelin travel) |
| Zaryte crossbow, Evoke | `301`, `44` -> `35` (one-cycle) | equipped bolt's travel spotanim on the crossbow trajectory |
| Armadyl crossbow, Armadyl Eye | `301`, `50` -> `70` | `301`, flat `41` -> `75`, angle 5, progress 11, heights 155/146 (captured at both 7 and 8 tiles) | RSProx 3277: `acb_specialattack (301)` |

## Audited and unchanged

These match the captures or the Wiki, so they were left alone:

- **Arrows** (`10/9/11/12/13/15/16`): start 41, `46 + 5 × tiles`, heights 163 -> 146. Heights
  now use the captured quarter values. The capture's angle 15, progress 11 is not sent yet (see
  remaining risk).
- **Crossbows** (`27`): start 41, `46 + 5 × tiles`, angle 5, progress 11, heights 155 -> 146.
- **Darts** (`226`–`231`, `34`, `1936`, `1122`): start 32, `32 + 5 × tiles`, heights 142 -> 146.
  The capture's angle 15, progress 105 is not sent yet (see remaining risk).
- **Knives** (`212`–`218`, `697`): start 32, `32 + 5 × tiles`, heights 163 -> 146.
- **Thrownaxes** (`35`–`41`, `1319`, `1623`): same thrown timing; dragon/Morrigan's IDs correct.
- **Venator bow** (`2291`): start 31, `46 + 2 × tiles`, angle 255, progress 11, heights 156/146.
- **Tumeken's shadow** (`2126`): start 56, `72 + 10 × tiles`, angle 32, progress 40.
- **Magic**: the legacy `(0, 20, 43, 31)` shape is normalised to start 51, `46 + 10 × tiles`,
  heights 172/124, which matches the captured `*_travel` spotanims.
- **Crystal bow / Bow of Faerdhinen** (`249`, `1887`, `1922`, …), **blisterwood stake**
  (`3987`), **bone bolts** (`696`), **chinchompas** (`908/909/1272`), **atlatl** (`2795`),
  **salamanders** and the NPC projectile specs already captured in their plugins.

## Magic shortbow Snapshot (issue #2021)

Snapshot used the ordinary glowing-arrow launch graphic (`250`) immediately at height 100,
and both travel arrows ended at cycle 57 despite starting at cycles 40 and 33. The dedicated
Snapshot graphic is now `256`, in actor slot 1 at height 92 with a 30-cycle delay. Its two
arrows start at cycles 20 and 50, end at `30 + 3 × tiles` and `50 + 3 × tiles`, and use angle
15, progress 11 and heights 163/146. PacketSender multiplies projectile heights by four,
so the plugin supplies 40.75/36.5. Each hit is queued for the first tick at or after its
projectile lands, accounting for the core's extra processing tick against NPCs.

Evidence:

- The [OSRS Wiki](https://oldschool.runescape.wiki/w/Magic_shortbow#Special_attack) describes
  Snapshot's two arrows in rapid succession.
- [RSProx recording 412](https://rsprox.net/download/412), revision 231, normal world:
  ticks 92 and 99 show sequence `snapshot (1074)`, slot-1 graphic
  `sp_attack_snapshot_spotanim (256)` delayed 30 cycles at height 92, and both captured
  projectile shapes at distances one and two. Both NPC hits appear two ticks after each
  activation. [Recording 4008](https://rsprox.net/download/4008), revision 237, Pest Control,
  repeats the projectile shapes at distances two and four.
- The active revision-241 cache confirms travel `249` (model 3473, no sequence), launch
  `250` (model 3473, sequence 366), Snapshot `256` (model 3473, sequence 1075) and attack
  sequence `1074` (58 cycles).

Offline regressions exercise the plugin, serialized projectile fields and hit scheduling for
NPC/player targets. Player-target alignment applies the captured projectile arrival to the
existing scheduler; the recordings above only show NPC targets. No live gameplay, browser
rendering or PvP/PID timing was tested.

## Dark bow Descent graphics (issue #2022)

Descent omitted the equipped arrows' draw-back graphic and visible arrow projectiles,
used flat flights for both special effects, and played the dragon impact after each
hit even when firing ordinary arrows. The special now sends the equipped ammunition's
double-arrow launch in actor slot 1 at height 96, pairs each special effect with its
visible arrow, and sends one matching impact at the second arrow's landing delay.

The [OSRS Wiki](https://oldschool.runescape.wiki/w/Dark_bow#Special_attack) describes
dragon heads with dragon/seeking dragon arrows and shrouded arrows otherwise. Live
[RSProx 273](https://rsprox.net/download/273), revision 229, tick 497, records the
dragon launch `1111`, paired projectiles `1099`/`1120`, and impact `1100` delayed to
cycle 145 at height 96. At nine tiles the low flight runs 41→91 and the high flight
41→145, with angles 5/25, progress 11 and projectile heights 40/36. Revision 229
projectiles quantize those heights to multiples of four; the current packet sends
160/144 for the same measurements.

[RSProx 2510](https://rsprox.net/download/2510), revision 229, ticks 456/683/940,
repeats both projectile pairs against players. The first flight ends at `46 + 6 × tiles`
(64 at three tiles, 70 at four), and the second at `55 + 10 × tiles` (85/95).
The NPC recording's first flight matches `46 + 5 × tiles`; the target-specific
distance formula is inferred from those samples rather than a capture at every range.

The active revision-241 cache confirms `darkbow_dragon_head_flying_projanim` 1099,
`darkbow_dragon_head_flying_impact_anim` 1100, `darkbow_generic_smoke_arrow_flight` 1101,
`darkbow_broadarrow_smoke_arrow_flight` 1102, and `darkbow_smoke_arrow_impact` 1103.
Ordinary/broad arrows use those smoke effects and their own visible arrow. No captured
non-dragon Descent was found, so applying the same trajectories, launch height and
impact delay to those variants is an inference from the shared weapon and cache names.

Offline tests cover dragon, seeking dragon, rune and broad ammunition, packet fields at
the captured distances and the delayed impact remaining unchanged after hits. No live
gameplay or browser rendering was checked. Existing hit scheduling is unchanged.

## Verification

```
cd server && npx tsc --build
cd server && node --test tests/projectile-audit.test.cjs            # 11 pass
cd server && node --test tests/bow-specials.test.cjs                # 15 pass
cd server && node --test tests/projectile-source-actor.test.cjs     # 3 pass
cd server && node --test tests/thrown-weapons.test.cjs tests/ranged-magic-gaps.test.cjs  # 34 pass
cd server && node --test --test-name-pattern='silvthrill ballista' tests/quest-plugins.test.cjs
```

The new `tests/projectile-audit.test.cjs` pins the ammunition IDs, the no-launch-graphic rule
for bolts, the captured bow/crossbow/dart/ballista heights and timings, the one-cycle guard,
and the Concentrated Shot launch (rune javelin `205`, end `71` at 9 tiles, impact `344`).

## Not verified / remaining risk

- **In-game visual check**: the worktree's client was not driven for a screenshot/clip. The
  timing and IDs are checked against captures and the packet bytes.
- Poisoned javelins now resolve through the same `Ammunition` family, but no content path was
  exercised for each poison tier.
- The damage/accuracy special-attack maths is unchanged; only its projectile was corrected.
- Arrows and darts still send the `Projectile` default angle 16, progress 64 rather than their
  captured arcs.
- No capture shows kebbit, antler, blurite, silver, barbed or brutal shots, so their travel
  spotanims are a nearby match (`27` for bolts, `242` for brutal arrows). Lit fire arrows fly as
  plain arrows, not `FIRE_ARROW_TRAVEL` (17).
- The comp ogre bow still also fires metal arrows, which the Wiki doesn't list for it.
- Heights are quarter-tiles (packet values are `height × 4`); the captured values used here
  (163/146, 155/146, 142/146, 155/177) are exact.

# Magic and NPC projectiles (issue #1862)

Projectiles "didn't align with the casting animation or travel toward the player". Two client
bugs made projectiles hang over their caster, and many NPC attacks hit before their projectile
arrived.

## Client

| Bug | Fix |
| --- | --- |
| A relog without a page load restarts the client clock. `ProjectileManager` only solves cycles past its last one, so every projectile sat on its caster and snapped to its target until the new clock passed the old (minutes). `resetWorld` cleared `renderer.projectileManager`, which the WebGPU renderer doesn't have. | `resetWorld` clears through `getProjectileManager()`, and `update()` starts over when the clock goes back. |
| After a slow frame (a new area loading) the clock catches up up to 50 cycles at once; `update()` replayed 10 and dropped the rest, so the projectile fell behind and was removed mid-air. | Every elapsed cycle is replayed. |

`client/tests/projectile-clock.test.ts` covers both; each fails on the old manager.

## Hit timing

Measured in the client: a hit queued N ticks out on a **player** shows its splat 30·N cycles
after the projectile was sent; one on an **NPC** a tick later (`CombatFactory.hitProcessingDelay`).
A projectile reaches its target at its end cycle. So an NPC's hit on a player lines up when
N = `Projectile.ticksToLand(end)` = ceil(end / 30). Player spells and ranged already did.

Fixed to hit when the projectile lands (projectile ids, heights and arcs unchanged; captured
flights kept, only their hits moved):

- Generic NPC magic (fixed 3 ticks) and ranged (1 tick with a flat 40 → 57 arrow, now
  41 → 46 + 5/tile).
- Dragonfire (flat 40 → 55, 1 tick; now 40 → 45 + 10/tile), wyrms, demonic gorillas, revenants,
  Pest Control defilers and torchers, Surok, Ithoi, the Sourhog.
- TzTok-Jad and JalTok-Jad: the hit (and the prayer read) stays at 3 ticks; the magic orb now
  lands then, not 10 cycles a tile after.
- God Wars generals and bodyguards, Vorkath, Sarachnis, Araxxor, Callisto/Artio, Venenatis/Spindel,
  Chaos Elemental, Chaos Fanatic, both Archaeologists, Skotizo.
- Nightmare husks, Nex's mages and blood reavers, Dagannoth Prime/Supreme, Spinolyps, Kraken,
  Thermonuclear smoke devil, Kalphite Queen, Mimic minions.
- Raids: Nylocas (all), Maiden's Blackstorm, CoX Skeletal Mystics, Deathly mage/ranger,
  Muttadiles, Shamans, Olm's head shots, Vanguards, Tekton sparks, ToA agile scarabs.
- Flights that ended at or before their launch (drawn on the caster): Growler/Balfrug and the
  Vanguards' magic up close, Alchemical Hydra, Grotesque Guardians, Shellbane Gryphon and
  Muttadile magic at 1 tick, Leviathan's 1-tick volley.

Left as they are, on purpose: the Callisto/Artio orb (its knockback dodge is read at landing),
the CoX Ice Demon burst up close (captured), the Fanatic and Archaeologist tile bombs, and the
Kalphite Queen's flat 40 → 70 flight (`docs/kalphite-queen.md` wants captures first). Revenant
and Sourhog impact graphics keep their captured cycle, which can be ahead of a long flight.
