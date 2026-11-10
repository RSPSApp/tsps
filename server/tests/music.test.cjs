const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { PacketSender } = require('../dist/net/packet/PacketSender');
const { Location } = require('../dist/game/model/Location');
const Progress = require('../plugins/world/Progress.Music');
const QuestUnlocks = require('../plugins/world/QuestUnlocks.Music');
const MusicPlugin = require('../plugins/world/Music.plugin');

const handlers = new Map();
const loginHandlers = [];
let questAnswer;
let diaryAnswer;
let catalog;
let trackNames;
let setupPromise;
// Stands in for QuestRuntime's quest:is-complete: answers only for registered names, as it does.
const registeredQuests = new Set(['Dragon Slayer II', 'While Guthix Sleeps', 'Observatory Quest', 'Monkey Madness I', 'Monkey Madness II', 'The Dig Site']
  .map(QuestUnlocks.normaliseQuestName));
let completedQuests = new Set();
const api = new Proxy({
  core: PluginManager.getCoreApi(),
  persistAttribute() {},
  getBonusManager() { return { update() {} }; },
  onPlayerLogin(handler) { loginHandlers.push(handler); },
  onCustomEvent(name, handler) { handlers.set(name, [...(handlers.get(name) ?? []), handler]); },
  emitCustomEvent(name, request) {
    if (name === 'quest:is-started' && request.key === 'fremennik_trials') {
      request.started = request.player.trialsStarted === true;
      return;
    }
    if (name === 'quest:is-complete' && request.key === 'fremennik_trials') {
      request.complete = request.player.trialsComplete === true;
      return;
    }
    if (name === 'quest-cape:can-use') {
      if (questAnswer !== undefined) request.canUse = questAnswer;
      return;
    }
    if (name === 'diary:all-complete') {
      if (diaryAnswer !== undefined) request.complete = diaryAnswer;
      return;
    }
    if (name === 'quest:is-complete') {
      const quest = QuestUnlocks.normaliseQuestName(request.name);
      if (request.name !== undefined && registeredQuests.has(quest)) request.complete = completedQuests.has(quest);
      return;
    }
    for (const handler of handlers.get(name) ?? []) handler(request);
  },
  sendMultiChatboxPrompt(player, title, ...options) { player.prompts.push({ title, options }); },
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

function makePlayer({ tracks = [], coins = 0, freeSlots = 28, chatboxTransparent = false } = {}) {
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
    getVarbit(id) { return id === 4608 && chatboxTransparent ? 1 : 0; },
    sendInterfaceFlagsRange(...args) { flags.push(args); return sender; },
    sendClientScript(id, ...args) { scripts.push([id, ...args]); return sender; },
  };
  const equipment = { contains() { return false; }, refreshItems() {}, getItems() { return []; }, forSlot() { return { getId: () => -1 }; } };
  return {
    prompts: [],
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

test('Olaf keeps his Trials dialogue reachable while the quest is active', async () => {
  await setup();
  const player = makePlayer();
  player.trialsStarted = true;
  assert.equal(MusicPlugin._test.talkToOlaf({ player }), false);
  assert.deepEqual(player.prompts, []);
  player.trialsComplete = true;
  assert.equal(MusicPlugin._test.talkToOlaf({ player }), true);
  assert.equal(player.prompts.at(-1).title, 'Music cape');
  player.trialsStarted = false;
  player.trialsComplete = false;
  assert.equal(MusicPlugin._test.talkToOlaf({ player }), true);
});

test('an unlock names the track in the chatbox-transparency colour, unclosed and without a full stop', async () => {
  await setup();
  // rsprox 224/01437 (transparent chatbox) and 234/03275 (opaque until transparency is turned on).
  const EVERYWHERE = 268;
  assert.equal(trackNames[EVERYWHERE], 'Everywhere');
  const transparent = makePlayer({ chatboxTransparent: true });
  handlers.get('music:unlock-track')[0]({ player: transparent, trackId: EVERYWHERE });
  assert.deepEqual(transparent.messages, ['You have unlocked a new music track: <col=ff3045>Everywhere']);
  const opaque = makePlayer();
  handlers.get('music:unlock-track')[0]({ player: opaque, trackId: EVERYWHERE });
  assert.deepEqual(opaque.messages, ['You have unlocked a new music track: <col=e00a19>Everywhere']);
  // Live sends only the unlock varp and the message, no jingle (this sender has no jingle method).
  assert.equal(opaque.configs.length, 1);
  assert.deepEqual(opaque.scripts, []);
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

test('Varlamore plays the tracks of the Wiki music area under the player', async () => {
  await setup();
  const { Music } = api.core;
  const plays = (x, y, track, where) => assert.ok(Music.tracksAt(x, y, 0).includes(track), where);
  plays(1696, 3104, 787, 'Civitas illa Fortis');
  assert.deepEqual(Music.tracksAt(1696, 3232, 0), [809], 'the Twilight Temple');
  plays(1696, 9504, 787, 'the temple crypt');
  assert.deepEqual(Music.tracksAt(1440, 3168, 0), [766], "Ralos' Rise");
  plays(1440, 3040, 783, 'the Avium Savannah');
  plays(1376, 3232, 822, 'the Auburn Valley');
  plays(1314, 2958, 805, 'Aldarin');
});

// The track ids that some tile's music area plays, read straight from music-areas.json.
function tileTracks() {
  const { areas, tiles } = require('../data/definitions/music-areas.json');
  const used = new Set();
  for (const regions of Object.values(tiles)) for (const runs of Object.values(regions)) {
    for (const run of runs.split(',')) if (!run.startsWith('-')) used.add(Number(run.split('*')[0]));
  }
  return { areas, used, tracks: new Set([...used].flatMap(area => areas[area].tracks)) };
}

test('every area track plays in some music area, apart from the tracks the Wiki maps nowhere', async () => {
  await setup();
  // Hints that name a place ("in Varrock.", "south of Falador.") rather than a quest, boss or event.
  const notArea = /^(during|while|after|automatically|somewhere)/i;
  const { tracks } = tileTracks();
  const unmapped = [...new Set(api.core.Music.tracks()
    .filter(({ id, unlockHint }) => unlockHint && !notArea.test(unlockHint.trim()) && !tracks.has(id))
    .map(({ name }) => name))].sort();
  const known = require('./fixtures/music-unmapped-tracks.json');
  assert.deepEqual(unmapped.filter(name => !known.includes(name)), [], 'area tracks no music area plays any more');
  assert.deepEqual(known.filter(name => !unmapped.includes(name)), [], 'tracks a music area plays since: drop them from the list');
});

test('music-areas.json: every area has tiles, cache tracks and whole region grids', async () => {
  await setup();
  const { areas, used } = tileTracks();
  const { tiles } = require('../data/definitions/music-areas.json');
  for (const [index, { names, tracks }] of areas.entries()) {
    assert.deepEqual(tracks.map(id => trackNames[id]), names, `area ${index} names its cache tracks`);
    assert.ok(used.has(index), `${names.join(', ')} owns tiles`);
  }
  for (const [plane, regions] of Object.entries(tiles)) for (const [region, runs] of Object.entries(regions)) {
    const length = runs.split(',').reduce((sum, run) => sum + Number(run.split('*')[1] ?? 1), 0);
    assert.equal(length, 4096, `plane ${plane} region ${region}`);
  }
  assert.ok(areas.filter(({ tracks }) => tracks.length > 1).length >= 50, 'the Wiki shuffle areas are there');
});

test('music areas follow the Wiki tile by tile, not by map region', async () => {
  await setup();
  const { Music } = api.core;
  const names = (x, y, plane = 0) => Music.tracksAt(x, y, plane).map(id => trackNames[id]);
  // Title Fight's area is the Champions' Guild basement; Victory is Mine's is the arena inside it.
  assert.deepEqual(names(3150, 9740), ['Title Fight']);
  assert.deepEqual(names(3170, 9758), ['Victory is Mine']);
  // Burthorpe and the Warriors' Guild share a map region.
  assert.deepEqual(names(2899, 3545), ['Kingdom', 'Principality']);
  assert.deepEqual(names(2855, 3545), ["Warriors' Guild"]);
  assert.deepEqual(names(2855, 3545, 1), ["Warriors' Guild"], "a floor with no area of its own plays the ground floor's");
  assert.deepEqual(names(3338, 10250), ['A Dangerous Game'], 'a captured area the Wiki maps miss');
  assert.deepEqual(Music.tracksAt(0, 0, 0), []);
  assert.equal(Music.tracksAt(3222, 3218, 0), Music.tracksAt(3200, 3210, 0), 'one list for the whole area');
});

test('an instance tile plays the music of the cache-map tile its chunk copies', async () => {
  await setup();
  const { Music } = api.core;
  const chunk = { sourceChunkX: 3150 >> 3, sourceChunkY: 9740 >> 3, sourcePlane: 0, rotation: 0 };
  const area = { getBaseX: () => 6400, getBaseY: () => 6400, getChunk: (plane, cx, cy) => (cx === 0 && cy === 0 ? chunk : null) };
  assert.deepEqual(Music.instanceSourceTile(area, 6401, 6402, 0), { x: (3150 & ~7) + 1, y: (9740 & ~7) + 2, plane: 0 });
  chunk.rotation = 1; // a chunk turned once puts source (x, y) at (y, 7 - x)
  assert.deepEqual(Music.instanceSourceTile(area, 6401, 6402, 0), { x: (3150 & ~7) + 5, y: (9740 & ~7) + 1, plane: 0 });
  assert.equal(Music.instanceSourceTile(area, 6420, 6402, 0), undefined, 'outside the copied chunks');
});

test('the Karuulm Slayer Dungeon shuffles Way of the Wyrm, Ful to the Brim and Kanon of Kahlith', async () => {
  await setup();
  const { Music } = api.core;
  for (const [x, y] of [[1310, 10205], [1240, 10150]]) {
    assert.deepEqual(Music.tracksAt(x, y, 0).map(id => trackNames[id]), ['Ful to the Brim', 'Kanon of Kahlith', 'Way of the Wyrm'], `${x}, ${y}`);
  }
  assert.equal(Music.lengthTicks(595), 553, "Way of the Wyrm's cache length");
  assert.equal(Music.pickAreaTrack([595, 635, 608], -1, () => 0.99), 608);
  assert.equal(Music.pickAreaTrack([595, 635, 608], 595, () => 0), 635, 'the next track is never the one that ended');
  assert.equal(Music.pickAreaTrack([595], 595), 595, 'a one-track area plays it again');
  assert.equal(Music.pickAreaTrack([]), undefined);
});

test('import-music-areas: the smallest Wiki polygon on a tile wins, holes and history left out', async () => {
  const { buildMusicAreas, polygonSize } = await import('../scripts/import-music-areas.mjs');
  const square = (x, y, size) => [[x, y], [x + size, y], [x + size, y + size], [x, y + size]];
  assert.equal(polygonSize([square(0, 0, 10), square(2, 2, 2), square(20, 20, 3)]), 100 - 4 + 9, 'a hole subtracts, a separate piece adds');
  const map = (title, rings, { plane = 0, historic = false } = {}) => ({
    title, page_name: title,
    ...(historic ? { 'map.is_historic': '' } : {}),
    'map.features': JSON.stringify([{ type: 'Feature', properties: { mapID: -1, plane }, geometry: { type: 'Polygon', coordinates: rings } }]),
  });
  const tracks = [
    { id: 1, name: 'Town' }, { id: 2, name: 'Town 2' }, { id: 3, name: 'Hall' },
    { id: 4, name: 'Old' }, { id: 6, name: 'Upstairs' }, { id: 9, name: 'Cave' },
    { id: 10, name: 'Work\t Work' }, // the cache writes a comma as a tab
  ];
  const town = [square(0, 0, 128), square(32, 32, 4)]; // with a hole at (32..35, 32..35)
  const rows = [
    map('Town 2', town), map('Town', town),
    map('Hall', [square(10, 10, 2)]), // inside the town, and smaller
    map('Old', [square(0, 0, 256)], { historic: true }),
    map('Upstairs', [square(0, 0, 2)], { plane: 1 }),
    map('Gone', [square(500, 500, 8)]), // not in the cache
    map('Work Work', [square(300, 300, 4)]),
  ];
  // Region (1, 0) lies under the town; region (2, 0) has no Wiki polygon.
  const unmapped = [{ tracks: ['Cave'], regions: [(1 << 8) | 0, (2 << 8) | 0] }];
  const { areas, tiles, unknown } = buildMusicAreas({ rows, tracks, unmapped });
  assert.deepEqual(areas.map(({ names }) => names), [['Cave'], ['Hall'], ['Town', 'Town 2'], ['Upstairs'], ['Work\t Work']]);
  assert.deepEqual(unknown, ['Gone']);
  const area = (plane, x, y) => {
    const runs = tiles[plane]?.[((x >> 6) << 8) | (y >> 6)];
    if (!runs) return undefined;
    let tile = ((y & 63) << 6) | (x & 63);
    for (const run of runs.split(',')) {
      const [id, count = 1] = run.split('*');
      if (tile < Number(count)) return id === '-' ? undefined : areas[Number(id)].names[0];
      tile -= Number(count);
    }
  };
  assert.equal(area(0, 5, 5), 'Town', 'polygons with the same tracks are one area');
  assert.equal(area(0, 11, 11), 'Hall', 'the smaller polygon wins');
  assert.equal(area(0, 12, 12), 'Town', "the tile past the hall's edge");
  assert.equal(area(0, 33, 33), undefined, 'a hole is no area');
  assert.equal(area(0, 127, 127), 'Town', 'the polygon crosses into other regions, up to its edge');
  assert.equal(area(0, 5, 130), undefined, 'outside every polygon, and the historic map ignored');
  assert.equal(area(1, 1, 1), 'Upstairs');
  assert.equal(area(1, 5, 5), undefined, 'upper floors have their own grids');
  assert.equal(area(0, 70, 5), 'Town', 'a Wiki polygon wins over the unmapped region under it');
  assert.equal(area(0, 130, 5), 'Cave', 'the unmapped region fills where the Wiki has nothing');
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

test('entering a music area unlocks all its tracks in manual mode, the picked one first, and starts none', async t => {
  await setup();
  const lumbridge = api.core.Music.tracksAt(3222, 3218, 0);
  assert.deepEqual(lumbridge.map(id => trackNames[id]), ['Autumn Voyage', 'Book of Spells', 'Dream', 'Flute Salad', 'Harmony', 'Yesteryear']);
  const player = {
    getLocation: () => new Location(3222, 3218, 0),
    getArea: () => null,
    getAudioSettings: () => ({ 18: 1 }),
    getPacketSender: () => ({ sendSong() { assert.fail('manual mode must not start area music'); } }),
  };
  const session = new PlayerSession({ isOpen: true });
  session.setPlayer(player);
  // Region-item bookkeeping is independent from music and requires a fully initialized Player.
  session.lastGroundItemRegion = 12850;
  session.lastGroundItemLevel = 0;
  t.mock.method(Math, 'random', () => 0.99);
  const emit = PluginManager.emitCustomEvent;
  const unlocked = [];
  PluginManager.emitCustomEvent = (name, payload) => {
    if (name === 'music:unlock-track') {
      assert.equal(payload.player, player);
      unlocked.push(trackNames[payload.trackId]);
    }
  };
  try {
    try { session.flush(); } catch { /* the fake player stops the rest of flush; music ran first */ }
  } finally {
    PluginManager.emitCustomEvent = emit;
  }
  assert.deepEqual(unlocked, ['Yesteryear', 'Autumn Voyage', 'Book of Spells', 'Dream', 'Flute Salad', 'Harmony']);
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
  const mountedFlags = player.flags.slice();
  player.flags.length = 0;
  player.scripts.length = 0;
  // Welcome's settled mount event runs even when a later plugin consumes its Play click.
  api.emitCustomEvent('gameframe:ready', { player });
  await Promise.resolve();
  assert.deepEqual(player.flags, mountedFlags, 'restore row operations after the actual welcome bootstrap');
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

// Live's packets around music (rsprox revs 236-239, 1,584 jingles): a region change carries the
// MidiSongV2 defaults 0/60/60/0 (fade-out delay/speed, fade-in delay/speed, in client cycles),
// and every jingle is preceded on the same tick by the current track with all four fades 0; the
// client resumes that track itself when the jingle ends.
test('encodePlaySong carries the live fade defaults, or the fades it is given', () => {
  const { encodePlaySong } = require('../dist/net/protocol/ClientProtocol');
  const body = (packet) => packet.subarray(packet.length - 10);
  assert.deepEqual([...body(encodePlaySong(454))], [1, 198, 0, 0, 0, 60, 0, 60, 0, 0]);
  assert.deepEqual([...body(encodePlaySong(454, { fadeOutDelay: 0, fadeOutSpeed: 0, fadeInDelay: 0, fadeInSpeed: 0 }))], [1, 198, 0, 0, 0, 0, 0, 0, 0, 0]);
});

test('sendJingle first re-sends the current track with zero fades, then the jingle, and returns the sender', async () => {
  await setup();
  const frames = [];
  const player = { getSession: () => ({ sendClientPacket: (frame) => { frames.push(frame); return true; }, getCurrentMusicTrack: () => 454 }) };
  const sender = new PacketSender(player);
  const emit = PluginManager.emitCustomEvent;
  PluginManager.emitCustomEvent = () => {};
  try {
    assert.equal(sender.sendJingle(18), sender);
  } finally {
    PluginManager.emitCustomEvent = emit;
  }
  assert.deepEqual(frames.map((f) => f[0]), [133, 132], 'PLAY_SONG then PLAY_JINGLE');
  assert.deepEqual([...frames[0].subarray(frames[0].length - 10)], [1, 198, 0, 0, 0, 0, 0, 0, 0, 0], 'the current track, zero fades');
  assert.deepEqual([...frames[1].subarray(frames[1].length - 5)], [0, 18, 0, 0, 0]);

  frames.length = 0;
  const silent = { getSession: () => ({ sendClientPacket: (frame) => { frames.push(frame); return true; }, getCurrentMusicTrack: () => -1 }) };
  const quiet = new PacketSender(silent);
  assert.equal(quiet.sendJingle(18), quiet);
  assert.deepEqual(frames.map((f) => f[0]), [132], 'no known track: only the jingle');
});

test('PlayerSession remembers the track it started for the region, for the pre-jingle re-send', async t => {
  await setup();
  t.mock.method(Math, 'random', () => 0); // Lumbridge shuffles: pick its own track, first in the list.
  const trackId = api.core.Music.tracksAt(3222, 3218, 0)[0];
  const songs = [];
  const player = {
    getLocation: () => new Location(3222, 3218, 0),
    getArea: () => null,
    getAudioSettings: () => ({ 18: 0 }),
    getPacketSender: () => ({ sendSong: (id) => { songs.push(id); } }),
  };
  const session = new PlayerSession({ isOpen: true });
  session.setPlayer(player);
  session.lastGroundItemRegion = 12850;
  session.lastGroundItemLevel = 0;
  assert.equal(session.getCurrentMusicTrack(), -1, 'nothing before the first flush');
  const emit = PluginManager.emitCustomEvent;
  PluginManager.emitCustomEvent = () => {};
  try {
    try { session.flush(); } catch { /* the fake player stops the rest of flush; music ran first */ }
  } finally {
    PluginManager.emitCustomEvent = emit;
  }
  assert.deepEqual(songs, [trackId]);
  assert.equal(session.getCurrentMusicTrack(), trackId);
});

// Live (rsprox revs 236-239, 17 sessions with a mid-session music volume change): when the music
// volume varp rises from 0 the server sends track 147 (silence) with zero fades on that tick and the
// area track with zero fades on the next; dropping to 0 sends nothing.
test('raising the music volume from 0 re-sends silence, then the area track, with zero fades', async () => {
  await setup();
  const changed = handlers.get('audio:setting-changed');
  assert.ok(changed && changed.length, 'the Music plugin listens for audio setting changes');
  const songs = [];
  const player = {
    getAudioSettings: () => ({ 18: 0, 168: 5 }),
    getSession: () => ({ getCurrentMusicTrack: () => 454 }),
    getPacketSender: () => ({ sendSong: (id, fades) => { songs.push([id, fades]); } }),
    isRegistered: () => true,
  };
  const tasks = [];
  const submit = api.core.TaskManager.submit;
  api.core.TaskManager.submit = (task) => { tasks.push(task); };
  try {
    for (const handler of changed) handler({ player, varpId: 168, previous: 0, value: 5 });
    assert.deepEqual(songs, [[147, { fadeOutDelay: 0, fadeOutSpeed: 0, fadeInDelay: 0, fadeInSpeed: 0 }]], 'silence now');
    assert.equal(tasks.length, 1, 'the track follows on the next tick');
    tasks[0].execute();
    assert.deepEqual(songs[1], [454, { fadeOutDelay: 0, fadeOutSpeed: 0, fadeInDelay: 0, fadeInSpeed: 0 }]);

    songs.length = 0; tasks.length = 0;
    for (const handler of changed) handler({ player, varpId: 168, previous: 5, value: 0 });
    for (const handler of changed) handler({ player, varpId: 168, previous: 5, value: 60 });
    for (const handler of changed) handler({ player, varpId: 169, previous: 0, value: 60 });
    assert.deepEqual(songs, [], 'only a rise of the music volume from 0 restarts anything');
    assert.deepEqual(tasks, []);

    const manual = { ...player, getAudioSettings: () => ({ 18: 1, 168: 5 }) };
    for (const handler of changed) handler({ player: manual, varpId: 168, previous: 0, value: 5 });
    assert.deepEqual(songs, [], 'manual music mode: nothing to restart');
    const silent = { ...player, getSession: () => ({ getCurrentMusicTrack: () => -1 }) };
    for (const handler of changed) handler({ player: silent, varpId: 168, previous: 0, value: 5 });
    assert.deepEqual(songs, [], 'no region track known: nothing to restart');
  } finally {
    api.core.TaskManager.submit = submit;
  }
});

test('a music volume varp from the client announces audio:setting-changed with the old and new value', () => {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const events = [];
  const emit = PluginManager.emitCustomEvent;
  PluginManager.emitCustomEvent = (name, payload) => { if (name === 'audio:setting-changed') events.push(payload); };
  try {
    const player = new Player(null);
    assert.equal(player.getAudioSettings()[168], 100);
    assert.equal(player.applyAudioSettingFromClient(168, 0), true);
    assert.equal(player.applyAudioSettingFromClient(168, 0), true, 'the same value again');
    assert.equal(player.applyAudioSettingFromClient(168, 5), true);
    assert.equal(player.applyAudioSettingFromClient(4242, 5), false, 'not an audio varp');
    assert.deepEqual(events.map((e) => [e.varpId, e.previous, e.value]), [[168, 100, 0], [168, 0, 5]], 'only changes are announced');
    assert.equal(events[0].player, player);
  } finally {
    PluginManager.emitCustomEvent = emit;
  }
});

// Review on #1077: the next-tick restart must not send a track that is no longer current. Raise the
// volume from 0 with track 454 current, change the region track to 999 before the queued tick runs:
// the session already sent 999, so the restart must not put 454 back. The same goes for a music
// volume dropped to 0 again, manual mode, and a second rise that queued its own restart.
test('the next-tick restart is dropped when the track, mode or volume changed in between', async () => {
  await setup();
  const [changed] = handlers.get('audio:setting-changed');
  let current = 454;
  let settings = { 18: 0, 168: 5 };
  const songs = [];
  const player = {
    getAudioSettings: () => settings,
    getSession: () => ({ getCurrentMusicTrack: () => current }),
    getPacketSender: () => ({ sendSong: (id) => { songs.push(id); } }),
    isRegistered: () => true,
  };
  const tasks = [];
  const submit = api.core.TaskManager.submit;
  api.core.TaskManager.submit = (task) => { tasks.push(task); };
  const rise = () => changed({ player, varpId: 168, previous: 0, value: settings[168] });
  try {
    rise();
    current = 999; // region change before the next tick; the session sent 999 itself
    tasks.shift().execute();
    assert.deepEqual(songs, [147], 'the old track is not replayed over the new one');

    songs.length = 0; current = 454;
    rise();
    settings = { 18: 0, 168: 0 };
    tasks.shift().execute();
    assert.deepEqual(songs, [147], 'volume back at 0: nothing more');

    songs.length = 0; settings = { 18: 0, 168: 5 };
    rise();
    settings = { 18: 1, 168: 5 };
    tasks.shift().execute();
    assert.deepEqual(songs, [147], 'manual music mode: nothing more');

    songs.length = 0; settings = { 18: 0, 168: 5 };
    rise();
    rise();
    tasks.shift().execute();
    tasks.shift().execute();
    assert.deepEqual(songs, [147, 147, 454], 'two rises in one tick restart the track once');
  } finally {
    api.core.TaskManager.submit = submit;
  }
});

function tracksNamed(name) {
  return Object.keys(trackNames).map(Number).filter((id) => trackNames[id] === name);
}

function questHintTracks(questName) {
  return QuestUnlocks.entriesForQuest(catalog.questUnlocks.entries, questName)
    .filter(({ requires }) => (requires.all ?? requires.any).length === 1)
    .map(({ trackId }) => catalog.canonicalTrackBySlot[catalog.slotByTrackId[trackId].key]);
}

test('quest unlock hints parse into the quests they need', () => {
  assert.deepEqual(QuestUnlocks.parseQuestHint('during the Dragon Slayer II quest.'), { all: ['Dragon Slayer II'] });
  assert.deepEqual(QuestUnlocks.parseQuestHint("during the General's Shadow miniquest."), { all: ["General's Shadow"] });
  assert.deepEqual(QuestUnlocks.parseQuestHint('after completing the While Guthix Sleeps and Dragon Slayer II quests.'),
    { all: ['While Guthix Sleeps', 'Dragon Slayer II'] });
  assert.deepEqual(QuestUnlocks.parseQuestHint('during The Heart of Darkness or Perilous Moons quest.'),
    { any: ['Heart of Darkness', 'Perilous Moons'] });
  assert.equal(QuestUnlocks.parseQuestHint('in Varrock.'), undefined);
  assert.equal(QuestUnlocks.parseQuestHint('while fighting the Alchemical Hydra.'), undefined);
  assert.equal(QuestUnlocks.parseQuestHint('during a Christmas event.'), undefined);
  // A hint's name may be the registered one, "<name> Quest" or the first of a numbered pair.
  assert.equal(QuestUnlocks.hintNamesQuest('Observatory', 'Observatory Quest'), true);
  assert.equal(QuestUnlocks.hintNamesQuest('Monkey Madness', 'Monkey Madness I'), true);
  assert.equal(QuestUnlocks.hintNamesQuest('Monkey Madness', 'Monkey Madness II'), false);
  assert.equal(QuestUnlocks.hintNamesQuest('Another Slice of H.A.M', 'Another Slice of H.A.M.'), true);
  assert.equal(QuestUnlocks.hintNamesQuest('Blood Moon Rises', 'The Blood Moon Rises'), true);
});

test('completing a quest unlocks the tracks whose cache hint names it, with the live message, once', async () => {
  await setup();
  completedQuests = new Set([QuestUnlocks.normaliseQuestName('Dragon Slayer II')]);
  const expected = [...new Set(questHintTracks('Dragon Slayer II'))].sort((a, b) => a - b);
  for (const name of ['Oncoming Foe', 'The Dragon Slayer', 'Lucid Dream']) {
    assert.ok(tracksNamed(name).some((id) => expected.includes(id)), `${name} is hinted by Dragon Slayer II`);
  }
  const player = makePlayer();
  const completed = { player, key: 'dragon_slayer_ii', quest: { key: 'dragon_slayer_ii', name: 'Dragon Slayer II' } };
  handlers.get('quest:completed')[0](completed);
  assert.deepEqual(player.attrs.get(Progress.UNLOCKED_TRACKS_ATTRIBUTE), expected);
  assert.equal(player.messages.length, expected.length);
  assert.ok(player.messages.includes('You have unlocked a new music track: <col=e00a19>Oncoming Foe'));
  handlers.get('quest:completed')[0](completed);
  assert.equal(player.messages.length, expected.length, 'an unlocked track is not announced again');
  completedQuests = new Set();
});

test('a hint that needs two quests waits for both, and an unknown quest never counts as complete', async () => {
  await setup();
  const [THE_KIN] = tracksNamed('The Kin');
  const kin = catalog.questUnlocks.entries.find(({ trackId }) => trackId === THE_KIN);
  assert.deepEqual(kin.requires, { all: ['While Guthix Sleeps', 'Dragon Slayer II'] });
  completedQuests = new Set([QuestUnlocks.normaliseQuestName('While Guthix Sleeps')]);
  const player = makePlayer();
  MusicPlugin._test.onQuestCompleted({ player, quest: { name: 'While Guthix Sleeps' } });
  const unlocked = () => player.attrs.get(Progress.UNLOCKED_TRACKS_ATTRIBUTE);
  assert.ok(unlocked().includes(tracksNamed('Temple Desecrated')[0]), 'its own tracks unlock');
  assert.ok(!unlocked().includes(THE_KIN), 'The Kin waits for Dragon Slayer II');
  completedQuests.add(QuestUnlocks.normaliseQuestName('Dragon Slayer II'));
  MusicPlugin._test.onQuestCompleted({ player, quest: { name: 'Dragon Slayer II' } });
  assert.ok(unlocked().includes(THE_KIN));

  // "or": either quest. Neither is registered here, so only the quest that just completed counts.
  const [LOST_TO_TIME] = tracksNamed('Lost to Time');
  const lost = catalog.questUnlocks.entries.find(({ trackId }) => trackId === LOST_TO_TIME);
  assert.deepEqual(lost.requires, { any: ['Heart of Darkness', 'Perilous Moons'] });
  const other = makePlayer();
  assert.equal(MusicPlugin._test.questComplete(other, 'Perilous Moons'), undefined);
  MusicPlugin._test.unlockQuestTracks(other, 'Perilous Moons');
  assert.ok(other.attrs.get(Progress.UNLOCKED_TRACKS_ATTRIBUTE).includes(LOST_TO_TIME));
  completedQuests = new Set();
});

test('a hinted name reaches the quest it is an alias of, and only that one', async () => {
  await setup();
  completedQuests = new Set(['observatory quest', 'monkey madness ii']);
  const player = makePlayer();
  MusicPlugin._test.onQuestCompleted({ player, quest: { name: 'Observatory Quest' } });
  assert.deepEqual(player.attrs.get(Progress.UNLOCKED_TRACKS_ATTRIBUTE), tracksNamed('Look to the Stars'));
  MusicPlugin._test.onQuestCompleted({ player, quest: { name: 'Monkey Madness II' } });
  const unlocked = player.attrs.get(Progress.UNLOCKED_TRACKS_ATTRIBUTE);
  assert.ok(unlocked.includes(tracksNamed('Monkey Badness')[0]), 'Monkey Madness II unlocks its own tracks');
  assert.ok(!unlocked.includes(tracksNamed('Showdown')[0]), '"Monkey Madness" hints mean the first quest, not the second');
  completedQuests = new Set();
});

test('login unlocks what completed quests should have, without announcing it', async () => {
  await setup();
  completedQuests = new Set([QuestUnlocks.normaliseQuestName('Dragon Slayer II')]);
  const expected = [...new Set(questHintTracks('Dragon Slayer II'))].sort((a, b) => a - b);
  const player = makePlayer();
  loginHandlers[0]({ player });
  assert.deepEqual(player.attrs.get(Progress.UNLOCKED_TRACKS_ATTRIBUTE).filter((id) => expected.includes(id)), expected);
  assert.deepEqual(player.messages, []);
  const slot = catalog.slotByTrackId[expected[0]];
  const sent = player.configs.find(([id]) => id === slot.varp);
  assert.ok(sent && (sent[1] & (1 << slot.bit)) !== 0, 'the restored varps carry the quest track');
  completedQuests = new Set();
});

test('every quest a cache hint names is a registered quest, or a known missing one', async () => {
  await setup();
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = path.join(__dirname, '..', 'plugins', 'quests', 'quests');
  const registered = new Set();
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.Quest.js'))) {
    const source = fs.readFileSync(path.join(dir, file), 'utf8');
    // registerQuest(api, { key, name, ... }) opens the def literal; its name is the first one in it.
    for (const match of source.matchAll(/registerQuest\(\w+,\s*\{[^]*?\bname:\s*"([^"]+)"/g)) registered.add(match[1]);
  }
  assert.ok(registered.size > 100, `found ${registered.size} quest definitions`);
  // Quests the server has not got yet; their tracks stay locked until it does.
  const knownMissing = ['A Night at the Theatre', 'Blood Moon Rises', 'Garden of Death', "General's Shadow",
    'Lair of Tarn Razorlor', 'Song of the Elves', 'While Guthix Sleeps',
    // Rev 242: The Writing's on the Wall (its track hint drops the "The").
    "Writing's on the Wall"];
  const unmatched = catalog.questUnlocks.questNames
    .filter((hint) => ![...registered].some((name) => QuestUnlocks.hintNamesQuest(hint, name)));
  assert.deepEqual(unmatched.filter((name) => !knownMissing.includes(name)), [],
    'a hint names a quest no definition is registered under: add an alias or the quest');
  const nowPresent = knownMissing.filter((name) => !unmatched.includes(name));
  if (nowPresent.length) console.log(`[music] quests once missing are now registered: ${nowPresent.join(', ')}`);
});

test('"during The Digsite quest." is The Dig Site: its completion and a later login both unlock Venture 2', async () => {
  await setup();
  const [VENTURE_2] = tracksNamed('Venture 2');
  const venture = catalog.questUnlocks.entries.find(({ trackId }) => trackId === VENTURE_2);
  assert.deepEqual(venture.requires, { all: ['Digsite'] });
  completedQuests = new Set([QuestUnlocks.normaliseQuestName('The Dig Site')]);
  const player = makePlayer();
  MusicPlugin._test.onQuestCompleted({ player, quest: { key: 'the_dig_site', name: 'The Dig Site' } });
  assert.ok(player.attrs.get(Progress.UNLOCKED_TRACKS_ATTRIBUTE).includes(VENTURE_2), 'on completion');
  const saved = makePlayer();
  loginHandlers[0]({ player: saved });
  assert.ok(saved.attrs.get(Progress.UNLOCKED_TRACKS_ATTRIBUTE).includes(VENTURE_2), 'at login, for a save from before');
  assert.deepEqual(saved.messages, []);
  completedQuests = new Set();
});

test('area music follows actual same-region movement, dynamic selection and manual mode without replaying', async t => {
  await setup();
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { AreaManager } = require('../dist/game/model/areas/AreaManager');
  const core = PluginManager.getCoreApi();
  core.RegionManager.init();
  MusicPlugin.register(PluginManager.createApi('Music'));
  const delivered = [];
  const session = new PlayerSession({ isOpen: () => true, send: frame => delivered.push(Buffer.from(frame)) });
  const player = new Player(session);
  session.setPlayer(player);
  player.setUsername('areamusic');
  t.mock.method(Math, 'random', () => 0); // Lumbridge shuffles: pick its own track, first in the list.
  assert.equal(core.World.getPlayers().add(player), true);
  player.setLocation(new Location(3222, 3218, 0));
  player.setNeedsPlacement(false);
  const regionTrack = core.Music.tracksAt(3222, 3218, 0)[0];
  const [first, second, third] = catalog.allTrackIds.filter(id => id !== regionTrack && !catalog.autoUnlockTrackIds.includes(id));
  let selected = first;
  class MusicArea extends core.Area { getMusicTrack() { return selected; } }
  const area = new MusicArea([new core.Boundary(3220, 3221, 3218, 3218, 0)]);
  PluginManager.createApi('MusicAreaTest').registerArea(area);
  t.after(() => {
    if (player.getArea()) player.getArea().leave(player, true);
    player.setArea(null);
    const index = AreaManager.areas.indexOf(area);
    if (index >= 0) AreaManager.areas.splice(index, 1);
    core.World.getPlayers().remove(player);
  });
  let tick = 0;
  const songIds = frames => frames.filter(frame => frame[0] === 133).map(frame => frame.readUInt16BE(frame.length - 10));
  async function flush() {
    session.flush(++tick);
    const frames = [...session.pendingPackets]; // Observe real native encoder output before its normal microtask delivery.
    await Promise.resolve();
    return songIds(frames);
  }
  function walkTo(x) {
    player.getMovementQueue().addSteps(new Location(x, 3218, 0));
    for (let step = 0; step < 8 && player.getLocation().getX() !== x; step++) {
      player.getMovementQueue().process();
      AreaManager.process(player);
    }
    assert.equal(player.getLocation().getX(), x, 'the actual movement queue reaches its destination');
  }
  assert.deepEqual(await flush(), [regionTrack]);
  walkTo(3221);
  assert.equal(player.getArea(), area);
  assert.deepEqual(await flush(), [first], 'entering an area inside the same map region changes the selected song');
  assert.equal(session.getCurrentMusicTrack(), first);
  assert.equal(Progress.isUnlocked(player, first), true);
  assert.deepEqual(await flush(), [], 'ordinary ticks must not restart the area song');
  player.getPacketSender().sendJingle(18);
  assert.deepEqual(songIds(session.pendingPackets), [first], 'the real jingle prelude resumes the area selection');
  await Promise.resolve();
  selected = second;
  assert.deepEqual(await flush(), [second], 'a live area policy change is observed without moving regions');
  player.setAudioSetting(18, 1);
  assert.deepEqual(await flush(), []);
  selected = third;
  assert.deepEqual(await flush(), [], 'manual mode must not start the new area song');
  assert.equal(Progress.isUnlocked(player, third), true, 'manual mode still unlocks the entered area track');
  assert.deepEqual(await flush(), []);
  player.setAudioSetting(18, 0);
  assert.deepEqual(await flush(), [third], 'automatic mode starts the current area selection');
  walkTo(3222);
  assert.equal(player.getArea(), null);
  assert.deepEqual(await flush(), [regionTrack], 'leaving the area restores the normal region song');
  assert.deepEqual(await flush(), []);
  assert.ok(delivered.length > 0, 'the real session delivers its encoded client packets');
});

test('native music Play selects the visible cache row, refuses locked tracks and survives a jingle', async t => {
  await setup();
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { ClientConnection } = require('../dist/net/NetworkBuilder');
  const core = PluginManager.getCoreApi();
  MusicPlugin.register(PluginManager.createApi('MusicSelectionTest'));
  const channel = { kind: 'test', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel);
  const player = new Player(session);
  session.setPlayer(player);
  player.setUsername('musicclick');
  t.mock.method(Math, 'random', () => 0); // Lumbridge shuffles: pick its own track, first in the list.
  assert.equal(core.World.getPlayers().add(player), true);
  player.setLocation(new Location(3222, 3218, 0));
  player.setNeedsPlacement(false);
  const connection = new ClientConnection(channel);
  connection.player = player;
  const events = [];
  const configs = new Map();
  const sender = player.getPacketSender();
  const sendConfig = sender.sendConfig.bind(sender);
  sender.sendConfig = (id, value) => { configs.set(id, value); return sendConfig(id, value); };
  PluginManager.createApi('MusicSelectionObserver').onCustomEvent('audio:play-song', event => {
    if (event.player === player) events.push(event.trackId);
  });
  t.after(() => core.World.getPlayers().remove(player));
  // music_list_setup uses db_find(music:hidden, false), BEFORE alphabetical sorting.
  const rows = core.CacheDefinitions.getDbTableRows(44).filter(row => row.int(9, 0) === 0);
  const row = rows.find(row => row.string(1) === 'Adventure');
  const track = core.Music.tracks().find(track => track.rowId === row.id);
  const click = async (slot, op = 1) => {
    await connection.dispatch([{ type: 'widget_action', widgetId: (239 << 16) | 11,
      groupId: 239, childId: 11, buttonNum: op, opId: op, slot, itemId: -1 }]);
    connection.processTurnPackets();
  };
  const songIds = () => session.pendingPackets.filter(frame => frame[0] === 133)
    .map(frame => frame.readUInt16BE(frame.length - 10));
  await click(rows.indexOf(row));
  assert.deepEqual(events, [], 'a locked row cannot play or satisfy a music clue');
  assert.equal(player.getAudioSettings()[18], 0, 'a refused selection does not change mode');
  core.RegionManager.init();
  Progress.unlock(player, track.id);
  await click(rows.indexOf(row));
  assert.deepEqual(events, [track.id], 'native Play reaches the actual playback event used by Cecilia');
  assert.equal(player.getAudioSettings()[18], 2, 'manual selection uses Single mode');
  assert.equal(configs.get(3883), row.id);
  assert.equal(session.getCurrentMusicTrack(), track.id);
  player.getPacketSender().sendJingle(18);
  assert.deepEqual(songIds(), [track.id], 'the jingle resumes the selected track, not the old area track');
  await Promise.resolve();
  session.flush(1);
  assert.deepEqual(songIds(), [], 'the next area update does not overwrite the manual selection');
  await click(-1);
  await click(rows.length);
  await click(0xffff);
  await click(rows.indexOf(row), 3);
  assert.deepEqual(events, [track.id], 'bad slots and playlist operations cannot play a track');
  const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
  const saved = PlayerSave.fromPlayer(player);
  const restoredSession = new PlayerSession(channel);
  const restored = new Player(restoredSession);
  restoredSession.setPlayer(restored);
  saved.applyToPlayer(restored);
  MusicPlugin._test.onMusicLogin({ player: restored });
  assert.equal(restored.getAudioSettings()[18], 2);
  assert.equal(restoredSession.getCurrentMusicTrack(), track.id, 'a fresh session resumes the saved Single selection');
  restored.setAttribute(Progress.UNLOCKED_TRACKS_ATTRIBUTE, []);
  MusicPlugin._test.onMusicLogin({ player: restored });
  assert.equal(restored.getAudioSettings()[18], 0, 'a no-longer-unlocked selection falls back to Area mode');
  player.applyAudioSettingFromClient(18, 0);
  session.flush(2);
  assert.equal(session.getCurrentMusicTrack(), core.Music.tracksAt(3222, 3218, 0)[0], 'Area mode still restores region music');
  // Live keeps Shuffle on Play (rsprox 236/03935 L24943 sets Shuffle; the Play at L25846 sends no musicplay change).
  player.applyAudioSettingFromClient(18, 1);
  const played = events.length;
  await click(rows.indexOf(row));
  assert.equal(player.getAudioSettings()[18], 1, 'Play in Shuffle mode keeps Shuffle');
  assert.deepEqual(events.slice(played), [track.id], 'and plays the clicked track');
});

test('an area track plays out, falls silent for two ticks, then another of the area starts', async t => {
  await setup();
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const core = PluginManager.getCoreApi();
  core.RegionManager.init();
  MusicPlugin.register(PluginManager.createApi('MusicShuffle'));
  const session = new PlayerSession({ isOpen: () => true, send: () => true });
  const player = new Player(session);
  session.setPlayer(player);
  player.setUsername('musicshuffle');
  assert.equal(core.World.getPlayers().add(player), true);
  t.after(() => core.World.getPlayers().remove(player));
  player.setLocation(new Location(1310, 10205, 0));
  player.setNeedsPlacement(false);
  const configs = [];
  const sender = player.getPacketSender();
  const sendConfig = sender.sendConfig.bind(sender);
  sender.sendConfig = (id, value) => { if (id === 3883) configs.push(value); return sendConfig(id, value); };
  let roll = 0;
  t.mock.method(Math, 'random', () => roll);
  const songs = async tick => {
    session.flush(tick);
    const frames = [...session.pendingPackets];
    await Promise.resolve();
    return frames.filter(frame => frame[0] === 133).map(frame => frame.readUInt16BE(frame.length - 10));
  };
  const [FIRST, SECOND, LAST] = core.Music.tracksAt(1310, 10205, 0);
  const firstLength = core.Music.lengthTicks(FIRST), lastLength = core.Music.lengthTicks(LAST);
  assert.deepEqual(await songs(100), [FIRST], 'entering the dungeon starts one of its tracks');
  assert.equal(Progress.isUnlocked(player, FIRST), true, 'and unlocks it');
  assert.equal(Progress.isUnlocked(player, SECOND) && Progress.isUnlocked(player, LAST), true, "with the rest of the area's tracks");
  player.setLocation(new Location(1240, 10150, 0));
  assert.deepEqual(await songs(101), [], 'another region of the same area keeps the track playing');
  assert.deepEqual(await songs(100 + firstLength), [], 'still playing at its cache length');
  configs.length = 0;
  assert.deepEqual(await songs(100 + firstLength + 1), [147], 'one tick later it ends in silence');
  assert.deepEqual(configs, [-1], 'with no current track');
  assert.deepEqual(await songs(100 + firstLength + 2), []);
  roll = 0.99;
  const next = 100 + firstLength + 3;
  assert.deepEqual(await songs(next), [LAST], 'two ticks later another of the area starts');
  assert.equal(Progress.isUnlocked(player, LAST), true, 'every track heard unlocks');
  roll = 0;
  assert.deepEqual(await songs(next + lastLength + 1), [147]);
  assert.deepEqual(await songs(next + lastLength + 3), [FIRST]);
  assert.notEqual(session.getCurrentMusicTrack(), SECOND);
});

test('a tile with no music area keeps the area the player came from, and its shuffle', async t => {
  await setup();
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const core = PluginManager.getCoreApi();
  core.RegionManager.init();
  const session = new PlayerSession({ isOpen: () => true, send: () => true });
  const player = new Player(session);
  session.setPlayer(player);
  player.setUsername('musicgap');
  assert.equal(core.World.getPlayers().add(player), true);
  t.after(() => core.World.getPlayers().remove(player));
  player.setLocation(new Location(1310, 10205, 0));
  player.setNeedsPlacement(false);
  t.mock.method(Math, 'random', () => 0);
  const songs = async tick => {
    session.flush(tick);
    const frames = [...session.pendingPackets];
    await Promise.resolve();
    return frames.filter(frame => frame[0] === 133).map(frame => frame.readUInt16BE(frame.length - 10));
  };
  const [FIRST, SECOND] = core.Music.tracksAt(1310, 10205, 0);
  const end = core.Music.lengthTicks(FIRST) + 1;
  assert.deepEqual(core.Music.tracksAt(1, 1, 0), [], 'a tile with no music area');
  assert.deepEqual(await songs(100), [FIRST]);
  player.setLocation(new Location(1, 1, 0));
  assert.deepEqual(await songs(101), [], 'the track plays on');
  player.setLocation(new Location(1310, 10205, 0));
  assert.deepEqual(await songs(102), [], 'and back in the area, nothing restarts');
  assert.deepEqual(await songs(100 + end), [147], 'it still ends on time');
  assert.deepEqual(await songs(100 + end + 2), [SECOND], 'and the area moves on to another track');
});

test('another song takes over from the area track, and the area track sent again starts its time anew', async t => {
  await setup();
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const core = PluginManager.getCoreApi();
  core.RegionManager.init();
  const session = new PlayerSession({ isOpen: () => true, send: () => true });
  const player = new Player(session);
  session.setPlayer(player);
  player.setUsername('musictakeover');
  assert.equal(core.World.getPlayers().add(player), true);
  t.after(() => core.World.getPlayers().remove(player));
  player.setLocation(new Location(1310, 10205, 0));
  player.setNeedsPlacement(false);
  t.mock.method(Math, 'random', () => 0);
  const songs = async tick => {
    session.flush(tick);
    const frames = [...session.pendingPackets];
    await Promise.resolve();
    return frames.filter(frame => frame[0] === 133).map(frame => frame.readUInt16BE(frame.length - 10));
  };
  const [FIRST, SECOND] = core.Music.tracksAt(1310, 10205, 0), BOSS = 549;
  const end = core.Music.lengthTicks(FIRST) + 1;
  assert.deepEqual(await songs(10), [FIRST]);
  player.getPacketSender().sendSong(BOSS);
  await Promise.resolve();
  assert.deepEqual(await songs(10 + end), [], "a plugin's song is not cut off when the area track's time is up");
  player.setLocation(new Location(3222, 3218, 0));
  assert.deepEqual(await songs(600), [core.Music.tracksAt(3222, 3218, 0)[0]], 'a new area takes the music back');
  player.setLocation(new Location(1310, 10205, 0));
  assert.deepEqual(await songs(700), [FIRST]);
  assert.deepEqual(await songs(800), []);
  player.getPacketSender().sendSong(FIRST);
  await Promise.resolve();
  assert.deepEqual(await songs(700 + end), [], 'the same track sent again (the volume restart) plays its full length from then');
  assert.deepEqual(await songs(800 + end), [147]);
  assert.equal(session.getCurrentMusicTrack(), -1, 'between tracks there is none for a jingle to resume');
  player.setLocation(new Location(1240, 10150, 0));
  assert.deepEqual(await songs(800 + end + 1), [], 'a step to another part of the same area waits out the gap');
  assert.deepEqual(await songs(800 + end + 2), [SECOND], 'then another of its tracks, never the one that ended');
});

test("the Champions' Guild basement plays Title Fight, and its arena Victory is Mine", async t => {
  await setup();
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const core = PluginManager.getCoreApi();
  core.RegionManager.init();
  MusicPlugin.register(PluginManager.createApi('MusicTileAreas'));
  const TITLE_FIGHT = 525, VICTORY_IS_MINE = 528;
  const session = new PlayerSession({ isOpen: () => true, send: () => true });
  const player = new Player(session);
  session.setPlayer(player);
  player.setUsername('musictileareas');
  assert.equal(core.World.getPlayers().add(player), true);
  t.after(() => core.World.getPlayers().remove(player));
  player.setLocation(new Location(3150, 9740, 0));
  player.setNeedsPlacement(false);
  t.mock.method(Math, 'random', () => 0.99);
  const songs = async tick => {
    session.flush(tick);
    const frames = [...session.pendingPackets];
    await Promise.resolve();
    return frames.filter(frame => frame[0] === 133).map(frame => frame.readUInt16BE(frame.length - 10));
  };
  assert.deepEqual(await songs(10), [TITLE_FIGHT]);
  assert.deepEqual(await songs(11), [], 'ordinary ticks keep it');
  player.setLocation(new Location(3151, 9741, 0));
  assert.deepEqual(await songs(12), [], 'a step inside the same area keeps it');
  const length = core.Music.lengthTicks(TITLE_FIGHT);
  assert.deepEqual(await songs(10 + length + 1), [147]);
  assert.deepEqual(await songs(10 + length + 3), [TITLE_FIGHT], 'a one-track area plays its track again');
  assert.equal(Progress.isUnlocked(player, VICTORY_IS_MINE), false);
  player.setLocation(new Location(3170, 9758, 0));
  assert.deepEqual(await songs(10 + length + 4), [VICTORY_IS_MINE], 'the arena, in the same map region, is another area');
  assert.equal(Progress.isUnlocked(player, TITLE_FIGHT), true);
  assert.equal(Progress.isUnlocked(player, VICTORY_IS_MINE), true);
});
