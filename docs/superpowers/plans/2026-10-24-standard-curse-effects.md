# Standard curse impact repair

Planning and implementation are authorized inline; no further approval question is needed.

## Problem and scope

The six standard stat-draining spells retain player-only implementations in
CombatSpells.ts; NPC paths are absent or commented out. Restore their NPC behavior
through the same real level/restoration system used by other combat drains, while moving
the existing player behavior into plugin policy. This is a prerequisite discovered during
the elemental tome audit; it does not claim tome charging or bonuses are implemented.

Primary references: OSRS Wiki Confuse, Weaken, Curse, Vulnerability, Enfeeble and Stun.
Confuse/Weaken/Curse reduce Attack/Strength/Defence by5%; Stun/Enfeeble/Vulnerability
reduce the respective level by10%. Vulnerability explicitly cannot stack while the
target's relevant level is already lowered. Preserve the existing floor-of-drain/current
level rounding rather than inventing a different unmeasured boundary rule.

## Design

- Own branch fix/standard-curse-effects, worktree tsps-fix-elemental-tome-parity/slot44.
- Generic utility-spell impact custom event contains attacker, target, actual spell,
  allowed and handled. Dispatch at CombatEffectSpell.spellEffect, preserving accurate-only
  finishCast and existing fallback for unrelated effect spells. Respect prior veto/handling.
- Standard Curses plugin maps the six canonical CombatSpells objects to skill and rate.
  Remove their old duplicated core effect bodies; retain spellbook, cost, XP, graphics,
  accuracy and members metadata. Gameplay policy remains in plugins via api.core.
- Apply only the relevant stat; refuse already-lowered relevant levels, preserve boosts
  in other stats, and use NPC.setCurrentLevels so existing stat-drain immunity and natural
  restoration continue to govern the result. Keep existing player update/message behavior.
- The six non-damaging curses explicitly declare zero maximum; the generic formula must
  distinguish this from an unspecified negative sentinel, which previously fell back to1.
  Preserve other utility spells' legacy behavior pending their separate damage audit.
- No generated data, Claude/client/clues/Guardians or Farming edits. No live operation
  until reviewed source/combined checks, native packets and final full suite succeed.

## Verification and delivery

1. Real Player/NPC regressions fail first on all six missing NPC drains. Cover exact player
   equivalence, misses, no stacking, unrelated stats, boosts, immunity and restoration.
2. Implement generic dispatch/plugin policy and remove legacy bodies using TypeScript AST
   boundaries; ensure unrelated binding and Tele Block fallback behavior remains intact.
3. Fresh build/focused checks, independent review, push source and open a ready individual PR.
4. Extend existing native staging harness for actual curse casts; verify real NPC level
   changes and normal boss behavior without changing player accounts or production data.
   Existing encounter immunity is separately covered through the real NPC setter regression.
5. Selective local integration atop latest installed038d0ca24 lineage, final full suite,
   safe backup/server-only installation and account/client preservation proof. Publish exact
   limitations; keep elemental tome audit queued for its own complete follow-up.
