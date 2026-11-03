// Run after `yarn build`: node --test tests/aggression-tolerance.test.cjs
const assert = require("node:assert/strict");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();

const { AggressionTolerance } = require("../dist/game/entity/impl/npc/AggressionTolerance");
const { NpcDefinition } = require("../dist/game/definition/NpcDefinition");
const { Location } = require("../dist/game/model/Location");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { WORLD_ZONE_BOUNDARIES } = require("../dist/game/definition/WorldDefinition");
const { NpcAggression } = require("../dist/game/entity/impl/npc/NpcAggression");
const core = PluginManager.getCoreApi();
const towerSpawns = require("../data/definitions/npc-spawns.json").filter(row => row.name === "Dark wizard"
  && row.x >= 2900 && row.x <= 2912 && row.y >= 3328 && row.y <= 3342);

before(async () => {
  await require("../dist/game/cache/CachePipeline").CachePipeline.initialize(require("node:path").resolve(__dirname, ".."));
  core.RegionManager.init();
  new (require("../dist/game/definition/loader/impl/NpcDefinitionLoader").NpcDefinitionLoader)().load();
});

let nextIndex = 2000;
function aggressionPlayer(t) {
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const { PlayerSession } = require("../dist/net/PlayerSession");
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel), new Location(2906, 3335));
  player.setIndex(nextIndex++); player.setRegistered(true); player.setNeedsPlacement(false);
  t.after(() => { player.setRegistered(false); core.TaskManager.cancelTasks(player.getIndex()); });
  return player;
}

function combatLevel(player, level) {
  const skills = player.getSkillManager();
  for (const skill of [core.Skill.ATTACK, core.Skill.STRENGTH, core.Skill.DEFENCE, core.Skill.PRAYER, core.Skill.RANGED, core.Skill.MAGIC]) {
    skills.setMaxLevels(skill, 1, false);
  }
  skills.setMaxLevels(core.Skill.HITPOINTS, 10, false);
  for (let melee = 1; melee <= 99; melee++) {
    skills.setMaxLevels(core.Skill.ATTACK, melee, false);
    skills.setMaxLevels(core.Skill.STRENGTH, melee, false);
    if (skills.getCombatLevel() === level) return;
  }
  assert.fail(`could not construct actual combat level ${level}`);
}

function boundary(t, kind, tile) {
  const box = new core.Boundary(tile.getX(), tile.getX(), tile.getY(), tile.getY(), tile.getZ());
  WORLD_ZONE_BOUNDARIES[kind].push(box);
  t.after(() => WORLD_ZONE_BOUNDARIES[kind].splice(WORLD_ZONE_BOUNDARIES[kind].indexOf(box), 1));
}

for (const id of new Set(towerSpawns.map(row => row.id))) {
  test(`Dark Wizard ${id} keeps its inclusive combat cutoff on every tower floor, including custom PvP`, t => {
    const player = aggressionPlayer(t);
    const floors = new Map(towerSpawns.filter(row => row.id === id).map(row => [row.level, row]));
    assert.equal(floors.size, 3, "the actual tower spawn is covered on all three floors");
    for (const row of floors.values()) {
      const npc = core.NPC.create(row.id, new Location(row.x, row.y, row.level));
      player.setLocation(npc.getLocation().clone());
      const level = npc.getCurrentDefinition().getCombatLevel();
      assert.equal(npc.getCurrentDefinition().isAggressive(), true);
      assert.equal(core.Wilderness.levelAt(row.x, row.y), 0);
      combatLevel(player, level * 2);
      assert.equal(npc.isAggressiveTo(player), true, "exactly twice the NPC level remains aggressive");
      combatLevel(player, level * 2 + 1);
      assert.equal(npc.isAggressiveTo(player), false, "one level above twice is outside the ordinary cutoff");
      boundary(t, "pvp", player.getLocation());
      assert.equal(core.Wilderness.isIn(player), true, "the custom PvP setting is active");
      assert.equal(npc.isAggressiveTo(player), false, "unlevelled PvP does not create a Wilderness exemption");
    }
  });
}

test("levelled surface and underground Wilderness keep the aggression exemption, excluding configured safe ground and buildings", t => {
  const player = aggressionPlayer(t), row = towerSpawns[0];
  const npc = core.NPC.create(row.id, new Location(row.x, row.y));
  combatLevel(player, npc.getCurrentDefinition().getCombatLevel() * 2 + 1);
  for (const tile of [new Location(3100, 3527), new Location(3100, 9927)]) {
    player.setLocation(tile);
    assert.ok(core.Wilderness.levelAt(tile.getX(), tile.getY()) > 0);
    assert.equal(core.Wilderness.isIn(player), true);
    assert.equal(npc.isAggressiveTo(player), true);
    boundary(t, "safe", tile);
    assert.equal(npc.isAggressiveTo(player), false, "configured safe tiles keep the ordinary level cutoff");
  }
  const roof = new Location(3101, 3527);
  player.setLocation(roof);
  boundary(t, "all-buildings-safe", roof);
  t.mock.method(core.RegionManager, "getRegion", () => ({ isUnderRoof: () => true }));
  assert.equal(core.Wilderness.isInSafeBuilding(roof), true);
  assert.equal(npc.isAggressiveTo(player), false);
});

test("plugin-provided Wilderness levels still control the exemption and need active PvP ground", t => {
  const player = aggressionPlayer(t), row = towerSpawns[0];
  const npc = core.NPC.create(row.id, new Location(row.x, row.y));
  combatLevel(player, npc.getCurrentDefinition().getCombatLevel() * 2 + 1);
  const tile = new Location(2800, 4500);
  player.setLocation(tile);
  const name = "aggression-level-regression";
  core.Wilderness.setLevelSource(name, (x, y) => x === tile.getX() && y === tile.getY() ? 25 : null);
  t.after(() => core.Wilderness.levelSources.delete(name));
  assert.equal(core.Wilderness.levelAt(tile.getX(), tile.getY()), 25);
  assert.equal(npc.isAggressiveTo(player), false, "a level source alone is not a PvP area");
  boundary(t, "pvp", tile);
  assert.equal(npc.isAggressiveTo(player), true);
  core.Wilderness.setLevelSource(name, () => 0);
  assert.equal(npc.isAggressiveTo(player), false, "an explicit zero source suppresses the exemption");
  player.setLocation(new Location(3100, 3527));
  assert.equal(core.Wilderness.isIn(player), true);
  assert.equal(npc.isAggressiveTo(player), false, "an explicit zero source also overrides the geographic strip");
});

test("native aggression dispatch respects the level cutoff and explicit NPC/area policies", t => {
  const player = aggressionPlayer(t), row = towerSpawns[0];
  const npc = core.NPC.create(row.id, new Location(row.x, row.y));
  npc.setIndex(nextIndex++); npc.setRegistered(true);
  t.after(() => { npc.setRegistered(false); core.TaskManager.cancelTasks(npc.getIndex()); });
  player.setLocation(new Location(row.x - 1, row.y));
  player.getLocalNpcs().push(npc);
  boundary(t, "pvp", player.getLocation());
  const level = npc.getCurrentDefinition().getCombatLevel();
  combatLevel(player, level * 2 + 1);
  NpcAggression.process(player);
  assert.equal(npc.getCombat().getTarget(), null, "the real hunt dispatcher does not acquire an overlevelled target");
  combatLevel(player, level * 2);
  NpcAggression.process(player);
  assert.equal(npc.getCombat().getTarget(), player, "the exact cutoff still starts ordinary combat");
  npc.getCombat().reset();
  combatLevel(player, level * 2 + 1);
  class Override extends core.Area { npcAggression() { return true; } }
  player.setArea(new Override());
  NpcAggression.process(player);
  assert.equal(npc.getCombat().getTarget(), player, "an explicit area override still bypasses the default cutoff");
  npc.getCombat().reset();
  player.setArea(null);
  npc.isAggressiveTo = () => true;
  NpcAggression.process(player);
  assert.equal(npc.getCombat().getTarget(), player, "an explicit NPC policy still controls that NPC");
});

function holder() {
  const attributes = new Map();
  return { attributes, getAttribute: (key) => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value) };
}

const ticks = (tolerance, location, n) => { for (let i = 0; i < n; i++) tolerance.update(location); };

test("tolerant after ten minutes (1000 ticks) in the regions, not before (Wiki)", () => {
  const tolerance = new AggressionTolerance(holder());
  const here = new Location(1750, 3470, 0);
  ticks(tolerance, here, 1000);
  assert.equal(tolerance.finished(), false, "the first tick only seeds the regions");
  ticks(tolerance, here, 1);
  assert.equal(tolerance.finished(), true);
});

test("moving around inside the 21x21 regions keeps the timer", () => {
  const tolerance = new AggressionTolerance(holder());
  ticks(tolerance, new Location(1750, 3470, 0), 500);
  ticks(tolerance, new Location(1760, 3480, 0), 501);
  assert.equal(tolerance.finished(), true, "10 tiles away is still inside");
});

test("leaving both regions restarts the ten minutes and moves the regions", () => {
  const owner = holder();
  const tolerance = new AggressionTolerance(owner);
  ticks(tolerance, new Location(1750, 3470, 0), 1001);
  assert.equal(tolerance.finished(), true);
  tolerance.update(new Location(1761, 3470, 0));
  assert.equal(tolerance.finished(), false, "11 tiles out of both");
  const state = owner.getAttribute(AggressionTolerance.ATTRIBUTE);
  assert.deepEqual([state.older, state.newer], [{ x: 1750, y: 3470, z: 0 }, { x: 1761, y: 3470, z: 0 }]);
  // Back by the first spot: still inside the older region, so the new timer keeps running.
  ticks(tolerance, new Location(1750, 3470, 0), 1000);
  assert.equal(tolerance.finished(), true);
  tolerance.update(new Location(1750, 3470, 1));
  assert.equal(tolerance.finished(), false, "another plane is outside");
});

test("the hunt range defaults to three tiles and can be overridden per NPC", () => {
  const definition = new NpcDefinition();
  assert.equal(definition.getHuntRange(), 3);
  definition.setHuntRange(9);
  assert.equal(definition.getHuntRange(), 9);
  definition.setHuntRange(-1);
  assert.equal(definition.getHuntRange(), 1, "a range below one would stop every hunt");
});

test("the state is a plain attribute, so a saved and reloaded player keeps their tolerance", () => {
  const before = holder();
  ticks(new AggressionTolerance(before), new Location(3100, 9830, 0), 1001);
  const after = holder();
  after.setAttribute(AggressionTolerance.ATTRIBUTE, JSON.parse(JSON.stringify(before.getAttribute(AggressionTolerance.ATTRIBUTE))));
  assert.equal(new AggressionTolerance(after).finished(), true, "logging out isn't leaving");
});
