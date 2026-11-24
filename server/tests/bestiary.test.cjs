process.env.DISABLE_PLAYER_BOTS = '1';
const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
const { decodePluginMessagePayload } = require('../dist/net/protocol/ClientProtocol');
const Bestiary = require('../plugins/interface/Bestiary.entry');
const Examine = require('../plugins/interface/MonsterExamine.entry');
const { knownSpawns, MAX_PINS } = require('../plugins/interface/bestiary/Spawns.Bestiary');
const { catalog: buildCatalog, encounterIds, search, groupedEntries } = require('../plugins/interface/bestiary/Catalog.Bestiary');
const { baseAccuracy } = require('../plugins/interface/monsterexamine/Accuracy.MonsterExamine');
const { WORLD_MAP_GROUP_ID } = require('../dist/net/protocol/WorldMapProtocol');
const { Layout } = Bestiary._test;
let core;
const encounterProviders = new Map();
function sourceApi(name, api = PM.createApi(name)) {
  return { ...api, withProfileLabel(label) { return sourceApi(name, api.withProfileLabel(label)); }, onCustomEvent(event, handler) {
    if (event === 'bestiary:encounters') {
      const handlers = encounterProviders.get(name) ?? [];
      handlers.push(handler); encounterProviders.set(name, handlers);
    }
    return api.onCustomEvent(event, handler);
  } };
}
function sourceIds(name) {
  const request = { npcIds: new Set() };
  for (const handler of encounterProviders.get(name) ?? []) handler(request);
  return request.npcIds;
}
const catalog = value => buildCatalog(value, encounterIds(PM.createApi('Bestiary')));
const bossIds = new Map([
  ['Cerberus', [5862]], ['Kraken', [494]], ['Zulrah', [2042, 2043, 2044]], ['GiantLairs', [7416, 8195]],
  ['Skotizo', [7286]], ['Nex', [11278]], ['Scurrius', [7221]], ['Vardorvis', [12223]], ['Araxxor', [13668]],
  ['MaggotKing', [15742]], ['Vorkath', [8061]], ['MoonsOfPeril', [13011, 13012, 13013]], ['Amoxliatl', [13685]],
  ['DoomOfMokhaiotl', [14707]], ['MadAngel', [16305]], ['GemstoneCrab', [14779]],
  ['Nightmare', [9425, 9426, 9427, 9416, 9417, 9418, 11153]], ['RoyalTitans', [12596, 14147]],
  ['ShellbaneGryphon', [14860]], ['GrotesqueGuardians', [7852, 7884]],
  ['Hueycoatl', [14009]], ['Yama', [14176]], ['PhantomMuspah', [12077, 12078]],
]);
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
  core = PM.getCoreApi();
  require('../plugins/npcs/NpcSpawns.plugin').register(PM.createApi('NpcSpawns'));
  const spawns = new core.NpcSpawnDefinitionLoader();
  spawns.applyToWorld = () => 0;
  spawns.load();
  require('../plugins/npcs/NpcDrops.plugin').register({ ...sourceApi('NpcDrops'), getItemOnGroundManager: () => null });
  for (const name of ['TzhaarFightCaves', 'Inferno', 'PestControl', 'BarbarianAssault', 'Gauntlet', 'Colosseum',
    'NightmareZone', 'KnightWaves', 'ChampionsChallenge', 'TzHaarKetRak', 'ChambersOfXeric', 'TheatreOfBlood',
    'Barrows', 'SoulWars', 'TempleTrekking', 'MageArena', 'TombsOfAmascut']) {
    require(`../plugins/minigames/${name}.plugin`).register(sourceApi(name));
  }
  const dormantApi = sourceApi('DormantNpcs'), dormant = require('../plugins/npcs/DormantNpcs.plugin');
  dormant.register(dormantApi); dormant._test.start(dormantApi);
  require('../plugins/bosses/KingBlackDragon.plugin').register(sourceApi('KingBlackDragon'));
  require('../plugins/bosses/CountDraynor.plugin').register(sourceApi('CountDraynor'));
  require('../plugins/bosses/Elvarg.plugin').register(sourceApi('Elvarg'));
  for (const name of bossIds.keys()) require(`../plugins/bosses/${name}.plugin`).register(sourceApi(name));
  const superiors = require('../plugins/skills/slayer/Superiors.Slayer');
  const slayerApi = sourceApi('SlayerSuperiors'); superiors.init(slayerApi); superiors.attach(slayerApi);
  require('../plugins/skills/Farming.plugin').register(sourceApi('Farming'));
  require('../plugins/quests/Quests.plugin').register(sourceApi('Quests'));
  Examine.register(PM.createApi('MonsterExamine'));
  Bestiary.register(PM.createApi('Bestiary'));
});

function actor(t) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setUsername('bestiary-fixture'); player.setRegistered(true); player.setNeedsPlacement(false);
  const conn = new ClientConnection(channel); conn.player = player;
  const strings = new Map(), models = new Map(), hidden = new Map(), messages = [], packets = [], opens = [];
  const sender = player.getPacketSender();
  for (const [method, capture] of [['sendString', (text, id) => strings.set(id, text)],
    ['sendNpcHeadOnInterface', (id, uid) => models.set(uid, id)],
    ['sendInterfaceDisplayState', (id, value) => hidden.set(id, value)],
    ['sendMessage', text => messages.push(text)], ['sendSubInterface', (...args) => opens.push(args)]]) {
    t.mock.method(sender, method, (...args) => { capture(...args); return sender; });
  }
  t.mock.method(player.getSession(), 'sendClientPacket', bytes => { packets.push(bytes); return true; });
  t.after(() => Bestiary._test.forget({ player }));
  function request(name, values = {}) { const event = { player, ...values }; PM.emitCustomEvent(name, event); return event; }
  const displayedRowId = () => {
    const rows = Layout.DATA_COMPONENTS.flatMap(component => JSON.parse(strings.get(Layout.uid(component)) ?? '[]'))
      .filter(row => !row.expandable).map(row => ({ ...row, id: row.npc }));
    return search(rows, strings.get(Layout.uid(Layout.C.SEARCH_TEXT)))[0]?.id + 1;
  };
  const click = (component, op = 1, groupId = Layout.GROUP_ID, slot = displayedRowId()) => conn.dispatch([{ type: 'widget_action',
    widgetId: (groupId << 16) | component, groupId, childId: component, buttonNum: op, slot }], true);
  const pluginPackets = () => packets.flatMap(bytes => {
    try { const p = decodePluginMessagePayload(bytes.subarray(3)); return p.channel === 'bestiary' ? [p.data] : []; }
    catch { return []; }
  });
  return { player, conn, strings, models, hidden, messages, packets, opens, request, click, pluginPackets };
}
function staticSpawns(t, entries) {
  const old = core.NpcSpawnDefinition.all();
  core.NpcSpawnDefinition.replace(entries.map(([id, x, y, z = 0]) => new core.NpcSpawnDefinition(
    id, new core.Location(x, y, z), core.Direction.SOUTH, 0)));
  t.after(() => core.NpcSpawnDefinition.replace(old));
}

test('Bestiary excludes cache-only KBD representations without a playable encounter', () => {
  const king = core.NpcIdentifiers.KING_BLACK_DRAGON;
  assert.equal(king, 239);
  const backed = { ...core, NpcSpawnDefinition: { all: () => [{ getId: () => king }] }, World: { getNpcs: () => [] } };
  const kings = catalog(backed).filter(row => [king, 6502, 12440].includes(row.id));
  assert.deepEqual(kings.map(row => row.id), [king]);
});

test('playable evidence retains no-drop spawns and scripted fights without admitting cache-only doubles', () => {
  const records = new Map([
    [1, { name: 'No-drop monster', attackable: true }],
    [2, { name: 'No-drop monster', attackable: true }],
    [3, { name: 'Quest combat enemy', attackable: true }],
    [4, { name: 'Quest cutscene actor', attackable: false }],
    [5, { name: 'Transform enemy', attackable: true }],
    [6, { name: 'Transform parent', attackable: false, transforms: [5, 6, -1] }],
  ]);
  const fake = { CacheDefinitions: { getCounts: () => ({ npcs: 7 }), getNpc: id => records.get(id) ?? {} },
    NpcSpawnDefinition: { all: () => [1, 6].map(id => ({ getId: () => id })) },
    NpcDefinition: { forId: id => ({ isAttackable: () => records.get(id).attackable,
      getName: () => records.get(id).name, getCombatLevel: () => 10, getHitpoints: () => 20 }) } };
  assert.deepEqual(buildCatalog(fake, [3, 4]).map(row => row.id).sort(), [1, 3, 5]);
});

test('eligibility requires actual spawns or source-owned fights; exact loot, combat bindings and temporary NPCs do not qualify', t => {
  const N = core.NpcIdentifiers;
  const description = { npcId: N.KING_BLACK_DRAGON }; PM.emitCustomEvent('npc-drops:describe', description);
  const dropTables = require('../plugins/npcs/NpcDrops.plugin')._test.tablesByNpc;
  const drops = new Set([...dropTables].filter(([, tables]) => tables.some(table => (table.entries?.length ?? 0) + (table.tertiary?.length ?? 0) > 0)).map(([id]) => id));
  const f = actor(t), world = [...core.World.getNpcs()], saves = JSON.stringify(PlayerSave.fromPlayer(f.player));
  t.mock.method(Math, 'random', () => { throw new Error('Describing encounters must not roll'); });
  assert.ok(drops.has(N.KING_BLACK_DRAGON), 'the ordinary KBD also has an exact nonempty death-loot mapping');
  assert.ok(!drops.has(6502) && !drops.has(12440), 'similar names and combat providers do not synthesize a loot mapping');
  const eligible = new Set(catalog(core).map(row => row.id));
  const lootOnly = [...drops].find(id => !eligible.has(id) && core.NpcDefinition.forId(id).isAttackable() && core.NpcDefinition.forId(id).getCombatLevel() > 0);
  assert.ok(Number.isInteger(lootOnly), 'the active cache includes loot-mapped entries without a real available encounter');
  assert.ok(!encounterIds(PM.createApi('Bestiary')).has(lootOnly), 'a loot table alone does not declare a playable encounter');
  const expectations = new Map([
    ['TzhaarFightCaves', N.KET_ZEK], ['Inferno', N.JAL_AKREK_MEJ], ['PestControl', N.BRAWLER],
    ['BarbarianAssault', core.NpcIdentifiers.QUEEN_SPAWN], ['Gauntlet', 9026], ['Colosseum', N.SOL_HEREDIT],
    ['NightmareZone', core.CacheDefinitions.getNpcId('nzone_elvarg_hard')], ['KnightWaves', 4361],
    ['ChampionsChallenge', N.GOBLIN_CHAMPION], ['TzHaarKetRak', core.CacheDefinitions.getNpcId('jad_challenge_jad')],
    ['ChambersOfXeric', 7568], ['TheatreOfBlood', 10865], ['CountDraynor', N.COUNT_DRAYNOR], ['Elvarg', 816],
    ['TombsOfAmascut', N.AKKHA_2], ['DormantNpcs', N.ROCK_CRAB], ['MageArena', N.KOLODION_3], ['Barrows', N.AHRIM_THE_BLIGHTED], ['SoulWars', 10531], ['TempleTrekking', 5625], ['Quests', N.TREE_SPIRIT],
  ]);
  for (const [source, id] of expectations) {
    assert.ok(Number.isInteger(id), `${source} resolves its cache identity`);
    assert.ok(sourceIds(source).has(id), `${source} declares its actual fight table, independently of drops`);
  }
  const questIds = sourceIds('Quests');
  for (const id of [N.ANCIENT_GUARDIAN, N.BLACK_DEMON_2, N.GOLEM_GUARD, N.THE_INADEQUACY]) {
    assert.ok(questIds.has(id), `quest opponent ${id} remains discoverable`);
  }
  assert.ok(!questIds.has(817), "Elvarg's introductory scene copy is not declared as a fight");
  assert.ok(!sourceIds('CountDraynor').has(N.COUNT_DRAYNOR_2), 'the coffin-rising actor is not the combat Count');
  const temporary = new core.NPC(6502, new core.Location(3200, 3200)); temporary.setRegistered(true);
  t.mock.method(core.World, 'getNpcs', () => [...world, temporary]);
  assert.ok(!catalog(core).some(row => row.id === temporary.getId()), 'an admin-spawned unused variant cannot promote itself');
  assert.equal(JSON.stringify(PlayerSave.fromPlayer(f.player)), saves);
  assert.equal(world.length, [...core.World.getNpcs()].length - 1);
  const declared = new Set();
  for (const source of encounterProviders.keys()) {
    if (source === 'NpcDrops') continue;
    for (const id of sourceIds(source)) {
      assert.ok(Number.isInteger(id) && id >= 0 && id < core.CacheDefinitions.getCounts().npcs,
        `${source} declares a valid native NPC identity: ${id}`);
      declared.add(id);
    }
  }
  let cacheAttackable = 0;
  for (let id = 0; id < core.CacheDefinitions.getCounts().npcs; id++) {
    const def = core.NpcDefinition.forId(id);
    if (def.isAttackable() && def.getCombatLevel() > 0) cacheAttackable++;
  }
  t.diagnostic(JSON.stringify({ cacheAttackable, catalogue: catalog(core).length,
    staticSpawnIds: new Set(core.NpcSpawnDefinition.all().map(spawn => spawn.getId())).size,
    exactNonemptyLootIds: drops.size, sourceDeclaredIds: declared.size }));
});

test('scripted bosses are discoverable from their owning fight plugins without static spawns', () => {
  const rows = new Map(buildCatalog({ ...core, NpcSpawnDefinition: { all: () => [] } },
    encounterIds(PM.createApi('Bestiary'))).map(row => [row.id, row]));
  for (const [name, ids] of [...bossIds, ['Farming', [core.NpcIdentifiers.HESPORI]],
    ['SlayerSuperiors', [7388, 7393, 7405, 7409]]]) {
    const provided = sourceIds(name);
    for (const id of ids) {
      assert.ok(provided.has(id), `${name} declares combat form ${id}`);
      assert.ok(rows.has(id), `${name} combat form ${id} can be browsed`);
    }
  }
});

test('provider combatants with no fixed combat level can be browsed', () => {
  const rows = new Map(catalog(core).map(row => [row.id, row]));
  for (const source of ['ChambersOfXeric', 'PestControl', 'TombsOfAmascut', 'MageArena']) {
    const combatants = [...sourceIds(source)].filter(id => {
      const definition = core.NpcDefinition.forId(id);
      return definition.isAttackable() && definition.getCombatLevel() === 0;
    });
    assert.ok(combatants.length > 0, `${source} has attackable combatants without a fixed cache level`);
    for (const id of combatants) {
      assert.equal(rows.get(id)?.level, 0, `${source} combat form ${id} can be browsed with a zero cache level`);
    }
  }
});

test('native Attack checks tolerate null actions and default stats never establish catalogue eligibility', () => {
  const spawnIds = [1, 2, 3, 4], records = new Map();
  const definition = (name, level, actions) => Object.assign(new core.NpcDefinition(), { name, combatLevel: level, actions });
  records.set(1, definition('Scene actor', 276, [null, undefined, 'Talk-to']));
  records.set(2, definition('Default-level actor', 0, [null, 'Attack']));
  records.set(3, definition('Genuine no-drop monster', 1, [null, 'Attack']));
  records.set(4, definition('Unused attackable copy', 276, ['Attack']));
  const fake = { CacheDefinitions: { getCounts: () => ({ npcs: 5 }), getNpc: () => ({ transforms: [-1, 99999] }) },
    NpcSpawnDefinition: { all: () => spawnIds.slice(0, 3).map(id => ({ getId: () => id })) },
    NpcDefinition: { forId: id => records.get(id) } };
  assert.deepEqual(buildCatalog(fake).map(row => row.id), [3]);
  assert.deepEqual(buildCatalog(fake, [1, 2]).map(row => row.id).sort(), [2, 3],
    'a declaration admits attackable level-zero definitions and still excludes non-combat actors');
  assert.equal(records.get(3).getHitpoints(), 10, 'default HP does not disqualify a genuinely sourced fight');
});

test('native Bestiary sends bounded metadata once; explicit card buttons examine the row ID rather than a reused slot', async t => {
  const f = actor(t), all = catalog(core);
  assert.ok(PM.getRegisteredCommands(f.player).some(row => row.command === 'bestiary'));
  f.request('bestiary:open');
  assert.equal(f.player.getInterfaceId(), Layout.GROUP_ID);
  const entries = Layout.DATA_COMPONENTS.flatMap(c => JSON.parse(f.strings.get(Layout.uid(c))));
  assert.equal(entries.filter(row => !row.expandable).length, all.length);
  assert.equal(new Set(entries.map(row => row.id)).size, entries.length, 'group and native row IDs never collide');
  const goblins = all.filter(row => row.name === 'Goblin');
  const group = entries.find(row => row.name === 'Goblin' && row.expandable);
  assert.ok(group.collapsed && goblins.length > 12);
  const members = entries.filter(row => row.parentId === group.id);
  const level = all.find(row => row.id === group.npc).level;
  assert.equal(members.length, goblins.filter(row => row.level === level).length);
  assert.ok(members.every(row => all.find(npc => npc.id === row.npc).level === level));
  assert.ok(entries.filter(row => row.name === 'Goblin' && !row.parentId).length > 1);
  assert.equal(entries[0].npc, all[0].id);
  assert.equal(f.models.size, 0, 'the server never loads a full catalogue of models into widgets');
  assert.ok(Layout.DATA_COMPONENTS.every(c => Buffer.byteLength(f.strings.get(Layout.uid(c)), 'latin1') < 40000));
  const target = all[all.length - 1];
  const saved = JSON.stringify(PlayerSave.fromPlayer(f.player));
  t.mock.method(Math, 'random', () => { throw new Error('Browsing must not roll'); });
  await f.click(Layout.C.EXAMINE_TEXT, 1, Layout.GROUP_ID, target.id + 1);
  assert.equal(f.player.getInterfaceId(), Examine._test.Layout.GROUP_ID);
  assert.equal(f.models.get(Examine._test.Layout.uid(Examine._test.Layout.C.MODEL)), target.id);
  await f.click(Examine._test.Layout.C.BACK, 1, Examine._test.Layout.GROUP_ID);
  assert.equal(f.player.getInterfaceId(), Layout.GROUP_ID);
  assert.equal(JSON.stringify(PlayerSave.fromPlayer(f.player)), saved);
  await f.click(Layout.C.EXAMINE, 1, Layout.GROUP_ID, 65534);
  assert.equal(f.player.getInterfaceId(), Layout.GROUP_ID, 'forged non-catalogue IDs do not open anything');
});

test('only creatures with the same exact name and combat level share a variant card', () => {
  const rows = [{ id: 1, name: 'Goblin', level: 5, hp: 8 }, { id: 2, name: 'Goblin', level: 5, hp: 10 },
    { id: 3, name: 'Goblin', level: 30, hp: 35 }, { id: 4, name: 'goblin', level: 5, hp: 8 }];
  const entries = groupedEntries(rows, () => -1);
  const group = entries.find(row => row.expandable);
  assert.equal(entries.filter(row => row.expandable).length, 1);
  assert.deepEqual(entries.filter(row => row.parentId === group.id).map(row => row.npc), [1, 2]);
  assert.equal(entries.find(row => row.npc === 3).parentId, undefined);
  assert.equal(group.detail, '5');
  assert.equal(group.panel.stats, '2 Variants');
  assert.equal(entries.find(row => row.npc === 3).panel.stats, 'NPC ID 3');
  assert.ok(entries.every(row => !Object.values(row.panel).some(text => /\bHP\b/.test(text))));
});

test('Find variants combines only that level, deduplicates spawns and cycles the native map overlay', async t => {
  const f = actor(t), all = catalog(core);
  f.request('bestiary:open');
  const entries = Layout.DATA_COMPONENTS.flatMap(c => JSON.parse(f.strings.get(Layout.uid(c))));
  const group = entries.find(row => row.expandable && row.name === 'Goblin');
  const members = entries.filter(row => row.parentId === group.id).map(row => row.npc);
  assert.ok(members.length > 1);
  const other = all.find(row => row.name === 'Goblin' && !members.includes(row.id));
  staticSpawns(t, [[members[0], 3201, 3201], [members[1], 3201, 3201], [members[1], 2269, 4697], [other.id, 3100, 3100]]);
  t.mock.method(core.World, 'getNpcs', () => []);
  await f.conn.dispatch([{ type: 'plugin_message', channel: 'bestiary', data: { type: 'client-state', enabled: true } }], true);
  await f.click(Layout.C.FIND_TEXT, 2, Layout.GROUP_ID, group.id);
  const found = f.pluginPackets().at(-1), N = Bestiary._test.Navigation;
  assert.equal(found.type, 'find'); assert.equal(found.points.length, 2);
  assert.ok(!found.points.some(point => point.x === 3100), 'a different combat level is excluded');
  assert.equal(found.focusIndex, 0);
  assert.ok(f.opens.some(([host, groupId]) => host === N.HOST_UID && groupId === N.GROUP_ID));
  assert.match(f.strings.get(N.uid(N.C.STATUS)), /Location 1 of 2/);
  t.mock.method(f.player.getPacketSender(), 'isWorldMapOpen', () => true);
  t.mock.method(f.player.getPacketSender(), 'isSubInterfaceOpen', () => true);
  await f.click(N.C.NEXT_TEXT, 1, N.GROUP_ID, -1);
  assert.equal(f.pluginPackets().at(-1).focusIndex, 1);
  assert.match(f.strings.get(N.uid(N.C.STATUS)), /Location 2 of 2/);
  await f.click(N.C.NEXT, 1, N.GROUP_ID, -1);
  assert.equal(f.pluginPackets().at(-1).focusIndex, 0, 'Next wraps around');
  await f.click(N.C.PREVIOUS, 1, N.GROUP_ID, -1);
  assert.equal(f.pluginPackets().at(-1).focusIndex, 1, 'Previous wraps around');
  await f.click(N.C.CLEAR_TEXT, 1, N.GROUP_ID, -1);
  assert.equal(f.pluginPackets().at(-1).type, 'clear');
  const count = f.pluginPackets().length;
  await f.click(N.C.NEXT, 1, N.GROUP_ID, -1);
  assert.equal(f.pluginPackets().at(-1).type, 'clear');
  assert.equal(f.pluginPackets().length, count + 1, 'stale navigation never resurrects cleared pins');
});

test('Bestiary search is a native inline input backed by canonical names and exact NPC IDs', t => {
  const f = actor(t), L = Layout.DEFINITION;
  assert.equal(L.search.inputComponent, Layout.C.SEARCH_TEXT);
  assert.equal(L.search.exactNumericTerms, true);
  assert.equal(L.preserveState, true);
  assert.ok(L.list.rowActions.some(action => action.start === Layout.C.FIND_TEXT));
  assert.ok(L.list.rowActions.some(action => action.start === Layout.C.EXAMINE_TEXT));
  assert.equal(L.widgets.find(w => w.uid === Layout.uid(Layout.C.ROOT)).heightMode, 1);
  f.request('bestiary:open', { query: 'goblin' });
  assert.equal(f.strings.get(Layout.uid(Layout.C.SEARCH_TEXT)), 'goblin');
  f.request('bestiary:open', { query: String(core.NpcIdentifiers.HOBGOBLIN_3) });
  assert.equal(f.strings.get(Layout.uid(Layout.C.SEARCH_TEXT)), String(core.NpcIdentifiers.HOBGOBLIN_3));
});

test('spawn reads deduplicate canonical static/live homes, distinguish IDs, hide private instances and bound packets', t => {
  const f = actor(t), id = core.NpcIdentifiers.HOBGOBLIN_3;
  staticSpawns(t, [[id, 3201, 3200], [id, 3201, 3200], [id + 1, 3202, 3200],
    ...Array.from({ length: MAX_PINS + 10 }, (_, i) => [id, 3300 + i, 3300])]);
  const here = f.player.getLocation();
  const live = new core.NPC(id, new core.Location(3210, 3210)); live.setRegistered(true);
  const privateNpc = new core.NPC(id, new core.Location(3211, 3211)); privateNpc.setRegistered(true); privateNpc.setOwner(f.player);
  t.mock.method(core.World, 'getNpcs', () => [live, privateNpc]);
  const before = JSON.stringify(core.NpcSpawnDefinition.all());
  const found = knownSpawns(core, f.player, id);
  assert.equal(found.points.length, MAX_PINS);
  assert.equal(found.limited, true);
  assert.equal(new Set(found.points.map(p => `${p.x}:${p.y}:${p.plane}`)).size, found.points.length);
  assert.ok(found.points.some(p => p.x === 3210));
  assert.ok(!found.points.some(p => p.x === 3211 || p.x === 3202));
  assert.equal(JSON.stringify(core.NpcSpawnDefinition.all()), before);
  assert.deepEqual(f.player.getLocation(), here);
});

test('authenticated Find replaces/clears pins, unknown spawns clear old pins, and client disable is graceful', async t => {
  const f = actor(t), id = core.NpcIdentifiers.HOBGOBLIN_3;
  staticSpawns(t, [[id, 3201, 3200], [id, 3208, 3202], [id + 1, 3209, 3203]]);
  f.request('bestiary:open', { query: String(id) });
  let now = Date.now(); t.mock.method(Date, 'now', () => now);
  await f.click(Layout.C.MODEL, 2);
  assert.match(f.messages.at(-1), /Enable Monster Examine/);
  await f.conn.dispatch([{ type: 'plugin_message', channel: 'bestiary', data: { type: 'client-state', enabled: true } }], true);
  now += 201;
  await f.click(Layout.C.FIND_TEXT, 2);
  const selected = f.pluginPackets().at(-1);
  assert.equal(selected.type, 'find'); assert.equal(selected.npcId, id); assert.equal(selected.points.length, 2);
  assert.ok(f.opens.some(([, group]) => group === WORLD_MAP_GROUP_ID), 'Find opens the native map with its pins');
  const openedMaps = f.opens.filter(([, group]) => group === WORLD_MAP_GROUP_ID).length;
  t.mock.method(f.player.getPacketSender(), 'isWorldMapOpen', () => true);
  now += 201; await f.click(Layout.C.FIND_TEXT, 2);
  assert.equal(f.opens.filter(([, group]) => group === WORLD_MAP_GROUP_ID).length, openedMaps, 'Find leaves an already open map open');
  assert.ok(f.packets.every(p => p.length < 16384));
  f.request('bestiary:open');
  assert.equal(f.player.getInterfaceId(), Layout.GROUP_ID);
  now += Bestiary._test.PIN_LIFETIME_MS + 1;
  f.request('bestiary:open');
  assert.equal(f.player.getInterfaceId(), Layout.GROUP_ID);
  now += 201; await f.click(Layout.C.CARD, 2);
  f.request('bestiary:view', { npcId: id + 1 });
  assert.equal(f.pluginPackets().at(-1).type, 'clear');
  now += 201; core.NpcSpawnDefinition.replace([]);
  await f.click(Layout.C.CARD, 2, Layout.GROUP_ID, id + 1);
  assert.equal(f.pluginPackets().at(-1).type, 'clear');
  assert.match(f.messages.at(-1), /No known spawn/);
  await f.click(Layout.C.CLEAR);
  assert.equal(f.pluginPackets().at(-1).type, 'clear');
  await f.conn.dispatch([{ type: 'plugin_message', channel: 'bestiary', data: { type: 'client-state', enabled: false } }], true);
  now += 201; await f.click(Layout.C.CARD, 2);
  assert.match(f.messages.at(-1), /Enable Monster Examine/);
});

test('canonical transform parents locate only the resolved variant, not every same-name form', t => {
  const f = actor(t), parent = 900, a = 901, b = 902;
  const source = { getId: () => parent, getPosition: () => new core.Location(3000, 3100, 0) };
  const fake = { NpcSpawnDefinition: { all: () => [source] }, World: { getNpcs: () => [] },
    CacheDefinitions: { getNpc: () => ({ transforms: [a, b] }), resolveNpc: () => ({ id: a }) } };
  assert.deepEqual(knownSpawns(fake, f.player, a).points, [{ x: 3000, y: 3100, plane: 0 }]);
  assert.deepEqual(knownSpawns(fake, f.player, b).points, []);
  assert.deepEqual(knownSpawns(fake, f.player, parent).points, []);
});

test('either disabled companion keeps the other native interface usable', async t => {
  const f = actor(t), original = PM.emitCustomEvent.bind(PM);
  let disabled = 'MonsterExamine';
  t.mock.method(PM, 'emitCustomEvent', (name, event) => {
    if (disabled === 'MonsterExamine' && name.startsWith('monster-examine:')) return;
    if (disabled === 'Bestiary' && name.startsWith('bestiary:')) return;
    return original(name, event);
  });
  f.request('bestiary:open', { query: String(core.NpcIdentifiers.HOBGOBLIN_3) });
  assert.equal(f.player.getInterfaceId(), Layout.GROUP_ID);
  await f.click(Layout.C.MODEL);
  assert.match(f.messages.at(-1), /Monster Examine is disabled/);
  disabled = 'Bestiary';
  f.request('monster-examine:open-definition', { npcId: core.NpcIdentifiers.HOBGOBLIN_3, fromGroupId: Layout.GROUP_ID });
  assert.equal(f.player.getInterfaceId(), Examine._test.Layout.GROUP_ID);
  await f.click(Examine._test.Layout.C.BACK, 1, Examine._test.Layout.GROUP_ID);
  assert.match(f.messages.at(-1), /Bestiary is disabled/);
  assert.equal(f.player.getInterfaceId(), Examine._test.Layout.GROUP_ID);
});

test('a Bestiary card opens the effective drop description without death hooks, RNG or save changes', async t => {
  const f = actor(t), loaded = require('../plugins/npcs/NpcDrops.plugin')._test.tablesByNpc;
  const guard = catalog(core).find(row => row.name === 'Guard' && loaded.has(row.id));
  assert.ok(guard, 'the cache and loaded drop source share a Guard definition');
  const id = guard.id;
  staticSpawns(t, [[id, 3200, 3200]]);
  f.request('bestiary:open', { query: String(id) });
  const saved = JSON.stringify(PlayerSave.fromPlayer(f.player));
  const original = PM.emitCustomEvent.bind(PM), names = [];
  t.mock.method(PM, 'emitCustomEvent', (name, event) => { names.push(name); return original(name, event); });
  t.mock.method(Math, 'random', () => { throw new Error('No death/RNG path during browsing'); });
  await f.click(Layout.C.MODEL);
  const L = Examine._test.Layout;
  const drops = L.DATA_COMPONENTS.flatMap(c => JSON.parse(f.strings.get(L.uid(c))));
  assert.ok(drops.some(row => Number.isInteger(row.icon) && row.icon >= 0), 'the actual drop loader supplies item rows');
  assert.ok(names.includes('npc-drops:describe'));
  assert.ok(!names.some(name => /npc-drops:(roll|generated|add|place)|combat:/.test(name)));
  assert.equal(JSON.stringify(PlayerSave.fromPlayer(f.player)), saved);
});

test('real native formulas use worn bonuses, boosted levels, prayer, correct defence styles and ignore armed specials', t => {
  const f = actor(t), p = f.player, npc = new core.NPC(core.NpcIdentifiers.HOBGOBLIN_3, p.getLocation().clone());
  p.getSkillManager().setCurrentLevels(core.Skill.ATTACK, 75, false);
  p.getSkillManager().setCurrentLevels(core.Skill.RANGED, 80, false);
  p.getSkillManager().setCurrentLevels(core.Skill.MAGIC, 85, false);
  const attack = p.getBonusManager().getAttackBonus();
  attack[0] = 11; attack[1] = 40; attack[2] = 7; attack[3] = 25; attack[4] = 60;
  p.setFightType(core.FightType.UNARMED_PUNCH);
  p.setPrayerActive(core.PrayerHandler.PIETY, true);
  const native = core.AccuracyFormulasDpsCalc, chance = native.hitChance.bind(native);
  const result = baseAccuracy(core, p, npc);
  assert.equal(result[0].meleeStyle, 'crush');
  assert.equal(result[0].chance, chance(Math.floor(75 * 1.2 + 3 + 8) * (7 + 64), native.defenseMeleeRoll(npc, 2)));
  assert.equal(result[1].chance, chance((80 + 8) * (60 + 64), native.defenseRangedRoll(npc, 'standard')));
  assert.equal(result[2].chance, chance((85 + 9) * (25 + 64), native.defenseMagicRoll(npc)));
  const before = p.getFightType();
  p.setSpecialActivated(true);
  p.setCombatSpecial({ getTraits: () => ({ rollAttackType: 'magic', accuracyMultiplier: 5 }) });
  assert.deepEqual(baseAccuracy(core, p, npc), result, 'an armed special cannot turn every base chance into Magic');
  assert.equal(p.isSpecialActivated(), true); assert.equal(p.getFightType(), before);
  const ranged = core.FightType.values().find(f => f.getBonusType() === core.BonusManager.ATTACK_RANGE && f.getStyle() === core.FightStyle.ACCURATE);
  p.setFightType(ranged);
  const other = baseAccuracy(core, p, npc);
  assert.equal(other[0].meleeStyle, 'slash');
  assert.equal(other[0].chance, chance(Math.floor(75 * 1.2 + 8) * (40 + 64), native.defenseMeleeRoll(npc, 1)));
  assert.equal(other[1].chance, chance((80 + 3 + 8) * (60 + 64), native.defenseRangedRoll(npc, 'standard')));
  attack[3] = -100;
  assert.equal(baseAccuracy(core, p, npc)[2].chance, 0, 'native negative dice bounds clamp to zero for heavy armour');
});

test('browse/find leave generated definitions byte-for-byte unchanged', t => {
  const files = ['npc_spawns.json', 'npc-drops.json', 'monsters-complete.json'].map(name => path.join(__dirname, '../data/definitions', name)).filter(fs.existsSync);
  const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const before = files.map(digest);
  const f = actor(t); f.request('bestiary:open', { query: 'goblin' });
  knownSpawns(core, f.player, core.NpcIdentifiers.HOBGOBLIN_3);
  assert.deepEqual(files.map(digest), before);
  f.player.setInterfaceId(12);
  assert.equal(f.request('bestiary:open').handled, undefined, 'bank and protected interfaces stay open');
  assert.equal(f.player.getInterfaceId(), 12);
});


test('ordinary world areas do not break native Find or Examine actions', async t => {
  const f = actor(t), id = core.NpcIdentifiers.HOBGOBLIN_3;
  staticSpawns(t, []);
  const npc = new core.NPC(id, new core.Location(3210, 3210));
  npc.setRegistered(true); npc.setArea(new core.Area());
  t.mock.method(core.World, 'getNpcs', () => [npc]);
  f.request('bestiary:open', { query: String(id) });
  await f.conn.dispatch([{ type: 'plugin_message', channel: 'bestiary', data: { type: 'client-state', enabled: true } }], true);
  await f.click(Layout.C.FIND_TEXT, 2, Layout.GROUP_ID, id + 1);
  assert.equal(f.pluginPackets().at(-1)?.type, 'find', 'the live world area cannot abort spawn lookup');
  assert.equal(f.pluginPackets().at(-1)?.points[0]?.x, 3210);
  await f.click(Layout.C.EXAMINE_TEXT, 1, Layout.GROUP_ID, id + 1);
  assert.equal(f.player.getInterfaceId(), Examine._test.Layout.GROUP_ID);
});
