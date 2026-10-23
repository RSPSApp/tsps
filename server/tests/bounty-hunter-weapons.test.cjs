const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const path = require("node:path");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { CanAttackResponse } = require("../dist/game/content/combat/CombatFactory");
const { DuelState } = require("../dist/game/content/Duelling");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const core = PluginManager.getCoreApi();
let gate;
const consumers = [];
const api = new Proxy({ core,
  onCanAttack: (handler) => { gate ??= handler; },
  onCustomEvent: (name, handler) => { if (name === "bounty-hunter:weapon-area") consumers.push(handler); },
  emitCustomEvent: (_name, event) => consumers.forEach((handler) => handler(event)),
}, { get: (object, name) => object[name] ?? (() => {}) });
require("../plugins/items/BountyHunterWeapons.plugin").register(api);

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
});

function player(weapon = core.ItemIdentifiers.DARK_BOW_BH_) {
  const player = { isPlayer: () => true, isNpc: () => false, getAsPlayer: () => player,
    getEquipment: () => ({ get: () => ({ getId: () => weapon }) }), sendMessage() {},
    getArea: () => null, getPrivateArea: () => null, getLocation: () => new core.Location(3200, 3200, 0),
  };
  return player;
}

function canAttack(attacker, target = player()) {
  const event = { attacker, target, allow: null };
  gate(event);
  return event.allow;
}

test("BH darkbow refuses the wilderness and unsupported PvP areas; ordinary darkbow is unaffected", () => {
  assert.equal(canAttack(player()), false);
  assert.equal(canAttack(player(core.ItemIdentifiers.DARK_BOW)), null);
});

test("an area's PvP permission cannot bypass the equipped weapon's restriction", (t) => {
  const area = {};
  const attacker = player(), target = player();
  attacker.getArea = target.getArea = () => area;
  t.mock.method(PluginManager, "callArea", () => true);
  t.mock.method(PluginManager, "emitCanAttack", (attacker, target) => canAttack(attacker, target));
  assert.equal(core.CombatFactory.canAttackByPolicy(attacker, target), CanAttackResponse.CANT_ATTACK_IN_AREA);
  attacker.getEquipment = player(core.ItemIdentifiers.DARK_BOW).getEquipment;
  assert.equal(core.CombatFactory.canAttackByPolicy(attacker, target), CanAttackResponse.CAN_ATTACK);
  t.mock.method(PluginManager, "callArea", () => false);
  assert.equal(core.CombatFactory.canAttackByPolicy(attacker, target), CanAttackResponse.CANT_ATTACK_IN_AREA);
});

test("a global permission cannot bypass a later attack restriction", () => {
  const original = PluginManager.canAttackHooks;
  try {
    for (const verdicts of [[true, false], [false, true], [null, false]]) {
      PluginManager.canAttackHooks = verdicts.map((allow) => ({ pluginName: "test", handler: (event) => { event.allow = allow; } }));
      assert.equal(PluginManager.emitCanAttack(player(), player()), false);
    }
    PluginManager.canAttackHooks = [{ pluginName: "test", handler: (event) => { event.allow = true; } }];
    assert.equal(PluginManager.emitCanAttack(player(), player()), true);
    PluginManager.canAttackHooks = [];
    assert.equal(PluginManager.emitCanAttack(player(), player()), null);
  } finally {
    PluginManager.canAttackHooks = original;
  }
});

test("an agreed duel still enforces equipment restrictions", (t) => {
  const attacker = player(), target = player();
  attacker.getDueling = () => ({ inDuel: () => true, getInteract: () => target, getState: () => DuelState.IN_DUEL });
  target.getDueling = () => ({ inDuel: () => true, getInteract: () => attacker, getState: () => DuelState.IN_DUEL });
  attacker.getCombatSpecial = () => null;
  attacker.isSpecialActivated = () => false;
  attacker.getTimers = () => ({ has: () => false });
  t.mock.method(core.CombatFactory, "multiCombatBetween", () => true);
  const policy = t.mock.method(PluginManager, "emitCanAttack", () => false);
  assert.equal(core.CombatFactory.canAttackPermission(attacker, target, true), CanAttackResponse.CANT_ATTACK_IN_AREA);
  policy.mock.mockImplementation(() => null);
  assert.equal(core.CombatFactory.canAttackPermission(attacker, target, true), CanAttackResponse.CAN_ATTACK);
});

test("Castle Wars and the Fight Pit approve only their canonical game areas", () => {
  const data = require("../plugins/minigames/castlewars/Data.CastleWars")(core);
  const game = { data, getTeamData: (team) => data.TEAM_DATA[team] };
  require("../plugins/minigames/castlewars/Areas.CastleWars")(api, game);
  const attacker = player(), target = player();
  attacker.getArea = () => game.gameArea;
  target.getArea = () => game.gameArea;
  assert.equal(canAttack(attacker, target), null);
  target.getArea = () => game.lobbyArea;
  assert.equal(canAttack(attacker, target), false);
  target.getArea = () => null;
  attacker.getArea = () => null;
  require("../plugins/minigames/TzhaarFightPits.plugin").register(api);
  attacker.getLocation = () => new core.Location(2399, 5160, 0);
  target.getLocation = () => new core.Location(2398, 5160, 0);
  assert.equal(canAttack(attacker, target), null);
  target.getLocation = () => new core.Location(2399, 5170, 0);
  assert.equal(canAttack(attacker, target), false, "the waiting room cannot approve the bow");
});

test("a POH approves only two opponents in the same actual combat ring", (t) => {
  require("../plugins/skills/construction/Core.Construction").init(api);
  const House = require("../plugins/skills/construction/House.Construction");
  const Rings = require("../plugins/skills/construction/CombatRings.Construction");
  Rings.attachCombatRings(api);
  const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
  const matId = CacheDefinitions.getLocId("poh_combat_mat_middle");
  assert.ok(matId >= 0);
  const house = { furnitureObjects: [
    { getId: () => matId, getLocation: () => new core.Location(100, 100, 0) },
    { getId: () => matId, getLocation: () => new core.Location(101, 100, 0) },
  ], getRoomPositionAt: () => ({ x: 4, y: 4, plane: 1 }) };
  const attacker = player(), target = player();
  t.mock.method(House, "houseFor", () => house);
  attacker.getLocation = () => new core.Location(100, 100, 0);
  target.getLocation = () => new core.Location(101, 100, 0);
  assert.equal(canAttack(attacker, target), null);
  target.getLocation = () => new core.Location(102, 100, 0);
  assert.equal(canAttack(attacker, target), false);
});
