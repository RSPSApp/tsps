// yarn build && node --test --test-concurrency=1 tests/camdozaal-native.test.cjs
// Real PM/cache/decoded inputs with preowned materials and a completed quest checkpoint.
// This is activity verification, not proof of a natural Below Ice Mountain playthrough.
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
const { Inventory } = require('../dist/game/model/container/impl/Inventory');
const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
const Runtime = require('../plugins/quests/QuestRuntime');
let core;
const errors = [];
const oldError = console.error;
console.error = (...args) => { errors.push(args.map(String)); oldError(...args); };

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(2950, 5800);
  core.RegionManager.loadMapFiles(2980, 5840);
  PM.emitServerStartup({});
});
after(() => {
  try { PM.emitServerShutdown({}); }
  finally { console.error = oldError; assert.deepEqual(errors, [], 'no runtime hook errors'); }
});

function obj(name) {
  const id = core.CacheDefinitions.getObjId(name);
  assert.ok(Number.isInteger(id), `cache item ${name}`);
  return id;
}
function sceneObjects() {
  const found = [];
  for (let x = 2910; x <= 3030; x++) for (let y = 5760; y <= 5865; y++) {
    for (const o of core.MapObjects.getObjectsAt(new core.Location(x, y, 0), null)) {
      const name = core.CacheDefinitions.getLocNames().get(o.getId()) ?? '';
      if (/camdozaal|sacred_forge/.test(name)) found.push({ object: o, name, x, y, id: o.getId(), type: o.getType(), face: o.getFace() });
    }
  }
  return found;
}
function locate(pattern) {
  const row = sceneObjects().find(o => pattern.test(o.name));
  assert.ok(row, `cache scene contains ${pattern}`);
  return row;
}
function stand(player, row) {
  const definition = ObjectDefinition.forPlayer(row.id, player);
  assert.ok(definition);
  const rect = [10, 11, 22].includes(row.type);
  const footprint = row.type === 22 ? definition : ObjectDefinition.forId(row.id);
  for (let dx = -2; dx <= 5; dx++) for (let dy = -2; dy <= 5; dy++) {
    const tile = new core.Location(row.x + dx, row.y + dy, 0);
    if (core.RegionManager.blocked(tile, player.getPrivateArea())) continue;
    player.moveTo(tile);
    if (core.PathFinder.reachedObject(player, row.x, row.y, rect ? footprint.getSizeX() : 1,
      rect ? footprint.getSizeY() : 1, row.face, rect ? 10 : row.type, rect ? definition.getBlockingMask() : 0)) return definition;
  }
  assert.fail('actual target has no reachable perimeter');
}
let next = 11000;
function actor(t) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  const username = `camdozaal${next++}`;
  player.setUsername(username);
  player.setLongUsername(core.Misc.stringToLongBigInt(username));
  player.setAttribute('bot-skip-persistence', true);
  assert.equal(core.World.getPlayers().add(player), true);
  t.after(() => {
    try {
      player.closeInterruptibleInterfaces();
      if (player.getArea()?.hasMember(player)) player.getArea().leave(player, true);
      PM.emitPlayerLogout({ player, username: player.getUsername() });
    }
    finally {
      core.TaskManager.cancelTasks(player);
      core.TaskManager.cancelTasks(player.getIndex());
      for (const item of [...core.World.getItems()]) {
        if (item.getOwner() === player.getUsername()) core.ItemOnGroundManager.deregister(item);
      }
      if (player.isRegistered()) core.World.getPlayers().remove(player);
    }
    assert.equal(player.isRegistered(), false);
    assert.equal(core.TaskManager.hasActiveTask(player.getIndex()), false);
    assert.deepEqual(errors, []);
  });
  const quest = Runtime.getRegisteredQuests().findLast(q => q.key === 'below_ice_mountain');
  assert.ok(quest);
  quest.setStage(player, 5);
  assert.equal(quest.isComplete(player), true);
  player.setAttribute('quest.below_ice_mountain.met-ramarno', 2);
  player.getPacketSender().sendVarbit(12068, 2);
  const connection = new ClientConnection(channel);
  connection.player = player;
  player.getSession().setPlayer(player);
  player.getSession().setTurnPacketProcessor(() => connection.processTurnPackets());
  assert.ok(player.getHitpoints() > 0);
  return { player, connection };
}
async function useItem(f, itemId, row) {
  const { player, connection } = f;
  const definition = stand(player, row);
  for (let tick = 0; tick < 3 && player.isNeedsPlacement(); tick++) core.World.process();
  assert.equal(player.isNeedsPlacement(), false, 'engine placement completes before ordinary input');
  const slot = player.getInventory().getItems().findIndex(i => i?.getId() === itemId);
  assert.ok(slot >= 0);
  let reached = 0;
  const original = PM.emitItemOnObject;
  PM.emitItemOnObject = function(event) {
    if (event.player === player && event.itemId === itemId) {
      reached++;
      assert.equal(event.object, row.object);
      assert.equal(event.itemSlot, slot);
    }
    return original.call(this, event);
  };
  try {
    await connection.dispatch([{ type: 'item_on_object', widgetId: Inventory.INTERFACE_ID,
      objectId: definition.id, itemId, slot, x: row.x, y: row.y }]);
    for (let i = 0; i < 20 && !reached; i++) core.World.process();
    assert.equal(reached, 1, 'decoded ordinary item use reaches the real object consumer');
  } finally { PM.emitItemOnObject = original; }
}

test('current cache provides actual Camdozaal activity and vault geometry', () => {
  const rows = sceneObjects();
  assert.ok(rows.some(r => /camdozaal_anvil/.test(r.name)));
  assert.ok(rows.some(r => /camdozaal_vault_door/.test(r.name)));
  console.log('CAMDOZAAL_CACHE_GEOMETRY', JSON.stringify(rows.map(({ object, ...row }) => row)));
});
test('ordinary shards-on-forge conserves shards in personal storage', async t => {
  const f = actor(t), id = obj('camdozaal_barronite_shard');
  f.player.getInventory().adds(id, 1000);
  const row = locate(/bim_ruins_wallkit_sacred_forge/);
  assert.equal(f.player.getInventory().getAmount(id), 1000);
  assert.equal(Number(f.player.getAttribute('camdozaal:stored-shards')) || 0, 0);
  await useItem(f, id, row);
  assert.equal(Number(f.player.getAttribute('camdozaal:stored-shards')) || 0, 1000,
    'ordinary Sacred Forge use stores shards');
  assert.equal(f.player.getInventory().getAmount(id), 0);
});

function ticks(count) { for (let i = 0; i < count; i++) core.World.process(); }
function skill(player, name, level) {
  player.getSkillManager().setMaxLevel(core.Skill[name], level).setCurrentLevel(core.Skill[name], level);
}
async function clickObject(f, row, option, place = true) {
  const definition = place ? stand(f.player, row) : ObjectDefinition.forPlayer(row.id, f.player);
  assert.ok(definition, 'actual player-resolved object definition exists');
  for (let tick = 0; tick < 3 && f.player.isNeedsPlacement(); tick++) core.World.process();
  assert.equal(f.player.isNeedsPlacement(), false);
  const clickType = definition.getInteractions().indexOf(option) + 1;
  assert.ok(clickType > 0, `cache option ${option}: ${definition.getInteractions()}`);
  let reached = 0;
  const original = PM.emitObjectInteraction;
  PM.emitObjectInteraction = function(event) {
    if (event.player === f.player && event.objectId === row.id) reached++;
    return original.call(this, event);
  };
  try {
    await f.connection.dispatch([{ type: 'object_option', id: definition.id, x: row.x, y: row.y, clickType }]);
    for (let i = 0; i < 20 && !reached; i++) ticks(1);
    assert.equal(reached, 1, 'ordinary object action reaches one consumer');
  } finally { PM.emitObjectInteraction = original; }
}
test('forge Fuel/Check/Empty conserves carried and saved balance', async t => {
  const f = actor(t), id = obj('camdozaal_barronite_shard');
  f.player.getInventory().adds(id, 600);
  const row = locate(/^bim_ruins_wallkit_sacred_forge_multi$/);
  await clickObject(f, row, 'Fuel');
  assert.equal(f.player.getInventory().getAmount(id), 0);
  assert.equal(f.player.getAttribute('camdozaal:stored-shards'), 600);
  await clickObject(f, row, 'Check');
  assert.equal(f.player.getAttribute('camdozaal:stored-shards'), 600);
  await clickObject(f, row, 'Empty');
  assert.equal(f.player.getInventory().getAmount(id), 600);
  assert.equal(Number(f.player.getAttribute('camdozaal:stored-shards')) || 0, 0);
});

test('forge intro refusal preserves shards and reports why', async t => {
  const f = actor(t), id = obj('camdozaal_barronite_shard');
  f.player.setAttribute('quest.below_ice_mountain.met-ramarno', 0);
  f.player.getInventory().adds(id, 1000);
  const messages = [], send = f.player.sendMessage;
  f.player.sendMessage = function(text) { messages.push(text); return send.call(this, text); };
  await useItem(f, id, locate(/bim_ruins_wallkit_sacred_forge/));
  assert.equal(f.player.getInventory().getAmount(id), 1000);
  assert.equal(Number(f.player.getAttribute('camdozaal:stored-shards')) || 0, 0);
  assert.ok(messages.some(text => /speak to Ramarno/.test(text)));
});

test('crusher requires hammer and level before delayed real deposit consumption', async t => {
  const f = actor(t), deposit = obj('camdozaal_barronite_deposit');
  const row = locate(/camdozaal_anvil/);
  skill(f.player, 'SMITHING', 14);
  f.player.getInventory().adds(deposit, 1);
  await useItem(f, deposit, row);
  ticks(5);
  assert.equal(f.player.getInventory().getAmount(deposit), 1, 'no hammer consumes nothing');
  f.player.getInventory().adds(core.ItemIdentifiers.HAMMER, 1);
  skill(f.player, 'SMITHING', 13);
  await useItem(f, deposit, row);
  ticks(5);
  assert.equal(f.player.getInventory().getAmount(deposit), 1, 'under-level consumes nothing');
  skill(f.player, 'SMITHING', 14);
  const xp = f.player.getSkillManager().getExperience(core.Skill.SMITHING);
  await useItem(f, deposit, row);
  assert.equal(f.player.getInventory().getAmount(deposit), 1, 'not instantaneous');
  ticks(4);
  assert.equal(f.player.getInventory().getAmount(deposit), 0);
  assert.equal(f.player.getSkillManager().getExperience(core.Skill.SMITHING), xp + 30);
  assert.ok(f.player.getInventory().getValidItems().some(item =>
    ![core.ItemIdentifiers.HAMMER, deposit].includes(item.getId())), 'a real cache reward is delivered');
});

test('fish preparation requires knife and grants cooking then prayer at the proper facility', async t => {
  const f = actor(t), raw = core.ItemIdentifiers.RAW_GUPPY;
  assert.ok(Number.isInteger(raw));
  const preparation = locate(/camdozaal_preparation_table/), altar = locate(/^camdozaal_altar$/);
  skill(f.player, 'COOKING', 99);
  f.player.getInventory().adds(raw, 1);
  await useItem(f, raw, preparation);
  ticks(4);
  assert.equal(f.player.getInventory().getAmount(raw), 1, 'no knife preserves raw fish');
  f.player.getInventory().adds(core.ItemIdentifiers.KNIFE, 1);
  const cookXp = f.player.getSkillManager().getExperience(core.Skill.COOKING);
  await useItem(f, raw, preparation);
  assert.equal(f.player.getInventory().getAmount(raw), 1, 'preparation has a tick boundary');
  ticks(2);
  const row = require('../plugins/skills/data/cooking.json').cookables.find(row => row.name === 'guppy');
  const prepared = obj(row.cooked);
  assert.equal(f.player.getInventory().getAmount(raw), 0);
  assert.equal(f.player.getInventory().getAmount(prepared), 1);
  assert.equal(f.player.getSkillManager().getExperience(core.Skill.COOKING), cookXp + row.xp);
  const prayerXp = f.player.getSkillManager().getExperience(core.Skill.PRAYER);
  await useItem(f, prepared, altar);
  assert.equal(f.player.getInventory().getAmount(prepared), 1);
  ticks(2);
  assert.equal(f.player.getInventory().getAmount(prepared), 0);
  assert.equal(f.player.getSkillManager().getExperience(core.Skill.PRAYER), prayerXp + 4);
});

test('vault requires stored payment, starts a real timer and returns on timeout without prior-box loss', async t => {
  const f = actor(t), shard = obj('camdozaal_barronite_shard');
  f.player.setRunEnergy(20);
  const door = locate(/^camdozaal_vault_door$/);
  const outside = new core.Location(door.x + 1, door.y - 1, 0);
  assert.equal(core.RegionManager.blocked(outside, null), false, 'observed door has walkable south floor');
  f.player.moveTo(outside); ticks(3);
  f.player.getInventory().adds(shard, 750);
  await clickObject(f, door, 'Open', false);
  assert.equal(f.player.getPrivateArea(), null, 'carried shards cannot pay entry');
  assert.equal(f.player.getInventory().getAmount(shard), 750);
  const oldBox = obj('camdozaal_vault_chest_low');
  f.player.getInventory().adds(oldBox, 1);
  f.player.setAttribute('camdozaal:stored-shards', 1000);
  let processed = 0, timedArea = null, originalProcess = null;
  const emit = PM.emitObjectInteraction;
  PM.emitObjectInteraction = function(event) {
    const result = emit.call(this, event);
    if (event.player === f.player && !timedArea && f.player.getPrivateArea()) {
      timedArea = f.player.getPrivateArea();
      originalProcess = timedArea.process;
      timedArea.process = function(mobile) {
        if (mobile === f.player) processed++;
        return originalProcess.call(this, mobile);
      };
    }
    return result;
  };
  try { await clickObject(f, door, 'Open', false); }
  finally { PM.emitObjectInteraction = emit; }
  t.after(() => { if (timedArea && originalProcess) timedArea.process = originalProcess; });
  assert.equal(f.player.getAttribute('camdozaal:stored-shards'), 250);
  assert.equal(f.player.getInventory().getAmount(shard), 750, 'entry uses only stored shards');
  const area = f.player.getPrivateArea();
  assert.ok(area, 'paid vault owns a real private Area');
  assert.equal(area.canTeleport(f.player), false);
  const sender = f.player.getPacketSender();
  const count = (first, total) => Array.from({length: total}, (_, i) => sender.getVarbit(first + i)).reduce((a,b) => a + b, 0);
  assert.ok(count(12078, 6) >= 1 && count(12078, 6) <= 5);
  assert.ok(count(12084, 4) >= 2 && count(12084, 4) <= 3);
  assert.equal(count(12088, 3), 3);
  // Move to a seeded reachable pedestal perimeter; actual ordinary Take still has to validate its current morph.
  const pedestal = sceneObjects().find(row => /camdozaal_vault_chest_small_\d+$/.test(row.name)
    && sender.getVarbit(12078 + Number(row.name.split('_').at(-1)) - 1) === 1);
  assert.ok(pedestal);
  await clickObject(f, pedestal, 'Take');
  const temporary = obj('camdozaal_vault_chest_low_temporary');
  assert.equal(f.player.getInventory().getAmount(temporary), 1);
  assert.ok(f.player.getRunEnergy() < 100, 'low energy precondition before timeout');
  assert.ok(processed > 0 && processed < 99, 'all setup area processes were accounted');
  ticks(99 - processed);
  assert.equal(processed, 99);
  assert.equal(f.player.getPrivateArea(), area, 'vault remains active immediately before deadline');
  assert.equal(f.player.getInventory().getAmount(temporary), 1);
  ticks(1);
  assert.equal(processed, 100, 'timeout occurs on actual hundredth Area process');
  assert.equal(f.player.getPrivateArea(), null);
  assert.equal(f.player.getInventory().getAmount(temporary), 0);
  assert.equal(f.player.getInventory().getAmount(oldBox), 1, 'previous-run boxes survive failure');
  assert.ok(f.player.getLocation().equals(outside));
  assert.ok(f.player.getRunEnergy() < 100, 'timeout cannot restore full energy; ordinary recovery allowed');
  assert.equal(Number(f.player.getAttribute('camdozaal:vault-return')) || 0, 0);
});

test('successful vault exit converts only this run and restores run energy', async t => {
  const f = actor(t), door = locate(/^camdozaal_vault_door$/);
  f.player.moveTo(new core.Location(door.x + 1, door.y - 1, 0)); ticks(3);
  f.player.setAttribute('camdozaal:stored-shards', 750);
  await clickObject(f, door, 'Open', false);
  assert.ok(f.player.getPrivateArea());
  const pedestal = sceneObjects().find(row => /^camdozaal_vault_chest_large_1$/.test(row.name));
  await clickObject(f, pedestal, 'Take');
  const temporary = obj('camdozaal_vault_chest_high_temporary'), permanent = obj('camdozaal_vault_chest_high');
  assert.equal(f.player.getInventory().getAmount(temporary), 1);
  f.player.setRunEnergy(20);
  // Seed return to the entrance perimeter; this control is not a claim of natural maze traversal.
  f.player.moveTo(new core.Location(door.x + 1, door.y + 1, 0)); ticks(3);
  await clickObject(f, door, 'Open', false);
  assert.equal(f.player.getPrivateArea(), null);
  assert.equal(f.player.getInventory().getAmount(temporary), 0);
  assert.equal(f.player.getInventory().getAmount(permanent), 1);
  assert.equal(f.player.getRunEnergy(), 100);
});

async function ramarnoActor(f, t, gameval = 'camdozaal_ramarno_multi') {
  const id = core.CacheDefinitions.getNpcId(gameval);
  assert.ok(Number.isInteger(id), 'current cache Ramarno gameval');
  const spawn = require('../data/definitions/npc-spawns.json').find(row => row.id === id);
  assert.ok(spawn, 'actual generated Ramarno world placement');
  const npc = PM.spawnNpc({ id, x: spawn.x, y: spawn.y, z: spawn.level ?? 0, wanderRadius: 0 });
  assert.ok(npc);
  t.after(() => { if (npc.isRegistered()) core.World.getRemoveNPCQueue().push(npc); ticks(1); });
  ticks(1);
  assert.equal(npc.isRegistered(), true);
  const at = npc.getLocation();
  let reached = false;
  for (const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
    const tile = new core.Location(at.getX()+dx, at.getY()+dy, at.getZ());
    if (core.RegionManager.blocked(tile, null)) continue;
    f.player.moveTo(tile);
    if (core.PathFinder.reachedEntity(f.player, npc)) { reached = true; break; }
  }
  assert.equal(reached, true, 'engine-qualified reachable perimeter at actual world placement');
  ticks(3);
  assert.equal(f.player.isNeedsPlacement(), false);
  return npc;
}
async function exchange(f, t) {
  const npc = await ramarnoActor(f, t);
  const op = npc.getCurrentDefinition(f.player).getActions().indexOf('Exchange') + 1;
  assert.ok(op > 0, 'real Ramarno Exchange option');
  let consumerEntries = 0;
  const emit = PM.emitNpcInteraction;
  PM.emitNpcInteraction = function(event) {
    if (event.player === f.player && event.npc === npc) {
      consumerEntries++;
      assert.equal(event.npcId, npc.getContentId(f.player));
      assert.equal(event.clickType, op);
    }
    return emit.call(this, event);
  };
  try {
    await f.connection.dispatch([{ type: 'npc_option', index: npc.getIndex(), clickType: op }]);
    for (let i = 0; i < 20 && !consumerEntries; i++) ticks(1);
    assert.equal(consumerEntries, 1, 'decoded Exchange reaches exactly one real NPC consumer');
    assert.equal(f.player.getInterfaceId(), 685, 'ordinary NPC option opens real exchange');
  } finally { PM.emitNpcInteraction = emit; }
  return npc;
}
async function buy(f, component) {
  await f.connection.dispatch([{ type: 'widget_action', widgetId: (685 << 16) | component,
    groupId: 685, childId: component, buttonNum: 1, opId: 1, itemId: -1, slot: -1 }]);
  ticks(1);
}

test('exchange refuses unaffordable purchases, pays carried plus stored exactly once, and activates each consumer flag', async t => {
  const f = actor(t), shards = obj('camdozaal_barronite_shard');
  await exchange(f, t);
  await buy(f, 3);
  assert.equal(Number(f.player.getAttribute('camdozaal:buffs')) || 0, 0);
  f.player.getInventory().adds(shards, 2000);
  f.player.setAttribute('camdozaal:stored-shards', 12000);
  const components = [3, 4, 6, 8, 10];
  let cost = 0;
  for (let i = 0; i < components.length; i++) {
    await buy(f, components[i]);
    cost += i === 4 ? 3000 : 2500;
    assert.equal(f.player.getAttribute('camdozaal:buffs'), (1 << (i + 1)) - 1);
    assert.equal(f.player.getInventory().getAmount(shards) + f.player.getAttribute('camdozaal:stored-shards'), 14000 - cost);
  }
  const balance = f.player.getAttribute('camdozaal:stored-shards');
  await buy(f, 3);
  assert.equal(f.player.getAttribute('camdozaal:stored-shards'), balance, 'permanent purchase cannot charge twice');
  await buy(f, 12);
  const expires = f.player.getAttribute('camdozaal:boost-expires-at');
  assert.ok(expires > Date.now() + 3590000 && expires <= Date.now() + 3600000, 'boost lasts an actual hour');
  assert.equal(f.player.getAttribute('camdozaal:stored-shards'), balance - 1000);
  await buy(f, 12);
  assert.equal(f.player.getAttribute('camdozaal:boost-expires-at'), expires);
  assert.equal(f.player.getAttribute('camdozaal:stored-shards'), balance - 1000);
});

test('purchased mining/fishing/defence/luck consumers affect only their supported targets', t => {
  const { player } = actor(t);
  player.moveTo(new core.Location(2955, 5800, 0)); ticks(3);
  player.setAttribute('camdozaal:buffs', 31);
  player.setAttribute('camdozaal:boost-expires-at', Date.now() + 3600000);
  const fish = { player, itemId: core.ItemIdentifiers.RAW_GUPPY, chance: 0.5 };
  PM.emitCustomEvent('fishing:catch-chance', fish);
  assert.ok(Math.abs(fish.chance - 0.65) < 1e-12);
  const unrelated = { player, itemId: core.ItemIdentifiers.RAW_SHRIMPS, chance: 0.5 };
  PM.emitCustomEvent('fishing:catch-chance', unrelated);
  assert.equal(unrelated.chance, 0.5);
  const random = Math.random;
  try {
    Math.random = () => 0;
    const mining = { player, rock: 'Barronite rocks', success: false, chance: 0.5 };
    PM.emitCustomEvent('mining:attempt', mining);
    assert.equal(mining.success, true);
    const other = { player, rock: 'Copper rocks', success: false, chance: 0.5 };
    PM.emitCustomEvent('mining:attempt', other);
    assert.equal(other.success, false);
  } finally { Math.random = random; }
  const coreIds = core.CacheDefinitions;
  const golem = { isNpc: () => true, getId: () => coreIds.getNpcId('camdozaal_golem_mind') };
  const target = { player, npc: golem, rules: [] };
  PM.emitCustomEvent('npc-drops:chance', target);
  assert.equal(target.rules.length, 1);
  assert.ok(target.rules[0].multiplier > 1);
  assert.equal(target.rules[0].pattern.test('Barronite guard'), true);
  const beforeLevel = player.getSkillManager().getCurrentLevel(core.Skill.DEFENCE);
  const defence = { attacker: golem, target: player, defenceRoll: 100 };
  PM.emitCustomEvent('combat:defence-roll', defence);
  assert.ok(defence.defenceRoll > 100);
  assert.equal(player.getSkillManager().getCurrentLevel(core.Skill.DEFENCE), beforeLevel);
  player.moveTo(new core.Location(3200, 3200, 0)); ticks(3);
  const outside = { player, itemId: core.ItemIdentifiers.RAW_GUPPY, chance: 0.5 };
  PM.emitCustomEvent('fishing:catch-chance', outside);
  assert.equal(outside.chance, 0.5);
});

test('ordinary Camdozaal net option catches actual fish through the fishing task', async t => {
  const f = actor(t);
  skill(f.player, 'FISHING', 99);
  f.player.getInventory().adds(core.ItemIdentifiers.SMALL_FISHING_NET, 1);
  const id = core.CacheDefinitions.getNpcId('camdozaal_fishingspot_1');
  const npc = PM.spawnNpc({ id, x: 2922, y: 5788, z: 0, wanderRadius: 0 });
  assert.ok(npc);
  t.after(() => { if (npc.isRegistered()) core.World.getRemoveNPCQueue().push(npc); ticks(1); });
  // Supplied reachable shore position: catches, not natural travel to the ruins.
  const shore = [[2923,5788],[2921,5788],[2922,5789],[2922,5787]]
    .map(([x,y]) => new core.Location(x,y,0)).find(tile => !core.RegionManager.blocked(tile, null));
  assert.ok(shore, 'current mapped fishing spot has a reachable adjacent shore');
  assert.equal(core.RegionManager.blocked(shore, null), false, 'supplied shore tile is real walkable floor');
  f.player.moveTo(shore); ticks(3);
  const actions = npc.getCurrentDefinition(f.player).getActions();
  const op = actions.indexOf('Small Net') + 1;
  assert.ok(op > 0);
  const xp = f.player.getSkillManager().getExperience(core.Skill.FISHING);
  const random = Math.random;
  try {
    // Supported ordinary non-rare path through estimated catch chart; restored before cleanup.
    Math.random = () => 0.5;
    await f.connection.dispatch([{ type: 'npc_option', index: npc.getIndex(), clickType: op }]);
    ticks(20);
  } finally { Math.random = random; }
  assert.ok(f.player.getInventory().getAmount(core.ItemIdentifiers.RAW_TETRA) > 0);
  assert.ok(f.player.getSkillManager().getExperience(core.Skill.FISHING) > xp);
  f.player.getMovementQueue().reset();
  f.player.closeInterruptibleInterfaces();
});

test('vault recovery removes only temporary boxes and restores saved entrance after interrupted run', t => {
  const { player } = actor(t);
  const temporary = obj('camdozaal_vault_chest_mid_temporary'), permanent = obj('camdozaal_vault_chest_mid');
  player.getInventory().adds(temporary, 1);
  player.getInventory().adds(permanent, 1);
  player.setAttribute('camdozaal:vault-return', 2970 * 16384 + 5823);
  player.moveTo(new core.Location(2970, 5850, 0));
  PM.emitPlayerLogin({ player, username: player.getUsername() });
  assert.equal(player.getInventory().getAmount(temporary), 0);
  assert.equal(player.getInventory().getAmount(permanent), 1);
  assert.equal(Number(player.getAttribute('camdozaal:vault-return')) || 0, 0);
  assert.ok(player.getLocation().equals(new core.Location(2970, 5823, 0)));
});

test('external relocation out of the vault preserves the established destination', async t => {
  const f = actor(t), door = locate(/^camdozaal_vault_door$/);
  f.player.moveTo(new core.Location(door.x + 1, door.y - 1, 0)); ticks(3);
  f.player.setAttribute('camdozaal:stored-shards', 750);
  await clickObject(f, door, 'Open', false);
  assert.ok(f.player.getPrivateArea());
  const temporary = obj('camdozaal_vault_chest_low_temporary');
  f.player.getInventory().adds(temporary, 1); // seeded carried state, not acquisition proof
  const destination = new core.Location(3222, 3218, 0);
  f.player.moveTo(destination);
  ticks(3); // actual engine AreaManager departure, no direct postLeave call
  assert.ok(f.player.getLocation().equals(destination), 'quest/forced destination survives departure cleanup');
  assert.equal(f.player.getPrivateArea(), null);
  assert.equal(f.player.getInventory().getAmount(temporary), 0);
  assert.equal(Number(f.player.getAttribute('camdozaal:vault-return')) || 0, 0);
});

test('actual player death drops temporary vault loot before item snapshot and preserves respawn', async t => {
  const f = actor(t), door = locate(/^camdozaal_vault_door$/);
  f.player.moveTo(new core.Location(door.x + 1, door.y - 1, 0)); ticks(3);
  f.player.setAttribute('camdozaal:stored-shards', 750);
  await clickObject(f, door, 'Open', false);
  assert.ok(f.player.getPrivateArea());
  const temporary = obj('camdozaal_vault_chest_low_temporary');
  f.player.getInventory().adds(temporary, 1); // seed only acquisition; actual death task remains native
  let beforeSnapshot = false, deathObserved = false, respawn = null;
  const emit = PM.emitCustomEvent, move = f.player.moveTo;
  PM.emitCustomEvent = function(name, event) {
    const result = emit.call(this, name, event);
    if (event?.player === f.player && name === 'player:death-bones') {
      beforeSnapshot = true;
      assert.equal(f.player.getInventory().getAmount(temporary), 0, 'temporary loot absent before kept/dropped snapshot');
    }
    if (event?.player === f.player && name === 'player:died') deathObserved = true;
    return result;
  };
  f.player.moveTo = function(destination) {
    if (deathObserved && (destination.getY() < 5757 || destination.getY() > 5869)) respawn = destination.clone();
    return move.call(this, destination);
  };
  try {
    f.player.setHitpoints(0);
    f.player.appendDeath();
    ticks(10);
    assert.equal(beforeSnapshot, true);
    assert.equal(deathObserved, true);
    assert.ok(respawn, 'actual default or handled death establishes an external respawn');
    assert.ok(f.player.getLocation().equals(respawn), 'AreaManager cleanup preserves death destination');
    assert.equal(f.player.getPrivateArea(), null);
    assert.equal(f.player.getInventory().getAmount(temporary), 0);
    assert.equal(Number(f.player.getAttribute('camdozaal:vault-return')) || 0, 0);
  } finally { PM.emitCustomEvent = emit; f.player.moveTo = move; }
});

test('full inventory crushing admits duplicate/new relics but refuses saturated shard overflow atomically', async t => {
  for (const kind of ['duplicate', 'new', 'overflow']) {
    const f = actor(t), deposit = obj('camdozaal_barronite_deposit');
    const rewardId = obj(kind === 'overflow' ? 'camdozaal_barronite_shard' : 'camdozaal_relic_1');
    skill(f.player, 'SMITHING', 14);
    f.player.getInventory().adds(core.ItemIdentifiers.HAMMER, 1);
    f.player.getInventory().adds(deposit, 1);
    if (kind !== 'new') f.player.getInventory().adds(rewardId, kind === 'overflow' ? 0x7fffffff : 1);
    f.player.getInventory().adds(core.ItemIdentifiers.BRONZE_DAGGER, kind === 'new' ? 26 : 25);
    assert.equal(f.player.getInventory().getFreeSlots(), 0, 'positive full inventory precondition');
    const xp = f.player.getSkillManager().getExperience(core.Skill.SMITHING);
    const emit = PM.emitCustomEvent;
    PM.emitCustomEvent = function(name, event) {
      // Select a declared reward at the roll seam; inventory exchange/ordinary action/XP stay actual.
      if (name === 'camdozaal:deposit-reward' && event.player === f.player) event.reward = { itemId: rewardId, amount: kind === 'overflow' ? 6 : 1 };
      return emit.call(this, name, event);
    };
    try { await useItem(f, deposit, locate(/camdozaal_anvil/)); ticks(4); }
    finally { PM.emitCustomEvent = emit; }
    assert.equal(f.player.getInventory().getAmount(deposit), kind === 'overflow' ? 1 : 0);
    assert.equal(f.player.getInventory().getAmount(rewardId), kind === 'duplicate' ? 2 : kind === 'new' ? 1 : 0x7fffffff);
    assert.equal(f.player.getSkillManager().getExperience(core.Skill.SMITHING), xp + (kind === 'overflow' ? 0 : 30));
    assert.equal(f.player.getInventory().getFreeSlots(), 0);
  }
});

test('each selected blue barrier crosses its actual cache footprint while yellow offers no Enter', async t => {
  const f = actor(t), door = locate(/^camdozaal_vault_door$/);
  f.player.moveTo(new core.Location(door.x + 1, door.y - 1, 0)); ticks(3);
  f.player.setAttribute('camdozaal:stored-shards', 750);
  await clickObject(f, door, 'Open', false);
  assert.ok(f.player.getPrivateArea());
  const groups = [[1,2],[3,4],[5,6,7],[8,9,10],[11,12],[13,15,18],[17,19]];
  for (let i = 0; i < groups.length; i++) {
    const selected = f.player.getPacketSender().getVarbit(12069 + i);
    assert.ok(selected >= 0 && selected < groups[i].length);
    const blue = locate(new RegExp(`^camdozaal_vault_barrier_${groups[i][selected]}$`));
    const definition = ObjectDefinition.forPlayer(blue.id, f.player);
    assert.ok(definition.getInteractions().includes('Enter'));
    const footprint = ObjectDefinition.forId(blue.id);
    let width = footprint.getSizeX(), height = footprint.getSizeY();
    if (blue.face & 1) [width, height] = [height, width];
    assert.ok((width === 1 && height === 2) || (width === 2 && height === 1), 'actual cache footprint is two tiles');
    const crossX = height > width;
    const candidates = Array.from({length: crossX ? height : width}, (_, offset) => crossX
      ? [new core.Location(blue.x - 1, blue.y + offset, 0), new core.Location(blue.x + width, blue.y + offset, 0)]
      : [new core.Location(blue.x + offset, blue.y - 1, 0), new core.Location(blue.x + offset, blue.y + height, 0)]);
    const sides = candidates.find(pair => pair.every(tile => !core.RegionManager.blocked(tile, f.player.getPrivateArea())));
    assert.ok(sides, 'actual barrier has walkable floor on opposite footprint sides');
    f.player.moveTo(sides[0]); ticks(3);
    await clickObject(f, blue, 'Enter', false);
    assert.ok(f.player.getLocation().equals(sides[1]), 'ordinary Enter crosses to the opposite side of the footprint');
    await clickObject(f, blue, 'Enter', false);
    assert.ok(f.player.getLocation().equals(sides[0]), 'ordinary reverse Enter crosses back through the same footprint');
    const yellow = locate(new RegExp(`^camdozaal_vault_barrier_${groups[i][(selected + 1) % groups[i].length]}$`));
    const closed = ObjectDefinition.forPlayer(yellow.id, f.player);
    assert.equal(closed.getInteractions()?.includes('Enter') ?? false, false, 'yellow cannot offer crossing');
  }
});

test('shards, permanent purchases and wall-clock boost survive native save/restore', t => {
  const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
  const f = actor(t);
  const deadline = Date.now() + 3600000;
  f.player.setAttribute('camdozaal:stored-shards', 12345);
  f.player.setAttribute('camdozaal:buffs', 31);
  f.player.setAttribute('camdozaal:boost-expires-at', deadline);
  const save = PlayerSave.fromPlayer(f.player);
  assert.equal(save.attributes['camdozaal:stored-shards'], 12345);
  assert.equal(save.attributes['camdozaal:buffs'], 31);
  assert.equal(save.attributes['camdozaal:boost-expires-at'], deadline);
  const g = actor(t);
  save.applyToPlayer(g.player);
  PM.emitPlayerLogin({ player: g.player, username: g.player.getUsername() });
  assert.equal(g.player.getAttribute('camdozaal:stored-shards'), 12345);
  assert.equal(g.player.getAttribute('camdozaal:buffs'), 31);
  assert.equal(g.player.getAttribute('camdozaal:boost-expires-at'), deadline, 'login does not extend boost');
  const original = Date.now;
  try {
    Date.now = () => deadline + 1;
    assert.equal(require('../plugins/minigames/camdozaal/Shared.Camdozaal').boostTicks(g.player), 0, 'expired while offline');
  } finally { Date.now = original; }
});

test('native accuracy producer applies golem Defence bonus without changing actual skill levels', t => {
  const { player } = actor(t);
  player.moveTo(new core.Location(2950, 5800, 0)); ticks(3);
  skill(player, 'DEFENCE', 50);
  const id = core.CacheDefinitions.getNpcId('camdozaal_golem_mind');
  const npc = PM.spawnNpc({ id, x: 2951, y: 5800, z: 0, wanderRadius: 0 });
  assert.ok(npc);
  t.after(() => { if (npc.isRegistered()) core.World.getRemoveNPCQueue().push(npc); ticks(1); });
  ticks(1);
  const seen = [], emit = PM.emitCustomEvent;
  PM.emitCustomEvent = function(name, event) {
    const result = emit.call(this, name, event);
    if (name === 'combat:defence-roll' && event.attacker === npc && event.target === player) seen.push(event.defenceRoll);
    return result;
  };
  const level = player.getSkillManager().getCurrentLevel(core.Skill.DEFENCE);
  try {
    player.setAttribute('camdozaal:buffs', 0);
    core.AccuracyFormulasDpsCalc.rollAccuracy(npc, player, core.CombatType.MELEE);
    player.setAttribute('camdozaal:buffs', 1 << 2);
    core.AccuracyFormulasDpsCalc.rollAccuracy(npc, player, core.CombatType.MELEE);
    assert.equal(seen.length, 2, 'actual native accuracy producer emitted each event');
    assert.ok(seen[1] > seen[0]);
    assert.equal(player.getSkillManager().getCurrentLevel(core.Skill.DEFENCE), level);
  } finally { PM.emitCustomEvent = emit; }
});

test('declared deposit approximation keeps rare boundaries, conditional hammer and Luck scaling explicit', t => {
  const { player } = actor(t);
  player.moveTo(new core.Location(2955, 5800, 0)); ticks(3);
  const K = 1 / 200 + 5 / 350, oldRandom = Math.random, oldMembers = core.WorldDefinition.isMembersWorld;
  const reward = (members, values, flags = 0) => {
    player.setAttribute('camdozaal:buffs', flags);
    player.setAttribute('camdozaal:boost-expires-at', 0);
    core.WorldDefinition.isMembersWorld = () => members;
    let index = 0;
    Math.random = () => { assert.ok(index < values.length, 'bounded declared reward draws'); return values[index++]; };
    const event = { player, reward: null };
    PM.emitCustomEvent('camdozaal:deposit-reward', event);
    assert.ok(event.reward);
    return event.reward;
  };
  try {
    assert.deepEqual(reward(false, [0, 0]), { itemId: obj('barronite_mace_1'), amount: 1 });
    assert.deepEqual(reward(false, [K - 1e-8, 0.999]), { itemId: obj('camdozaal_relic_5'), amount: 1 });
    assert.deepEqual(reward(false, [K, 0, 0]), { itemId: obj('camdozaal_barronite_shard'), amount: 15 });
    assert.deepEqual(reward(false, [K + 0.001, 0.99, 0]), { itemId: obj('camdozaal_barronite_shard'), amount: 6 });
    assert.deepEqual(reward(true, [0, 1 / 15 - 1e-8]), { itemId: obj('imcando_hammer_broken'), amount: 1 });
    assert.deepEqual(reward(true, [0, 1 / 15, 0]), { itemId: obj('barronite_mace_1'), amount: 1 });
    assert.deepEqual(reward(false, [K + 0.0001, 0], 1 << 4), { itemId: obj('barronite_mace_1'), amount: 1 });
    assert.ok(Math.abs(K / (1 - 1 / 15) / 15 - 27 / 19600) < 1e-12,
      'declared member hammer marginal is about1/726, not a claimed1/300 match');
  } finally { Math.random = oldRandom; core.WorldDefinition.isMembersWorld = oldMembers; }
});

async function openBox(f, id) {
  await f.connection.dispatch([{ type: 'inventory_action', slot: f.player.getInventory().getSlotForItemId(id),
    itemId: id, widgetId: Inventory.INTERFACE_ID, option: 'Open', optionIndex: 1 }]);
  ticks(1);
}
test('ordinary lockbox Open preserves three rolls, one gear maximum, noted quantities and overflow', async t => {
  for (const full of [false, true]) {
    const f = actor(t), box = obj('camdozaal_vault_chest_low');
    f.player.moveTo(new core.Location(2970, 5823, 0)); ticks(3);
    f.player.getInventory().adds(box, 1);
    if (full) f.player.getInventory().adds(core.ItemIdentifiers.BRONZE_DAGGER, 27);
    const gear = obj('adamant_platebody');
    const copper = core.ItemDefinition.forId(obj('copper_ore')).getNoteId();
    assert.ok(copper >= 0);
    const random = Math.random;
    try { Math.random = () => 0; await openBox(f, box); }
    finally { Math.random = random; }
    assert.equal(f.player.getInventory().getAmount(box), 0);
    const ground = id => core.World.getItems().filter(item => item.getOwner() === f.player.getUsername()
      && item.getItem().getId() === id).reduce((n,item) => n + item.getItem().getAmount(), 0);
    assert.equal(f.player.getInventory().getAmount(gear) + ground(gear), 1, 'gear hits only once');
    assert.equal(f.player.getInventory().getAmount(copper) + ground(copper), 4, 'two standard rolls of two noted ore');
    if (full) assert.equal(ground(copper), 4, 'reward overflow remains on actual floor');
  }
});

test('Ramarno Talk-to retains Below Ice Mountain and Desert Treasure II transcript authority', async t => {
  const dialogues = require('../plugins/npcs/NpcDialogues.plugin');
  for (const dt2 of [false, true]) {
    const f = actor(t);
    let npc;
    if (dt2) {
      const quest = Runtime.getRegisteredQuests().findLast(q => q.key === 'desert_treasure_ii');
      assert.ok(quest); quest.setStage(f.player, 7);
      npc = await exchange(f, t);
      f.player.getPacketSender().sendInterfaceRemoval();
      assert.equal(npc.getContentId(f.player), core.CacheDefinitions.getNpcId('camzodaal_ramarno'));
    } else {
      // The unintroduced dwarf exists at the entrance. Do not mix met=0 with
      // the workshop-only varbit2 spawn used for post-introduction Exchange.
      f.player.setAttribute('quest.below_ice_mountain.met-ramarno', 0);
      f.player.getPacketSender().sendVarbit(12068, 0);
      npc = await ramarnoActor(f, t, 'camdozaal_ramarno_entrance_multi');
      assert.equal(npc.getContentId(f.player), core.CacheDefinitions.getNpcId('camzodaal_ramarno_entrance'));
    }
    const original = dialogues.startDialogue, observed = [], emit = PM.emitNpcInteraction;
    let consumerEntries = 0;
    PM.emitNpcInteraction = function(event) {
      if (event.player === f.player && event.npc === npc) consumerEntries++;
      return emit.call(this, event);
    };
    dialogues.startDialogue = function(api, event, steps, branches, context) {
      if (event.player === f.player) observed.push(context?.pages);
      return original.call(this, api, event, steps, branches, context);
    };
    try {
      const op = npc.getCurrentDefinition(f.player).getActions().indexOf('Talk-to') + 1;
      assert.ok(op > 0);
      await f.connection.dispatch([{ type: 'npc_option', index: npc.getIndex(), clickType: op }]);
      for (let i = 0; i < 20 && !observed.length; i++) ticks(1);
      assert.equal(consumerEntries, 1, 'ordinary Talk-to reaches the real NPC consumer exactly once');
      assert.ok(observed.some(pages => pages?.some(p => p.page === (dt2 ? 'Desert Treasure II - The Fallen Empire' : 'Below Ice Mountain'))), `quest dialogue source context dt2=${dt2}: ${JSON.stringify(observed)}`);
      assert.notEqual(f.player.getInterfaceId(), 685, 'Talk-to is not replaced by the Exchange');
      assert.ok(f.player.getDialogueManager().isActive());
    } finally { dialogues.startDialogue = original; PM.emitNpcInteraction = emit; }
  }
});

test('imbued barronite on the forge remains owned by Defender of Varrock', async t => {
  const f = actor(t), quest = Runtime.getRegisteredQuests().findLast(q => q.key === 'defender_of_varrock');
  assert.ok(quest); quest.setStage(f.player, 32);
  const item = core.ItemIdentifiers.IMBUED_BARRONITE;
  f.player.getInventory().adds(item, 1);
  const stored = Number(f.player.getAttribute('camdozaal:stored-shards')) || 0;
  await useItem(f, item, locate(/bim_ruins_wallkit_sacred_forge/));
  assert.equal(f.player.getInventory().getAmount(item), 0, 'quest consumes its own imbued material');
  assert.ok(quest.getStage(f.player) >= 34, 'quest forge progression still occurs');
  assert.equal(Number(f.player.getAttribute('camdozaal:stored-shards')) || 0, stored, 'quest material is not shard fuel');
});

test('carried Imcando hammer supports the ordinary crusher exchange', async t => {
  const f = actor(t), deposit = obj('camdozaal_barronite_deposit');
  skill(f.player, 'SMITHING', 14);
  f.player.getInventory().adds(deposit, 1);
  f.player.getInventory().adds(core.ItemIdentifiers.IMCANDO_HAMMER, 1);
  assert.equal(f.player.getEquipment().contains(core.ItemIdentifiers.IMCANDO_HAMMER), false);
  await useItem(f, deposit, locate(/camdozaal_anvil/)); ticks(4);
  assert.equal(f.player.getInventory().getAmount(deposit), 0);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.IMCANDO_HAMMER), 1);
});

test('permanent preparation buff permits guppy ruin below36 and guarantees success at36', async t => {
  const preparation = locate(/^camdozaal_preparation_table$/);
  for (const level of [34, 35, 36]) {
    const f = actor(t), raw = obj('raw_guppy'), prepared = obj('guppy'), ruined = obj('ruined_guppy');
    skill(f.player, 'COOKING', level);
    f.player.setAttribute('camdozaal:buffs', 1 << 1);
    f.player.getInventory().adds(core.ItemIdentifiers.KNIFE, 1);
    f.player.getInventory().adds(raw, 1);
    const random = Math.random;
    try { Math.random = () => 0.999; await useItem(f, raw, preparation); ticks(2); }
    finally { Math.random = random; }
    assert.equal(f.player.getInventory().getAmount(raw), 0);
    assert.equal(f.player.getInventory().getAmount(prepared), level === 36 ? 1 : 0);
    assert.equal(f.player.getInventory().getAmount(ruined), level < 36 ? 1 : 0);
  }
});

test('ordinary big net catch reaches clue-bottle rolls and the Luck consumer', async t => {
  const f = actor(t);
  skill(f.player, 'FISHING', 99);
  f.player.setAttribute('camdozaal:buffs', 1 << 4);
  f.player.getInventory().adds(core.ItemIdentifiers.BIG_FISHING_NET, 1);
  const npc = PM.spawnNpc({ id: core.CacheDefinitions.getNpcId('camdozaal_fishingspot_1'), x: 2922, y: 5788, z: 0, wanderRadius: 0 });
  assert.ok(npc);
  t.after(() => { if (npc.isRegistered()) core.World.getRemoveNPCQueue().push(npc); ticks(1); });
  const shore = [[2923,5788],[2921,5788],[2922,5789],[2922,5787]]
    .map(([x,y]) => new core.Location(x,y,0)).find(tile => !core.RegionManager.blocked(tile, null));
  assert.ok(shore); f.player.moveTo(shore); ticks(3);
  const op = npc.getCurrentDefinition(f.player).getActions().indexOf('Big Net') + 1;
  assert.ok(op > 0);
  const seen = [], emit = PM.emitCustomEvent, random = Math.random;
  PM.emitCustomEvent = function(name, event) {
    const result = emit.call(this, name, event);
    if (name === 'treasure-trails:vessel-chance' && event.player === f.player && event.tier === 'beginner') seen.push({ ...event });
    return result;
  };
  try {
    Math.random = () => 0.5;
    await f.connection.dispatch([{ type: 'npc_option', index: npc.getIndex(), clickType: op }]);
    ticks(20);
    assert.ok(f.player.getInventory().getAmount(core.ItemIdentifiers.RAW_TETRA)
      + f.player.getInventory().getAmount(core.ItemIdentifiers.RAW_CATFISH) > 0);
    assert.ok(seen.length > 0, 'actual landed catch invokes ClueBottles producer');
    assert.ok(seen.every(event => event.vessel === 'bottle' && event.multiplier > 1));
    const insideRolls = seen.length;
    // Negative scope fixture: relocate this owned NPC, not a claim of a retail spawn outside the ruins.
    const outsideNpc = new core.Location(3222, 3218, 0);
    core.RegionManager.loadMapFiles(3222, 3218);
    const outsideShore = [[3223,3218],[3221,3218],[3222,3219],[3222,3217]]
      .map(([x,y]) => new core.Location(x,y,0)).find(tile => !core.RegionManager.blocked(tile, null));
    assert.ok(outsideShore);
    npc.moveTo(outsideNpc); f.player.moveTo(outsideShore); ticks(3);
    await f.connection.dispatch([{ type: 'npc_option', index: npc.getIndex(), clickType: op }]); ticks(20);
    const outsideRolls = seen.slice(insideRolls);
    assert.ok(outsideRolls.length > 0, 'same native producer runs outside the buff area');
    assert.ok(outsideRolls.every(event => event.multiplier === 1), 'Camdozaal Luck does not affect outside catches');
  } finally { PM.emitCustomEvent = emit; Math.random = random; }
});

test('actual members Area owner processes Boost countdown and every published warning', async t => {
  const f = actor(t), shards = obj('camdozaal_barronite_shard');
  assert.equal(core.WorldDefinition.isMembersWorld(), true, 'fixture is the real members plugin profile');
  f.player.getInventory().adds(shards, 1000);
  await exchange(f, t);
  assert.equal(f.player.getArea().getName(), 'CamdozaalGolemArea', 'existing members Area is the actual first owner');
  await buy(f, 12);
  assert.ok(f.player.getAttribute('camdozaal:boost-expires-at') > Date.now());
  const messages = [], send = f.player.sendMessage;
  f.player.sendMessage = function(text) { messages.push(text); return send.call(this, text); };
  try {
    // Seed expiry deadlines, not elapsed wall-clock minutes. All processing goes
    // through actual World/AreaManager ownership, never a direct Boost callback.
    f.player.setAttribute('camdozaal:boost-expires-at', Date.now() + 501 * 600); ticks(1);
    assert.deepEqual(messages, [], 'no early five-minute warning');
    const expected = [];
    for (const [remaining, minutes, text] of [
      [499, 5, 'You have less than 5 mins of Boosted buff left in Camdozaal.'],
      [199, 2, 'You have less than 2 mins of Boosted buff left in Camdozaal.'],
      [99, 1, 'You have less than 1 min of Boosted buff left in Camdozaal.'],
      [-1, 0, 'Your Camdozaal Boosted buff has run out.'],
    ]) {
      f.player.setAttribute('camdozaal:boost-expires-at', Date.now() + remaining * 600); ticks(1);
      expected.push(text);
      assert.deepEqual(messages, expected, 'actual owning Area emits the next warning exactly once');
      assert.equal(f.player.getPacketSender().getVarbit(12106), minutes, 'actual owner updates cached Boost countdown');
    }
    ticks(3);
    assert.deepEqual(messages, expected, 'expiry is not repeated every tick');
  } finally { f.player.sendMessage = send; }
});

test('shared public Area lifecycle preserves ordinary golem awakening and departure restoration', async t => {
  const f = actor(t), id = core.CacheDefinitions.getNpcId('camdozaal_golem_chaos_rock');
  const spawn = require('../data/definitions/npc-spawns.json').find(row => row.id === id);
  assert.ok(spawn);
  const npc = PM.spawnNpc({ id, x: spawn.x, y: spawn.y, z: spawn.level ?? 0, wanderRadius: 0 });
  assert.ok(npc);
  t.after(() => { if (npc.isRegistered()) core.World.getRemoveNPCQueue().push(npc); ticks(1); });
  ticks(1);
  const index = npc.getIndex(), originalHp = npc.getHitpoints();
  let reached = false;
  for (const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
    const tile = new core.Location(spawn.x + dx, spawn.y + dy, spawn.level ?? 0);
    if (core.RegionManager.blocked(tile, null)) continue;
    f.player.moveTo(tile);
    if (core.PathFinder.reachedEntity(f.player, npc)) { reached = true; break; }
  }
  assert.equal(reached, true); ticks(3);
  assert.equal(f.player.getArea().getName(), 'CamdozaalGolemArea');
  const op = npc.getCurrentDefinition(f.player).getActions().indexOf('Awaken') + 1;
  assert.ok(op > 0);
  await f.connection.dispatch([{ type: 'npc_option', index, clickType: op }]); ticks(1);
  assert.equal(npc.getId(), core.CacheDefinitions.getNpcId('camdozaal_golem_chaos'));
  assert.equal(npc.getOwner(), f.player);
  f.player.moveTo(new core.Location(3222, 3218, 0)); ticks(3);
  assert.equal(npc.getId(), id, 'existing golem postLeave restores rubble');
  assert.equal(npc.getIndex(), index, 'same registered world slot retained');
  assert.equal(npc.getOwner(), null);
  assert.equal(npc.getHitpoints(), originalHp);
});
