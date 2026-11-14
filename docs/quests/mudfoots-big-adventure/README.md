---
quest: Mudfoot's Big Adventure
key: mudfoots_big_adventure
status: untested
tested:
tester: agent
model: claude-sonnet-5-5
commit:
cache: osrs-242_2026-11-03
start: fresh
travel: travel_to
---

# Mudfoot's Big Adventure

Implemented from the OSRS Wiki quest page and Transcript pages and the revision 242 cache. Not yet
played end to end in the client; the focused test (`server/tests/mudfoots-big-adventure.test.cjs`)
covers the stage varbit, spawns, drops, rewards and the Harlan equipment claim.

## Sources

Raw wikitext (`?action=raw`, fetched 2026-11-14), with sha256 of the bytes used:

| Page | sha256 |
| --- | --- |
| [Mudfoot's Big Adventure](https://oldschool.runescape.wiki/w/Mudfoot%27s_Big_Adventure) | `a70b82244129bba99651eb6aa398ae41b82f0723f6b75e820c9991805027348d` |
| [Transcript:Mudfoot's Big Adventure](https://oldschool.runescape.wiki/w/Transcript:Mudfoot%27s_Big_Adventure) | `c57aa4bc3af1a12b5dca7ed521809f5d94a45b24157f003f7df370eddf5a7429` |
| [Captain Harlan](https://oldschool.runescape.wiki/w/Captain_Harlan) | `be433a1f8546085609f3737ed2d7564a9a5475f72184058eb18161f159346258` |
| [Transcript:Captain Harlan](https://oldschool.runescape.wiki/w/Transcript:Captain_Harlan) | `9f7d63be75a999f7c64bad6b0f539219e85828609960f2847ce9c2a647a48a6b` |

No RSProx capture of this quest was available (the public search had no revision 242 entries for its
NPCs, varp or varbit), and Quest Helper has no module for it.

## Cache facts used

- Quest row 218 (`quest_mudfootsbigadventure`): free-to-play, Novice, 1 quest point, start NPC
  `captain_harlan` (16821), completion value 32.
- The stage is varbit `mba` (16779, bits 0-8 of varp `mba_primary` 6240). The same varp holds
  `captain_harlan_intro` (16780), `captain_harlan_met_mudfoot_early` (16783) and the weapon-giveaway
  flags `captain_harlan_bonus_melee/ranged/magic_giveaway` (16784/16786/16787).
- The cache's NPC transforms key the outlaws on `mba`: the ranger outlaw at the store shows at 6, at the
  windmill at 10-12, the mage at 14-18, the warrior at 20-24. The plugin's stages (1, 6, 10, 11, 13,
  14, 16, 19, 20, 22, 25, 26, 32) sit inside those windows. Values the cache does not pin are this
  server's choice.

## Findings

- **open** Mudfoot's own attacks are not simulated; he only talks. Live OSRS has him hit the outlaws.
- **open** The "Confront" cutscene at the store is played as dialogue, not as a scene.
- **open** The warrior outlaw does not use Protect from Melee, and Mudfoot's per-style overhead hints
  are not played (the Wiki transcript marks parts of these as missing).
- **open** NPC tiles come from the Wiki quest-map pins and are approximate.
- **open** The Wiki transcript is flagged incomplete (walking away, dismissing Mudfoot, confronting
  without him, the first claim line before the ranger is dead, the Defence cape purchase). Those lines
  are not invented, so "About that cape you're wearing..." is not offered.
- **open** The journal text is written from the Wiki walkthrough, not from a capture.

## Runs

None yet.
