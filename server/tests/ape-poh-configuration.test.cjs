// Seeded house and quest prerequisites, registered object/UI paths.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
process.env.DISABLE_PLAYER_BOTS = '1';
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { GameObject } = require('../dist/game/entity/impl/object/GameObject');
const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
let core, House, Instance, Portals, Nexus, quest, yanillePortal;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PM.getCoreApi();
  core.RegionManager.init();
  ObjectDefinition.init();
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  PM.emitServerStartup({});
  House = require('../plugins/skills/construction/House.Construction');
  Instance = require('../plugins/skills/construction/Instance.Construction');
  Portals = require('../plugins/skills/construction/Portals.Construction');
  Nexus = require('../plugins/skills/construction/Nexus.Construction');
  quest = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(q => q.key === 'recipe_for_disaster');
  assert.ok(quest);
  yanillePortal = require('../plugins/skills/construction/Estate.Construction').HOUSE_LOCATIONS.find(entry => entry.id === 6).portal;
  assert.equal(core.CacheDefinitions.getEnumValues(1375).get(9), 8);
  assert.equal(core.CacheDefinitions.getEnumValues(1375).get(31), 30);
  assert.equal(core.CacheDefinitions.getEnumValues(1377).get(8), 460);
  assert.equal(core.CacheDefinitions.getEnumValues(1377).get(30), 1255);
  assert.equal(core.CacheDefinitions.getStructParams(460).get(660), 'Marim');
  assert.equal(core.CacheDefinitions.getStructParams(460).get(673), 64);
  const marim = core.CacheDefinitions.getStructParams(460);
  const marimCost = [[664, 668], [665, 669], [666, 670], [667, 671]]
    .map(([id, amount]) => [marim.get(id), marim.get(amount)]).sort((a, b) => a[0] - b[0]);
  assert.deepEqual(marimCost, [[554, 2000], [555, 2000], [563, 2000], [1964, 1000]]);
  assert.equal(core.CacheDefinitions.getStructParams(1255).get(660), 'Ape Atoll Dungeon');
  assert.equal(core.CacheDefinitions.getStructParams(1255).get(673), 90);
  assert.equal(core.ItemDefinition.forId(1963).isStackable(), false);
  assert.equal(core.ItemDefinition.forId(1963).getNoteId(), 1964);
  assert.equal(core.ItemDefinition.forId(1964).isStackable(), true);
  assert.equal(Nexus.destinations().get(8).spellName, 'ape atoll teleport');
  assert.equal(Nexus.destinations().get(30).spellName, 'ape atoll dungeon teleport');
});
after(() => PM.emitServerShutdown({}));

let actorIndex = 0;
function actor(t, kind, { rescued = false, full = false } = {}) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  const conn = new ClientConnection(channel); conn.player = p;
  const errors = [], warnings = [], warn = console.warn.bind(console);
  t.mock.method(console, 'error', (...args) => errors.push(args));
  t.mock.method(console, 'warn', (...args) => {
    if (String(args[0]).includes('[plugins]')) warnings.push(args); else warn(...args);
  });
  let ownedHouse;
  t.after(() => {
    const taskIndex = p.getIndex();
    try { PM.emitPlayerLogout({ player: p, username: p.getUsername() }); }
    finally {
      try { House.releaseHouse(p, true); } finally { core.World.getPlayers().remove(p); }
      core.TaskManager.cancelTasks(p); core.TaskManager.cancelTasks(taskIndex);
      p.closeInterruptibleInterfaces();
      for (const npc of [...core.World.getNpcs()]) if (npc?.getOwner?.() === p) PM.removeNpc(npc);
      assert.equal(House.houseFor(p), null);
      if (ownedHouse) assert.equal(ownedHouse.isDestroyed(), true);
      assert.equal(Instance.PlayerHouseInstance.isAllocationLocation(p.getLocation()), false);
      assert.equal(p.isRegistered(), false);
      assert.equal(core.TaskManager.hasActiveTask(p), false);
      assert.equal(core.TaskManager.hasActiveTask(taskIndex), false);
      assert.equal([...core.World.getNpcs()].some(npc => npc?.getOwner?.() === p), false);
      assert.deepEqual(errors, []); assert.deepEqual(warnings, []);
    }
  });
  p.setUsername(`pohape${++actorIndex}`); p.setLongUsername(core.Misc.stringToLongBigInt(p.getUsername()));
  assert.notEqual(p.getLongUsername(), 0n);
  p.setAttribute('bot-skip-persistence', true);
  const save = Instance.createDefaultHouseSave(); save.location = 6;
  save.rooms[1][4][6] = kind === 'chamber'
    ? { roomKey: 'PORTAL_CHAMBER', rotation: 0, furniture: { PORTAL_1: 'TEAK_PORTAL_FRAME', TELEPORT_FOCUS: 'TELEPORT_FOCUS' } }
    : { roomKey: 'PORTAL_NEXUS', rotation: 0, furniture: { PORTAL_NEXUS: 'MARBLE_PORTAL_NEXUS' } };
  p.setAttribute('construction:house', save);
  assert.equal(core.World.getPlayers().add(p), true);
  p.getSkillManager().setMaxLevels(core.Skill.MAGIC, 99, false)
    .setExperiences(core.Skill.MAGIC, core.SkillManager.getExperienceForLevel(99), false)
    .setCurrentLevel(core.Skill.MAGIC, 99, false);
  assert.equal(p.getSkillManager().getMaxLevel(core.Skill.MAGIC), 99);
  assert.equal(p.getSkillManager().getCurrentLevel(core.Skill.MAGIC), 99);
  p.getSkillManager().setMaxLevels(core.Skill.CONSTRUCTION, 99, false)
    .setExperiences(core.Skill.CONSTRUCTION, core.SkillManager.getExperienceForLevel(99), false)
    .setCurrentLevel(core.Skill.CONSTRUCTION, 99, false);
  assert.equal(p.getSkillManager().getMaxLevel(core.Skill.CONSTRUCTION), 99);
  assert.equal(p.getSkillManager().getCurrentLevel(core.Skill.CONSTRUCTION), 99);
  assert.equal(core.WorldDefinition.isMembersWorld(), true);
  p.setAttribute('recipe-for-disaster:rescues', rescued ? 128 : 0);
  quest.setStage(p, full ? quest.completionValue : 4);
  assert.equal(quest.isComplete(p), full);
  const check = { player: p, rescue: 'king-awowogei', complete: false };
  PM.emitCustomEvent('recipe-for-disaster:rescue-status', check);
  assert.equal(check.complete, rescued);
  const portalAt = new core.Location(2542, 3097, 0);
  p.moveTo(new core.Location(2542, 3096, 0)); p.setNeedsPlacement(false);
  const portal = new GameObject(yanillePortal, portalAt, 10, 2, null);
  const definition = ObjectDefinition.forPlayer(yanillePortal, p) ?? ObjectDefinition.forId(yanillePortal);
  assert.equal(PM.emitObjectInteraction({ player: p, object: portal, objectId: yanillePortal, definition, clickType: 2,
    location: { x: 2542, y: 3097, z: 0 }, sourceLocation: { x: 2542, y: 3096, z: 0 }, handled: false }), true);
  for (let tick = 0; tick < 3; tick++) core.TaskManager.process(); // Home loads two ticks later
  const house = House.houseFor(p);
  ownedHouse = house;
  assert.ok(house instanceof Instance.PlayerHouseInstance); assert.equal(house.owner, p);
  const room = house.save.rooms[1][4][6];
  const find = key => Object.values(room.furnitureByLocation).find(f => f.hotspotKey === key);
  const furnishing = find(kind === 'chamber' ? 'TELEPORT_FOCUS' : 'PORTAL_NEXUS');
  const frame = kind === 'chamber' ? find('PORTAL_1') : furnishing;
  assert.ok(furnishing); assert.ok(frame);
  const object = house.furnitureObjects.find(candidate => {
    const at = candidate.getLocation();
    return house.getFurnitureAt({ x: at.getX(), y: at.getY(), z: at.getZ() }, candidate.getId(), candidate.getType()) === furnishing;
  });
  assert.ok(object, 'the seeded furniture was drawn in the real owned house');
  return { p, conn, house, room, furnishing, frame, object };
}

function objectAction(f, action) {
  const at = f.object.getLocation(), id = f.object.getId();
  f.p.moveTo(new core.Location(at.getX() - 1, at.getY(), at.getZ())); f.p.setNeedsPlacement(false);
  const definition = ObjectDefinition.forPlayer(id, f.p) ?? ObjectDefinition.forId(id);
  const index = definition.getInteractions().findIndex(s => s?.toLowerCase() === action);
  assert.notEqual(index, -1, `real cache action ${action}`);
  const loc = { x: at.getX(), y: at.getY(), z: at.getZ() };
  const source = f.p.getLocation();
  assert.equal(PM.emitObjectInteraction({ player: f.p, object: f.object, objectId: id, definition, clickType: index + 1,
    location: loc, sourceLocation: { x: source.getX(), y: source.getY(), z: source.getZ() }, handled: false }), true);
}

async function prompt(f, title, choice) {
  const pending = core.MultiChatboxPrompt.getPending(f.p);
  assert.equal(f.p.getPacketSender().isChatboxInterface(219), true);
  assert.equal(f.p.getDialogueManager().isActive(), false);
  assert.ok(pending); assert.match(pending.title, title);
  const index = pending.options.findIndex(s => choice.test(s)); assert.notEqual(index, -1);
  await f.conn.dispatch([{ type: 'dialogue_continue', widgetId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: index + 1 }]);
  f.conn.processTurnPackets();
}

function assertContext(f) {
  assert.equal(f.p.getPrivateArea(), f.house);
  assert.equal(f.house.owner, f.p);
  assert.ok(f.house.save.rooms.flat(2).some(room => Object.values(room?.furnitureByLocation ?? {}).includes(f.furnishing)));
  assert.ok(f.house.save.rooms.flat(2).some(room => Object.values(room?.furnitureByLocation ?? {}).includes(f.frame)));
  assert.equal(f.p.getSkillManager().getMaxLevel(core.Skill.MAGIC), 99);
  assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.MAGIC), 99);
  assert.equal(f.p.getSkillManager().getMaxLevel(core.Skill.CONSTRUCTION), 99);
}

async function chamberReady(f, destination) {
  objectAction(f, 'direct-portal');
  await prompt(f, /which portal/i, /^portal 1:/i);
  for (let i = 0; i < 30; i++) {
    const pending = core.MultiChatboxPrompt.getPending(f.p);
    assert.ok(pending); assert.match(pending.title, /configure destinations/i);
    if (pending.options.some(s => s.toLowerCase() === destination)) {
      await prompt(f, /configure destinations/i, new RegExp(`^${destination}$`, 'i'));
      assertContext(f);
      return;
    }
    await prompt(f, /configure destinations/i, /^more destinations$/i);
  }
  assert.fail(`destination ${destination} missing from real prompt pages`);
}

function nexusOpen(f) {
  objectAction(f, 'configuration');
  const group = core.CacheDefinitions.getInterfaceId('telenexus'); assert.equal(group, 19);
  assert.equal(f.p.getInterfaceId(), group);
  return group;
}

async function nexusReady(f, id) {
  const group = nexusOpen(f);
  const row = [...core.CacheDefinitions.getEnumValues(1375)].find(([, value]) => value === id)?.[0];
  assert.notEqual(row, undefined);
  const from = core.CacheDefinitions.getComponentId('telenexus:non_slotted_list');
  const to = core.CacheDefinitions.getComponentId('telenexus:slotted_list');
  await f.conn.dispatch([{ type: 'widget_drag', sourceWidgetId: from, targetWidgetId: to,
    sourceSlot: row, targetSlot: 1, sourceItemId: -1, targetItemId: -1 }]);
  f.conn.processTurnPackets();
  assert.equal(f.p.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId('poh_nexus_tele_1_temp')), id);
  assertContext(f);
  const before = structuredClone(f.p.getAttribute('construction:nexus'));
  const done = core.CacheDefinitions.getComponentId('telenexus:telenexus_donebutton');
  await f.conn.dispatch([{ type: 'widget_action', widgetId: done, groupId: done >>> 16,
    childId: done & 0xffff, slot: -1, buttonNum: 1 }]);
  f.conn.processTurnPackets();
  assert.deepEqual(f.p.getAttribute('construction:nexus'), before, 'Done did not commit changed destinations');
  assert.equal(f.p.getInterfaceId(), group, 'the real configuration remains mounted for Confirm');
}

async function nexusConfirm(f) {
  const widgetId = core.CacheDefinitions.getComponentId('telenexus:telenexus_confirm');
  await f.conn.dispatch([{ type: 'widget_action', widgetId, groupId: widgetId >>> 16,
    childId: widgetId & 0xffff, slot: -1, buttonNum: 1 }]);
  f.conn.processTurnPackets();
}

function setupCost(f, kind, name) {
  const destination = kind === 'chamber' ? Portals.houseDestinations().find(d => d.name === name)
    : [...Nexus.destinations().values()].find(d => d.spellName === name);
  assert.ok(destination);
  const cost = kind === 'chamber' ? destination.runes.map(r => {
    const id = name === 'ape atoll teleport' && r.getId() === 1963
      ? core.ItemDefinition.forId(r.getId()).getNoteId() : r.getId();
    return [id, r.getAmount() * 100];
  }) : destination.runes;
  assert.ok(cost.length);
  if (kind === 'chamber' && name === 'ape atoll teleport') assert.deepEqual(cost.find(([id]) => id === 1964), [1964, 100]);
  for (const [id, amount] of cost) f.p.getInventory().add(new core.Item(id, amount), false);
  for (const [id, amount] of cost) assert.equal(f.p.getInventory().getAmount(id), amount);
  return cost;
}

test('chamber: 99 noted bananas cannot pay the 100-banana cost', async t => {
  const f = actor(t, 'chamber', { rescued: true }), existing = seedExisting(f, 'chamber');
  const cost = setupCost(f, 'chamber', 'ape atoll teleport');
  f.p.getInventory().delete(1964, 1);
  assert.equal(f.p.getInventory().getAmount(1964), 99);
  await chamberReady(f, 'ape atoll teleport'); await prompt(f, /consume these runes/i, /^yes$/i);
  assert.deepEqual(f.frame.destinations, existing);
  for (const [id, amount] of cost) assert.equal(f.p.getInventory().getAmount(id), amount - (id === 1964 ? 1 : 0));
});

// Wiki (Portal chamber): bank notes are accepted for the bananas, so a mix pays (#3045 review).
for (const [label, unnoted, noted, allowed] of [['22 unnoted and 80 noted bananas pay', 22, 80, true],
  ['20 unnoted and 79 noted bananas do not', 20, 79, false]]) {
  test(`chamber: ${label} the 100-banana cost`, async t => {
    const f = actor(t, 'chamber', { rescued: true }), existing = seedExisting(f, 'chamber');
    const cost = setupCost(f, 'chamber', 'ape atoll teleport');
    f.p.getInventory().delete(1964, 100 - noted);
    f.p.getInventory().add(new core.Item(1963, unnoted), false);
    assert.equal(f.p.getInventory().getAmount(1963), unnoted);
    assert.equal(f.p.getInventory().getAmount(1964), noted);
    await chamberReady(f, 'ape atoll teleport'); await prompt(f, /consume these runes/i, /^yes$/i);
    if (allowed) {
      assert.deepEqual(f.frame.destinations, ['ape atoll teleport']);
      // The notes go first: all 80 noted and 20 of the unnoted, leaving 2.
      assert.equal(f.p.getInventory().getAmount(1964), 0);
      assert.equal(f.p.getInventory().getAmount(1963), unnoted + noted - 100);
      for (const [id] of cost) if (id !== 1964) assert.equal(f.p.getInventory().getAmount(id), 0);
    } else {
      assert.deepEqual(f.frame.destinations, existing);
      assert.equal(f.p.getInventory().getAmount(1963), unnoted);
      assert.equal(f.p.getInventory().getAmount(1964), noted);
      for (const [id, amount] of cost) if (id !== 1964) assert.equal(f.p.getInventory().getAmount(id), amount);
    }
  });
}

function seedExisting(f, kind) {
  if (kind === 'chamber') {
    f.frame.destinations = ['varrock teleport'];
    return [...f.frame.destinations];
  }
  const varrock = [...Nexus.destinations().values()].find(d => d.spellName === 'varrock teleport');
  assert.ok(varrock);
  const existing = { slots: [varrock.id], left: varrock.id };
  f.p.setAttribute('construction:nexus', structuredClone(existing));
  return existing;
}

for (const kind of ['chamber', 'nexus']) {
  for (const [label, state, allowed] of [
    ['incomplete', {}, false], ['saved rescue only', { rescued: true }, true], ['legacy full RFD', { full: true }, true],
  ]) {
    test(`${kind}: ${label} configures standard Ape Atoll only if eligible`, async t => {
      const f = actor(t, kind, state), name = 'ape atoll teleport';
      const existing = seedExisting(f, kind);
      if (state.rescued) {
        f.p.setSpellbook(core.MagicSpellbook.ARCEUUS);
        assert.equal(f.p.getSpellbook(), core.MagicSpellbook.ARCEUUS);
      }
      const cost = setupCost(f, kind, name);
      if (kind === 'chamber') { await chamberReady(f, name); await prompt(f, /consume these runes/i, /^yes$/i); }
      else { await nexusReady(f, 8); await nexusConfirm(f); }
      for (const [id, amount] of cost) assert.equal(f.p.getInventory().getAmount(id), allowed ? 0 : amount);
      if (kind === 'chamber') assert.deepEqual(f.frame.destinations, allowed ? [name] : existing);
      else {
        const saved = f.p.getAttribute('construction:nexus');
        assert.equal(saved.slots.includes(8), allowed);
        assert.ok(saved.slots.includes(existing.slots[0]));
        assert.equal(saved.left, existing.left);
        if (!allowed) assert.deepEqual(saved, existing);
      }
    });
  }
  test(`${kind}: rechecks rescue after the owner begins configuration`, async t => {
    const f = actor(t, kind, { rescued: true }), name = 'ape atoll teleport';
    const existing = seedExisting(f, kind);
    const cost = setupCost(f, kind, name);
    if (kind === 'chamber') await chamberReady(f, name); else await nexusReady(f, 8);
    f.p.setAttribute('recipe-for-disaster:rescues', 0);
    const check = { player: f.p, rescue: 'king-awowogei', complete: false };
    PM.emitCustomEvent('recipe-for-disaster:rescue-status', check); assert.equal(check.complete, false);
    if (kind === 'chamber') await prompt(f, /consume these runes/i, /^yes$/i); else await nexusConfirm(f);
    for (const [id, amount] of cost) assert.equal(f.p.getInventory().getAmount(id), amount);
    if (kind === 'chamber') assert.deepEqual(f.frame.destinations, existing);
    else assert.deepEqual(f.p.getAttribute('construction:nexus'), existing);
  });
  test(`${kind}: unrelated Varrock remains configurable without the rescue`, async t => {
    const f = actor(t, kind), name = 'varrock teleport', cost = setupCost(f, kind, name);
    if (kind === 'chamber') { await chamberReady(f, name); await prompt(f, /consume these runes/i, /^yes$/i); }
    else {
      const target = [...Nexus.destinations().values()].find(d => d.spellName === name);
      assert.ok(target); await nexusReady(f, target.id); await nexusConfirm(f);
      assert.ok((f.p.getAttribute('construction:nexus')?.slots ?? []).includes(target.id));
    }
    for (const [id] of cost) assert.equal(f.p.getInventory().getAmount(id), 0);
    if (kind === 'chamber') assert.ok((f.frame.destinations ?? []).includes(name));
  });
}

test('nexus: Arceuus Ape Atoll Dungeon is a distinct configuration', async t => {
  const f = actor(t, 'nexus'), name = 'ape atoll dungeon teleport', cost = setupCost(f, 'nexus', name);
  // Wiki (Ape Atoll Teleport (Arceuus)): the spell needs Monkey Madness I, and directing needs the spell's quest.
  const mm1 = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(q => q.key === 'monkey_madness_i');
  assert.ok(mm1); mm1.setStage(f.p, mm1.completionValue);
  await nexusReady(f, 30); await nexusConfirm(f);
  assert.ok((f.p.getAttribute('construction:nexus')?.slots ?? []).includes(30));
  for (const [id] of cost) assert.equal(f.p.getInventory().getAmount(id), 0);
});

test('nexus: reordering an already saved Marim does not require a new unlock', async t => {
  const f = actor(t, 'nexus');
  const varrock = [...Nexus.destinations().values()].find(d => d.spellName === 'varrock teleport');
  assert.ok(varrock);
  f.p.setAttribute('construction:nexus', { slots: [8, varrock.id], left: 8 });
  const group = nexusOpen(f), slots = core.CacheDefinitions.getComponentId('telenexus:slotted_list');
  await f.conn.dispatch([{ type: 'widget_drag', sourceWidgetId: slots, targetWidgetId: slots,
    sourceSlot: 1, targetSlot: 2, sourceItemId: -1, targetItemId: -1 }]);
  f.conn.processTurnPackets();
  const done = core.CacheDefinitions.getComponentId('telenexus:telenexus_donebutton');
  await f.conn.dispatch([{ type: 'widget_action', widgetId: done, groupId: group,
    childId: done & 0xffff, slot: -1, buttonNum: 1 }]);
  f.conn.processTurnPackets();
  assert.deepEqual(f.p.getAttribute('construction:nexus'), { slots: [varrock.id, 8], left: 8 });
});

test('nexus: stale removed furniture cannot commit a previously opened configuration', async t => {
  const f = actor(t, 'nexus', { rescued: true }), existing = seedExisting(f, 'nexus');
  const messages = [], send = f.p.sendMessage.bind(f.p);
  t.mock.method(f.p, 'sendMessage', (...args) => { messages.push(args[0]); return send(...args); });
  const cost = setupCost(f, 'nexus', 'ape atoll teleport');
  await nexusReady(f, 8);
  const at = f.object.getLocation(), loc = { x: at.getX(), y: at.getY(), z: at.getZ() };
  assert.equal(f.house.removeFurniture(loc, f.object.getId(), f.object.getType()), f.furnishing);
  const sender = f.p.getPacketSender();
  const removals = t.mock.method(sender, 'sendInterfaceRemoval');
  await nexusConfirm(f);
  assert.equal(messages.filter(message => message === 'This nexus is no longer available for configuration.').length, 1);
  // The panel of a nexus that is gone closes with the message, as a saved configuration's does.
  assert.equal(removals.mock.callCount(), 1, 'the stale configuration panel closes');
  for (const [id, amount] of cost) assert.equal(f.p.getInventory().getAmount(id), amount);
  assert.deepEqual(f.p.getAttribute('construction:nexus'), existing);
  await nexusConfirm(f);
  assert.equal(messages.filter(message => message === 'This nexus is no longer available for configuration.').length, 1);
  for (const [id, amount] of cost) assert.equal(f.p.getInventory().getAmount(id), amount);
  assert.deepEqual(f.p.getAttribute('construction:nexus'), existing);
});

// Wiki (Portal chamber, Portal nexus): directing needs "the same Magic level and quest requirements as casting the
// spell", on any spellbook the owner has unlocked.
const questOf = key => require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(q => q.key === key);
for (const [name, key, line] of [
  ['kourend castle teleport', 'client_of_kourend', 'You need to complete Client of Kourend to direct this teleport.'],
  ['paddewwa teleport', 'desert_treasure_i', 'You need to complete Desert Treasure I to direct this teleport.'],
  ['moonclan teleport', 'lunar_diplomacy', 'You need to complete Lunar Diplomacy to direct this teleport.'],
  ['salve graveyard teleport', 'priest_in_peril', 'You need to complete Priest in Peril to direct this teleport.'],
]) {
  for (const kind of ['chamber', 'nexus']) {
    test(`${kind}: ${name} needs ${key} to be directed`, async t => {
      const f = actor(t, kind), q = questOf(key);
      assert.ok(q);
      const messages = [], send = f.p.sendMessage.bind(f.p);
      t.mock.method(f.p, 'sendMessage', (...args) => { messages.push(args[0]); return send(...args); });
      const existing = seedExisting(f, kind), cost = setupCost(f, kind, name);
      const target = kind === 'nexus' ? [...Nexus.destinations().values()].find(d => d.spellName === name) : null;
      if (kind === 'nexus') assert.ok(target);
      const direct = async () => {
        if (kind === 'chamber') { await chamberReady(f, name); await prompt(f, /consume these runes/i, /^yes$/i); }
        else { await nexusReady(f, target.id); await nexusConfirm(f); }
      };
      q.setStage(f.p, 0); assert.equal(q.isComplete(f.p), false);
      await direct();
      assert.ok(messages.includes(line), messages.join(' | '));
      for (const [id, amount] of cost) assert.equal(f.p.getInventory().getAmount(id), amount);
      if (kind === 'chamber') assert.deepEqual(f.frame.destinations, existing);
      else assert.deepEqual(f.p.getAttribute('construction:nexus'), existing);
      q.setStage(f.p, q.completionValue); assert.equal(q.isComplete(f.p), true);
      if (kind === 'nexus') f.p.closeInterruptibleInterfaces();
      await direct();
      for (const [id] of cost) assert.equal(f.p.getInventory().getAmount(id), 0);
      if (kind === 'chamber') assert.deepEqual(f.frame.destinations, [name]);
      else assert.ok(f.p.getAttribute('construction:nexus').slots.includes(target.id));
    });
  }
}

test('chamber: Ardougne needs Edmond\'s scroll read, not just Plague City started', async t => {
  const f = actor(t, 'chamber'), q = questOf('plague_city'), name = 'ardougne teleport';
  assert.ok(q);
  const messages = [], send = f.p.sendMessage.bind(f.p);
  t.mock.method(f.p, 'sendMessage', (...args) => { messages.push(args[0]); return send(...args); });
  q.setStage(f.p, q.completionValue);
  const stage = { player: f.p, key: 'plague_city', stage: null };
  PM.emitCustomEvent('quest:get-stage', stage);
  assert.ok(Number(stage.stage) < 30, 'a complete Plague City is stage 29; the scroll is 30');
  const existing = seedExisting(f, 'chamber'), cost = setupCost(f, 'chamber', name);
  await chamberReady(f, name); await prompt(f, /consume these runes/i, /^yes$/i);
  assert.ok(messages.some(m => /Edmond's magic scroll to direct this teleport/.test(m)), messages.join(' | '));
  for (const [id, amount] of cost) assert.equal(f.p.getInventory().getAmount(id), amount);
  assert.deepEqual(f.frame.destinations, existing);
});

// The Watchtower spell needs its scroll read (Watchtower quest, stage 14, past the quest's completion at 12); the
// portals ask the same through magic:teleport-quest-lock.
for (const kind of ['chamber', 'nexus']) {
  test(`${kind}: Watchtower needs the spell scroll read to be directed`, async t => {
    const f = actor(t, kind), q = questOf('watchtower'), name = 'watchtower teleport';
    assert.ok(q);
    const messages = [], send = f.p.sendMessage.bind(f.p);
    t.mock.method(f.p, 'sendMessage', (...args) => { messages.push(args[0]); return send(...args); });
    const existing = seedExisting(f, kind), cost = setupCost(f, kind, name);
    const target = kind === 'nexus' ? [...Nexus.destinations().values()].find(d => d.spellName === name) : null;
    if (kind === 'nexus') assert.ok(target);
    const direct = async () => {
      if (kind === 'chamber') { await chamberReady(f, name); await prompt(f, /consume these runes/i, /^yes$/i); }
      else { await nexusReady(f, target.id); await nexusConfirm(f); }
    };
    q.setStage(f.p, q.completionValue); assert.equal(q.isComplete(f.p), true, 'the quest itself is done');
    await direct();
    assert.ok(messages.includes('You need to read the Watchtower spell scroll to direct this teleport.'), messages.join(' | '));
    for (const [id, amount] of cost) assert.equal(f.p.getInventory().getAmount(id), amount);
    if (kind === 'chamber') assert.deepEqual(f.frame.destinations, existing);
    else assert.deepEqual(f.p.getAttribute('construction:nexus'), existing);
    q.setStage(f.p, 14);
    if (kind === 'nexus') f.p.closeInterruptibleInterfaces();
    await direct();
    for (const [id] of cost) assert.equal(f.p.getInventory().getAmount(id), 0);
    if (kind === 'chamber') assert.deepEqual(f.frame.destinations, [name]);
    else assert.ok(f.p.getAttribute('construction:nexus').slots.includes(target.id));
  });
}

// Wiki (Portal Nexus) and rsprox captures (Remove on poh_nexus_portal_1 and _3): removing the nexus, or the
// room it stands in, means paying the runes again; Remove warns first.
async function removeNexus(f, t) {
  f.house.buildingMode = true;
  const warnings = [], send = core.StatementDialogue.send;
  t.mock.method(core.StatementDialogue, 'send', (player, text, ...rest) => { warnings.push(text); return send(player, text, ...rest); });
  objectAction(f, 'remove');
  assert.deepEqual(warnings, [Nexus.REMOVAL_WARNING], 'Remove warns before asking for confirmation');
  assert.equal(core.MultiChatboxPrompt.getPending(f.p), null, 'the confirmation waits for the warning');
  await f.conn.dispatch([{ type: 'dialogue_continue', widgetId: (229 << 16) | 4, childIndex: -1 }]);
  f.conn.processTurnPackets();
  await prompt(f, /really remove it/i, /^yes$/i);
}

test('nexus: Remove warns, then discards the paid destinations', async t => {
  const f = actor(t, 'nexus', { rescued: true }); seedExisting(f, 'nexus');
  await removeNexus(f, t);
  assert.equal(f.house.getFurnitureAt(f.object.getLocation(), f.object.getId(), f.object.getType()), null);
  assert.deepEqual(f.p.getAttribute('construction:nexus'), { slots: [], left: 0 });
  assert.equal(f.p.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId('poh_nexus_tele_1')), 0);
  assert.equal(f.p.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId('poh_nexus_left_click')), 0);
});

test('nexus: removing its room discards the paid destinations', async t => {
  const f = actor(t, 'nexus', { rescued: true }); seedExisting(f, 'nexus');
  f.house.buildingMode = true;
  const warnings = [], send = core.StatementDialogue.send;
  t.mock.method(core.StatementDialogue, 'send', (player, text, ...rest) => { warnings.push(text); return send(player, text, ...rest); });
  House.removeRoomPrompt(f.p, f.house, { plane: 1, x: 4, y: 6 });
  assert.deepEqual(warnings, [Nexus.ROOM_REMOVAL_WARNING], 'removing the room warns first');
  await f.conn.dispatch([{ type: 'dialogue_continue', widgetId: (229 << 16) | 4, childIndex: -1 }]);
  f.conn.processTurnPackets();
  await prompt(f, /remove the/i, /^yes$/i);
  assert.equal(f.house.getRoom({ plane: 1, x: 4, y: 6 }), null);
  assert.deepEqual(f.p.getAttribute('construction:nexus'), { slots: [], left: 0 });
});

// rsprox captures (close_modal and picks on telenexus_teleport, rev 224-239): the Teleport Menu's key
// listeners stop chat input (script2674 runs chatdefault_stopinput), so live sends
// chatdefault_restoreinput (2158) right after its if_closesub. The configuration (telenexus) doesn't.
const RESTORE_INPUT = 2158;
function recordClose(t, f) {
  const sender = f.p.getPacketSender(), log = [];
  const closeSub = sender.closeSubInterface.bind(sender), script = sender.sendClientScript.bind(sender);
  t.mock.method(sender, 'closeSubInterface', (...args) => { log.push('closesub'); return closeSub(...args); });
  t.mock.method(sender, 'sendClientScript', (id, ...args) => { log.push(`script ${id}`); return script(id, ...args); });
  return log;
}

test('nexus: closing the Teleport Menu gives the chat its typing back', async t => {
  const f = actor(t, 'nexus', { rescued: true });
  objectAction(f, 'teleport menu');
  assert.equal(f.p.getInterfaceId(), core.CacheDefinitions.getInterfaceId('telenexus_teleport'));
  const log = recordClose(t, f);
  await f.conn.dispatch([{ type: 'interface_close' }]);
  f.conn.processTurnPackets();
  assert.equal(f.p.getInterfaceId(), -1);
  assert.deepEqual(log.filter(entry => entry === 'closesub' || entry === `script ${RESTORE_INPUT}`).slice(-2), ['closesub', `script ${RESTORE_INPUT}`]);
  assert.equal(log.filter(entry => entry === `script ${RESTORE_INPUT}`).length, 1);
});

test('nexus: a Teleport Menu pick restores chat input as it closes', async t => {
  const f = actor(t, 'nexus', { rescued: true });
  const varrock = [...Nexus.destinations().values()].find(d => d.spellName === 'varrock teleport');
  f.p.setAttribute('construction:nexus', { slots: [varrock.id], left: 0 });
  objectAction(f, 'teleport menu');
  const log = recordClose(t, f);
  const rows = core.CacheDefinitions.getComponentId('telenexus_teleport:rows1');
  await f.conn.dispatch([{ type: 'dialogue_continue', widgetId: rows, childIndex: 0 }]);
  f.conn.processTurnPackets();
  assert.equal(House.houseFor(f.p), null, 'the pick left the house');
  assert.equal(log.filter(entry => entry === `script ${RESTORE_INPUT}`).length, 1);
});

test('nexus: closing the configuration sends no restore (it never stopped input)', async t => {
  const f = actor(t, 'nexus', { rescued: true });
  nexusOpen(f);
  const log = recordClose(t, f);
  await f.conn.dispatch([{ type: 'interface_close' }]);
  f.conn.processTurnPackets();
  assert.equal(f.p.getInterfaceId(), -1);
  assert.equal(log.includes(`script ${RESTORE_INPUT}`), false);
});
