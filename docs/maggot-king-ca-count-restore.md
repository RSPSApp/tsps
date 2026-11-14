# Maggot King kill-count restoration

The Maggot King plugin retains a lifetime kill count in `maggot-king:kills`.
The shared Combat Achievements system separately retains its count by monster
name. A character with an older local count ahead of the shared count needs the
existing login restore query to report that local count.

`Recovery.MaggotKing.js` answers `combat-achievements:kill-count` for `Maggot King`.
It reads a positive safe integer from a number or numeric string. Other values,
including booleans, arrays, objects, fractions and non-finite numbers, contribute
no answer. The query does not repair the saved value, increment a kill, send a
message or award a task directly.

The existing shared restore path takes the greater count and silently checks
Maggot Squasher (one kill) and Maggot Exterminator (25 kills). Existing task bits
prevent repeated points or completion events. No `exact` override is supplied:
a shared count already ahead stays ahead, and the local count is not written
back. A pre-existing difference between that higher shared count and the local
kill-count announcement remains separate.

The ordinary native death handlers and their messages remain unchanged. After
local-ahead catch-up, one owned death should add one to each existing counter.
This does not implement the conditional Maggot achievements, change Camping
the King, or complete the deferred corpse/reward chain.

## Verification status

The existing native Maggot fixture now contains proposed checks for malformed
query coercions, registered `PlayerSave` attribute serialization/loading and
login restoration, 1/25 thresholds, max merge and repeated-restore idempotence.
It also includes a supplied lethal `PendingHit` through the real owned
`NPCDeathTask` path after a local-24/shared-0 catch-up.

At source `1d8aaecb8bf3bd6d0c74c266e45e668428370c31`, AFTER003 job
`6af82b2423985fb9cd81cbc7` observed all three new bridge cases passing. The
native suite finished **63 PASS / 1 FAIL**: an existing twin-crush control did
not reach its joint melee-phase precondition. The remaining 66 planned tests
were unexecuted after that first-suite failure. The job is closed with ERROR;
these results do not make the bridge Ready.

The twin-crush fixture now starts its existing selected `Math.random => 0.5`
input before either native entry constructs a `Fight`. Each constructor draws
an independent 4–8 attack count; previously this input selection began only
after waiting for both rotations to overlap in melee. Real entry, World tasks,
the joint 75-turn boundary, first/second splat and defence-roll assertions,
other-actor negative control, and cleanup remain intact. No production phase,
head or schedule is changed. This revised fixture is **unexecuted pending
normal source/input/native review**; the earlier failure's cause is not proven.

The save probe round-trips the registered attribute JSON and applies the real
`PlayerSave` snapshot before dispatching registered login hooks. It does not
claim a disk or socket relog. The lethal hit and survival setting are supplied
checkpoints, not a natural full-fight or supply-acquisition proof. Existing
Camping results remain attributed to their original tested source and jobs.

The current integration candidate combines this bridge with main at
`dfd26b30550ea8c65f815c5a091418c23c45e83e`. It retains the two native Camping
cases, their death and Cave reset assertions, and three callback-only Camping
controls already merged through PR #5305. The planned fresh matrix is now
66 native encounter cases, six setup/callback cases, 32 shared-poison cases,
21 Serpentine helm cases and ten poison-orb cases: 135 in total. These are
planned counts, not observed results. This integrated source remains untested;
neither the old 130-case plan nor earlier Camping results verify it.

## Sources

- [Maggot Squasher, revision 15282000](https://oldschool.runescape.wiki/w/Special:PermanentLink/15282000)
- [Maggot Exterminator, revision 15282002](https://oldschool.runescape.wiki/w/Special:PermanentLink/15282002)
- [Combat Achievements, revision 15372533](https://oldschool.runescape.wiki/w/Special:PermanentLink/15372533)

The shared plugin documents the content-owned restore query. General Wiki
retroactive-completion guidance has content-specific exceptions; this repair
uses the existing server contract for these plain kill-count tasks.

Refs #153
