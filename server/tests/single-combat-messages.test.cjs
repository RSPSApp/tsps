// Run after `yarn build`: node --test tests/single-combat-messages.test.cjs
// Single combat turns an attack away for two reasons, with different lines (rsprox captures):
// "I'm already under attack." when something else is fighting you, and "Someone else is
// fighting that." (or "Someone else is already fighting <name>.") when the target is taken.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { Combat } = require("../dist/game/content/combat/Combat");
const { CombatFactory, CanAttackResponse } = require("../dist/game/content/combat/CombatFactory");
const { Location } = require("../dist/game/model/Location");

/** A mobile in Lumbridge (single combat) with a real Combat and a message log. */
function mobile(kind, name) {
  const messages = [];
  const self = {
    messages,
    isPlayer: () => kind === "player",
    isNpc: () => kind === "npc",
    getAsPlayer: () => self,
    getAsNpc: () => self,
    isMultiCombat: () => false,
    getOwner: () => null,
    getUsername: () => name, getDisplayName: () => name,
    getDueling: () => null,
    getArea: () => null,
    getPrivateArea: () => null,
    getLocation: () => new Location(3222, 3218, 0),
    getHitpoints: () => 10,
    sendMessage: (message) => messages.push(message),
    // What Combat.reset() touches.
    getMovementQueue: () => ({ reset() {} }),
    setMobileInteraction() {},
    setPositionToFace() {},
    performAnimation() {},
    // Typed messages are logged as "spam:..." (ChatType.SPAM is 105).
    getPacketSender: () => ({ sendConfig() {}, sendTypedMessage: (type, m) => messages.push(type === 105 ? `spam:${m}` : m) }),
  };
  self.combat = new Combat(self);
  self.getCombat = () => self.combat;
  return self;
}

const permission = (attacker, target) => CombatFactory.canAttackPermission(attacker, target, true);

/** Denies the attacker's current attack and reports whether it is still going. */
function deny(attacker, target, response) {
  const combat = attacker.getCombat();
  combat.target = target;
  combat.handleAttackDenied(response, target, combat.generation);
  return combat.target === target;
}

test("the npc is fighting someone else: 'Someone else is fighting that.' and the attack stops", () => {
  const you = mobile("player", "You");
  const other = mobile("player", "Other");
  const goblin = mobile("npc", "Goblin");
  goblin.getCombat().setUnderAttack(other);
  assert.equal(permission(you, goblin), CanAttackResponse.TARGET_IN_COMBAT);
  assert.equal(deny(you, goblin, CanAttackResponse.TARGET_IN_COMBAT), false);
  assert.deepEqual(you.messages, ["Someone else is fighting that."]);
});

test("the player is fighting someone else: names them", () => {
  const you = mobile("player", "You");
  const other = mobile("player", "Other");
  const opponent = mobile("player", "Opponent");
  opponent.getCombat().setUnderAttack(other);
  assert.equal(permission(you, opponent), CanAttackResponse.TARGET_IN_COMBAT);
  deny(you, opponent, CanAttackResponse.TARGET_IN_COMBAT);
  assert.deepEqual(you.messages, ["Someone else is already fighting Opponent."]);
});

test("something else is fighting you: 'I'm already under attack.', once, and the attack waits", () => {
  const you = mobile("player", "You");
  const goblin = mobile("npc", "Goblin");
  const rat = mobile("npc", "Rat");
  you.getCombat().setUnderAttack(goblin);
  assert.equal(permission(you, rat), CanAttackResponse.ALREADY_UNDER_ATTACK);
  assert.equal(deny(you, rat, CanAttackResponse.ALREADY_UNDER_ATTACK), true);
  deny(you, rat, CanAttackResponse.ALREADY_UNDER_ATTACK);
  assert.deepEqual(you.messages, ["spam:I'm already under attack."]);
});

test("an npc waits for a taken target instead of giving up", () => {
  const guard = mobile("npc", "Guard");
  const you = mobile("player", "You");
  you.getCombat().setUnderAttack(mobile("npc", "Goblin"));
  assert.equal(permission(guard, you), CanAttackResponse.TARGET_IN_COMBAT);
  assert.equal(guard.getCombat().isTransientDenial(CanAttackResponse.TARGET_IN_COMBAT), true);
  assert.equal(you.getCombat().isTransientDenial(CanAttackResponse.TARGET_IN_COMBAT), false);
});

// Live (rsprox 83 t18212/18213, 1098 t4925/4926; Jordan's "AP to OP switching"): a melee player
// clicking Attack on an NPC another player is fighting still walks in. Both checks of the click tick
// say so, the walk goes on, and arriving says it again and ends the attack. Ranged and magic are
// turned away on the spot (rsprox 2745 t4982: Wind Strike from 11 tiles, no step).
test("a melee player walks in on an NPC someone else is fighting; ranged and magic do not", (t) => {
  const { CombatRange } = require("../dist/game/content/combat/CombatRange");
  const { CombatType } = require("../dist/game/content/combat/CombatType");
  const { World } = require("../dist/game/World");
  let inReach = false;
  let cycle = 500;
  t.mock.method(CombatRange, "canReach", () => inReach);
  t.mock.method(World, "getProcessCycle", () => cycle);
  const melee = { type: () => CombatType.MELEE };
  const you = mobile("player", "You");
  const cow = mobile("npc", "Cow");
  const combat = you.getCombat();

  assert.equal(combat.walksInOnFoughtNpc(CanAttackResponse.TARGET_IN_COMBAT, cow, melee), true, "keeps walking in");
  assert.equal(combat.walksInOnFoughtNpc(CanAttackResponse.TARGET_IN_COMBAT, cow, melee), true);
  assert.deepEqual(you.messages, ["Someone else is fighting that.", "Someone else is fighting that."],
    "said by both checks of the click tick");
  cycle++;
  assert.equal(combat.walksInOnFoughtNpc(CanAttackResponse.TARGET_IN_COMBAT, cow, melee), true);
  assert.equal(you.messages.length, 2, "nothing more while walking");
  inReach = true;
  assert.equal(combat.walksInOnFoughtNpc(CanAttackResponse.TARGET_IN_COMBAT, cow, melee), false,
    "in reach it is refused, with the line again (handleAttackDenied)");

  inReach = false;
  for (const type of [CombatType.RANGED, CombatType.MAGIC]) {
    const archer = mobile("player", "Archer");
    assert.equal(archer.getCombat().walksInOnFoughtNpc(CanAttackResponse.TARGET_IN_COMBAT, cow, { type: () => type }), false,
      "refused on the spot");
  }

  const opponent = mobile("player", "Opponent");
  assert.equal(combat.walksInOnFoughtNpc(CanAttackResponse.TARGET_IN_COMBAT, opponent, melee), false,
    "a player target is still turned away on the spot");
  assert.equal(combat.walksInOnFoughtNpc(CanAttackResponse.ALREADY_UNDER_ATTACK, cow, melee), false);
});
