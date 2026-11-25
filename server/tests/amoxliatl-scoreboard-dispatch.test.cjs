// Run after `npx tsc --build`: node --test tests/amoxliatl-scoreboard-dispatch.test.cjs
//
// Amoxliatl's Ancient tablet through the real plugins: every plugin loaded, the click dispatched
// by PluginManager with the loc's per-player definition, her door making a real chamber, and
// deaths through PlayerDeath's own every-death hook (onPlayerDefeated).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, before, after } = require('node:test');

const ROOT = path.join(__dirname, '..');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

let PluginManager, core, ObjectDefinition, MapObjects, Player, Location, Chamber, Scoreboard, quest;
const BOARD_TILE = [1616, 9635, 0];
const DOOR_TILE = [1601, 9630, 0];
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'amoxliatl-dispatch-'));
let index = 2000;

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(ROOT);
  ({ PluginManager } = require('../dist/plugins/PluginManager'));
  ({ ObjectDefinition } = require('../dist/game/definition/ObjectDefinition'));
  ({ MapObjects } = require('../dist/game/entity/impl/object/MapObjects'));
  ({ Location } = require('../dist/game/model/Location'));
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
  Chamber = require('../plugins/bosses/amoxliatl/Chamber.Amoxliatl');
  Scoreboard = require('../plugins/bosses/amoxliatl/Scoreboard.Amoxliatl');
  Scoreboard._useFile(path.join(scratch, 'world.json'));
  quest = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find((q) => q.key === 'the_heart_of_darkness');
  core.RegionManager.loadMapFiles(BOARD_TILE[0], BOARD_TILE[1]);
});

after(() => fs.rmSync(scratch, { recursive: true, force: true }));

/** A real player past The Heart of Darkness by the tablet, with the network and messages stubbed. */
function reader(t) {
  const p = new Player(null);
  p.setIndex(index++);
  p.setRegistered(true);
  // Kept past the test (not t.mock), so tasks the site leaves queued still have a network to stub.
  p.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  t.mock.method(p, 'sendMessage', () => {});
  p.setLocation(new Location(1615, 9635, 0));
  quest.setStage(p, quest.completionValue ?? 2);
  const sender = p.getPacketSender();
  p.sent = { interfaces: [], texts: new Map() };
  const original = { sendInterface: sender.sendInterface, sendString: sender.sendString };
  t.mock.method(sender, 'sendInterface', function (id) { p.sent.interfaces.push(id); return original.sendInterface.apply(this, arguments); });
  t.mock.method(sender, 'sendString', function (text, uid) { p.sent.texts.set(uid, text); return original.sendString.apply(this, arguments); });
  return p;
}

/** The option the player's own view of a placed loc shows at `clickType`, dispatched as a click packet is. */
function click(p, id, [x, y, z], clickType = 1) {
  const object = MapObjects.get(id, new Location(x, y, z), null);
  assert.ok(object, `loc ${id} at ${x},${y}`);
  const definition = ObjectDefinition.forPlayer(object.getId(), p);
  const event = { player: p, object, objectId: object.getId(), definition, clickType, location: { x, y, z }, handled: false };
  PluginManager.emitObjectInteraction(event);
  return { event, definition };
}

const BOARD = () => core.CacheDefinitions.getLocId('amoxliatl_scoreboard');
const INTERFACE = () => core.CacheDefinitions.getInterfaceId('amoxliatl_scoreboard');
const text = (p, component) => p.sent.texts.get((INTERFACE() << 16) | component);
const tick = (n) => { for (let i = 0; i < n; i++) core.TaskManager.process(); };

test('the tablet reads through PluginManager with its per-player "Ancient tablet": Read definition', (t) => {
  const p = reader(t);
  const { event, definition } = click(p, BOARD(), BOARD_TILE);
  assert.equal(definition.getName(), 'Ancient tablet');
  assert.equal(definition.getInteractions()[0], 'Read');
  assert.equal(event.handled, true);
  assert.deepEqual(p.sent.interfaces, [INTERFACE()]);
  assert.equal(text(p, 6), 'Amoxliatl Statistics');
});

test('a death in a real chamber counts, as onPlayerDefeated hears it', (t) => {
  const p = reader(t);
  p.setLocation(new Location(1600, 9631, 0));
  const { event } = click(p, core.CacheDefinitions.getLocId('vmq3_ruins_door_multi') ?? 55355, DOOR_TILE);
  assert.equal(event.handled, true, 'the door made her chamber');
  tick(8);
  const session = Chamber.sessionOf(p);
  assert.ok(session && p.getPrivateArea() === session.area, 'the player is in it');
  PluginManager.emitPlayerDefeated(null, p);
  assert.equal(p.getAttribute(Scoreboard.DEATHS_ATTRIBUTE), 1);
  Chamber.leave(p);
  tick(2);
  PluginManager.emitPlayerDefeated(null, p); // outside again
  assert.equal(p.getAttribute(Scoreboard.DEATHS_ATTRIBUTE), 1);
  p.setLocation(new Location(1615, 9635, 0));
  click(p, BOARD(), BOARD_TILE);
  assert.equal(text(p, 11), '1');
});

test("a logout between the quest guardian's 0 HP and the teleport keeps the won fight", (t) => {
  const p = reader(t);
  const S = { FIGHT: 72, BANISHED: 74 };
  quest.setStage(p, S.FIGHT);
  PluginManager.emitCustomEvent('amoxliatl:quest-fight', { player: p, handled: false });
  tick(8);
  const session = Chamber.sessionOf(p);
  assert.ok(session?.quest && session.boss, 'her quest fight is on');
  session.boss.setHitpoints(0);
  session.boss.appendDeath();
  assert.equal(quest.getStage(p), S.BANISHED, 'the quest moves on at 0 HP');
  assert.equal(p.getMovementQueue().isMovementBlocked(), true, 'held for the banishment');
  tick(2);
  // A logout's first step (Player.onLogout): the area's leave, as the area's plugin.
  PluginManager.callArea(p.getArea(), 'leave', p, true);
  assert.equal(Chamber.sessionOf(p), null);
  assert.equal(quest.getStage(p), S.BANISHED);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [1615, 3211, 0], 'saved where she banishes you');
  assert.equal(p.getMovementQueue().isMovementBlocked(), false, 'the hold is given back');
  tick(6);
  assert.equal(quest.getStage(p), S.BANISHED, 'nothing runs after the logout');
});

test("a death in the quest's own fight in her chamber is not counted", (t) => {
  const p = reader(t);
  PluginManager.emitCustomEvent('amoxliatl:quest-fight', { player: p, handled: false });
  tick(8);
  const session = Chamber.sessionOf(p);
  assert.ok(session?.quest && p.getPrivateArea() === session.area, 'in the quest chamber');
  PluginManager.emitPlayerDefeated(null, p);
  assert.equal(p.getAttribute(Scoreboard.DEATHS_ATTRIBUTE) ?? 0, 0);
  Chamber.leave(p);
  tick(2);
});
