// Run after `yarn build`: node --test tests/collection-log.test.cjs
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Sounds } = require("../dist/game/Sounds");
const Clog = require("../plugins/achievements/CollectionLog.plugin");
const Data = require("../plugins/achievements/collectionlog/Data.CollectionLog");
const Progress = require("../plugins/achievements/collectionlog/Progress.CollectionLog");
const Interface = require("../plugins/achievements/collectionlog/Interface.CollectionLog");

const ZULRAH_SCALES = 12934;
const TANZANITE_FANG = 12922;
const CARPENTERS_BOOTS = 24878;
const tasks = [];
/** Categories by name: the captures' keys come from live OSRS's newer cache (57 boss categories, ours has 55). */
const named = (tab, name) => Data.tabs()[tab].categories.find((category) => category.name === name);
const customEvents = new Map();
const sounds = [];
Sounds.sendSound = (_player, sound) => sounds.push(sound.getId?.() ?? sound.id);
const fakeApi = new Proxy({
  getTaskManager: () => ({ submit: (task) => { task.setRunning(true); tasks.push(task); } }),
  onCustomEvent: (name, handler) => customEvents.set(name, [...(customEvents.get(name) ?? []), handler]),
  emitCustomEvent: (name, request) => (customEvents.get(name) ?? []).forEach((handler) => handler(request)),
  core: {
    Task: require("../dist/game/task/Task").Task,
    World: { getProcessCycle: () => 0 },
    CacheDefinitions: require("../dist/game/cache/CacheDefinitions").CacheDefinitions,
    Sound: require("../dist/game/Sound").Sound,
    Sounds,
    PlayerRights: require("../dist/game/model/rights/PlayerRights").PlayerRights,
  },
}, { get: (target, key) => target[key] ?? (() => {}) });
Clog.register(fakeApi);
// The popup goes through the shared notifications queue.
require("../plugins/interface/Notifications.plugin").register(fakeApi);
const emit = (name, request) => (customEvents.get(name) ?? []).forEach((handler) => handler(request));

before(async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
});

const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");

function createPlayer() {
  const log = [];
  const attributes = new Map();
  const varps = new Map();
  const sender = {
    sendConfig: (id, value) => { varps.set(id, value | 0); log.push(`varp ${id}=${value}`); return sender; },
    sendVarbit: (id, value) => {
      const { baseVar, startBit, endBit } = CacheDefinitions.getVarbit(id);
      const mask = ((1 << (endBit - startBit + 1)) - 1) << startBit;
      varps.set(baseVar, ((varps.get(baseVar) ?? 0) & ~mask) | ((value << startBit) & mask));
      log.push(`varbit ${id}=${value}`);
      return sender;
    },
    getVarp: (id) => varps.get(id) ?? 0,
    getVarbit: (id) => {
      const { baseVar, startBit, endBit } = CacheDefinitions.getVarbit(id);
      return (sender.getVarp(baseVar) >> startBit) & ((1 << (endBit - startBit + 1)) - 1);
    },
    sendInterfaceRemoval: () => sender,
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
    "varp 2941=0",
    "varp 2942=0",
    `varbit 6906=${zulrah.key}`,
    `inv [[0,${ZULRAH_SCALES},109]] of ${Data.load().maxCategorySize}`,
    `script 7797 [0,${(621 << 16) | 10},${(621 << 16) | 11},${(621 << 16) | 12},${(621 << 16) | 13},471,${zulrah.key}]`,
  ]);
  customEvents.delete("collection-log:category-count");
});

test("raid categories send each cache mode counter before drawing and clear unused counts", () => {
  const cox = require("../plugins/minigames/cox/Rewards.ChambersOfXeric").collectionLogCount;
  const toa = require("../plugins/minigames/toa/Raid.TombsOfAmascut").collectionLogCount;
  customEvents.set("collection-log:category-count", [cox, toa]);
  try {
    const player = createPlayer();
    player.setAttribute("cox:kills", 3);
    player.setAttribute("cox:challenge-kills", 2);
    player.setAttribute("toa:completions", { entry: 4, normal: 5, expert: 6 });
    const check = (category, expected) => {
      player.log.length = 0;
      Interface.open(player, category);
      assert.deepEqual(player.log.filter((line) => /^varp (2048|2941|2942)=/.test(line)), expected);
      assert.ok(player.log.indexOf(expected[2]) < player.log.findIndex((line) => line.startsWith("script 7797")),
        "all mode counts reach the cache before it draws");
    };
    check("Tombs of Amascut", ["varp 2048=5", "varp 2941=4", "varp 2942=6"]);
    check("Chambers of Xeric", ["varp 2048=2", "varp 2941=3", "varp 2942=0"]);
    check("Zulrah", ["varp 2048=0", "varp 2941=0", "varp 2942=0"]);
    const fresh = createPlayer();
    Interface.open(fresh, "Tombs of Amascut");
    assert.deepEqual(fresh.log.filter((line) => /^varp (2048|2941|2942)=/.test(line)),
      ["varp 2048=0", "varp 2941=0", "varp 2942=0"], "new players start with zero in every mode");
  } finally {
    customEvents.delete("collection-log:category-count");
  }
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
  assert.deepEqual(player.log.slice(0, 6), ["varp 2048=0", "varp 2941=0", "varp 2942=0", "varbit 6906=0", "varbit 6905=3", "flags 621:27 0-21"]);
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

test("combined boss categories tally their category for every NPC in the group", async () => {
  const player = createPlayer();
  const npc = (name) => ({ getDefinition: () => ({ getName: () => name }) });
  const rolls = [
    "Dagannoth Rex", "Dagannoth Prime", "Dagannoth Supreme",
    "Callisto", "Artio",
    "Venenatis", "Spindel",
    "Vet'ion", "Calvar'ion",
    "Dusk",
  ];
  for (const name of rolls) Clog._test.onLoot({ player, drops: [], npc: npc(name) });
  await Promise.resolve();
  assert.equal(Progress.categoryCount(player, named(0, "Dagannoth Kings")), 3);
  assert.equal(Progress.categoryCount(player, named(0, "Callisto and Artio")), 2);
  assert.equal(Progress.categoryCount(player, named(0, "Venenatis and Spindel")), 2);
  assert.equal(Progress.categoryCount(player, named(0, "Vet'ion and Calvar'ion")), 2);
  assert.equal(Progress.categoryCount(player, named(0, "Grotesque Guardians")), 1);
  assert.equal(Progress.categoryCount(player, named(0, "Zulrah")), 0, "no other category is touched");
});

test("an extra loot roll logs its items without tallying a second kill", async () => {
  const player = createPlayer();
  const npc = { getDefinition: () => ({ getName: () => "Araxxor" }) };
  Clog._test.onLoot({ player, drops: [{ itemId: TANZANITE_FANG, amount: 1 }], npc });
  await Promise.resolve();
  assert.equal(Progress.categoryCount(player, named(0, "Araxxor")), 1);
  Clog._test.onLoot({ player, drops: [{ itemId: ZULRAH_SCALES, amount: 1 }], npc, countKill: false });
  await Promise.resolve();
  assert.equal(Progress.categoryCount(player, named(0, "Araxxor")), 1, "the pet/Nid roll is not a kill");
  assert.equal(Progress.obtained(player, ZULRAH_SCALES), 1, "but its item is still logged");
});

test("Nex and The Nightmare count one kill when the authoritative count and loot roll both fire", async () => {
  const player = createPlayer();
  const npc = (name) => ({ getDefinition: () => ({ getName: () => name }) });
  for (const [category, name] of [["Nex", "Nex"], ["The Nightmare", "The Nightmare"]]) {
    Clog._test.onCount({ player, category });
    Clog._test.onLoot({ player, drops: [], npc: npc(name), countKill: false });
  }
  await Promise.resolve();
  assert.equal(Progress.categoryCount(player, named(0, "Nex")), 1);
  assert.equal(Progress.categoryCount(player, named(0, "The Nightmare")), 1);
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

test("the notification preference treats Off as chosen, not unset, and restores it on login", () => {
  const player = createPlayer();
  player.setAttribute(Progress.NOTIFY_ATTRIBUTE, 0);
  Progress.restore({ player });
  assert.ok(player.log.includes(`varbit ${Progress.NOTIFY_VARBIT}=0`), "Off is sent back, not replaced by the default");
  player.log.length = 0;
  sounds.length = 0;
  assert.equal(Progress.obtain(player, CARPENTERS_BOOTS, 1), true);
  assert.deepEqual(player.log, ["varp 4848=1"], "Off: no chat message and no popup");
  assert.deepEqual(sounds, [], "Off: no jingle");
});

test("chat, popup and both each announce exactly their configured feedback", () => {
  for (const [setting, message, popup] of [[1, true, false], [2, false, true], [3, true, true]]) {
    const player = createPlayer();
    player.setAttribute(Progress.NOTIFY_ATTRIBUTE, setting);
    sounds.length = 0;
    Progress.obtain(player, CARPENTERS_BOOTS, 1);
    assert.equal(player.log.some((line) => line.startsWith("New item added")), message, `chat for ${setting}`);
    assert.equal(player.log.some((line) => line.startsWith("open 161:13")), popup, `popup for ${setting}`);
    assert.equal(sounds.length, popup ? 1 : 0, `jingle for ${setting}`);
  }
});

test("All Settings rows 85 and 171 toggle the chat and popup bits in varbit 11959", () => {
  const player = createPlayer();
  player.setAttribute(Progress.NOTIFY_ATTRIBUTE, 0);
  player.getPacketSender().sendVarbit(11866, 1); // precise timing, another bit of varp 2856
  const click = (settingId) => {
    const request = { player, settingId, handled: false };
    emit("settings:setting-clicked", request);
    assert.equal(request.handled, true, `setting ${settingId} is owned by the collection log`);
    return player.getAttribute(Progress.NOTIFY_ATTRIBUTE);
  };
  assert.equal(click(85), 1, "chat on");
  assert.ok(player.log.includes(`varbit ${Progress.NOTIFY_VARBIT}=1`));
  assert.equal(click(171), 3, "popup on too");
  assert.equal(click(85), 2, "chat off, popup on");
  assert.equal(click(171), 0, "both off");
  assert.equal(player.getPacketSender().getVarbit(11866), 1, "the other settings in varp 2856 are untouched");
});

test("one real click's varp transmission and setting click apply once, not twice", () => {
  const player = createPlayer();
  player.setAttribute(Progress.NOTIFY_ATTRIBUTE, 3);
  const transmission = { player, varpId: Progress.NOTIFY_VARP, value: 2 << 16, handled: false };
  emit("player:varp-transmit", transmission);
  const clicked = { player, settingId: 85, handled: false };
  emit("settings:setting-clicked", clicked);
  assert.equal(transmission.handled, true);
  assert.equal(clicked.handled, true);
  assert.equal(player.getAttribute(Progress.NOTIFY_ATTRIBUTE), 2, "not toggled back to 3");

  const player2 = createPlayer();
  player2.setAttribute(Progress.NOTIFY_ATTRIBUTE, 3);
  const clickedFirst = { player: player2, settingId: 85, handled: false };
  emit("settings:setting-clicked", clickedFirst);
  emit("player:varp-transmit", { player: player2, varpId: Progress.NOTIFY_VARP, value: 2 << 16, handled: false });
  assert.equal(player2.getAttribute(Progress.NOTIFY_ATTRIBUTE), 2, "either packet order ends on the client's value");
});

test("a transmitted varp 2856 keeps the notification bits and every unrelated shared bit", () => {
  const player = createPlayer();
  const { startBit, endBit } = CacheDefinitions.getVarbit(Progress.NOTIFY_VARBIT);
  const notifyMask = ((1 << (endBit - startBit + 1)) - 1) << startBit;
  const unrelated = (1 << 0) | (1 << 31);
  const value = unrelated | (2 << startBit);
  const transmission = { player, varpId: Progress.NOTIFY_VARP, value, handled: false };
  emit("player:varp-transmit", transmission);
  assert.equal(transmission.handled, true);
  assert.equal(player.getAttribute(Progress.NOTIFY_ATTRIBUTE), 2, "popup only");
  assert.ok(player.log.includes(`varp ${Progress.NOTIFY_VARP}=${value}`), "the whole shared varp is kept in step");
  player.log.length = 0;
  Progress.restore({ player });
  assert.ok(player.log.includes(`varbit ${Progress.NOTIFY_VARBIT}=2`));
  assert.equal(player.getPacketSender().getVarp(Progress.NOTIFY_VARP) & ~notifyMask, unrelated, "unrelated bits survive restore");

  const other = { player, varpId: 1234, value, handled: false };
  emit("player:varp-transmit", other);
  assert.equal(other.handled, false, "other varps are left alone");
});

test("pets report through the event", () => {
  const player = createPlayer();
  emit("collection-log:obtain", { player, itemId: 13181, ensure: true, silent: true });
  emit("collection-log:obtain", { player, itemId: 13181, ensure: true, silent: false });
  assert.equal(Progress.obtained(player, 13181), 1);
  assert.ok(!player.log.some((line) => line.startsWith("New item")), "silent, and ensured only once");
});

test("an optional category only records that category's items, and unscoped events are unchanged", () => {
  const player = createPlayer();
  emit("collection-log:obtain", { player, itemId: TANZANITE_FANG, amount: 1, category: "Zulrah" });
  assert.equal(Progress.obtained(player, TANZANITE_FANG), 1, "matching category");
  emit("collection-log:obtain", { player, itemId: ZULRAH_SCALES, amount: 1, category: "Barrows Chests" });
  assert.equal(Progress.obtained(player, ZULRAH_SCALES), 0, "mismatched category");
  emit("collection-log:obtain", { player, itemId: ZULRAH_SCALES, amount: 1, category: "No such category" });
  assert.equal(Progress.obtained(player, ZULRAH_SCALES), 0, "unknown category");
  emit("collection-log:obtain", { player, itemId: ZULRAH_SCALES, amount: 2 });
  assert.equal(Progress.obtained(player, ZULRAH_SCALES), 2, "unscoped existing callers unchanged");
});

test("reward-shop purchases log quantities, but unrelated shops and resold stock do not", () => {
  const player = createPlayer();
  const purchase = { player, shopName: "Mahogany Homes Reward Shop", itemId: CARPENTERS_BOOTS, amount: 2, originalStock: true };
  emit("shop:purchase", purchase);
  assert.equal(Progress.obtained(player, CARPENTERS_BOOTS), 2);
  emit("shop:purchase", { ...purchase, amount: 1 });
  assert.equal(Progress.obtained(player, CARPENTERS_BOOTS), 3);
  assert.equal(player.log.filter((line) => line.startsWith("New item")).length, 1);
  emit("shop:purchase", { ...purchase, shopName: "General Store" });
  emit("shop:purchase", { ...purchase, originalStock: false });
  assert.equal(Progress.obtained(player, CARPENTERS_BOOTS), 3);
  emit("shop:purchase", {
    player, shopName: "Petrified Pete's Ore Shop", itemId: 21697, amount: 1, originalStock: true,
  });
  assert.equal(Progress.obtained(player, 21697), 1, "the Volcanic Mine reward shop already credits");
});

test("every configured reward shop exists in canonical shop data", () => {
  const shops = require("../data/definitions/shops.json");
  for (const name of require("../plugins/achievements/collectionlog/data/reward-shops.json")) {
    assert.ok(shops.some((shop) => shop.name === name), name);
  }
});

test("Barrows logs its chest rewards once, including overflow, and uses its persisted chest tally", (t) => {
  const Barrows = require("../plugins/minigames/Barrows.plugin");
  Barrows.register(new Proxy({
    getRegionManager: () => ({ getRegionid: () => ({}) }),
    onCustomEvent: (name, handler) => customEvents.set(name, [...(customEvents.get(name) ?? []), handler]),
    emitCustomEvent: emit,
  }, { get: (target, key) => target[key] ?? (() => {}) }));
  const player = createPlayer();
  const delivered = [];
  player.getInventory = () => ({ forceAdd: (_player, item) => { delivered.push(item); return false; } });
  const sender = player.getPacketSender();
  sender.sendObject = sender.sendObjectRemoval = () => sender;
  sender.sendMessage = player.sendMessage;
  const run = { tunnel: 0, killed: [0, 1, 2, 3, 4, 5], points: 1000, kills: 6, chests: 8, chestOpen: true, looted: false };
  player.setAttribute("barrows", run);
  t.mock.method(Math, "random", () => 0);
  Barrows._test.searchChest(player, 1);
  assert.ok(delivered.length > 0);
  for (const item of delivered.filter((item) => Data.isLogged(item.getId()))) {
    assert.equal(Progress.obtained(player, item.getId()), item.getAmount());
  }
  assert.equal(Progress.categoryCount(player, named(0, "Barrows Chests")), 9);
  const firstDelivery = delivered.length;
  Barrows._test.searchChest(player, 1);
  assert.equal(delivered.length, firstDelivery, "an empty chest cannot deliver or log a second reward");
  assert.equal(Progress.categoryCount(player, named(0, "Barrows Chests")), 9);
  const restored = createPlayer();
  restored.setAttribute("barrows", JSON.parse(JSON.stringify(run)));
  assert.equal(Progress.categoryCount(restored, named(0, "Barrows Chests")), 9);
});

test("summary panels replace one another in both orders while other overlays survive", () => {
  const { PacketSender } = require("../dist/net/packet/PacketSender");
  const { FrameUpdater } = require("../dist/util/FrameUpdater");
  const CaInterface = require("../plugins/achievements/combatachievements/Interface.CombatAchievements");
  require("../plugins/achievements/combatachievements/Data.CombatAchievements")(fakeApi);
  CaInterface(fakeApi);
  fakeApi.onCustomEvent("combat-achievements:open", ({ player, collectionLogCategory }) => {
    if (collectionLogCategory) CaInterface.openForCollectionLog(player, collectionLogCategory);
    else CaInterface.open(player);
  });
  const player = createPlayer();
  let interfaceId = -1;
  const frames = [];
  const updater = new FrameUpdater();
  Object.assign(player, {
    getInterfaceId: () => interfaceId,
    setInterfaceId: (value) => { interfaceId = value; },
    getSession: () => ({ sendClientPacket: (frame) => { frames.push(frame); return true; } }),
    getFrameUpdater: () => updater,
    isPlayerBot: () => false,
  });
  const sender = new PacketSender(player);
  player.getPacketSender = () => sender;
  sender.sendSubInterface((161 << 16) | 13, 660, 1);
  const assertOnly = (expected) => {
    for (const group of [621, 908, ...Object.values(CaInterface.GROUP)]) {
      assert.equal(sender.isSubInterfaceOpen(group), group === expected, `group ${group}, expected ${expected}`);
    }
    assert.equal(sender.isSubInterfaceOpen(660), true, "notification overlay survives");
  };
  CaInterface.open(player, CaInterface.SCREEN.TASKS);
  assertOnly(715);
  Interface.open(player);
  assertOnly(621);
  assert.equal(player.getInterfaceId(), -1);
  CaInterface.open(player);
  assertOnly(715);
  CaInterface.open(player);
  assertOnly(715);
  Interface.open(player, "Zulrah");
  Interface.open(player);
  assertOnly(621);
  Interface.click({ player, buttonId: (621 << 16) | 73, slot: 12 });
  assertOnly(908);
  CaInterface.open(player);
  assertOnly(715);
  Interface.open(player, "Zulrah");
  Interface.click({ player, buttonId: (621 << 16) | 21 });
  assertOnly(713);
  CaInterface.click({ player, buttonId: (713 << 16) | 13 });
  assertOnly(621);
  assert.equal(Data.categoryByKey(Data.tabs()[0], player.getAttribute(Interface.CATEGORY_ATTRIBUTE)).name, "Zulrah");
});

test("every collection-log pet with a drop source is summonable", () => {
  const allPets = Data.load().categoriesByStruct.get(535);
  assert.ok(allPets, "All Pets category");
  const petItems = new Set(allPets.items);
  const { _test } = require("../plugins/npcs/NpcDrops.plugin");
  _test.loadDrops();
  const { PET_BY_ITEM_ID } = require("../plugins/npcs/Pets.plugin").__internals;
  const tables = new Map();
  for (const list of _test.tablesByNpc.values()) for (const table of list) tables.set(table.table_id, table);
  const check = (entry, where) => {
    if (!petItems.has(entry.item_id)) return;
    assert.ok(PET_BY_ITEM_ID.has(entry.item_id), `${entry.name} (${entry.item_id}) from ${where} must summon`);
  };
  for (const table of tables.values()) for (const entry of table.tertiary || []) check(entry, table.table_id);
  for (const entry of require("../plugins/bosses/data/grotesque-guardians.json").drops.tertiary) check(entry, "grotesque_guardians");
});

test("a newly earned item is told as collection-log:new-item, by any route, and a silent one isn't", () => {
  const heard = [];
  const listeners = customEvents.get("collection-log:new-item") ?? [];
  customEvents.set("collection-log:new-item", [...listeners, ({ itemId }) => heard.push(itemId)]);
  const player = createPlayer();
  Progress.obtain(player, ZULRAH_SCALES, 109, { silent: true });
  assert.deepEqual(heard, []);
  Progress.obtain(player, CARPENTERS_BOOTS, 1);
  Progress.obtain(player, CARPENTERS_BOOTS, 1);
  assert.deepEqual(heard, [CARPENTERS_BOOTS], "once, when it's new");
  customEvents.set("collection-log:new-item", listeners);
});

test("imported Corp sigils use one weighted access and still reach the log", async (t) => {
  const { _test, __internals } = require("../plugins/npcs/NpcDrops.plugin");
  _test.loadDrops();
  const corp = _test.tablesByNpc.get(319)[0];
  const sigils = corp.entries.filter((entry) => [12819, 12823, 12827].includes(entry.item_id));
  assert.deepEqual(
    sigils.map((entry) => [entry.item_id, entry.weight, entry.out_of, entry.roll_group, entry.group_access_weight, entry.group_access_out_of]),
    [
      [12823, 3, 7, "Sigils", 1, 585],
      [12827, 3, 7, "Sigils", 1, 585],
      [12819, 1, 7, "Sigils", 1, 585],
    ],
  );
  const sequence = (...values) => { let index = 0; return () => values[index++] ?? 0; };
  const dropPlayer = createPlayer();
  dropPlayer.getEquipment = () => ({ get: () => null, getItems: () => [] });

  // Access hits, then the weighted pick lands on each source weight in turn.
  for (const [roll, itemId] of [[0, 12823], [3 / 7, 12827], [6 / 7, 12819]]) {
    t.mock.method(Math, "random", sequence(0, roll));
    const rolled = __internals.rollOnce(corp, sigils, dropPlayer, true, null, []);
    assert.deepEqual(rolled.map((drop) => drop.itemId), [itemId]);
  }

  // A sigil hit replaces the main roll; tertiary rolls are still made.
  t.mock.method(Math, "random", () => 0);
  const hit = __internals.rollTable(corp, dropPlayer, null);
  const hitSigils = hit.filter((drop) => [12819, 12823, 12827].includes(drop.itemId));
  assert.equal(hitSigils.length, 1, "exactly one sigil per kill");
  assert.ok(!hit.some((drop) => drop.itemId === 4091), "main loot is replaced on a sigil hit");
  assert.ok(hit.some((drop) => corp.tertiary.some((entry) => entry.item_id === drop.itemId)), "tertiary rows still roll");

  // A miss keeps the ordinary main roll and reaches no sigil.
  t.mock.method(Math, "random", sequence(0.5, 0));
  const miss = __internals.rollTable(corp, dropPlayer, null);
  assert.ok(!miss.some((drop) => [12819, 12823, 12827].includes(drop.itemId)));
  assert.ok(miss.some((drop) => drop.itemId === 4091), "main loot is retained on a miss");

  // Always and tertiary rows survive a conditional access hit.
  const synthetic = {
    entries: [
      { item_id: 526, name: "Bones", quantity: [1, 1], always: true },
      ...sigils,
      { item_id: 4091, name: "Mystic robe top", quantity: [1, 1], weight: 1, out_of: 512 },
    ],
    main_max_roll: 512,
    tertiary: [{ item_id: 995, name: "Coins", quantity: [1, 1], weight: 1, out_of: 2 }],
  };
  t.mock.method(Math, "random", () => 0);
  const syntheticHit = __internals.rollTable(synthetic, dropPlayer, null);
  assert.equal(syntheticHit.filter((drop) => [12819, 12823, 12827].includes(drop.itemId)).length, 1);
  assert.ok(syntheticHit.some((drop) => drop.itemId === 526), "always drop preserved");
  assert.ok(syntheticHit.some((drop) => drop.itemId === 995), "tertiary drop preserved");
  assert.ok(!syntheticHit.some((drop) => drop.itemId === 4091), "main replaced on a group hit");

  const corpLog = createPlayer();
  Clog._test.onLoot({ player: corpLog, drops: hitSigils, npc: { getDefinition: () => ({ getName: () => "Corporeal Beast" }) } });
  await Promise.resolve();
  assert.equal(Progress.obtained(corpLog, hitSigils[0].itemId), 1);

  const branda = _test.tablesByNpc.get(12596)[0];
  const amulet = branda.entries.find((entry) => entry.name === "Giantsoul amulet");
  assert.equal(amulet.item_id, 30637);
  assert.equal(amulet.out_of, 16);
  t.mock.method(Math, "random", () => 0);
  const royal = __internals.rollOnce(branda, [amulet], createPlayer(), true, null, []);
  assert.deepEqual(royal.map((drop) => drop.itemId), [30637]);
  const royalLog = createPlayer();
  Clog._test.onLoot({ player: royalLog, drops: royal, npc: { getDefinition: () => ({ getName: () => "Branda the Fire Queen" }) } });
  await Promise.resolve();
  assert.equal(Progress.obtained(royalLog, 30637), 1);
  assert.equal(Progress.obtained(royalLog, 30638), 0);
});
