# Giving up on a target you cannot reach

An actor in combat holds its target and stops doing anything else with it: it faces it, walks to
it and swings when `CombatRange.canReach` allows. Live OSRS ends that engagement when the actor
cannot get to its target at all - the reply is `I can't reach that!` and the interaction is
dropped, the same answer a frozen player gets for an object or NPC out of reach
([freezes.md](freezes.md), recording 2238).

## The bug

`Combat.postMovementProcess` holds the two give-up paths, and both are skippable:

```ts
if (targetMoved || state.mobilityBlocked || movement.didMoveThisCycle()) return;   // (1)
if (this.character.isNpc() && state.routeRequested &&
    !movement.wasBlockedByDynamicOccupancy()) { cancelIfCurrent(...); return; }    // (2)
if (movement.size() > 0) return;                                                   // (3)
if (this.character.isPlayer() && (state.routeRequested || movement.wasRouteEvaluated())) { ... }
```

- An actor that **cannot move** - stunned, `isNeedsPlacement()`, or a teleport in transit
  (`MovementQueue.setBlockMovement`, `TeleportHandler`) - sets `mobilityBlocked` and is returned by
  (1) every cycle. Only the frozen *player* had its own release, in `preMovementProcess`.
- A step the mover **rejects** keeps its checkpoint (`MovementQueue.process`, "checkpoint retained"),
  so `movement.size()` never drops to 0 and (3) returns before the player's release. A pursuit
  blocked by another entity is exempted at (2) by design, and stays exempt for as long as the
  blocker stays.

Either way the actor stays in combat with a target it can never hit, for as long as the fight
lasts: `CombatFactory.inCombat` stays true, which holds teleports ("You can't use this spell
during combat."), emotes, shops, `::setlevel` and `NpcAggression` for that player; the NPC never
releases either, so it never sleeps (`DormantNpcs`) and stays in the active-region set
(`World.markNpcCombatActive`).

## The rule

`Combat.giveUpUnreachableTarget` (players only since #6297, see Safespots below) runs in `preMovementProcess` on every cycle spent out of reach and
counts the cycles in which the actor **got nowhere**: it closed no distance *and* took no step.
Either one is progress. Closing the gap counts whoever closes it, so a fighter walking its target
down, or being walked down, keeps its interaction; so does a step the mover actually accepted,
which is the only thing that tells a chase from a stall - a target walked away at the same speed
holds the gap open forever on an open route, and live keeps following. What spends the budget is
being frozen in place, or having the step refused: how an engagement stuck behind a wall or a crowd
finally ends.

The step is read with `MovementQueue.didMovePreviousCycle()`, not `didMoveThisCycle()`:
`preMovementProcess` runs after `beginCycle()` has already cleared this cycle's flag (`NPC.process`,
`Player.process`), so the step in question is the last cycle's.

At 20 cycles (10 s) the engagement is dropped: a player is told `I can't reach that!` and both
sides `reset()` as any other give-up does. Player bots are not messaged, matching the existing
release.

The player's pre-existing release still fires first, so a normal "attack something behind a fence"
click is refused on the spot rather than after the deadline: a player with no route is released in
its first cycle. The deadline bounds what that release can't see - a pursuit blocked by another
*entity*, invisible to the pathfinder, which keeps its checkpoint so the queue never empties. NPCs
have neither release since #6297 (Safespots, below).

## Safespots (#1952, #6297)

Neither release applies to an NPC any more. An NPC whose step the map refuses, or that gets
nowhere for 20 cycles, keeps its target and keeps facing it and trying its step: only the
aggression range lets it go (`Combat.shouldRetreat`), the target standing more than max range +
attack range from the NPC's spawn (Wiki: Aggressiveness, Retreat). #1952 had kept the target
only while it was fighting the NPC (its combat target was the NPC, or it hit it within the PJ
window), so a player stepping into a safespot, eating or switching for more than 8 ticks reset
the NPC; #6297 drops that condition. The 20-cycle deadline is the player's alone.

Two things that made the reset costly changed with it:

- **Hitpoints regenerate 1 per regen interval** (`NPC.process`, 100 ticks unless content sets
  `setStatRestoreTicks`), on a clock that runs whatever the NPC is doing. The old rule healed 10%
  of max hitpoints *every tick* while it walked home, and every tick once 20 s passed without
  damage, so a reset NPC was back to full in 6 s. The Wiki's measured rates (User:Orion/Regen,
  via Monster Examine) give each NPC the same hitpoint and stat rate, 100 ticks unless listed;
  the Monster page: "All monsters will recover hitpoints fairly slowly".
- **An NPC walking home after its fight (`AWAY`) fights back** when attacked
  (`CombatFactory` retaliation, `NPCMovementCoordinator.updateCoordinator`); it used to turn that
  into a retreat and ignore hits until it reached its spawn. A real retreat (`RETREATING`, the
  target out of range) is still walked out.

`tests/safespot-combat.test.cjs` runs these on the real map with a walk-only wall (projectiles
pass), plus the player side of #1952: a spell cast by hand with an autocast spell remembered but
no staff (Entrana, the Tree spirit) cast once and then fell back to melee, which walked the player
round the obstacle. `Autocasting.isActive` (a spell and a staff) decides whether combat carries on
after a cast.

## Sources

Dropping an interaction that cannot be reached, answered with `I can't reach that!`, is the rule
this server already follows for both players and interactions: [freezes.md](freezes.md) (rsprox
recording 2238 - a frozen player's far clicks get the reply "and are dropped, not queued"),
[sea-charting.md](sea-charting.md) (rsprox 3455 - a loc used from a deck but out of reach "no
longer lets go of the helm: live answers 'I can't reach that!' and nothing else") and
[loc-teleports.md](loc-teleports.md). The deadline extends that same rule to the two states where
the existing releases could not run; it introduces no new message.

## Validation

- `node --test server/tests/unreachable-combat.test.cjs` (after `yarn build`): eight tests on a
  real cache NPC and player, ticked in World order, with reach, routing and the mover all live -
  nothing is mocked but the cycle clock, and no actor is teleported to make a point. Three fail
  without the deadline: a `setBlockMovement` player and a `setBlockMovement` npc, each 18 tiles
  from a target neither can approach, keep their target (and `CombatFactory.inCombat`)
  indefinitely; and an npc with a real actor registered in World on the tile it must step onto -
  the mover refuses the step and keeps its checkpoint, which is what a crowd actually looks like
  to a pursuit - hunts forever. One fails if progress is measured by distance alone: mugger 8
  tiles behind a player that walks south a tile every cycle, so the gap never closes; the npc
  steps on all 25 cycles and keeps the fight. The rest pin down what must *not* change: a fighter
  still closing the gap keeps its target, an immobile actor keeps a target that comes to them, a
  fight in reach is never dropped, and a player with no route is refused on the first cycle.
  The harness unregisters each scene's actors afterwards: a `isRegistered` npc that moved leaves a
  tile occupant behind, and to the next scene's pursuer that is a wall.
- Own-worktree agent MCP (`AGENT_MCP=1 yarn dev`, port 49700), run against the distance-only
  version of the rule: aggroed a white wolf at Edgeville and stood inside its footprint - both
  sides land hits, the fight ends normally; teleported 25 tiles from a grizzly bear mid-chase - the
  bear walks back to its post and drops the target and the player is not left in combat. Its third
  note - fighting a bear at the Gnome Stronghold pen, then walking 25 tiles away until combat and
  `busy` cleared and logout was accepted - was the bug, not the expected result: a target walking
  away at the same speed now keeps the chase, bounded by the aggression range
  (`Combat.shouldRetreat`; `combat:no-retreat` opts out), so that check wants re-running against
  the step-aware rule before it is quoted again.
- `yarn build` clean, and the full server suite: 9,835 tests, 9,834 pass. The single failure is
  pre-existing and unrelated: `tests/league-combat-masteries.test.cjs:15` requires
  `../dist/game/entity/impl/npc/Npc` while tsc emits `NPC.js`, so the file cannot load on a
  case-sensitive filesystem. It fails identically at HEAD, before any combat code runs.

## Not changed

- **The logout gate is separate and still hit-based.** `Player.inLogoutCombat` refuses with "You
  can't log out until 10 seconds after the end of combat." only while a hit landed within 16
  cycles (`Player.LOGOUT_COMBAT_TICKS`), and a hit requires `CombatRange.canReach` at the moment the
  attack is launched. Nothing in this change alters that: an NPC that genuinely can hit you still
  holds you out of logging out, as live does. So a report of *that* message repeating forever means
  hits are landing from somewhere - a spot where the reach check passes (an open shared edge or
  projectile line in the clipping) although the NPC cannot walk there, which is a map/clipping
  question with its own fix, not this one.
- `combat:close-in` NPCs still walk in while attacking from range, and `processNpcUnderTarget`
  still shuffles an overlapped NPC aside.
- **What a step now buys.** An actor that keeps taking steps it was allowed to take, yet never
  closes the gap, is no longer released at 20 cycles - that is the correction, and it is what a
  chase looks like to the mover. The pursuit still ends by itself: an NPC outside its aggression
  range from its spawn loses the target and walks home (`Combat.shouldRetreat`; `combat:no-retreat`
  opts out), an overlapped NPC whose target is walking away does not shuffle at all
  (`processNpcUnderTarget` returns on `targetBusy`, so no step is taken and the budget runs out),
  and a player who stops walking is released by the pre-existing paths the moment the queue
  empties. What the deadline is left to end is an actor that gets nowhere: frozen, stunned, in
  transit, or wedged.
- The 20-cycle budget is a safety net for the states above. The ordinary unreachable-target release
  happens in one or two cycles, as before.
