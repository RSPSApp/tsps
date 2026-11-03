---
quest: A Taste of Hope
key: taste_of_hope
status: in-progress
tested: 2026-11-03
tester: agent
model: DeepSeek V4.1 Flash
commit: e21c6b5f1
cache: osrs-241_2026-10-20
start: fresh
travel: not run
---

# A Taste of Hope

Source/cache and Quest Helper audit. **No usable capture exists in the RSProx archive**: the
recordings that carry the quest's varbits contain no quest start/completion message. A full
native route was not replayed.

## Findings

- **checked** The durable ladder is mapped to the native/helper wire values and every value
  resolved a helper step (none returned `unavailable`) in the sweep: 1→15, 5→20, 10→30, 20→40,
  26→45, 30→55, 35→65, 45→75, 75→75, 91→90, 95→95, 100→100, 110→110, 115→115, 120→120,
  125→125, 130→130, 135→135, 145→140, 150→140, 155→145, 160→150, 165→160, 166→165. Cache DB
  row 144 completes at **165**.
- **checked** The completion stage is 166 internally but is sent as **165**, so the client and
  `contract` both see complete (165 >= 165). No off-by-one on the wire.
- **checked** `myq4_xp_reward` (6399), `myq4_serafina_book` (6397) and `myq4_veliaf_rod`
  (6398) are re-published by `syncTome` on login, and the stage transform varbits/NPC spawns
  are rebuilt by `applyStageSpawns`.
- **accepted difference** The Myreque hideouts and the Ranis/abomination fights are
  owner-only NPCs at the canonical tiles rather than instances; the roof route is
  click-to-teleport between vent/roof/jump tiles and the steam vents do not damage. The
  plugin header records each of these.
- **unchecked** No capture means the start/completion text, the rally/cutscene timing, the
  Tome of Experience claim, the Ranis fight mechanics and the post-quest dialogue are not
  verified live.

## Capture-search note

Varp 1736 returns five submissions. The files decoded here (3275, 1833, 418 and 1885) contain
no `started a new quest` / `completed a quest` line for this quest. Submission 3275's only
pair is Vampyre Slayer, and 1833 has neither message. Varbit 6396 returns 3275/1710/1149-style
login writes; 6399 returns 1140 and 6397 returns 395, but 1140 and 395 were downloaded and
**not** decoded to text here, so they are leads only. Submission **1885** (revision 227, `rsprox-1885.bin` SHA-256
`E41CEB7AC61E3B403B9EB6B058E6A1689A9A6B7F4EF8664EF0749F9A66B49D7A`) and **418** (revision
231, SHA-256 `A2E951EDB1D3F3B7F0E8A12494BA4FB3355D0E9879C9432F2B77CA9C0C4CF640`) were
decoded and checked: neither has the quest's messages. NPC 3775 (Safalaan), 8220 (Vertida)
and 8249 (Vanstrom) return **0**.

## Runs

### 2026-11-03 — source/cache/helper audit

- **Start:** none played. A fixture account was moved through every durable stage with
  `::quest` to compare the wire value and the helper step; it is not a playthrough.
- **Wire:** varbit 6396 `myq4` in varp 1736 bits 0-8; cache DB row 144 completes at **165**.
  Wire values listed above; completion 166 is sent as 165.
- **Rewards (source):** 1 Quest Point, the Ivandis flail, Drakan's medallion and the Tome of
  Experience (2,500 XP in three skills, 35+); the plugin matches the Wiki. Not observed live.
- **Not checked:** the whole route (Garth, Safalaan, the mercenaries, Harpert, the spy window,
  Flaygian, Serafina's house potion puzzle, the trap and abomination, Old Man Ral's base,
  Veliaf's Rod, the flail, Ver Sinhaza and Ranis), the Tome claim, full-bag recovery,
  repeat/relog, post-quest dialogue, visuals and jingle.
