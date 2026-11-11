# Weapon switching in combat

A Wield or Wear click on an inventory item while attacking keeps the attack running. The new
weapon swings on the first tick the old weapon's cooldown allows, with no new click on the
target (issue #4112: "ko" switches such as dragon knives to a Voidwaker special, or a maple
shortbow to a dragon dagger).

## Live behaviour

From rsprox captures (rsprox.net archive, revision 231, recording 00365, ticks 12594-12599):

| Tick | Client | Server |
| --- | --- | --- |
| 12594 | Wield a bow of faerdhinen, then Attack on a Canifis citizen | worn slot 3 becomes the bow |
| 12595 | nothing | the player fires (`human_bow`) |
| 12596 | Wield a Wolfbane dagger (`inventory:items` op 3), no other click | worn slot 3 becomes the dagger |
| 12599 | nothing | the player steps in and stabs (`stab_wolbanedagger`), before any hit on them |

The switch did not end the attack: the new weapon swung with no new click. The swing lands
four ticks after the bow's shot, the bow's cooldown, but the target's werewolf transformation
also completes on 12599, so this capture cannot tell the timer apart from the transform. Live
also stops facing the target on the Wield tick and stands for three ticks before stepping in;
the target's state changes in the same ticks, so that is not attributed to the Wield here, and
this server keeps facing and chasing at once. In the other mid-fight Wields in the archive (and in local
Chambers of Xeric captures, `cox_cm_3man_run1`/`run2`), the player clicks the target again within a few ticks, or
the target dies or turns immune (Vorkath's zombified spawn), so none of them contradicts this.

## The rule in this server

- osrs-docs (Entity Interactions, Interruptions) makes every inventory item interaction a hard
  interruption. A Wield/Wear still is one for everything except the attack: it cancels walk-to
  tasks and following, and still raises `player:interaction-cleared`, so repeated skilling such as
  an altar offering stops (PR #3979).
- The combat target, the attack timer and the selected special stay as they are, so the timer
  set by the last swing decides when the new weapon swings. Equipping still turns an active
  special off (`EquipPacketListener.resetWeapon`), so the special is pressed after the switch, as
  on live.
- Every other inventory action (Drop, Eat, Drink, Bury, ...) still ends the attack.

## Code

- `server/src/main/typescript/elvarg/net/NetworkBuilder.ts`, `inventoryAction`: the named
  Wield/Wear route calls `clearPendingAction(true)`.
- `server/src/main/typescript/elvarg/game/entity/impl/player/Player.ts`, `clearPendingAction`:
  `keepCombatTarget` skips `Combat.clearInteraction`.
- Tests: `server/tests/weapon-switch-combat.test.cjs`.
