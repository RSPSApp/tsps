// Real PluginManager + shipped cache/map regression for the shared "Singing bowl" name.
// Run after yarn build: node --test tests/remaining-goblin-glouphrie-bowl.test.cjs
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const ROOT = path.resolve(__dirname, '..');
const POG_STAGE = 'quest.the_path_of_glouphrie.stage';
const POG_BITS = 'quest.the_path_of_glouphrie.bits';
const BOWL = { raw: 49910, inspect: 49610, sing: 49611, eyes: 17239 };
const ITEM = { seed: 28575, chime: 28577, redCircle: 9597 };
const BOWL_TILE = { x: 2793, y: 4256 };

let PluginManager, core, Player, CacheDefinitions, ObjectDefinition, MapObjects, ObjectActionPacketListener, PathFinder;

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(ROOT);
  ({ PluginManager } = require('../dist/plugins/PluginManager'));
  ({ CacheDefinitions } = require('../dist/game/cache/CacheDefinitions'));
  ({ ObjectDefinition } = require('../dist/game/definition/ObjectDefinition'));
  ({ MapObjects } = require('../dist/game/entity/impl/object/MapObjects'));
  ({ ObjectActionPacketListener } = require('../dist/net/packet/impl/ObjectActionPacketListener'));
  ({ PathFinder } = require('../dist/game/model/movement/path/PathFinder'));
  PluginManager.loadPluginSwitches = () => ({ switches: new Map() });
  const quiet = [console.log, console.info, console.debug, console.warn];
  console.log = console.info = console.debug = console.warn = () => {};
  try {
    PluginManager.loadFromDirectory(path.join(ROOT, 'plugins'));
    core = PluginManager.getCoreApi();
    core.RegionManager.init();
  } finally {
    [console.log, console.info, console.debug, console.warn] = quiet;
  }
  ({ Player } = require('../dist/game/entity/impl/player/Player'));
  core.RegionManager.loadMapFiles(BOWL_TILE.x, BOWL_TILE.y);
});


function player(stage = 14, bits = (1 << 8) | (1 << 9) | (1 << 10)) {
  const p = new Player(null);
  p.setUsername(`bowl${stage}${Math.random().toString(36).slice(2, 6)}`);
  p.setLocation(new core.Location(2793, 4255, 0));
  const sent = { messages: [], varbits: new Map(), varps: new Map() };
  const sender = {
    sendVarbit(id, value) {
      sent.varbits.set(id, value);
      const bit = CacheDefinitions.getVarbit(id);
      if (bit) {
        const mask = (1 << (bit.endBit - bit.startBit + 1)) - 1;
        const current = sent.varps.get(bit.baseVar) ?? 0;
        sent.varps.set(bit.baseVar, (current & ~(mask << bit.startBit)) | ((value & mask) << bit.startBit));
      }
      return sender;
    },
    getVarbit(id) {
      const bit = CacheDefinitions.getVarbit(id);
      if (!bit) return 0;
      const mask = (1 << (bit.endBit - bit.startBit + 1)) - 1;
      return ((sent.varps.get(bit.baseVar) ?? 0) >> bit.startBit) & mask;
    },
    getVarp(id) { return sent.varps.get(id) ?? 0; },
  };
  const packet = new Proxy(sender, {
    get: (target, key) => (key in target ? target[key] : (...args) => packet),
  });
  p.getPacketSender = () => packet;
  p.sendMessage = (text) => sent.messages.push(text);
  p.isRegistered = () => true;
  p.setAttribute(POG_STAGE, stage);
  p.setAttribute(POG_BITS, bits);
  return { p, sent };
}

/** The real map raw loc, and the child definition the server resolves for this player. */
function realBowlObject(p) {
  const raw = MapObjects.getPrivateArea(p, BOWL.raw, new core.Location(BOWL_TILE.x, BOWL_TILE.y, 0));
  assert.ok(raw, 'raw 49910 exists on the shipped map');
  assert.equal(raw.getId(), BOWL.raw, 'listener passes the placed parent id');
  const definition = ObjectDefinition.forPlayer(raw.getId(), p);
  assert.equal(definition.getName(), 'Singing bowl');
  return { raw, definition };
}

function objectEvent(p) {
  const { raw, definition } = realBowlObject(p);
  return {
    player: p, object: raw, objectId: raw.getId(), definition,
    clickType: 1, handled: false,
  };
}

function itemEvent(p, itemId) {
  const { raw } = realBowlObject(p);
  return {
    player: p, object: raw, objectId: raw.getId(), item: { getId: () => itemId },
    itemId, itemSlot: 0, handled: false,
  };
}

test('real raw 49910 resolves to the player bowl, makes the chime and keeps Eyes 17239 separate', () => {
  const { p, sent } = player();
  p.getInventory().adds(ITEM.seed, 1);

  const inspect = objectEvent(p);
  assert.equal(inspect.definition.getInteractions()[0], 'Inspect');
  assert.equal(PluginManager.emitObjectInteraction(inspect), true);
  assert.equal(p.getAttribute(POG_BITS) & (1 << 0), 1 << 0);
  assert.equal(sent.varbits.get(15289), 1);
  assert.equal(ObjectDefinition.forPlayer(BOWL.raw, p).id, BOWL.sing, 'current definition follows per-player varbit');

  PluginManager.emitItemOnObject(itemEvent(p, ITEM.redCircle));
  assert.equal(p.getInventory().getAmount(ITEM.chime), 0, 'wrong disc does not make the chime');

  assert.equal(PluginManager.emitItemOnObject(itemEvent(p, ITEM.seed)), true);
  assert.equal(p.getInventory().getAmount(ITEM.seed), 0);
  assert.equal(p.getInventory().getAmount(ITEM.chime), 1);
  assert.equal(sent.varbits.get(15290), 1);
  assert.equal(Number(p.getAttribute(POG_STAGE)), 16, 'chime + diary reaches machine-ready');

  PluginManager.emitItemOnObject(itemEvent(p, ITEM.seed));
  assert.equal(p.getInventory().getAmount(ITEM.chime), 1, 'repeated use does not duplicate the chime');

  const eyes = (() => {
    const raw = MapObjects.getPrivateArea(p, BOWL.eyes, new core.Location(2793, 4252, 0));
    if (!raw) return null;
    return { player: p, object: raw, objectId: raw.getId(), definition: ObjectDefinition.forPlayer(raw.getId(), p), clickType: 1, handled: false };
  })();
  if (eyes) assert.equal(PluginManager.emitObjectInteraction(eyes), true, 'Eyes bowl still handled');
});

test('two players keep independent bowl bits, and making the chime early cannot skip diary stages', () => {
  const a = player(14);
  const b = player(6, 0);
  assert.equal(ObjectDefinition.forPlayer(BOWL.raw, a.p).id, BOWL.inspect);
  assert.equal(ObjectDefinition.forPlayer(BOWL.raw, b.p).id, BOWL.inspect);

  PluginManager.emitObjectInteraction(objectEvent(a.p));
  assert.equal(a.sent.varbits.get(15289), 1);
  assert.equal(ObjectDefinition.forPlayer(BOWL.raw, a.p).id, BOWL.sing);
  assert.equal(ObjectDefinition.forPlayer(BOWL.raw, b.p).id, BOWL.inspect, 'player B bowl is unchanged');

  b.p.getInventory().adds(ITEM.seed, 1);
  PluginManager.emitItemOnObject(itemEvent(b.p, ITEM.seed));
  assert.equal(b.p.getInventory().getAmount(ITEM.chime), 1);
  assert.equal(Number(b.p.getAttribute(POG_STAGE)), 6, 'early chime does not skip diary stages');
});

test('real ObjectActionPacketListener resolves the raw 49911 key chest before POG dispatch', () => {
  const { p } = player(10, 1 << 12);
  p.setLocation(new core.Location(2786, 4261, 0));
  p.setAttribute('the-path-of-glouphrie:monoliths', JSON.stringify([
    [2788, 4246], [2787, 4254], [2790, 4253], [2788, 4256], [2791, 4257],
  ]));
  const messages = [];
  const sender = new Proxy({
    getVarbit: (id) => (id === 15288 ? 10 : 0),
    getVarp: () => 0,
    sendVarbit: () => {},
  }, { get: (target, key) => (key in target ? target[key] : () => sender) });
  p.getPacketSender = () => sender;
  p.getMovementQueue = () => ({
    reset() { return this; },
    walkToReset() { return this; },
    walkToObject(_object, options) { options.execute(); return true; },
  });
  p.busy = () => false;
  p.sendMessage = (text) => messages.push(text);

  new ObjectActionPacketListener().executeAction(p, 49615, 2785, 4261, 1);
  assert.equal(p.getInventory().getAmount(28573), 1, 'Chest key is earned through the real listener');
  assert.equal(p.getInventory().getAmount(28579), 1, "Yewnock's notes are earned once");

  new ObjectActionPacketListener().executeAction(p, 49615, 2785, 4261, 1);
  assert.equal(p.getInventory().getAmount(28573), 1, 'repeat click does not duplicate the key');

  // The same listener path at the golden chest stays gated by order/position.
  new ObjectActionPacketListener().executeAction(p, 49612, 2789, 4258, 1);
  assert.equal(p.getInventory().getAmount(28574), 0, 'golden chest is not blanket-opened');
});

test('sewer ladders clear queued walks and land on the captured tile both directions', () => {
  const down = player(42, 0);
  down.p.setLocation(new core.Location(1530, 4236, 1));
  down.p.getMovementQueue().walkStep(1, 0); // queued normal walk that used to win
  const downObject = MapObjects.get(49701, new core.Location(1529, 4236, 1), null);
  assert.ok(downObject, 'down ladder exists on the shipped map');
  const downRequest = { player: down.p, object: downObject, objectId: 49701, clickType: 3, handled: false };
  PluginManager.emitCustomEvent('ladders:climb', downRequest);
  assert.equal(downRequest.handled, true, 'POG claims the sewer ladder before the generic landing');
  for (let tick = 0; tick < 4; tick++) core.TaskManager.process();
  assert.deepEqual([down.p.getLocation().getX(), down.p.getLocation().getY(), down.p.getLocation().getZ()], [1529, 4236, 0], 'down lands on the captured tile after several ticks');
  assert.equal(PathFinder.findWalkable(down.p, 1529, 4252, 1), true, 'lower landing can walk to the next ladder');

  const up = player(42, 0);
  up.p.setLocation(new core.Location(1479, 4239, 0));
  up.p.getMovementQueue().walkStep(0, 1);
  const upObject = MapObjects.get(49700, new core.Location(1479, 4239, 0), null);
  assert.ok(upObject, 'up ladder exists on the shipped map');
  const upRequest = { player: up.p, object: upObject, objectId: 49700, clickType: 1, handled: false };
  PluginManager.emitCustomEvent('ladders:climb', upRequest);
  assert.equal(upRequest.handled, true);
  for (let tick = 0; tick < 4; tick++) core.TaskManager.process();
  assert.deepEqual([up.p.getLocation().getX(), up.p.getLocation().getY(), up.p.getLocation().getZ()], [1479, 4239, 1]);
  assert.equal(PathFinder.findWalkable(up.p, 1484, 4238, 1), true, 'upper landing can reach the gate corridor');
});

test('POG completed Hazelmere uses the canonical Path postquest variant without re-rewarding', () => {
  const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
  new NpcDefinitionLoader().load();
  const { p } = player(50, 0);
  p.setAttribute('quest.the_path_of_glouphrie.lamps', 4);
  p.setLocation(new core.Location(2678, 3086, 1));
  const messages = [];
  p.sendMessage = (text) => messages.push(text);
  const skills = [core.Skill.MAGIC, core.Skill.STRENGTH, core.Skill.SLAYER, core.Skill.THIEVING];
  const xpBefore = skills.map((skill) => p.getSkillManager().getExperience(skill));
  const handled = PluginManager.emitNpcInteraction({
    player: p,
    npc: { getId: () => 1422 },
    npcId: 1422,
    clickType: 1,
    definition: { getName: () => 'Hazelmere', getActions: () => ['Talk-to'] },
    handled: false,
  });
  assert.equal(handled, true, 'Hazelmere Talk-to is handled by POG');
  assert.equal(p.getDialogueManager().isActive(), true, 'the shipped Path postquest dialogue starts');
  assert.equal(messages.some((line) => /conversation isn't available/.test(line)), false);
  for (const lamp of [28587, 28588, 28589, 28590]) assert.equal(p.getInventory().getAmount(lamp), 0, 'no lamp re-award');
  assert.equal(p.getAttribute('quest.the_path_of_glouphrie.lamps'), 4, 'lamp claim count unchanged');
  assert.deepEqual(skills.map((skill) => p.getSkillManager().getExperience(skill)), xpBefore, 'no XP re-awarded');
});
