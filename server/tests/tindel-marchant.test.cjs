const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");
const { PacketSender } = require("../dist/net/packet/PacketSender");
const { Item } = require("../dist/game/model/Item");
const { ItemIdentifiers: I } = require("../dist/util/ItemIdentifiers");
const { MAX_STACK_AMOUNT } = require("../dist/game/model/container/StackType");
const Tindel = require("../plugins/npcs/TindelMarchant.plugin");

const { chooseOutcome, identify } = Tindel._test;
const SWORD_OUTCOMES = [
  [0, 20, 1279], [20, 57, 1293], [57, 74, 1277], [74, 81, 1291],
  [81, 87, 1281], [87, 91, 1295], [91, 92, 1285], [92, 93, 1299],
  [93, 96, 1283], [96, 98, 1297],
];
const SCIMITAR_OUTCOMES = [
  [0, 24, 1321], [24, 81, 1323], [81, 91, 1325], [91, 96, 1327], [96, 98, 1329],
];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
});

function playerWith(items = []) {
  const player = new Player(null);
  const sender = new Proxy({}, { get: () => () => sender });
  player.getPacketSender = () => sender;
  for (const [slot, id, amount = 1] of items) {
    player.getInventory().setItem(slot, new Item(id, amount));
  }
  return player;
}

function publicNpc() {
  return { getPrivateArea: () => null };
}

function eventApi() {
  const hooks = { item: [], npc: [], conditions: [], actions: [], logout: [], death: [] };
  const emitted = [];
  const api = {
    onItemOnNpc(handler) { hooks.item.push(handler); },
    onNpcInteraction(_name, actions) { hooks.npc.push(actions); },
    onNpcDialogueCondition(handler) { hooks.conditions.push(handler); },
    onPlayerLogout(handler) { hooks.logout.push(handler); },
    onPlayerDeath(handler) { hooks.death.push(handler); },
    onCustomEvent(name, handler) {
      if (name === "npc-dialogue:action") hooks.actions.push(handler);
    },
    emitCustomEvent(name, event) { emitted.push([name, event]); },
  };
  Tindel.register(api);
  return { api, hooks, emitted };
}

test("Tindel outcome rolls honor rusty sword and scimitar weight boundaries", () => {
  for (const [start, end, itemId] of SWORD_OUTCOMES) {
    assert.deepEqual(chooseOutcome("sword", start), { type: "item", itemId });
    assert.deepEqual(chooseOutcome("sword", end - 1), { type: "item", itemId });
    if (end < 98) assert.notDeepEqual(chooseOutcome("sword", end), { type: "item", itemId });
  }
  for (const [start, end, itemId] of SCIMITAR_OUTCOMES) {
    assert.deepEqual(chooseOutcome("scimitar", start), { type: "item", itemId });
    assert.deepEqual(chooseOutcome("scimitar", end - 1), { type: "item", itemId });
    if (end < 98) assert.notDeepEqual(chooseOutcome("scimitar", end), { type: "item", itemId });
  }
  assert.deepEqual(chooseOutcome("sword", 98), { type: "coins" });
  assert.deepEqual(chooseOutcome("sword", 99), { type: "nothing" });
  assert.deepEqual(chooseOutcome("scimitar", 98), { type: "coins" });
  assert.deepEqual(chooseOutcome("scimitar", 99), { type: "nothing" });
  assert.equal(chooseOutcome("sword", 100), null);
});

test("Tindel coin outcome uses the imported payout line without claiming an antique", () => {
  const lines = Tindel._test.outcomeSteps("sword", { type: "coins", amount: 1750 });
  assert.deepEqual(lines.map((step) => step.text), ["Tindel gives you 1750 coins."]);
});

test("Tindel refuses missing items or fee without changing the real inventory", () => {
  for (const items of [
    [[0, I.RUSTY_SWORD]],
    [[0, I.COINS, 100]],
    [],
  ]) {
    const player = playerWith(items);
    const before = player.getInventory().getItems().map((item) => [item.getId(), item.getAmount()]);
    const result = identify(player, I.RUSTY_SWORD, () => 0);
    assert.equal(result.ok, false);
    assert.deepEqual(player.getInventory().getItems().map((item) => [item.getId(), item.getAmount()]), before);
  }
});

test("Tindel replaces consumed slots in a full real inventory", () => {
  const items = [[0, I.RUSTY_SWORD], [1, I.COINS, 100]];
  for (let slot = 2; slot < 28; slot++) items.push([slot, I.CABBAGE]);
  const player = playerWith(items);
  assert.equal(player.getInventory().getFreeSlots(), 0);

  const result = identify(player, I.RUSTY_SWORD, () => 0);
  assert.equal(result.ok, true);
  assert.equal(player.getInventory().getAmount(I.RUSTY_SWORD), 0);
  assert.equal(player.getInventory().getAmount(I.COINS), 0);
  assert.equal(player.getInventory().getAmount(I.IRON_SWORD), 1);
  assert.equal(player.getInventory().getFreeSlots(), 1);
});

test("Tindel accepts an exact coin stack limit and refuses one coin beyond it unchanged", () => {
  const exact = playerWith([[0, I.RUSTY_SWORD], [1, I.COINS, MAX_STACK_AMOUNT - 1500 + 100]]);
  const exactResult = identify(exact, I.RUSTY_SWORD, (() => {
    const rolls = [0.98, 0];
    return () => rolls.shift();
  })());
  assert.equal(exactResult.ok, true);
  assert.equal(exact.getInventory().getAmount(I.COINS), MAX_STACK_AMOUNT);
  assert.equal(exact.getInventory().getAmount(I.RUSTY_SWORD), 0);

  const tooMany = playerWith([[0, I.RUSTY_SWORD], [1, I.COINS, MAX_STACK_AMOUNT - 1500 + 101]]);
  const before = tooMany.getInventory().getItems().map((item) => [item.getId(), item.getAmount()]);
  const rejected = identify(tooMany, I.RUSTY_SWORD, (() => {
    const rolls = [0.98, 0];
    return () => rolls.shift();
  })());
  assert.equal(rejected.ok, false);
  assert.equal(tooMany.getInventory().getAmount(I.COINS), MAX_STACK_AMOUNT - 1500 + 101);
  assert.equal(tooMany.getInventory().getAmount(I.RUSTY_SWORD), 1);
  assert.deepEqual(tooMany.getInventory().getItems().map((item) => [item.getId(), item.getAmount()]), before);
});

test("Tindel standard dialogue conditions and action use the imported result branch", (t) => {
  const { hooks, emitted } = eventApi();
  t.mock.method(Math, "random", () => 0);
  const player = playerWith([[0, I.RUSTY_SWORD], [1, I.COINS, 100]]);
  const pages = [{ page: "Tindel Marchant" }];
  const condition = (stepId) => hooks.conditions[0]({ player, npcId: 1358, pages, stepId });
  assert.equal(condition("KHTz9R"), false);
  assert.equal(condition("TtonTv"), false);
  assert.equal(condition("uNIJeT"), true);
  assert.equal(condition("VfWqwb"), false);

  const action = { player, npc: publicNpc(), npcId: 1358, pages, stepId: "Yaf6pt" };
  hooks.actions[0](action);
  assert.equal(action.handled, true);
  assert.equal(player.getInventory().getAmount(I.RUSTY_SWORD), 0);
  assert.equal(player.getInventory().getAmount(I.COINS), 0);
  assert.equal(player.getInventory().getAmount(I.IRON_SWORD), 1);
  assert.equal(action.steps[0].npc, "There you go my friend, it turned out to be an iron sword.");
  assert.equal(action.steps[1].text, "Tindel gives you an iron sword.");
  assert.equal(emitted.filter(([name]) => name === "diary:task").length, 1);

  const duplicatePlayer = playerWith([[0, I.RUSTY_SWORD], [1, I.RUSTY_SWORD], [2, I.COINS, 200]]);
  const duplicateAction = { player: duplicatePlayer, npc: publicNpc(), npcId: 1358, pages, stepId: "Yaf6pt" };
  hooks.actions[0](duplicateAction);
  hooks.actions[0](duplicateAction);
  assert.equal(duplicatePlayer.getInventory().getAmount(I.RUSTY_SWORD), 1);
  assert.equal(duplicatePlayer.getInventory().getAmount(I.COINS), 100);
  assert.equal(duplicatePlayer.getInventory().getAmount(I.IRON_SWORD), 1);
  assert.equal(emitted.filter(([name]) => name === "diary:task").length, 2);

  const scimitarPlayer = playerWith([[0, I.RUSTY_SCIMITAR], [1, I.COINS, 100]]);
  const scimitarAction = { player: scimitarPlayer, npc: publicNpc(), npcId: 1358, pages, stepId: "S0wGie" };
  hooks.actions[0](scimitarAction);
  assert.equal(scimitarPlayer.getInventory().getAmount(I.BRONZE_SCIMITAR), 1);
  assert.equal(scimitarAction.steps[0].npc, "There you go my friend, it turned out to be a bronze scimitar.");
  assert.equal(emitted.filter(([name]) => name === "diary:task").length, 2);
});

test("Tindel does not run the imported menu jump when both rusty items are held", (t) => {
  const { hooks } = eventApi();
  t.mock.method(Math, "random", () => 0);
  const player = playerWith([[0, I.RUSTY_SWORD], [1, I.RUSTY_SCIMITAR], [2, I.COINS, 100]]);
  const action = { player, npc: publicNpc(), npcId: 1358, pages: [{ page: "Tindel Marchant" }], stepId: "Yaf6pt" };
  hooks.actions[0](action);
  assert.equal(action.handled, undefined);
  assert.equal(player.getInventory().getAmount(I.RUSTY_SWORD), 1);
  assert.equal(player.getInventory().getAmount(I.RUSTY_SCIMITAR), 1);
  assert.equal(player.getInventory().getAmount(I.COINS), 100);
});

test("Tindel item-on-NPC handler and Give-Sword suppress duplicate callbacks", (t) => {
  const { hooks, emitted } = eventApi();
  t.mock.method(Math, "random", () => 0);
  const player = playerWith([[0, I.RUSTY_SWORD], [1, I.RUSTY_SWORD], [2, I.COINS, 200]]);
  const event = { npcId: 1358, itemId: I.RUSTY_SWORD, player, npc: publicNpc() };
  hooks.item[0](event);
  hooks.item[0](event);
  assert.equal(event.handled, true);
  assert.equal(player.getInventory().getAmount(I.RUSTY_SWORD), 1);
  assert.equal(player.getInventory().getAmount(I.COINS), 100);
  assert.equal(player.getInventory().getAmount(I.IRON_SWORD), 1);
  assert.equal(emitted.filter(([name]) => name === "diary:task").length, 1);
  assert.equal(emitted.filter(([name]) => name === "npc-dialogue:start").length, 1);

  const givePlayer = playerWith([[0, I.RUSTY_SWORD], [1, I.RUSTY_SWORD], [2, I.COINS, 200]]);
  const giveSword = hooks.npc[0]["Give-Sword"];
  const giveEvent = { npcId: 1358, player: givePlayer, npc: publicNpc() };
  assert.equal(giveSword(giveEvent), true);
  assert.equal(giveSword(giveEvent), false);
  assert.equal(givePlayer.getInventory().getAmount(I.IRON_SWORD), 1);
  assert.equal(givePlayer.getInventory().getAmount(I.COINS), 100);
  assert.equal(givePlayer.getInventory().getAmount(I.RUSTY_SWORD), 1);
  assert.equal(emitted.filter(([name]) => name === "diary:task").length, 2);
});

test("Tindel diary credit requires both player and NPC to be in the public area", (t) => {
  const { hooks, emitted } = eventApi();
  t.mock.method(Math, "random", () => 0);

  for (const [playerArea, npcArea, shouldCredit] of [
    [null, null, true],
    [{ id: "player-instance" }, null, false],
    [null, { id: "npc-instance" }, false],
    [{ id: "player-instance" }, { id: "npc-instance" }, false],
  ]) {
    const before = emitted.filter(([name]) => name === "diary:task").length;
    const player = playerWith([[0, I.RUSTY_SWORD], [1, I.COINS, 100]]);
    player.getPrivateArea = () => playerArea;
    const npc = { getPrivateArea: () => npcArea };
    hooks.item[0]({ npcId: 1358, itemId: I.RUSTY_SWORD, player, npc });
    const creditCount = emitted.filter(([name]) => name === "diary:task").length - before;
    assert.equal(creditCount, shouldCredit ? 1 : 0);
  }
});

test("real Talk-to runner identifies the weapon selected from the both-items menu", async () => {
  const core = PluginManager.getCoreApi();
  const api = PluginManager.createApi("TindelDialogueRunnerTest");
  Tindel.register(api);
  const diaryCredits = [];
  const started = [];
  const closedInterfaces = [];
  api.onCustomEvent("diary:task", (event) => diaryCredits.push(event));
  api.onCustomEvent("interface:closed", (event) => closedInterfaces.push(event));
  require("../plugins/npcs/NpcDialogues.plugin").register(api);
  api.onCustomEvent("npc-dialogue:start", (event) => started.push(event));
  const npc = core.NPC.create(1358, new core.Location(2678, 3153, 0));

  function createRunnerPlayer(index) {
    const player = new Player(null);
    player.setUsername(`tindel-dialogue-${index}`);
    player.setIndex(index);
    player.isRegistered = () => true;
    let chatboxId = -1;
    const sender = new Proxy({
      sendString() { return sender; },
      sendChatboxInterface(id) { chatboxId = id; return sender; },
      isChatboxInterface(id) { return chatboxId === id; },
      sendInterfaceRemoval() { chatboxId = -1; return sender; },
      withChatboxOwner(_owner, present) { return present(); },
      closeChatboxFor() { return true; },
    }, { get: (target, key) => target[key] ?? (() => sender) });
    player.getPacketSender = () => sender;
    player.sendMessage = () => {};
    player.getInventory().setItem(0, new Item(I.RUSTY_SWORD, 1));
    player.getInventory().setItem(1, new Item(I.RUSTY_SCIMITAR, 1));
    player.getInventory().setItem(2, new Item(I.COINS, 200));
    return { player, sender };
  }

  function useNativePacketSender(player) {
    player.getSession = () => ({ sendClientPacket: () => true, write() {} });
    const sender = new PacketSender(player);
    player.getPacketSender = () => sender;
    return sender;
  }

  function talkToBothMenu(player) {
    const options = () => MultiChatboxPrompt.getPending(player)?.options ?? [];
    const advance = (limit = 40) => {
      for (let tick = 0; tick < limit && player.getDialogueManager().isActive(); tick++) {
        player.getDialogueManager().advance();
      }
    };
    const chooseOption = (label) => {
      advance();
      const index = options().indexOf(label);
      assert.notEqual(index, -1, `missing dialogue option ${label}: ${JSON.stringify(options())}`);
      assert.equal(MultiChatboxPrompt.handleInterfaceActionClick({
        player,
        buttonId: (219 << 16) | 1,
        slot: index + 1,
      }), true);
    };
    const npcId = npc.getContentId(player);
    assert.equal(PluginManager.emitNpcInteraction({
      player,
      npc,
      npcId,
      definition: npc.getCurrentDefinition(player),
      clickType: 1,
      handled: false,
    }), true);
    chooseOption("Ok, I'll give it a go!");
    advance();
    assert.deepEqual(options(), ["The sword", "The scimitar"]);
    return { options, advance, chooseOption };
  }

  for (const [choice, outputId, consumedId] of [
    ["The sword", I.IRON_SWORD, I.RUSTY_SWORD],
    ["The scimitar", I.BRONZE_SCIMITAR, I.RUSTY_SCIMITAR],
  ]) {
    const creditsBefore = diaryCredits.length;
    const player = new Player(null);
    const playerIndex = choice === "The sword" ? 918273 : 918274;
    player.setUsername(`tindel-dialogue-${playerIndex}`);
    player.setIndex(playerIndex);
    player.isRegistered = () => true;
    const packetText = [];
    let chatboxId = -1;
    const sender = new Proxy({
      sendString(text) { packetText.push(text); return sender; },
      sendChatboxInterface(id) { chatboxId = id; return sender; },
      isChatboxInterface(id) { return chatboxId === id; },
      sendInterfaceRemoval() { chatboxId = -1; return sender; },
      withChatboxOwner(_owner, present) { return present(); },
      closeChatboxFor() { return true; },
    }, { get: (target, key) => target[key] ?? (() => sender) });
    player.getPacketSender = () => sender;
    player.sendMessage = () => {};
    player.getInventory().setItem(0, new Item(I.RUSTY_SWORD, 1));
    player.getInventory().setItem(1, new Item(I.RUSTY_SCIMITAR, 1));
    player.getInventory().setItem(2, new Item(I.COINS, 200));
    const options = () => MultiChatboxPrompt.getPending(player)?.options ?? [];
    const advance = (limit = 40) => {
      for (let tick = 0; tick < limit && player.getDialogueManager().isActive(); tick++) {
        player.getDialogueManager().advance();
      }
    };
    const chooseOption = (label) => {
      advance();
      const index = options().indexOf(label);
      assert.notEqual(index, -1, `missing dialogue option ${label}: ${JSON.stringify(options())}`);
      assert.equal(MultiChatboxPrompt.handleInterfaceActionClick({
        player,
        buttonId: (219 << 16) | 1,
        slot: index + 1,
      }), true);
    };

    const npcId = npc.getContentId(player);
    assert.equal(PluginManager.emitNpcInteraction({
      player,
      npc,
      npcId,
      definition: npc.getCurrentDefinition(player),
      clickType: 1,
      handled: false,
    }), true);
    chooseOption("Ok, I'll give it a go!");
    advance();
    assert.deepEqual(options(), ["The sword", "The scimitar"]);

    const originalRandom = Math.random;
    Math.random = () => 0;
    try {
      chooseOption(choice);
    } finally {
      Math.random = originalRandom;
    }

    PluginManager.emitCustomEvent("interface:closed", { player, interfaceId: 219 });
    assert.equal(player.getInventory().getAmount(consumedId), 0);
    assert.equal(player.getInventory().getAmount(I.COINS), 100);
    assert.equal(player.getInventory().getAmount(outputId), 1);
    assert.equal(player.getInventory().getAmount(choice === "The sword" ? I.RUSTY_SCIMITAR : I.RUSTY_SWORD), 1);

    core.World.processCycle = (core.World.processCycle + 1) & 0x7fffffff;
    core.TaskManager.process();
    assert.equal(started.length > 0, true);
    assert.equal(started.at(-1).handled, true);
    advance();
    assert.equal(player.getInventory().getAmount(outputId), 1);
    const resultLine = choice === "The sword"
      ? "There you go my friend, it turned out to be an iron"
      : "There you go my friend, it turned out to be a bronze";
    assert.ok(packetText.some((text) => String(text).includes(resultLine)),
      `missing result line: ${resultLine}; packets=${JSON.stringify(packetText)}`);
    assert.equal(diaryCredits.length - creditsBefore, choice === "The sword" ? 1 : 0);
  }

  const nativeRandom = Math.random;
  for (const [choice, outputId, consumedId, index] of [
    ["The sword", I.IRON_SWORD, I.RUSTY_SWORD, 918280],
    ["The scimitar", I.BRONZE_SCIMITAR, I.RUSTY_SCIMITAR, 918281],
  ]) {
    const { player } = createRunnerPlayer(index);
    const nativeSender = useNativePacketSender(player);
    nativeSender.sendChatboxInterface(217);
    const before = started.length;
    const menu = talkToBothMenu(player);
    assert.ok(closedInterfaces.some((event) => event.player === player && event.interfaceId === 217));
    await Promise.resolve();
    Math.random = () => 0;
    try {
      menu.chooseOption(choice);
    } finally {
      Math.random = nativeRandom;
    }
    assert.equal(player.getInventory().getAmount(consumedId), 0);
    assert.equal(player.getInventory().getAmount(I.COINS), 100);
    assert.equal(player.getInventory().getAmount(outputId), 1);
    assert.equal(started.length, before);
    core.World.processCycle = (core.World.processCycle + 1) & 0x7fffffff;
    core.TaskManager.process();
    assert.equal(started.length, before + 1);
  }

  const movingPlayer = createRunnerPlayer(918282).player;
  useNativePacketSender(movingPlayer);
  const beforeMovement = started.length;
  const movementMenu = talkToBothMenu(movingPlayer);
  await Promise.resolve();
  Math.random = () => 0;
  try {
    movementMenu.chooseOption("The sword");
  } finally {
    Math.random = nativeRandom;
  }
  movingPlayer.getMovementQueue().requestWalk(new core.Location(2679, 3153, 0));
  core.World.processCycle = (core.World.processCycle + 1) & 0x7fffffff;
  core.TaskManager.process();
  assert.equal(started.length, beforeMovement);

  const cancelled = createRunnerPlayer(918275);
  const cancelledSender = useNativePacketSender(cancelled.player);
  talkToBothMenu(cancelled.player);
  cancelledSender.sendInterfaceRemoval();
  await Promise.resolve();
  PluginManager.emitCustomEvent("npc-dialogue:choice", {
    player: cancelled.player,
    npc,
    npcId: 1358,
    option: "The sword",
  });
  assert.equal(cancelled.player.getInventory().getAmount(I.RUSTY_SWORD), 1);
  assert.equal(cancelled.player.getInventory().getAmount(I.RUSTY_SCIMITAR), 1);
  assert.equal(cancelled.player.getInventory().getAmount(I.COINS), 200);

  const crossDialogue = createRunnerPlayer(918278);
  const crossMenu = talkToBothMenu(crossDialogue.player);
  PluginManager.emitCustomEvent("npc-dialogue:choice", {
    player: crossDialogue.player,
    npcId: 1359,
    option: "The sword",
  });
  crossMenu.chooseOption("The sword");
  assert.equal(crossDialogue.player.getInventory().getAmount(I.RUSTY_SWORD), 1);
  assert.equal(crossDialogue.player.getInventory().getAmount(I.RUSTY_SCIMITAR), 1);
  assert.equal(crossDialogue.player.getInventory().getAmount(I.COINS), 200);

  const reopened = talkToBothMenu(cancelled.player);
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    reopened.chooseOption("The scimitar");
  } finally {
    Math.random = originalRandom;
  }
  assert.equal(cancelled.player.getInventory().getAmount(I.RUSTY_SWORD), 1);
  assert.equal(cancelled.player.getInventory().getAmount(I.RUSTY_SCIMITAR), 0);
  assert.equal(cancelled.player.getInventory().getAmount(I.COINS), 100);
  assert.equal(cancelled.player.getInventory().getAmount(I.BRONZE_SCIMITAR), 1);
  core.World.processCycle = (core.World.processCycle + 1) & 0x7fffffff;
  core.TaskManager.process();

  for (const [index, lifecycle] of [[918276, "logout"], [918277, "death"], [918279, "movement"]]) {
    const { player } = createRunnerPlayer(index);
    const beforeDeferredStart = started.length;
    const activeMenu = talkToBothMenu(player);
    Math.random = () => 0;
    try {
      activeMenu.chooseOption("The sword");
    } finally {
      Math.random = originalRandom;
    }
    assert.equal(player.getInventory().getAmount(I.RUSTY_SWORD), 0);
    assert.equal(player.getInventory().getAmount(I.IRON_SWORD), 1);
    if (lifecycle === "logout") {
      PluginManager.emitPlayerLogout({ player, username: player.getUsername() });
      player.isRegistered = () => false;
    } else if (lifecycle === "death") {
      player.getHitpoints = () => 0;
      PluginManager.emitPlayerDeath({ player, killer: null, itemsLost: false, handled: false });
    } else {
      player.getMovementQueue().requestWalk(new core.Location(2679, 3153, 0));
    }
    core.World.processCycle = (core.World.processCycle + 1) & 0x7fffffff;
    core.TaskManager.process();
    assert.equal(started.length, beforeDeferredStart, `${lifecycle} suppresses the deferred result dialogue`);
  }
});
