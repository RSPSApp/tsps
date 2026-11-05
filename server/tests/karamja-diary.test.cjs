const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const Diaries = require("../plugins/achievements/AchievementDiaries.plugin");
const DiaryData = require("../plugins/achievements/diaries/Data.AchievementDiaries");
const Progress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");
const KaramjaDiary = require("../plugins/achievements/diaries/KaramjaDiary.plugin");
const EliteTaskProgress = require("../plugins/achievements/diaries/ArdougneEliteTaskProgress.plugin");

let core;
let emit;
const diary = DiaryData.BY_KEY.get("karamja");
const T = KaramjaDiary._test;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  const listeners = new Map();
  emit = (name, event) => (listeners.get(name) ?? []).forEach((handler) => handler(event));
  const api = new Proxy({
    core,
    persistAttribute() {},
    getTaskManager: () => ({ submit() {} }),
    onCustomEvent(name, handler) {
      const entries = listeners.get(name) ?? [];
      entries.push(handler);
      listeners.set(name, entries);
    },
    emitCustomEvent: emit,
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  Progress(api);
  api.onCustomEvent("diary:task", Diaries._test.onTask);
  EliteTaskProgress.register(api);
  KaramjaDiary.register(api);
  PluginManager.emitCustomEvent = emit;
});

function playerAt(x, y, z = 0, { cape = null, privateArea = null } = {}) {
  const attributes = new Map();
  const sender = { sendVarbit() { return sender; } };
  return {
    attributes,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getLocation: () => new core.Location(x, y, z),
    getPrivateArea: () => privateArea,
    isPlayer: () => true,
    isRegistered: () => true,
    sendMessage() {},
    getPacketSender: () => sender,
    getEquipment: () => ({ get: (slot) => cape == null ? null : { getId: () => cape, slot } }),
  };
}

const done = (player) => Progress.doneTasks(player, diary);
const obj = (name) => core.CacheDefinitions.getObjId(name);
const at = (box) => [Math.floor((box.minX + box.maxX) / 2), Math.floor((box.minY + box.maxY) / 2)];

test("five plantation bananas count; other banana trees do not", () => {
  const [x, y] = at(T.BANANA_PLANTATION);
  const player = playerAt(x, y);
  const tree = { getLocation: () => new core.Location(x, y, 0) };
  for (let i = 0; i < 4; i++) {
    emit("banana-tree:picked", { player, object: tree });
    assert.equal(done(player).has(T.BANANA_TASK), false);
  }
  emit("banana-tree:picked", { player, object: tree });
  assert.ok(done(player).has(T.BANANA_TASK));
  assert.equal(player.getAttribute("karamja-diary:bananas-picked"), 5);

  const ape = playerAt(2700, 2700);
  const apeTree = { getLocation: () => new core.Location(2700, 2700, 0) };
  for (let i = 0; i < 5; i++) emit("banana-tree:picked", { player: ape, object: apeTree });
  assert.equal(done(ape).has(T.BANANA_TASK), false);
});

test("a validated unfinished banana count interrupts Ardougne Elite progress", () => {
  const [x, y] = at(T.BANANA_PLANTATION);
  const player = playerAt(x, y);
  const task = EliteTaskProgress._test.MANTA_TASK;
  emit(EliteTaskProgress._test.STAGE_EVENT, { player, task, stage: "caught" });
  const query = () => {
    const request = { player, task };
    emit(EliteTaskProgress._test.QUERY_EVENT, request);
    return request.result;
  };
  assert.deepEqual(query(), { stage: "caught" });

  emit("banana-tree:picked", { player, object: { getLocation: () => new core.Location(x, y, 0) } });
  assert.equal(player.getAttribute("karamja-diary:bananas-picked"), 1);
  assert.equal(done(player).has(T.BANANA_TASK), false);
  assert.equal(query(), null);
});

test("five Karamja seaweed pickups count; another item or island does not", () => {
  const player = playerAt(2800, 3000);
  const pile = { getPosition: () => new core.Location(2800, 3000, 0) };
  for (let i = 0; i < 4; i++) {
    emit("ground-items:taken", { player, groundItem: pile, source: "pickup", itemId: core.ItemIdentifiers.SEAWEED, amount: 1 });
    assert.equal(done(player).has(T.SEAWEED_TASK), false);
  }
  emit("ground-items:taken", { player, groundItem: pile, source: "pickup", itemId: core.ItemIdentifiers.SEAWEED, amount: 1 });
  assert.ok(done(player).has(T.SEAWEED_TASK));

  const entrana = playerAt(2804, 3382);
  const entranaPile = { getPosition: () => new core.Location(2804, 3382, 0) };
  for (let i = 0; i < 5; i++) {
    emit("ground-items:taken", { player: entrana, groundItem: entranaPile, source: "pickup", itemId: core.ItemIdentifiers.SEAWEED, amount: 1 });
  }
  assert.equal(done(entrana).has(T.SEAWEED_TASK), false);
});

test("gold only in the north-west mine; red topaz from any gem rock", () => {
  const [x, y] = at(T.NORTH_BRIMHAVEN_MINE);
  const inMine = playerAt(x, y);
  emit("mining:success", { player: inMine, itemId: core.ItemIdentifiers.GOLD_ORE });
  assert.ok(done(inMine).has("mine-some-gold-from-the-rocks-on-the-north-west"));

  const elsewhere = playerAt(3200, 3200);
  emit("mining:success", { player: elsewhere, itemId: core.ItemIdentifiers.GOLD_ORE });
  assert.equal(done(elsewhere).has("mine-some-gold-from-the-rocks-on-the-north-west"), false);

  emit("mining:success", { player: elsewhere, itemId: core.ItemIdentifiers.UNCUT_RED_TOPAZ });
  assert.ok(done(elsewhere).has("mine-a-red-topaz-from-a-gem-rock"));
});

test("cooked spider on stick or shaft, and thoroughly cooked karambwan", () => {
  const player = playerAt(3000, 3000);
  emit("cooking:success", { player, itemId: obj("tbw_spider_on_stick_cooked") });
  assert.ok(done(player).has("cook-a-spider-on-a-stick"));
  const shaft = playerAt(3000, 3000);
  emit("cooking:success", { player: shaft, itemId: obj("tbw_spider_on_shaft_cooked") });
  assert.ok(done(shaft).has("cook-a-spider-on-a-stick"));

  const burnt = playerAt(3000, 3000);
  emit("cooking:success", { player: burnt, itemId: obj("tbw_spider_on_shaft_burnt") });
  assert.equal(done(burnt).has("cook-a-spider-on-a-stick"), false);

  emit("cooking:success", { player, itemId: core.ItemIdentifiers.COOKED_KARAMBWAN });
  assert.ok(done(player).has("cook-a-karambwan-thoroughly"));
  const poor = playerAt(3000, 3000);
  emit("cooking:success", { player: poor, itemId: obj("tbwt_poorly_cooked_karambwan") });
  assert.equal(done(poor).has("cook-a-karambwan-thoroughly"), false);
});

test("teak, mahogany, karambwan, oomlie wrap and nature runes", () => {
  const player = playerAt(3000, 3000);
  emit("woodcutting:success", { player, logId: core.ItemIdentifiers.TEAK_LOGS });
  emit("woodcutting:success", { player, logId: core.ItemIdentifiers.MAHOGANY_LOGS });
  assert.ok(done(player).has("cut-a-log-from-a-teak-tree"));
  assert.ok(done(player).has("cut-a-log-from-a-mahogany-tree"));

  emit("fishing:success", { player, itemId: core.ItemIdentifiers.RAW_KARAMBWAN });
  assert.ok(done(player).has("catch-a-karambwan"));

  emit("food:eaten", { player, itemId: core.ItemIdentifiers.COOKED_OOMLIE_WRAP });
  assert.ok(done(player).has("eat-an-oomlie-wrap"));

  emit("runecrafting:success", { player, runeId: core.ItemIdentifiers.NATURE_RUNE, rolls: 28, amountPerEssence: 2 });
  assert.ok(done(player).has("craft-some-nature-runes-from-essence"));
  assert.ok(done(player).has("craft-56-nature-runes-simultaneously-from-essenc"));

  const small = playerAt(3000, 3000);
  emit("runecrafting:success", { player: small, runeId: core.ItemIdentifiers.NATURE_RUNE, rolls: 27, amountPerEssence: 2 });
  assert.ok(done(small).has("craft-some-nature-runes-from-essence"));
  assert.equal(done(small).has("craft-56-nature-runes-simultaneously-from-essenc"), false);
});

test("Horseshoe mine antivenom, Mor Ul Rek cape, graahk and Shilo Slayer master", () => {
  const [x, y] = at(T.NORTH_BRIMHAVEN_MINE);
  const inMine = playerAt(x, y);
  emit("herblore:made", { player: inMine, itemId: obj("antivenom4") });
  assert.ok(done(inMine).has("create-an-antivenom-potion-whilst-standing-in-th"));
  const elsewhere = playerAt(3200, 3200);
  emit("herblore:made", { player: elsewhere, itemId: obj("antivenom4") });
  assert.equal(done(elsewhere).has("create-an-antivenom-potion-whilst-standing-in-th"), false);

  const [tx, ty] = at(T.MOR_UL_REK);
  const capePlayer = playerAt(tx, ty, 0, { cape: core.ItemIdentifiers.FIRE_CAPE });
  emit("equipment:changed", { player: capePlayer });
  assert.ok(done(capePlayer).has("equip-a-fire-cape-or-infernal-cape-in-mor-ul-rek"));
  const outside = playerAt(3200, 3200, 0, { cape: core.ItemIdentifiers.FIRE_CAPE });
  emit("equipment:changed", { player: outside });
  assert.equal(done(outside).has("equip-a-fire-cape-or-infernal-cape-in-mor-ul-rek"), false);

  const hunter = playerAt(3000, 3000);
  emit("hunter:success", { player: hunter, npcId: core.NpcIdentifiers.HORNED_GRAAHK });
  assert.ok(done(hunter).has("trap-a-horned-graahk"));

  const slayer = playerAt(3000, 3000);
  emit("slayer:task-assigned", { player: slayer, master: 5 });
  assert.ok(done(slayer).has("be-assigned-a-slayer-task-by-the-slayer-master-i"));
  const wrong = playerAt(3000, 3000);
  emit("slayer:task-assigned", { player: wrong, master: 3 });
  assert.equal(done(wrong).has("be-assigned-a-slayer-task-by-the-slayer-master-i"), false);
});

test("area-scoped NPC kills, including the Fight Cave Ket-Zek", () => {
  const kill = (name, location) => {
    const player = playerAt(3000, 3000);
    KaramjaDiary._test.npcKilled({ killer: player, npc: { getDefinition: () => ({ getName: () => name }) }, location });
    return player;
  };
  const jogre = kill("Jogre", { x: 2830, y: 9510, z: 0 });
  assert.ok(done(jogre).has("kill-a-jogre-in-the-pothole-dungeon"));
  assert.equal(done(kill("Jogre", { x: 3000, y: 3000, z: 0 })).has("kill-a-jogre-in-the-pothole-dungeon"), false);

  assert.ok(done(kill("Death wing", { x: 2800, y: 9300, z: 0 })).has("kill-a-deathwing-in-the-dungeon-under-the-kharaz"));
  assert.ok(done(kill("Iron dragon", { x: 2650, y: 9440, z: 0 })).has("kill-a-metal-dragon-in-brimhaven-dungeon"));
  assert.equal(done(kill("Iron dragon", { x: 2150, y: 9290, z: 0 })).has("kill-a-metal-dragon-in-brimhaven-dungeon"), false);
  assert.ok(done(kill("Ket-Zek", { x: 2400, y: 5080, z: 0 })).has("successfully-kill-a-ket-zek-in-the-fight-caves"));
});

test("shortcuts, ferries, glider, charter, Fight Pits and Tai Bwo Wannai favour", () => {
  const player = playerAt(3000, 3000);
  emit("agility:obstacle", { player, shortcut: "Ropeswing (Moss Giant Island, to the island)" });
  emit("agility:obstacle", { player, shortcut: "Rock slide (Cairn Isle, heading east)" });
  assert.ok(done(player).has("use-the-rope-swing-to-travel-to-the-small-island"));
  assert.ok(done(player).has("explore-cairn-island-to-the-west-of-karamja"));

  emit("ferries:departed", { player, route: "barnaby-ardougne", from: new core.Location(2773, 3229, 0) });
  assert.ok(done(player).has("travel-to-ardougne-via-the-port-near-brimhaven"));
  const other = playerAt(3000, 3000);
  emit("ferries:departed", { player: other, route: "barnaby-rimmington", from: new core.Location(2773, 3229, 0) });
  assert.equal(done(other).has("travel-to-ardougne-via-the-port-near-brimhaven"), false);

  emit("gnome-gliders:arrived", { player, destination: { index: 1, area: "Karamja" } });
  assert.ok(done(player).has("use-the-gnome-glider-to-travel-to-karamja"));

  emit("charter-ships:arrived", { player, from: { slug: "shipyard" }, to: { slug: "portsarim" } });
  assert.ok(done(player).has("charter-a-ship-from-the-shipyard-in-the-far-east"));

  emit("fight-pits:entered", { player });
  assert.ok(done(player).has("attempt-the-tzhaar-fight-pits-or-fight-cave"));
  emit("fight-pits:champion", { player });
  assert.ok(done(player).has("become-the-champion-of-the-fight-pits"));

  emit("tai-bwo-wannai-cleanup:favour-gained", { player, percentage: 100 });
  assert.ok(done(player).has("earn-100-favour-in-the-village-of-tai-bwo-wannai"));
  const less = playerAt(3000, 3000);
  emit("tai-bwo-wannai-cleanup:favour-gained", { player: less, percentage: 99 });
  assert.equal(done(less).has("earn-100-favour-in-the-village-of-tai-bwo-wannai"), false);
});

// Dialogue requests can be refused or report an existing task; only actual assignment counts.
test("Slayer assignment requests do not credit a refused or existing task", () => {
  const player = playerAt(2869, 2982);
  for (const master of ["Duradel", "Kuradal"]) {
    emit("slayer:assignment", { player, master, line: "You are not yet experienced enough." });
    assert.equal(done(player).has("be-assigned-a-slayer-task-by-the-slayer-master-i"), false);
  }
  emit("slayer:task-assigned", { player, master: 5 });
  assert.ok(done(player).has("be-assigned-a-slayer-task-by-the-slayer-master-i"));
});

test("only accepted Brimhaven departures count for the Ardougne ferry task", () => {
  const player = playerAt(2773, 3229);
  emit("ferries:travel", { player, route: "barnaby-ardougne", handled: false });
  assert.equal(done(player).has("travel-to-ardougne-via-the-port-near-brimhaven"), false);
  emit("ferries:departed", { player, route: "barnaby-ardougne", from: new core.Location(2916, 3225, 0) });
  assert.equal(done(player).has("travel-to-ardougne-via-the-port-near-brimhaven"), false);
  emit("ferries:departed", { player, route: "barnaby-ardougne", from: new core.Location(2773, 3229, 0) });
  assert.ok(done(player).has("travel-to-ardougne-via-the-port-near-brimhaven"));
});
