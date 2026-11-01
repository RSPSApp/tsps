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

### One-cycle protection

`PacketSender.sendProjectile` no longer accepts an end at or before `launch + 1`. If content
passes one, it falls back to the ordinary 5-cycles-a-tile flight instead of sending a one-cycle
flash at the caster. This is the class of bug behind #1808 (and the Zaryte crossbow special).

### Other special attacks

| Special | Before | After |
| --- | --- | --- |
| Morrigan's javelin, Phantom Strike | `1622` (Araxxor's magic projectile) | `1620` (Morrigan's javelin travel) |
| Zaryte crossbow, Evoke | `301`, `44` -> `35` (one-cycle) | equipped bolt's travel spotanim on the crossbow trajectory |
| Armadyl crossbow, Armadyl Eye | `301`, `50` -> `70` | `301`, `41` -> `46 + 5 × tiles`, heights 155/146 (RSProx 3277) |

## Audited and unchanged

These match the captures or the Wiki, so they were left alone:

- **Arrows** (`10/9/11/12/13/15/16`): start 41, `46 + 5 × tiles`, angle 15, progress 11,
  heights 163 -> 146. Heights now use the captured quarter values.
- **Crossbows** (`27`): start 41, `46 + 5 × tiles`, angle 5, progress 11, heights 155 -> 146.
- **Darts** (`226`–`231`, `34`, `1936`, `1122`): start 32, `32 + 5 × tiles`, angle 15,
  progress 105, heights 142 -> 146.
- **Knives** (`212`–`218`, `697`): start 32, `32 + 5 × tiles`, heights 163 -> 146.
- **Thrownaxes** (`35`–`41`, `1319`, `1623`): same thrown timing; dragon/Morrigan's IDs correct.
- **Venator bow** (`2291`): start 31, `46 + 2 × tiles`, angle 255, progress 11, heights 156/146.
- **Tumeken's shadow** (`2126`): start 56, `72 + 10 × tiles`, angle 32, progress 40.
- **Magic**: the legacy `(0, 20, 43, 31)` shape is normalised to start 51, `46 + 10 × tiles`,
  heights 172/124, which matches the captured `*_travel` spotanims.
- **Crystal bow / Bow of Faerdhinen** (`249`, `1887`, `1922`, …), **blisterwood stake**
  (`3987`), **bone bolts** (`696`), **chinchompas** (`908/909/1272`), **atlatl** (`2795`),
  **salamanders** and the NPC projectile specs already captured in their plugins.

## Verification

```
cd server && npx tsc --build
cd server && node --test tests/projectile-audit.test.cjs            # 6 pass
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
- Heights are quarter-tiles (packet values are `height × 4`); the captured values used here
  (163/146, 155/146, 142/146, 155/177) are exact.
