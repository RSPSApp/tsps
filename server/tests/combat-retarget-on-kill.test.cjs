// Run after `yarn build`: node --test tests/combat-retarget-on-kill.test.cjs
//
// Live rule (Wiki PJ timer): a monster holds single-way protection for 8 ticks while it
// attacks, and that protection ends the moment it dies. So a player who lands the killing
// blow may start a fight with another NPC on the same tick, while the corpse still plays its
// death animation, and another aggressive NPC may attack them immediately. Death must clear
// both things the single-combat gate reads on the attacker side: the dead NPC as the
// player's last attacker, and any hit it still had in the air.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { Combat } = require("../dist/game/content/combat/Combat");
const { HitQueue } = require("../dist/game/content/combat/hit/HitQueue");
const { CombatFactory, CanAttackResponse } = require("../dist/game/content/combat/CombatFactory");
const { Location } = require("../dist/game/model/Location");
const { World } = require("../dist/game/World");
const { NPC } = require("../dist/game/entity/impl/npc/NPC");
const { TaskManager } = require("../dist/game/task/TaskManager");

/** A mobile in Lumbridge (single combat) with a real Combat and a message log. */
function mobile(kind, name, hitpoints = 10) {
  const messages = [];
  const self = {
    messages,
    hitpoints,
    isPlayer: () => kind === "player",
    isNpc: () => kind === "npc",
    getAsPlayer: () => self,
    getAsNpc: () => self,
    isMultiCombat: () => false,
    getOwner: () => null,
    getUsername: () => name,
    getDisplayName: () => name,
    getDueling: () => null,
    getArea: () => null,
    getPrivateArea: () => null,
    getLocation: () => new Location(3222, 3218, 0),
    getHitpoints: () => self.hitpoints,
    setHitpoints: (hp) => { self.hitpoints = hp; return self; },
    getIndex: () => 0,
    isSpecialActivated: () => false,
    getTimers: () => ({ has: () => false }),
    isScriptedMovement: () => false,
    setFollowing() {},
    sendMessage: (message) => messages.push(message),
    getMovementQueue: () => ({ reset() {} }),
    setMobileInteraction() {},
    setPositionToFace() {},
    performAnimation() {},
    getPacketSender: () => ({ sendConfig() {}, sendTypedMessage: (type, m) => messages.push(type === 105 ? `spam:${m}` : m) }),
  };
  self.combat = new Combat(self);
  self.getCombat = () => self.combat;
  return self;
}

const permission = (attacker, target) => CombatFactory.canAttackPermission(attacker, target, true);

test("a target reaching 0 hp releases the player on that tick, before the corpse is removed", () => {
  const you = mobile("player", "You");
  const corpse = mobile("npc", "Corpse");
  const next = mobile("npc", "Next");
  // The fight: the NPC hit the player, so it is the player's attacker and single combat says
  // "I'm already under attack." for anything else.
  you.getCombat().setUnderAttack(corpse);
  assert.equal(permission(you, next), CanAttackResponse.ALREADY_UNDER_ATTACK);

  // The killing blow. appendDeath runs at setHitpoints(0); nothing waits for the death task.
  corpse.setHitpoints(0);
  assert.equal(permission(you, next), CanAttackResponse.CAN_ATTACK,
    "the killed NPC no longer holds the player in single combat");
  assert.deepEqual(you.messages, [], "nothing is said and the click is not denied");
});

test("appendDeath drops the corpse's in-flight hits before the death task is even submitted", () => {
  // NPCDeathTask starts the animation on its first run, a tick after the killing blow. The
  // hit drop must not wait for it: the player's next click is read in their turn this tick.
  const calls = [];
  const originalDrop = HitQueue.dropHitsFrom;
  const originalSubmit = TaskManager.submit;
  HitQueue.dropHitsFrom = (entity) => calls.push(["drop", entity]);
  TaskManager.submit = (task) => calls.push(["submit", task]);
  try {
    const dying = { isDying: false };
    NPC.prototype.appendDeath.call(dying);
    assert.deepEqual(calls.map(([kind]) => kind), ["drop", "submit"],
      "the hits are dropped at 0 hp, not when the animation task runs");
    assert.equal(calls[0][1], dying);
  } finally {
    HitQueue.dropHitsFrom = originalDrop;
    TaskManager.submit = originalSubmit;
  }
});

test("appendDeath ends the PJ timer the corpse holds on the player", (t) => {
  // Wiki (PJ timer): "When a player kills the monster, the PJ timer immediately ends."
  const you = mobile("player", "You");
  const corpse = mobile("npc", "Corpse");
  t.mock.method(World, "getPlayers", () => [you]);
  t.mock.method(TaskManager, "submit", () => {});

  you.getCombat().setUnderAttack(corpse);
  assert.equal(CombatFactory.inCombat(you), true);

  NPC.prototype.appendDeath.call(corpse);
  assert.equal(you.getCombat().getAttacker(), null,
    "the dead monster no longer holds the player in combat");
  assert.equal(CombatFactory.inCombat(you), false);
  assert.equal(you.getCombat().ticksSinceAttacked(), 0,
    "the separate 16-tick logout timer still counts from the hit");
});

test("the monster's PJ timer is 8 ticks and refreshes with each attack", (t) => {
  let cycle = 500;
  t.mock.method(World, "getProcessCycle", () => cycle);
  const you = mobile("player", "You");
  const goblin = mobile("npc", "Goblin");

  you.getCombat().setUnderAttack(goblin);
  cycle = 507;
  you.getCombat().preMovementProcess();
  assert.equal(you.getCombat().getAttacker(), goblin, "7 ticks is still protected");
  cycle = 508;
  you.getCombat().preMovementProcess();
  assert.equal(you.getCombat().getAttacker(), null, "8 ticks ends the PJ timer");
  assert.equal(you.getCombat().ticksSinceAttacked(), 8, "the 16-tick logout timer is separate");

  // A later attack restarts the 8 ticks, as the Wiki says it is refreshed by each attack.
  cycle = 520;
  you.getCombat().setUnderAttack(goblin);
  cycle = 527;
  you.getCombat().preMovementProcess();
  assert.equal(you.getCombat().getAttacker(), goblin);
  cycle = 528;
  you.getCombat().preMovementProcess();
  assert.equal(you.getCombat().getAttacker(), null);
});

test("PvP keeps the existing 10-tick hold, unlike the PvM PJ timer", (t) => {
  // The Wiki's longer PvP PJ timer (20 Wilderness / 16 PvP-world ticks) is a separate
  // change; the PvM fix must not shorten player-versus-player protection either.
  let cycle = 600;
  t.mock.method(World, "getProcessCycle", () => cycle);
  const victim = mobile("player", "Victim");
  const pker = mobile("player", "Pker");

  victim.getCombat().setUnderAttack(pker);
  cycle = 609;
  victim.getCombat().preMovementProcess();
  assert.equal(victim.getCombat().getAttacker(), pker, "9 ticks is still protected");
  cycle = 610;
  victim.getCombat().preMovementProcess();
  assert.equal(victim.getCombat().getAttacker(), null, "10 ticks ends the PvP hold");
});

test("an NPC holder uses the 8-tick PJ timer when hit by a player", (t) => {
  // Wiki (PJ timer): NPCs get the same 4.8-second timer when hit by a player.
  let cycle = 700;
  t.mock.method(World, "getProcessCycle", () => cycle);
  const holder = mobile("npc", "Holder");
  const player = mobile("player", "Player");

  holder.getCombat().setUnderAttack(player);
  cycle = 707;
  holder.getCombat().preMovementProcess();
  assert.equal(holder.getCombat().getAttacker(), player, "7 ticks is still protected");
  cycle = 708;
  holder.getCombat().preMovementProcess();
  assert.equal(holder.getCombat().getAttacker(), null, "8 ticks ends the NPC's PJ timer");
});

test("the dying NPC's hit still in the air is dropped at 0 hp, not a tick later", () => {
  const you = mobile("player", "You");
  const corpse = mobile("npc", "Corpse");
  const next = mobile("npc", "Next");
  const queue = you.getCombat().getHitQueue();
  queue.addPendingHit({ getAttacker: () => corpse }, 0);
  assert.equal(permission(you, next), CanAttackResponse.ALREADY_UNDER_ATTACK,
    "a hit from the dying npc is still a previous fight's delayed hit");

  // NPC.appendDeath calls this synchronously the moment hitpoints reach 0.
  HitQueue.dropHitsFrom(corpse);
  assert.equal(permission(you, next), CanAttackResponse.CAN_ATTACK,
    "the corpse's in-flight hit no longer delays the next fight");
  queue.clear();
});

test("clicking the next NPC keeps it as the target", () => {
  const you = mobile("player", "You");
  const corpse = mobile("npc", "Corpse");
  const next = mobile("npc", "Next");
  you.getCombat().setUnderAttack(corpse);
  corpse.setHitpoints(0);

  you.getCombat().attack(next);
  assert.equal(you.getCombat().getTarget(), next);
  assert.equal(permission(you, next), CanAttackResponse.CAN_ATTACK);
});
