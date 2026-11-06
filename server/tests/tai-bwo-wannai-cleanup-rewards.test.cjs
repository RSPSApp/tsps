// Run after `npx tsc --build`: node --test tests/tai-bwo-wannai-cleanup-rewards.test.cjs
//
// Tai Bwo Wannai Cleanup's rewards through the real plugins: every plugin loaded, the shops loaded
// with the plugins' definition sources, the map's own doors and trees, clicks and chat choices
// dispatched by PluginManager, real tasks ticked, on a real Player with only the network stubbed.
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before, after } = require('node:test');

const ROOT = path.join(__dirname, '..');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

// Set during module evaluation, before the existing full-plugin before hook executes.
process.env.DISABLE_PLAYER_BOTS = "1";

let PluginManager, core, MapObjects, ObjectDefinition, Location, Player, Item, Equipment;
let Common, Shop, Parcels, Grove, Diaries, jungleQuest;
let cycle = 0;
let index = 3500;

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(ROOT);
  ({ PluginManager } = require('../dist/plugins/PluginManager'));
  ({ MapObjects } = require('../dist/game/entity/impl/object/MapObjects'));
  ({ ObjectDefinition } = require('../dist/game/definition/ObjectDefinition'));
  ({ Location } = require('../dist/game/model/Location'));
  PluginManager.loadPluginSwitches = () => ({ switches: new Map() });
  const quiet = [console.log, console.info, console.debug, console.warn, console.error];
  console.log = console.info = console.debug = console.warn = () => {};
  try {
    PluginManager.loadFromDirectory(path.join(ROOT, 'plugins'));
    core = PluginManager.getCoreApi();
    core.RegionManager.init();
    new (require('../dist/game/definition/loader/impl/ShopDefinitionLoader').ShopDefinitionLoader)().load();
    core.ShopManager.initialize();
  } finally {
    [console.log, console.info, console.debug, console.warn, console.error] = quiet;
  }
  ({ Player } = require('../dist/game/entity/impl/player/Player'));
  ({ Item, Equipment } = core);
  core.World.getProcessCycle = () => cycle;
  for (const [x, y] of [[2760, 3020], [2840, 3020], [2760, 3100], [2840, 3100]]) core.RegionManager.loadMapFiles(x, y);
  const dir = '../plugins/minigames/taibwowannaicleanup/';
  Common = require(`${dir}Common.TaiBwoWannaiCleanup`);
  Shop = require(`${dir}Shop.TaiBwoWannaiCleanup`);
  Parcels = require(`${dir}Parcels.TaiBwoWannaiCleanup`);
  Grove = require(`${dir}Grove.TaiBwoWannaiCleanup`);
  Diaries = require('../plugins/achievements/AchievementDiaries.plugin.js')._test;
  jungleQuest = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find((q) => q.key === 'jungle_potion');
  // Production startup initializes every registered hook before any legacy or native login.
  PluginManager.emitServerStartup({});
});
after(() => PluginManager.emitServerShutdown({}));

const id = (kind, name) => core.CacheDefinitions[`get${kind}Id`](name);
const obj = (name) => id('Obj', name);
const tick = (n = 1) => { for (let i = 0; i < n; i++) { cycle++; core.TaskManager.process(); } };
const STICKS = 'village_trade_sticks';

/** A real player in Tai Bwo Wannai after Jungle Potion, at cleanup stage `progress`. */
function villager(t, { progress = 5, sticks = 0, at = [2795, 3066, 0] } = {}) {
  const p = new Player(null);
  p.setIndex(index++);
  p.setUsername(`tbwr${p.getIndex()}`);
  p.setRegistered(true);
  p.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  p.messages = [];
  t.mock.method(p, 'sendMessage', (text) => p.messages.push(text));
  const sender = p.getPacketSender();
  p.sounds = [];
  p.jingles = [];
  p.sent = [];
  p.removed = [];
  const sound = sender.sendSound;
  t.mock.method(sender, 'sendSound', function (soundId) { p.sounds.push(soundId); return sound.apply(this, arguments); });
  t.mock.method(sender, 'sendJingle', function (jingle) { p.jingles.push(jingle); return this; });
  t.mock.method(sender, 'sendObject', function (o) { p.sent.push([o.getId(), o.getLocation().getX(), o.getLocation().getY(), o.getFace()]); return this; });
  t.mock.method(sender, 'sendObjectRemoval', function (o) { p.removed.push([o.getId(), o.getLocation().getX(), o.getLocation().getY()]); return this; });
  p.setLocation(new Location(...at));
  jungleQuest.setStage(p, jungleQuest.completionValue);
  Common.advance(p, progress);
  if (sticks) p.getInventory().add(new Item(obj(STICKS), sticks));
  return p;
}

const WELCOME = "Welcome to Old School RuneScape.";
/** Logs in, leaving out the login's own welcome line so the tests see only what follows. */
const login = (p) => {
  PluginManager.emitPlayerLogin({ player: p, username: p.getUsername() });
  p.messages = p.messages.filter((message) => message !== WELCOME);
};
const held = (p, name) => p.getInventory().getAmount(obj(name));
const give = (p, name, amount = 1) => p.getInventory().add(new Item(obj(name), amount));

/** An NPC op as the click packet sends it, on the NPC the player sees. */
function npcOp(p, npcName, clickType = 1) {
  const npc = new core.NPC(id('Npc', `${npcName}_multinpc`) ?? id('Npc', npcName), new Location(2795, 3067, 0));
  const event = { player: p, npc, npcId: npc.getContentId(p), definition: npc.getCurrentDefinition(p), npcIndex: 1, clickType, location: { x: 2795, y: 3067, z: 0 }, handled: false };
  PluginManager.emitNpcInteraction(event);
  return event;
}

const pending = (p) => core.MultiChatboxPrompt.getPending(p);

/** Picks `text` from the chat menu, as the client's resume packet does. */
function choose(p, text) {
  const options = pending(p)?.options ?? [];
  const slot = options.indexOf(text) + 1;
  assert.ok(slot > 0, `"${text}" in ${JSON.stringify(options)}`);
  PluginManager.emitInterfaceActionClick({ player: p, buttonId: (219 << 16) | 1, slot, action: 0, handled: false });
}

/** Continues every box, picking `choices` from menus in order; the lines seen are returned. */
function play(p, choices = []) {
  const seen = [];
  const manager = p.getDialogueManager();
  for (let i = 0; i < 80; i++) {
    const current = manager.getCurrent?.();
    if (current) {
      const text = current.text ?? current.getText?.();
      if (text) seen.push(Array.isArray(text) ? text.join(' ') : String(text));
      manager.advance();
      continue;
    }
    if (pending(p) && choices.length) {
      choose(p, choices.shift());
      continue;
    }
    break;
  }
  return seen;
}

// ------------------------------------------------------------------ Gabooty's Cooperative

const shopState = (p) => core.ShopManager.getOpenShop(p);
const slotOf = (p, name) => shopState(p).stock.findIndex((entry) => entry.itemId === obj(name));
const shopAction = (p, kind, containerId, slot, itemId, amount = 0) =>
  core.ShopManager.handleItemContainerAction(p, { kind, containerId, slot, itemId, amount });
const value = (p, name) => shopAction(p, 'value', 3900, slotOf(p, name), obj(name));
const buy = (p, name, amount = 1) => shopAction(p, 'buy_sell', 3900, slotOf(p, name), obj(name), amount);
const sell = (p, name, amount = 1) => {
  const slot = p.getInventory().getItems().findIndex((item) => item?.getId() === obj(name));
  return shopAction(p, 'buy_sell', 3823, slot, obj(name), amount);
};

test("Trade-Co-op waits for \"What do you do here?\"; asking it unlocks both shops for good", (t) => {
  const p = villager(t, { sticks: 5000, progress: 1 });
  login(p);
  npcOp(p, 'tbwcu_gabooty', 3);
  assert.equal(shopState(p), null, 'no shop yet');
  // His conversation plays instead, without "Can you open the shop please?".
  assert.ok(pending(p), 'his menu');
  assert.ok(!pending(p).options.includes('Can you open the shop please?'));
  choose(p, 'What do you do here?');
  assert.equal(p.getAttribute(Shop.ASKED_ATTRIBUTE), true);
  play(p);
  npcOp(p, 'tbwcu_gabooty', 3);
  assert.equal(shopState(p)?.name, "Gabooty's Tai Bwo Wannai Cooperative. (Default)");
  core.ShopManager.close(p);
  p.setStatus(core.PlayerStatus.NONE);
  // Talk-to now offers the shop.
  npcOp(p, 'tbwcu_gabooty', 1);
  assert.ok(pending(p).options.includes('Can you open the shop please?'));
});

test('Trade-Co-op opens the generated Cooperative, with the live message wording', (t) => {
  const p = villager(t, { sticks: 3000 });
  p.setAttribute(Shop.ASKED_ATTRIBUTE, true);
  login(p);
  npcOp(p, 'tbwcu_gabooty', 3);
  const shop = shopState(p);
  assert.equal(shop.name, "Gabooty's Tai Bwo Wannai Cooperative. (Default)");
  assert.equal(Shop.shopId(shop.name), core.ShopDefinition.all().find((d) => d.getName() === shop.name).getId(), 'the generated shop');
  assert.ok(slotOf(p, 'machette_redtopaz') >= 0);
  value(p, 'tbw_villager_hat_cream');
  const price = shop.stock[slotOf(p, 'tbw_villager_hat_cream')].price;
  assert.deepEqual(p.messages, [`Villager hat: currently costs ${price.toLocaleString('en-US')} trade sticks.`]);
  buy(p, 'tbw_villager_hat_cream');
  assert.equal(held(p, 'tbw_villager_hat_cream'), 1);
  assert.equal(held(p, STICKS), 3000 - price);
});

test('Karamja gloves worn: the gloves version opens, from Trade-Co-op and from his transcript', (t) => {
  const p = villager(t, { sticks: 2500 });
  p.setAttribute(Shop.ASKED_ATTRIBUTE, true);
  login(p);
  p.getEquipment().setItem(Equipment.HANDS_SLOT, new Item(obj('atjun_gloves_med'), 1));
  npcOp(p, 'tbwcu_gabooty', 3);
  assert.equal(shopState(p).name, "Gabooty's Tai Bwo Wannai Cooperative. (Karamja gloves)");
  core.ShopManager.close(p);
  p.setStatus(core.PlayerStatus.NONE);
  npcOp(p, 'tbwcu_gabooty', 1);
  play(p, ['Can you open the shop please?']);
  assert.equal(shopState(p)?.name, "Gabooty's Tai Bwo Wannai Cooperative. (Karamja gloves)");
  // Taken off, the Default version again.
  core.ShopManager.close(p);
  p.setStatus(core.PlayerStatus.NONE);
  p.getEquipment().deleteAtSlot(Equipment.HANDS_SLOT, 1);
  npcOp(p, 'tbwcu_gabooty', 3);
  assert.equal(shopState(p).name, "Gabooty's Tai Bwo Wannai Cooperative. (Default)");
});

test("too few sticks: \"You don't have enough trade sticks.\"", (t) => {
  const p = villager(t, { sticks: 100 });
  p.setAttribute(Shop.ASKED_ATTRIBUTE, true);
  login(p);
  npcOp(p, 'tbwcu_gabooty', 3);
  buy(p, 'tbw_villager_hat_blue');
  assert.deepEqual(p.messages, ["You don't have enough trade sticks."]);
  assert.equal(held(p, 'tbw_villager_hat_blue'), 0);
});

// ------------------------------------------------------------------ Safta Doc

function orderMachete(p, kind) {
  npcOp(p, 'tbwcu_safta_doc', 1);
  return play(p, ['What do you do here?', "Yes, I'd like to get a machete.", `${kind} machete.`, `Order the ${kind} machete.`]);
}

test("Safta Doc's opal machete: the materials go, the machete, the diary task, jingle 256, his line and the box", (t) => {
  const p = villager(t, { sticks: 350 });
  login(p);
  give(p, 'uncut_opal', 2);
  give(p, 'opal');
  give(p, 'jade');
  give(p, 'village_rare_tuber');
  const lines = orderMachete(p, 'Opal');
  assert.equal(held(p, 'machette_opal'), 1);
  assert.equal(held(p, STICKS), 50);
  assert.equal(held(p, 'uncut_opal') + held(p, 'opal'), 0);
  assert.equal(held(p, 'village_rare_tuber'), 0);
  assert.equal(held(p, 'jade'), 1, 'other gems stay');
  assert.deepEqual(p.jingles, [256]);
  assert.ok(lines.some((line) => line.includes('There you go Bwana, a nice new opal machete for you.')), lines.join(' | '));
  assert.ok(lines.some((line) => line.includes('Safta doc sells you an opal machete.')));
  const again = { player: p, diary: 'karamja', task: 'exchange-gems-for-a-machete' };
  PluginManager.emitCustomEvent('diary:task', again);
  assert.equal(again.completed, false, 'the task was already done');
});

test('Safta Doc without everything: his "not enough" branch, nothing taken (red topaz too)', (t) => {
  for (const [kind, gem, sticks] of [['Jade', 'jade', 600], ['Red Topaz', 'red_topaz', 1199]]) {
    const p = villager(t, { sticks });
    login(p);
    give(p, gem, 3);
    if (kind === 'Jade') {
      // No gout tuber.
    } else {
      give(p, 'village_rare_tuber');
    }
    const lines = orderMachete(p, kind);
    assert.equal(held(p, gem), 3, kind);
    assert.equal(held(p, STICKS), sticks);
    assert.ok(lines.some((line) => line.includes("I don't have enough trading sticks, sorry.")), lines.join(' | '));
    assert.ok(!lines.some((line) => line.includes('There you go Bwana')), `${kind}: ${lines.join(' | ')}`);
    assert.equal(held(p, kind === 'Jade' ? 'machette_jade' : 'machette_redtopaz'), 0);
  }
});

test('Safta Doc: a red topaz machete with exactly 1,200 sticks frees the stick slot', (t) => {
  const p = villager(t, { sticks: 1200 });
  login(p);
  give(p, 'uncut_red_topaz', 3);
  give(p, 'village_rare_tuber');
  orderMachete(p, 'Red Topaz');
  assert.equal(held(p, 'machette_redtopaz'), 1);
  assert.equal(held(p, STICKS), 0);
  assert.equal(p.getInventory().getFreeSlots(), 27);
});

// ------------------------------------------------------------------ Rionasta's parcels

const itemsUid = () => id('Component', 'tai_bwo_wannai_post:items');
function pack(p, name, op) {
  const slot = p.getInventory().getItems().findIndex((item) => item?.getId() === obj(name));
  const event = { player: p, buttonId: itemsUid(), action: op, slot, itemId: obj(name), handled: false };
  PluginManager.emitInterfaceActionClick(event);
  return event;
}
const banked = (p, name) => p.getBank(0).getAmount(obj(name));

test("Rionasta's parcels: 10 sticks per item, stacks counted per item, to the bank", (t) => {
  const p = villager(t, { sticks: 300 });
  login(p);
  give(p, 'teak_logs', 3);
  give(p, 'feather', 20);
  npcOp(p, 'tbwcu_rionasta', 3);
  assert.equal(p.getInterfaceId(), id('Interface', 'tai_bwo_wannai_post'));
  pack(p, 'teak_logs', 5); // Pack-All
  assert.equal(banked(p, 'teak_logs'), 3);
  assert.equal(held(p, STICKS), 270);
  pack(p, 'feather', 4); // Pack-10
  assert.equal(banked(p, 'feather'), 10);
  assert.equal(held(p, STICKS), 170);
  pack(p, 'feather', 5); // Pack-All: 10 left, 17 paid for
  assert.equal(banked(p, 'feather'), 20);
  assert.equal(held(p, STICKS), 70);
});

test('parcels: a stale click naming an item no longer in its slot sends nothing, also through Pack-X', (t) => {
  const p = villager(t, { sticks: 300 });
  login(p);
  give(p, 'teak_logs', 1);
  npcOp(p, 'tbwcu_rionasta', 3);
  const slot = p.getInventory().getItems().findIndex((item) => item?.getId() === obj('teak_logs'));
  const stale = () => ({ player: p, buttonId: itemsUid(), action: 2, slot, itemId: obj('teak_logs'), handled: false }); // Pack-1
  PluginManager.emitInterfaceActionClick(stale());
  assert.equal(banked(p, 'teak_logs'), 1);
  assert.equal(held(p, STICKS), 290);
  // The emptied slot fills with a mahogany log before the second, queued teak click arrives.
  p.getInventory().set?.(slot, new Item(obj('mahogany_logs'), 1)) ?? give(p, 'mahogany_logs', 1);
  assert.equal(p.getInventory().getItems()[slot]?.getId(), obj('mahogany_logs'));
  PluginManager.emitInterfaceActionClick(stale());
  assert.equal(banked(p, 'mahogany_logs'), 0, 'the mahogany stays');
  assert.equal(held(p, STICKS), 290, 'nothing more charged');
});

test('parcels: currencies, Karamjan rum and too few sticks are refused with their messages', (t) => {
  const p = villager(t, { sticks: 25 });
  login(p);
  give(p, 'coins', 100);
  p.getInventory().add(new Item(core.ItemIdentifiers.KARAMJAN_RUM, 1));
  give(p, 'teak_logs', 5);
  npcOp(p, 'tbwcu_rionasta', 3);
  pack(p, 'coins', 5);
  pack(p, STICKS, 2);
  const rumSlot = p.getInventory().getItems().findIndex((item) => item?.getId() === core.ItemIdentifiers.KARAMJAN_RUM);
  PluginManager.emitInterfaceActionClick({ player: p, buttonId: itemsUid(), action: 2, slot: rumSlot, itemId: core.ItemIdentifiers.KARAMJAN_RUM, handled: false });
  assert.deepEqual(p.messages, [
    'You cannot send any form of currency through the parcel service',
    'You cannot send any form of currency through the parcel service',
    'The villager refuses to send this through the parcel system.',
  ]);
  assert.equal(held(p, 'coins'), 100);
  pack(p, 'teak_logs', 5); // two paid for
  assert.equal(banked(p, 'teak_logs'), 2);
  assert.equal(held(p, STICKS), 5);
  pack(p, 'teak_logs', 2);
  assert.equal(p.messages.at(-1), "You don't have enough trading sticks to send that.");
  assert.equal(banked(p, 'teak_logs'), 2);
});

test("parcels: what the bank refuses stays; under 10 sticks Rionasta says so", (t) => {
  const p = villager(t, { sticks: 50 });
  login(p);
  give(p, 'teak_logs', 1);
  npcOp(p, 'tbwcu_rionasta', 3);
  t.mock.method(PluginManager, 'emitCanBankItem', (_player, item) => (item?.getId?.() === obj('teak_logs') ? false : null));
  pack(p, 'teak_logs', 2);
  assert.equal(held(p, 'teak_logs'), 1);
  assert.equal(held(p, STICKS), 50);
  PluginManager.emitCanBankItem.mock.restore();
  const poor = villager(t, { sticks: 9 });
  login(poor);
  npcOp(poor, 'tbwcu_rionasta', 3);
  assert.notEqual(poor.getInterfaceId(), id('Interface', 'tai_bwo_wannai_post'));
  assert.ok(play(poor).some((line) => line.includes('It costs at least 10 trading sticks')));
  // His conversation asks the same, then opens the service a tick after it closes.
  const rich = villager(t, { sticks: 10 });
  login(rich);
  npcOp(rich, 'tbwcu_rionasta', 1);
  play(rich, ['What do you do here?', 'Can I send a parcel please?']);
  tick(1);
  assert.equal(rich.getInterfaceId(), id('Interface', 'tai_bwo_wannai_post'));
});

// ------------------------------------------------------------------ The Hardwood Grove

const DOOR = [2817, 3083, 0];
function door(p, option) {
  const object = MapObjects.get(id('Loc', 'tbwcu_bamboo_door_l'), new Location(...DOOR), null);
  assert.ok(object, 'the grove door is on the map');
  const definition = ObjectDefinition.forPlayer(object.getId(), p);
  const clickType = definition.getInteractions().indexOf(option) + 1;
  assert.ok(clickType > 0, option);
  const event = { player: p, object, objectId: object.getId(), definition, clickType, location: { x: DOOR[0], y: DOOR[1], z: 0 }, handled: false };
  PluginManager.emitObjectInteraction(event);
  return event;
}
const OUTSIDE = [2816, 3083, 0];
const where = (p) => [p.getLocation().getX(), p.getLocation().getY()];
function completeElite(p) {
  Diaries.diaryCommand({ player: p, parts: ['diary', 'karamja', 'elite', 'complete'] });
}

test('the grove: Quick-Pay takes 100 sticks and walks in, with the recorded door swap, shut 2 ticks on', (t) => {
  const p = villager(t, { sticks: 150, at: OUTSIDE });
  login(p);
  assert.equal(door(p, 'Quick-Pay(100)').handled, true);
  door(p, 'Quick-Pay(100)'); // a double click
  tick(1);
  assert.equal(held(p, STICKS), 50, 'paid once');
  assert.deepEqual(p.sounds.slice(-2), [1283, 40]);
  const wall = id('Loc', 'inviswall');
  // Only the doorway's own locs (login sends others elsewhere).
  const doorway = p.sent.filter(([, x, y]) => (x === 2816 || x === 2817) && (y === 3083 || y === 3084));
  assert.deepEqual(doorway.filter(([o]) => o === wall).map(([, x, y]) => [x, y]), [[2817, 3083], [2817, 3084]]);
  assert.deepEqual(doorway.filter(([o]) => o !== wall).map(([o, x, y, r]) => [o, x, y, r]), [
    [id('Loc', 'tbwcu_bamboo_door_inactive_l'), 2816, 3083, 3],
    [id('Loc', 'tbwcu_bamboo_door_inactive_r'), 2816, 3084, 1],
  ]);
  tick(1);
  assert.deepEqual(where(p), [2817, 3083]);
  tick(1);
  assert.deepEqual(p.removed.filter(([, x]) => x === 2816).map(([o]) => o), ['tbwcu_bamboo_door_inactive_l', 'tbwcu_bamboo_door_inactive_r'].map((name) => id('Loc', name)), 'the open leaves go');
  const shut = p.sent.filter(([o]) => o === id('Loc', 'tbwcu_bamboo_door_l') || o === id('Loc', 'tbwcu_bamboo_door_r'));
  assert.deepEqual(shut.map(([, x, y, r]) => [x, y, r]), [[2817, 3083, 0], [2817, 3084, 0]], 'the doors back at rotation 0');
  assert.equal(Grove._passing.has(p), false);
});

test('the grove: Open also pays; under 100 sticks nothing happens but the message', (t) => {
  const p = villager(t, { sticks: 99, at: OUTSIDE });
  login(p);
  door(p, 'Open');
  tick(3);
  assert.deepEqual(where(p), [2816, 3083]);
  assert.deepEqual(p.messages, ['You need 100 trading sticks to enter the Hardwood Grove.']);
  give(p, STICKS, 1);
  door(p, 'Open');
  tick(3);
  assert.deepEqual(where(p), [2817, 3083]);
  assert.equal(held(p, STICKS), 0);
});

test('the grove with the Karamja elite diary: Quick-Pay is free, Open is Murcaily\'s "it\'s free!"', (t) => {
  const p = villager(t, { sticks: 500, at: OUTSIDE });
  login(p);
  completeElite(p);
  door(p, 'Quick-Pay(100)');
  tick(3);
  assert.deepEqual(where(p), [2817, 3083]);
  assert.equal(held(p, STICKS), 500);
  assert.deepEqual(p.sounds.slice(-1), [40]);

  const q = villager(t, { sticks: 500, at: OUTSIDE });
  login(q);
  completeElite(q);
  door(q, 'Open');
  const lines = play(q, ["I'll enter for free."]);
  assert.ok(lines.some((line) => line.includes("for you my friend, it's free!")), lines.join(' | '));
  tick(3);
  assert.deepEqual(where(q), [2817, 3083]);
  assert.equal(held(q, STICKS), 500);
});

test("the grove before the first sticks: Murcaily's warning, then 100 to go in anyway, or staying out", (t) => {
  const p = villager(t, { progress: 4, sticks: 100, at: OUTSIDE });
  login(p);
  door(p, 'Quick-Pay(100)');
  const lines = play(p, ["Okay, I'll stay out here."]);
  assert.ok(lines[0].includes("You can't chop those trees until you've"), lines.join(' | '));
  tick(3);
  assert.deepEqual(where(p), [2816, 3083]);
  assert.equal(held(p, STICKS), 100);
  door(p, 'Open');
  play(p, ['I just want to go in anyway.']);
  tick(3);
  assert.deepEqual(where(p), [2817, 3083]);
  assert.equal(held(p, STICKS), 0);
});

test('leaving the grove: no hardwood asks first; with logs it walks straight out to (2816, 3083)', (t) => {
  const p = villager(t, { at: [2817, 3084, 0] });
  login(p);
  door(p, 'Open');
  assert.equal(p.getDialogueManager().getCurrent()?.constructor?.name, 'DoubleItemStatementDialogue');
  play(p, ['Erk! No, I want to stay in the grove.']);
  tick(3);
  assert.deepEqual(where(p), [2817, 3084]);
  door(p, 'Open');
  play(p, ['Yes, I wanna get out of here!']);
  tick(3);
  assert.deepEqual(where(p), [2816, 3083], 'diagonally, as 01858 shows');

  const logs = villager(t, { at: [2817, 3083, 0] });
  login(logs);
  give(logs, 'mahogany_logs');
  door(logs, 'Quick-Pay(100)');
  assert.equal(logs.getDialogueManager().isActive(), false);
  tick(3);
  assert.deepEqual(where(logs), [2816, 3083]);
});

test("the grove's teak and mahogany wait for the first sticks, with the recorded mesbox", (t) => {
  const names = core.CacheDefinitions.getLocNames();
  const treeIds = [...names.keys()].filter((locId) => /^(Teak|Mahogany)/.test(core.CacheDefinitions.getObject(locId)?.name ?? ''));
  let tree = null;
  for (let x = 2817; x <= 2830 && !tree; x++) for (let y = 3076; y <= 3091 && !tree; y++) {
    for (const locId of treeIds) tree ??= MapObjects.get(locId, new Location(x, y, 0), null);
  }
  assert.ok(tree, 'a hardwood tree in the grove');
  const p = villager(t, { progress: 4, at: [tree.getLocation().getX() - 1, tree.getLocation().getY(), 0] });
  const request = { player: p, object: tree, allow: true };
  PluginManager.emitCustomEvent('woodcutting:validate-tree', request);
  assert.equal(request.allow, false);
  assert.ok(play(p)[0].startsWith('You need to have helped clean up Tai Bwo Wannai village'));
  const helped = villager(t, { progress: 5 });
  const allowed = { player: helped, object: tree, allow: true };
  PluginManager.emitCustomEvent('woodcutting:validate-tree', allowed);
  assert.equal(allowed.allow, true);
});

test('the grove: a player moved away before the step pays nothing and is not pulled back', (t) => {
  const p = villager(t, { sticks: 150, at: OUTSIDE });
  login(p);
  door(p, 'Quick-Pay(100)');
  p.moveTo(new Location(2795, 3066, 0)); // a teleport on the click's tick
  tick(3);
  assert.deepEqual(where(p), [2795, 3066]);
  assert.equal(held(p, STICKS), 150);
  assert.equal(Grove._passing.has(p), false);
});


test("a deferred parcel request preserves a newer native shop modal", async t => {
  const { PlayerSession } = require("../dist/net/PlayerSession");
  const { ClientConnection } = require("../dist/net/NetworkBuilder");
  core.RegionManager.loadMapFiles(3226, 3218);
  const PARCEL = id("Interface", "tai_bwo_wannai_post"),
    ITEMS = id("Component", "tai_bwo_wannai_post:items");
  assert.equal(PARCEL, 323);
  assert.equal(ITEMS, (323 << 16) | 5);
  const STICK = obj(STICKS), TEAK = obj("teak_logs"),
    COIN = core.ItemIdentifiers.COINS;
  for (const mode of ["stationary parcel", "direct parcel", "direct shop", "newer shop"]) await t.test(mode, async t => {
    const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
      close() {}, onData() {}, onError() {}, onClose() {} };
    const p = new Player(new PlayerSession(channel));
    p.setIndex(index++);
    p.setUsername("parcel" + p.getIndex());
    p.setRegistered(true);
    p.setLocation(new Location(3226, 3218, 0));
    p.needsPlacement = false;
    const connection = new ClientConnection(channel);
    connection.player = p;
    // Legal persisted Jungle Potion completion, not a claim of naturally completing its quest here.
    jungleQuest.setStage(p, jungleQuest.completionValue);
    assert.equal(jungleQuest.isComplete(p), true);
    PluginManager.emitPlayerLogin({ player: p, username: p.getUsername() });
    p.closeInterruptibleInterfaces();
    assert.equal(Common.progress(p), 0);
    assert.equal(Number(p.getAttribute(Common.ATTR.POINTS)) || 0, 0,
      "no favour claim may replace Rionasta's ordinary parcel dialogue");
    const npcs = [
      core.NPC.create(id("Npc", "tbwcu_rionasta_multinpc") ?? id("Npc", "tbwcu_rionasta"), new Location(3227, 3218, 0)),
      core.NPC.create(id("Npc", "tbwcu_gabooty_multinpc") ?? id("Npc", "tbwcu_gabooty"), new Location(3226, 3219, 0)),
    ];
    const [rionasta, gabooty] = npcs;
    for (const npc of npcs) assert.equal(core.World.getNpcs().add(npc), true);
    assert.equal(rionasta.getCurrentDefinition(p).getName(), "Rionasta");
    assert.equal(gabooty.getCurrentDefinition(p).getName(), "Gabooty");
    t.after(() => {
      p.closeInterruptibleInterfaces();
      PluginManager.emitPlayerDisconnect({ player: p, username: p.getUsername() });
      PluginManager.emitPlayerLogout({ player: p, username: p.getUsername() });
      p.setRegistered(false);
      core.TaskManager.cancelTasks(p.getIndex());
      core.TaskManager.cancelTasks(p);
      for (const npc of npcs) core.World.getNpcs().remove(npc);
      for (const ground of core.World.getItems().filter(g => g.getOwner() === p.getUsername())) core.ItemOnGroundManager.deregister(ground);
    });
    const inv = p.getInventory();
    inv.add(new Item(STICK, 200), false);
    inv.add(new Item(TEAK), false);
    inv.add(new Item(COIN, 100), false);
    const gains = [], skills = p.getSkillManager(),
      addXp = skills.addExperience.bind(skills);
    // addExperiences delegates to addExperience; observing the sink covers both native APIs.
    t.mock.method(skills, "addExperience", (skill, amount, multipliers) => {
      gains.push({ skill: skill.getIndex(), amount, multipliers: !!multipliers });
      return addXp(skill, amount, multipliers);
    });
    const stores = itemId => ({ inventory: inv.getAmount(itemId), equipment: p.getEquipment().getAmount(itemId),
      bank: p.getBanks().reduce((n, b, tab) => n + (b && tab !== core.Bank.BANK_SEARCH_TAB_INDEX ? b.getAmount(itemId) : 0), 0),
      floor: core.World.getItems().filter(g => !g.isPendingRemoval() && g.getOwner() === p.getUsername()
        && g.getPrivateArea() === p.getPrivateArea() && g.getItem().getId() === itemId).reduce((n, g) => n + g.getItem().getAmount(), 0) });
    const owned = itemId => Object.values(stores(itemId)).reduce((n, amount) => n + amount, 0);
    const resources = () => ({ sticks: stores(STICK), teak: stores(TEAK), coins: stores(COIN), gains: [...gains],
      experience: core.Skill.values().map(skill => skills.getExperience(skill)) });
    const initial = resources(), sender = p.getPacketSender(),
      manager = p.getDialogueManager();
    const unchanged = () => assert.deepEqual(resources(), initial, "opening/replacing a service takes no items, fee or XP");
    const state = () => ({ mode, interface: p.getInterfaceId(), parcelMounted: sender.isSubInterfaceOpen(PARCEL),
      shop: core.ShopManager.getOpenShop(p)?.name ?? null, resources: resources() });
    let turns = 0;
    const turn = () => {
      assert.ok(++turns <= 40, "bounded native phase budget");
      p.resetUpdating();
      // Retain this existing test file's clock seam; real tasks still run before decoded player input.
      cycle++;
      core.TaskManager.process();
      connection.processTurnPackets();
      const q = p.getMovementQueue();
      q.beginCycle();
      q.processEntityPursuit();
      if (q.hasPendingWork()) q.process();
      core.TaskManager.processWalkTo(p.getIndex());
    };
    const send = async (...packets) => {
      await connection.dispatch(packets);
      turn();
    };
    const option = (npc, name) => {
      const clickType = npc.getCurrentDefinition(p).getActions().indexOf(name) + 1;
      assert.ok(clickType > 0, name);
      return { type: "npc_option", index: npc.getIndex(), clickType };
    };
    const line = () => {
      const current = manager.getCurrent(), group = sender.getChatboxGroupId();
      assert.ok(current instanceof core.NpcDialogue || current instanceof core.PlayerDialogue);
      assert.ok(group === 217 || group === 231);
      const mount = sender.subInterfaceTargets.get(group);
      assert.ok(mount);
      assert.equal(sender.getSubInterfaceAt(mount.targetUid), mount);
      return { current, group };
    };
    const resume = () => {
      const { group } = line();
      return { type: "dialogue_continue", widgetId: (group << 16) | 5, childIndex: -1 };
    };
    const chooseNative = async text => {
      for (let n = 0; n < 10 && !pending(p); n++) {
        if (manager.getCurrent()) await send(resume());
        else turn();
      }
      const prompt = pending(p);
      assert.ok(prompt, "native transcript must own its actual option prompt");
      assert.equal(manager.isActive(), false);
      const choice = prompt.options.indexOf(text) + 1;
      assert.ok(choice > 0, text);
      await send({ type: "dialogue_continue", widgetId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: choice });
    };
    // The shop permission is produced by Gabooty's actual question, never an invented unlock flag.
    await send(option(gabooty, "Talk-to"));
    await chooseNative("What do you do here?");
    assert.equal(p.getAttribute(Shop.ASKED_ATTRIBUTE), true);
    unchanged();
    if (mode === "direct shop") {
      await send(option(gabooty, "Trade-Co-op"));
      assert.equal(p.getInterfaceId(), core.ShopManager.MAIN_INTERFACE_ID);
      assert.equal(core.ShopManager.getOpenShop(p)?.name, "Gabooty's Tai Bwo Wannai Cooperative. (Default)");
      const mount = sender.subInterfaceTargets.get(core.ShopManager.MAIN_INTERFACE_ID);
      assert.ok(mount);
      assert.equal(sender.getSubInterfaceAt(mount.targetUid), mount);
      unchanged();
      return;
    }
    if (mode === "direct parcel") await send(option(rionasta, "Send-parcel"));
    else {
      await send(option(rionasta, "Talk-to"));
      await chooseNative("What do you do here?");
      await chooseNative("Can I send a parcel please?");
      for (let n = 0; n < 6 && !/^Of course\.\.\.which items/.test(manager.getCurrent()?.getText?.() ?? ""); n++)
        await send(resume());
      const terminal = line();
      assert.ok(terminal.current instanceof core.NpcDialogue);
      assert.equal(terminal.group, 231);
      // The generated terminal has two spaces after "to"; normalize whitespace, preserving exact wording.
      assert.equal(terminal.current.getText().replace(/\s+/g, " ").trim(), "Of course...which items would you like to send to your bank?");
      assert.equal(manager.getOwner(), undefined, "ordinary Talk-to has no explicit named playback owner");
      assert.equal(p.getInterfaceId(), -1);
      assert.equal(sender.isSubInterfaceOpen(PARCEL), false);
      unchanged();
      // Both inputs drain in one real player turn, before the next global task phase.
      await send(resume(), ...(mode === "newer shop" ? [option(gabooty, "Trade-Co-op")] : []));
      assert.equal(sender.isSubInterfaceOpen(PARCEL), false, "deferred parcel open has not run yet");
      unchanged();
      if (mode === "newer shop") {
        assert.equal(p.getInterfaceId(), core.ShopManager.MAIN_INTERFACE_ID);
        assert.equal(core.ShopManager.getOpenShop(p)?.name, "Gabooty's Tai Bwo Wannai Cooperative. (Default)");
        const newer = sender.subInterfaceTargets.get(core.ShopManager.MAIN_INTERFACE_ID);
        assert.ok(newer);
        assert.equal(sender.getSubInterfaceAt(newer.targetUid), newer);
        assert.notEqual(PluginManager.emitCanBank(p, "deposit-box"), false, "preserve the real public guard; denial is a source counterexample");
        turn();
        const details = JSON.stringify(state());
        // First target: a stale request cannot replace the exact main-modal lifetime opened by newer user input.
        assert.equal(sender.getSubInterfaceAt(newer.targetUid), newer, "newer shop mount must survive: " + details);
        assert.equal(p.getInterfaceId(), core.ShopManager.MAIN_INTERFACE_ID, details);
        assert.equal(sender.isSubInterfaceOpen(PARCEL), false, details);
        unchanged();
        return;
      }
      assert.notEqual(PluginManager.emitCanBank(p, "deposit-box"), false);
      turn();
    }
    assert.equal(p.getInterfaceId(), PARCEL, "stationary/direct native parcel positive control");
    assert.equal(sender.isSubInterfaceOpen(PARCEL), true);
    unchanged();
    const slot = inv.getSlotForItemId(TEAK);
    await send({ type: "widget_action", widgetId: ITEMS, groupId: PARCEL, childId: ITEMS & 0xffff,
      buttonNum: 2, opId: 2, slot, itemId: TEAK });
    assert.equal(inv.getAmount(TEAK), 0);
    assert.equal(stores(TEAK).bank, 1);
    assert.equal(owned(TEAK), 1);
    assert.equal(owned(STICK), 190);
    assert.equal(owned(COIN), 100);
    assert.deepEqual(gains, []);
    assert.deepEqual(resources().experience, initial.experience);
  });
});
