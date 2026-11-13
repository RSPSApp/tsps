// Sailing salvaging relics: Inspect, and handing them to Curator Haig Halen.
// From server/: node --test tests/salvaging-relics.test.cjs
//
// Plays the hand-in through the Museum plugin's handlers and the real NpcDialogues transcript
// runtime, and checks it against the rsprox captures (recordings 960, 3848) and the Wiki.
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

const NpcDialogues = require("../plugins/npcs/NpcDialogues.plugin.js");
const Museum = require("../plugins/world/Museum.plugin.js");

const CLAIMED = "museum:salvaging-relics";
const KUDOS = "museum:kudos";
const COINS = 995;
const SHOW_LINE = "I found a strange relic while salvaging...";

let ids;
let core;
let baseConditionHooks = 0;
let baseVariantHooks = 0;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
  core = PluginManager.getCoreApi();
  baseConditionHooks = PluginManager.npcDialogueConditionHooks.length;
  baseVariantHooks = PluginManager.npcDialogueVariantHooks.length;
  const obj = (name) => CacheDefinitions.getObjId(name);
  const varbit = (name) => CacheDefinitions.getVarbitId(name);
  ids = {
    curator: CacheDefinitions.getNpcId("curator"),
    compass: obj("salvaging_rare_broken_compass"),
    coin: obj("salvaging_rare_rusty_coin"),
    doll: obj("salvaging_rare_mouldy_doll"),
    mirror: obj("salvaging_rare_smashed_mirror"),
    locket: obj("salvaging_rare_rusty_locket"),
    sextant: obj("salvaging_rare_broken_sextant"),
    lampSmall: obj("salvaging_rare_lamp_small"),
    lampMed: obj("salvaging_rare_lamp_med"),
    lampLarge: obj("salvaging_rare_lamp_large"),
    dollClaimed: varbit("salvaging_rare_mouldy_doll_claimed"),
    mirrorClaimed: varbit("salvaging_rare_smashed_mirror_claimed"),
    allClaimed: varbit("salvaging_rare_all_claimed"),
  };
});
afterEach(() => {
  PluginManager.npcDialogueConditionHooks.length = baseConditionHooks;
  PluginManager.npcDialogueVariantHooks.length = baseVariantHooks;
});

function makeInventory(itemIds) {
  const slots = new Array(28).fill(null);
  const item = (id, amount) => ({ getId: () => id, getAmount: () => amount, amount });
  itemIds.forEach((id, index) => { slots[index] = item(id, 1); });
  return {
    slots,
    getItems: () => slots.filter(Boolean),
    getAmount: (id) => slots.reduce((sum, entry) => sum + (entry?.getId() === id ? entry.amount : 0), 0),
    getFreeSlots: () => slots.filter((entry) => !entry).length,
    delete(id, amount) {
      const index = slots.findIndex((entry) => entry?.getId() === id);
      if (index < 0) return;
      const left = slots[index].amount - amount;
      slots[index] = left > 0 ? item(id, left) : null;
    },
    adds(id, amount) {
      const stack = id === COINS ? slots.findIndex((entry) => entry?.getId() === id) : -1;
      if (stack >= 0) { slots[stack] = item(id, slots[stack].amount + amount); return; }
      slots[slots.indexOf(null)] = item(id, amount);
    },
  };
}

function makePlayer(itemIds, attributes = {}) {
  const attrs = new Map(Object.entries(attributes));
  const chat = [], spam = [], sounds = [], boxes = [];
  const varps = new Map();
  const sender = new Proxy({
    sendVarbit(id, value) {
      const { baseVar, startBit, endBit } = CacheDefinitions.getVarbit(id);
      const mask = ((1 << (endBit - startBit + 1)) - 1) << startBit;
      varps.set(baseVar, ((varps.get(baseVar) ?? 0) & ~mask) | ((value << startBit) & mask));
      return sender;
    },
    getVarbit(id) {
      const { baseVar, startBit, endBit } = CacheDefinitions.getVarbit(id);
      return ((varps.get(baseVar) ?? 0) >>> startBit) & ((1 << (endBit - startBit + 1)) - 1);
    },
    sendSound(id) { sounds.push(id); return sender; },
    sendTypedMessage(type, message) {
      (type === core.ChatType.SPAM ? spam : chat).push({ type, message });
      return sender;
    },
    isChatboxInterface() { return true; },
  }, { get(target, key) { return key in target ? target[key] : () => sender; } });
  const inventory = makeInventory(itemIds);
  const player = {
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => { attrs.set(key, value); },
    getUsername: () => "relic-test", getDisplayName: () => "relic-test",
    getAppearance: () => ({ isMale: () => true }),
    getPacketSender: () => sender,
    getDialogueManager: () => player.manager,
    getInventory: () => inventory,
    getInterfaceId: () => -1,
    isRegistered: () => true,
    performAnimation() {},
    sendMessage: (message) => chat.push({ type: "game", message }),
    varbit: (id) => sender.getVarbit(id),
    menu: null,
    lines: [],
    attrs, chat, spam, sounds, boxes, inventory,
  };
  player.manager = new DialogueManager(player);
  return player;
}

function makeWorld() {
  const custom = new Map(), itemActions = new Map(), itemOnNpc = [], login = [];
  let anyNpc = null;
  const api = {
    core,
    persistAttribute() {},
    onCustomEvent(name, handler) { custom.set(name, [...(custom.get(name) ?? []), handler]); },
    emitCustomEvent(name, payload) { for (const handler of custom.get(name) ?? []) handler(payload); },
    onObjectInteraction() {},
    onItemOnObject() {},
    onItemOnNpc(handler) { itemOnNpc.push(handler); },
    onItemAction(name, actions) {
      if (typeof name === "string") itemActions.set(name, { ...(itemActions.get(name) ?? {}), ...actions });
    },
    onNpcDialogueCondition(handler) { PluginManager.npcDialogueConditionHooks.push({ pluginName: "RelicTest", handler }); },
    onNpcDialogueVariant(handler) { PluginManager.npcDialogueVariantHooks.push({ pluginName: "RelicTest", handler }); },
    onInterfaceActionButton() {},
    onAnyNpcInteraction(actions) { anyNpc = actions; },
    onPlayerLogin(handler) { login.push(handler); },
    registerArea() {},
    sendMultiChatboxPrompt(player, title, ...flat) {
      const options = [];
      for (let i = 0; i < flat.length; i += 2) options.push([flat[i], flat[i + 1]]);
      player.menu = { title, options };
      return true;
    },
  };
  Museum.register(api);
  NpcDialogues.register(api);
  return { api, itemActions, itemOnNpc, login, get anyNpc() { return anyNpc; } };
}

/**
 * Continue every line, answering menus in order from `choices` (a menu whose options hold none
 * of the next choice fails), until the dialogue ends. Lines, item boxes and menus are recorded.
 */
function play(player, choices = []) {
  const queue = [...choices];
  for (let guard = 0; guard < 200; guard++) {
    if (player.menu) {
      const { title, options } = player.menu;
      player.menu = null;
      player.lines.push({ menu: title, options: options.map(([label]) => label) });
      const wanted = queue.shift();
      const option = options.find(([label]) => label === wanted);
      assert.ok(option, `no ${JSON.stringify(wanted)} in ${JSON.stringify(options.map(([label]) => label))}`);
      option[1]();
      continue;
    }
    const current = player.getDialogueManager().getCurrent();
    if (!current) return;
    const text = current.getText?.();
    if (text) {
      const itemId = current.getItemId?.();
      player.lines.push(itemId === undefined ? text.replace(/\s+/g, " ") : { item: itemId, text });
    }
    player.getDialogueManager().advance();
  }
  assert.fail("dialogue did not finish");
}

function useOnCurator(world, player, itemId) {
  const event = {
    player, itemId, npcId: ids.curator, target: { getId: () => ids.curator },
    item: null, slot: 0, interfaceId: 0, targetIndex: 0, handled: false,
  };
  for (const handler of world.itemOnNpc) handler(event);
  return event;
}

const mesboxes = (player) => player.chat.filter(({ type }) => type === core.ChatType.MESBOX).map(({ message }) => message);
const said = (player) => player.lines.filter((line) => typeof line === "string");

test("Inspect shows each relic's box, wrapped as live sends it, with the chat copy", () => {
  const world = makeWorld();
  // rsprox 235/960 and 235/3848: the objectbox text as live sent it.
  const live = new Map([
    ["Broken compass", "A long-broken compass. It doesn't point anywhere now.<br>You get the feeling that an item this old belongs in a<br>museum."],
    ["Smashed mirror", "A small broken mirror. It doesn't reflect much now.<br>You get the feeling that an item this old belongs in a<br>museum."],
    ["Rusty coin", "A rusty coin with some strange markings on it. You<br>get the feeling that an item this old belongs in a<br>museum."],
    ["Mouldy doll", "A mouldy doll that was presumably once the property of<br>a child. You get the feeling that an item this old belongs<br>in a museum."],
  ]);
  const itemIds = { "Broken compass": ids.compass, "Smashed mirror": ids.mirror, "Rusty coin": ids.coin, "Mouldy doll": ids.doll };
  for (const [name, text] of live) {
    const player = makePlayer([itemIds[name]]);
    assert.equal(world.itemActions.get(name).Inspect({ player, itemId: itemIds[name], slot: 0 }), true);
    const box = player.getDialogueManager().getCurrent();
    assert.equal(box.getItemId(), itemIds[name]);
    assert.equal(box.getText(), text);
    assert.deepEqual(mesboxes(player), [text.replace(/<br>/g, " ")]);
  }
  // The other four have the Inspect option too, with the Wiki's text.
  const player = makePlayer([ids.locket]);
  assert.equal(world.itemActions.get("Rusty locket").Inspect({ player, itemId: ids.locket, slot: 0 }), true);
  assert.deepEqual(mesboxes(player), ["A rusty old locket that's sealed shut. You get the feeling that an item this old belongs in a museum."]);
  for (const name of ["Mouldy block", "Dull knife", "Broken sextant"]) assert.ok(world.itemActions.get(name)?.Inspect, name);
});

test("the first hand-in follows the capture: 1 Kudos, the relic's lamp and its inscription", () => {
  const world = makeWorld();
  const player = makePlayer([ids.compass, ids.doll], { [KUDOS]: 223 });
  assert.equal(useOnCurator(world, player, ids.doll).handled, true);
  play(player, ["Yes."]);
  assert.deepEqual(player.lines, [
    SHOW_LINE,
    { item: ids.doll, text: "You show the mouldy doll to Curator Haig Halen." },
    "Why yes, that does look rather interesting. The museum would gladly take that off your hands, and I think we could reward you with an item from our lamp collection in return.",
    { menu: "Trade the mouldy doll in for a lamp?", options: ["Yes.", "No."] },
    { item: ids.doll, text: "You hand Curator Haig Halen the mouldy doll and he gives you the promised lamp in return." },
    "Oh, there's words on the arm here... 'There is a monument built in honour of the suffering you desire.' Well, I certainly don't desire suffering, thank you very much!",
    "Anyway, thank you for bringing it to us. We'll make sure it's taken care of.",
  ]);
  assert.equal(player.inventory.getAmount(ids.doll), 0);
  assert.equal(player.inventory.getAmount(ids.lampLarge), 1);
  assert.equal(player.inventory.getAmount(ids.compass), 1);
  assert.equal(player.attrs.get(KUDOS), 224);
  assert.deepEqual(player.spam.map(({ message }) => message), ["You have earned Kudos with the Museum!"]);
  assert.deepEqual(player.sounds, [3653]);
  assert.equal(player.varbit(ids.dollClaimed), 1);
  assert.equal(player.varbit(ids.allClaimed), 128);
  assert.deepEqual(mesboxes(player), [
    "You show the mouldy doll to Curator Haig Halen.",
    "You hand Curator Haig Halen the mouldy doll and he gives you the promised lamp in return.",
  ]);
});

test("each relic gives the Wiki's lamp tier, and the mirror's menu names the mirror", () => {
  const world = makeWorld();
  for (const [itemId, lamp] of [[ids.locket, ids.lampSmall], [ids.sextant, ids.lampMed], [ids.coin, ids.lampMed], [ids.mirror, ids.lampLarge]]) {
    const player = makePlayer([itemId]);
    useOnCurator(world, player, itemId);
    play(player, ["Yes."]);
    assert.equal(player.inventory.getAmount(lamp), 1, `lamp for ${itemId}`);
    assert.equal(player.inventory.getAmount(itemId), 0);
    if (itemId === ids.mirror) {
      // rsprox 235/960: live names the mirror (the transcript's menu says "broken compass").
      assert.deepEqual(player.lines.find((line) => line.menu), { menu: "Trade the smashed mirror in for a lamp?", options: ["Yes.", "No."] });
      assert.equal(player.varbit(ids.mirrorClaimed), 1);
      assert.equal(player.varbit(ids.allClaimed), 64);
    }
  }
});

test("a claimed relic is bought for 5,000 coins, with no Kudos or lamp", () => {
  const world = makeWorld();
  const player = makePlayer([ids.mirror, COINS], { [CLAIMED]: 64, [KUDOS]: 10 });
  player.inventory.slots[1] = { getId: () => COINS, getAmount: () => 100, amount: 100 };
  useOnCurator(world, player, ids.mirror);
  play(player, ["Yes."]);
  assert.deepEqual(said(player).slice(1), [
    "Hmm.... while it is interesting, I'm afraid you've already brought us one just like it. We'd still be happy to take it off your hands, but I'm afraid we can only offer a monetary reward of 5,000 coins.",
    "The museum thanks you for your generosity.",
  ]);
  assert.deepEqual(player.lines.find((line) => line.menu), { menu: "Trade the smashed mirror in for 5,000 coins?", options: ["Yes.", "No."] });
  assert.equal(player.inventory.getAmount(ids.mirror), 0);
  assert.equal(player.inventory.getAmount(COINS), 5100);
  assert.equal(player.inventory.getAmount(ids.lampLarge), 0);
  assert.equal(player.attrs.get(KUDOS), 10);
  assert.deepEqual(player.spam, []);
});

test("saying no keeps the relic, first time and repeat", () => {
  const world = makeWorld();
  for (const claimed of [0, 8]) {
    const player = makePlayer([ids.compass], { [CLAIMED]: claimed });
    useOnCurator(world, player, ids.compass);
    play(player, ["No."]);
    assert.deepEqual(said(player).slice(-2), ["Actually, I think I'll keep it.", "Oh... very well."]);
    assert.equal(player.inventory.getAmount(ids.compass), 1);
    assert.equal(player.attrs.get(CLAIMED) ?? 0, claimed);
  }
});

test("a relic gone by the time of the trade is not paid for", () => {
  const world = makeWorld();
  const player = makePlayer([ids.coin]);
  useOnCurator(world, player, ids.coin);
  // Continue to the menu, drop the coin, then accept.
  for (let guard = 0; guard < 20 && !player.menu; guard++) player.getDialogueManager().advance();
  player.inventory.delete(ids.coin, 1);
  play(player, ["Yes."]);
  assert.equal(player.inventory.getAmount(ids.lampMed), 0);
  assert.equal(player.attrs.get(CLAIMED) ?? 0, 0);
  assert.equal(player.attrs.get(KUDOS) ?? 0, 0);
});

test("other items on Haig are left alone", () => {
  const world = makeWorld();
  const player = makePlayer([ids.lampMed]);
  assert.equal(useOnCurator(world, player, ids.lampMed).handled, false);
});

const RELIC_CONDITION = "If the player has a salvaging relic on them:";

test("Talk-to offers the relic option only while one is carried, and hands it in", () => {
  const world = makeWorld();
  const ask = (player, npcId = ids.curator) =>
    PluginManager.emitNpcDialogueCondition({ player, npcId, text: RELIC_CONDITION });
  assert.equal(ask(makePlayer([])), false);
  assert.equal(ask(makePlayer([ids.lampMed])), false);
  assert.equal(ask(makePlayer([ids.sextant])), true);
  assert.equal(ask(makePlayer([ids.sextant]), ids.curator + 1), null);

  const player = makePlayer([ids.lampSmall, ids.doll, ids.coin]);
  const choice = { player, npcId: ids.curator, option: SHOW_LINE, npc: null };
  world.api.emitCustomEvent("npc-dialogue:choice", choice);
  assert.equal(choice.end, true);
  // Ours: the first carried relic in item order is the one shown (the coin before the doll).
  play(player, ["Yes."]);
  assert.ok(player.lines.some((line) => line.text === "You show the rusty coin to Curator Haig Halen."));
  assert.ok(said(player).includes("Oh, someone's etched something into the face... 'There is a choir of souls who you will one day meet.' That sounds rather macabre, doesn't it?"));
  assert.equal(player.inventory.getAmount(ids.lampMed), 1);
  assert.equal(player.attrs.get(CLAIMED), 16);
});

test("the claimed flags are sent again on login", () => {
  const world = makeWorld();
  const player = makePlayer([], { [CLAIMED]: 64 | 128 });
  for (const handler of world.login) handler({ player });
  assert.equal(player.varbit(ids.mirrorClaimed), 1);
  assert.equal(player.varbit(ids.dollClaimed), 1);
  assert.equal(player.varbit(ids.allClaimed), 192);
});
