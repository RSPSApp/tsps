// From server/: node --test tests/eagles-peak-eagle.test.cjs (after yarn build).
//
// The giant eagle's Walk-past without the disguise, against rsprox 2821 (rev 230): the stumble back
// two tiles, the eagle's attack, a 0 hit and the recorded message box a tick later.
process.env.DISABLE_PLAYER_BOTS = '1';
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');

const SWIPE = "As you approach the eagle it takes a swipe at you with its beak. It seems to object to you trying to get past.";
let core, walkPast, tasks;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PluginManager.getCoreApi();
  const api = PluginManager.createApi('EaglesPeakEagleTest');
  const proxy = new Proxy(api, {
    get(target, property) {
      if (property === 'core') return { ...core, TaskManager: { submit: (task) => tasks.push(task) } };
      if (property === 'onNpcInteraction') {
        return (name, handlers) => { if (name === 'Eagle') walkPast = handlers['Walk-past']; };
      }
      if (typeof property === 'string' && /^on[A-Z]/.test(property)) return () => {};
      const value = target[property];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  require('../plugins/quests/quests/EaglesPeak.Quest')(proxy);
});

function fakePlayer() {
  const tile = new core.Location(2007, 4952, 3);
  const player = {
    anims: [], sounds: [], hits: [], dialogues: [], forced: null,
    getLocation: () => tile,
    getEquipment: () => ({ get: () => null, getItems: () => [], contains: () => false, containsAny: () => false, getById: () => null }),
    performAnimation: (a) => player.anims.push(a),
    getPacketSender: () => ({ sendSound: (id, volume, delay) => player.sounds.push([id, delay]) }),
    getCombat: () => ({ reset: () => {}, getHitQueue: () => ({ addPendingDamage: (hits) => player.hits.push(...hits.map((h) => h.getDamage())) }) }),
    getMovementQueue: () => ({ reset: () => {} }),
    setForceMovement: (f) => { player.forced = f; },
    getForceMovement: () => player.forced,
    getDialogueManager: () => ({ startDialogues: (chain) => player.dialogues.push(chain) }),
    getAttribute: () => undefined,
    sendMessage: () => {},
  };
  return player;
}

test('walking past the eagle without the disguise plays the recorded swipe', () => {
  tasks = [];
  const player = fakePlayer();
  const eagleAnims = [];
  const npc = { getId: () => 1490, performAnimation: (a) => eagleAnims.push(a.getId()) };
  const event = { player, npc, npcId: 1490 };
  assert.equal(walkPast(event), true);

  const { CacheDefinitions } = core;
  assert.deepEqual(eagleAnims, [CacheDefinitions.getSeqId('giant_eagle_attack')]);
  assert.equal(player.anims[0].getId(), CacheDefinitions.getSeqId('human_priority_stumble_back'));
  assert.equal(player.anims[0].getDelay(), 24);
  assert.equal(player.forced.getSpeed(), 0);
  const forced = player.forced;
  assert.equal(forced.getEnd().getX(), 0);
  assert.equal(forced.getEnd().getY(), -2, 'two tiles back, away from the eagle');
  assert.equal(forced.getReverseSpeed(), 46);
  assert.equal(forced.getDirection(), 0, 'facing north, at the eagle');
  assert.deepEqual(player.sounds, [[421, 0], [2455, 5]]);
  assert.equal(player.hits.length, 0, 'nothing lands on the first tick');
  assert.equal(player.dialogues.length, 0);

  const later = tasks.filter((t) => !(t instanceof core.ForceMovementTask));
  for (const task of later) task.execute();
  assert.deepEqual(player.hits, [0], 'the recorded hit is a 0');
  assert.deepEqual(player.sounds.at(-1), [511, 20]);
  assert.equal(player.dialogues.length, 1);
  const text = [...player.dialogues[0].dialogues.values()][0].text;
  assert.equal(text, SWIPE, "the recorded message box");
});

test('the swipe still plays when the eagle npc is missing from the event', () => {
  tasks = [];
  const player = fakePlayer();
  assert.equal(walkPast({ player, npc: undefined, npcId: 1490 }), true);
  for (const task of tasks.filter((t) => !(t instanceof core.ForceMovementTask))) task.execute();
  assert.deepEqual(player.hits, [0]);
  assert.equal(player.dialogues.length, 1);
});

// #6596: supplied quest checkpoints, ordinary native NPC/menu input and real cave collision.
// No rendered-client or complete quest playthrough claim.
test('Shout-to reaches Nickolaus across the actual cave ledge', async (t) => {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const { ClientConnection } = require('../dist/net/NetworkBuilder');
  const { decodeClientPackets } = require('../dist/net/protocol/ClientProtocol');
  const worldConfig = require('../dist/game/definition/WorldDefinition'), readConfig = worldConfig.readWorldConfig;
  const config = t.mock.method(worldConfig, 'readWorldConfig', (...args) => {
    const actual = readConfig(...args);
    return { ...actual, plugins: { ...actual.plugins, WorldAdmin: false, AgentMcp: false, OfflineQuestHelper: false, CacheEditorAuthoring: false } };
  });
  PluginManager.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  PluginManager.emitServerStartup({});
  t.after(() => PluginManager.emitServerShutdown({}));
  config.mock.restore();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(2016, 4947);
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel), player = new Player(session), connection = new ClientConnection(channel);
  session.setPlayer(player); connection.player = player;
  session.setTurnPacketProcessor(() => connection.processTurnPackets());
  player.setUsername('eagleshout'); player.setAttribute('bot-skip-persistence', true);
  core.World.getPlayers().add(player);
  player.setAttribute('quest.eagles_peak.stage', 3);
  player.moveTo(new core.Location(1998, 4955, 3));
  const messages = [], lines = [], errors = [];
  t.mock.method(console, 'error', (...args) => errors.push(args.map(String).join(' ')));
  PluginManager.createApi('EaglesShoutObservation').onCustomEvent('npc-dialogue:line', event => {
    if (event.player === player) lines.push(event.text);
  });
  t.mock.method(player.getPacketSender(), 'sendMessage', (text) => { messages.push(text); return player.getPacketSender(); });
  t.after(() => {
    PluginManager.emitPlayerLogout({ player, username: player.getUsername() });
    player.closeInterruptibleInterfaces(); player.getMovementQueue().reset(); player.getMovementQueue().walkToReset();
    core.TaskManager.cancelTasks(player); core.TaskManager.cancelTasks(player.getIndex());
    core.World.getPlayers().remove(player);
  });
  const tick = () => core.World.process();
  for (let i = 0; i < 4; i++) tick();
  PluginManager.emitPlayerLogin({ player, username: player.getUsername() });
  const npc = [...core.World.getNpcs()].find(n => n?.getId() === 1484 && n.getOwner() === player);
  assert.ok(npc, 'quest produces its owned chasm Nickolaus');
  assert.deepEqual([npc.getLocation().getX(), npc.getLocation().getY(), npc.getLocation().getZ()], [2006, 4959, 3]);
  assert.equal(npc.getCurrentDefinition(player).getActions()[0], 'Shout-to');
  assert.equal(core.RegionManager.blocked(player.getLocation(), null), false, 'the west ledge is a real walkable tile');
  assert.equal(core.PathFinder.reachedEntity(player, npc), false, 'the chasm target is not melee-reachable');
  const quest = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(q => q.key === 'eagles_peak');
  const xyz = () => [player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()];
  const input = async packet => { await connection.dispatch([packet]); for (let i = 0; i < 4; i++) tick(); };
  const options = () => core.MultiChatboxPrompt.getPending(player)?.options ?? [];
  const advance = async () => {
    const group = player.getPacketSender().getChatboxGroupId(), child = { 193: 0, 229: 4, 217: 5, 231: 5 }[group];
    assert.ok(Number.isInteger(child), `known Continue group ${group}`);
    await input({ type: 'dialogue_continue', widgetId: (group << 16) | child, childIndex: group === 193 ? 0 : -1 });
  };
  const choose = async label => {
    for (let i = 0; i < 30 && !options().length; i++) { assert.ok(player.getDialogueManager().isActive()); await advance(); }
    const index = options().indexOf(label); assert.ok(index >= 0, `${label} in ${JSON.stringify(options())}`);
    await input({ type: 'dialogue_continue', widgetId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: index + 1 });
  };
  const shout = async (target = npc) => {
    player.closeInterruptibleInterfaces(); lines.length = 0;
    const index = target.getIndex();
    const packets = decodeClientPackets(Buffer.from([76, 0, index >>> 8, (index + 128) & 255]));
    assert.deepEqual(packets, [{ type: 'npc_option', index, clickType: 1 }]);
    await connection.dispatch(packets);
    for (let i = 0; i < 30 && !player.getDialogueManager().isActive(); i++) tick();
  };
  const drain = async () => {
    for (let i = 0; i < 40 && player.getDialogueManager().isActive(); i++) { assert.equal(options().length, 0); await advance(); }
    assert.equal(player.getDialogueManager().isActive(), false);
  };
  await t.test('the owned Shout-to opens the introduction and its ordinary choices advance the quest', async () => {
    await shout();
    assert.ok(player.getDialogueManager().isActive(), 'native Shout-to opens the existing quest conversation: ' + JSON.stringify(messages));
    assert.deepEqual(xyz(), [1998, 4955, 3], 'shouting stays on the entrance ledge');
    await choose('The Ardougne zookeeper sent me to find you.');
    await choose("So it's not that you're trapped then?");
    await choose('Could I help at all?');
    await drain();
    assert.equal(quest.getStage(player), 4, 'the existing help choice requests a disguise');
    assert.equal(messages.includes("I can't reach that!"), false);
  });
  await t.test('the canonical cache parent at its existing spawn resolves to the same Shout-to actor', async () => {
    const spawn = require('../data/definitions/npc-spawns.json').find(row => row.id === 2023);
    assert.deepEqual([spawn.x, spawn.y, spawn.level], [2006, 4959, 3]);
    quest.setStage(player, 3);
    const { NpcSpawnDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcSpawnDefinitionLoader');
    const definition = new NpcSpawnDefinitionLoader().toDefinition(spawn, 'canonical-test');
    assert.equal(definition.getRadius(), 5, 'the unmodified spawn loader defaults to five-tile wandering');
    const canonical = PluginManager.spawnNpc({ id: spawn.id, x: spawn.x, y: spawn.y, z: spawn.level, wanderRadius: definition.getRadius() });
    try {
      assert.equal(player.getPacketSender().getVarbit(2780), 15, 'the native shout phase is 15');
      assert.equal(canonical.getContentId(player), 1484);
      assert.equal(canonical.getCurrentDefinition(player).getActions()[0], 'Shout-to');
      assert.deepEqual(xyz(), [1998, 4955, 3], 'player starts the wander observation on the ledge');
      player.closeInterruptibleInterfaces();
      const visited = new Set();
      let seed = 6596;
      const random = t.mock.method(Math, 'random', () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; });
      try { for (let i = 0; i < 300; i++) { tick(); visited.add(`${canonical.getLocation().getX()},${canonical.getLocation().getY()}`); } } finally { random.mock.restore(); }
      assert.ok(visited.size > 1, 'real World ticks move the canonical NPC');
      t.diagnostic(JSON.stringify({player: xyz(), visited: [...visited], final: [canonical.getLocation().getX(), canonical.getLocation().getY()]}));
      await shout(canonical);
      assert.ok(player.getDialogueManager().isActive(), 'a naturally wandered canonical actor can be shouted to: ' + JSON.stringify(messages));
      assert.match(lines.join(' '), /Hello/);
      canonical.setScriptedMovement(true);
      // The eastern tile also occurred in the original 300-tick review reproduction.
      for (const position of new Set([...visited, '2009,4957'])) {
        player.closeInterruptibleInterfaces(); player.moveTo(new core.Location(1998, 4955, 3));
        canonical.getMovementQueue().reset(); canonical.setLocation(new core.Location(...position.split(',').map(Number), 3));
        for (let i = 0; i < 4; i++) tick();
        await shout(canonical);
        assert.ok(player.getDialogueManager().isActive(), `native shout reaches observed wander tile ${position}: ${JSON.stringify({player: xyz(), messages})}`);
      }
    } finally { PluginManager.removeNpc(canonical); player.closeInterruptibleInterfaces(); }
  });
  await t.test('a farther visible click still walks along the entrance passage into shout reach', async () => {
    player.closeInterruptibleInterfaces();
    player.moveTo(new core.Location(1994, 4960, 3));
    for (let i = 0; i < 4; i++) tick();
    assert.equal(core.RegionManager.blocked(player.getLocation(), null), false);
    assert.ok(player.getLocation().getDistance(npc.getLocation()) > 8, 'the initial tile is outside the stationary shout reach');
    await shout();
    assert.ok(player.getDialogueManager().isActive(), JSON.stringify({at: xyz(), messages}));
    assert.notDeepEqual(xyz(), [1994, 4960, 3], 'ordinary route approaches along the cave passage');
    assert.ok(player.getLocation().isWithinDistance(npc.getLocation(), 8));
    assert.equal(core.RegionManager.blocked(player.getLocation(), null), false);
    player.closeInterruptibleInterfaces(); player.moveTo(new core.Location(1998, 4955, 3));
    for (let i = 0; i < 4; i++) tick();
  });
  await t.test('repeat and disguise stages keep their existing transcript branches', async () => {
    quest.setStage(player, 4); await shout(); await drain();
    assert.match(lines.join(' '), /I'm afraid not yet/);
    quest.setStage(player, 5); await shout(); await drain();
    assert.match(lines.join(' '), /Yes, I have one right here/);
    player.getEquipment().setItem(core.Equipment.CAPE_SLOT, new core.Item(10171, 1));
    player.getEquipment().setItem(core.Equipment.HEAD_SLOT, new core.Item(10172, 1));
    await shout(); await drain();
    assert.match(lines.join(' '), /young hatchling/);
    assert.equal(quest.getStage(player), 5, 'shouting does not hand over the spare disguise');
  });
  await t.test('unrelated options, positions, planes and quest stages retain ordinary reach', () => {
    const request = () => ({ player, npc, npcId: 1484, definition: npc.getCurrentDefinition(player), clickType: 1, range: 1, ignoreProjectileClip: false });
    const unchanged = event => { PluginManager.emitNpcRoute(event); assert.equal(event.range, 1); assert.equal(event.ignoreProjectileClip, false); };
    unchanged({ ...request(), clickType: 2 });
    unchanged({ ...request(), npcId: 1485 });
    const original = npc.getLocation();
    for (const [dx, dy] of [[-5, 0], [5, 0], [0, -5], [0, 5], [-5, -5], [5, 5]]) {
      npc.setLocation(new core.Location(2006 + dx, 4959 + dy, 3));
      const event = request(); PluginManager.emitNpcRoute(event);
      assert.equal(event.range, 13, 'the five-tile nest boundary receives only the wander offset');
      assert.equal(event.ignoreProjectileClip, true);
    }
    for (const [dx, dy] of [[-6, 0], [6, 0], [0, -6], [0, 6]]) {
      npc.setLocation(new core.Location(2006 + dx, 4959 + dy, 3)); unchanged(request());
    }
    npc.setLocation(new core.Location(2006, 4959, 2)); unchanged(request());
    npc.setLocation(original);
    player.setLocation(new core.Location(1998, 4955, 2)); unchanged(request());
    player.setLocation(new core.Location(1998, 4955, 3));
    for (const stage of [0, 2, 6, 8]) { quest.setStage(player, stage); unchanged(request()); }
  });
  await t.test('wrong-plane and distant native clicks cannot start the conversation', async () => {
    quest.setStage(player, 3);
    for (const at of [[1998, 4955, 2], [1990, 4980, 3]]) {
      player.moveTo(new core.Location(...at)); for (let i = 0; i < 4; i++) tick();
      await shout(); assert.equal(player.getDialogueManager().isActive(), false);
      assert.deepEqual(xyz(), at);
    }
  });
  assert.deepEqual(errors, [], 'no swallowed plugin errors');
});
