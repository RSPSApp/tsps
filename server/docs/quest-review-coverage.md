# PR 715 quest review coverage

This follow-up reviewed the 32 original quests and all 23 F2P quests against Quest Helper
commit `06da90f982518a093f2fe1c9cfac5547fa7053d3`, the shipped transcripts, recorded
RSProx facts and cache `osrs-241_2026-10-20`. Quest Helper is the progression reference;
canonical recovery requires supporting Wiki/capture/item evidence.

**All 55 received source review. This is not exhaustive 1:1 certification.** The earlier
end-to-end runs and this adversarial source/regression pass are different evidence. The
earlier full playthroughs predate the cache refresh. This pass did not replay all 55 quests
or inspect a live Java Quest Helper overlay. A selector assertion, a real transcript
dispatch, an inventory transaction and a live playthrough each prove different things.

Use [the full quest review process](agents/quest-testing.md) for future work. The remaining
quests outside this set are tracked in [issue 728](https://github.com/RSPSApp/tsps/issues/728).

## Review groups and corrective coverage

The table identifies changes from the reliability follow-up, rather than repeating every
earlier PR change. Unchanged quests still received source review. Tests are under
`server/tests`; the `remaining-…-parity` and `qh-f2p-…-parity` suites cover their named groups.

| Quests reviewed | Corrective coverage in this pass |
| --- | --- |
| Sins of the Father; Children of the Sun | Canonical noble-disguise spare chest, scoped by id/tile/plane; partial capacity and bank/equipment ownership. |
| Beneath Cursed Sands; Contact! | Full urn Remove/Swap actions; completed Jex dialogue. |
| Current Affairs; Prying Times; Troubled Tortugans | Full-bag coupon rewards; lost reward duck; tortugan shield's actual cape equipment slot. |
| Defender of Varrock; The Giant Dwarf | Vermundi cannot consume excess coins before a full-bag clothes handover. Existing bottle recovery retained. |
| Haunted Mine; The Fremennik Exiles | Early crystal completion guard; Brundt/Lunar dialogue priority; V's shield reward overflow; recorded keg continuation through stage 65. |
| Land of the Goblins; The Path of Glouphrie | Lost/full-bag tribal keys; canonical singing-bowl seed/chime recovery. |
| Pandemonium; Crab Quest; Fallen from Grace | Coupon, repair kit and spyglass reward overflow; shell-collection recovery message only after delivery. |
| Perilous Moons; Temple of the Eye | Medium pouch reward overflow; no new Perilous Moons finding. |
| The Red Reef; Scrambled! | Theodore's own dialogue before the meeting; Zenith disembark branch; pet-egg capacity; interrupted finisher and post-quest King's men. |
| Royal Trouble; Throne of Miscellania | Premature Sigrid box conversation; canonical completed Ghrim, workers and guard pages. |
| Secrets of the North | Lost icy key; persisted native stage 52 after scroll hand-in. |
| Shades of Mort'ton; Spirits of the Elid; Tai Bwo Wannai Trio | Lost statuette's existing Genie trade; full-bag coin reward. |
| The Golem; Shadow of the Storm | Completed Curator releases other quests; Tanya's dropped sigil survives scene-area cleanup. |
| Shadows of Custodia; The Final Dawn | Eyatlalli's existing fragment handoff retries after full inventory or canonical destruction. |
| The Blood Moon Rises | Narrow completed Ivan greeting with explicit competing-quest checks; Efaritay tome reclaim retained. |
| Waterfall Quest | All item rewards survive zero/partial capacity; completed Hudon dialogue. |
| Cook's Assistant; Doric's Quest; Sheep Shearer; Imp Catcher | Capacity before promised starter tools; completed One Small Favour releases Fred. |
| Romeo & Juliet; Witch's Potion; Vampyre Slayer | Apothecary released outside Romeo's real potion window. |
| The Restless Ghost; Rune Mysteries; X Marks the Spot | Duke's reminder after talisman handover uses his existing standard page. |
| Black Knights' Fortress; Pirate's Treasure; Prince Ali Rescue | Sir Amik priority; coin reward overflow; One Small Favour releases Aggie outside its hand-ins. |
| Demon Slayer; Goblin Diplomacy; The Knight's Sword | Interrupted redberry pie handover resumes the recorded tail without requiring another pie. |
| Ernest the Chicken; Misthalin Mystery; The Corsair Curse | Suspected actor/capacity failures checked against real cache actions and transcript conditions; no speculative edits retained. |
| Below Ice Mountain; The Ides of Milk | Full 2,000-coin overflow; equipped cowbell amulet is owned. |
| Dragon Slayer I | Ned releases the Prince Ali wig request while preserving the actual on-ship voyage. |
| Shield of Arrav | Reldo/Tail and Curator/Golem priority, including release after Golem stages 4/10; early gang-contact regression retained. |

The shared QuestRuntime also delivers its single completion item through the existing
ground-reward overflow path when necessary. Stackable rewards merge; nonstackable extras
are delivered one at a time. This uses normal ground-item lifetime, not an invented bank,
pending-reward or recovery system. Quests with their own canonical pending/reclaim rules
retain those rules. Cross-quest stage queries use the `quest:get-stage` domain event.

## Findings rejected during review

Tests must reproduce a reachable interaction. Examples rejected here include the proposed
Defender/Demon shared-NPC conflict (impossible prerequisites), Frank's full-bag key loss
(consumed rum frees the slot), a premature Royal Trouble reward exploit (real transcript
conditions prevent it), and actionless Ernest/Misthalin actors assumed to expose Talk-to.
The Golem mushroom-without-vial change was reverted: the failure speech describes losing
the crushed contents, and no primary evidence established that the mushroom should survive.
Shadow's strange implement already has a global ground spawn. These were not product fixes.

## Remaining checks and known gaps

- Live Quest Helper overlay, every optional sidebar choice, every interruption point and
  every combination of competing quest stages remain unchecked. Earlier route completion
  does not cover these cases.
- Shield still needs a live two-player trade/death/relog recovery matrix, Curator duplicate
  half-certificate policy verification, and additional King Roald quest combinations.
- Dragon Slayer's north-to-south Crandor shortcut needs an isolated native retest without
  adjacent combat; every maze exit and map-loss route was not replayed in this pass.
- Corsair's lost ogre artefact recovery needs canonical evidence and a live loss/reclaim
  check. Misthalin's transformed Mandy has no shipped post-scene dialogue for stages 90–129.
- Children of the Sun's uncaptured post-quest dialogue and exact tailing look-back/LOS rules
  remain unresolved. Missing speech was not invented. Contact's Maisa and several Blood
  Moon shared NPC post-quest priorities still need canonical coverage. Theodore's completed
  conversation reuses his recorded dismissal; no dedicated post-quest transcript is supplied.
- Rune Mysteries' flat Duke page has an unrecorded "Have you any quests for me?" continuation.
  Demon Slayer's supplied pre-Shadow reclaim speech is incomplete. Some full-bag handouts
  can still display handover speech before a repeatable capacity failure.
- Live bank/equipment/relog combinations for every quest item and rewards lost after normal
  ground-item expiry were not exhaustively tested. The Path of Glouphrie lamp reissue policy
  and Ides' banked-amulet policy still need evidence.
- Exact scene cameras, uncaptured combat timing and the previously documented cache/helper
  marker differences remain outside a blanket parity claim.

Record a specific source, reproduction and expected result before changing these cases.
Keep the PR's latest test totals separate from this coverage ledger.
