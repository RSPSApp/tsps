// Run after `yarn build`: node --test tests/xerics-honour-unlock.test.cjs
//
// Wiki (Ancient tablet): "Using the tablet on any Xeric's talismans will unlock the teleport on all subsequent
// talismans as well, including ones mounted in the player's PoH", with "As the talisman and tablet are held
// together, a surge of power connects the two. After a brief moment, the tablet crumbles, and the talisman feels
// somehow different." Wiki (Xeric's talisman, 2019): no charge is taken for a destination not yet unlocked.
// Recorded Honour landings (rsprox 230/02887, 236/03942) fall in 1253-1257, 3562-3564: both talismans use 1254,3563.
// Real engine: every plugin loaded, a real Player, the tablet used through ClientConnection.dispatch, the save
// through PlayerSave; the teleport itself is recorded.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
const { ItemActionPacketListener } = require("../dist/net/packet/impl/ItemActionPacketListener");

const HOME = [3222, 3218];
const TABLET = 21046;
const UNLOCKED_ATTRIBUTE = "xerics-talisman:honour-unlocked";
const HONOUR_TILE = [1254, 3563];
const USED_MESSAGE = "As the talisman and tablet are held together, a surge of power connects the two. After a brief moment, the tablet crumbles, and the talisman feels somehow different.";
const MAIN_INVENTORY_WIDGET = 149 << 16;

let core, Travel, House, Mounted, Ids, next = 9500;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
  PM.emitServerStartup({});
  Travel = require("../plugins/items/KourendTravelItems.plugin");
  House = require("../plugins/skills/construction/House.Construction");
  Ids = require("../plugins/skills/construction/Ids.Construction");
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("xeric" + p.getIndex()); p.setRegistered(true);
  p.setLocation(new core.Location(...HOME, 0)); p.needsPlacement = false;
  const c = new ClientConnection(channel);
  c.player = p;
  const messages = [];
  const send = p.sendMessage.bind(p);
  p.sendMessage = (text, ...rest) => { messages.push(text); return send(text, ...rest); };
  const typed = [];
  const sender = p.getPacketSender();
  const sendTyped = sender.sendTypedMessage.bind(sender);
  sender.sendTypedMessage = (type, text, ...rest) => { typed.push([type, text]); return sendTyped(type, text, ...rest); };
  const landed = [];
  t.mock.method(core.TeleportHandler, "checkReqs", () => true);
  t.mock.method(core.TeleportHandler, "confirm", (_p, _target, go) => go(p.getInventory().getItems()[talismanSlot(p)]));
  t.mock.method(core.TeleportHandler, "teleport", (_p, target, _type, _warn, onArrival) => { landed.push([target.getX(), target.getY()]); onArrival?.(); });
  t.after(() => { core.TaskManager.cancelTasks(p); p.setRegistered(false); });
  return { p, c, messages, typed, landed };
}

const talismanSlot = (p) => p.getInventory().getItems().findIndex((item) => item?.getId?.() === Travel._test.XERIC_TALISMAN_ID);

function give(f, charges = 10) {
  f.p.getInventory().setItem(0, new core.Item(TABLET, 1));
  f.p.getInventory().setItem(1, new core.Item(Travel._test.XERIC_TALISMAN_ID, 1));
  Travel._test.setXericCharges(f.p, f.p.getInventory().getItems()[1], charges);
}

async function useTablet(f) {
  const inv = f.p.getInventory();
  const tablet = inv.getSlotForItemId(TABLET);
  const talisman = talismanSlot(f.p);
  await f.c.dispatch([{ type: "inventory_use_on", slot: tablet, itemId: TABLET, target: { kind: "inventory", slot: talisman, id: inv.getItems()[talisman].getId() } }]);
  f.c.processTurnPackets();
}

/** The talisman's Rub submenu entry for Xeric's Honour, as the client sends it (op 4, the fifth entry). */
function rubHonour(f) {
  const slot = talismanSlot(f.p);
  const item = f.p.getInventory().getItems()[slot];
  const action = ItemActionPacketListener.resolveInventoryWidgetAction(item.getId(), 4);
  const event = { player: f.p, interfaceId: MAIN_INVENTORY_WIDGET, item, itemId: item.getId(), slot, clickType: action.optionIndex, option: action.option, subOpId: 5, handled: false };
  PM.emitItemAction(event);
  assert.equal(event.subOption, "Xeric's Honour");
  return event;
}

const charges = (f) => Travel._test.xericCharges(f.p.getInventory().getItems()[talismanSlot(f.p)]);

test("Xeric's Honour is shut and costs nothing until the tablet is used", (t) => {
  const f = actor(t);
  give(f);
  rubHonour(f);
  assert.deepEqual(f.landed, [], "no teleport");
  assert.equal(charges(f), 10, "no charge taken");
});

test("using the tablet on the talisman crumbles it and opens Honour, kept across a save", async (t) => {
  const f = actor(t);
  give(f);
  await useTablet(f);
  assert.equal(f.p.getInventory().getAmount(TABLET), 0, "the tablet crumbles");
  // #4905 review: as live sends the sibling Drakan's medallion tablet (rsprox 235/03389.txt:54053-54068), a mesbox chat
  // line and a box with the talisman and the tablet.
  assert.deepEqual(f.typed.filter(([type]) => type === core.ChatType.MESBOX), [[core.ChatType.MESBOX, USED_MESSAGE]], "the Wiki's line, as a mesbox line");
  const box = f.p.getDialogueManager().getCurrent();
  assert.ok(box instanceof core.DoubleItemStatementDialogue, "the two-item box");
  assert.deepEqual(box.getItemIds(), [core.ItemIdentifiers.XERICS_TALISMAN, TABLET]);
  assert.equal(box.getText(), USED_MESSAGE);
  rubHonour(f);
  assert.deepEqual(f.landed, [HONOUR_TILE], "lands at Xeric's Honour");
  assert.equal(charges(f), 9, "one charge");

  const again = actor(t);
  PlayerSave.fromPlayer(f.p).applyToPlayer(again.p);
  assert.equal(again.p.getAttribute(UNLOCKED_ATTRIBUTE), true, "the unlock is saved");
});

// #4905 review: the Wiki's (Ancient tablet) whole Inspect line.
test("Inspect gives the Wiki's whole line", async (t) => {
  const f = actor(t);
  f.p.getInventory().setItem(0, new core.Item(TABLET, 1));
  await f.c.dispatch([{ type: "inventory_action", slot: 0, itemId: TABLET, widgetId: 3214, option: "Inspect" }]);
  f.c.processTurnPackets();
  assert.deepEqual(f.messages, ["You inspect the tablet, and sense a magical power, running your fingers over the inscriptions, they tingle as you get a feel for Xeric's power. He must have stored one of his best spells in this tablet, perhaps he has some sort of device which could utilise it?"]);
});

test("a second tablet does nothing and isn't taken", async (t) => {
  const f = actor(t);
  give(f);
  await useTablet(f);
  f.p.getInventory().setItem(0, new core.Item(TABLET, 1));
  f.messages.length = 0;
  await useTablet(f);
  assert.equal(f.p.getInventory().getAmount(TABLET), 1, "kept");
  assert.deepEqual(f.messages, ["Nothing interesting happens."]);
});

test("the tablet used on the mounted talisman opens Honour for the worn one too", (t) => {
  const f = actor(t);
  give(f);
  t.mock.method(House, "houseFor", () => ({ owner: f.p }));
  const mounted = Ids.loc("poh_amulet_xeric_honour");
  const object = new core.GameObject(mounted, new core.Location(...HOME, 0), 10, 0, null);
  const used = { player: f.p, object, objectId: mounted, item: f.p.getInventory().getItems()[0], itemId: TABLET, itemSlot: 0, interfaceType: 0, location: { x: 0, y: 0, z: 0 }, handled: false };
  PM.emitItemOnObject(used);
  assert.equal(f.p.getAttribute(UNLOCKED_ATTRIBUTE), true, "unlocked from the mounted one");
  assert.equal(f.p.getInventory().getAmount(TABLET), 0, "the tablet crumbles");
  rubHonour(f);
  assert.deepEqual(f.landed, [HONOUR_TILE], "the worn talisman goes there");
});
