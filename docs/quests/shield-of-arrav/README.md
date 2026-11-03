---
quest: Shield of Arrav
key: shield_of_arrav
status: passed-with-issues
tested: 2026-11-03
tester: agent
model: claude-opus-5-5
commit: 9c0850318
cache: osrs-241_2026-10-20
start: fresh
travel: travel_to
---

# Shield of Arrav

A fresh account played the Black Arm Gang route rsprox 1705 and 1710 captured (the same
account across both recordings), from Reldo to King Roald, and every captured page, box and
stage change now matches. The Phoenix Gang route has no capture and was not replayed; its
only captured value is the completed varp 145 = 10 (1149).

## Findings

Newest first.

- **fixed** The quest started on choosing "Yes."; 1705 starts it on Continue past Reldo's
  "Well, if you look around…". Katrine's task (varp 146 = 2) and the Reldo/Charlie "met" bits
  likewise moved to the lines 1705 sets them on.
- **fixed** Dialogue text, corrected in the dumper
  ([RSPSApp/osrsreboxed-db#35](https://github.com/RSPSApp/osrsreboxed-db/pull/35)): Reldo's
  "I'd better get going." option; no empty chat line after "Hello there, [name]."; Baraek's
  "Hello! I'm in search of a quest." and "Okay, here's 20 coins." wording; Charlie's
  five-option menu; Katrine's "How unusual…" (a dumper jump skipped it) and closing "Will do!
  Thanks!"; the curator's "I wonder if the [gang] might have the other half."
- **fixed** Katrine's "It was Charlie" and "Everyone knows" answers ended the talk: their
  "Continues after 'Say we were…'" markers never resolved. Fixed in the dumper's jump
  resolution, so both now reach the member menu.
- **fixed** Item boxes where 1705/1710 show them: bookcase (book, then "Aha! Exactly what I was
  looking for."), Baraek's coins, Katrine's crossbows, the curator's shield half, the
  combined certificate, and the king's certificate. The cupboard opens with animation 536 and
  sounds 58/57, swaps to the open loc for two ticks and plays its transcript.
- **fixed** Katrine's "Thinking about it…" and the curator's "The two of you can then swap…"
  are replaced in the same tick live, so they are no longer shown.
- **fixed** Low-combat warning: a blocking box before the start menu, as in the captured
  Vampyre Slayer (1718) and The Ides of Milk (4153) starts, instead of a chat line with the
  wiki's "you combat level" typo. Not captured for this quest.
- **fixed** Completion scroll item is 11165 (1710), not the certificate.
- **fixed** Added captured chat-head animations for Reldo, Baraek, Charlie, Katrine, the
  curator, King Roald and the player.
- **open** Varbits 11513 (Weaponsmaster dead) and 11514 (shield given) are never sent; 1710
  sets them. 11514's Phoenix value is uncaptured.
- **open** Katrine's "It seems you're more skilled…" wraps to five lines and a second page;
  live fits it on one page of four. Shared dialogue wrapping.
- **open** Charlie's after-task variant: "Any idea where the Phoenix Gang are based?" has no
  steps and a stray two-option menu follows; this is how the wiki page is written.
- **open** Several plugin step ids (`5UTIVW`, `OfFGS6`, `DSC-L4`, `7GfBwz`, `XSi6qr`,
  `xWwA_D`, `q34K2Z`, `e0pTWp`) exist only in the historical transcript and never fire.
- **open** `travel_to` cannot use the Black Arm ganghouse staircase (11796/11799): to
  (3189, 3386, 1) it wandered to Falador and returned `blocked`; from upstairs every leg
  was `no-route`. Agent MCP.
- **open** (all quests) Object handlers run the tick after the player arrives, so the
  cupboard's animation and box are a tick later than 1710.
- **open** Completed with alternate accounts using item-on-player then drop/pickup; trading was unavailable. [#1257](https://github.com/RSPSApp/tsps/pull/1257)

## Runs

### 2026-11-03 — agent — Claude Opus 5.5

- **Start:** fresh account (varps 145/146 = 0, 0 quest points), placed at Reldo with `::tele`
  (the only teleport). Declared setup: coins for Baraek, the two Phoenix crossbows and the
  partner's half-certificate (11173), which 1710 got from a second player.
- **Route:** Reldo, bookcase, book, Reldo, Baraek, Charlie, Katrine (captured "I'd rather not
  reveal my sources." path), crossbow hand-in, ganghouse cupboard, curator, certificate
  combine, King Roald. `travel_to` for every leg except the ganghouse stairs (see findings).
- **Result:** varp 145: 1 → 2 → 3 → 4 and varp 146: 1 → 2 → 3 → 4 on the captured lines;
  varbit 13716 1 → 2; 1 quest point; 600 coins; certificate removed. Every captured page and
  box matched. Repeat talk to King Roald gave his post-quest lines; a relog kept the state.
- **Re-check:** a second account saw the warning box, the Baraek coins box and Katrine's
  "It was Charlie" branch reaching the member menu.
- **Not checked:** the Phoenix Gang route, the two-player hand-overs (items supplied
  instead), the Weaponsmaster fight, the scroll item on a client.

### 2026-10-25 · community (thehardcorenoobs1234) · model not recorded

- **Source:** community report ([#1257](https://github.com/RSPSApp/tsps/issues/1257)); moved here from its ledger on 2026-10-29. Proven against plugin hashes, not a commit, so a later plugin change is not flagged automatically.
- **Not checked:** Single account/run report; no full Quest Helper, recovery, multiplayer, dialogue, event or cutscene parity claim.
