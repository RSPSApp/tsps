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
    getPacketSender: () => ({ sendConfig() {} }),
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
  assert.deepEqual(you.messages, ["I'm already under attack."]);
});

test("an npc waits for a taken target instead of giving up", () => {
  const guard = mobile("npc", "Guard");
  const you = mobile("player", "You");
  you.getCombat().setUnderAttack(mobile("npc", "Goblin"));
  assert.equal(permission(guard, you), CanAttackResponse.TARGET_IN_COMBAT);
  assert.equal(guard.getCombat().isTransientDenial(CanAttackResponse.TARGET_IN_COMBAT), true);
  assert.equal(you.getCombat().isTransientDenial(CanAttackResponse.TARGET_IN_COMBAT), false);
});

// Live (a melee player clicking Attack on a cow another player is fighting): the player still walks
// in, told once on the way and again on arriving, where the attack ends. At range the line only
// comes once in range (LostCity player_combat.rs2: the approach-stage check runs for melee only).
test("a player walks in on an NPC someone else is fighting, told on the way in melee", (t) => {
  const { CombatRange } = require("../dist/game/content/combat/CombatRange");
  const { CombatType } = require("../dist/game/content/combat/CombatType");
  let inReach = false;
  t.mock.method(CombatRange, "canReach", () => inReach);
  const melee = { type: () => CombatType.MELEE };
  const ranged = { type: () => CombatType.RANGED };
  const you = mobile("player", "You");
  const cow = mobile("npc", "Cow");
  const combat = you.getCombat();

  assert.equal(combat.walksInOnFoughtNpc(CanAttackResponse.TARGET_IN_COMBAT, cow, melee), true, "keeps walking in");
  assert.equal(combat.walksInOnFoughtNpc(CanAttackResponse.TARGET_IN_COMBAT, cow, melee), true);
  assert.deepEqual(you.messages, ["Someone else is fighting that."], "said once on the approach");
  inReach = true;
  assert.equal(combat.walksInOnFoughtNpc(CanAttackResponse.TARGET_IN_COMBAT, cow, melee), false,
    "in reach it is refused, with the line again (handleAttackDenied)");

  const archer = mobile("player", "Archer");
  inReach = false;
  assert.equal(archer.getCombat().walksInOnFoughtNpc(CanAttackResponse.TARGET_IN_COMBAT, cow, ranged), true);
  assert.deepEqual(archer.messages, [], "nothing said at range until in range");

  const opponent = mobile("player", "Opponent");
  assert.equal(combat.walksInOnFoughtNpc(CanAttackResponse.TARGET_IN_COMBAT, opponent, melee), false,
    "a player target is still turned away on the spot");
  assert.equal(combat.walksInOnFoughtNpc(CanAttackResponse.ALREADY_UNDER_ATTACK, cow, melee), false);
});
