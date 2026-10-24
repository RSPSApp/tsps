# Standard binding spell repair plan

User authorization permits inline planning/implementation, publication and selective local
installation. Work only in fix/standard-binding-spells, slot48 (3148/43748/49848).
The branch carries the owned published #977/#981 prerequisites; do not duplicate their replies.

## Required behavior and design

- Declare canonical base damage in CombatSpells: Bind0, Snare2, Entangle5. Preserve existing
  levels, hit delays, XP and graphics. Snare is free-to-play and requires four Water,
  four Earth and three Nature runes per its current individual Wiki page. Bind and
  Entangle rune costs and Entangle's members flag remain unchanged. Explicit zero remains zero.
- Move standard binding effects into a named plugin using existing generic utility-impact
  events. Accurate impacts freeze for8/16/24 ticks, with five immunity ticks after the hold.
  Keep generic NPC size/opt-in immunity and movement interruption in CombatFactory.freezeTicks.
- Swampbark helm/body/legs each add2 ticks, to maxima14/22/30. Gloves/boots do not contribute.
  Snapshot the duration on the existing paid-cast context so gear changes during flight
  cannot add/remove the launched spell's bonus. No mutation in previews/formulas.
- Refuse a selected standard binding cast before resource payment while the actual target
  is already frozen or in freeze immunity. Do not block unrelated spells or overwrite
  other eligibility refusals. An intervening freeze before impact cannot refresh its timer.
- Tests use real Player/NPC, cache items, timers, Spell.canCast, MagicCombatMethod and hits.
  Prove damage bounds, exact duration/immunity boundaries, armor snapshot/swap, refused
  rune/tome charge conservation, splash exclusion, existing immunity/other-spell controls.

## Evidence and rulings

Primary sources: current individual OSRS Wiki Bind, Snare, Entangle and Swampbark armour
pages. Saved under root .runtime/binding-spell-research. The current individual Snare
infobox gives2; the older generic table/calculator gives3. Ruling: follow the current
specific page (source precedence), disclose conflict, do not claim capture-exact damage.
No other private-server implementation is a behavior source.

The actual rsps.app progress JSON was fetched from its public extension endpoint. It calls
normal DT2 encounters functional but retains provisional balance values and marks Magic
done; those labels are not proof of binding correctness. This fixes independently
reproduced shared behavior and does not declare all boss timing/RNG complete.

Exact fade-warning timing and general freeze escape/owner-distance policy require separate
source verification; do not invent them or broadly alter all freeze callers here.

## Execution and gates

1. TDD the canonical maxima and real damage roll, then explicit metadata fix.
2. TDD plugin hold ticks/armor receipts/refusals/impact controls, then implement plugin and
   remove the three legacy seconds-based effect bodies. Inline execution, one fresh final review.
3. Build and focused compatibility tests (curses, tomes, magic XP, hit queue and freeze UI).
4. Independent final review, native own-port checks through existing staging harness,
   source push and ready individual PR. No generated JSON/client/MTA/Farming changes.
5. Selectively cherry-pick only new owned commits onto installedc87e2c560 lineage; final
   combined full suite with QA stopped; backup/ff-only/server build/restart, prove all
   account rows and served client hashes retained. Keep broad goal active afterward.
