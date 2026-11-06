// Build first: node --test tests/seasonal-rares.test.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {test, before, after, beforeEach, afterEach} = require('node:test');
const {Server} = require('../dist/Server');
Server.installProductionPathResolver();
const {CachePipeline} = require('../dist/game/cache/CachePipeline');
const {PluginManager: PM} = require('../dist/plugins/PluginManager');
const {CommandPacketListener} = require('../dist/net/packet/impl/CommandPacketListener');
const {Player} = require('../dist/game/entity/impl/player/Player');
const {PlayerSession} = require('../dist/net/PlayerSession');
const {ClientConnection} = require('../dist/net/NetworkBuilder');
const Rares = require('../plugins/events/SeasonalRares.plugin.js');
const rows = require('../plugins/events/data/seasonal-rares.json');
const events = require('../plugins/world/data/events.json');
const customShops = require('../data/definitions/custom-shops.json');

const SANTA = 'christmas-santa-hat';
let core, dir, rareApi, saves, savedDirectory, next = 900;
const Json = require('../plugins/persistence/JsonPlayerPersistence.plugin');

before(async () => {
  // Every claim requests a player save: keep them out of data/saves/characters.
  saves = fs.mkdtempSync(path.join(os.tmpdir(), 'seasonal-rares-saves-'));
  savedDirectory = Json.JsonPlayerPersistence.SAVE_DIRECTORY;
  Json.JsonPlayerPersistence.SAVE_DIRECTORY = saves;
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PM.getCoreApi();
  require('../plugins/world/EventScheduler.plugin.js').register(PM.createApi('EventScheduler'));
  rareApi = PM.createApi('SeasonalRares');
  Rares.register(rareApi);
});
after(async () => {
  await new Promise(resolve => setTimeout(resolve, 200)); // let queued player saves land first
  Json.JsonPlayerPersistence.SAVE_DIRECTORY = savedDirectory;
  fs.rmSync(saves, {recursive: true, force: true});
});
beforeEach(() => {
  PM.emitServerShutdown({timestamp: Date.now()});
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seasonal-rares-'));
  Rares.testing.setStoreFile(path.join(dir, 'seasonal-rares.json'));
  PM.emitServerStartup({timestamp: Date.now()});
});
afterEach(() => {
  PM.emitServerShutdown({timestamp: Date.now()});
  fs.rmSync(dir, {recursive: true, force: true});
});

function actor(t, name = 'rareqa' + next) {
  const channel = {kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {}};
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);p.setUsername(name);p.setRegistered(true);
  p.setRights(core.PlayerRights.OWNER);
  const connection = new ClientConnection(channel);connection.player = p;
  const messages = [];
  t.mock.method(p.getPacketSender(), 'sendMessage', s => {messages.push(s);return p.getPacketSender();});
  return {p, connection, messages};
}
const command = (f, text) => CommandPacketListener.execute(f.p, text);
const options = f => core.MultiChatboxPrompt.getPending(f.p)?.options ?? [];
async function pick(f, text) {
  const index = options(f).findIndex(option => option.startsWith(text));
  assert.ok(index >= 0, `menu offers ${text}: ${options(f).join(' | ')}`);
  await f.connection.dispatch([{type: 'dialogue_continue', widgetId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: index + 1}]);
  f.connection.processTurnPackets();
}
/** Opens ::rares and walks "More..." until the row is on the page. */
async function claimByMenu(f, text) {
  command(f, 'rares');
  for (let page = 0; page < 10 && !options(f).some(option => option.startsWith(text)); page++) await pick(f, 'More...');
  await pick(f, text);
}
const held = (f, id) => f.p.getInventory().getAmount(id);
const santa = () => core.CacheDefinitions.getObjId('santa_hat');

test('every configured rare is a real, tradeable cache item owned by a scheduler event, with config-only quantities', () => {
  const eventKeys = new Set(events.map(event => event.key));
  const keys = new Set();
  for (const row of rows) {
    assert.equal(core.CacheDefinitions.getObjId(row.item), row.id, `${row.key}: cache symbol ${row.item}`);
    assert.equal(core.ItemDefinition.forId(row.id).isTradeable(), true, `${row.key} tradeable`);
    assert.ok(eventKeys.has(row.event), `${row.key}: ${row.event} is in events.json`);
    assert.ok(!keys.has(row.key));keys.add(row.key);
    assert.ok(Number.isSafeInteger(row.perAccount) && row.perAccount >= 1);
    assert.ok(row.stock === null || (Number.isSafeInteger(row.stock) && row.stock >= 1));
    assert.equal(typeof row.source, 'string');
    for (const field of Object.keys(row)) assert.ok(!/price|rate|chance|value/i.test(field), `${row.key} has no ${field}`);
  }
  const code = fs.readFileSync(require.resolve('../plugins/events/SeasonalRares.plugin.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /price|\brate\b|chance|random|getValue|GrandExchange/i, 'the plugin carries no price or rate');
});

test('outside every window ::rares offers nothing and a stale claim grants nothing', t => {
  const f = actor(t);
  command(f, 'forceevent christmas-2025 off');
  command(f, 'rares');
  assert.deepEqual(options(f), []);
  assert.ok(f.messages.includes('No seasonal rares are being given out to you right now.'));
  assert.equal(Rares.testing.claim(f.p, SANTA), false);
  assert.equal(held(f, santa()), 0);
});

test('the window opens by override with no code change, grants once, and closing it shuts the source', async t => {
  const f = actor(t);
  command(f, 'forceevent christmas-2025 on');
  command(f, 'rares');
  assert.ok(options(f).length <= 5 && options(f).includes('More...'), 'christmas rows page four at a time');
  assert.ok(options(f).every(option => !/mask|Pumpkin|Easter/.test(option)), 'other events stay closed');
  core.MultiChatboxPrompt.getPending(f.p) && f.p.getPacketSender().sendInterfaceRemoval();
  await claimByMenu(f, 'Santa hat');
  assert.equal(held(f, santa()), 1);
  assert.ok(f.messages.includes('You claim a Santa hat.'));
  command(f, 'rares');
  for (let page = 0; page < 3; page++) {
    assert.ok(!options(f).some(option => option.startsWith('Santa hat')), 'claimed rare is no longer offered');
    if (!options(f).includes('More...')) break;
    await pick(f, 'More...');
  }
  // A menu left open across the close is re-checked at the pick.
  f.p.getPacketSender().sendInterfaceRemoval();
  command(f, 'rares');
  const first = options(f)[0];
  command(f, 'forceevent christmas-2025 off');
  await pick(f, first.split(' (')[0]);
  assert.ok(f.messages.includes('That rare is not available to you right now.'));
  assert.equal(Rares.testing.claimable(f.p).length, 0);
});

test('a second window of the same event cannot give the rare again, even after a player-save rollback', t => {
  const f = actor(t, 'rarerollback');
  command(f, 'forceevent christmas-2025 on');
  assert.equal(Rares.testing.claim(f.p, SANTA), true);
  command(f, 'forceevent christmas-2025 off');
  command(f, 'forceevent christmas-2025 on');
  assert.equal(Rares.testing.claim(f.p, SANTA), false);
  // The account save lost the claim (crash before autosave): the world file still remembers the account.
  f.p.setAttribute(Rares.CLAIMS_ATTRIBUTE, {});
  assert.equal(Rares.testing.claim(f.p, SANTA), false);
  assert.equal(held(f, santa()), 1);
});

test('the claim survives the real player save codec and a server restart reloads the world record', t => {
  Json.register(PM.createApi('JsonPlayerPersistence'));
  Json.JsonPlayerPersistence.SAVE_DIRECTORY = saves;
  const {PlayerSave} = require('../dist/game/entity/impl/player/persistence/PlayerSave');
  const codec = new Json.JsonPlayerPersistence();
  const f = actor(t, 'raresave');
  command(f, 'forceevent christmas-2025 on');
  assert.equal(Rares.testing.claim(f.p, SANTA), true);
  const raw = JSON.stringify(PlayerSave.fromPlayer(f.p), codec.replacer.bind(codec));
  const g = actor(t, 'raresave');
  codec.hydratePlayerSave(JSON.parse(raw, codec.reviver.bind(codec))).applyToPlayer(g.p);
  assert.deepEqual(g.p.getAttribute(Rares.CLAIMS_ATTRIBUTE), {[SANTA]: 1});
  PM.emitServerShutdown({timestamp: Date.now()});
  PM.emitServerStartup({timestamp: Date.now()});
  command(g, 'forceevent christmas-2025 on');
  g.p.setAttribute(Rares.CLAIMS_ATTRIBUTE, {});
  assert.equal(Rares.testing.claim(g.p, SANTA), false, 'world file read back after restart');
});

test('stock caps the world total across accounts and perAccount allows exactly that many', t => {
  const config = rows.map(row => row.key === SANTA ? {...row, perAccount: 2, stock: 3} : row);
  Rares.testing.load(config);
  const a = actor(t), b = actor(t);
  command(a, 'forceevent christmas-2025 on');
  assert.equal(Rares.testing.claim(a.p, SANTA), true);
  assert.equal(Rares.testing.claim(a.p, SANTA), true);
  assert.equal(Rares.testing.claim(a.p, SANTA), false, 'perAccount 2');
  assert.equal(Rares.testing.claim(b.p, SANTA), true);
  assert.equal(Rares.testing.claim(b.p, SANTA), false, 'stock 3 used up');
  assert.equal(held(a, santa()) + held(b, santa()), 3);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'seasonal-rares.json'), 'utf8'));
  assert.equal(saved[SANTA].claimed, 3);
});

test('a full inventory refuses without using the claim; freeing a slot then works', t => {
  const f = actor(t);
  command(f, 'forceevent christmas-2025 on');
  for (let slot = 0; slot < 28; slot++) f.p.getInventory().setItem(slot, new core.Item(core.ItemIdentifiers.LOGS, 1));
  assert.equal(Rares.testing.claim(f.p, SANTA), false);
  assert.ok(f.messages.includes("You don't have enough inventory space to take that."));
  assert.equal(f.p.getAttribute(Rares.CLAIMS_ATTRIBUTE)?.[SANTA], undefined);
  assert.equal(fs.existsSync(path.join(dir, 'seasonal-rares.json')), false);
  f.p.getInventory().deleteAtSlot(0, 1);
  assert.equal(Rares.testing.claim(f.p, SANTA), true);
  assert.equal(held(f, santa()), 1);
});

test('rows that fail the cache or config checks are never served, and a disabled row is off', t => {
  const f = actor(t);
  const santaRow = rows.find(row => row.key === SANTA);
  Rares.testing.load([
    {...santaRow, key: 'wrong-id', id: santaRow.id + 1},
    {...santaRow, key: 'no-quantity', perAccount: 0},
    {...santaRow, key: 'untradeable', item: 'rainbow_partyhat', id: core.CacheDefinitions.getObjId('rainbow_partyhat')},
    {...santaRow, key: 'switched-off', enabled: false},
  ]);
  command(f, 'forceevent christmas-2025 on');
  assert.deepEqual(Rares.testing.claimable(f.p), []);
  for (const key of ['wrong-id', 'no-quantity', 'untradeable', 'switched-off']) assert.equal(Rares.testing.claim(f.p, key), false);
});

test('no shop stocks a configured rare; the Rares Shop keeps only the unconfigured rares', () => {
  const configured = new Set(rows.map(row => row.id));
  for (const shop of customShops) {
    assert.deepEqual(shop.originalStock.filter(entry => configured.has(entry.id)), [], `${shop.name} stocks no configured rare`);
  }
  const rares = customShops.find(shop => shop.id === 23);
  const C = core.CacheDefinitions;
  assert.deepEqual(rares.originalStock.map(entry => entry.id),
    ['black_partyhat', 'rainbow_partyhat', 'halloweenmask_black', 'discofreturning'].map(name => C.getObjId(name)));
  assert.equal(rares.icon, C.getObjId('black_partyhat'), 'the panel icon is an item the shop still sells');
});

test('claims are refused in an area, busy, or on a league character, and record nothing', t => {
  const f = actor(t);
  command(f, 'forceevent christmas-2025 on');
  t.mock.method(f.p, 'getArea', () => ({name: 'minigame'}));
  assert.equal(Rares.testing.claim(f.p, SANTA), false);
  command(f, 'rares');
  assert.deepEqual(options(f), []);
  assert.ok(f.messages.includes("You can't claim a seasonal rare right now."));
  f.p.getArea.mock.restore();
  f.p.setProfile('league');
  assert.equal(Rares.testing.claim(f.p, SANTA), false);
  assert.ok(f.messages.includes('Seasonal rares can only be claimed on your main character.'));
  assert.equal(held(f, santa()), 0);
  assert.equal(fs.existsSync(path.join(dir, 'seasonal-rares.json')), false);
  f.p.setProfile('main');
  assert.equal(Rares.testing.claim(f.p, SANTA), true);
});

test('an unreadable world file shuts claims and is left untouched', t => {
  const file = path.join(dir, 'seasonal-rares.json');
  fs.writeFileSync(file, '{not json');
  Rares.testing.load();
  const f = actor(t);
  command(f, 'forceevent christmas-2025 on');
  assert.deepEqual(Rares.testing.claimable(f.p), []);
  assert.equal(Rares.testing.claim(f.p, SANTA), false);
  assert.equal(fs.readFileSync(file, 'utf8'), '{not json');
});

test('every menu page has Cancel and at most five options', async t => {
  const f = actor(t);
  command(f, 'forceevent christmas-2025 on');
  command(f, 'rares');
  const seen = new Set();
  for (let page = 0; page < 4; page++) {
    assert.ok(options(f).length <= 5);
    assert.equal(options(f).at(-1), 'Cancel');
    for (const option of options(f)) seen.add(option.split(' (')[0]);
    await pick(f, 'More...');
  }
  for (const name of ['Red partyhat', 'White partyhat', 'Christmas cracker', 'Santa hat']) assert.ok(seen.has(name), name);
  await pick(f, 'Cancel');
  assert.equal(held(f, santa()), 0);
});

test('the real Rares Shop (custom-shops.json 23) opens without any configured rare in its stock', t => {
  const {ShopManager} = require('../dist/game/model/container/shop/ShopManager');
  new (require('../dist/game/definition/loader/impl/ShopDefinitionLoader').ShopDefinitionLoader)().load();
  ShopManager.initialize();
  const f = actor(t);
  assert.equal(ShopManager.open(f.p, 23), true);
  const listed = ShopManager.getOpenShop(f.p).stock.map(entry => entry.itemId);
  const configured = new Set(rows.map(row => row.id));
  assert.ok(listed.length > 0, 'the shop still has its other stock');
  assert.deepEqual(listed.filter(id => configured.has(id)), []);
  assert.ok(listed.includes(core.CacheDefinitions.getObjId('rainbow_partyhat')));
});

test('a world record that cannot be written gives nothing and records nothing', t => {
  const f = actor(t);
  command(f, 'forceevent christmas-2025 on');
  const blocker = path.join(dir, 'not-a-directory');
  fs.writeFileSync(blocker, 'x');
  Rares.testing.setStoreFile(path.join(blocker, 'seasonal-rares.json'));
  assert.equal(Rares.testing.claim(f.p, SANTA), false);
  assert.ok(f.messages.includes("That rare can't be claimed right now. Please try again later."));
  assert.equal(held(f, santa()), 0);
  assert.equal(f.p.getAttribute(Rares.CLAIMS_ATTRIBUTE)?.[SANTA], undefined);
  // The failed claim left no in-memory count behind: a writable file afterwards records exactly one.
  Rares.testing.setStoreFile(path.join(dir, 'seasonal-rares.json'));
  assert.equal(Rares.testing.claim(f.p, SANTA), true);
  assert.equal(held(f, santa()), 1);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'seasonal-rares.json'), 'utf8'));
  assert.deepEqual(saved[SANTA], {claimed: 1, by: {[f.p.getUsername().toLowerCase()]: 1}});
});

test('the claim message uses an before a vowel', t => {
  const f = actor(t);
  command(f, 'forceevent easter-2026 on');
  assert.equal(Rares.testing.claim(f.p, 'easter-egg'), true);
  assert.ok(f.messages.includes('You claim an Easter egg.'));
});
