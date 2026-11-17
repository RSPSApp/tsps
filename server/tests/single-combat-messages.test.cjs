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

test("a Slayer superior can be attacked by its owner while something else is fighting them (Wiki)", () => {
  const you = mobile("player", "You");
  const someoneElse = mobile("player", "Someone");
  const goblin = mobile("npc", "Goblin");
  const flags = new Set([CombatFactory.ATTACKABLE_WHILE_UNDER_ATTACK_FLAG]);
  const superior = Object.assign(mobile("npc", "Superior"), { getOwner: () => you, hasFlag: (flag) => flags.has(flag) });
  superior.getAsNpc = () => superior;
  you.getCombat().setUnderAttack(goblin);
  someoneElse.getCombat().setUnderAttack(goblin);
  // Past the single-combat lock come checks this stand-in player can't answer (special attack,
  // timers); getting to them is the pass, so a throw there counts as not refused by the lock.
  let ownerResponse;
  try { ownerResponse = permission(you, superior); } catch { ownerResponse = "past the lock"; }
  assert.notEqual(ownerResponse, CanAttackResponse.ALREADY_UNDER_ATTACK);
  // Only its owner: anyone else is still tied up by what is fighting them.
  assert.equal(permission(someoneElse, superior), CanAttackResponse.ALREADY_UNDER_ATTACK);
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

// A plugin's onCanAttack refusal (PluginCanAttackEvent.response / .message) is said by the core, and
// only on the player's own attack: the same check run passively (Retribution, cannons, relic and bot
// scans) prints nothing. Nechryael's death spawn uses the core's "I'm already under attack.".
function withCanAttackHook(t, handler) {
  const { PluginManager } = require("../dist/plugins/PluginManager");
  PluginManager.createApi("CanAttackResponseTest").onCanAttack(handler);
  const hooks = PluginManager.canAttackHooks;
  const added = hooks[hooks.length - 1];
  t.after(() => hooks.splice(hooks.indexOf(added), 1));
}

test("a plugin refusal naming a core response gets that response's message, once, and only on the attack", (t) => {
  const you = mobile("player", "You");
  const spawn = mobile("npc", "Death spawn");
  withCanAttackHook(t, (event) => {
    if (event.target !== spawn) return;
    event.allow = false;
    event.response = "ALREADY_UNDER_ATTACK";
  });
  assert.equal(permission(you, spawn), CanAttackResponse.ALREADY_UNDER_ATTACK);
  assert.equal(CombatFactory.canAttackByPolicy(you, spawn), CanAttackResponse.ALREADY_UNDER_ATTACK);
  assert.deepEqual(you.messages, [], "a passive check says nothing");
  assert.equal(deny(you, spawn, CanAttackResponse.ALREADY_UNDER_ATTACK), true, "the attack waits");
  deny(you, spawn, CanAttackResponse.ALREADY_UNDER_ATTACK);
  assert.deepEqual(you.messages, ["spam:I'm already under attack."]);
});

test("a plugin refusal's own message is sent once with the attack it refuses, never by a passive check", (t) => {
  const you = mobile("player", "You");
  const vorkath = mobile("npc", "Vorkath");
  const cow = mobile("npc", "Cow");
  withCanAttackHook(t, (event) => {
    if (event.target === vorkath) {
      event.allow = false;
      event.message = "You need to poke Vorkath awake first.";
    } else if (event.target === cow) {
      event.allow = false;
    }
  });
  assert.equal(CombatFactory.canAttackByPolicy(you, vorkath), CanAttackResponse.CANT_ATTACK_IN_AREA);
  assert.deepEqual(you.messages, [], "a passive check says nothing");
  // A later refusal without a message does not pick up the passive check's line.
  assert.equal(permission(you, cow), CanAttackResponse.CANT_ATTACK_IN_AREA);
  assert.equal(deny(you, cow, CanAttackResponse.CANT_ATTACK_IN_AREA), false);
  assert.deepEqual(you.messages, []);

  assert.equal(permission(you, vorkath), CanAttackResponse.CANT_ATTACK_IN_AREA);
  assert.deepEqual(you.messages, [], "the check itself says nothing");
  assert.equal(deny(you, vorkath, CanAttackResponse.CANT_ATTACK_IN_AREA), false, "the attack ends");
  assert.deepEqual(you.messages, ["You need to poke Vorkath awake first."]);
});

// Review (#5721): a barrage or chinchompa splash checks each bystander through canAttackSecondaryTarget ->
// canAttackByPolicy. The Nightmare's charged totem refuses with its line; a splash onto it says nothing,
// clicking it says it once.
test("a splash onto a charged Nightmare totem says nothing; attacking it says the line once", (t) => {
  const { PluginManager } = require("../dist/plugins/PluginManager");
  const { AreaManager } = require("../dist/game/model/areas/AreaManager");
  const Common = require("../plugins/bosses/nightmare/Common.Nightmare");
  const Fight = require("../plugins/bosses/nightmare/Fight.Nightmare");
  const api = PluginManager.createApi("NightmareSplashTest");
  Common.init(api);
  const hooks = PluginManager.canAttackHooks;
  const before = hooks.length;
  Fight.attachFight(api);
  const added = hooks.slice(before);
  t.after(() => { for (const hook of added) hooks.splice(hooks.indexOf(hook), 1); });

  const you = mobile("player", "You");
  you.getDueling = () => ({ inDuel: () => false });
  const nightmare = mobile("npc", "The Nightmare");
  const totem = mobile("npc", "Totem");
  totem.__nightmareTotem = 0;
  totem.__nightmareFight = { stage: "totems", totems: [{ charged: true }] };
  totem.getCurrentDefinition = () => ({ isAttackable: () => true });
  totem.getTimers = () => ({ has: () => false });
  t.mock.method(CombatFactory, "validTarget", () => true);
  t.mock.method(AreaManager, "inMulti", () => true);

  assert.equal(CombatFactory.canAttackSecondaryTarget(you, nightmare, totem), false, "the splash skips it");
  assert.deepEqual(you.messages, [], "and says nothing");
  assert.equal(permission(you, totem), CanAttackResponse.CANT_ATTACK_IN_AREA);
  assert.equal(deny(you, totem, CanAttackResponse.CANT_ATTACK_IN_AREA), false);
  assert.deepEqual(you.messages, [Common.data.fight.messages.totemCharged]);
});

test("NPC attacker expiry preserves the last-hit timestamp; only another hit refreshes it", (t) => {
  const { World } = require("../dist/game/World");
  let cycle = 20000;
  t.mock.method(World, "getProcessCycle", () => cycle);
  const npc = mobile("npc", "Goblin");
  npc.isScriptedMovement = () => true;
  const first = mobile("player", "First");
  const second = mobile("player", "Second");
  const combat = npc.getCombat();
  combat.setUnderAttack(first);
  cycle += 7;
  combat.preMovementProcess();
  assert.equal(combat.getAttacker(), first, "PJ protection still holds before eight ticks");
  cycle++;
  combat.preMovementProcess();
  assert.equal(combat.getAttacker(), null, "PJ protection expires at eight ticks");
  assert.equal(combat.getLastAttack().elapsed(), 4800, "expiry does not impersonate a hit");
  cycle = 20034;
  assert.equal(combat.getLastAttack().hasElapsed(20000), true, "regen keeps the original last-hit clock");
  combat.setUnderAttack(second);
  assert.equal(combat.getAttacker(), second);
  assert.equal(combat.getLastAttack().elapsed(), 0, "a new incoming hit restarts the delay");
});

test("explicit combat clears retain their timer reset for both players and NPCs", (t) => {
  const { World } = require("../dist/game/World");
  let cycle = 30000;
  t.mock.method(World, "getProcessCycle", () => cycle);
  for (const kind of ["player", "npc"]) {
    const victim = mobile(kind, "Victim");
    const attacker = mobile("npc", "Attacker");
    const other = mobile("npc", "Other");
    const combat = victim.getCombat();
    combat.setUnderAttack(attacker);
    cycle += 3;
    combat.clearAttackerIf(other);
    assert.equal(combat.getAttacker(), attacker, "an unrelated death cannot release this fight");
    assert.equal(combat.getLastAttack().elapsed(), 1800);
    combat.clearAttackerIf(attacker);
    assert.equal(combat.getAttacker(), null);
    assert.equal(combat.getLastAttack().elapsed(), 0, "the existing explicit death-release reset is preserved");
    combat.setUnderAttack(attacker);
    assert.equal(combat.getLastAttack().elapsed(), 0);
    cycle += 2;
    combat.setUnderAttack(null);
    assert.equal(combat.getLastAttack().elapsed(), 0, "explicit clearing still restarts its timer");
  }
});
