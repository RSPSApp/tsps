// Run after yarn build: node --test tests/castlewars-mining.test.cjs
const assert = require('node:assert/strict');
const { before, beforeEach, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { ObjectActionPacketListener } = require('../dist/net/packet/impl/ObjectActionPacketListener');
const Mining = require('../plugins/skills/Mining.plugin');
const Tunnels = require('../plugins/minigames/castlewars/Tunnels.CastleWars');
const core = PluginManager.getCoreApi();
let game, tasks = [], playing = true, rockHooks, nextPlayerIndex = 1;

before(() => {
  CachePipeline.initialize();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(2401, 9494);
  const api = PluginManager.createApi('CastleWarsMiningTest');
  api.getTaskManager = () => ({ submit(task) { tasks.push(task); core.TaskManager.submit(task); } });
  Mining.register(api);
  game = require('../plugins/minigames/castlewars/Game.CastleWars')(api);
  game.isPlaying = () => playing;
  game.requirePlaying = () => playing;
  game.gameArea = { getPlayers: () => [] };
  Tunnels(api, game);
  rockHooks = [...PluginManager.objectHooksByName.get('Rocks')];
});

beforeEach(() => {
  tasks = [];
  playing = true;
  PluginManager.objectHooksByName.set('Rocks', [...rockHooks]);
});

function tick(count = 1) {
  while (count-- > 0) for (const task of [...tasks]) task.tick();
}

function miner(t, { id = core.ItemIdentifiers.BRONZE_PICKAXE, level = 1, equipped = false,
  rockAt = [2401, 9494], at = [2401, 9493] } = {}) {
  const p = new Player(null, new core.Location(...at, 0));
  p.setIndex(nextPlayerIndex++);
  p.setRegistered(true);
  p.messages = [];
  t.mock.method(p, 'getSession', () => ({ sendClientPacket() {}, write() {} }));
  t.mock.method(p, 'sendMessage', (text) => p.messages.push(text));
  p.getSkillManager().setCurrentLevel(core.Skill.MINING, level);
  if (id > 0) {
    if (equipped) p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(id));
    else p.getInventory().add(new core.Item(id));
  }
  const location = new core.Location(...rockAt, 0);
  const original = core.MapObjects.get(core.ObjectIdentifiers.ROCKS_21, location, null);
  assert.ok(original, 'cache supplies the two-by-two Castle Wars rocks');
  t.after(() => {
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
    for (const rockId of [core.ObjectIdentifiers.ROCKS_21, core.ObjectIdentifiers.ROCKS_22]) {
      const object = core.MapObjects.get(rockId, location, null);
      if (object) core.ObjectManager.deregister(object, true);
    }
    core.ObjectManager.register(original, true);
  });
  function click() {
    new ObjectActionPacketListener().executeAction(p, original.getId(), ...rockAt, 1);
    p.getMovementQueue().process();
    core.TaskManager.processWalkTo(p.getIndex());
  }
  return { p, original, click, full: () => core.MapObjects.get(core.ObjectIdentifiers.ROCKS_21, location, null),
    half: () => core.MapObjects.get(core.ObjectIdentifiers.ROCKS_22, location, null) };
}

test('native Mine starts continuous bronze mining from inventory and clears both layers over time', (t) => {
  const m = miner(t);
  m.click();
  assert.equal(tasks.length, 1, 'the normal dispatcher starts mining despite generic Rocks handlers');
  assert.equal(m.full(), m.original, 'a click does not instantly clear a layer');
  assert.equal(m.p.getAnimation().getId(), Mining.PICKAXES.find(p => p.id === core.ItemIdentifiers.BRONZE_PICKAXE).animation.getId());
  tick(7);
  assert.equal(m.full(), m.original);
  tick();
  assert.equal(m.full(), null);
  assert.ok(m.half());
  tick(8);
  assert.equal(m.half(), null, 'the same action finishes the half pile without another click');
  assert.equal(game.getTeamVar(game.TEAM.SARADOMIN, game.TEAM_VARBIT.TUNNEL_NS_CLEAR), 1);
});

test('rune mining uses its canonical shorter interval and works when equipped', (t) => {
  const m = miner(t, { id: core.ItemIdentifiers.RUNE_PICKAXE, level: 41, equipped: true });
  m.click();
  tick(2);
  assert.ok(m.full());
  tick();
  assert.ok(m.half());
  tick(3);
  assert.equal(m.half(), null);
});

test('carrying both level-one pickaxes selects faster iron over bronze', (t) => {
  const m = miner(t);
  m.p.getInventory().add(new core.Item(core.ItemIdentifiers.IRON_PICKAXE));
  assert.equal(Mining.findBestPickaxe(m.p).id, core.ItemIdentifiers.IRON_PICKAXE);
  m.click();
  tick(6);
  assert.ok(m.full());
  tick();
  assert.ok(m.half());
});

test('the generic depleted-rock handler yields to Castle Wars in either registration order', (t) => {
  for (const reversed of [false, true]) {
    const hooks = [...rockHooks];
    if (reversed) hooks.reverse();
    const orders = rockHooks.map(h => h.order).sort((a, b) => a - b);
    PluginManager.objectHooksByName.set('Rocks', hooks.map((h, i) => ({ ...h, order: orders[i] })));
    const m = miner(t);
    m.click();
    assert.equal(tasks.length, reversed ? 2 : 1);
    assert.equal(m.p.messages.some(text => /no ore/.test(text)), false);
    tasks.at(-1).stop();
  }
});

test('ordinary depleted rocks still say no ore, and a new scenery interaction cancels tunnel mining', (t) => {
  const m = miner(t);
  const empty = new core.GameObject(core.CacheDefinitions.getLocId('rocks1'), m.original.getLocation(), 10, 0, null);
  const event = { player: m.p, object: empty, objectId: empty.getId(), clickType: 1, handled: false };
  assert.equal(PluginManager.emitObjectInteraction(event), true);
  assert.match(m.p.messages.at(-1), /no ore/);
  m.click();
  const task = tasks.at(-1);
  assert.equal(task.isRunning(), true);
  new ObjectActionPacketListener().executeAction(m.p, core.ObjectIdentifiers.CAVE_WALL, 2400, 9493, 1);
  assert.equal(task.isRunning(), false, 'normal scenery routing cancels the miner by its player index');
  assert.equal(m.p.getAnimation().getId(), core.Animation.DEFAULT_RESET_ANIMATION.getId());
  tick(16);
  assert.equal(m.full(), m.original);
});

test('all four cache rock piles can be mined from both valid tunnel approaches', (t) => {
  for (const [rockAt, approaches] of [
    [[2401, 9494], [[2401, 9493], [2401, 9496]]],
    [[2400, 9512], [[2400, 9511], [2400, 9514]]],
    [[2409, 9503], [[2408, 9503], [2411, 9503]]],
    [[2391, 9501], [[2390, 9501], [2393, 9501]]],
  ]) for (const at of approaches) {
    const m = miner(t, { rockAt, at });
    m.click();
    assert.equal(m.p.messages.some(text => /can't reach/.test(text)), false);
    assert.ok(tasks.at(-1)?.isRunning(), `${rockAt} from ${at}`);
    tasks.at(-1).stop();
  }
});

test('unusable pickaxes are rejected, and losing a pickaxe stops mining without clearing rocks', (t) => {
  const denied = miner(t, { id: core.ItemIdentifiers.RUNE_PICKAXE });
  denied.click();
  assert.equal(tasks.length, 0);
  assert.match(denied.p.messages.at(-1), /pickaxe/);
  const m = miner(t);
  m.click();
  m.p.getInventory().delete(core.ItemIdentifiers.BRONZE_PICKAXE, 1);
  tick(16);
  assert.equal(m.full(), m.original);
  assert.equal(tasks.at(-1).isRunning(), false);
});

test('walking, logout, match end or replacement of the rocks interrupts mining', (t) => {
  for (const interrupt of [
    m => m.p.getMovementQueue().walkStep(0, -1),
    m => m.p.setRegistered(false),
    () => { playing = false; },
    m => { core.ObjectManager.deregister(m.original, true); },
  ]) {
    const m = miner(t);
    m.click();
    interrupt(m);
    tick(16);
    assert.equal(tasks.at(-1).isRunning(), false);
    assert.equal(m.half(), null);
    playing = true;
    if (!m.full()) core.ObjectManager.register(m.original, true);
  }
});

test('a pickaxe collapses a cleared tunnel through the native cave-wall option without consuming the tool', (t) => {
  const m = miner(t, { id: core.ItemIdentifiers.RUNE_PICKAXE, level: 41 });
  m.click(); tick(6);
  assert.equal(m.full(), null); assert.equal(m.half(), null);
  const wall = core.MapObjects.get(core.ObjectIdentifiers.CAVE_WALL, new core.Location(2400, 9493, 0), null);
  assert.ok(wall, 'collapse wall is supplied by the cache');
  new ObjectActionPacketListener().executeAction(m.p, wall.getId(), 2400, 9493, 1);
  m.p.getMovementQueue().process(); core.TaskManager.processWalkTo(m.p.getIndex());
  tick(3);
  assert.ok(m.full(), 'mining the cave wall restores the full rock pile');
  assert.equal(m.p.getInventory().getAmount(core.ItemIdentifiers.RUNE_PICKAXE), 1);
  assert.equal(game.getTeamVar(game.TEAM.SARADOMIN, game.TEAM_VARBIT.TUNNEL_NS_CLEAR), 0);
});
