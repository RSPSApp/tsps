---
quest: Quest Name
key: quest_key            # the plugin's registerQuest key; the folder is this key with - for _
status: passed            # passed | passed-with-issues | in-progress | failed | untested
tested: YYYY-MM-DD        # date of the latest run
tester: agent             # agent | human | community
model: claude-opus-5-5    # the model that ran it (agents), else leave empty
commit: 0123456789ab      # the main commit whose quest code the run tested
cache: osrs-241_2026-10-20
start: fresh              # fresh | checkpoint (say from which stage under Runs)
travel: travel_to         # travel_to | travel_to (walks skipped) | walk_to | manual; never ::tele after the start
---

# Quest Name

One or two sentences: what the latest run proved, and what it didn't.

## Findings

Newest first. One line each, linked to its issue or PR when there is one.

- **open** What is wrong, where (loc/NPC id, tile), and what live OSRS does instead. #1234
- **fixed** What was wrong. Fixed in #1235.

## Runs

Newest first. A rerun adds an entry; it never rewrites an older one.

### YYYY-MM-DD · tester · model

- **Start:** fresh account, placed at ... with `::tele` (the only teleport).
- **Route:** the travel and the quest steps, briefly; transports the run went through.
- **Result:** stage values (varp/varbit), rewards (quest points, XP, items) and the checks
  done (repeat dialogue, relog).
- **Not checked:** what this run leaves open (alternate routes, recovery, cutscenes).

<!--
Copy this folder to docs/quests/<key with - for _>/ and fill it in, then run
`yarn docs:quests` to update the index. No local paths, raw logs or account passwords:
cite issues, PRs and https://rsprox.net/database captures instead.
-->
