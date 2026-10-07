// Run after `yarn build`: node --test tests/collection-log.test.cjs
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Sounds } = require("../dist/game/Sounds");
const Clog = require("../plugins/collectionlog/CollectionLog.plugin");
const Data = require("../plugins/collectionlog/ClogData");
const Progress = require("../plugins/collectionlog/ClogProgress");
const Interface = require("../plugins/collectionlog/ClogInterface");

const ZULRAH_SCALES = 12934;
const TANZANITE_FANG = 12922;
const CARPENTERS_BOOTS = 24878;
const tasks = [];
/** Categories by name: the captures' keys come from live OSRS's newer cache (57 boss categories, ours has 55). */
const named = (tab, name) => Data.tabs()[tab].categories.find((category) => category.name === name);
const customEvents = new Map();
const sounds = [];
Sounds.sendSound = (_player, sound) => sounds.push(sound.getId?.() ?? sound.id);
Clog.register(new Proxy({
  getTaskManager: () => ({ submit: (task) => { task.setRunning(true); tasks.push(task); } }),
  onCustomEvent: (name, handler) => customEvents.set(name, [...(customEvents.get(name) ?? []), handler]),
  emitCustomEvent: (name, request) => (customEvents.get(name) ?? []).forEach((handler) => handler(request)),
}, { get: (target, key) => target[key] ?? (() => {}) }));
const emit = (name, request) => (customEvents.get(name) ?? []).forEach((handler) => handler(request));

before(async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
});

function createPlayer() {
  const log = [];
  const attributes = new Map();
  const sender = {
    sendConfig: (id, value) => { log.push(`varp ${id}=${value}`); return sender; },
    sendVarbit: (id, value) => { log.push(`varbit ${id}=${value}`); return sender; },
    getVarbit: () => 0,
    sendSubInterface: (target, group, type) => { log.push(`open ${target >>> 16}:${target & 0xffff} ${group} ${type}`); return sender; },
    closeSubInterface: (target) => { log.push(`close ${target >>> 16}:${target & 0xffff}`); return sender; },
    closeInterface: (group) => { log.push(`close ${group}`); return sender; },
    sendInterfaceScript: (id, args = [], _varps, _varbits, inventories) => {
      // An inventory carried on the script packet: its filled slots.
      const inv = inventories?.[620];
      if (inv) log.push(`inv ${JSON.stringify(inv.slots.filter((slot) => slot.itemId > 0).map((s) => [s.slot, s.itemId, s.quantity]))} of ${inv.capacity}`);
      log.push(`script ${id} [${args}]`);
      return sender;
    },
    sendInterfaceFlagsRange: (uid, from, to) => { log.push(`flags ${uid >>> 16}:${uid & 0xffff} ${from}-${to}`); return sender; },
    sendCollectionLogSnapshot: (slots) => { log.push(`inv ${JSON.stringify(slots.map((s) => [s.slot, s.itemId, s.quantity]))}`); return sender; },
  };
  return {
    log,
    getPacketSender: () => sender,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    sendMessage: (message) => log.push(message),
    isRegistered: () => true,
  };
}

function runTicks(n) {
  for (let i = 0; i < n; i++) for (const task of tasks.filter((t) => t.isRunning())) task.tick();
}

test("the log's contents come from the cache: 5 tabs, their categories and items", () => {
  const tabs = Data.tabs();
  assert.deepEqual(tabs.map((tab) => tab.name), ["Bosses", "Raids", "Clues", "Minigames", "Other"]);
  const zulrah = named(0, "Zulrah");
  assert.equal(zulrah.struct, 505, "as captured");
  assert.equal(zulrah.items.indexOf(ZULRAH_SCALES), 9, "scales are the 10th item");
  assert.equal(named(3, "Brimhaven Agility Arena").struct, 2873, "as captured");
  // The search's global category number: a tab's keys follow the key ranges of the tabs before it.
  tabs.forEach((tab, index) => assert.equal(tab.offset, index === 0 ? 0 : tabs[index - 1].offset + tabs[index - 1].maxKey + 1));
  assert.equal(Data.load().categoryTotal, tabs.at(-1).offset + tabs.at(-1).maxKey + 1);
  assert.ok(Data.isLogged(CARPENTERS_BOOTS));
});

test("as captured: a new item - message, sound and popup on the tick, counts 5 ticks on, popup closed at 13", () => {
  const player = createPlayer();
  tasks.length = 0;
  sounds.length = 0;
  assert.equal(Progress.obtain(player, CARPENTERS_BOOTS, 1), true);
  assert.deepEqual(player.log, [
    "varp 4848=1",
    "New item added to your collection log: <col=ff0000>Carpenter's boots</col>",
    "open 161:13 660 1",
    "script 3343 [Collection Log,New item:<br><br><col=ffffff>Carpenter's boots</col>,-1]",
  ]);
  assert.deepEqual(sounds, [2304]);
  player.log.length = 0;
  runTicks(4);
  assert.deepEqual(player.log, []);
  runTicks(1);
  assert.ok(player.log.includes("varp 2943=1") && player.log.includes("varp 4612=1"));
  assert.ok(player.log.includes("varp 4619=1"), "the minigames tab's count");
  assert.ok(player.log.includes(`varp 4623=${CARPENTERS_BOOTS}`) && player.log.includes(`varp 4624=${Progress.today()}`));
  player.log.length = 0;
  runTicks(8);
  assert.deepEqual(player.log, ["close 161:13"]);
  player.log.length = 0;
  assert.equal(Progress.obtain(player, CARPENTERS_BOOTS, 1), false, "already logged: counted, no message");
  assert.deepEqual(player.log, []);
  assert.equal(Progress.obtained(player, CARPENTERS_BOOTS), 2);
});

test("OSRS's day number: 8986 on the capture day", () => {
  assert.equal(Progress.today(Date.UTC(2026, 9, 5, 23, 5)), 8986);
});

test("as captured (Zulrah): the count, the category, the obtained items packed from slot 0, then the draw", () => {
  const player = createPlayer();
  Progress.obtain(player, ZULRAH_SCALES, 109, { silent: true });
  const answer = (request) => { if (request.category === "Zulrah") request.count = 1; };
  customEvents.set("collection-log:category-count", [answer]);
  player.log.length = 0;
  const zulrah = named(0, "Zulrah");
  Interface.click({ player, buttonId: (621 << 16) | 11, slot: zulrah.key });
  assert.deepEqual(player.log, [
    "varp 2048=1",
    `varbit 6906=${zulrah.key}`,
    `inv [[0,${ZULRAH_SCALES},109]] of ${Data.load().maxCategorySize}`,
    `script 7797 [0,${(621 << 16) | 10},${(621 << 16) | 11},${(621 << 16) | 12},${(621 << 16) | 13},471,${zulrah.key}]`,
  ]);
  customEvents.delete("collection-log:category-count");
});

test("empty latest items are -1 (the overview's script skips them; 0 would be Dwarf remains)", () => {
  const player = createPlayer();
  Progress.restore({ player });
  assert.ok(player.log.includes("varp 4623=-1") && player.log.includes("varp 4645=-1"));
  assert.ok(!player.log.includes("varp 4623=0"));
});

test("as captured: switching tab resets to its first category and enables its rows", () => {
  const player = createPlayer();
  Interface.click({ player, buttonId: (621 << 16) | 7 });
  assert.deepEqual(player.log.slice(0, 4), ["varp 2048=0", "varbit 6906=0", "varbit 6905=3", "flags 621:27 0-21"]);
  assert.equal(player.log.at(-1).startsWith("script 7797 [3,"), true);
});

test("as captured: typing in the search sends every obtained item once per category it is in", () => {
  const player = createPlayer();
  Progress.obtain(player, CARPENTERS_BOOTS, 1, { silent: true });
  Progress.obtain(player, ZULRAH_SCALES, 109, { silent: true });
  player.log.length = 0;
  Interface.click({ player, buttonId: (621 << 16) | 43 });
  assert.equal(player.log[0], `flags 621:84 0-${Data.load().categoryTotal}`);
  const boots = Data.categoriesOf(CARPENTERS_BOOTS)[0];
  assert.deepEqual(player.log.slice(1), [
    `script 4100 [${ZULRAH_SCALES},109,${named(0, "Zulrah").key},505]`,
    `script 4100 [${CARPENTERS_BOOTS},1,${Data.globalIndex(boots)},${boots.struct}]`,
  ]);
});

test("opening: the last category's items, the floater, its flags and the draw; the overview and back", () => {
  const player = createPlayer();
  Interface.open(player);
  assert.ok(player.log.includes("open 161:18 621 1"));
  assert.ok(player.log.includes("flags 621:73 10-12") && player.log.includes("flags 621:42 -1--1"));
  assert.equal(player.log.at(-1).startsWith("script 7797 [0,"), true);
  player.log.length = 0;
  Interface.click({ player, buttonId: (621 << 16) | 73, slot: 12 });
  assert.deepEqual(player.log.slice(0, 3), ["close 621", "script 2158 []", "open 161:18 908 1"]);
  player.log.length = 0;
  Interface.click({ player, buttonId: (908 << 16) | 22, slot: 4 });
  assert.deepEqual(player.log.slice(0, 3), ["varbit 6905=4", "close 908", "script 2158 []"]);
  assert.ok(player.log.includes("open 161:18 621 1"));
  // The overview's own burger "View Log" (slot 12) and its close button (908:9).
  Interface.click({ player, buttonId: (621 << 16) | 73, slot: 12 });
  player.log.length = 0;
  Interface.click({ player, buttonId: (908 << 16) | 7, slot: 12 });
  assert.deepEqual(player.log.slice(0, 2), ["close 908", "script 2158 []"]);
  assert.ok(player.log.includes("open 161:18 621 1"));
  Interface.click({ player, buttonId: (621 << 16) | 73, slot: 12 });
  player.log.length = 0;
  Interface.click({ player, buttonId: (908 << 16) | 9 });
  assert.deepEqual(player.log, ["close 908", "script 2158 []"]);
});

test("loot counts once every roll handler is done, and kills tally their category", async () => {
  const player = createPlayer();
  const drops = [{ itemId: TANZANITE_FANG, amount: 1 }];
  Clog._test.onLoot({ player, drops, npc: { getDefinition: () => ({ getName: () => "Zulrah" }) } });
  drops.push({ itemId: ZULRAH_SCALES, amount: 500 });
  await Promise.resolve();
  assert.equal(Progress.obtained(player, TANZANITE_FANG), 1);
  assert.equal(Progress.obtained(player, ZULRAH_SCALES), 500, "added by a later handler, still counted");
  assert.equal(Progress.categoryCount(player, named(0, "Zulrah")), 1);
});

test("login sends what is set; ::clog obtains, counts and resets", () => {
  const player = createPlayer();
  Progress.restore({ player });
  assert.ok(player.log.includes(`varp 2944=${Data.load().itemTotal}`) && player.log.includes("varbit 11959=3"));
  assert.ok(!player.log.some((line) => line.startsWith("varp 2943=")), "nothing obtained yet");
  const run = (command) => Clog._test.clogCommand({ player, parts: command.split(" ") });
  run("clog zulrah's scales 5");
  assert.equal(Progress.obtained(player, ZULRAH_SCALES), 5);
  run("clog count Zulrah 12");
  assert.equal(Progress.categoryCount(player, named(0, "Zulrah")), 12);
  run("clog reset");
  assert.equal(Progress.obtained(player, ZULRAH_SCALES), 0);
  run("clog bronze bar");
  assert.equal(player.log.at(-1), '"bronze bar" is not in the collection log.');
});

test("pets report through the event", () => {
  const player = createPlayer();
  emit("collection-log:obtain", { player, itemId: 13181, ensure: true, silent: true });
  emit("collection-log:obtain", { player, itemId: 13181, ensure: true, silent: false });
  assert.equal(Progress.obtained(player, 13181), 1);
  assert.ok(!player.log.some((line) => line.startsWith("New item")), "silent, and ensured only once");
});
