# Elemental tomes: complete item and casting integration

User authorization covers autonomous planning, implementation, fork publication and safe local
installation. No approval question is needed. Use the shared coordination board and own worktree
tsps-feat-elemental-tomes/feat/elemental-tomes, slot46 (3146/43746/49846).
PR975 is merged; the branch contains only the owned published PR977 prerequisite while it is open.

## Required behavior

- Fire, Water and Earth tomes use per-item charge/page metadata, not per-player charges.
  Twenty charges/page,1,000 pages/20,000 charges capacity. Correct cache variants and
  unnoted burnt/searing, soaked and soiled pages only. Missing/invalid metadata provides
  zero charges. Inventory/bank transfers, cloning and relog retain state independently.
- Add/Check/Pages/remove and bank Configure-Charges work through native item operations.
  Never mix burnt/searing pages; return floor(charges/20) whole pages and discard the
  partially used page on removal. Resolve exact bank/page UI behavior from primary
  evidence/cache before inventing an amount-input contract.
- An equipped charged tome supplies its elemental rune to every spellbook without
  charging unrelated combat/noncombat spells. Only matching five standard elemental
  families consume one charge/cast and gain their bonus, including splashes. Water
  also charges/boosts the six stat curses and Bind/Snare/Entangle, excluding Tele Block.
- NPC matching damage10%; PvP Fire50%, Water20%, Earth10%. Water accuracy10% NPC/20% PvP
  for damaging water spells per current Wiki; curses20%. Record the older calculator's
  conflicting Water20%/TODO rather than silently treating it as exact current evidence.
- Tome damage follows equipment and elemental weakness. Searing minimum is10% of the
  pre-tome maximum, including preceding bonuses; it is a true damage-roll lower bound.
- Water stat-curse strength is50% higher, through an explicit pre-application stage.
- A last charge still benefits its paid cast. A later preview, gear swap, another spell
  or projectile impact cannot spend a charge again, borrow an expired bonus or alter
  another cast's snapshot. Rune-saving staves do not cause duplicate charge decisions.

## Design and ownership

1. Root owns generic casting/combat foundations and combat policy: a per-paid-cast generic
   context with namespaced plugin data, explicit target-aware magic hit bounds and final
   stages, PendingHit's preserved context and utility impact forwarding. Validate actual
   target/cooldown/resources before committing. Context is runtime-only, never persisted.
2. Root owns ElementalTomes.plugin.js registration, Combat.ElementalTomes.js, page UI and
   bank handlers after evidence review, combat/lifecycle tests, integration and publication.
3. A fresh subagent (subagent-driven-development skill) owns only
   plugins/items/elementaltomes/Common.ElementalTomes.js,
   State.ElementalTomes.js and tests/elemental-tome-state.test.cjs. It is not alone and
   must not edit root's core/combat/UI files, other worktrees or shared coordination.
   Contract: Common.initialize(api), getDefinition(itemId), getEquipped(player), read(item),
   set(item,definition,charges,pageId), refresh(player), plus core getter and metadata/capacity
   constants. Definition has element, name, rune, chargedId, emptyId, pageId, optional
   specialPageId. Both Fire page kinds retain chargedId20714; ID27358 has no Check/Pages
   controls and is excluded from ordinary tomes. getEquipped returns {item,definition,state} or null;
   state is {charges,pageId}. Common uses api.core only and excludes notes/placeholders.
4. Review each owned task for spec and code quality, then final whole-branch review.
   Keep gameplay in plugins; core receives generic context/stage/bounds foundations only.
   No generated data, client, Claude Zalcano/Guardians/clues or Farming edits.

## Evidence and validation

Primary Wiki pages and pinned original Wiki calculator are retained outside the repository
in root .runtime/elemental-tome-research and elemental-weakness-research. Use RSProx where
it supplies relevant ordinary item actions; do not infer actions from bank displays alone.

- TDD state cases: capacity, wrong/noted pages, partial-page loss, metadata validation,
  charged/searing/empty transitions, clone and serialization independence.
- TDD real cast cases: all15 matching spells, wrong books/element/unequipped/zero charges,
  free rune provision, exact per-cast payment/splashes/cooldown/rune-saving, last charge,
  preview immutability, late impact/gear/spell changes and independent owners/books.
- TDD math: additive weakness first, final tome scaling, correct PvP targets, Water roll
  stage, searing uniform bounds, curse enhancement and missing/invalid context safety.
- Build/focused checks, independent task/final review, native existing staging harness,
  final combined suite once QA is stopped. Push source checkpoints before usage expires.
- Individual ready PR (not draft), attach it; selectively integrate only owned commits
  onto latest installed80dbc50b3 lineage. Fresh board/baseline, clean save/SQLite backup,
  ff-only/server build/restart, health/account/client hash proof and release claims.

## Rulings / evidence limits

The scope includes all three tomes and complete charge/cast integration; do not substitute
only a damage multiplier. Current binding damage disagreement (Snare2 versus3) remains an
independent audit and is not generalized by this implementation. Exact cosmetic messages
or undocumented bank granularity must be identified as unverified when primary evidence is
insufficient; no made-up RNG/timing or generated-data overrides are acceptable.
