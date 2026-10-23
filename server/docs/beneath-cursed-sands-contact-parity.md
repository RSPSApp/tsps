# Beneath Cursed Sands and Contact! - capture and Quest Helper parity

References:
- RSProx recording: https://rsprox.net/download/101 (decoded revision 227.1; covers Contact
  and Beneath Cursed Sands).
- Quest Helper pinned commit:
  https://github.com/Zoinkwiz/quest-helper/tree/06da90f982518a093f2fe1c9cfac5547fa7053d3
  (`beneathcursedsands/BeneathCursedSands.java`, `TombRiddle.java`, `contact/Contact.java`).
- Cache revision 241 in this checkout supplies the final IDs; Wiki supplies unrecorded prose.

## Validation status
Descriptive "native" or "implemented" below means the server plugin path exists and focused
tests exercise it; it is not a claim of full MCP acceptance. Neither quest has passed a full
native run: native3 stopped at Beneath Cursed Sands stage 14 and Contact! stage 50, and native4
is still ongoing. Current full native passes across the issue are six (The Golem, Throne of
Miscellania, Shades of Mort'ton, Tai Bwo Wannai Trio, Scrambled!, Royal Trouble); there is no
all-32 pass claim.

## Captured state values

Contact varbit `3274`: `10` accepted, `20` cut scene 1 done, `30` asked the High Priest about
the tunnels, `40` Jex told, `50` Kaleef's parchment taken, `60` Maisa convinced, `70` Osman
agreed, `90` cut scene 2 done, `100` Giant Scarab active, `110` scarab dead, `120` Osman
account heard, `130` complete. The capture skips `80`; the second Al Kharid conversation is an
extra confirmation, not a stage. Sibling `3275` becomes `1` at completion; `3279` becomes `1`
on entering the tunnels.

Beneath Cursed Sands varbit `13841`: `2` start, `4` message slipped, `6` message read, `8`
Maisa intro, `10` camp talk finished, `12` departure, `14` necropolis, `16` entry inspected,
`18` guard fight, `20` guard defeated, `22` post-fight talk, `24` camp leads, `26` ruins/furnace
ready, `28` furnace inspected, `30` refuelled, `32` lit/emblem hunt, `34` emblem crafted, `36`
emblem placed, `38` rotation confirmed, `40` tomb entered, `42` mages dead, `44` first lever,
`46` levers/riddle door, `48` riddle solved, `50` spirit/Mehhar, `52` tomb history, `54` key
known, `56` key taken, `58` upper door open, `60` champion fight, `62` champion dead, `64` priest
incantation, `66` priest information, `68` priest freed, `70` Nardah/Zahur, `72` Maisa departs,
`74` crocodile/stepping stones, `76` Roger fed, `78` lily picked, `80` lily given, `82`
chemistry started, `84` chemistry solved, `86` Maisa departs, `88` crate received, `90` crate
delivered, `92` High Priest meeting, `94` citizens freed, `96` citizens walking, `98` Akh fight,
`100` Akh dead, `102` Osman departs, `104` Sophanem meeting, `106` Maisa tomb meeting, `108`
complete.

## Captured route fixes

- **Contact entrance:** ladder `20275` at `3315,2797` lands at `2765,5131`; trapdoor `20340`
  lands at `2166,4409,2`. The old direct teleport to Kaleef was removed. The maze floor-spike
  `20271` and spear `20272` are clickable; the boss ladder `20287` at `2116,4365,2` lands at
  `2297,4298` and is locked until Jex has explained the tunnels. At stage `90` it starts cut
  scene 3 and the stage becomes `100` when the Giant Scarab appears.
- **Contact chasm actors:** Maisa spawns at `2258,4317`, the Giant Scarab at `2269,4316`, and
  post-battle Osman at `2274,4315`. Osman in Al Kharid still uses the cache transform id `4286`;
  the outside-Sophanem encounter only opens at stage `70`.
- **Contact dialogue:** the High Priest uses stage `20` for the after-cut-scene menu; Jex
  advances `30 -> 40`; Kaleef's parchment advances `40 -> 50`; Maisa's two answers advance
  `50 -> 60`; Osman's successful persuasion advances `60 -> 70`.
- **Contact Maisa spawn/path:** capture 101 adds the base `contact_maisa_multi` (`6164`) at
  `2258,4317`; the canonical `npc-spawns.json` entry was wrongly at `3218,9246`. That single entry
  is corrected to `2258,4317`, the owner-only duplicate spawn is retired, and varbit `3284`
  hides/reveals the world Maisa for the scarab/Osman stages. No far Talk or teleport shortcut.
- **Contact quiz:** the transcript's three Maisa guards originally sat after the second choice,
  but the dialogue parser resolves top-level conditions eagerly. The plugin now moves those guards
  into the second choice's branches, so the actual choice event credits the answers first. Both
  `3876` (resolved content id) and `6164` (base multi) are accepted.
- **Contact cut scenes:** cut scene 1 (`3278,2786/3261,2783`), cut scene 2
  (`3297,2799/3314,2799`) and cut scene 3 (`2263,4327/2260,4313` with five shakes) now send the
  recorded camera move/look pairs through `QuestScenes`, block controls, and reset when the
  transcript closes or the player logs out.
- **BCS camera tracks:** necropolis arrival (`3322,2743/3332,2735`), guard scene/fight,
  tomb entry (`3420,9241,2/3410,9252,2`), necropolis finale/Akh sequence (including the shake)
  and Sophanem ending now send the captured pairs and reset on scene/death/completion/logout.
- **BCS puzzle/lore:** interface `750` opens after placing the scarab emblem, starts varbit
  `13849` at `18`, needs three `750:8` clicks to reach `15`, then `750:9` closes it and advances
  to stage `38`. Lore panels `748` (tablet) and `749` (riddle) use their recorded widget text
  instead of chatbox narration.
- **BCS chest:** the seven-digit lock code in the recording is `1118513` (the count-dialog
  `1,118,513`). The server now opens the recorded numeric prompt; a wrong code keeps the chest,
  the correct code yields the scarab mould.
- **BCS chemistry:** the table opens interface `751`. Buttons `25` (middle +3), `27` (right +3),
  `26` (left +3, middle -3, right +3) and `28` (left +3, right -3) update varbits `13863-13865`.
  The captured winning state is left `12`, middle `39`, right `45`; solving it sets stage `84`
  and plays Zahur's completion conversation.
- **BCS entry/citizen dispatch:** `Blocked Entry` is the placed `toa_entrance_blocked` loc `44008`
  at `3357,2711`; Inspect now sets the inspected flag/stage `16` and plays the recorded entry
  transcript. Citizen `11537` Talk-to is dispatched explicitly to its BCS variant, so the
  entry -> citizen -> guard fight -> ruins order no longer depends on the generic index timing.
- **BCS stage/NPC alignment:** the owner-only necropolis citizen is `11537` at `3347,2718`;
  post-fight Maisa is `3327,2740`. All BCS dialogue beats now use the captured even varbit values
  above. Stage `102-106` is the High Priest/Maisa finale; `108` is completion. Maisa no longer
  replays the finale after `102` or after completion.

## Route-check coverage

| Node | Evidence | Status |
|---|---|---|
| Contact start gate, 10/20 cut scene | Capture 101; QH start | Implemented and stage-tested |
| Jex, temple ladder, trapdoor | Capture 101; locs 20275/20340 | Implemented, captured landings |
| Maze traps and boss ladder | Capture 101; locs 20271/20272/20287 | Traps interactive; ladder gated and tested |
| Kaleef body, parchment, Maisa quiz | Capture 101; object 44597, item 10585 | Existing handlers + stage 50/60 |
| Osman persuasion and cut scene 2 | Capture 101; NPC 6165/4286 | Stage 70 gating + outside variant |
| Scarab, Keris, Osman report, reward | Capture 101 | Existing handlers, stage 100/110/120/130 |
| BCS Jamila/message/Maisa intro | Capture 101 | Stage 2/4/6/8/10 |
| BCS necropolis entry, citizen, guard | Capture 101 | Stage 14/16/18/20; citizen anchor |
| BCS furnace, well, chest, emblem | Capture 101 | Stage 26-38; chest code implemented |
| BCS tomb, levers, urns, spirit, key, champion | Capture 101 | Stage 40-62 |
| BCS Nardah, lily, Zahur, chemistry, crate | Capture 101 | Stage 70-90; chemistry implemented |
| BCS Akh, Osman, High Priest, rewards | Capture 101 | Stage 92-108 |

## Remaining uncertainty

- BCS interface `750` is implemented from the captured open/click/close order and varbit `13849`;
  the exact visual rotation model is not decoded, so the three `750:8` presses are the recorded
  input rather than a reconstructed 3D rotation.
- Camera rates are the captured `232/100` for the main cuts; sub-tick arcs and every actor
  position are not fully reconstructed. Scenes block controls and reset on transcript end,
  death, completion or logout.
- Contact's maze collision and trap damage are approximated: trap clicks are interactive and
  report the captured evade/set-off messages, but the exact Agility failure damage and every
  wall segment are not replayed. The recorded ladder/trapdoor landings and boss ladder are exact.
- Cut scene camera/actor timing is simplified to the transcript helper; recording 101 gives
  packet order but not a full server state machine for every scene actor.
- Stage `8`, `24` and the Contact second Al Kharid confirmation are inferred from dialogue beats
  because the capture does not expose a separate varbit for them.

## Tests

`server/tests/remaining-desert-parity.test.cjs` covers the canonical Maisa spawn, blocked entry
`44008` -> citizen -> guard -> ruins stage order, prerequisite refusal, Contact 10/20
milestones, Osman/Maisa gating, trap interaction, boss-ladder lock/entry/cut scene, the actual
Maisa transcript choice/condition path for `3876` and `6164`, Contact cut scene 1 camera, BCS
finale stages, citizen anchor, chest code, chemistry valves, interface `750`, lore widgets
`748/749`, and the necropolis/finale camera pairs.

Run from `server/`: `node --test tests/remaining-desert-parity.test.cjs`.
