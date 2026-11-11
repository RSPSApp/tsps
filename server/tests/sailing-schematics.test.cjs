const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
process.env.DISABLE_PLAYER_BOTS = '1';
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PM.getCoreApi();
  core.RegionManager.init();
  PM.loadPluginSwitches = () => ({ switches: new Map() });
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core.RegionManager.loadMapFiles(3050, 2995);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));
let nextIndex = 2100;
function lifecycle(p) { return { player: p, username: p.getUsername(), isNewAccount: false }; }
function player(t) {
  const p = new Player(null);
  p.setIndex(nextIndex++);
  p.setUsername(`schematicqa${nextIndex}`);
  p.setLocation(new core.Location(3050, 2995, 0));
  t.mock.method(p, 'getSession', () => ({ sendClientPacket() { return true; }, write() { return true; } }));
  p.messages = [];
  t.mock.method(p, 'sendMessage', text => p.messages.push(text));
  p.setRegistered(true);
  p.setHitpoints(10);
  p.needsPlacement = false;
  t.after(() => { PM.emitPlayerLogout(lifecycle(p)); p.setRegistered(false); });
  return p;
}
function read(p, slot) {
  const item = p.getInventory().getItems()[slot];
  ClientConnection.prototype.inventoryAction.call({ player: p }, {
    type: 'inventory_action', widgetId: core.CacheDefinitions.getComponentId('inventory:items'),
    slot, itemId: item.getId(), option: 'Read',
  });
}
test('a fresh login keeps all twelve schematic recipes locked', t => {
  const p = player(t);
  PM.emitPlayerLogin(lifecycle(p));
  for (const name of require('../plugins/skills/sailing/data/lost-schematics.json').map(row => row.learned)) {
    assert.equal(p.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId(name)), 0, name);
  }
});
test('native Read consumes only the clicked schematic and learns its recipe', t => {
  const p = player(t);
  const id = core.CacheDefinitions.getObjId('lost_schematic_salvaging_station');
  p.getInventory().setItem(0, new core.Item(id));
  p.getInventory().setItem(1, new core.Item(id, 1, { preserved: ['metadata'] }));
  const preserved = p.getInventory().getItems()[1];
  read(p, 0);
  assert.equal(p.getInventory().getAmount(id), 1);
  assert.equal(p.getInventory().getItems()[1], preserved);
  assert.equal(p.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId('lost_schematic_salvaging_station')), 1);
});
function quest(key) { return require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(q => q.key === key); }
function avaMessage(p) {
  const event = { player: p, npcId: core.NpcIdentifiers.AVA, stepId: 'xcs6-R', kind: 'message', handled: false };
  PM.emitCustomEvent('npc-dialogue:action', event);
  return event;
}
test('Ava canonical handout is gated by both quests and grants a reclaimable physical schematic', t => {
  const p = player(t), id = core.CacheDefinitions.getObjId('lost_schematic_ballistic_attractor');
  const sender = p.getPacketSender(), packets = [];
  const send = sender.sendItemContainer;
  t.mock.method(sender, 'sendItemContainer', function(...args) { packets.push(args); return send.apply(this, args); });
  avaMessage(p); assert.equal(p.getInventory().getAmount(id), 0);
  quest('animal_magnetism').setStage(p, quest('animal_magnetism').completionValue);
  avaMessage(p); assert.equal(p.getInventory().getAmount(id), 0);
  quest('pandemonium').setStage(p, quest('pandemonium').completionValue);
  avaMessage(p); assert.equal(p.getInventory().getAmount(id), 1);
  assert.ok(packets.length > 0, 'physical handout refreshes the real inventory on the client');
  avaMessage(p); assert.equal(p.getInventory().getAmount(id), 1);
});
test('a full inventory prevents Ava handout without claiming she gave an item', t => {
  const p = player(t);
  for (const key of ['animal_magnetism', 'pandemonium']) quest(key).setStage(p, quest(key).completionValue);
  const knife = core.CacheDefinitions.getObjId('knife');
  for (let i = 0; i < 28; i++) p.getInventory().setItem(i, new core.Item(knife));
  const event = avaMessage(p);
  assert.equal(p.getInventory().getAmount(core.CacheDefinitions.getObjId('lost_schematic_ballistic_attractor')), 0);
  assert.equal(event.end, true);
  assert.equal(event.handled, true);
});

test('directions Read preserves the item and displays its own clue', t => {
  const row = require('../plugins/skills/sailing/data/lost-schematics.json')[0], p = player(t);
  p.getInventory().setItem(0, new core.Item(core.CacheDefinitions.getObjId(row.box.hintItem)));
  const seen = [];
  t.mock.method(require('../plugins/skills/sailing/schematics/Common.Schematics'), 'itemBox', (who, id, text) => seen.push(text));
  read(p, 0);
  assert.deepEqual(seen, [row.box.directions]);
  assert.equal(p.getInventory().getAmount(core.CacheDefinitions.getObjId(row.box.hintItem)), 1);
});

test('bootstrap restores learned recipes after client defaults and preserves sibling flags', t => {
  const p = player(t), common = require('../plugins/skills/sailing/schematics/Common.Schematics');
  const row = common.rows()[0];
  common.markLearned(p, row);
  p.getPacketSender().sendVarbit(row.learnedVarbit, 0);
  PM.emitCustomEvent('player:bootstrap-complete', { player: p });
  assert.equal(p.getPacketSender().getVarbit(row.learnedVarbit), 1);
});

test('Elder Raley reclaims only a missing unread postquest schematic', t => {
  const p = player(t), id = core.CacheDefinitions.getObjId('lost_schematic_bosuns_workbench');
  const npc = core.NPC.create(core.NpcIdentifiers.ELDER_RALEY, p.getLocation().clone());
  const talk = () => PM.emitNpcInteraction({ player: p, npc, clickType: 1, handled: false });
  talk(); assert.equal(p.getInventory().getAmount(id), 0);
  quest('the_red_reef').setStage(p, quest('the_red_reef').completionValue);
  talk(); assert.equal(p.getInventory().getAmount(id), 1);
  talk(); assert.equal(p.getInventory().getAmount(id), 1);
});

test('native shipyard build refuses unlearned rosewood then consumes materials after Read', t => {
  const parts = require('../plugins/skills/sailing/BoatParts.Sailing');
  const shipyard = require('../plugins/skills/sailing/Shipyard.Sailing');
  const common = require('../plugins/skills/sailing/schematics/Common.Schematics');
  const row = common.rows().find(row => row.key === 'rosewood_hull');
  for (const learn of [false, true]) {
    const p = player(t);
    p.getSkillManager().setLevel(core.Skill.SAILING, 99);
    p.getSkillManager().setLevel(core.Skill.CONSTRUCTION, 99);
    if (learn) { p.getInventory().setItem(0, new core.Item(row.itemId)); read(p, 0); assert.equal(common.learned(p, row), true, JSON.stringify(p.messages)); p.getPacketSender().sendInterfaceRemoval(); }
    core.Sailing.giveBoat(p, 'skiff', 'the_pandemonium');
    shipyard.beginVisit(p, core.Sailing.getDock('the_pandemonium'), 0);
    const boat = p.getSailing().boats[0], optionRow = row.buildRowIds.find(id => parts.optionFor(boat, id));
    assert.ok(optionRow);
    const requirement = parts.requirementsOf('hull', optionRow);
    for (const [id, amount] of requirement.materials) p.getInventory().add(new core.Item(id, amount));
    const before = requirement.materials.map(([id]) => p.getInventory().getAmount(id));
    const bytes = []; let value = ((optionRow << 1) ^ (optionRow >> 31)) >>> 0;
    while (value > 127) { bytes.push((value & 127) | 128); value >>>= 7; } bytes.push(value, 0);
    PM.emitInterfaceActionClick({ player: p, buttonId: (939 << 16) | 17, action: 0, groupId: 939, childId: 17, scriptTrigger: true, argsData: Buffer.from(bytes), handled: false });
    assert.deepEqual(requirement.materials.map(([id]) => p.getInventory().getAmount(id)), learn ? before.map(() => 0) : before, JSON.stringify(p.messages));
    if (learn) assert.equal(parts.partOptions('skiff', 'hull')[boat.parts.hull], optionRow);
    else assert.equal(boat.parts?.hull ?? 0, 0);
  }
});

test('learned recipes survive PlayerSave without relying on client varbits', t => {
  const p = player(t), id = core.CacheDefinitions.getObjId('lost_schematic_bosuns_workbench');
  p.getInventory().setItem(0, new core.Item(id)); read(p, 0);
  const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
  const save = PlayerSave.fromPlayer(p), loaded = player(t);
  save.applyToPlayer(loaded);
  PM.emitPlayerLogin(lifecycle(loaded));
  assert.equal(loaded.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId('lost_schematic_bosuns_workbench')), 1);
  assert.equal(loaded.getInventory().getAmount(id), 0);
});

test('full-inventory Red Reef completion logs its owned ground reward', t => {
  const p = player(t), knife = core.CacheDefinitions.getObjId('knife');
  for (let slot = 0; slot < 28; slot++) p.getInventory().setItem(slot, new core.Item(knife));
  quest('the_red_reef').complete(p);
  const id = core.CacheDefinitions.getObjId('lost_schematic_bosuns_workbench');
  assert.equal(p.getInventory().getAmount(id), 0);
  assert.equal(p.getAttribute('clog.items')[id], 1);
});
