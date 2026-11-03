---
quest: A Soul's Bane
key: a_souls_bane
status: in-progress
tested: 2026-11-03
tester: agent
model: DeepSeek V4.1 Flash
commit: e21c6b5f1
cache: osrs-241_2026-10-20
start: fresh
travel: not run
---

# A Soul's Bane

Source/cache and Quest Helper audit, plus a fresh-account **start check**. **No usable capture
exists in the RSProx archive**: no recording contains this quest's own start or completion
message, and the archive index has no hit for its stage varbit or parent varp. The full route
was not replayed.

## Findings

- **checked** Stage ladder, wire and the cache contract agree. Durable stages 1-13 are sent
  unchanged to varbit 2011 (`soulbane_prog`, varp 709 bits 0-4), and cache DB row 138
  completes at **13**. The pinned helper's `loadSteps` uses the same values (0 = Launa,
  1/2 = anger room, 3/4 = fear, 5/6 = confusion, 7/8 = hopelessness, 9/10 = Tolna room,
  11 = talk to Tolna, 12 = talk to Tolna on the surface); the helper step at each value is
  consistent with the plugin's meaning. The fixture lacked room/gear state, so the helper
  showed its conditional default ("Use a rope on the rift") for the room stages.
- **checked** The sibling varbits the helper reads are earned and replayed on login:
  `soulbane_rifttrope_pres` (2032), `soulbane_anger_weaponmulti` (2029),
  `soulbane_fear_enemydoor` (2012), `soulbane_fear_monspres` (2035),
  `soulbane_fear_exitlit` (2030), the confusion doors (2014-2018, 2031), the hope bridge
  (2020) and the Tolna/Launa presence bits (2025, 2026).
- **accepted difference** The rage room grants combat XP; OSRS grants none there apart from
  40 Attack on the room clear. The plugin mirrors the 8-kill bar to
  `soulbane_angry_damagedealt` (2036) at 500 per kill rather than raw damage. Documented in
  the plugin header; not changed.
- **accepted difference** The rift is not instanced. Owner-only NPCs are spawned in the
  shared cave and removed on logout; the final arena is built at 3078-3096, 5290-5308. This
  is a construction difference, not a captured value.
- **unchecked** Without a capture, the cutscene timing, room-restart behaviour on relog, the
  post-quest Tolna's rift training spawns and the reward scroll/jingle are not verified against
  live OSRS. The start dialogue itself was played live (see below).

## Capture-search note

The archive returned **0** for varbit 2011 (`soulbane_prog`), varp 709, every sibling varbit
listed above (2012, 2014-2022), and NPC 1059 (Tolna's Voice), 1066 (Fear reaper) and 1067
(Confusion beast), so no recording shows the quest. Submission **1757** (revision 227) has 16
text hits for the name but no `started a new quest` or `completed a quest` line for it; the
decoded file `rsprox-1757.bin` SHA-256
`96C9383A6B6B99FCE9CFDA791C7C35BE20006C333FAED00A97CDEDE221628AA5` is not evidence of a run.

## Runs

### 2026-11-03 — fresh start check

- **Start:** fresh account, `::tele 3310 3452 0` to the rift east of Varrock (the only
  teleport). A rope (954) and an iron scimitar (1323) were supplied as declared setup items;
  the rope is a quest item but was not gathered on the route.
- **Route played:** talked to Launa through the story and answered `Yes` to
  "Would you like me to go down to look for your husband and son?"; used the rope on the rift
  at 3310,3452. The stage went **0→1** on the accepted offer, then **1→2** and
  `soulbane_rifttrope_pres` (2032) **0→1** when the rope was used; the player was in the rage
  room (`soulbane_prog` 2). HP went 10→9 after entering.
- **Result:** start dialogue, the stage-1 wire value and the rope bit match the plugin's
  designed transitions. The run stopped at the rage room; no combat, room clear, reward or
  completion was played.
- **Not checked:** the rest of the route (rage/fear/confusion/hopelessness, Tolna, surface
  hand-in), rewards, repeat/relog, recovery, post-quest dialogue, visuals and jingle.

### 2026-11-03 — source/cache/helper audit

- **Start:** no full playthrough. A fixture account was moved through stages 0-13 with
  `::quest` to compare the wire value and the helper step; it is not a playthrough.
- **Wire:** varbit 2011 in varp 709 bits 0-4; captured/contract completion **13**. Values sent:
  `0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13`, unchanged.
- **Rewards (source):** 1 Quest Point, 500 Defence XP, 500 Hitpoints XP, 500 coins and
  Tolna's rift access; the plugin matches the Wiki. Not observed live.
- **Not checked:** the whole route (Launa, rope, rage/fear/confusion/hopelessness rooms, the
  three Tolna heads, the surface hand-in), the two room-restart cases, full-bag coins,
  repeat/relog, post-quest dialogue, visuals and jingle.
