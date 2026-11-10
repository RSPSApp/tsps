---
quest: Twilight's Promise
key: twilights_promise
status: passed-with-issues
tested: 2026-11-10
tester: agent
model: claude-opus-5-5
commit: fix/twilights-promise-rev242
cache: osrs-242_2026-11-03
start: fresh
travel: travel_to
---

# Twilight's Promise

A fresh account played the whole quest, 0 to 50, against a full revision 242 RSProx capture
(`20261109T221430-5ab63b4`). Its five scenes now play in instances as live's do, and both endings
were checked: the capture's (below The Heart of Darkness's requirements) natively, the Wiki's
(meeting them) from a stage 48 checkpoint.

## What live does (RSProx capture, revision 242, 2026-11-09)

- **Stages** are `vmq2` 9649, 0 to 50 in steps of 2, on the ticks the plugin keys them to; the
  knight groups are 9829-9832 (1 asked, 2 done, 3 returning), the crest 9833, Azali 9834
  (1 at the pub, 2 following, 3 sober) and `vmq3_itzla_vis` 11123 from stage 24.
- **Starting the quest** (tick 1117) also moves `vmq2_first_travel` 9652 from 3 to 4 when the
  first trip's welcome was never heard.
- **Five instances**, each `rebuild_region` 13 x 13 zones of every plane, unturned: the fountain
  dunk from 1704,3016 (tick 1855), Mezan's spar from 1776,3048 (1984), the judgement from
  1632,3104 (2290), the Teomat battle from 1392,3128 (2539) and the aftermath from 1392,3120
  (2764). Each ends back on the real map.
- **Scene music**: each instance plays its own track as it loads and the area's music returns as it
  ends: Mezan's spar 775 (tick 1984), the judgement "A Matter of Intrigue" 810 with 774 as a
  secondary (2290, where it unlocks; not at the crypt gate), the battle and aftermath 774 with 810
  (2539, 2764); back in the palace, Civitas illa Fortis 787 (2352, after the rebuild at 2350).
- **The ending** depends on The Heart of Darkness's requirements. Below them (this account had
  44 Slayer): "I'm not sure... yet. No doubt mother will quickly learn...", "In that case, I'll
  make sure to keep checking in.", "Thank you, iknami. Timoiva for now, and may the sun light
  your way.", and the quest completes on the continue after that line (tick 2794). Meeting them,
  rev 226 recording 1695 completes as "However, let's not worry about that just now..." shows
  (tick 2411, varbit, line and scroll together), and the offer follows once the scroll closes.
- **Wording**: live has the comma after "Well" and "Hey" the Wiki drops, "Colosseum" and "the
  Fortis Spark" (RSPSApp/osrsreboxed-db#62).

## Findings

- **fixed** No Regulus Cento stood outside Varrock's east gate (Quest Helper's first step), and
  Primio had Travel before the first trip was agreed. Both now spawn as live's multi-NPCs (13370 at
  3281,3413 and 13371 at 3277,3411, on `vmq2_first_travel`); Regulus's Talk-to plays the first trip
  and "Sounds good." moves it 1 to 2 (rec 1695 tick 450), giving both Travel.
- **open** The twins' "Where can I find..." menu keeps every option after one is asked; live drops
  the one just asked (ticks 1371-1383). The Wiki writes it as `{{tact|previous}}`.
- **open** A level-up from the 3,000 Thieving XP closes the conversation, so a player meeting The
  Heart of Darkness's requirements who levels up there misses its offer (talking to Itzla again
  gives it). Not captured.
- **open** The scenes' secondary tracks (774 under 810, 810 under 774) aren't sent: the server has
  no `midi_song_withsecondary`.
- **fixed** The ending always offered The Heart of Darkness, even below its requirements; Beneath
  Cursed Sands also answered that condition for every quest that uses its words.
- **fixed** The scenes played as private areas on the real map; they are instances.
- **fixed** The crypt gate played and unlocked "A Matter of Intrigue"; the judgement does, and
  each scene plays its captured track (QuestScenes `rules.musicTrack` through `getMusicTrack`).

## Runs

### 2026-11-10 · agent · claude-opus-5-5

- **Start:** fresh account; fixtures: Children of the Sun complete, 70 Attack/Strength/Defence/
  Hitpoints/Ranged, 50 Prayer, rune melee gear, a rune crossbow with bolts and sharks. Slayer
  stayed at 1. Placed by Primio in Varrock with `::tele` (the only teleport).
- **Route:** Primio's first trip to Fortis; the twins; Metzli; the crypt stairs and gate; Itzla;
  the twins' crest; the bazaar knights and the citizen's pocket; Nel and the crate at
  1778,3149; Azali from the pub to the fountain (she strayed once and went back to the pub, as
  live); Mezan in the Colosseum (melee, then the crossbow after each prayer call); the twins;
  the Kualti Headquarters chests and the letter; the judgement; Regulus and Renu's feed; Renu
  to the Teomat; Itzla, Metzli, the eight cultists and the aftermath.
- **Result:** every stage and side varbit as captured; each scene in its instance at the
  captured source tile, back on the real map after; the capture's ending, completing on the
  continue; 1 quest point and 3,000 Thieving XP; stage 50 and Renu kept after a relog.
- **Checkpoint (stage 44, then 48), second account with Mining 55, Thieving 48, Slayer 48 and
  Agility 46:** a logout inside the battle instance logged back in at 1441,3179 with stage 44
  kept; the battle replayed; the Wiki's ending with The Heart of Darkness's offer ("No." kept it
  unstarted).
- **Not checked:** the Wiki ending's other branches past the offer; a death in a scene instance
  (the grave goes to the scene's exit; unit test only); a server stop mid-scene (unit test only).
