const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { PacketSender } = require('../dist/net/packet/PacketSender');
const { Location } = require('../dist/game/model/Location');
const Progress = require('../plugins/world/Music.Progress');
const MusicPlugin = require('../plugins/world/Music.plugin');
const { DIARIES } = require('../plugins/diaries/DiaryData');

const handlers = new Map();
const loginHandlers = [];
let questAnswer;
let diaryAnswer;
let catalog;
let trackNames;
let setupPromise;
const api = new Proxy({
  core: PluginManager.getCoreApi(),
  persistAttribute() {},
  getBonusManager() { return { update() {} }; },
  onPlayerLogin(handler) { loginHandlers.push(handler); },
  onCustomEvent(name, handler) { handlers.set(name, [...(handlers.get(name) ?? []), handler]); },
  emitCustomEvent(name, request) {
    if (name === 'quest-cape:can-use') {
      if (questAnswer !== undefined) request.canUse = questAnswer;
      return;
    }
    if (name === 'diary:is-complete') {
      if (diaryAnswer !== undefined) request.complete = diaryAnswer;
      return;
    }
    for (const handler of handlers.get(name) ?? []) handler(request);
  },
}, { get: (target, key) => key in target ? target[key] : () => {} });

function setup() {
  if (!setupPromise) setupPromise = (async () => {
    await CachePipeline.initialize(process.cwd());
    MusicPlugin.register(api);
    catalog = MusicPlugin._test.getCatalog();
    trackNames = api.core.Music.trackNames();
  })();
  return setupPromise;
}

function makePlayer({ tracks = [], coins = 0, freeSlots = 28 } = {}) {
  const attrs = new Map([[Progress.UNLOCKED_TRACKS_ATTRIBUTE, tracks]]);
  const configs = [];
  const scripts = [];
  const flags = [];
  const varbits = [];
  const messages = [];
  const items = [];
  let coinAmount = coins;
  const inventory = {
    getAmount(id) { return id === 995 ? coinAmount : 0; },
    getFreeSlots() { return freeSlots; },
    deleteNumber(id, amount) { if (id === 995) coinAmount -= amount; },
    adds(id, amount) { items.push([id, amount]); return inventory; },
    contains() { return false; },
    refreshItems() {},
  };
  const sender = {
    sendConfig(id, value) { configs.push([id, value]); return sender; },
    sendVarbit(id, value) { varbits.push([id, value]); return sender; },
    sendInterfaceFlagsRange(...args) { flags.push(args); return sender; },
    sendClientScript(id, ...args) { scripts.push([id, ...args]); return sender; },
  };
  const equipment = { contains() { return false; }, refreshItems() {}, getItems() { return []; }, forSlot() { return { getId: () => -1 }; } };
  return {
    attrs, configs, scripts, flags, varbits, messages, items, inventory,
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getPacketSender: () => sender,
    getInventory: () => inventory,
    getEquipment: () => equipment,
    getBanks: () => [],
    sendMessage: (message) => messages.push(message),
  };
}

test('music unlocks pack complete cache bitfields and restore from persisted tracks on login', async () => {
  await setup();
  const player = makePlayer();
  const first = Object.keys(catalog.slotByTrackId).map(Number).find((id) => catalog.slotByTrackId[id].varp === 20);
  const second = Object.keys(catalog.slotByTrackId).map(Number).find((id) => id !== first && catalog.slotByTrackId[id].varp === 20);
  const firstBit = catalog.slotByTrackId[first].bit;
  const secondBit = catalog.slotByTrackId[second].bit;
  handlers.get('audio:play-song')[0]({ player, trackId: first });
  handlers.get('audio:play-song')[0]({ player, trackId: second });
  handlers.get('audio:play-song')[0]({ player, trackId: second });
  handlers.get('audio:play-song')[0]({ player, trackId: 99999 });
  assert.equal(typeof trackNames[first], 'string');
  assert.deepEqual(player.attrs.get(Progress.UNLOCKED_TRACKS_ATTRIBUTE), [first, second].sort((a, b) => a - b));
  assert.deepEqual(player.configs.filter(([id]) => id === 20), [[20, 1 << firstBit], [20, (1 << firstBit) | (1 << secondBit)]]);
  assert.equal(player.messages.length, 2);

  player.configs.length = 0;
  loginHandlers[0]({ player });
  assert.deepEqual(player.configs.find(([id]) => id === 20), [20, (1 << firstBit) | (1 << secondBit)]);
});

test('music cape trim fails closed when quest or diary eligibility is unanswered', async () => {
  await setup();
  const player = makePlayer({ tracks: catalog.allTrackIds });
  questAnswer = undefined;
  diaryAnswer = true;
  assert.equal(MusicPlugin._test.canTrim(player), false);
  questAnswer = true;
  diaryAnswer = undefined;
  assert.equal(MusicPlugin._test.canTrim(player), false);
  diaryAnswer = true;
  assert.equal(MusicPlugin._test.canTrim(player), true);
  questAnswer = undefined;
  diaryAnswer = undefined;
});

test('region-change unlock uses the cache row slot for archive song IDs', async () => {
  await setup();
  const player = makePlayer();
  assert.deepEqual(catalog.slotByTrackId[549], { varp: 1338, bit: 25, key: '1338:25' });
  handlers.get('music:unlock-track')[0]({ player, trackId: 549 });
  assert.deepEqual(player.configs, [[1338, 1 << 25]]);
  assert.deepEqual(player.attrs.get(Progress.UNLOCKED_TRACKS_ATTRIBUTE), [549]);
});

test('playing a song selects its native Music DB row in the now-playing varp', async () => {
  await setup();
  const player = makePlayer();
  const row = api.core.Music.tracks().find(({ id }) => id === 549);
  assert.equal(row.rowId, 2670);
  handlers.get('audio:play-song')[0]({ player, trackId: 549 });
  assert.deepEqual(player.configs, [[1338, 1 << 25], [3883, 2670]]);
  assert.deepEqual(player.scripts, [[3936]]);
});

test('PlayerSession unlocks the current region in manual mode without starting its song', async () => {
  await setup();
  const trackId = api.core.Music.forRegion(12850);
  assert.equal(typeof trackId, 'number', 'Lumbridge region has a cache-mapped song');
  const player = {
    getLocation: () => new Location(3222, 3218, 0),
    getArea: () => null,
    getAudioSettings: () => ({ 18: 1 }),
    getPacketSender: () => ({ sendSong() { assert.fail('manual mode must not start region music'); } }),
  };
  const session = new PlayerSession({ isOpen: true });
  session.setPlayer(player);
  // Region-item bookkeeping is independent from music and requires a fully initialized Player.
  session.lastGroundItemRegion = 12850;
  const emit = PluginManager.emitCustomEvent;
  let unlock;
  const stopAtUnlock = new Error('captured region unlock');
  PluginManager.emitCustomEvent = (name, payload) => {
    if (name === 'music:unlock-track') {
      unlock = payload;
      throw stopAtUnlock;
    }
  };
  try {
    assert.throws(() => session.flush(), stopAtUnlock);
  } finally {
    PluginManager.emitCustomEvent = emit;
  }
  assert.equal(unlock.player, player);
  assert.equal(unlock.trackId, trackId);
});

test('PacketSender unlocks only after the song packet is accepted', async () => {
  await setup();
  const events = [];
  const emit = PluginManager.emitCustomEvent;
  PluginManager.emitCustomEvent = (name, payload) => events.push([name, payload]);
  try {
    const player = { getSession: () => ({ sendClientPacket: () => true }) };
    new PacketSender(player).sendSong(549);
    assert.equal(events.length, 1);
    assert.equal(events[0][0], 'audio:play-song');
    assert.equal(events[0][1].player, player);
    assert.equal(events[0][1].trackId, 549);

    events.length = 0;
    const rejectedPlayer = { getSession: () => ({ sendClientPacket: () => false }) };
    new PacketSender(rejectedPlayer).sendSong(549);
    assert.deepEqual(events, []);
  } finally {
    PluginManager.emitCustomEvent = emit;
  }
});

test('music cape purchase allows the exact coin stack to free the second reward slot', async () => {
  await setup();
  questAnswer = undefined;
  diaryAnswer = undefined;
  const player = makePlayer({ tracks: catalog.nonHolidayTrackIds, coins: 99000, freeSlots: 1 });
  MusicPlugin._test.buyMusicCape(player);
  assert.deepEqual(player.items, [
    [api.core.ItemIdentifiers.MUSIC_CAPE, 1],
    [api.core.ItemIdentifiers.MUSIC_HOOD, 1],
  ]);
  assert.equal(player.attrs.get(Progress.CAPE_OWNED_ATTRIBUTE), true);
  assert.equal(player.attrs.get(Progress.AIR_GUITAR_UNLOCKED_ATTRIBUTE), true);
  assert.deepEqual(player.varbits, [[4673, 1]]);
  assert.equal(player.inventory.getAmount(995), 0);
});

test('music progress refuses an empty catalogue and uses all cache-defined native unlock slots', async () => {
  await setup();
  const player = makePlayer();
  assert.equal(Progress.allUnlocked(player, []), false);
  assert.equal(DIARIES.length > 0, true);
  assert.equal(catalog.allTrackIds.length > 800, true);
  assert.equal(Object.keys(catalog.slotByTrackId).length > catalog.allTrackIds.length, true);
});

test('music tab restores native jukebox row and now-playing actions after root mounts', async () => {
  await setup();
  const player = makePlayer();
  MusicPlugin._test.enableMusicActions(player);
  assert.deepEqual(player.flags, [
    [(239 << 16) | 11, 0, api.core.CacheDefinitions.getDbTableRows(44).length - 1, 62],
    [(239 << 16) | 4, -1, -1, 60],
  ]);
  assert.deepEqual(player.scripts, [[3936]]);
});

test('invalid music cape is banked when full and destroyed for ultimate ironmen', async () => {
  await setup();
  const originalUnequip = api.core.EquipPacketListener.unequip;
  api.core.EquipPacketListener.unequip = () => false;
  const cape = { getId: () => api.core.ItemIdentifiers.MUSIC_CAPE };
  function playerForFallback(ironmanMode) {
    const slots = [];
    slots[api.core.Equipment.CAPE_SLOT] = cape;
    const equipment = {
      getItems: () => slots,
      forSlot: (slot) => slots[slot],
      set(slot, item) { slots[slot] = item; },
      refreshItems() {},
    };
    const bankItems = [];
    const bank = { getFreeSlots: () => 1, add(item) { bankItems.push(item); }, refreshItems() {} };
    const player = makePlayer();
    player.getEquipment = () => equipment;
    player.getBanks = () => [bank];
    player.getAttribute = (key) => key === 'ironman:mode' ? ironmanMode : player.attrs.get(key);
    player.getUpdateFlag = () => ({ flag() {} });
    player.bankItems = bankItems;
    player.slots = slots;
    return player;
  }
  try {
    const regular = playerForFallback(undefined);
    MusicPlugin._test.removeInvalidEquippedCape(regular);
    assert.deepEqual(regular.bankItems, [cape]);
    assert.equal(regular.slots[api.core.Equipment.CAPE_SLOT].getId(), -1);

    const ultimate = playerForFallback('ultimate');
    MusicPlugin._test.removeInvalidEquippedCape(ultimate);
    assert.equal(ultimate.slots[api.core.Equipment.CAPE_SLOT].getId(), -1);
    assert.match(ultimate.messages[0], /destroyed/);
  } finally {
    api.core.EquipPacketListener.unequip = originalUnequip;
  }
});
