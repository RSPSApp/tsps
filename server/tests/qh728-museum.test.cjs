// Museum/Kudos supporting job for issue 728 (Bone Voyage's 100-Kudos gate).
// From server/: node --test tests/qh728-museum.test.cjs
//
// The fixture only sets labelled starting conditions (The Dig Site and ten
// timeline quests complete, cleaning equipment held). Every Kudos below comes
// from dispatching the plugin's registered handlers through the real
// NpcDialogues transcript runtime; the test never writes the Kudos total.
const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, before, test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PluginManager } = require("../dist/plugins/PluginManager");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { DialogueManager } = require("../dist/game/model/dialogues/DialogueManager");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { Item } = require("../dist/game/model/Item");
const { ItemIdentifiers: I } = require("../dist/util/ItemIdentifiers");
const { NpcIdentifiers: N } = require("../dist/util/NpcIdentifiers");

const runtime = require("../plugins/quests/QuestRuntime");
const NpcDialogues = require("../plugins/npcs/NpcDialogues.plugin.js");
const Museum = require("../plugins/world/Museum.plugin.js");

const KUDOS = "museum:kudos";
const STATE = "museum:state";
const ROCKS = 24557;
const TABLE = 24556;
const TOOLS = 24535;
const BARNABUS = 1903;
const DISPLAY_EMPTY = 24550;
const VARBIT = { oldSymbol: 3646, ancientSymbol: 3645, pottery: 3649, ancientCoin: 3647, oldCoin: 3648 };

const MINAS = [
  ["S57fCr", "demon_slayer"],
  ["oGD9-i", "rune_mysteries"],
  ["4Ij9Rt", "making_history"],
  ["QqHvp-", "shield_of_arrav"],
  ["RaNFxc", "merlins_crystal"],
  ["jeha67", "defender_of_varrock"],
  ["EZzFyt", "grand_tree"],
  ["3q8-VQ", "priest_in_peril"],
  ["dHMXRQ", "in_aid_of_the_myreque"],
  ["SJoct1", "temple_of_ikov"],
];
const LAMPS = new Map([
  [11185, { xp: 1000, minLevel: 20, quest: "merlins_crystal" }],
  [11186, { xp: 1000, minLevel: 20, quest: "shield_of_arrav" }],
  [11187, { xp: 1000, minLevel: 20, quest: "making_history" }],
  [28820, { xp: 5000, minLevel: 30, quest: "defender_of_varrock" }],
]);

let baseConditionHooks = 0;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
  baseConditionHooks = PluginManager.npcDialogueConditionHooks.length;
});
afterEach(() => {
  PluginManager.npcDialogueConditionHooks.length = baseConditionHooks;
});

function makeInventory(initial = {}) {
  const counts = new Map(Object.entries(initial));
  const slots = new Array(28).fill(null);
  const itemObjects = new Map();
  const freeSlot = () => slots.findIndex((value) => value === null);
  const place = (key) => { const slot = freeSlot(); if (slot >= 0) slots[slot] = key; };
  for (const key of counts.keys()) place(key);
  const inv = {
    slots,
    getAmount: (id) => counts.get(String(id)) ?? 0,
    containsNumber: (id) => (counts.get(String(id)) ?? 0) > 0,
    adds(id, amount) {
      const key = String(id);
      if (!counts.has(key)) place(key);
      counts.set(key, (counts.get(key) ?? 0) + amount);
      return inv;
    },
    delete(id, amount) {
      const key = String(id), next = (counts.get(key) ?? 0) - amount;
      if (next <= 0) {
        counts.delete(key);
        const slot = slots.indexOf(key);
        if (slot >= 0) slots[slot] = null;
      } else counts.set(key, next);
      return inv;
    },
    get(slot) {
      const key = slots[slot];
      if (key === null || key === undefined) return null;
      if (!itemObjects.has(key)) itemObjects.set(key, { getId: () => Number(key) });
      return itemObjects.get(key);
    },
    deleteNumber(id, amount) { return inv.delete(id, amount); },
    deleteAtSlot(slot, amount) {
      const key = slots[slot];
      if (key === null || key === undefined) return inv;
      const next = (counts.get(key) ?? 0) - amount;
      if (next <= 0) { counts.delete(key); slots[slot] = null; } else counts.set(key, next);
      return inv;
    },
    slotOf(id) { return slots.indexOf(String(id)); },
    isFull: () => freeSlot() === -1,
    getFreeSlots: () => 28 - slots.filter((value) => value !== null).length,
    counts,
  };
  return inv;
}
function makeEquipment(ids = []) {
  const equipment = new Equipment({ getUsername: () => "museum-test" });
  const slots = [Equipment.HANDS_SLOT, Equipment.FEET_SLOT];
  ids.forEach((id, index) => equipment.set(slots[index] ?? index, new Item(id, 1)));
  return equipment;
}

function makePlayer(attributes = {}, items = {}, equipped = []) {
  const attrs = new Map(Object.entries(attributes));
  const inventory = makeInventory(items);
  const messages = [], varbits = [], texts = [];
  const levels = new Map(), experience = new Map();
  const bankCounts = new Map();
  const bank = {
    getAmount: (id) => bankCounts.get(String(id)) ?? 0,
    deleteNumber(id, amount) {
      const key = String(id), next = (bankCounts.get(key) ?? 0) - amount;
      if (next <= 0) bankCounts.delete(key); else bankCounts.set(key, next);
      return bank;
    },
  };
  const skillKey = (skill) => skill?.getName?.() ?? String(skill);
  const skills = {
    getMaxLevel: (skill) => levels.get(skillKey(skill)) ?? 99,
    getExperience: (skill) => experience.get(skillKey(skill)) ?? 0,
    addExperience(skill, amount) { experience.set(skillKey(skill), skills.getExperience(skill) + amount); },
  };
  let menu = null;
  const player = {
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => { attrs.set(key, value); },
    getInventory: () => inventory,
    getEquipment: () => makeEquipment(equipped),
    getBanks: () => [bank],
    getBank: () => bank,
    getSkillManager: () => skills,
    sendMessage: (message) => messages.push(message),
    getUsername: () => "museum-test",
    getAppearance: () => ({ isMale: () => true }),
    getPacketSender: () => sender,
    getDialogueManager: () => player.manager,
    messages,
    varbits,
    texts,
    attrs,
    inventory,
    get menu() { return menu; },
    set menu(value) { menu = value; },
    snapshot: () => Object.fromEntries(attrs),
    snapshotItems: () => Object.fromEntries(inventory.counts),
    setBankItem(id, amount) { bankCounts.set(String(id), amount); },
    skills,
    setLevel(name, level) { levels.set(name, level); },
    getExperience(name) { return experience.get(name) ?? 0; },
  };
  const varps = new Map(), configs = [];
  const sender = new Proxy({
    sendVarbit(id, value) {
      varbits.push([id, value]);
      const { baseVar, startBit, endBit } = CacheDefinitions.getVarbit(id);
      const width = endBit - startBit + 1;
      const mask = ((1 << width) - 1) << startBit;
      const current = varps.get(baseVar) ?? 0;
      varps.set(baseVar, (current & ~mask) | ((value << startBit) & mask));
      return sender;
    },
    sendConfig(id, value) { configs.push([id, value]); varps.set(id, value); return sender; },
    getVarp(id) { return varps.get(id) ?? 0; },
    getVarbit(id) {
      const { baseVar, startBit, endBit } = CacheDefinitions.getVarbit(id);
      return ((varps.get(baseVar) ?? 0) >> startBit) & ((1 << (endBit - startBit + 1)) - 1);
    },
    sendInterfaceRemoval() { return sender; },
    isChatboxInterface() { return true; },
  }, { get(target, key) { return key in target ? target[key] : () => sender; } });
  player.manager = new DialogueManager(player);
  player.getVarbit = (id) => sender.getVarbit(id);
  player.getVarp = (id) => sender.getVarp(id);
  player.setVarp = (id, value) => { varps.set(id, value); return player; };
  player.configs = configs;
  return player;
}

function makeApi(quests = new Set()) {
  const custom = new Map(), object = new Map(), condition = [], itemObject = [], itemNpc = [], login = [], xpreward = [];
  let anyNpc = null, itemAction = null;
  const api = {
    core: PluginManager.getCoreApi(),
    persistAttribute() {},
    onCustomEvent(name, handler) { custom.set(name, [...(custom.get(name) ?? []), handler]); },
    emitCustomEvent(name, payload) {
      if (name === "quest:is-complete") payload.complete = quests.has(payload.key) === true;
      if (name === "xpreward:open") xpreward.push(payload);
      for (const handler of custom.get(name) ?? []) handler(payload);
    },
    onObjectInteraction(name, actions) { object.set(name, actions); },
    onItemOnObject(handler) { itemObject.push(handler); },
    onItemOnNpc(handler) { itemNpc.push(handler); },
    onItemAction(name, actions) { if (name === "Antique lamp") itemAction = actions.Rub; },
    onNpcDialogueCondition(handler) {
      condition.push(handler);
      PluginManager.npcDialogueConditionHooks.push({ pluginName: "MuseumTest", handler });
    },
    onAnyNpcInteraction(actions) { anyNpc = actions; },
    onPlayerLogin(handler) { login.push(handler); },
    sendMultiChatboxPrompt(_player, _title, ...flat) {
      const options = [];
      for (let i = 0; i < flat.length; i += 2) options.push([flat[i], flat[i + 1]]);
      _player.menu = { options };
      return true;
    },
  };
  Museum.register(api);
  NpcDialogues.register(api);
  return { api, custom, object, condition, itemObject, itemNpc, login, xpreward, get anyNpc() { return anyNpc; }, get itemAction() { return itemAction; } };
}

function advanceToMenu(player) {
  for (let guard = 0; guard < 50; guard++) {
    if (player.menu) return;
    const manager = player.getDialogueManager();
    const current = manager.getCurrent?.();
    if (!current) break;
    const text = current.getText?.();
    if (text) player.texts.push(text);
    manager.advance();
  }
  assert.ok(player.menu, "menu did not open");
}

function play(player, choice) {
  for (let guard = 0; guard < 500; guard++) {
    if (player.menu) {
      const menu = player.menu;
      player.menu = null;
      const index = menu.options.findIndex(([label]) => label === choice || label.includes(choice));
      assert.ok(index >= 0, `menu option ${JSON.stringify(choice)} not found in ${JSON.stringify(menu.options.map(([label]) => label))}`);
      menu.options[index][1]();
      continue;
    }
    const manager = player.getDialogueManager();
    const current = manager.getCurrent?.();
    if (!current) return;
    const text = current.getText?.();
    if (text) player.texts.push(text);
    manager.advance();
  }
  assert.fail("dialogue did not finish");
}

function objectAction(world, name, option, player, objectId, x, y, z = 0) {
  const event = {
    player, object: {}, objectId, clickType: 1, location: { x, y, z }, handled: false,
    definition: { getName: () => name, getInteractions: () => [option, null, null, null, null] },
  };
  const action = world.object.get(name)[option];
  const result = action(event);
  if (result !== false) event.handled = true;
  return event;
}

function itemOnObject(world, player, itemId, objectId, x, y) {
  const event = { player, object: {}, objectId, item: { getId: () => itemId }, itemId, itemSlot: 0,
    interfaceType: 3214, location: { x, y, z: 0 }, handled: false };
  for (const handler of world.itemObject) if (!event.handled) handler(event);
  return event;
}

function itemOnNpc(world, player, itemId, npcId) {
  const event = { player, target: {}, npcId, targetIndex: 1, item: { getId: () => itemId }, itemId,
    slot: 0, interfaceId: 3214, handled: false };
  for (const handler of world.itemNpc) if (!event.handled) handler(event);
  return event;
}

function getKudos(world, player) {
  const request = { player, kudos: null };
  world.api.emitCustomEvent("museum:get-kudos", request);
  return request.kudos;
}

function replay(world, player) {
  for (const handler of world.login) handler({ player });
  world.api.emitCustomEvent("player:bootstrap-complete", { player });
}

function talkToMinas(world, player, choice = "I have some information") {
  world.anyNpc["Talk-to"]({
    player, npc: { getId: () => N.HISTORIAN_MINAS }, npcId: N.HISTORIAN_MINAS,
    definition: world.api.core.NpcDefinition.forId(N.HISTORIAN_MINAS), handled: false,
  });
  play(player, choice);
}

const TOOL_ITEMS = {
  [I.TROWEL]: 1, [I.ROCK_PICK]: 1, [I.SPECIMEN_BRUSH]: 1,
  [I.LEATHER_GLOVES]: 1, [I.LEATHER_BOOTS]: 1,
};
const EQUIPPED = [I.LEATHER_GLOVES, I.LEATHER_BOOTS];

function questFixtures() {
  return new Set(["the_dig_site", ...MINAS.map(([, key]) => key)]);
}

function cleanOne(world, player) {
  const originalRandom = Math.random;
  Math.random = (() => { const values = [0.5, 0.01]; return () => values.shift() ?? 0.5; })();
  try {
    itemOnObject(world, player, I.UNCLEANED_FIND, TABLE, 3259, 3444);
  } finally {
    Math.random = originalRandom;
  }
}

function cleanAt(world, player, mainRoll, innerRoll = 0) {
  player.inventory.adds(I.UNCLEANED_FIND, 1);
  const originalRandom = Math.random;
  Math.random = (() => { const values = [0.5, mainRoll, innerRoll]; return () => values.shift() ?? 0.5; })();
  try {
    itemOnObject(world, player, I.UNCLEANED_FIND, TABLE, 3259, 3444);
  } finally {
    Math.random = originalRandom;
  }
}

function cleaner(items = {}) {
  return makePlayer({}, { ...TOOL_ITEMS, ...items }, EQUIPPED);
}

test("Museum: real cache actions, transcript assessment, display cases and Minas reach 100", () => {
  // Cache action ids/options the plugin hooks by name.
  for (const id of [24557, 24558, 24559]) assert.ok(CacheDefinitions.getObject(id).actions.includes("Take"));
  assert.ok(CacheDefinitions.getObject(TOOLS).actions.includes("Take"));
  assert.ok(CacheDefinitions.getObject(TABLE).actions.includes("Clean"));
  for (const id of [24550, 12137, 12138, 12139, 12234, 15484]) {
    assert.ok(CacheDefinitions.getObject(id).actions.includes("Study"));
  }

  assert.equal(Museum.members, true);
  const world = makeApi(questFixtures());
  const player = makePlayer({ "quest.temple_of_ikov.side": 1 }, { ...TOOL_ITEMS }, EQUIPPED);
  assert.equal(getKudos(world, player), 0);

  // Tool rack -> rocks -> cleaning; no tools means no cleaning.
  const bare = makePlayer();
  objectAction(world, "Tools", "Take", bare, TOOLS, 3259, 3442);
  for (const itemId of [I.TROWEL, I.ROCK_PICK, I.SPECIMEN_BRUSH]) assert.equal(bare.inventory.getAmount(itemId), 1);
  bare.inventory.adds(I.UNCLEANED_FIND, 1);
  itemOnObject(world, bare, I.UNCLEANED_FIND, TABLE, 3259, 3444);
  assert.equal(bare.inventory.getAmount(I.UNCLEANED_FIND), 1);

  const take = objectAction(world, "Dig Site specimen rocks", "Take", player, ROCKS, 3263, 3446);
  assert.equal(take.handled, true);
  assert.equal(player.inventory.getAmount(I.UNCLEANED_FIND), 1);
  const full = makePlayer({}, { ...TOOL_ITEMS }, EQUIPPED);
  full.inventory.isFull = () => true;
  full.inventory.getFreeSlots = () => 0;
  objectAction(world, "Dig Site specimen rocks", "Take", full, ROCKS, 3263, 3446);
  assert.equal(full.inventory.getAmount(I.UNCLEANED_FIND), 0);

  cleanOne(world, player);
  assert.equal(player.inventory.getAmount(I.UNCLEANED_FIND), 0);
  assert.equal(player.inventory.getAmount(I.OLD_SYMBOL), 1);

  // Wiki: using the artefact on the empty case awards 10 Kudos; showing the
  // archaeologist is advice, not a gate. Place this one directly.
  itemOnObject(world, player, I.OLD_SYMBOL, DISPLAY_EMPTY, 3262, 3448);
  assert.equal(player.inventory.getAmount(I.OLD_SYMBOL), 0);
  assert.equal(getKudos(world, player), 10);
  assert.equal(player.getVarbit(VARBIT.oldSymbol), 1);

  // Real NPC/transcript assessment for the next artefact: the item-on-NPC
  // handler starts Barnabus Hurma's standard dialogue item branch and the real
  // NpcDialogues runner selects the first-time condition and marks it shown.
  player.inventory.adds(I.ANCIENT_SYMBOL, 1);
  itemOnNpc(world, player, I.ANCIENT_SYMBOL, BARNABUS);
  play(player);
  assert.ok(player.texts.some((text) => text.replace(/\s+/g, " ").includes("display case 37")), player.texts.join(" | "));
  assert.deepEqual(player.getAttribute(STATE).dig.shown, [I.ANCIENT_SYMBOL]);
  itemOnObject(world, player, I.ANCIENT_SYMBOL, DISPLAY_EMPTY, 3262, 3450);
  assert.equal(getKudos(world, player), 20);

  for (const [itemId, x, y, varbit, objectId] of [
    [I.ANCIENT_COIN, 3259, 3450, VARBIT.ancientCoin, DISPLAY_EMPTY],
    [I.OLD_COIN, 3259, 3448, VARBIT.oldCoin, DISPLAY_EMPTY],
    [I.POTTERY, 3259, 3452, VARBIT.pottery, 24543],
  ]) {
    player.inventory.adds(itemId, 1);
    itemOnNpc(world, player, itemId, BARNABUS);
    play(player);
    itemOnObject(world, player, itemId, objectId, x, y);
    assert.equal(player.inventory.getAmount(itemId), 0);
    assert.equal(player.getVarbit(varbit), 1);
  }
  assert.equal(getKudos(world, player), 50);

  // Selecting the Minas report does not pay yet: abandoning before the branch's
  // terminal step leaves Kudos unchanged.
  const beforeAbandon = getKudos(world, player);
  world.anyNpc["Talk-to"]({
    player, npc: { getId: () => N.HISTORIAN_MINAS }, npcId: N.HISTORIAN_MINAS,
    definition: world.api.core.NpcDefinition.forId(N.HISTORIAN_MINAS), handled: false,
  });
  advanceToMenu(player);
  const info = player.menu.options.find(([label]) => label.includes("I have some information"));
  info[1]();
  player.getDialogueManager().advance();
  assert.equal(getKudos(world, player), beforeAbandon);
  player.getDialogueManager().reset();
  player.menu = null;

  // Independent, true transcript branches can report several completed quests
  // in one conversation. Each newly recorded report must still pay exactly once.
  const expectedReports = new Set(MINAS.map(([, key]) => key));
  for (let attempts = 0; attempts < MINAS.length; attempts++) {
    const previous = player.getAttribute(STATE).minas ?? [];
    if (previous.length === expectedReports.size) break;
    const before = getKudos(world, player);
    talkToMinas(world, player);
    const reports = player.getAttribute(STATE).minas;
    const added = reports.filter((key) => !previous.includes(key));
    assert.ok(added.length > 0, 'the conversation reports an outstanding quest');
    assert.equal(new Set(reports).size, reports.length, 'reports are unique');
    for (const key of added) assert.ok(expectedReports.has(key), `unexpected report ${key}`);
    assert.equal(getKudos(world, player), before + 5 * added.length);
  }
  assert.deepEqual(new Set(player.getAttribute(STATE).minas), expectedReports);
  assert.equal(getKudos(world, player), 100);

  // The four canonical Minas lamps were granted once at the report point.
  for (const [itemId] of LAMPS) assert.equal(player.inventory.getAmount(itemId), 1, `lamp ${itemId}`);

  // Reported quests are no longer offered; a repeat talk uses the fallback and pays nothing.
  talkToMinas(world, player);
  assert.equal(getKudos(world, player), 100);

  // Relogin preserves Kudos, state, display transforms and the unclaimed lamps.
  const relogged = makePlayer(player.snapshot(), player.snapshotItems(), []);
  for (const handler of world.login) handler({ player: relogged });
  assert.equal(getKudos(world, relogged), 100);
  for (const varbit of Object.values(VARBIT)) {
    assert.ok(relogged.varbits.some(([id, value]) => id === varbit && value === 1));
  }
  for (const [itemId] of LAMPS) assert.equal(relogged.inventory.getAmount(itemId), 1, `relogged lamp ${itemId}`);

  // Rub each unclaimed lamp once at its source-backed level and XP amount.
  relogged.setLevel("Attack", 30);
  const skill = { getName: () => "Attack", getIndex: () => 0 };
  let expectedXp = 0;
  for (const [itemId, lamp] of LAMPS) {
    const slot = relogged.inventory.slotOf(itemId);
    assert.ok(slot >= 0);
    world.itemAction({ player: relogged, item: relogged.inventory.get(slot), itemId, slot });
    const prompt = world.xpreward.at(-1);
    assert.equal(prompt.minLevel, lamp.minLevel);
    assert.equal(prompt.onConfirm(skill, "Attack"), `<col=0000ff>Your wish has been granted!</col> You have been awarded ${lamp.xp.toLocaleString("en-GB")} Attack experience!`);
    expectedXp += lamp.xp;
    assert.equal(relogged.inventory.getAmount(itemId), 0);
  }
  assert.equal(relogged.getExperience("Attack"), expectedXp);

  // Used lamps never return after relogin, and the report does not grant another.
  const used = makePlayer(relogged.snapshot(), relogged.snapshotItems(), []);
  for (const handler of world.login) handler({ player: used });
  for (const [itemId] of LAMPS) assert.equal(used.inventory.getAmount(itemId), 0);
  talkToMinas(world, used);
  assert.equal(getKudos(world, used), 100);
  for (const [itemId] of LAMPS) assert.equal(used.inventory.getAmount(itemId), 0);
});

test("Museum: What Lies Below pays only with the book; Hazeel's mid-branch gap never pays early", () => {
  const wlb = makeApi(new Set(["the_dig_site", "what_lies_below"]));
  const player = makePlayer({}, {}, []);
  talkToMinas(wlb, player);
  assert.equal(getKudos(wlb, player), 0);
  player.inventory.adds(I.DAGONHAI_HISTORY, 1);
  talkToMinas(wlb, player);
  assert.equal(getKudos(wlb, player), 5);

  const hazeel = makeApi(new Set(["the_dig_site", "hazeel_cult"]));
  const hazeelPlayer = makePlayer({}, {}, []);
  talkToMinas(hazeel, hazeelPlayer);
  assert.equal(getKudos(hazeel, hazeelPlayer), 0);
});

test("Museum: Minas lamps enforce minimum level and full-bag retry without duplication", () => {
  const world = makeApi(new Set(["the_dig_site", "making_history"]));
  const player = makePlayer({}, {}, []);
  talkToMinas(world, player);
  assert.equal(getKudos(world, player), 5);
  assert.equal(player.inventory.getAmount(11187), 1);

  const skill = { getName: () => "Attack", getIndex: () => 0 };
  const slot = player.inventory.slotOf(11187);
  world.itemAction({ player, item: player.inventory.get(slot), itemId: 11187, slot });
  const prompt = world.xpreward.at(-1);
  assert.equal(prompt.minLevel, 20);
  player.setLevel("Attack", 19);
  assert.equal(prompt.onConfirm(skill, "Attack"), null);
  assert.equal(player.inventory.getAmount(11187), 1, "low-level rub keeps the lamp");
  assert.equal(player.getExperience("Attack"), 0);
  player.setLevel("Attack", 20);
  const retrySlot = player.inventory.slotOf(11187);
  world.itemAction({ player, item: player.inventory.get(retrySlot), itemId: 11187, slot: retrySlot });
  assert.ok(world.xpreward.at(-1).onConfirm(skill, "Attack"));
  assert.equal(player.inventory.getAmount(11187), 0);
  assert.equal(player.getExperience("Attack"), 1000);

  // Full bag at the report point: no Kudos, no lamp, no marked report; retry after making room.
  const fullItems = {};
  for (let id = 1; id <= 28; id++) fullItems[id] = 1;
  const full = makePlayer({}, fullItems, []);
  const fullWorld = makeApi(new Set(["the_dig_site", "making_history"]));
  talkToMinas(fullWorld, full);
  assert.equal(getKudos(fullWorld, full), 0);
  assert.equal(full.inventory.getAmount(11187), 0);
  assert.ok(full.messages.some((message) => message.includes("free inventory space")));
  full.inventory.delete(1, 1);
  talkToMinas(fullWorld, full);
  assert.equal(getKudos(fullWorld, full), 5);
  assert.equal(full.inventory.getAmount(11187), 1);
});

test("Museum: cleaning uses the fixed /51 table and replaces suppressed uniques with Unremarkable finds", () => {
  const world = makeApi(questFixtures());

  // Cache-verified unremarkable outcomes.
  assert.equal(CacheDefinitions.getItem(687).name, "Broken arrow");
  assert.equal(CacheDefinitions.getItem(690).name, "Broken glass");
  assert.equal(CacheDefinitions.getItem(1203).name, "Iron dagger");
  assert.equal(CacheDefinitions.getItem(1627).name, "Uncut jade");
  assert.equal(CacheDefinitions.getItem(526).name, "Bones");
  assert.equal(CacheDefinitions.getItem(995).name, "Coins");

  // Fixed unique/common boundaries with every unique still unheld.
  let p = cleaner();
  cleanAt(world, p, 0);
  assert.equal(p.inventory.getAmount(I.OLD_SYMBOL), 1);
  p = cleaner();
  cleanAt(world, p, 6 / 102);
  assert.equal(p.inventory.getAmount(I.ANCIENT_SYMBOL), 1);
  p = cleaner();
  cleanAt(world, p, 24 / 102);
  assert.equal(p.inventory.getAmount(I.CLEAN_NECKLACE), 1);
  p = cleaner();
  cleanAt(world, p, 26 / 102);
  assert.equal(p.inventory.getAmount(I.POTTERY), 1);
  p = cleaner();
  cleanAt(world, p, 101.999 / 102);
  assert.equal(p.inventory.getAmount(I.ARROWHEADS), 1);

  // Holding Old symbol replaces its 6/102 slot with Unremarkable; the common
  // boundaries do not move and the denominator does not shrink.
  p = cleaner({ [I.OLD_SYMBOL]: 1 });
  cleanAt(world, p, 1 / 102, 0);
  assert.equal(p.inventory.getAmount(687), 1);
  assert.equal(p.inventory.getAmount(I.OLD_SYMBOL), 1);
  p = cleaner({ [I.OLD_SYMBOL]: 1 });
  cleanAt(world, p, 1 / 102, 116.999 / 117);
  assert.equal(p.inventory.getAmount(995), 5);
  p = cleaner({ [I.OLD_SYMBOL]: 1 });
  cleanAt(world, p, 26 / 102);
  assert.equal(p.inventory.getAmount(I.POTTERY), 1);
  p = cleaner({ [I.OLD_SYMBOL]: 1 });
  cleanAt(world, p, 101.999 / 102);
  assert.equal(p.inventory.getAmount(I.ARROWHEADS), 1);

  // With all unique slots suppressed, values below 26/102 are Unremarkable; 26/102 is Pottery.
  const allUniques = {
    [I.OLD_SYMBOL]: 1, [I.ANCIENT_SYMBOL]: 1, [I.OLD_COIN]: 1, [I.ANCIENT_COIN]: 1, [I.CLEAN_NECKLACE]: 1,
  };
  p = cleaner(allUniques);
  cleanAt(world, p, 25.999 / 102, 0);
  assert.equal(p.inventory.getAmount(687), 1);
  p = cleaner(allUniques);
  cleanAt(world, p, 26 / 102);
  assert.equal(p.inventory.getAmount(I.POTTERY), 1);

  // Conditional Unremarkable subtable boundaries: 26/26/26/13/13/13 of 117.
  const innerCases = [
    [25.999, 687], [26, 690], [51.999, 690], [52, 1203], [77.999, 1203],
    [78, 1627], [90.999, 1627], [91, 526], [103.999, 526], [104, 995],
  ];
  for (const [inner, itemId] of innerCases) {
    p = cleaner({ [I.OLD_SYMBOL]: 1 });
    cleanAt(world, p, 1 / 102, inner / 117);
    assert.equal(p.inventory.getAmount(itemId), itemId === 995 ? 5 : 1, `inner boundary ${inner} -> ${itemId}`);
  }
});

test("Museum: placing a unique artefact removes its duplicates from inventory and bank", () => {
  const world = makeApi(questFixtures());
  const player = makePlayer({}, { ...TOOL_ITEMS }, EQUIPPED);
  player.inventory.adds(I.OLD_SYMBOL, 2);
  player.setBankItem(I.OLD_SYMBOL, 3);

  itemOnObject(world, player, I.OLD_SYMBOL, DISPLAY_EMPTY, 3262, 3448);

  assert.equal(player.inventory.getAmount(I.OLD_SYMBOL), 0);
  assert.equal(player.getBanks()[0].getAmount(I.OLD_SYMBOL), 0);
  assert.equal(getKudos(world, player), 10);
});

test("Museum: VM_KUDOS wire mirrors persisted Kudos at 0/99/100 and preserves sibling bits", () => {
  const vm = CacheDefinitions.getVarbit(3637);
  assert.equal(vm.baseVar, 1010);
  assert.equal(vm.startBit, 0);
  assert.equal(vm.endBit, 10);

  const world = makeApi();
  const siblingBits = (1 << 11) | (1 << 12) | (1 << 13) | (1 << 14) | (1 << 15) | (1 << 16);
  for (const value of [0, 99, 100]) {
    const player = makePlayer({ [KUDOS]: value }, {}, []);
    player.setVarp(1010, siblingBits);
    replay(world, player);
    assert.equal(player.getVarbit(3637), value, `replay ${value}`);
    assert.equal(player.getVarp(1010) & siblingBits, siblingBits, `sibling bits ${value}`);
    assert.equal(player.configs.some(([id]) => id === 1010), false, "must not write the whole varp");
    assert.equal(getKudos(world, player), value, `event ${value}`);
  }

  // Award from 0 through the registered display handler.
  const displayWorld = makeApi(questFixtures());
  const display = makePlayer({}, { [I.OLD_SYMBOL]: 1 }, []);
  display.setVarp(1010, siblingBits);
  itemOnObject(displayWorld, display, I.OLD_SYMBOL, DISPLAY_EMPTY, 3262, 3448);
  assert.equal(getKudos(displayWorld, display), 10);
  assert.equal(display.getVarbit(3637), 10);
  assert.equal(display.getVarp(1010) & siblingBits, siblingBits);

  // Award to 99 and 100 through the registered Minas transcript handler.
  for (const [start, expected] of [[94, 99], [95, 100]]) {
    const minasWorld = makeApi(new Set(["the_dig_site", "demon_slayer"]));
    const minasPlayer = makePlayer({ [KUDOS]: start }, {}, []);
    minasPlayer.setVarp(1010, siblingBits);
    talkToMinas(minasWorld, minasPlayer);
    assert.equal(getKudos(minasWorld, minasPlayer), expected);
    assert.equal(minasPlayer.getVarbit(3637), expected);
    assert.equal(minasPlayer.getVarp(1010) & siblingBits, siblingBits);
    assert.equal(minasPlayer.configs.some(([id]) => id === 1010), false);
  }
});
