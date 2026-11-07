// Run from server/ after the normal build: node --test tests/party-room-f2p.test.cjs
// Exercise the real plugin loader in free-world mode, then the chest through packets.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, before, after } = require('node:test');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'party-f2p-'));
process.env.TSPS_PARTY_ROOM_DIR = temp;
process.env.PLAYER_SAVE_DATABASE_PATH = path.join(temp, 'players.sqlite');
process.env.PLAYER_SAVE_IMPORT_LEGACY_JSON = '0';
process.env.DISABLE_PLAYER_BOTS = '1';

// Load the real world configuration parser against a private F2P world before loading plugins.
const worldFile = path.join(temp, 'data', 'definitions', 'world.json');
fs.mkdirSync(path.dirname(worldFile), { recursive: true });
const shippedWorld = require('../data/definitions/world.json');
fs.writeFileSync(worldFile, JSON.stringify({ ...shippedWorld, membersWorld: false }));
const previousCwd = process.cwd();
let world;
try {
  process.chdir(temp);
  world = require('../dist/game/definition/WorldDefinition');
} finally {
  process.chdir(previousCwd);
}
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { decodeClientPackets } = require('../dist/net/protocol/ClientProtocol');
const Room = require('../plugins/minigames/partyroom/Room.PartyRoom');
const Store = require('../plugins/minigames/partyroom/Store.PartyRoom');
let core;
let savedPersistence;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  assert.equal(world.isMembersWorld(), false, 'configure the free world before the real plugin loader');
  assert.deepEqual({ ...world.readWorldConfig(), membersWorld: false }, JSON.parse(fs.readFileSync(worldFile, 'utf8')),
    'plugin switches and configuration match the copied world with no local override');
  assert.equal(process.env.AUTOSAVE_INTERVAL_TICKS, undefined, 'the existing persistence stub is used below the default autosave interval');
  core = PM.getCoreApi();
  try {
    PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  } finally {
    // The loader may have installed SQLite even if a later plugin fails to load.
    savedPersistence = core.GameConstants.PLAYER_PERSISTENCE;
  }
  core.RegionManager.init();
  core.GameConstants.PLAYER_PERSISTENCE = { requestSave() {}, flush: () => Promise.resolve() };
  PM.emitServerStartup({});
});

after(async () => {
  try {
    if (core && savedPersistence) core.GameConstants.PLAYER_PERSISTENCE = savedPersistence;
    PM.emitServerShutdown({});
    await savedPersistence?.flush();
  } finally {
    try {
      const writer = savedPersistence?.writer;
      if (writer) {
        savedPersistence.writer = null; // Prevent the exit handler restarting the worker.
        await writer.terminate();
      }
    } finally {
      try {
        savedPersistence?.database?.close();
      } finally {
        fs.rmSync(temp, { recursive: true, force: true });
      }
    }
  }
});

async function send(player, packet) {
  await player.testConnection.dispatch([packet]);
  player.testConnection.processTurnPackets();
  for (let i = 0; i < 12; i++) {
    core.TaskManager.processWalkTo(player.getIndex());
    player.getMovementQueue().process();
    core.TaskManager.process();
  }
  await new Promise((resolve) => setImmediate(resolve));
}

test('free-world loader registers the Falador chest and opens it by packet', async () => {
  assert.equal(world.isMembersWorld(), false, 'the actual world configuration is F2P');
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(2890);
  player.setUsername('f2pvisitor');
  player.setRegistered(true);
  player.setLocation(new core.Location(3053, 3376, 0));
  player.needsPlacement = false;
  const connection = new ClientConnection(channel);
  connection.player = player;
  player.testConnection = connection;
  player.getInventory().adds(995, 100);
  await send(player, { type: 'object_option', id: 26193, x: 3054, y: 3376, clickType: 1 });
  assert.equal(player.getPacketSender().isSubInterfaceOpen(265), true, 'free-world chest opens');
  assert.equal(player.getInventory().getAmount(995), 100, 'opening does not take the coins');
  assert.deepEqual(Store.chest(), [], 'opening does not donate');
  Room.screenOf().playerGone(player);
});


// This is a TSPS free-world control, not evidence that retail offers this dance on F2P worlds.
test('a free-world lever opens the knight choice and preserves payment on refusal and repeat', async (t) => {
  assert.equal(world.isMembersWorld(), false);
  assert.equal(core.NpcDefinition.forId(5793).isMembers(), false, 'actual server definition permits the NPC');
  assert.equal(world.isMembersArea(3043, 3378), false, 'the proposed performance is in configured free land');
  const lever = new core.Location(3054, 3378, 0);
  assert.ok(core.MapObjects.get(26194, lever, null), 'the map lever is present before interaction');
  assert.deepEqual(Store.chest(), [], 'the dance begins with an empty chest');
  t.after(() => Room.reset());

  function player(name, index) {
    const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
      send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
    const p = new Player(new PlayerSession(channel));
    p.setIndex(index);
    p.setUsername(name);
    p.setRegistered(true);
    p.setLocation(new core.Location(3054, 3377, 0));
    p.needsPlacement = false;
    const connection = new ClientConnection(channel);
    connection.player = p;
    p.testConnection = connection;
    return p;
  }
  const first = player('freeknight', 2891);
  const second = player('freeknight2', 2892);
  first.getInventory().adds(995, 499);
  second.getInventory().adds(995, 1000);

  async function menu(p) {
    await send(p, { type: 'object_option', id: 26194, x: 3054, y: 3378, clickType: 1 });
    const pending = core.MultiChatboxPrompt.getPending(p);
    assert.ok(pending, 'the free-world lever opens its choice menu');
    assert.deepEqual(pending.options, ['Balloon Bonanza (1,000 coins)', 'Nightly Dance (500 coins)', 'No action']);
  }
  async function choice(p, index) {
    const frame = Buffer.alloc(7);
    frame[0] = 62;
    frame[1] = index >>> 8;
    frame[2] = (index + 128) & 255;
    frame.writeInt32BE((219 << 16) | 1, 3);
    const decoded = decodeClientPackets(frame);
    assert.equal(decoded[0].childIndex, index);
    await p.testConnection.dispatch(decoded, true);
    p.testConnection.processTurnPackets();
    await new Promise((resolve) => setImmediate(resolve));
  }

  await menu(first);
  await choice(first, 3);
  assert.equal(first.getInventory().getAmount(995), 499, 'cancel preserves coins');
  await menu(first);
  await choice(first, 2);
  assert.equal(first.getInventory().getAmount(995), 499, 'underfunded dance preserves coins');
  assert.deepEqual(Store.chest(), []);
  first.getInventory().adds(995, 1001);
  await menu(first);
  await choice(first, 2);
  const Knights = require('../plugins/minigames/partyroom/Knights.PartyRoom');
  const show = Knights.performance();
  assert.ok(show, 'the free-world performance started');
  assert.equal(first.getInventory().getAmount(995), 1000, 'a dance charges exactly 500');
  assert.equal(show.knights.length, 6);
  assert.ok(show.knights.every((npc) => npc.isRegistered() && npc.getId() === 5793));
  await menu(second);
  await choice(second, 2);
  assert.equal(second.getInventory().getAmount(995), 1000, 'a concurrent request costs nothing');
  assert.equal(Knights.performance(), show, 'the performance is shared');
  assert.deepEqual(Store.chest(), [], 'a dance does not consume chest contents');
  for (let i = 0; i < 50; i++) core.TaskManager.process();
  assert.equal(Knights.performance(), null);
  assert.ok(show.knights.every((npc) => !npc.isRegistered()), 'all actors are removed after the show');
});

// The ordinary pie assembly path must continue to work on a configured free world.
test('free-world pie assembly keeps members-only recipes unavailable', async (t) => {
  const TOMATO = 1982, SHELL = 2315, PART = 7172, REDBERRIES = 1951, BERRY_PIE = 2321;
  assert.equal(world.isMembersWorld(), false);
  assert.equal(world.isMembersArea(3222, 3218), false, 'the actor is on configured free land');
  const TROUT = core.CacheDefinitions.getObjId('trout'), FISH_PART = core.CacheDefinitions.getObjId('unfinished_fish_pie_1');
  const SALMON = core.CacheDefinitions.getObjId('salmon'), ADMIRAL_PART = core.CacheDefinitions.getObjId('unfinished_admiral_pie_1');
  const BEAR = core.CacheDefinitions.getObjId('raw_bear_meat'), WILD_PART = core.CacheDefinitions.getObjId('unfinished_wild_pie_1');
  assert.deepEqual(['tomato', 'pie_shell', 'unfinished_garden_pie_1', 'redberries', 'uncooked_redberry_pie']
    .map(name => core.CacheDefinitions.getObjId(name)), [TOMATO, SHELL, PART, REDBERRIES, BERRY_PIE]);
  for (const [id, members] of [[TOMATO, false], [SHELL, false], [PART, true], [REDBERRIES, false], [BERRY_PIE, false],
    [TROUT, false], [FISH_PART, true], [SALMON, false], [ADMIRAL_PART, true], [BEAR, false], [WILD_PART, true]]) {
    assert.equal(core.CacheDefinitions.getItem(id).isMembers, members);
    assert.equal(core.ItemDefinition.forId(id).isNoted(), false);
    assert.equal(core.ItemDefinition.forId(id).isStackable(), false);
  }
  for (const id of [TOMATO, SHELL, REDBERRIES]) assert.equal(core.CacheDefinitions.getItem(id).isTradable, true);
  core.RegionManager.loadMapFiles(3222, 3218);

  // Members-only first steps made only from free items, which the item gate alone cannot catch.
  const cases = [['redberry control', REDBERRIES, BERRY_PIE, 10], ['garden pie', TOMATO, PART, 34],
    ['fish pie', TROUT, FISH_PART, 47], ['admiral pie', SALMON, ADMIRAL_PART, 70], ['wild pie', BEAR, WILD_PART, 85]];
  for (const [index, [name, ingredient, product, level]] of cases.entries()) {
    await t.test(name, async (child) => {
      const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
        send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
      const p = new Player(new PlayerSession(channel));
      p.setIndex(2910 + index);
      p.setUsername('freepie' + index);
      p.setRegistered(true);
      p.setLocation(new core.Location(3222, 3218, 0));
      p.needsPlacement = false;
      const c = new ClientConnection(channel), inv = p.getInventory(), skills = p.getSkillManager(), cooking = core.Skill.COOKING;
      c.player = p;
      PM.emitPlayerLogin({ player: p, username: p.getUsername() });
      p.closeInterruptibleInterfaces();
      child.after(() => {
        p.closeInterruptibleInterfaces();
        PM.emitPlayerDisconnect({ player: p, username: p.getUsername() });
        PM.emitPlayerLogout({ player: p, username: p.getUsername() });
        p.setRegistered(false);
        core.TaskManager.cancelTasks(p.getIndex());
        core.TaskManager.cancelTasks(p);
      });
      assert.ok(p.isRegistered() && p.getHitpoints() > 0);
      assert.equal(core.RegionManager.blocked(p.getLocation(), p.getPrivateArea()), false);
      const xp = core.SkillManager.getExperienceForLevel(level);
      skills.setExperience(cooking, xp).setMaxLevels(cooking, level, false).setCurrentLevels(cooking, level, false);
      assert.deepEqual([skills.getExperience(cooking), skills.getMaxLevel(cooking), skills.getCurrentLevel(cooking)], [xp, level, level]);
      for (const id of [ingredient, SHELL]) {
        assert.equal(inv.getAmount(id), 0);
        inv.add(new core.Item(id, 1), false);
        assert.notEqual(PM.emitCanUseItem(p, id, 'use'), false, 'the real free-world item gate permits the ingredient');
      }
      assert.equal(PM.emitCanUseItem(p, PART, 'use'), false, 'the registered free-world item gate is active');
      const slots = [ingredient, SHELL].map(id => inv.getSlotForItemId(id));
      assert.ok(slots.every(slot => slot >= 0));
      assert.notEqual(slots[0], slots[1]);
      for (const slot of slots) assert.equal(inv.getItems()[slot].getMeta(), null);
      const owned = id => inv.getAmount(id) + p.getEquipment().getAmount(id)
        + p.getBanks().reduce((sum, bank, tab) => sum + (bank && tab !== core.Bank.BANK_SEARCH_TAB_INDEX ? bank.getAmount(id) : 0), 0)
        + core.World.getItems().filter(item => !item.isPendingRemoval() && item.getOwner() === p.getUsername()
          && item.getPrivateArea() === p.getPrivateArea() && item.getItem().getId() === id)
          .reduce((sum, item) => sum + item.getItem().getAmount(), 0);
      assert.equal(owned(product), 0);
      assert.equal(owned(ingredient), 1);
      assert.equal(owned(SHELL), 1);
      const beforeXp = core.Skill.values().map(skill => skills.getExperience(skill));
      const uses = [], produced = [], tasks = [], original = PM.emitItemOnItem.bind(PM);
      child.mock.method(PM, 'emitItemOnItem', event => {
        const result = original(event);
        if (event.player === p) uses.push([event.usedItemId, event.usedWithItemId, result]);
        return result;
      });
      PM.createApi('FreePieObserver' + p.getIndex()).onCustomEvent('skills:produced', event => {
        if (event.player === p) produced.push([event.itemId, event.amount, event.xp, event.kind]);
      });
      const submit = core.TaskManager.submit.bind(core.TaskManager);
      child.mock.method(core.TaskManager, 'submit', task => {
        if (task.key === p.getIndex() && task.pluginName === 'Cooking') tasks.push(task);
        return submit(task);
      });
      const messages = [];
      child.mock.method(p, 'sendMessage', (text) => { messages.push(text); });
      let turns = 0;
      const turn = () => {
        assert.ok(++turns <= 6);
        p.resetUpdating();
        core.World.processCycle = (core.World.processCycle + 1) & 0x7fffffff;
        core.TaskManager.process();
        c.processTurnPackets();
        const movement = p.getMovementQueue();
        movement.beginCycle(); movement.processEntityPursuit();
        if (movement.hasPendingWork()) movement.process();
        core.TaskManager.processWalkTo(p.getIndex());
      };
      await c.dispatch([{ type: 'inventory_use_on', slot: slots[0], itemId: ingredient,
        target: { kind: 'inventory', slot: slots[1], itemId: SHELL } }]);
      turn();
      assert.deepEqual(uses, [[ingredient, SHELL, true]], 'the real item-on-item path handles the pair');
      if (name === 'redberry control') {
        assert.equal(tasks.length, 1, 'the actual Cooking handler submits a task');
        assert.equal(tasks[0].isRunning(), true);
        assert.deepEqual([owned(ingredient), owned(SHELL), owned(product)], [1, 1, 0]);
        for (let i = 0; i < 4; i++) turn();
        assert.equal(tasks[0].isRunning(), false, 'the actual Cooking task completes');
        assert.equal(owned(BERRY_PIE), 1, 'a free recipe completes through the same path');
        assert.deepEqual([inv.getAmount(REDBERRIES), inv.getAmount(SHELL)], [0, 0]);
        assert.deepEqual(produced, [[BERRY_PIE, 1, 0, 'make']]);
        assert.deepEqual(messages, []);
      } else {
        assert.equal(tasks.length, 0, 'a members-only recipe does not start a Cooking task');
        for (let i = 0; i < 4; i++) turn();
        assert.equal(owned(product), 0, `free worlds must not make the members-only ${name} part`);
        assert.deepEqual([inv.getAmount(ingredient), inv.getAmount(SHELL)], [1, 1]);
        assert.deepEqual([owned(ingredient), owned(SHELL)], [1, 1]);
        assert.deepEqual(messages, ["To use this item please login to a members' world."], 'the refusal says why');
        for (const slot of slots) assert.equal(inv.getItems()[slot].getMeta(), null);
        assert.deepEqual(produced, []);
      }
      assert.deepEqual(core.Skill.values().map(skill => skills.getExperience(skill)), beforeXp);
    });
  }
});
