// Canonical dock parent + real per-player quest/packet state. No listeners or network services.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
const runtime = require('../plugins/quests/QuestRuntime');
const spawns = require('../data/definitions/npc-spawns.json');

const PISCARILIUS = [1825, 3691, 0];
const VEOS_PARENT = 2147;
const HERBERT_PARENT = 11125;
const PISC_VIS = 12146;
const X_MARKS = 'x_marks_the_spot';
const AKD = 'a_kingdom_divided';
let core, veos, herbert, next = 14800;
const errors = [];
const interactions = [];
const arrivals = [];
const originalError = console.error;
const quest = (key) => runtime.getRegisteredQuests().find((q) => q.key === key);

before(async () => {
  console.error = (...args) => { errors.push(args.map(String).join(' ')); originalError(...args); };
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PM.getCoreApi();
  core.RegionManager.init();
  for (const [x, y] of [PISCARILIUS, [3054, 3245], [1504, 3395]]) core.RegionManager.loadMapFiles(x, y);
  // Same production hooks, restricted to the affected quest/transcript/ferry path.
  // No full plugin discovery or server-startup HTTP plugins.
  const api = PM.createApi('VeosVisibility');
  api.onNpcInteraction((event) => { interactions.push({ player: event.player, id: event.npcId, definition: event.definition }); return false; });
  api.onCustomEvent('ferries:arrived', (event) => arrivals.push({ player: event.player, route: event.route }));
  runtime.registerQuestWidgets(api);
  for (const name of ['AKingdomDivided', 'ClientOfKourend', 'DragonSlayerII', 'XMarksTheSpot']) {
    require(`../plugins/quests/quests/${name}.Quest`)(api);
  }
  require('../plugins/npcs/NpcDialogues.plugin').register(api);
  require('../plugins/world/Ferries.plugin').register(api);
  PM.emitServerStartup({ timestamp: Date.now() });
  veos = PM.spawnNpc({ id: VEOS_PARENT, x: PISCARILIUS[0], y: PISCARILIUS[1], z: 0, wanderRadius: 0 });
  herbert = PM.spawnNpc({ id: HERBERT_PARENT, x: 1826, y: 3691, z: 0, wanderRadius: 0 });
});
after(() => {
  PM.emitServerShutdown({ timestamp: Date.now() });
  console.error = originalError;
  assert.deepEqual(errors, [], 'required production hooks ran without errors');
});

function actor(t, xmarks = 6, akd = 0) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel), new core.Location(1825, 3690, 0));
  player.setIndex(next++);
  player.setRegistered(true);
  player.setUsername('docktest' + next);
  player.setAttribute('bot-skip-persistence', true);
  player.needsPlacement = false;
  const connection = new ClientConnection(channel);
  connection.player = player;
  quest(X_MARKS).setStage(player, xmarks);
  quest(AKD).setStage(player, akd);
  const login = () => {
    PM.emitPlayerLogin({ player, username: player.getUsername() });
    PM.emitCustomEvent('player:bootstrap-complete', { player });
  };
  login();
  const lines = [];
  const sender = player.getPacketSender();
  const sendString = sender.sendString.bind(sender);
  sender.sendString = (text, ...args) => { if (typeof text === 'string') lines.push(text); return sendString(text, ...args); };
  const tick = () => {
    core.TaskManager.processWalkTo(player.getIndex());
    player.getMovementQueue().process();
    core.TaskManager.process();
    connection.processTurnPackets();
  };
  const send = async (packet) => { await connection.dispatch([packet]); for (let n = 0; n < 3; n++) tick(); };
  t.after(() => {
    PM.emitPlayerLogout({ player, username: player.getUsername() });
    player.setRegistered(false);
    core.TaskManager.cancelTasks(player);
    core.TaskManager.cancelTasks(player.getIndex());
  });
  return { player, sender, lines, tick, send, login };
}

const position = (player) => [player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()];
async function menu(f) {
  for (let n = 0; n < 80; n++) {
    const pending = MultiChatboxPrompt.getPending(f.player);
    if (pending) return pending.options;
    const current = f.player.getDialogueManager().getCurrent();
    if (typeof current?.getOptions === 'function') return current.getOptions();
    if (!current) return null;
    const group = f.sender.getChatboxGroupId();
    await f.send({ type: 'dialogue_continue', widgetId: (group << 16) | (group === 229 ? 4 : 5), childIndex: -1 });
  }
  assert.fail('dialogue did not settle');
}
async function choose(f, option) {
  const options = await menu(f);
  assert.ok(options?.includes(option), `${option}: ${JSON.stringify(options)}`);
  await f.send({ type: 'dialogue_continue', widgetId: (219 << 16) | 1, childIndex: options.indexOf(option) + 1 });
}
async function operate(f, npc, clickType) {
  await f.send({ type: 'npc_option', index: npc.getIndex(), clickType });
}
function assertArrival(f, route, destination) {
  for (let n = 0; n < 10; n++) f.tick();
  assert.deepEqual(position(f.player), destination);
  assert.equal(require('../plugins/world/Ferries.plugin')._test.Common.travelling(f.player), false);
  assert.equal(arrivals.filter((e) => e.player === f.player && e.route === route).length, 1, 'actual shared ferry completes once');
}

test('Piscarilius has one canonical Veos parent and preserves both Herbert locations', () => {
  assert.deepEqual(spawns.filter((n) => n.name === 'Veos' && n.x === 1825 && n.y === 3691), [
    { level: 0, name: 'Veos', x: 1825, y: 3691, id: VEOS_PARENT },
  ]);
  assert.equal(spawns.filter((n) => n.id === HERBERT_PARENT && n.x === 1826 && n.y === 3691 && n.level === 0).length, 1);
  assert.equal(spawns.filter((n) => n.id === 11127 && n.x === 1824 && n.y === 3695 && n.level === 1).length, 1);
});

test('real quest lifecycle publishes the correct amulet/departure forms and preserves sibling vars', (t) => {
  const f = actor(t, 0, 0);
  const definition = core.CacheDefinitions.getVarbit(PISC_VIS);
  const backingVar = definition.baseVar;
  const unrelatedBit = 1 << 25;
  f.sender.sendConfig(backingVar, f.sender.getVarp(backingVar) | unrelatedBit);
  for (const [xmarks, akd, visibility, id] of [
    [0, 0, 2, 10726], [5, 0, 2, 10726], [6, 0, 1, 10727],
    [6, 11, 1, 10727], [6, 12, 0, undefined], [6, 24, 0, undefined],
    [6, 150, 0, undefined], [6, 0, 1, 10727], [0, 0, 2, 10726],
  ]) {
    quest(X_MARKS).setStage(f.player, xmarks);
    quest(AKD).setStage(f.player, akd);
    assert.equal(f.sender.getVarbit(PISC_VIS), visibility, `X Marks ${xmarks}, AKD ${akd}`);
    assert.equal(veos.getCurrentDefinition(f.player)?.getId(), id);
    assert.equal(f.sender.getVarp(backingVar) & unrelatedBit, unrelatedBit, 'sibling backing-varp bit survives');
    assert.equal(herbert.getCurrentDefinition(f.player)?.getId(), akd >= 12 ? 10932 : undefined);
    if (id !== undefined) assert.deepEqual(veos.getCurrentDefinition(f.player).getActions().filter(Boolean), ['Talk-to', 'Port Sarim', "Land's End"]);
  }
  quest(AKD).setStage(f.player, 150);
  f.sender.sendVarbit(PISC_VIS, 2); // A stale transient sender state must be replaced at login.
  f.login();
  assert.equal(f.sender.getVarbit(PISC_VIS), 0);
  assert.equal(veos.getCurrentDefinition(f.player), undefined);
});

test('one shared dock NPC resolves independently for two real players through changes and login', (t) => {
  const a = actor(t, 6, 11), b = actor(t, 6, 11);
  const bVars = [b.sender.getVarbit(PISC_VIS), b.sender.getVarbit(12148), b.sender.getVarbit(12151)];
  quest(AKD).setStage(a.player, 12);
  assert.equal(veos.getCurrentDefinition(a.player), undefined);
  assert.equal(veos.getCurrentDefinition(b.player)?.getId(), 10727);
  assert.deepEqual([b.sender.getVarbit(PISC_VIS), b.sender.getVarbit(12148), b.sender.getVarbit(12151)], bVars);
  a.login();
  assert.equal(veos.getCurrentDefinition(a.player), undefined);
  assert.equal(herbert.getCurrentDefinition(a.player)?.getId(), 10932);
  assert.equal(herbert.getCurrentDefinition(b.player), undefined);
  quest(AKD).setStage(a.player, 0);
  assert.equal(veos.getCurrentDefinition(a.player)?.getId(), 10727);
  quest(X_MARKS).setStage(a.player, 0);
  assert.equal(veos.getCurrentDefinition(a.player)?.getId(), 10726, 'X Marks reset updates immediately');
  assert.equal(veos.getCurrentDefinition(b.player)?.getId(), 10727);
});

test('native parent Talk-to starts Client of Kourend through the resolved amulet form', async (t) => {
  const f = actor(t);
  await operate(f, veos, 1);
  assert.equal(interactions.filter((e) => e.player === f.player).at(-1)?.id, 10727);
  await choose(f, 'Have you got any quests for me?');
  await choose(f, 'Yes.');
  await menu(f);
  assert.equal(quest('client_of_kourend').getStage(f.player), 1);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.ENCHANTED_SCROLL), 1, 'real scroll handover');
});

test('native correct onward options preserve prequest travel and Herbert takes over after AKD', async (t) => {
  for (const [xmarks, akd, npc, clickType, route, destination] of [
    [0, 0, veos, 3, 'kourend-sarim', [3055, 3242, 1]],
    [6, 11, veos, 4, 'kourend-landsend', [1504, 3395, 1]],
    [6, 150, herbert, 3, 'kourend-sarim', [3055, 3242, 1]],
    [6, 150, herbert, 4, 'kourend-landsend', [1504, 3395, 1]],
  ]) {
    const f = actor(t, xmarks, akd);
    f.player.getInventory().adds(core.ItemIdentifiers.COINS, 123);
    await operate(f, npc, clickType);
    assertArrival(f, route, destination);
    assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.COINS), 123, 'no fare');
    assert.equal(quest('client_of_kourend').getStage(f.player), 0, 'travel never starts the quest');
  }
});

test('native postquest menu travel survives cancel/reopen and uses the new choice once', async (t) => {
  const f = actor(t);
  quest('client_of_kourend').setStage(f.player, 5);
  await operate(f, veos, 1);
  await choose(f, 'Can you take me somewhere?');
  await choose(f, 'Travel to Port Sarim.');
  // Cancel before the final departure line; re-talk must discard the old destination.
  f.sender.sendInterfaceRemoval();
  assert.deepEqual(position(f.player), [1825, 3690, 0]);
  await operate(f, veos, 1);
  await choose(f, 'Can you take me somewhere?');
  await choose(f, "Travel to Land's End.");
  await menu(f);
  assertArrival(f, 'kourend-landsend', [1504, 3395, 1]);
  assert.equal(arrivals.filter((e) => e.player === f.player).length, 1);
});

test('cached native direct operation cannot travel using Veos after that player reaches AKD12', async (t) => {
  const f = actor(t, 6, 11), other = actor(t, 6, 11);
  const cachedIndex = veos.getIndex();
  assert.equal(veos.getCurrentDefinition(f.player).getActions()[2], 'Port Sarim');
  quest(AKD).setStage(f.player, 12);
  await f.send({ type: 'npc_option', index: cachedIndex, clickType: 3 });
  for (let n = 0; n < 10; n++) f.tick();
  assert.deepEqual(position(f.player), [1825, 3690, 0]);
  assert.equal(arrivals.filter((e) => e.player === f.player).length, 0);
  assert.equal(quest('client_of_kourend').getStage(f.player), 0);
  assert.equal(veos.getCurrentDefinition(other.player)?.getId(), 10727);
  await operate(other, veos, 3);
  assertArrival(other, 'kourend-sarim', [3055, 3242, 1]);
});

test('a retained native departure line cannot sail after its Veos disappears at AKD12', async (t) => {
  const f = actor(t, 6, 11);
  quest('client_of_kourend').setStage(f.player, 5);
  await operate(f, veos, 1);
  await choose(f, 'Can you take me somewhere?');
  await choose(f, 'Travel to Port Sarim.');
  quest(AKD).setStage(f.player, 12);
  assert.equal(veos.getCurrentDefinition(f.player), undefined);
  await menu(f);
  for (let n = 0; n < 10; n++) f.tick();
  assert.deepEqual(position(f.player), [1825, 3690, 0]);
  assert.equal(arrivals.filter((e) => e.player === f.player).length, 0);
});
