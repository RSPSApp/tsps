// Run after `yarn build`: node --test tests/morytania-diary.test.cjs
//
// Drives Morytania.AchievementDiaries through the same custom events the gameplay plugins emit,
// and checks the real Progress store for both credit and the negative cases. The cache object,
// NPC and patch ids are the ones named in the module and in the Wiki task list.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Location } = require("../dist/game/model/Location");
const ItemIdentifiers = require("../dist/util/ItemIdentifiers").ItemIdentifiers;
const NpcIdentifiers = require("../dist/util/NpcIdentifiers").NpcIdentifiers;
const Equipment = require("../dist/game/model/container/impl/Equipment").Equipment;
const { Task } = require("../dist/game/task/Task");

const Data = require("../plugins/achievements/diaries/Data.AchievementDiaries");
const Progress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");
const Morytania = require("../plugins/achievements/diaries/Morytania.AchievementDiaries");
const MORY = Data.BY_KEY.get("morytania");

let handlers;
let registryApi;
const npcActions = new Map();
const buttonHandlers = [];

function emit(name, payload) {
  for (const fn of handlers.get(name) ?? []) fn(payload);
}

function on(name, fn) {
  if (!handlers.has(name)) handlers.set(name, []);
  handlers.get(name).push(fn);
}

function installApi() {
  handlers = new Map();
  npcActions.clear();
  buttonHandlers.length = 0;
  const api = {
    core: { ItemIdentifiers, NpcIdentifiers, Equipment, Task },
    persistAttribute() {},
    onCustomEvent: on,
    emitCustomEvent: (name, request) => {
      if (name === "diary:task") Progress.completeTask(request.player, MORY, request.task);
      emit(name, request);
    },
    getTaskManager: () => ({ submit: (task) => { task.setRunning(true); } }),
  };
  for (const hook of ["onPlayerLogin", "onPlayerLogout", "onPlayerMapSquareChange", "onNpcDeath"]) {
    api[hook] = (fn) => on(hook, fn);
  }
  api.onNpcsInteraction = (names, actions) => { for (const name of names) npcActions.set(name, actions); };
  api.onNpcInteraction = (name, actions) => npcActions.set(name, actions);
  api.onInterfaceActionButton = (_ids, handler) => buttonHandlers.push(handler);
  Progress(api);
  Morytania(api);
  registryApi = api;
}

function tanPlayer() {
  const player = createPlayer({ x: 3500, y: 3500 });
  const amounts = new Map([[1739, 1], [995, 100]]);
  player.getInventory = () => ({
    getAmount: (id) => amounts.get(id) ?? 0,
    deleteNumber: (id, amount) => amounts.set(id, (amounts.get(id) ?? 0) - amount),
    adds: (id, amount) => amounts.set(id, (amounts.get(id) ?? 0) + amount),
    refreshItems() {},
  });
  const sender = {
    sendInterface() { return sender; },
    sendInterfaceRemoval() { return sender; },
    sendItemOnInterfaces() { return sender; },
    sendString() { return sender; },
    sendEnterAmountPrompt() { return sender; },
    sendVarbit: (id, value) => player.varbits.push([id, value]),
  };
  player.getPacketSender = () => sender;
  return player;
}

test("tanning: the real Sbott handler credits the diary task only after a hide is tanned", () => {
  require("../plugins/npcs/Tanning.plugin").register(registryApi);
  const player = tanPlayer();
  const npc = { isRegistered: () => true, getCurrentDefinition: () => ({ getName: () => "Sbott" }) };
  npcActions.get("Sbott").Trade({ player, npc, definition: { getName: () => "Sbott" } });
  buttonHandlers[0]({ player, buttonId: (324 << 16) | 124 });
  assert.ok(has(player, "have-sbott-in-canifis-tan-something-for-you"));
});

function createPlayer({ x = 3500, y = 3500, z = 0, equipment = [], weapon = null, prayer = [], attributes = new Map() } = {}) {
  const varbits = [];
  const items = equipment.map((entry) => ({
    getId: () => entry.id,
    getDefinition: () => ({ getName: () => entry.name }),
  }));
  if (weapon) items[Equipment.WEAPON_SLOT] = { getId: () => weapon.id, getDefinition: () => ({ getName: () => weapon.name }) };
  const sender = { sendVarbit: (id, value) => varbits.push([id, value]) };
  const player = {
    varbits,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getLocation: () => new Location(x, y, z),
    getPacketSender: () => sender,
    sendMessage() {},
    isRegistered: () => true,
    isPlayer: () => true,
    getDialogueManager: () => ({ startDialogues() {} }),
    getSkillManager: () => ({ getCurrentLevel: () => 99, getMaxLevel: () => 99 }),
    getPrayerActive: () => prayer,
    getEquipment: () => ({
      get: (slot) => items[slot] ?? null,
      getItems: () => items.filter(Boolean),
    }),
  };
  return player;
}

const done = (player) => Progress.doneTasks(player, MORY);
const has = (player, task) => done(player).has(task);

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  installApi();
});

test("easy: the completely supported native actions credit their tasks", () => {
  let player = createPlayer();
  emit("cooking:success", { player, itemId: ItemIdentifiers.THIN_SNAIL_MEAT, objectId: 16641 });
  emit("slayer:task-assigned", { player, master: 2 });
  emit("tanning:done", { player, tanner: "Sbott" });
  emit("ectofuntus:worshipped", { player });
  emit("mort-myre:entered", { player });
  emit("farming:scarecrow", { player, patch: { id: 7850 } });
  assert.deepEqual([...done(player)].sort(), [
    "cook-a-thin-snail-on-the-port-phasmatys-range",
    "enter-mort-myre-swamp",
    "get-a-slayer-task-from-the-slayer-master-in-cani",
    "have-sbott-in-canifis-tan-something-for-you",
    "offer-some-bonemeal-at-the-ectofuntus",
    "place-a-scarecrow-in-the-morytania-flower-patch",
  ]);

  emit("altar:nature", { player });
  assert.ok(has(player, "restore-your-prayer-points-at-the-nature-altar"));
});

test("easy: kills check the NPC, the Slayer Tower and the Wolfbane dagger", () => {
  const player = createPlayer();
  const npc = (name) => ({ getCurrentDefinition: () => ({ getName: () => name }) });
  emit("onNpcDeath", { killer: player, npc: npc("Banshee"), location: { x: 3429, y: 3564, z: 0 } });
  emit("onNpcDeath", { killer: player, npc: npc("Ghoul"), location: { x: 3412, y: 3512, z: 0 } });
  assert.ok(has(player, "kill-a-banshee-in-the-slayer-tower"));
  assert.ok(has(player, "kill-a-ghoul"));

  // A Banshee outside the tower does not count.
  const outside = createPlayer();
  emit("onNpcDeath", { killer: outside, npc: npc("Banshee"), location: { x: 3000, y: 3000, z: 0 } });
  assert.ok(!has(outside, "kill-a-banshee-in-the-slayer-tower"));

  // Wolfbane in the weapon slot, and only then.
  const armed = createPlayer({ weapon: { id: ItemIdentifiers.WOLFBANE, name: "Wolfbane" } });
  emit("onNpcDeath", { killer: armed, npc: npc("Boris"), npcId: NpcIdentifiers.BORIS, location: { x: 3603, y: 3321, z: 0 } });
  assert.ok(has(armed, "kill-a-werewolf-in-its-human-form-using-the-wolf"));
  const unarmed = createPlayer();
  emit("onNpcDeath", { killer: unarmed, npc: npc("Boris"), npcId: NpcIdentifiers.BORIS, location: { x: 3603, y: 3321, z: 0 } });
  assert.ok(!has(unarmed, "kill-a-werewolf-in-its-human-form-using-the-wolf"));

  // Wrong location for a Fever spider.
  const wrongIsland = createPlayer();
  emit("onNpcDeath", { killer: wrongIsland, npc: npc("Fever spider"), location: { x: 3000, y: 3000, z: 0 } });
  assert.ok(!has(wrongIsland, "kill-a-fever-spider-on-braindeath-island"));
});

test("medium: swamp lizard, bark, cannonballs, ectophial and the Slayer Tower demon", () => {
  const player = createPlayer();
  emit("hunter:success", { player, npcId: NpcIdentifiers.SWAMP_LIZARD, method: "swamp" });
  emit("woodcutting:success", { player, logId: ItemIdentifiers.BARK, logAmount: 1 });
  emit("onNpcDeath", { killer: player, npc: { getCurrentDefinition: () => ({ getName: () => "Abyssal demon" }) }, location: { x: 3427, y: 9965, z: 0 } });
  assert.ok(has(player, "catch-a-swamp-lizard"));
  assert.ok(has(player, "obtain-some-bark-from-a-hollow-tree"));
  assert.ok(has(player, "kill-an-abyssal-demon-in-the-slayer-tower"));

  const cannon = createPlayer({ x: 3688, y: 3478 });
  emit("smithing:success", { player: cannon, itemId: ItemIdentifiers.STEEL_CANNONBALL });
  assert.ok(has(cannon, "make-a-batch-of-steel-cannonballs-at-the-port-ph"));
  const elsewhere = createPlayer({ x: 3200, y: 3200 });
  emit("smithing:success", { player: elsewhere, itemId: ItemIdentifiers.STEEL_CANNONBALL });
  assert.ok(!has(elsewhere, "make-a-batch-of-steel-cannonballs-at-the-port-ph"));

  const phial = createPlayer({ x: 3659, y: 3522 });
  emit("ectophial:arrived", { player: phial });
  assert.ok(has(phial, "use-an-ectophial-to-return-to-port-phasmatys"));
  const wrongSpot = createPlayer({ x: 3200, y: 3200 });
  emit("ectophial:arrived", { player: wrongSpot });
  assert.ok(!has(wrongSpot, "use-an-ectophial-to-return-to-port-phasmatys"));
});

test("hard: advanced spike chain, the Salve rocks, farming patches, mithril and the POH portal", () => {
  const player = createPlayer();
  emit("agility:obstacle", { player, shortcut: "Spikey chain (Slayer Tower)", location: { x: 3447, y: 3576, z: 2 } });
  emit("agility:obstacle", { player, shortcut: "Rocks (Mort Myre, down)", location: { x: 3423, y: 3476, z: 0 } });
  emit("farming:harvested", { player, crop: "WATERMELON", patch: { id: 21950 } });
  emit("farming:harvested", { player, crop: "MUSHROOM", patch: { id: 8337 } });
  emit("farming:spell-fertilized", { player, spell: "fertile soil", patch: { id: 8153 } });
  emit("mining:success", { player: createPlayer({ x: 3032, y: 9716 }), itemId: ItemIdentifiers.MITHRIL_ORE });
  emit("construction:portal", { player, destination: "kharyrll teleport" });
  assert.ok(has(player, "climb-the-advanced-spike-chain-within-slayer-tow"));
  assert.ok(has(player, "use-the-shortcut-to-get-to-the-bridge-over-the-s"));
  assert.ok(has(player, "harvest-some-watermelon-from-the-allotment-patch"));
  assert.ok(has(player, "harvest-some-bittercap-mushrooms-from-the-patch"));
  assert.ok(has(player, "fertilize-the-morytania-herb-patch-using-lunar-m"));

  // The basic spike chain, a non-Lunar fertilise and another ore do not count.
  const other = createPlayer();
  emit("agility:obstacle", { player: other, shortcut: "Spikey chain (Slayer Tower)", location: { x: 3422, y: 3550, z: 1 } });
  emit("farming:spell-fertilized", { player: other, spell: "cure plant", patch: { id: 8153 } });
  emit("mining:success", { player: other, itemId: ItemIdentifiers.IRON_ORE });
  assert.ok(!has(other, "climb-the-advanced-spike-chain-within-slayer-tow"));
  assert.ok(!has(other, "fertilize-the-morytania-herb-patch-using-lunar-m"));
  assert.ok(!has(other, "mine-some-mithril-ore-in-the-abandoned-mine"));
});

test("hard: mahogany needs the chop before the burn, both on Mos Le'Harmless", () => {
  const player = createPlayer({ x: 3700, y: 3000 });
  emit("firemaking:success", { player, itemId: ItemIdentifiers.MAHOGANY_LOGS });
  assert.ok(!has(player, "chop-and-burn-some-mahogany-logs-on-mos-le-harml"), "burn alone does not count");
  emit("woodcutting:success", { player, logId: ItemIdentifiers.MAHOGANY_LOGS, logAmount: 1 });
  emit("firemaking:success", { player, itemId: ItemIdentifiers.MAHOGANY_LOGS });
  assert.ok(has(player, "chop-and-burn-some-mahogany-logs-on-mos-le-harml"));

  const elsewhere = createPlayer({ x: 3200, y: 3200 });
  emit("woodcutting:success", { player: elsewhere, logId: ItemIdentifiers.MAHOGANY_LOGS, logAmount: 1 });
  emit("firemaking:success", { player: elsewhere, itemId: ItemIdentifiers.MAHOGANY_LOGS });
  assert.ok(!has(elsewhere, "chop-and-burn-some-mahogany-logs-on-mos-le-harml"));
});

test("elite: magic/redwood cremation, Canifis d'hide body and a full Barrows set", () => {
  const player = createPlayer();
  emit("shades-of-mortton:cremated", { player, wood: "magic" });
  assert.ok(has(player, "cremate-any-shade-remains-on-a-magic-or-redwood"));
  const redwood = createPlayer();
  emit("shades-of-mortton:cremated", { player: redwood, wood: "redwood" });
  assert.ok(has(redwood, "cremate-any-shade-remains-on-a-magic-or-redwood"));
  const otherWood = createPlayer();
  emit("shades-of-mortton:cremated", { player: otherWood, wood: "logs" });
  assert.ok(!has(otherWood, "cremate-any-shade-remains-on-a-magic-or-redwood"));

  const body = createPlayer({ x: 3510, y: 3480 });
  emit("crafting:made", { player: body, itemId: ItemIdentifiers.BLACK_DHIDE_BODY });
  assert.ok(has(body, "craft-a-black-dragonhide-body-in-canifis-bank"));
  const elsewhere = createPlayer({ x: 3200, y: 3200 });
  emit("crafting:made", { player: elsewhere, itemId: ItemIdentifiers.BLACK_DHIDE_BODY });
  assert.ok(!has(elsewhere, "craft-a-black-dragonhide-body-in-canifis-bank"));

  const set = createPlayer({
    equipment: [
      { id: ItemIdentifiers.DHAROKS_HELM, name: "Dharok's helm" },
      { id: ItemIdentifiers.DHAROKS_GREATAXE, name: "Dharok's greataxe" },
      { id: ItemIdentifiers.DHAROKS_PLATEBODY, name: "Dharok's platebody" },
      { id: ItemIdentifiers.DHAROKS_PLATELEGS, name: "Dharok's platelegs" },
    ],
  });
  emit("barrows:chest-looted", { player: set });
  assert.ok(has(set, "loot-the-barrows-chest-while-wearing-any-complet"));

  const partial = createPlayer({
    equipment: [
      { id: ItemIdentifiers.DHAROKS_HELM, name: "Dharok's helm" },
      { id: ItemIdentifiers.DHAROKS_GREATAXE, name: "Dharok's greataxe" },
      { id: ItemIdentifiers.DHAROKS_PLATEBODY, name: "Dharok's platebody" },
      { id: ItemIdentifiers.TORAGS_HELM, name: "Torag's helm" },
    ],
  });
  emit("barrows:chest-looted", { player: partial });
  assert.ok(!has(partial, "loot-the-barrows-chest-while-wearing-any-complet"));
});

test("nature altar: the hard task needs Piety active, and only a real restore reports", () => {
  const piety = createPlayer({ prayer: Array.from({ length: 30 }, (_, index) => index === 26) });
  emit("altar:nature", { player: piety });
  assert.ok(has(piety, "restore-your-prayer-points-at-the-nature-altar"));
  assert.ok(has(piety, "pray-at-the-altar-of-nature-with-piety-activated"));

  const noPiety = createPlayer();
  emit("altar:nature", { player: noPiety });
  assert.ok(has(noPiety, "restore-your-prayer-points-at-the-nature-altar"));
  assert.ok(!has(noPiety, "pray-at-the-altar-of-nature-with-piety-activated"));
});

test("each task is credited once, however often the action repeats", () => {
  const player = createPlayer();
  emit("ectofuntus:worshipped", { player });
  emit("ectofuntus:worshipped", { player });
  assert.equal([...done(player)].filter((key) => key === "offer-some-bonemeal-at-the-ectofuntus").length, 1);
});


test("Wolfbane credits native human-form Canifis citizens, not transformed werewolves", () => {
  const { NpcDefinition } = require("../dist/game/definition/NpcDefinition");
  const spawns = require("../data/definitions/npc-spawns.json");
  const task = "kill-a-werewolf-in-its-human-form-using-the-wolf";
  const kill = (id, weapon = ItemIdentifiers.WOLFBANE) => {
    const player = createPlayer({ weapon: { id: weapon, name: "Wolfbane" } });
    const definition = NpcDefinition.forId(id);
    emit("onNpcDeath", { killer: player, npcId: id,
      npc: { getCurrentDefinition: () => definition }, location: { x: 3489, y: 3490, z: 0 } });
    return has(player, task);
  };
  assert.ok(spawns.some(spawn => spawn.id === NpcIdentifiers.BORIS && spawn.name === "Boris"));
  assert.equal(NpcDefinition.forId(NpcIdentifiers.BORIS).getName(), "Boris");
  assert.ok(kill(NpcIdentifiers.BORIS), "the real spawned human form counts");
  assert.ok(kill(NpcIdentifiers.IMRE, ItemIdentifiers.WOLFBANE_2), "the alternate Wolfbane counts");
  assert.ok(!kill(NpcIdentifiers.WEREWOLF), "a transformed werewolf cannot count as human form");
  assert.ok(!kill(NpcIdentifiers.BORIS, ItemIdentifiers.BRONZE_DAGGER), "another dagger does not count");
});


test("Mort Myre entry requires crossing the boundary, not toggling the gate", () => {
  const player = createPlayer({ x: 3443, y: 3481 });
  const task = "enter-mort-myre-swamp";
  for (const objectId of [3506, 3507]) emit("door:toggle", { player, objectId });
  assert.ok(!has(player, task), "opening or closing the gate outside does not count");
  emit("mort-myre:entered", { player });
  assert.ok(has(player, task));
});
