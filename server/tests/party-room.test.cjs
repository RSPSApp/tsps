// Run after `yarn build`: node --test tests/party-room.test.cjs
// The Falador Party Room's chest through the real plugins, Player, Inventory and PlayerSave. Clicks,
// the lever, balloons and pickups arrive as client packets (ClientConnection.dispatch); a confirm
// waits for the player's save, then the chest file is written in one step, so a close, a logout, a
// take-back or a second confirm during the wait can't double or lose what was offered.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { before, after, beforeEach, test } = require('node:test');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'party-room-'));
const file = path.join(dir, 'party-room.json');
process.env.TSPS_PARTY_ROOM_DIR = dir;
process.env.PLAYER_SAVE_DATABASE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'party-room-saves-')), 'players.sqlite');
process.env.PLAYER_SAVE_IMPORT_LEGACY_JSON = '0';
process.env.DISABLE_PLAYER_BOTS = '1';
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { decodeClientPackets } = require('../dist/net/protocol/ClientProtocol');

let Room;
let Store;
let Knights;
try {
  Room = require('../plugins/minigames/partyroom/Room.PartyRoom');
  Store = require('../plugins/minigames/partyroom/Store.PartyRoom');
  Knights = require('../plugins/minigames/partyroom/Knights.PartyRoom');
} catch {
  // The tests below say so, one by one, rather than the file failing to load.
}

const ATTRIBUTE = 'partyroom:chest-offer';
const OP_ALL = 5;
const COINS = 995;
const WHIP = 4151;
const MAIN = 265;
const SIDE = 266;
const OFFER_LIST = 16;
const CONFIRM = 17;
const CHEST = [3054, 3376, 0];
const CLOSED_CHEST = 26193;
const OPEN_CHEST = 2418;
const LEVER = 26194;
const LEVER_TILE = [3054, 3378, 0]; // the map's own (party-room-map.test.cjs)
const BALLOON = 115;

let core;
let PlayerSave;
let next = 2800;
const persistence = {
  gate: null,
  saves: 0,
  requestSave() { this.saves++; },
  flush() { return this.gate ? this.gate.promise : Promise.resolve(); },
};
let originalPersistence;

function gate() {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  persistence.gate = { promise, resolve, reject };
  return persistence.gate;
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  core.RegionManager.init();
  ({ PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave'));
  originalPersistence = core.GameConstants.PLAYER_PERSISTENCE;
  core.GameConstants.PLAYER_PERSISTENCE = persistence;
});

after(() => {
  core.GameConstants.PLAYER_PERSISTENCE = originalPersistence;
  core.GameConstants.setWorldProfile('main');
  PM.emitServerShutdown({});
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  persistence.gate = null;
  persistence.saves = 0;
  if (!Room) return;
  core.GameConstants.setWorldProfile('main');
  Room.reset();
  for (const name of fs.readdirSync(dir)) if (name.startsWith('party-room')) fs.rmSync(path.join(dir, name), { force: true });
});

function present() {
  assert.ok(Room && Store, 'the Party Room plugin exists');
}

function newPlayer(name, at = new core.Location(3053, 3376, 0)) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername(name);
  player.setRegistered(true);
  player.setLocation(at);
  player.needsPlacement = false;
  const connection = new ClientConnection(channel);
  connection.player = player;
  player.testConnection = connection;
  return player;
}

/** A client packet, the way the network layer hands it over, then the ticks that walk and act on it. */
async function send(player, packet) {
  await player.testConnection.dispatch([packet]);
  player.testConnection.processTurnPackets();
  for (let i = 0; i < 12; i++) {
    core.TaskManager.processWalkTo(player.getIndex());
    player.getMovementQueue().process();
    core.TaskManager.process();
  }
  await tick();
}

const widget = (group, child, extra = {}) => ({ type: 'widget_action', widgetId: (group << 16) | child, groupId: group, childId: child, buttonNum: OP_ALL, slot: 0, ...extra });
const objectClick = (id, [x, y], clickType = 1) => ({ type: 'object_option', id, x, y, clickType });

/** A native RESUME_PAUSEBUTTON, with the choice and widget encoded on the wire. */
async function nativeChoice(player, choice, widgetId = (219 << 16) | 1) {
  const frame = Buffer.alloc(7);
  frame[0] = 62;
  frame[1] = choice >>> 8;
  frame[2] = (choice + 128) & 255;
  frame.writeInt32BE(widgetId, 3);
  const decoded = decodeClientPackets(frame);
  assert.equal(decoded[0].childIndex, choice);
  assert.equal(decoded[0].widgetId, widgetId);
  await player.testConnection.dispatch(decoded, true);
  player.testConnection.processTurnPackets();
  await tick();
}

/** The chest's loc, put where RSProx saw it if the map doesn't already have that one. */
function ensureObject(id, [x, y, z], face = 1) {
  const there = core.ObjectManager.objectsAt(new core.Location(x, y, z)).some((object) => object.getId() === id);
  if (!there) core.ObjectManager.register(new core.GameObject(id, new core.Location(x, y, z), 10, face, null), true);
}

function seed(chest, confirmed = {}) {
  fs.writeFileSync(file, JSON.stringify({ version: 1, chest, confirmed }));
  Room.reset();
}

function chestFile() {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

const screen = () => Room.screenOf();
const screenOpen = (player) => player.getPacketSender().isSubInterfaceOpen(MAIN);
const confirmClick = (player) => send(player, widget(MAIN, CONFIRM));
const offerOf = (player) => PlayerSave.fromPlayer(player).attributes?.[ATTRIBUTE];
const offerSlot = (player, id) => send(player, widget(SIDE, 0, { slot: player.getInventory().getSlotForItemId(id) }));

/** A player who opened the chest with the object click and offered all of `id`, all by packet. */
async function offering(name, id = COINS, amount = 100) {
  const player = newPlayer(name);
  player.getInventory().adds(id, amount);
  await send(player, objectClick(CLOSED_CHEST, CHEST));
  assert.equal(screenOpen(player), true, 'the click on the chest opened the screen');
  await offerSlot(player, id);
  assert.equal(player.getInventory().getAmount(id), 0, 'offered, so out of the inventory');
  return player;
}

test('Open on the shut chest and Deposit on the open one both reach the screen, by object packet', async () => {
  present();
  const first = newPlayer('opener');
  await send(first, objectClick(CLOSED_CHEST, CHEST));
  assert.equal(screenOpen(first), true, 'Open (op 1 of 26193)');
  const open = core.ObjectDefinition.forPlayer(OPEN_CHEST, { getPacketSender: () => ({ getVarbit: () => 0 }) });
  const deposit = open.getInteractions().indexOf('Deposit') + 1;
  assert.ok(deposit > 0, 'the cache gives the open chest a Deposit option');
  ensureObject(OPEN_CHEST, [3054, 3379, 0], 1);
  const second = newPlayer('depositor2', new core.Location(3053, 3379, 0));
  await send(second, objectClick(OPEN_CHEST, [3054, 3379], deposit));
  assert.equal(screenOpen(second), true, 'Deposit (op 2 of 2418)');
  screen().playerGone(first);
  screen().playerGone(second);
});

test('a confirmed offer is in the chest file, and out of the offer', async () => {
  present();
  const player = await offering('depositor');
  await confirmClick(player);
  assert.deepEqual(chestFile().chest, [{ id: COINS, amount: 100 }]);
  assert.equal(player.getInventory().getAmount(COINS), 0);
  assert.equal(offerOf(player), undefined, 'nothing left in the player save');
  assert.ok(persistence.saves >= 1, 'a save was asked for');
  screen().playerGone(player);
});

test('nothing reaches the chest before the save has been flushed', async () => {
  present();
  const flush = gate();
  const player = await offering('waiter');
  await confirmClick(player);
  assert.equal(chestFile(), null, 'the chest file is not written while the flush waits');
  const waiting = offerOf(player);
  assert.equal(waiting.items[0].amount, 100, 'the save holds the offer');
  assert.ok(waiting.id, 'and the id the chest will record');
  flush.resolve();
  await tick();
  assert.deepEqual(chestFile().chest, [{ id: COINS, amount: 100 }]);
  screen().playerGone(player);
});

test('closing the screen during the flush gives the items back once, and the chest gets nothing', async () => {
  present();
  const flush = gate();
  const player = await offering('closer');
  await confirmClick(player);
  PM.emitCustomEvent('interface:closed', { player, interfaceId: MAIN });
  assert.equal(player.getInventory().getAmount(COINS), 0, 'still waiting, not handed back yet');
  flush.resolve();
  await tick();
  assert.equal(chestFile(), null, 'the chest got nothing');
  assert.equal(player.getInventory().getAmount(COINS), 100, 'back in the inventory exactly once');
  assert.equal(offerOf(player), undefined);
});

test('logging out during the flush leaves the items in the save for the next login', async () => {
  present();
  const flush = gate();
  const player = await offering('leaver');
  await confirmClick(player);
  PM.emitPlayerLogout({ player, username: player.getUsername() });
  const saved = PlayerSave.fromPlayer(player);
  flush.resolve();
  await tick();
  assert.equal(chestFile(), null, 'the chest got nothing');
  assert.equal(player.getInventory().getAmount(COINS), 0, 'not returned to a player who is gone');
  const restarted = newPlayer('leaver');
  saved.applyToPlayer(restarted);
  PM.emitCustomEvent('player:bootstrap-complete', { player: restarted });
  assert.equal(restarted.getInventory().getAmount(COINS), 100, 'the next login returns it');
});

test('during the flush an offer, a take-back and a reopen change nothing', async () => {
  present();
  const flush = gate();
  const player = await offering('pending');
  player.getInventory().adds(WHIP, 1);
  await confirmClick(player);
  await send(player, widget(MAIN, OFFER_LIST, { slot: 0 }));
  assert.equal(player.getInventory().getAmount(COINS), 0, 'take-back refused');
  await offerSlot(player, WHIP);
  assert.equal(player.getInventory().getAmount(WHIP), 1, 'a new offer refused');
  screen().open(player, {});
  assert.equal(offerOf(player).items[0].amount, 100, 'the reopen did not replace the saved offer');
  flush.resolve();
  await tick();
  assert.deepEqual(chestFile().chest, [{ id: COINS, amount: 100 }]);
  screen().playerGone(player);
});

test('a flush that fails moves nothing, and an open screen keeps the offer', async () => {
  present();
  const flush = gate();
  const player = await offering('failing');
  await confirmClick(player);
  flush.reject(new Error('disk'));
  await tick();
  assert.equal(chestFile(), null);
  assert.equal(offerOf(player).items[0].amount, 100, 'still offered');
  await send(player, widget(MAIN, OFFER_LIST, { slot: 0 }));
  assert.equal(player.getInventory().getAmount(COINS), 100, 'and can be taken back: pending was cleared');
  screen().playerGone(player);
});

test('a flush that fails after the screen was closed gives the items back and saves', async () => {
  present();
  const flush = gate();
  const player = await offering('closedfail');
  await confirmClick(player);
  PM.emitCustomEvent('interface:closed', { player, interfaceId: MAIN });
  flush.reject(new Error('disk'));
  await tick();
  assert.equal(chestFile(), null);
  assert.equal(player.getInventory().getAmount(COINS), 100);
  assert.equal(offerOf(player), undefined, 'nothing stranded in the save');
  assert.ok(persistence.saves >= 2, 'and that was saved');
});

test('a throw during a confirm does not leave the offer pending', async () => {
  present();
  seed([{ id: WHIP, amount: 1 }]);
  const player = await offering('thrower');
  const real = Store.deposit;
  Store.deposit = () => { throw new Error('boom'); };
  const log = console.error;
  console.error = () => {};
  try {
    await confirmClick(player);
  } finally {
    Store.deposit = real;
    console.error = log;
  }
  await send(player, widget(MAIN, OFFER_LIST, { slot: 0 }));
  assert.equal(player.getInventory().getAmount(COINS), 100, 'not pending: the offer can be taken back');
  screen().playerGone(player);
});

test('two confirms for the last room: one is taken, the other refused and kept', async () => {
  present();
  seed([{ id: WHIP, amount: 215 }]);
  const flush = gate();
  const first = await offering('first', WHIP, 1);
  const second = await offering('second', WHIP, 1);
  await confirmClick(first);
  await confirmClick(second);
  flush.resolve();
  await tick();
  assert.equal(Store.used(), 216);
  const left = [first, second].filter((player) => offerOf(player)?.items?.[0]?.amount === 1);
  assert.equal(left.length, 1, 'exactly one offer is still waiting, the other is in the chest');
  assert.equal(chestFile().chest[0].amount, 216);
  for (const player of [first, second]) screen().playerGone(player);
});

test('a fast relog during the flush: the old session cannot touch the new one', async () => {
  present();
  const flush = gate();
  const old = await offering('relog');
  await confirmClick(old);
  PM.emitPlayerLogout({ player: old, username: old.getUsername() });
  const saved = PlayerSave.fromPlayer(old);
  const fresh = newPlayer('relog');
  saved.applyToPlayer(fresh);
  fresh.getInventory().adds(WHIP, 1);
  await send(fresh, objectClick(CLOSED_CHEST, CHEST));
  await offerSlot(fresh, WHIP);
  flush.resolve();
  await tick();
  assert.equal(chestFile(), null, 'the old continuation put nothing in the chest');
  assert.equal(offerOf(fresh).items[0].id, WHIP, 'the new session still has its own offer');
  assert.equal(fresh.getInventory().getAmount(WHIP), 0);
  screen().playerGone(fresh);
});

test('crash states: the save and the chest file decide, never both', async () => {
  present();
  const make = async (name) => offering(name, COINS, 50);
  // The save holds the offer and the chest never took it: the items come back.
  const lost = await make('crash1');
  const savedLost = PlayerSave.fromPlayer(lost);
  const returned = newPlayer('crash1');
  savedLost.applyToPlayer(returned);
  PM.emitCustomEvent('player:bootstrap-complete', { player: returned });
  assert.equal(returned.getInventory().getAmount(COINS), 50);
  assert.equal(chestFile(), null);

  // The chest took it and the save never learned: the offer is dropped, the items are in the chest only,
  // and the chest's record stays until the cleared save is on the disk.
  const done = await make('crash2');
  const id = 'fixed-id';
  const savedDone = PlayerSave.fromPlayer(done);
  savedDone.attributes[ATTRIBUTE].id = id;
  seed([{ id: COINS, amount: 50 }], { crash2: id });
  const restarted = newPlayer('crash2');
  savedDone.applyToPlayer(restarted);
  const flush = gate();
  PM.emitCustomEvent('player:bootstrap-complete', { player: restarted });
  assert.equal(restarted.getInventory().getAmount(COINS), 0, 'not given twice');
  assert.equal(restarted.getAttribute(ATTRIBUTE) ?? null, null, 'cleared in the player');
  assert.equal(chestFile().confirmed.crash2, id, 'the record stays while the cleared save is not on the disk');
  flush.resolve();
  await tick();
  assert.deepEqual(chestFile().chest, [{ id: COINS, amount: 50 }]);
  assert.equal(chestFile().confirmed.crash2, undefined, 'and goes once it is');
  for (const player of [lost, done]) screen().playerGone(player);
});

test('an unreadable chest file is kept, refuses changes, and holds saved offers', async () => {
  present();
  fs.writeFileSync(file, '{ not json');
  Room.reset();
  assert.equal(Store.available(), false);
  const player = newPlayer('corrupt');
  player.getInventory().adds(COINS, 10);
  await send(player, objectClick(CLOSED_CHEST, CHEST));
  assert.equal(screenOpen(player), false, 'deposits are refused');
  assert.equal(fs.readFileSync(file, 'utf8'), '{ not json', 'the file was not overwritten');
  assert.ok(fs.readdirSync(dir).some((name) => name.startsWith('party-room.json.corrupt-')), 'a copy was kept');
  const holder = newPlayer('holder');
  holder.setAttribute(ATTRIBUTE, { id: 'x', items: [{ id: COINS, amount: 7 }] });
  PM.emitCustomEvent('player:bootstrap-complete', { player: holder });
  assert.equal(holder.getInventory().getAmount(COINS), 0, 'not returned while the chest is unreadable');
  assert.deepEqual(holder.getAttribute(ATTRIBUTE).items, [{ id: COINS, amount: 7 }], 'and not dropped');
  screen().playerGone(player);
});

test('a held offer is settled before a chest that reads again can write over it', async () => {
  present();
  fs.writeFileSync(file, '{ not json');
  Room.reset();
  const holder = newPlayer('holder2');
  holder.setAttribute(ATTRIBUTE, { id: 'x', items: [{ id: COINS, amount: 7 }] });
  PM.emitCustomEvent('player:bootstrap-complete', { player: holder });
  assert.deepEqual(holder.getAttribute(ATTRIBUTE).items, [{ id: COINS, amount: 7 }], 'held at login');
  await send(holder, objectClick(CLOSED_CHEST, CHEST));
  assert.equal(screenOpen(holder), false, 'still unreadable: refused, and still held');
  assert.deepEqual(holder.getAttribute(ATTRIBUTE).items, [{ id: COINS, amount: 7 }]);
  fs.writeFileSync(file, JSON.stringify({ version: 1, chest: [], confirmed: {} }));
  await send(holder, objectClick(CLOSED_CHEST, CHEST));
  assert.equal(holder.getInventory().getAmount(COINS), 7, 'settled on opening: returned once');
  assert.equal(screenOpen(holder), true);
  PM.emitCustomEvent('interface:closed', { player: holder, interfaceId: MAIN });
  assert.equal(holder.getInventory().getAmount(COINS), 7, 'and closing writes nothing over it');
  assert.equal(PlayerSave.fromPlayer(holder).attributes?.[ATTRIBUTE], undefined);
});

test('the chest survives a restart', async () => {
  present();
  const player = await offering('keeper', WHIP, 3);
  await confirmClick(player);
  Room.reset();
  assert.deepEqual(Store.chest(), [{ id: WHIP, amount: 3 }]);
  screen().playerGone(player);
});

test('a league world keeps its own chest file, chosen when first used', async () => {
  present();
  core.GameConstants.setWorldProfile('league');
  Room.reset();
  const player = await offering('leaguechest', WHIP, 1);
  await confirmClick(player);
  assert.equal(fs.existsSync(path.join(dir, 'party-room.league.json')), true, 'the league file');
  assert.equal(fs.existsSync(file), false, 'and not the main one');
  screen().playerGone(player);
});

test('216 counts individual items: a stackable is one, anything else each', () => {
  present();
  seed([{ id: COINS, amount: 1000000 }, { id: WHIP, amount: 214 }]);
  assert.equal(Store.used(), 215);
  assert.equal(Store.deposit('someone', 'a', [{ id: WHIP, amount: 2 }]).ok, false, 'one too many');
  assert.equal(Store.deposit('someone', 'b', [{ id: COINS, amount: 5 }]).ok, true, 'more of a stack is free');
  assert.equal(Store.deposit('someone', 'c', [{ id: WHIP, amount: 1 }]).ok, true, 'the 216th');
  assert.equal(Store.used(), 216);
});

test('a pop takes one of a non-stackable and 1 to all of a stackable, uniformly by item', () => {
  present();
  seed([{ id: WHIP, amount: 3 }, { id: COINS, amount: 100 }]);
  assert.equal(Store.used(), 4, 'three whips and one coin stack');
  assert.deepEqual(Store.take(() => 0), { id: WHIP, amount: 1 });
  assert.deepEqual(Store.chest(), [{ id: WHIP, amount: 2 }, { id: COINS, amount: 100 }], 'one left the entry, not all');
  const randoms = [0.99, 0.5];
  assert.deepEqual(Store.take(() => randoms.shift()), { id: COINS, amount: 51 });
  assert.equal(Store.chest()[1].amount, 49);
  seed([{ id: COINS, amount: 100 }]);
  assert.deepEqual(Store.take(() => 0.9999), { id: COINS, amount: 100 }, 'the whole stack at the top');
  assert.deepEqual(Store.chest(), []);
});

const BALLOON_TILE = [3050, 3375, 0];
const dropAt = (id) => core.ItemOnGroundManager.getGroundItem(null, id, new core.Location(...BALLOON_TILE), null);
const pickUp = (player, id) => send(player, { type: 'ground_item_action', itemId: id, x: BALLOON_TILE[0], y: BALLOON_TILE[1], option: 'Take' });

async function pop(t, popper) {
  for (let old = dropAt(WHIP); old; old = dropAt(WHIP)) core.ItemOnGroundManager.deregister(old);
  t.mock.method(Math, 'random', () => 0);
  Room.placeBalloon('3050,3375', new core.Location(...BALLOON_TILE), 0);
  await send(popper, objectClick(BALLOON, BALLOON_TILE));
}

test('a balloon popped by packet pays once; a second player and an expired balloon get nothing', async (t) => {
  present();
  seed([{ id: WHIP, amount: 216 }]);
  const popper = newPlayer('popper', new core.Location(3049, 3375, 0));
  const other = newPlayer('other', new core.Location(3051, 3375, 0));
  await pop(t, popper);
  assert.equal(Store.chest()[0].amount, 215, 'one whip left the chest');
  assert.ok(dropAt(WHIP), 'and lies on the balloon\'s tile');
  await send(other, objectClick(BALLOON, BALLOON_TILE));
  assert.equal(Store.chest()[0].amount, 215, 'nothing there for the second');
  Room.placeBalloon('3050,3375', new core.Location(...BALLOON_TILE), 0);
  Room.expireBalloon('3050,3375');
  await send(popper, objectClick(BALLOON, BALLOON_TILE));
  assert.equal(Store.chest()[0].amount, 215, 'an expired balloon leaves its item in the chest');
});

test('the drop is the popper\'s: a third party takes it, an Ironman is turned away', async (t) => {
  present();
  seed([{ id: WHIP, amount: 216 }, { id: COINS, amount: 5 }]);
  const popper = newPlayer('popper2', new core.Location(3049, 3375, 0));
  await pop(t, popper);
  const drop = dropAt(WHIP);
  assert.ok(drop, 'a drop');
  assert.equal(drop.getOwner(), 'popper2', 'owned by who popped');
  const iron = newPlayer('ironpicker', new core.Location(3051, 3375, 0));
  iron.setAttribute('ironman:mode', 'ironman');
  await pickUp(iron, WHIP);
  assert.equal(iron.getInventory().getAmount(WHIP), 0, 'an Ironman cannot take it');
  assert.ok(dropAt(WHIP), 'it is still there');
  const third = newPlayer('third', new core.Location(3051, 3376, 0));
  await pickUp(third, WHIP);
  assert.equal(third.getInventory().getAmount(WHIP), 1, 'another player can');
});

test('an Ironman pops a balloon for nothing and cannot donate', async (t) => {
  present();
  seed([{ id: WHIP, amount: 216 }]);
  const ironman = newPlayer('iron', new core.Location(3049, 3375, 0));
  ironman.setAttribute('ironman:mode', 'ironman');
  await pop(t, ironman);
  assert.equal(Store.chest()[0].amount, 216, 'nothing taken');
  assert.equal(dropAt(WHIP), null, 'and nothing dropped');
  await send(ironman, objectClick(CLOSED_CHEST, CHEST));
  assert.equal(screenOpen(ironman), false, 'no donating');
});

test('the lever, by packet: 1,000 coins, balloons the chest can be walked to, one drop at a time', async () => {
  present();
  seed([{ id: WHIP, amount: 5 }]);
  const tile = LEVER_TILE;
  const puller = newPlayer('puller', new core.Location(3054, 3377, 0));
  await send(puller, objectClick(LEVER, tile));
  assert.deepEqual(core.MultiChatboxPrompt.getPending(puller).options, [
    'Balloon Bonanza (1,000 coins)', 'Nightly Dance (500 coins)', 'No action',
  ]);
  await nativeChoice(puller, 1);
  assert.equal(Room.balloonCount(), 0, 'no coins, no balloons');
  puller.getInventory().adds(COINS, 1500);
  await send(puller, objectClick(LEVER, tile));
  assert.equal(puller.getInventory().getAmount(COINS), 1500, 'opening the menu costs nothing');
  await nativeChoice(puller, 1);
  assert.equal(puller.getInventory().getAmount(COINS), 500, '1,000 coins taken');
  assert.ok(Room.balloonCount() > 0, 'balloons released');
  assert.ok(Room.balloonCount() <= 200);
  const reachable = new Set(Room.landingTiles().map(([x, y]) => `${x},${y}`));
  assert.ok(reachable.size > 0, 'the chest has somewhere to stand');
  for (const key of Room.balloonKeys()) assert.ok(reachable.has(key), `balloon ${key} can be walked to from the chest`);
  await send(puller, objectClick(LEVER, tile));
  await nativeChoice(puller, 1);
  assert.equal(puller.getInventory().getAmount(COINS), 500, 'a second pull during the drop costs nothing');
});

test('cancelling the lever menu never charges or changes the chest', async () => {
  present();
  seed([{ id: WHIP, amount: 5 }]);
  const puller = newPlayer('menuuser', new core.Location(3054, 3377, 0));
  puller.getInventory().adds(COINS, 1500);
  for (const choice of [3]) {
    await send(puller, objectClick(LEVER, LEVER_TILE));
    await nativeChoice(puller, choice);
    assert.equal(puller.getInventory().getAmount(COINS), 1500);
    assert.equal(Room.balloonCount(), 0);
    assert.deepEqual(Store.chest(), [{ id: WHIP, amount: 5 }]);
  }
});

test('the knight choice charges only for one shared performance, even with an empty chest', async () => {
  present();
  const first = newPlayer('knightfirst', new core.Location(3054, 3377, 0));
  const second = newPlayer('knightsecond', new core.Location(3054, 3377, 0));
  first.getInventory().adds(COINS, 499);
  await send(first, objectClick(LEVER, LEVER_TILE));
  await nativeChoice(first, 2);
  assert.equal(first.getInventory().getAmount(COINS), 499);
  assert.equal(Knights.performance(), null);
  first.getInventory().adds(COINS, 1);
  await send(first, objectClick(LEVER, LEVER_TILE));
  await nativeChoice(first, 2);
  const show = Knights.performance();
  assert.ok(show, 'the performance started');
  assert.equal(first.getInventory().getAmount(COINS), 0);
  assert.equal(show.knights.length, 6);
  for (const npc of show.knights) {
    assert.equal(npc.getId(), 5793);
    assert.equal(npc.isRegistered(), true);
    assert.ok(npc.getOwner() == null, 'each knight is world-shared');
  }
  const sung = [];
  show.knights[2].forceChat = (text) => sung.push(text);
  PM.emitPlayerLogout({ player: first, username: first.getUsername() });
  first.setRegistered(false); // The purchaser leaving must not end a world-shared performance.
  second.getInventory().adds(COINS, 500);
  await send(second, objectClick(LEVER, LEVER_TILE));
  await nativeChoice(second, 2);
  assert.equal(second.getInventory().getAmount(COINS), 500, 'already dancing costs nothing');
  assert.equal(Knights.performance(), show);
  for (let i = 0; i < 50; i++) core.TaskManager.process();
  assert.equal(sung.length, 8, 'the generated knight song was played');
  assert.equal(sung[0], "We're Knights of the Party Room");
  assert.equal(Knights.performance(), null);
  assert.ok(show.knights.every((npc) => !npc.isRegistered()), 'the knights all leave');
  assert.deepEqual(Store.chest(), [], 'the dance does not require or change the chest');
});

test('a partial NPC registration failure returns every slot and does not charge', async (t) => {
  present();
  const player = newPlayer('knightcapacity', new core.Location(3054, 3377, 0));
  player.getInventory().adds(COINS, 500);
  const list = core.World.getNpcs();
  const originalAdd = list.add.bind(list);
  const before = list.sizeReturn();
  let calls = 0;
  t.mock.method(list, 'add', (npc) => ++calls === 3 ? false : originalAdd(npc));
  await send(player, objectClick(LEVER, LEVER_TILE));
  await nativeChoice(player, 2);
  assert.equal(calls, 3);
  assert.equal(list.sizeReturn(), before);
  assert.equal(player.getInventory().getAmount(COINS), 500);
  assert.equal(Knights.performance(), null);
});

test('an unavailable song cannot take payment or leave knights behind', async (t) => {
  present();
  const player = newPlayer('knightsongmissing', new core.Location(3054, 3377, 0));
  player.getInventory().adds(COINS, 500);
  const emit = PM.emitCustomEvent;
  t.mock.method(PM, 'emitCustomEvent', (name, ...args) =>
    name === 'npc-dialogue:start' ? undefined : emit.call(PM, name, ...args));
  const before = core.World.getNpcs().sizeReturn();
  await send(player, objectClick(LEVER, LEVER_TILE));
  await nativeChoice(player, 2);
  assert.equal(player.getInventory().getAmount(COINS), 500);
  assert.equal(core.World.getNpcs().sizeReturn(), before);
  assert.equal(Knights.performance(), null);
});

test('a failed payment restores only coins actually removed and cleans up the show', async (t) => {
  present();
  const player = newPlayer('knightpayfail', new core.Location(3054, 3377, 0));
  const inventory = player.getInventory();
  inventory.adds(COINS, 800);
  const before = core.World.getNpcs().sizeReturn();
  const refresh = inventory.refreshItems.bind(inventory);
  let failed = false;
  t.mock.method(inventory, 'refreshItems', () => {
    if (!failed) { failed = true; throw new Error('refresh after debit'); }
    return refresh();
  });
  assert.equal(Knights.start(player), false);
  assert.equal(inventory.getAmount(COINS), 800, 'the actual debit is returned');
  assert.equal(core.World.getNpcs().sizeReturn(), before);
  assert.equal(Knights.performance(), null);
  t.mock.method(inventory, 'deleted', () => { throw new Error('before debit'); });
  assert.equal(Knights.start(player), false);
  assert.equal(inventory.getAmount(COINS), 800, 'nothing was added when no coins were removed');
  assert.equal(core.World.getNpcs().sizeReturn(), before);
  assert.equal(Knights.performance(), null);
});

test('a payment failure restores each coin stack and its metadata even beside a full stack', (t) => {
  present();
  const player = newPlayer('knightmetacoins', new core.Location(3054, 3377, 0));
  const inventory = player.getInventory();
  inventory.setItem(0, new core.Item(COINS, 1000, { preset: true }));
  inventory.setItem(1, new core.Item(COINS, 2147483647));
  const before = inventory.getItems().slice(0, 2).map((item) => ({
    id: item.getId(), amount: item.getAmount(), meta: item.getMeta(),
  }));
  const refresh = inventory.refreshItems.bind(inventory);
  let failed = false;
  t.mock.method(inventory, 'refreshItems', () => {
    if (!failed) { failed = true; throw new Error('refresh after debit'); }
    return refresh();
  });
  assert.equal(Knights.start(player), false);
  assert.deepEqual(inventory.getItems().slice(0, 2).map((item) => ({
    id: item.getId(), amount: item.getAmount(), meta: item.getMeta(),
  })), before);
  assert.equal(Knights.performance(), null);
});

test('cleanup retains ownership and retries after removals throw', (t) => {
  present();
  const player = newPlayer('knightcleanup', new core.Location(3054, 3377, 0));
  player.getInventory().adds(COINS, 1000);
  const list = core.World.getNpcs();
  assert.equal(Knights.start(player), true);
  const show = Knights.performance();
  const other = new core.NPC(core.NpcIdentifiers.KNIGHT_2, new core.Location(3000, 3000, 0));
  assert.equal(list.add(other), true);
  const remove = list.remove.bind(list);
  let beforeThrown = false;
  let afterThrown = false;
  t.mock.method(list, 'remove', (npc) => {
    if (npc === show.knights[0] && !beforeThrown) { beforeThrown = true; throw new Error('before remove'); }
    if (npc === show.knights[1] && !afterThrown) { afterThrown = true; remove(npc); throw new Error('after remove'); }
    return remove(npc);
  });
  try {
    Knights.reset();
    assert.equal(Knights.performance(), show, 'unremoved actor still reserves the performance');
    assert.equal(Knights.start(player), false, 'another performance cannot overlap');
    assert.equal(player.getInventory().getAmount(COINS), 500);
    for (let i = 0; i < 8; i++) core.TaskManager.process();
    assert.equal(Knights.performance(), null);
    assert.ok(show.knights.every((npc) => !npc.isRegistered()));
    assert.equal(other.isRegistered(), true, 'unrelated NPC was not removed');
  } finally {
    remove(other);
  }
});

test('a song error stops the show and cleans up all its NPCs', () => {
  present();
  const player = newPlayer('knightspeechfail', new core.Location(3054, 3377, 0));
  player.getInventory().adds(COINS, 500);
  assert.equal(Knights.start(player), true);
  const show = Knights.performance();
  show.knights[2].forceChat = () => { throw new Error('speech failure'); };
  for (let i = 0; i < 8; i++) core.TaskManager.process();
  assert.equal(Knights.performance(), null);
  assert.ok(show.knights.every((npc) => !npc.isRegistered()));
});

test('a persistently unremovable knight keeps the performance reserved after bounded retries', (t) => {
  present();
  const player = newPlayer('knightstuck', new core.Location(3054, 3377, 0));
  player.getInventory().adds(COINS, 1000);
  const list = core.World.getNpcs();
  assert.equal(Knights.start(player), true);
  const show = Knights.performance();
  const remove = list.remove.bind(list);
  t.mock.method(list, 'remove', (npc) => {
    if (npc === show.knights[0]) throw new Error('still unavailable');
    return remove(npc);
  });
  Knights.reset();
  for (let i = 0; i < 8; i++) core.TaskManager.process();
  assert.equal(Knights.performance(), show, 'failed cleanup cannot release ownership');
  assert.equal(Knights.start(player), false);
  assert.equal(player.getInventory().getAmount(COINS), 500);
  t.mock.restoreAll();
  Knights.reset();
  assert.equal(Knights.performance(), null, 'a later successful cleanup releases it');
});

test('knight Talk-to reaches the generated response while the performance continues', async () => {
  present();
  const player = newPlayer('knighttalk', new core.Location(3045, 3377, 0));
  player.getInventory().adds(COINS, 500);
  assert.equal(Knights.start(player), true);
  const show = Knights.performance();
  const messages = [];
  const sendMessage = player.sendMessage.bind(player);
  player.sendMessage = (text, ...args) => { messages.push(text); return sendMessage(text, ...args); };
  await send(player, { type: 'npc_option', index: show.knights[2].getIndex(), clickType: 1 });
  assert.ok(messages.some((text) => /too busy dancing/i.test(text)), 'the transcript sends the response in chat');
  assert.equal(Knights.performance(), show);
});

test('Party Pete says the generated final line when present', () => {
  present();
  const player = newPlayer('knightpete', new core.Location(3054, 3377, 0));
  player.getInventory().adds(COINS, 500);
  const pete = new core.NPC(core.NpcIdentifiers.PARTY_PETE, new core.Location(3041, 3377, 0));
  pete.__skipDefaultRespawn = true;
  assert.equal(core.World.getNpcs().add(pete), true);
  const lines = [];
  pete.forceChat = (text) => lines.push(text);
  try {
    assert.equal(Knights.start(player), true);
    for (let i = 0; i < 45; i++) core.TaskManager.process();
    assert.deepEqual(lines, ['The party room is a silly place!']);
    assert.equal(Knights.performance(), null);
  } finally {
    core.World.getNpcs().remove(pete);
  }
});

test('native lever selection validates choice and cannot replay a completed or closed prompt', async () => {
  present();
  seed([{ id: WHIP, amount: 5 }]);
  const puller = newPlayer('menureplay', new core.Location(3054, 3377, 0));
  puller.getInventory().adds(COINS, 999);
  await send(puller, objectClick(LEVER, LEVER_TILE));
  await nativeChoice(puller, 0);
  await nativeChoice(puller, 4);
  await nativeChoice(puller, 1, (218 << 16) | 1);
  await send(puller, widget(149, 0, { buttonNum: 1 }));
  assert.ok(core.MultiChatboxPrompt.getPending(puller), 'unrelated input did not consume the prompt');
  assert.equal(puller.getInventory().getAmount(COINS), 999);
  await nativeChoice(puller, 1);
  assert.equal(puller.getInventory().getAmount(COINS), 999, 'insufficient money is kept');
  assert.equal(Room.balloonCount(), 0);
  puller.getInventory().adds(COINS, 1);
  await nativeChoice(puller, 1);
  assert.equal(puller.getInventory().getAmount(COINS), 1000, 'a completed prompt cannot be replayed');
  await send(puller, objectClick(LEVER, LEVER_TILE));
  await send(puller, { type: 'interface_close' });
  await nativeChoice(puller, 1);
  assert.equal(puller.getInventory().getAmount(COINS), 1000, 'closing prevents a stale choice');
  await send(puller, objectClick(LEVER, LEVER_TILE));
  await nativeChoice(puller, 1);
  assert.equal(puller.getInventory().getAmount(COINS), 0, 'exactly 1000 pays for one drop');
  assert.ok(Room.balloonCount() > 0);
  assert.deepEqual(Store.chest(), [{ id: WHIP, amount: 5 }], 'release does not consume chest items');
  await nativeChoice(puller, 1);
  assert.equal(puller.getInventory().getAmount(COINS), 0, 'a repeated choice cannot charge again');
});

test('the lever costs nothing when no balloon could land', (t) => {
  present();
  seed([{ id: WHIP, amount: 5 }]);
  const puller = newPlayer('puller2', new core.Location(3054, 3377, 0));
  puller.getInventory().adds(COINS, 1000);
  t.mock.method(core.RegionManager, 'blocked', () => true);
  Room.pullLever({ player: puller });
  assert.equal(Room.balloonCount(), 0);
  assert.equal(puller.getInventory().getAmount(COINS), 1000, 'no coins taken for nothing');
});

test('the menu preserves payment when the chest is empty or no balloon can land', async (t) => {
  present();
  const puller = newPlayer('menunoland', new core.Location(3054, 3377, 0));
  puller.getInventory().adds(COINS, 1000);
  await send(puller, objectClick(LEVER, LEVER_TILE));
  await nativeChoice(puller, 1);
  assert.equal(puller.getInventory().getAmount(COINS), 1000, 'empty chest');
  seed([{ id: WHIP, amount: 5 }]);
  await send(puller, objectClick(LEVER, LEVER_TILE));
  t.mock.method(core.RegionManager, 'blocked', () => true);
  await nativeChoice(puller, 1);
  assert.equal(puller.getInventory().getAmount(COINS), 1000, 'no landing tile');
  assert.deepEqual(Store.chest(), [{ id: WHIP, amount: 5 }]);
  assert.equal(Room.balloonCount(), 0);
});

test('a new native dialogue supersedes the lever prompt', async () => {
  present();
  seed([{ id: WHIP, amount: 5 }]);
  const puller = newPlayer('menureplaced', new core.Location(3054, 3377, 0));
  puller.getInventory().adds(COINS, 1000);
  await send(puller, objectClick(LEVER, LEVER_TILE));
  puller.getDialogueManager().startDialogues(new core.DialogueChainBuilder()
    .add(new core.StatementDialogue(0, 'Another conversation.')));
  await nativeChoice(puller, 1);
  assert.equal(puller.getInventory().getAmount(COINS), 1000);
  assert.equal(Room.balloonCount(), 0);
  assert.deepEqual(Store.chest(), [{ id: WHIP, amount: 5 }]);
});

test('confirming tells the league task, once the chest has the items', async () => {
  present();
  const seen = [];
  const emit = PM.emitCustomEvent;
  PM.emitCustomEvent = (name, payload, ...rest) => {
    if (name === 'league:complete-task') seen.push(payload.id);
    return emit.call(PM, name, payload, ...rest);
  };
  try {
    const flush = gate();
    const player = await offering('leaguer');
    await confirmClick(player);
    assert.deepEqual(seen, [], 'not on opening, not while waiting');
    flush.resolve();
    await tick();
    assert.deepEqual(seen, ['use-the-falador-party-room']);
    screen().playerGone(player);
  } finally {
    PM.emitCustomEvent = emit;
  }
});
