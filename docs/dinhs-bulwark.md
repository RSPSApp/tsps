# Dinh's bulwark: Shield Bash

The special attack in `server/plugins/combat/specials/DinhsBulwark.SpecialAttack.js`. No packet
capture shows the bulwark's special (the one recording with the item records no player action
on it), so everything here is from the
[Dinh's bulwark](https://oldschool.runescape.wiki/w/Dinh%27s_bulwark) Wiki page.

## What Shield Bash does

- Costs 50% special attack energy, rolls +20% accuracy using the weapon's **crush** attack
  bonuses against the target's **crush** defence.
- In multicombat it strikes up to **ten targets within five tiles** of the player (an 11x11
  square centred on the player), players and monsters alike. The primary target is hit twice and
  every other target once.
- In single combat the double hit and the multi-target effect do not happen: one hit, one target.
- Each target that takes a successful hit has its highest offensive stat lowered by 5%,
  once per target; only the first hitsplat decides it, so the primary's doubled hit never drains
  on its own (a miss then a hit does not drain). Ties resolve Attack and
  Strength, then Ranged, then Magic. Monsters are drained as well as players (the Wiki mentions only monsters; players kept the old drain).
- It counts as a melee attack against every affected target.

## How it is built

- The area is the generic `surrounding` special-attack targeting (`SpecialAttackTargeting.ts`)
  with a `radius` (default 1, the Dragon 2h sword's Powerstab ring; Shield Bash uses 5). Targets
  are measured from the player to the edge of each target's footprint.
- The double hit is a `hitAmount: 2` on the primary target's pending hit, only when the player
  and the primary stand in multicombat. Other targets get the ordinary single hit. A fixed
  `hitCount` trait would double every target's hit, so the trait is not used.
- One pending hit holds both of the primary's splats, so the drain runs once per target, decided from the first splat.

## Not covered

- How the Wiki compares offensive stats for the "highest" choice is not stated. The existing
  rule is kept: Attack plus Strength against Ranged against Magic.
- The Wiki's Pummel/Block stance passives (strength bonus scaling with defence, 20% damage
  reduction in the defensive stance, the 8-tick switch delays and shield animation) are a
  different mechanic and are not changed here.
