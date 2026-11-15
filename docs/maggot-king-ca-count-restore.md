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

The existing native Maggot fixture contains checks for malformed
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
head or schedule is changed. The revised fixture passes in the later
exact-source execution below; the earlier failure's cause remains unknown.

The save probe round-trips the registered attribute JSON and applies the real
`PlayerSave` snapshot before dispatching registered login hooks. It does not
claim a disk or socket relog. The lethal hit and survival setting are supplied
checkpoints, not a natural full-fight or supply-acquisition proof. Existing
Camping results remain attributed to their original tested source and jobs.

The tested integration combines this bridge with captured main at
`dfd26b30550ea8c65f815c5a091418c23c45e83e`. It retains the two native Camping
cases, death and Cave reset assertions, and three callback-only Camping
controls merged through PR #5305.

The subsequent exact-source execution on
`c32764087f65259541376b2818fe3e42fea25169` completed with **135/135 passes**:
66 native encounter cases first, six setup/callback cases, 32 shared-poison,
21 Serpentine helm and ten poison-orb cases. Every group reported zero failures,
cancellations, skips and todos. Independent review accepted this exact
source/profile, all 5,797 actual input rows, the build, unchanged source/dist/
28-cache-file seals and the stated bounded process closure. The provider
terminal was COMPLETED/retry0; all 11 owned stage process groups had no leftovers.
This does not prove globally escaped/reparented descendants, Windows or client
rendering equivalence. The fresh passes do not rewrite the earlier failure or
its unknown cause, nor the old unexecuted 44de130 plan.

[The result and per-case rows](https://github.com/autismoyah-hub/tsps/blob/7c27b3c8db7217ce0afab254eca4873bccc12b0c/docs/evidence/maggot-king-ca-restore-after016-result.json),
[complete returned log](https://github.com/autismoyah-hub/tsps/blob/7c27b3c8db7217ce0afab254eca4873bccc12b0c/docs/evidence/maggot-king-ca-restore-after016.log)
and [exact executed JavaScript argument](https://github.com/autismoyah-hub/tsps/blob/7c27b3c8db7217ce0afab254eca4873bccc12b0c/docs/evidence/maggot-king-ca-restore-after016-command.cjs)
retain commands, actual outcomes and limits. Returned raw: 796,726 bytes,
SHA256 `79423e1c0962c0b362432b1ae84307f49553a709bd265219cae226bf2914bac6`.
These results apply to the exact tested c327 inputs, not a later main or a
materially different combined tree. This documentation-only follow-up preserves
all 5,797 tested build-input Gitblobs and modes. Final publication-base and public
readback checks remain separate; no whole-boss, conditional-achievement,
corpse/reward or generated-producer-chain completion is claimed.

## Sources

- [Maggot Squasher, revision 15282000](https://oldschool.runescape.wiki/w/Special:PermanentLink/15282000)
- [Maggot Exterminator, revision 15282002](https://oldschool.runescape.wiki/w/Special:PermanentLink/15282002)
- [Combat Achievements, revision 15372533](https://oldschool.runescape.wiki/w/Special:PermanentLink/15372533)

The shared plugin documents the content-owned restore query. General Wiki
retroactive-completion guidance has content-specific exceptions; this repair
uses the existing server contract for these plain kill-count tasks.

Refs #153
