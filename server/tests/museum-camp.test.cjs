// Run after `yarn build`: node --test tests/museum-camp.test.cjs
//
// Fossil Island's Museum Camp improvements against the Wiki (Museum Camp) and rsprox captures 73,
// local 1000187, 1000189 and 1000410 (rev 227), and the camp dog against capture 3033 (rev 231), with
// a real Player, Inventory and skills.
process.env.BROWSER_HOST = '1';
process.env.DISABLE_PLAYER_BOTS = '1';
const assert = require('node:assert/strict');
const { test, before } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { TaskManager } = require('../dist/game/task/TaskManager');

let Camp, core;
const hooks = {};
const npcHooks = {};

before(() => {
  CachePipeline.initialize();
  core = PluginManager.getCoreApi();
  const api = new Proxy({
    core,
    onObjectInteraction: (name, actions) => { hooks[name] = actions; },
    onNpcInteraction: (name, actions) => { npcHooks[name] = actions; },
    onPlayerLogin: (fn) => { hooks.login = fn; },
  }, { get: (target, key) => (key in target ? target[key] : () => {}) });
  Camp = require('../plugins/areas/MuseumCamp.plugin');
  Camp.register(api);
});

const obj = (name) => core.CacheDefinitions.getObjId(name);
const varbit = (name) => core.CacheDefinitions.getVarbitId(name);
const loc = (name) => ({ getId: () => core.CacheDefinitions.getLocId(name) });
const has = (p, name) => p.getInventory().getAmount(obj(name));

let nextIndex = 950;
function player(t, level = 99) {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const p = new Player(null);
  p.lines = [];
  p.boxes = [];
  p.anims = [];
  t.mock.method(p, 'getSession', () => ({ sendClientPacket: () => true, write: () => true }));
  t.mock.method(p.getInventory(), 'refreshItems', () => p.getInventory());
  t.mock.method(p, 'sendMessage', (m) => p.lines.push(m));
  t.mock.method(p, 'performAnimation', (a) => p.anims.push(a.getId()));
  t.mock.method(p, 'getDialogueManager', () => ({ startDialogues: (b) => { for (const d of b.getDialogues().values()) p.boxes.push(d.getText?.()); } }));
  p.setIndex(++nextIndex);
  p.setRegistered(true);
  t.after(() => p.setRegistered(false));
  p.getSkillManager().setCurrentLevel(core.Skill.CONSTRUCTION, level, false);
  return p;
}

const give = (p, name, n = 1) => p.getInventory().add(new core.Item(obj(name), n));

/** Build, then let the build tick pass. */
function build(p, name, option, locName) {
  const result = hooks[name][option]({ player: p, object: loc(locName) });
  TaskManager.process();
  TaskManager.process();
  return result;
}

const xp = (p) => p.getSkillManager().getExperience(core.Skill.CONSTRUCTION);

test('the spinning wheel: 4 oak planks and 5 nails with a hammer at 28 Construction, 1,000 XP (Wiki; recorded line and varbit)', (t) => {
  const p = player(t);
  give(p, 'hammer');
  give(p, 'plank_oak', 4);
  give(p, 'nails_iron', 5);
  const before = xp(p);
  assert.equal(hooks['Broken Spinning Wheel']['Build on']({ player: p, object: loc('fossil_spinning_wheel') }), true);
  assert.deepEqual(p.anims, [core.CacheDefinitions.getSeqId('human_poh_build')], 'the build animation at once');
  assert.equal(has(p, 'plank_oak'), 4, 'the materials go the tick after');
  TaskManager.process();
  TaskManager.process();
  assert.equal(p.lines.at(-1), 'You build the spinning wheel.');
  assert.equal(has(p, 'plank_oak'), 0);
  assert.equal(has(p, 'nails_iron'), 0);
  assert.equal(has(p, 'hammer'), 1, 'the hammer is kept');
  assert.equal(p.getPacketSender().getVarp(core.CacheDefinitions.getVarbit(varbit('fossil_spinning_wheel')).baseVar) & 16, 16, 'fossil_spinning_wheel (bit 4 of varp 1632, read by fossil_camp)');
  assert.equal(xp(p) - before, 1000);
  assert.deepEqual(p.getAttribute(Camp.BUILT_ATTRIBUTE), ['spinning-wheel']);
});

test('every improvement takes its Wiki level, materials and experience', (t) => {
  for (const b of Camp.DATA.builds) {
    const p = player(t, b.level);
    give(p, 'hammer');
    for (const [name] of b.tools) give(p, name);
    for (const [name, amount] of b.materials) give(p, name, amount);
    if (b.nails) give(p, 'nails', b.nails);
    const before = xp(p);
    build(p, b.name, b.option, b.loc);
    assert.equal(p.lines.at(-1), b.built, b.key);
    for (const [name] of b.materials) assert.equal(has(p, name), 0, `${b.key}: ${name} used`);
    for (const [name] of b.tools) assert.equal(has(p, name), 1, `${b.key}: ${name} kept`);
    assert.equal(has(p, 'nails'), 0, `${b.key}: nails used`);
    assert.equal(xp(p) - before, b.xp, b.key);
  }
  const expected = { 'bank-chest': [21, 250], well: [22, 500], 'cooking-pot': [24, 800], 'spinning-wheel': [28, 1000], loom: [29, 1000] };
  assert.deepEqual(Object.fromEntries(Camp.DATA.builds.map((b) => [b.key, [b.level, b.xp]])), expected);
});

test('below the level: the recorded line, as a game message and in a message box; nothing used', (t) => {
  const p = player(t, 27);
  give(p, 'hammer');
  give(p, 'plank_oak', 4);
  give(p, 'nails', 5);
  build(p, 'Broken Spinning Wheel', 'Build on', 'fossil_spinning_wheel');
  assert.deepEqual(p.lines, ['You need at least level 28 Construction to build that.']);
  assert.deepEqual(p.boxes, ['You need at least level 28 Construction to build that.']);
  assert.equal(has(p, 'plank_oak'), 4);
  assert.deepEqual(p.anims, []);
});

test('the cooking pot asks for a tinderbox first, then lists what is missing in the recorded order', (t) => {
  const p = player(t);
  give(p, 'hammer');
  build(p, 'Fire pit', 'Build on', 'fossil_range');
  assert.equal(p.lines.at(-1), 'You need a tinderbox to build the cooking pot.');
  give(p, 'tinderbox');
  build(p, 'Fire pit', 'Build on', 'fossil_range');
  assert.equal(p.lines.at(-1), 'You need 1 x Iron bar, 2 x Logs, 3 x Soft clay to build that.');
  assert.equal(p.boxes.at(-1), p.lines.at(-1));
  give(p, 'iron_bar');
  give(p, 'softclay', 3);
  build(p, 'Fire pit', 'Build on', 'fossil_range');
  assert.equal(p.lines.at(-1), 'You need 2 x Logs to build that.');
  give(p, 'logs', 2);
  build(p, 'Fire pit', 'Build on', 'fossil_range');
  assert.equal(p.lines.at(-1), 'You build the cooking pot.');
  assert.equal(has(p, 'tinderbox'), 1);
});

test('the well lists its oak planks, bucket and rope as recorded', (t) => {
  const p = player(t);
  give(p, 'hammer');
  give(p, 'nails', 5);
  build(p, 'Ring of Stones', 'Build on', 'fossil_well');
  assert.equal(p.lines.at(-1), 'You need 2 x Oak plank, 1 x Bucket, 1 x Rope to build that.');
  give(p, 'plank_oak', 2);
  build(p, 'Ring of Stones', 'Build on', 'fossil_well');
  assert.equal(p.lines.at(-1), 'You need 1 x Bucket, 1 x Rope to build that.');
});

test('a hammer is needed; an Imcando hammer counts', (t) => {
  const p = player(t);
  give(p, 'plank_oak', 4);
  give(p, 'nails', 5);
  build(p, 'Broken Spinning Wheel', 'Build on', 'fossil_spinning_wheel');
  assert.equal(p.lines.at(-1), 'You need a hammer to build that.');
  give(p, 'imcando_hammer');
  build(p, 'Broken Spinning Wheel', 'Build on', 'fossil_spinning_wheel');
  assert.equal(p.lines.at(-1), 'You build the spinning wheel.');
});

test('built improvements stay built: no second build, and their varbits are sent at login', (t) => {
  const p = player(t);
  give(p, 'hammer');
  give(p, 'plank_oak', 8);
  give(p, 'nails', 10);
  build(p, 'Broken Spinning Wheel', 'Build on', 'fossil_spinning_wheel');
  build(p, 'Broken Spinning Wheel', 'Build on', 'fossil_spinning_wheel');
  assert.equal(has(p, 'plank_oak'), 4, 'built once');
  const fresh = player(t);
  fresh.setAttribute(Camp.BUILT_ATTRIBUTE, ['well', 'loom']);
  const sent = new Map();
  t.mock.method(fresh.getPacketSender(), 'sendVarbit', (id, v) => { sent.set(id, v); return fresh.getPacketSender(); });
  hooks.login({ player: fresh });
  assert.deepEqual([...sent], [[varbit('fossil_well'), 1], [varbit('fossil_loom'), 1]]);
});

test('Build is only for the camp locs, not other locs of the same name', (t) => {
  const p = player(t);
  assert.equal(hooks['Ring of Stones']['Build on']({ player: p, object: { getId: () => 1 } }), false);
  assert.deepEqual(p.lines, []);
});

test('a build task cancelled before its tick (a cutscene, a bot) does not block later builds', (t) => {
  const p = player(t);
  give(p, 'hammer');
  give(p, 'plank_oak', 4);
  give(p, 'nails', 5);
  hooks['Broken Spinning Wheel']['Build on']({ player: p, object: loc('fossil_spinning_wheel') });
  TaskManager.cancelTasks(p);
  TaskManager.process();
  TaskManager.process();
  assert.equal(has(p, 'plank_oak'), 4, 'nothing built');
  build(p, 'Broken Spinning Wheel', 'Build on', 'fossil_spinning_wheel');
  assert.equal(p.lines.at(-1), 'You build the spinning wheel.');
});

// Real placed map object, movement, registered consumers and queued creation-menu input.
// Only the actors/channel and bounded world-phase scheduler are fixtures.
test('the personally built camp wheel is reachable and spins through ordinary object input', async (t) => {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const { ClientConnection } = require('../dist/net/NetworkBuilder');
  const { ObjectActionPacketListener } = require('../dist/net/packet/impl/ObjectActionPacketListener');
  const { CREATION_MENU_GROUP_ID, CREATION_MENU_FIRST_ITEM_COMPONENT } = require('../dist/net/packet/PacketSender');
  const Shared = require('../plugins/skills/crafting/Shared.Crafting');
  Camp.register(PluginManager.createApi('MuseumCamp'));
  require('../plugins/skills/Crafting.plugin').register(PluginManager.createApi('Crafting'));
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3732, 3823);
  const wheel = core.MapObjects.get(31431, new core.Location(3732, 3823), null);
  assert.ok(wheel, 'the actual placed parent');
  assert.equal(wheel.getType(), 10);
  assert.equal(wheel.getFace(), 3);
  const actors = [];
  t.after(() => {
    for (const p of actors) {
      Shared.stopCrafting(p);
      p.closeInterruptibleInterfaces();
      p.setRegistered(false);
      TaskManager.cancelTasks(p);
      TaskManager.cancelTasks(p.getIndex());
      p.getMovementQueue().reset();
      p.getMovementQueue().walkToReset();
    }
  });
  function actor() {
    const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
      send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
    const p = new Player(new PlayerSession(channel)).setUsername('campwheel' + nextIndex).setIndex(++nextIndex);
    p.setRegistered(true);
    p.setNeedsPlacement(false);
    p.setLocation(new core.Location(3731, 3822));
    p.getSkillManager().setCurrentLevel(core.Skill.CONSTRUCTION, 28, false);
    const c = new ClientConnection(channel);
    c.player = p;
    actors.push(p);
    return { p, c };
  }
  function turn(p, c) {
    p.resetUpdating();
    core.World.processCycle++;
    TaskManager.process();
    c.processTurnPackets();
    const q = p.getMovementQueue();
    q.beginCycle();
    q.processEntityPursuit();
    if (q.hasPendingWork()) q.process();
    TaskManager.processWalkTo(p.getIndex());
  }
  const { p, c } = actor(), inv = p.getInventory();
  give(p, 'hammer'); give(p, 'plank_oak', 4); give(p, 'nails', 5);
  const initialXp = xp(p);
  new ObjectActionPacketListener().executeAction(p, 31431, 3732, 3823, 0, 'Build on');
  for (let i = 0; i < 20 && !p.getAttribute(Camp.BUILT_ATTRIBUTE)?.includes('spinning-wheel'); i++) turn(p, c);
  assert.deepEqual(p.getAttribute(Camp.BUILT_ATTRIBUTE), ['spinning-wheel']);
  assert.equal(has(p, 'plank_oak'), 0); assert.equal(has(p, 'nails'), 0);
  assert.equal(has(p, 'hammer'), 1); assert.equal(xp(p) - initialXp, 1000);
  const built = core.ObjectDefinition.forPlayer(31431, p);
  assert.equal(built.id, 30934); assert.equal(built.getBlockingMask(), 27);
  assert.equal(core.RegionManager.getClipping(3733, 3823, 0, null), 131328, 'east approach is blocked');
  give(p, 'wool', 2);
  new ObjectActionPacketListener().executeAction(p, 31431, 3732, 3823, 0, 'Spin');
  for (let i = 0; i < 20 && !p.getCreationMenu(); i++) turn(p, c);
  assert.ok(p.getCreationMenu(), 'Spin must reach the personally built placed wheel');
  assert.ok(p.getLocation().getDistance(wheel.getLocation()) <= 1, 'an accessible adjacent approach');
  const child = p.getCreationMenu().getItems().indexOf(core.ItemIds.BALL_OF_WOOL);
  assert.ok(child >= 0);
  const craftXp = p.getSkillManager().getExperience(core.Skill.CRAFTING);
  await c.dispatch([{ type: 'dialogue_continue', widgetId: (CREATION_MENU_GROUP_ID << 16) |
    (CREATION_MENU_FIRST_ITEM_COMPONENT + child), childIndex: 1 }]);
  for (let i = 0; i < 6; i++) turn(p, c);
  assert.equal(inv.getAmount(core.ItemIds.BALL_OF_WOOL), 1);
  assert.equal(has(p, 'wool'), 1);
  assert.equal(p.getSkillManager().getExperience(core.Skill.CRAFTING) - craftXp, 2, 'integer XP getter for the existing 2.5 XP recipe');
  assert.equal(p.getSkillManager().getSkills().getExperiences()[core.Skill.CRAFTING.getIndex()], 2.5, 'stored recipe XP retains its fraction');
  // The other ordinary entry point must use the same approach, without bypassing movement.
  p.setLocation(new core.Location(3731, 3823));
  await c.dispatch([{ type: 'item_on_object', objectId: 31431, x: 3732, y: 3823,
    itemId: core.ItemIds.WOOL, slot: inv.getSlotForItemId(core.ItemIds.WOOL), widgetId: 149 << 16 }]);
  for (let i = 0; i < 8 && !p.getCreationMenu(); i++) turn(p, c);
  assert.ok(p.getCreationMenu(), 'carried wool on the built wheel also reaches its real menu');
  const nextChild = p.getCreationMenu().getItems().indexOf(core.ItemIds.BALL_OF_WOOL);
  await c.dispatch([{ type: 'dialogue_continue', widgetId: (CREATION_MENU_GROUP_ID << 16) |
    (CREATION_MENU_FIRST_ITEM_COMPONENT + nextChild), childIndex: 1 }]);
  turn(p, c);
  p.clearPendingAction();
  for (let i = 0; i < 6; i++) turn(p, c);
  assert.equal(has(p, 'wool'), 1, 'cancelling the real crafting session consumes nothing');
  assert.equal(inv.getAmount(core.ItemIds.BALL_OF_WOOL), 1);
  const other = actor(); give(other.p, 'wool');
  assert.notEqual(core.ObjectDefinition.forPlayer(31431, other.p).id, 30934, 'construction stays personal');
  new ObjectActionPacketListener().executeAction(other.p, 31431, 3732, 3823, 0, 'Spin');
  for (let i = 0; i < 8; i++) turn(other.p, other.c);
  assert.ok(!other.p.getCreationMenu());
  assert.equal(has(other.p, 'wool'), 1);
  for (const [subject, object, definition] of [
    [other.p, wheel, core.ObjectDefinition.forPlayer(31431, other.p)],
    [p, { getId: () => 1 }, built],
    [p, wheel, { getName: () => 'Broken Spinning Wheel' }],
  ]) {
    const event = { player: subject, object, objectId: object.getId(), definition };
    PluginManager.emitObjectRoute(event);
    assert.equal(event.approachRange, undefined, 'unbuilt and other object routes retain ordinary reach');
  }
});

test('the camp dog (NPC 7771): Pet plays the pickup animation and says the recorded line, the reply two ticks on (capture 3033)', (t) => {
  const p = player(t);
  const dog = { getId: () => core.NpcIdentifiers.DOG_2 };
  assert.equal(core.NpcIdentifiers.DOG_2, 7771);
  assert.equal(typeof npcHooks.Dog.Pet, 'function', 'Pet is hooked on the name Dog');
  assert.notEqual(npcHooks.Dog.Pet({ player: p, npc: dog }), false);
  assert.deepEqual(p.anims, [core.CacheDefinitions.getSeqId('human_pickupfloor')], 'animation 827 at once');
  assert.equal(core.CacheDefinitions.getSeqId('human_pickupfloor'), 827);
  assert.deepEqual(p.lines, ['You pet the dog...']);
  TaskManager.process();
  assert.deepEqual(p.lines, ['You pet the dog...'], 'nothing a tick later');
  TaskManager.process();
  assert.deepEqual(p.lines, ['You pet the dog...', 'He stretches out even further on the warm ground.']);
});

test('the camp dog declines any other Dog, leaving it to the Myths Guild and Final Dawn handlers', (t) => {
  const p = player(t);
  for (const id of [core.NpcIdentifiers.DOG_3, core.NpcIdentifiers.GUARD_DOG_3, undefined]) {
    assert.equal(npcHooks.Dog.Pet({ player: p, npc: { getId: () => id } }), false);
  }
  assert.equal(npcHooks.Dog.Pet({ player: p, npc: null }), false);
  TaskManager.process();
  TaskManager.process();
  assert.deepEqual(p.lines, []);
  assert.deepEqual(p.anims, []);
});
