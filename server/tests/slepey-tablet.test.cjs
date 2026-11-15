// Run after `yarn build`: node --test tests/slepey-tablet.test.cjs
// The Slepey tablet (Wiki: Slepey tablet): Phosani's 1/25 roll comes from her drop table; on top of it the tablet is
// guaranteed on the 25th kill, and on any later kill for a player with no tablet who hasn't used one on Drakan's
// medallion. A second tablet picked up while one is held crumbles to dust.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PluginManager } = require("../dist/plugins/PluginManager");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Player } = require("../dist/game/entity/impl/player/Player");
const Common = require("../plugins/bosses/nightmare/Common.Nightmare");
const Loot = require("../plugins/bosses/nightmare/Loot.Nightmare");
const Medallion = require("../plugins/items/DrakansMedallion.plugin");

const SLEPEY_TABLET = 25837;
let core = null;
let api = null;
let placed = [];
let tableDrops = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  api = PluginManager.createApi("SlepeyTabletTest");
  Medallion.register(api);
  Common.init({
    core,
    emitCustomEvent(name, payload) {
      if (name === "npc-drops:roll-table") payload.drops.push(...tableDrops.map((drop) => ({ ...drop })));
    },
    getItemOnGroundManager: () => ({ registerLocation(player, item) { placed.push([player, item.getId()]); } }),
  });
});

function actor() {
  const player = new Player(null, new core.Location(3870, 9950, 3));
  player.setUsername("slepey-tablet-test");
  player.getSession = () => ({ sendClientPacket: () => true, write() {} });
  return player;
}

/** Phosani's kill with `kills` already counted; returns the tablets placed for the player. */
function killPhosani(player, kills) {
  player.setAttribute(Common.PHOSANI_KILLS_ATTRIBUTE, kills);
  placed = [];
  const fight = { phosani: true, boss: null, dream: { tile: () => new core.Location(3870, 9950, 3), area: null },
    contribution: new Map([[player, { shield: 1, totems: 1 }]]) };
  Loot.reward(fight, [player]);
  return placed.filter(([who, id]) => who === player && id === SLEPEY_TABLET).length;
}

test("the 25th Phosani's kill always gives the tablet, even to a player who has one", () => {
  tableDrops = [{ itemId: core.ItemIdentifiers.BIG_BONES, amount: 1 }];
  const player = actor();
  assert.equal(killPhosani(player, 23), 0, "the 24th kill: only her table's roll");
  player.getInventory().adds(SLEPEY_TABLET, 1);
  assert.equal(killPhosani(player, 24), 1, "the 25th kill");
});

test("past 25 kills, a player with no tablet and Slepe locked gets one on the next kill", () => {
  tableDrops = [{ itemId: core.ItemIdentifiers.BIG_BONES, amount: 1 }];
  const player = actor();
  assert.equal(killPhosani(player, 40), 1, "no tablet, Slepe locked");
  player.getBank(0).add(new core.Item(SLEPEY_TABLET, 1));
  assert.equal(killPhosani(player, 41), 0, "a banked tablet counts");
  const fresh = actor();
  fresh.setAttribute("drakans-medallion:slepe-unlocked", true);
  assert.equal(killPhosani(fresh, 41), 0, "already used on the medallion");
  const held = actor();
  held.getInventory().adds(SLEPEY_TABLET, 1);
  assert.equal(killPhosani(held, 41), 0, "already holding one");
});

test("a table roll that already holds the tablet isn't doubled", () => {
  tableDrops = [{ itemId: SLEPEY_TABLET, amount: 1 }];
  assert.equal(killPhosani(actor(), 24), 1);
});

test("a second tablet picked up while one is held crumbles to dust; the first is picked up as usual", (t) => {
  const removed = [];
  t.mock.method(api, "getItemOnGroundManager", () => ({ deregister: (item) => removed.push(item) }));
  const player = actor();
  const messages = [];
  t.mock.method(player, "sendMessage", (message) => messages.push(message));
  const groundItem = { getItem: () => new core.Item(SLEPEY_TABLET, 1) };
  const first = { player, groundItem, handled: false };
  Medallion._test.crumbleSpareTablet(first);
  assert.equal(first.handled, false, "no tablet held: the normal pickup goes ahead");
  player.getInventory().adds(SLEPEY_TABLET, 1);
  const second = { player, groundItem, handled: false };
  Medallion._test.crumbleSpareTablet(second);
  assert.equal(second.handled, true);
  assert.deepEqual(removed, [groundItem]);
  assert.deepEqual(messages, ["The tablet crumbles to dust as you touch it."]);
  assert.equal(player.getInventory().getAmount(SLEPEY_TABLET), 1);
});

/** A player whose packets are recorded: varbits, sounds and opened interfaces. */
function recordingActor() {
  const player = actor();
  const sent = { varbits: [], sounds: [], texts: [], objects: [], opened: [], messages: [] };
  const sender = player.getPacketSender();
  const sendVarbit = sender.sendVarbit.bind(sender);
  sender.sendVarbit = (id, value) => { sent.varbits.push([id, value]); return sendVarbit(id, value); };
  sender.sendSoundEffect = (id, loops, delay) => { sent.sounds.push([id, delay]); return sender; };
  const sendString = sender.sendString?.bind(sender);
  sender.sendString = (uid, text) => { sent.texts.push([uid >> 16, text]); return sendString ? sendString(uid, text) : sender; };
  const sendItemOnInterface = sender.sendItemOnInterface?.bind(sender);
  sender.sendItemOnInterface = (uid, itemId, ...rest) => {
    sent.objects.push([uid >> 16, uid & 0xffff, itemId]);
    return sendItemOnInterface ? sendItemOnInterface(uid, itemId, ...rest) : sender;
  };
  const sendChatboxInterface = sender.sendChatboxInterface?.bind(sender);
  sender.sendChatboxInterface = (id, ...rest) => { sent.opened.push(id); return sendChatboxInterface ? sendChatboxInterface(id, ...rest) : sender; };
  return { player, sent };
}

function useTablet(player) {
  const inventory = player.getInventory();
  inventory.adds(core.ItemIdentifiers.DRAKANS_MEDALLION, 1);
  inventory.adds(SLEPEY_TABLET, 1);
  const event = {
    player,
    usedItemId: SLEPEY_TABLET, usedItemSlot: inventory.getSlotForItemId(SLEPEY_TABLET),
    usedWithItemId: core.ItemIdentifiers.DRAKANS_MEDALLION, usedWithItemSlot: inventory.getSlotForItemId(core.ItemIdentifiers.DRAKANS_MEDALLION),
    handled: false,
  };
  Medallion._test.useSlepeyTablet(event);
  return event;
}

test("the tablet on the medallion: varbit, sounds 581 and 3146, and both items in objectbox_double (rsprox 3389 tick 1888)", () => {
  const { player, sent } = recordingActor();
  const varbit = core.CacheDefinitions.getVarbitId("slepe_teleport_unlocked");
  assert.equal(varbit, 12416);
  const event = useTablet(player);
  assert.equal(event.handled, true);
  assert.equal(player.getInventory().getAmount(SLEPEY_TABLET), 0, "the tablet is used up");
  assert.equal(player.getAttribute("drakans-medallion:slepe-unlocked"), true);
  assert.deepEqual(sent.varbits.filter(([id]) => id === varbit), [[varbit, 1]]);
  assert.deepEqual(sent.sounds, [[581, 0], [3146, 10]]);
  const dialogue = player.getDialogueManager();
  const current = dialogue.getCurrent?.() ?? dialogue.current;
  assert.equal(current?.constructor?.name, "DoubleItemStatementDialogue");
  assert.deepEqual(current.getItemIds(), [core.ItemIdentifiers.DRAKANS_MEDALLION, SLEPEY_TABLET]);
  assert.equal(current.getText(), Medallion._test.TABLET_USED_MESSAGE);
  assert.match(current.getText(), /^As the medallion and tablet are held together, .* the medallion feels somehow different\.$/);
});

test("a second use once Slepe is unlocked keeps the tablet and sends nothing", () => {
  const { player, sent } = recordingActor();
  player.setAttribute("drakans-medallion:slepe-unlocked", true);
  useTablet(player);
  assert.equal(player.getInventory().getAmount(SLEPEY_TABLET), 1);
  assert.deepEqual(sent.sounds, []);
  assert.deepEqual(sent.varbits, [], "no varbit");
  assert.equal(player.getDialogueManager().getCurrent(), undefined, "no box opens");
});

test("login sends slepe_teleport_unlocked only for a player who unlocked Slepe", () => {
  const varbit = core.CacheDefinitions.getVarbitId("slepe_teleport_unlocked");
  const locked = recordingActor();
  Medallion._test.syncSlepeVarbit({ player: locked.player });
  assert.deepEqual(locked.sent.varbits, []);
  const unlocked = recordingActor();
  unlocked.player.setAttribute("drakans-medallion:slepe-unlocked", true);
  Medallion._test.syncSlepeVarbit({ player: unlocked.player });
  assert.deepEqual(unlocked.sent.varbits, [[varbit, 1]]);
});

test("Inspect shows the tablet's two objectbox pages (rsprox 3389 tick 1830)", () => {
  const { player } = recordingActor();
  const event = { player, itemId: SLEPEY_TABLET, option: "Inspect" };
  assert.equal(Medallion._test.inspectTablet(event), true);
  const dialogue = player.getDialogueManager();
  const current = dialogue.getCurrent?.() ?? dialogue.current;
  assert.equal(current?.constructor?.name, "ItemStatementDialogue");
  assert.equal(current.getItemId(), SLEPEY_TABLET);
  assert.equal(current.getText(), Medallion._test.INSPECT_MESSAGES[0]);
  assert.equal(Medallion._test.INSPECT_MESSAGES.length, 2);
  assert.match(Medallion._test.INSPECT_MESSAGES[1], /^He must have stored one of his best spells in this tablet, perhaps .*utilise it\?$/);
});

test("the plugin registers the tablet's Inspect option and the login sync", () => {
  const registered = { actions: [], events: [] };
  const stub = { ...api, core,
    persistAttribute() {}, onItemOnItem() {}, onGroundItemPickup() {},
    onItemAction(name, options) { registered.actions.push([name, Object.keys(options)]); },
    onCustomEvent(name) { registered.events.push(name); },
  };
  Medallion.register(stub);
  Medallion.register(api);
  assert.ok(registered.actions.some(([name, options]) => name === "Slepey tablet" && options.includes("Inspect")));
  assert.ok(registered.events.includes("player:bootstrap-complete"));
});
