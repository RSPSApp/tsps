process.env.DISABLE_PLAYER_BOTS = "1";
// Run after `yarn build`: node --test tests/mixology-signet-chest.test.cjs
//
// The alchemist's signet chest in the Mastering Mixology basement, Open through real object clicks on the
// chest the map places at (1386, 9315): a real Player and the real plugins. Timings and lines are the
// rsprox.net captures' (recording 4185, rev 238); the loot tables and the loot line are the Wiki's.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { DropItemPacketListener } = require("../dist/net/packet/impl/DropItemPacketListener");

const CHEST_TILE = [1386, 9315, 0];
const STAND = [1386, 9314];
let core;
let I;
let chestId;
let openId;
let busyVarbit;
let next = 6800;
let clock = 0;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(CHEST_TILE[0], CHEST_TILE[1]);
  PM.emitServerStartup({});
  chestId = core.CacheDefinitions.getLocId("alchemist_signet_chest");
  openId = core.CacheDefinitions.getLocId("alchemist_signet_chest_open");
  busyVarbit = core.CacheDefinitions.getVarbitId("busy");
});
after(() => PM.emitServerShutdown({}));

function tick(f) {
  clock++;
  core.TaskManager.process();
  f.player.getMovementQueue().process();
  core.TaskManager.processWalkTo(f.player.getIndex());
}
const ticks = (f, n) => { for (let i = 0; i < n; i++) tick(f); };

function actor(t, { at = STAND } = {}) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("signet" + player.getIndex());
  player.setRegistered(true);
  player.setAttribute("bot-skip-persistence", true);
  player.setLocation(new core.Location(at[0], at[1], 0));
  player.needsPlacement = false;
  const connection = new ClientConnection(channel);
  connection.player = player;
  const f = { player, connection, inv: player.getInventory(), messages: [], sounds: [], animations: [], varbits: [], boxes: [] };
  const sender = player.getPacketSender();
  const sendMessage = sender.sendMessage.bind(sender);
  sender.sendMessage = (message) => { f.messages.push([clock, message]); return sendMessage(message); };
  const sendEffect = sender.sendSoundEffect.bind(sender);
  sender.sendSoundEffect = (id, loops, delay, ...rest) => { f.sounds.push([clock, id, delay]); return sendEffect(id, loops, delay, ...rest); };
  const sendVarbit = sender.sendVarbit.bind(sender);
  sender.sendVarbit = (id, value) => { if (id === busyVarbit) f.varbits.push([clock, value]); return sendVarbit(id, value); };
  const perform = player.performAnimation.bind(player);
  player.performAnimation = (animation) => { f.animations.push([clock, animation.getId()]); return perform(animation); };
  const dialogues = player.getDialogueManager();
  const start = dialogues.startDialogues.bind(dialogues);
  dialogues.startDialogues = (chain, ...rest) => {
    const first = chain?.dialogues instanceof Map ? [...chain.dialogues.values()][0] : null;
    f.boxes.push([clock, String(first?.text ?? "")]);
    return start(chain, ...rest);
  };
  t.after(() => {
    for (let i = 0; i < 6; i++) core.TaskManager.process();
    PM.emitPlayerLogout({ player, username: player.getUsername() });
    player.setRegistered(false);
    core.TaskManager.cancelTasks(player.getIndex());
    core.TaskManager.cancelTasks(player);
  });
  return f;
}

const chestLocation = () => new core.Location(...CHEST_TILE);
const shownIds = () => core.MapObjects.getObjectsAt(chestLocation(), null).map((o) => o.getId()).filter((id) => id === chestId || id === openId);

async function openChest(f) {
  const object = core.MapObjects.get(chestId, chestLocation(), null);
  assert.ok(object, `the map places the chest at ${CHEST_TILE}: ${shownIds()}`);
  const index = [...(core.CacheDefinitions.getObject(chestId).actions ?? [])].indexOf("Open");
  assert.ok(index >= 0);
  clock = -1;
  await f.connection.dispatch([{ type: "object_option", id: chestId, x: CHEST_TILE[0], y: CHEST_TILE[1], clickType: index + 1 }]);
  f.connection.processTurnPackets();
}

const Chest = () => require("../plugins/minigames/mixology/SignetChest.Mixology")._test;
function rolls(t, values) {
  let i = 0;
  Chest().setRandom(() => values[Math.min(i++, values.length - 1)]);
  t.after(() => Chest().setRandom(null));
}
const at = (f, text) => f.messages.find(([, message]) => message === text)?.[0];
const noted = (id) => core.ItemDefinition.forId(id).getNoteId();
const boxed = (f, text) => f.boxes.some(([, box]) => box.includes(text));

test("an open: signet line at 0, loot line, signet used and four stacks at 1, sound 51 at 2, closed at 3 (captures)", async (t) => {
  const f = actor(t);
  f.inv.add(new core.Item(I.ALCHEMISTS_SIGNET, 1), false);
  f.inv.add(new core.Item(I.ALCHEMISTS_SIGNET, 1), false);
  // aldarium (2 rolls), secondaries: mort myre at its most, useful: avantoe, combat: lantadyme (the last row).
  rolls(t, [0, 0, 0, 0.999, 0, 0, 0.999, 0]);
  const { MESSAGE } = Chest();
  await openChest(f);
  tick(f); // 0
  assert.equal(at(f, MESSAGE.UNLOCK), 0);
  assert.deepEqual(f.animations.filter(([, id]) => id >= 0), [[0, core.CacheDefinitions.getSeqId("human_openchest")]]);
  assert.deepEqual(shownIds(), [chestId]);
  tick(f); // 1
  assert.equal(at(f, MESSAGE.LOOT), 1);
  assert.equal(MESSAGE.LOOT, "You take some loot from inside..", "the Wiki's line");
  assert.equal(f.inv.getAmount(I.ALCHEMISTS_SIGNET), 1, "one signet used");
  assert.equal(f.inv.getAmount(noted(I.ALDARIUM)), 1);
  assert.equal(f.inv.getAmount(noted(I.MORT_MYRE_FUNGUS)), 8);
  assert.equal(f.inv.getAmount(noted(I.GRIMY_AVANTOE)), 1);
  assert.equal(f.inv.getAmount(noted(I.GRIMY_LANTADYME)), 2);
  assert.deepEqual(shownIds(), [openId], "open on the loot tick");
  tick(f); // 2
  assert.deepEqual(shownIds(), [openId]);
  tick(f); // 3
  assert.deepEqual(shownIds(), [chestId], "closed at 3");
  assert.deepEqual(f.sounds.map(([tick, id, delay]) => [tick, id, delay]), [[0, 52, 10], [2, 51, 15]]);
  assert.deepEqual(f.varbits, [[0, 1], [3, 0]], "busy from the signet line to the close");
});

test("seeds come unnoted, herbs and secondaries noted (Wiki)", async (t) => {
  const f = actor(t);
  f.inv.add(new core.Item(I.ALCHEMISTS_SIGNET, 1), false);
  const { SECONDARIES } = Chest();
  const total = SECONDARIES.reduce((sum, row) => sum + row[3], 0);
  const before = SECONDARIES.slice(0, SECONDARIES.findIndex(([key]) => key === "RANARR_SEED")).reduce((sum, row) => sum + row[3], 0);
  rolls(t, [0, 0, (before + 0.5) / total, 0.999, 0, 0, 0, 0]);
  await openChest(f);
  ticks(f, 5);
  assert.equal(f.inv.getAmount(I.RANARR_SEED), 2);
  assert.equal(f.inv.getAmount(noted(I.GRIMY_KWUARM)), 2);
  assert.equal(f.inv.getAmount(I.ALCHEMISTS_SIGNET), 0);
});

test("the tables: secondaries out of 25, the herb tables out of 16, combat herbs in twos (Wiki)", () => {
  const { SECONDARIES, USEFUL_HERBS, COMBAT_HERBS } = Chest();
  const sum = (table) => table.reduce((s, row) => s + row[3], 0);
  assert.equal(sum(SECONDARIES), 25);
  assert.equal(sum(USEFUL_HERBS), 16);
  assert.equal(sum(COMBAT_HERBS), 16);
  assert.ok(COMBAT_HERBS.every((row) => row[1] === 2 && row[2] === 2));
  assert.ok(SECONDARIES.filter(([key]) => key.endsWith("_SEED")).every((row) => row[4] === false));
});

test("without a signet: sound 2402 and the locked box; with three free slots: the four-spaces box (captures)", async (t) => {
  const f = actor(t);
  const { MESSAGE } = Chest();
  await openChest(f);
  ticks(f, 3);
  assert.ok(boxed(f, MESSAGE.LOCKED), JSON.stringify(f.boxes));
  assert.ok(f.sounds.some(([, id]) => id === 2402));
  assert.equal(at(f, MESSAGE.UNLOCK), undefined);
  assert.deepEqual(shownIds(), [chestId]);

  const g = actor(t);
  for (let slot = 0; slot < 25; slot++) g.inv.setItem(slot, new core.Item(I.TINDERBOX, 1));
  g.inv.setItem(0, new core.Item(I.ALCHEMISTS_SIGNET, 1));
  assert.equal(g.inv.getFreeSlots(), 3);
  await openChest(g);
  ticks(g, 3);
  assert.ok(boxed(g, MESSAGE.FULL), JSON.stringify(g.boxes));
  assert.equal(g.inv.getAmount(I.ALCHEMISTS_SIGNET), 1);
  assert.equal(at(g, MESSAGE.UNLOCK), undefined);
  assert.deepEqual(shownIds(), [chestId]);
});

test("a second click mid-open does not use a second signet", async (t) => {
  const f = actor(t);
  f.inv.add(new core.Item(I.ALCHEMISTS_SIGNET, 1), false);
  f.inv.add(new core.Item(I.ALCHEMISTS_SIGNET, 1), false);
  await openChest(f);
  tick(f);
  await openChest(f);
  ticks(f, 5);
  assert.equal(f.inv.getAmount(I.ALCHEMISTS_SIGNET), 1);
  assert.equal(f.messages.filter(([, message]) => message === Chest().MESSAGE.UNLOCK).length, 1);
});

test("a signet dropped after the click ends the open on the loot tick: no loot, busy cleared", async (t) => {
  const f = actor(t);
  f.inv.add(new core.Item(I.ALCHEMISTS_SIGNET, 1), false);
  await openChest(f);
  tick(f); // 0
  const slot = f.inv.getItems().findIndex((item) => item?.getId() === I.ALCHEMISTS_SIGNET);
  DropItemPacketListener.drop(f.player, I.ALCHEMISTS_SIGNET, core.Inventory.INTERFACE_ID, slot, true);
  ticks(f, 5);
  assert.equal(f.inv.getFreeSlots(), 28, "no loot");
  assert.equal(at(f, Chest().MESSAGE.LOOT), undefined);
  assert.deepEqual(shownIds(), [chestId]);
  assert.equal(f.varbits.at(-1)?.[1], 0, "busy cleared");
});
