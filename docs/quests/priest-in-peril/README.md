---
quest: Priest in Peril
key: priest_in_peril
status: passed-with-issues
tested: 2026-11-01
tester: agent
model: claude-opus-5-5
commit: 2b3988c563db
cache: osrs-241_2026-10-20
start: fresh
travel: travel_to
---

# Priest in Peril

A fresh account completed the quest by the Quest Helper route, watched in a client. The
mausoleum half (monuments, key swap, well, cell gate, blessing, coffin) did not exist before
this run and was added from the Wiki transcripts. Varp 302 now carries live OSRS's values,
and the run checked them after every step. Open findings are small deviations; one fix (Drezel's
first-blessing lines) is covered by tests but was not replayed in-game.

## Findings

Newest first.

- **fixed** Both mausoleum trapdoors climbed straight down on Open, and the church one
  (3432) landed at 3422,9885. The quest no longer claims them: LocTeleports plays the
  captured Open/Close swaps (`loc-swaps.json`), the church Climb-down to 3440,9887 and the
  mausoleum ladder. The quest keeps only the open north trapdoor's (1581) Climb-down,
  which the capture sync left to it ("You climb down through the trapdoor...", 3405,9906;
  rsprox.net #365, #4288). The captures show no confirmation prompt; Quest Helper's "Yes."
  is out of date. Fixed in #1817.
- **fixed** Varp 302 moved to 2 when the Mysterious Voice conversation started, so turning
  the voice away also counted as agreeing. It now moves once the player continues past "Then please, deal
  with that dog for me.". Fixed in #1817.
- **fixed** Drezel skipped his "It's as I feared..." lines on the first blessing: the
  blessing was marked done at the message just before the "First time blessing water"
  condition. Fixed in #1817 (tests only; not replayed in-game).
- **fixed** No golden key: the plugin's grant was removed, and the generated
  `monk_of_zamorak_paterdomus` row is a 1/1 tertiary with no quest condition, which NpcDrops
  skips. The hooded level 30 monk (3486/16273) now drops it on the ground from the King's
  warning until the coffin is sealed. Fixed in #1817.
- **fixed** The mausoleum half was missing, so the quest could only be finished through a
  Drezel shortcut. Monuments had no Study/Take-from/item use, there was no golden-to-iron
  key swap, the well, cell gate and coffin had no handlers, and talking to Drezel with the
  golden key handed out blessed water. Reported in #1811 ("No monument contains a key"). Fixed in #1817.
- **fixed** Varp 302 was sent as 3/3/4/5/8/61 for the plugin's 10-60 stages, so the world
  Temple Guardian (3487, shown at 0-2) was hidden and a private copy was spawned. The wire
  now follows Quest Helper: 1, 2, 3, 4, 5, 6, 7, 8, 10-59 (60 minus the essence still owed),
  61. Old saves keep their meaning (an old 50 maps to 8). Fixed in #1817.
- **fixed** Any monk kill put a golden key in the inventory, and an unreachable monk
  "Talk-to" hook handed one out. Removed in #1817.
- **open** The mausoleum's south gate (3444) opens without the golden key; the Wiki says it
  needs it. Not tested here: the account carried the key.
- **open** The Wiki contradicts itself on the key monument: the Iron key page says south, but the
  infobox and all six golden item pages put the key on the north-east monument (3497). This
  plugin follows the six item pages.
- **open (data)** `monk_of_zamorak_paterdomus` is shared by all six monk ids (17/22/30) and its golden-key row
  carries no quest condition. Needs an osrsreboxed-db dumper fix.
- **open (travel_to)** The temple staircase is 61190 here, 16671 in the live data (found by name),
  and the down staircase lands at 3416,3493 instead of the live tile.

## Runs

Newest first. A rerun adds an entry; it never rewrites an older one.

### 2026-11-01 (follow-up) · agent · claude-opus-5-5

- **Start:** the same server build with the trapdoor and knock fixes. Tester (quest complete)
  for the trapdoors; a fresh headless account for the knock, placed beside King Roald with
  `::tele` and started there (302: 0 → 1).
- **Route:** knock > "Hi, I just moved in next door." (loops back to the menu) > "More..." >
  "Nothing. Never mind.": 302 stayed 1. Knock > "King Roald sent me to check on Drezel.": 1 at
  "Then please, deal with that dog for me.", 2 at the player's "Hmm...". A third knock played
  "Have you dealt with that dog yet?". North trapdoor: Open ("The trapdoor opens...", 1579 →
  1581), Close ("You close the trapdoor.", → 1579), Open, Climb-down ("You climb down through
  the trapdoor...", 3405,9906). Mausoleum ladder up to 3405,3506. Church trapdoor: Open (3432 →
  3433, no message), Close, Open, Climb-down to 3440,9887.
- **Result:** all match the rsprox.net captures.
- **Not checked:** the trapdoors before the quest; the swap sounds by ear.

### 2026-11-01 · agent · claude-opus-5-5

- **Start:** fresh account Tester (varp 302 = 0, quest points 0, all skills 99, Prayer
  13,034,431 XP, Torva and Ghrazi rapier worn). Declared setup: a bucket, 26 rune essence
  and 3 Varrock teleport tablets. Placed beside King Roald with `::tele` (the only
  teleport). Run on the branch's quest code over `2b3988c56`; the user watched in a client.
  The Quest Helper bridge was not running, so the route followed the pinned
  `PriestInPeril.java` (06da90f9).
- **Route:** King Roald > "I'm looking for a quest!" > "Yes, I think I've heard of it." >
  "Yes." > "I'll get going." (302: 0 → 1). `travel_to` to the temple (palace door, Varrock
  east gate); knocked on the large door > "King Roald sent me to check on Drezel." (→ 2).
  North trapdoor Open by hand (`travel_to` blocked, see findings); the world Temple Guardian
  (7620) was killed in melee and "There we go, one dead dog." played (→ 3). Ladder up, Varrock
  teleport tablet, King Roald > "About that job I'm doing..." (→ 4). Back to the temple
  (large door now opens). **Server restarted here** to load the golden-key drop fix; the stage held at 4
  after the relog. Killed the hooded level 30 monk: Golden key on the ground with bones
  (dropped one essence to pick it up). Stairs and ladder to Drezel > "What do we do?" (→ 5).
  Golden key on the cell gate ("does not fit" + the player's line); Open: "The gate is
  securely locked."; coffin Open: "something alive inside". Down the trapdoor, through gate
  3444; monument Study (statement box), Take-from ("You try to take the hammer ... holy
  power stops you!"), golden key on the north-east monument (item box "You swap your Golden key for the
  iron key."), bucket on the well ("You fill the bucket from the well." → murky water). Up
  to the cell; Open with the iron key: "You use the key to unlock the cell gate.", the player
  steps in, Drezel blesses the water (→ 6). Out of the cell; blessed water on the coffin:
  "You pour the blessed water over the coffin..." (→ 7, empty bucket back); coffin Open now
  gives the rsprox.net #365 line. Drezel: "meet me down in the mausoleum" (→ 8). Trapdoor,
  gates 3444 and 3445 to Drezel: "repairing the barrier" (→ 10). The Holy barrier played Drezel's
  "Stop!". 25 essence handed in (→ 35, "I need 25 more."); a noted essence got the
  "notes" reply. Disclosed supplemental aid: 25 + 1 more rune essence spawned (one did not
  fit the first time; → 59, then the last hand-in).
- **Result:** varp 302 → 61, quest points (varp 101) 0 → 1, Prayer 13,034,431 → 13,035,837
  (+1,406; no other Prayer XP during the route), one Wolfbane dagger. Drezel's full
  closing conversation played. Repeat talks: Drezel goes to Nature Spirit's conversation,
  King Roald plays "About that job you gave me..."; no duplicate rewards. The Holy barrier
  now passes ("You pass through the holy barrier."). Relog: varp 302 61, QP 1, Prayer XP
  and the dagger unchanged.
- **Not checked:** Drezel's first-blessing lines in-game (fixed after the run, covered by
  `tests/priest-in-peril.test.cjs`). The 1 damage from Take-from (the account took no
  damage in any fight, so it is probably invulnerable). The souvenir swaps in-game (tests only). Guardian
  magic immunity, the pre-quest guardian and door. Losing and reclaiming the keys or the water. The
  offline save outside the relog. The Quest Helper overlay.
