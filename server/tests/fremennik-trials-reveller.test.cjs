// Run after `yarn build`: node --test tests/fremennik-trials-reveller.test.cjs
//
// The Fremennik Trials: the Reveller's trial (Manni's drinking contest) as rsprox 1002236 (rev 242;
// ticks 3188-3314, 4461-4744, 5690-5868), 1002250 (rev 242, the win) and 1001364 (rev 241) show it.
// Real Player, session and connection, the real plugins, cache and map: talks and clicks are
// packets, each tick runs as World.process does.
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
const { AreaManager } = require("../dist/game/model/areas/AreaManager");
const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");
const { GroundItemSpawnDefinitionLoader } = require("../dist/game/definition/loader/impl/GroundItemSpawnDefinitionLoader");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const REVELLER = 0;
const FLAG = { FIRECRACKER: 0, LOW_ALCOHOL: 1, LOW_ALCOHOL_BOUGHT: 8 };
const ID = {
  BEER: 1917, TINDERBOX: 590, COINS: 995, KEG: 3711, LOW_KEG: 3712, OBJECT: 3713, LIT: 3714, TANKARD: 3803,
  MANNI: 3920, WORKMAN: 3921, BRUNDT: 3926, THORA: 3932, POISON: 4227, PIPE: 4162,
};
const KEG_TILE = [2660, 3676, 0];
const PIPE_TILE = [2663, 3674];
const LONGHALL = [2659, 3675, 0];
const MANNI_TILE = [2657, 3673, 0];

let core;
let next = 7700;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(2660, 3676);
  core.RegionManager.loadMapFiles(2697, 3491);
  PM.emitServerStartup({});
  new GroundItemSpawnDefinitionLoader().load();
});
after(() => PM.emitServerShutdown({}));

const quest = () => QuestRuntime.getRegisteredQuests().findLast((entry) => entry.key === "fremennik_trials");
const trial = (f) => (Number(f.player.getAttribute("quest.fremennik_trials.trials")) >>> (REVELLER * 3)) & 7;
const flag = (f, bit) => ((Number(f.player.getAttribute("quest.fremennik_trials.flags")) >>> bit) & 1) === 1;
const amount = (f, id) => f.player.getInventory().getAmount(id);

function actor(t, { stage = 1, state = 0, flags = 0, items = [], at = LONGHALL } = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel);
  const player = new Player(session);
  session.setPlayer(player);
  player.setUsername("revel" + next++);
  player.setLongUsername(core.Misc.stringToLongBigInt(player.getUsername()));
  player.setAttribute("bot-skip-persistence", true);
  player.setLocation(new core.Location(...at));
  player.needsPlacement = false;
  assert.equal(core.World.getPlayers().add(player), true);
  const connection = new ClientConnection(channel);
  connection.player = player;
  connection.sendPlayerBootstrap();
  const f = { t, player, connection, tick: 0, calls: [], messages: [], said: [], animations: [], npcs: [], chats: [] };
  record(f);
  t.after(() => {
    for (const npc of f.npcs) core.World.getNpcs().remove(npc);
    core.World.getPlayers().remove(player);
    PM.emitPlayerLogout({ player, username: player.getUsername() });
    core.TaskManager.cancelTasks(player.getIndex());
    core.TaskManager.cancelTasks(player);
  });
  if (stage) quest().setStage(player, stage);
  player.setAttribute("quest.fremennik_trials.trials", state << (REVELLER * 3));
  player.setAttribute("quest.fremennik_trials.flags", flags);
  for (const entry of items) {
    const [id, count] = Array.isArray(entry) ? entry : [entry, 1];
    player.getInventory().add(new core.Item(id, count), false);
  }
  tick(f);
  f.messages.length = 0;
  f.calls.length = 0;
  return f;
}

const RECORDED = /^(sendSound|sendSoundEffect|sendAreaSound|sendCameraShake|sendCameraReset|sendConfig|sendInterfaceRemoval)$/;
function record(f) {
  const sender = f.player.getPacketSender();
  const proto = Object.getPrototypeOf(sender);
  let depth = 0;
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (!RECORDED.test(name) || typeof proto[name] !== "function") continue;
    const original = proto[name];
    sender[name] = function (...args) {
      if (depth === 0) f.calls.push({ tick: f.tick, name, args });
      depth++;
      try { return original.apply(this, args); } finally { depth--; }
    };
  }
  watch(f, f.player, "player");
  const send = f.player.sendMessage.bind(f.player);
  f.player.sendMessage = (text, ...rest) => {
    f.messages.push({ tick: f.tick, text });
    return send(text, ...rest);
  };
}

function watch(f, mob, who) {
  const perform = mob.performAnimation.bind(mob);
  mob.performAnimation = (animation, ...rest) => {
    f.animations.push({ tick: f.tick, who, id: animation?.getId?.() });
    return perform(animation, ...rest);
  };
  const chat = mob.forceChat.bind(mob);
  mob.forceChat = (text, ...rest) => {
    f.chats.push({ tick: f.tick, who, text });
    return chat(text, ...rest);
  };
}

function spawn(f, id, tile) {
  const npc = core.NPC.create(id, new core.Location(...tile));
  core.World.getNpcs().add(npc);
  f.npcs.push(npc);
  watch(f, npc, id);
  return npc;
}

function tick(f) {
  f.tick++;
  core.World.processCycle++;
  core.TaskManager.process();
  core.ItemOnGroundManager.process();
  f.connection.processTurnPackets();
  AreaManager.process(f.player);
  core.TaskManager.processWalkTo(f.player.getIndex());
  f.player.getMovementQueue().process();
  f.player.getCombat?.()?.getHitQueue?.()?.process?.(core.World.processCycle);
  f.player.getSession().flushClient(core.World.processCycle);
  f.player.resetUpdating();
  const line = shown(f);
  if (line && f.said.at(-1)?.text !== line.text) f.said.push({ tick: f.tick, ...line });
}
const ticks = (f, count) => { for (let i = 0; i < count; i++) tick(f); };

function shown(f) {
  const menu = MultiChatboxPrompt.getPending(f.player);
  if (menu) return { who: "menu", text: menu.options.join(" | ") };
  const current = f.player.getDialogueManager().getCurrent?.();
  if (!current || typeof current.getText !== "function") return null;
  const text = current.getText();
  return { who: current.constructor.name, text: Array.isArray(text) ? text.join(" ") : text };
}

async function talk(f, npc) {
  await f.connection.dispatch([{ type: "npc_option", index: npc.getIndex(), clickType: 1 }]);
  for (let i = 0; i < 20 && !shown(f); i++) tick(f);
}

async function continueLine(f) {
  const group = f.player.getPacketSender().getChatboxGroupId();
  await f.connection.dispatch([{ type: "dialogue_continue", widgetId: (group << 16) | ([231, 217].includes(group) ? 5 : group === 229 ? 4 : 0), childIndex: -1 }]);
  tick(f);
}

async function choose(f, text) {
  const options = MultiChatboxPrompt.getPending(f.player).options;
  const index = options.indexOf(text);
  assert.ok(index >= 0, `"${text}" in ${JSON.stringify(options)}`);
  await f.connection.dispatch([{ type: "dialogue_continue", widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: index + 1 }]);
  tick(f);
}

/** Continues until a line starting with `text` shows; returns its tick. */
async function until(f, text, limit = 80) {
  for (let i = 0; i < limit; i++) {
    const line = shown(f);
    if (line && line.text.startsWith(text)) return f.tick;
    if (line && line.who !== "menu") await continueLine(f);
    else tick(f);
  }
  assert.fail(`"${text}" never showed; said: ${JSON.stringify(f.said.slice(-6))}`);
}

async function finishChat(f, limit = 60) {
  for (let i = 0; i < limit && shown(f); i++) {
    if (shown(f).who === "menu") return;
    await continueLine(f);
  }
}

const slotOf = (f, id) => f.player.getInventory().getSlotForItemId(id);

async function useOn(f, used, target) {
  await f.connection.dispatch([{ type: "inventory_use_on", slot: slotOf(f, used), itemId: used, target: { kind: "inventory", slot: slotOf(f, target) } }]);
  tick(f);
}

async function useOnNpc(f, itemId, npc) {
  await f.connection.dispatch([{ type: "item_on_npc", targetIndex: npc.getIndex(), itemId, slot: slotOf(f, itemId), widgetId: core.Inventory.INTERFACE_ID << 16 }]);
  for (let i = 0; i < 20 && !shown(f); i++) tick(f);
}

async function useOnPipe(f, itemId) {
  await f.connection.dispatch([{ type: "item_on_object", objectId: ID.PIPE, x: PIPE_TILE[0], y: PIPE_TILE[1], itemId, slot: slotOf(f, itemId), widgetId: core.Inventory.INTERFACE_ID }]);
  const said = f.messages.length;
  for (let i = 0; i < 20 && !shown(f) && f.messages.length === said; i++) tick(f);
}

async function takeKeg(f) {
  await f.connection.dispatch([{ type: "ground_item_action", itemId: ID.KEG, x: KEG_TILE[0], y: KEG_TILE[1], option: "Take" }]);
  const before = amount(f, ID.KEG);
  const said = f.messages.length;
  for (let i = 0; i < 20 && amount(f, ID.KEG) === before && f.messages.length === said; i++) tick(f);
}

const kegOnTable = () => core.World.getItems().some((item) => item.getItem().getId() === ID.KEG
  && item.getPosition().getX() === KEG_TILE[0] && item.getPosition().getY() === KEG_TILE[1] && !item.isPendingRemoval());
const messagesAt = (f, tick) => f.messages.filter((m) => m.tick === tick).map((m) => m.text);
const callsNamed = (f, name) => f.calls.filter((c) => c.name === name);

/** Talks to Manni with a keg, says Yes, and continues past "As you wish"; returns that tick. */
async function startContest(f, manni, wish) {
  await talk(f, manni);
  await until(f, "Yes | No");
  await choose(f, "Yes");
  assert.equal(shown(f).text, "Yes, let's start this drinking contest!");
  await continueLine(f);
  assert.equal(shown(f).text, wish);
  await continueLine(f);
  return f.tick;
}

test("Manni's offer starts the trial and hands out nothing (1002236 t3188-3256)", async (t) => {
  const f = actor(t);
  const manni = spawn(f, ID.MANNI, MANNI_TILE);
  await talk(f, manni);
  assert.equal(shown(f).text, "Hello there!");
  await until(f, "Yes | No");
  await choose(f, "Yes");
  assert.equal(shown(f).text, "A drinking contest? Easy. Set them up, and I'll knock them back.");
  assert.equal(trial(f), 1);
  await continueLine(f);
  assert.equal(shown(f).text, "When you are ready to begin, go and pick up a keg from that table over there, and come back here.");
  await continueLine(f);
  assert.ok(shown(f).text.startsWith("We start when you have your keg of beer with you"));
  await continueLine(f);
  assert.equal(shown(f), null);
  assert.equal(f.player.getInventory().getValidItems().length, 0, "no keg and no tankard");
  assert.deepEqual(f.messages, []);
  // Without a keg Manni sends the player back to the table.
  await talk(f, manni);
  assert.equal(shown(f).text, "What do I have to do to earn your vote again?");
  await continueLine(f);
  assert.ok(shown(f).text.startsWith("Beat me in a drinking contest! Grab a keg of beer from that table"));
});

test("the keg on the table: Take as a table take, it is back at once; one keg only (t3259-3262, t5802)", async (t) => {
  const f = actor(t, { state: 1 });
  assert.ok(kegOnTable(), "viking_beerkeg lies on the table at 2660,3676");
  await takeKeg(f);
  assert.equal(amount(f, ID.KEG), 1);
  const took = f.tick;
  assert.ok(f.animations.some((a) => a.who === "player" && a.id === 9401 && a.tick === took), JSON.stringify(f.animations));
  assert.ok(callsNamed(f, "sendSoundEffect").some((c) => c.args[0] === 2582 && c.tick === took));
  // Ours: back two ticks later (live: the same tick).
  ticks(f, 2);
  assert.ok(kegOnTable(), "the keg respawns at once");
  f.messages.length = 0;
  await takeKeg(f);
  assert.equal(amount(f, ID.KEG), 1);
  assert.deepEqual(f.messages.map((m) => m.text), ["You already have a keg of beer."]);
});

test("the lost contest: drinks, the keg goes, the shake, then Manni wins (1002236 t3265-3314)", async (t) => {
  const f = actor(t, { state: 1, items: [ID.KEG] });
  const manni = spawn(f, ID.MANNI, MANNI_TILE);
  const start = await startContest(f, manni, "As you wish outerlander; I will drink first, then you will drink.");
  assert.equal(shown(f), null, "the chatbox closes");
  assert.ok(f.animations.some((a) => a.who === ID.MANNI && a.id === 1327 && a.tick === start));
  // Talk-to during the scene is ignored (1002236 t5839).
  await talk(f, manni);
  ticks(f, 16 - (f.tick - start));
  assert.deepEqual(messagesAt(f, start + 2), ["The Fremennik drinks his tankard first. He staggers a little bit."]);
  assert.deepEqual(messagesAt(f, start + 7), ["You drink from your keg. You feel extremely drunk..."]);
  assert.ok(f.animations.some((a) => a.who === "player" && a.id === 1330 && a.tick === start + 7));
  assert.ok(callsNamed(f, "sendSound").some((c) => c.args[0] === 2401 && c.tick === start + 7));
  assert.equal(amount(f, ID.KEG), 0);
  assert.deepEqual(callsNamed(f, "sendCameraShake").map((c) => [c.tick - start, ...c.args]), [[9, 3, 0, 20, 2]]);
  const ish = f.said.find((line) => line.text.startsWith("Ish no' fair!"));
  assert.equal(ish?.tick, start + 15);
  await continueLine(f);
  assert.equal(shown(f).text, "I guessh I win then ouddaladder! (hic) Niche try, anyway!");
  assert.equal(callsNamed(f, "sendCameraReset").length, 0);
  await continueLine(f);
  assert.ok(shown(f).text.startsWith("Come back if'n you fanshy a rematch!"));
  assert.equal(callsNamed(f, "sendCameraReset").length, 1);
  await continueLine(f);
  assert.equal(shown(f), null);
  assert.equal(trial(f), 1, "a loss passes nothing");
});

test("the council workman swaps a beer or a tankard for the strange object in its slot (t4744)", async (t) => {
  for (const drink of [ID.BEER, ID.TANKARD]) {
    const f = actor(t, { items: [ID.TINDERBOX, drink], at: [2652, 3592, 0] });
    const workman = spawn(f, ID.WORKMAN, [2653, 3592, 0]);
    const slot = slotOf(f, drink);
    await useOnNpc(f, drink, workman);
    assert.equal(amount(f, drink), 0);
    assert.equal(f.player.getInventory().forSlot(slot).getId(), ID.OBJECT);
    assert.ok(shown(f).text.startsWith("Ta very much, like."));
    await continueLine(f);
    assert.equal(shown(f).text, "What is it?");
    await finishChat(f);
    assert.equal(amount(f, ID.OBJECT), 1, "one strange object");
  }
});

test("the workman's wink and the salesman's narration are message boxes (1001364 t3084, 1002236 t4534)", async (t) => {
  const f = actor(t, { at: [2652, 3592, 0] });
  const workman = spawn(f, ID.WORKMAN, [2653, 3592, 0]);
  await talk(f, workman);
  await until(f, "Yes | No");
  await choose(f, "Yes");
  await until(f, "The workman winks at you");
  assert.equal(shown(f).who, "StatementDialogue");
  assert.equal(f.messages.length, 0);
});

test("the poison salesman sells the low-alcohol keg for 250 coins (1002236 t4461-4652)", async (t) => {
  const f = actor(t, { items: [[ID.COINS, 300]], at: [2696, 3491, 0] });
  const salesman = spawn(f, ID.POISON, [2697, 3491, 0]);
  await talk(f, salesman);
  await choose(f, "Talk about the Fremennik Trials");
  await until(f, "The salesman takes a deep breath.");
  assert.equal(shown(f).who, "StatementDialogue");
  await until(f, "He seems to have finished for the time being.");
  assert.equal(shown(f).who, "StatementDialogue");
  await until(f, "Yes | No");
  await choose(f, "Yes");
  assert.equal(shown(f).text, "Yes please!");
  await continueLine(f);
  assert.equal(shown(f), null);
  assert.equal(amount(f, ID.COINS), 50);
  assert.equal(amount(f, ID.LOW_KEG), 1);
  assert.deepEqual(f.messages, [], "no narration goes to chat");
  // Talked to again: the same menu, then the short offer, whose Yes answers in the pick's tick
  // (rsprox 1002313 t1203-1205, t1222).
  await talk(f, salesman);
  await choose(f, "Talk about the Fremennik Trials");
  assert.equal(shown(f).text, "I understand you have some low alcohol beer for sale...?");
  await until(f, "Yes | No");
  await choose(f, "Yes");
  assert.equal(shown(f).text, "Yes please!");
  await finishChat(f);
  assert.equal(amount(f, ID.LOW_KEG), 1, "50 coins buy nothing");
});

test("lighting the strange object, the pipe: message and line, no bang (t5690-5697)", async (t) => {
  const f = actor(t, { state: 1, items: [ID.TINDERBOX, ID.OBJECT], at: [2662, 3675, 0] });
  await useOn(f, ID.TINDERBOX, ID.OBJECT);
  assert.equal(amount(f, ID.LIT), 1);
  assert.deepEqual(f.messages.map((m) => m.text), ["You light the string of the strange object. It starts to hiss slightly."]);
  assert.ok(callsNamed(f, "sendSound").some((c) => c.args[0] === 2598));
  f.messages.length = 0;
  await useOnPipe(f, ID.LIT);
  assert.equal(amount(f, ID.LIT), 0);
  assert.ok(flag(f, FLAG.FIRECRACKER));
  assert.deepEqual(f.messages.map((m) => m.text), ["You put the lit strange object into the pipe."]);
  assert.equal(shown(f).text, "That is going to make a really loud bang when it goes off! It would be a perfect distraction to help me cheat in the drinking contest!");
  assert.equal(callsNamed(f, "sendAreaSound").length, 0, "no bang yet");
});

test("anything else in the pipe gets the player's line (Wiki)", async (t) => {
  const f = actor(t, { items: [ID.TINDERBOX], at: [2662, 3675, 0] });
  await useOnPipe(f, ID.TINDERBOX);
  assert.equal(shown(f).text, "I don't have anything I really want to put inside a smelly old drain pipe.");
});

test("switching without a distraction: Manni catches the player (Wiki)", async (t) => {
  const f = actor(t, { state: 1, items: [ID.KEG, ID.LOW_KEG] });
  await useOn(f, ID.LOW_KEG, ID.KEG);
  for (let i = 0; i < 3 && !shown(f); i++) tick(f);
  assert.ok(shown(f).text.startsWith("Thinking of cheating my test, outerlander?"));
  assert.equal(amount(f, ID.LOW_KEG), 1);
  assert.ok(!flag(f, 1));
});

test("the switch with the object in the pipe: bang, then the refill and the longhall's shout (t5811-5813)", async (t) => {
  for (const [used, target] of [[ID.KEG, ID.LOW_KEG], [ID.LOW_KEG, ID.KEG]]) {
    const f = actor(t, { state: 1, flags: 1 << FLAG.FIRECRACKER, items: [ID.KEG, ID.LOW_KEG] });
    spawn(f, ID.THORA, [2662, 3673, 0]);
    spawn(f, ID.BRUNDT, [2657, 3666, 0]);
    ticks(f, 1);
    await useOn(f, used, target);
    const bang = f.tick;
    assert.deepEqual(messagesAt(f, bang), ["You hear a loud bang from outside. It echoes through the drain."]);
    assert.deepEqual(callsNamed(f, "sendAreaSound").map((c) => c.args.slice(0, 7)), [[1487, 2659, 3685, 0, 1, 0, 10]]);
    assert.equal(amount(f, ID.LOW_KEG), 1);
    tick(f);
    assert.deepEqual(messagesAt(f, bang + 1), ["You empty the keg and refill it with low alcohol beer."]);
    assert.equal(amount(f, ID.LOW_KEG), 0);
    assert.equal(amount(f, ID.KEG), 1, "the held keg stays item 3711");
    assert.ok(flag(f, FLAG.LOW_ALCOHOL));
    assert.ok(!flag(f, FLAG.FIRECRACKER));
    assert.deepEqual(f.chats.filter((c) => c.tick === bang + 1).map((c) => [c.who, c.text]).sort(),
      [[ID.BRUNDT, "What was THAT?"], [ID.THORA, "What was THAT?"]]);
  }
});

test("the win: sober drink, Manni concedes, the trial passes on the last line's continue (t5816-5868)", async (t) => {
  const f = actor(t, { state: 1, flags: 1 << FLAG.LOW_ALCOHOL, items: [ID.KEG] });
  const manni = spawn(f, ID.MANNI, MANNI_TILE);
  const stage = quest().getStage(f.player);
  const start = await startContest(f, manni, "As you wish outerlander; I will drink first, then you will drink.");
  assert.ok(f.animations.some((a) => a.who === ID.MANNI && a.id === 1327 && a.tick === start));
  ticks(f, 13);
  assert.deepEqual(messagesAt(f, start + 2), ["The Fremennik drinks his tankard first. He staggers a little bit."]);
  assert.deepEqual(messagesAt(f, start + 7), ["You drink from your keg. You don't feel at all drunk."]);
  assert.ok(f.animations.some((a) => a.who === "player" && a.id === 1330 && a.tick === start + 7));
  assert.ok(!callsNamed(f, "sendSound").some((c) => c.args[0] === 2401), "no liquid sound");
  assert.equal(callsNamed(f, "sendCameraShake").length, 0, "no shake");
  assert.equal(amount(f, ID.KEG), 0);
  assert.equal(f.said.find((line) => line.text.startsWith("Aaaah, lovely stuff."))?.tick, start + 12);
  await continueLine(f);
  assert.ok(shown(f).text.startsWith("Wassha? Guh? You drank that whole keg!"));
  await continueLine(f);
  assert.ok(shown(f).text.startsWith("I jusht can't (hic) believe it!"));
  assert.deepEqual(messagesAt(f, f.tick), ["Congratulations! You have completed the Revellers' trial."]);
  assert.equal(trial(f), 1, "passed only on the continue");
  await continueLine(f);
  assert.equal(shown(f), null);
  assert.equal(trial(f), 2);
  assert.equal(quest().getStage(f.player), stage + 1);
  assert.equal(f.messages.filter((m) => m.text.startsWith("Congratulations!")).length, 1, "the message is sent once");
  assert.ok(!flag(f, FLAG.LOW_ALCOHOL));
  // Afterwards Manni's vote is assured.
  await talk(f, manni);
  assert.equal(shown(f).text, "So I can rely on your vote at the council?");
});

test("the win menu's No is the again talk's No", async (t) => {
  const f = actor(t, { state: 1, flags: 1 << FLAG.LOW_ALCOHOL, items: [ID.KEG] });
  const manni = spawn(f, ID.MANNI, MANNI_TILE);
  await talk(f, manni);
  assert.equal(shown(f).text, "Ah, I see you have your keg of beer. Are we ready to drink against each other?");
  await until(f, "Yes | No");
  await choose(f, "No");
  for (let i = 0; i < 3 && !shown(f); i++) tick(f);
  assert.equal(shown(f).text, "I'm not quite ready yet...");
  await continueLine(f);
  assert.ok(shown(f).text.startsWith("Want to line your stomach with some food"));
  assert.equal(amount(f, ID.KEG), 1);
});

test("after the quest Manni buys the player a beer (Wiki)", async (t) => {
  const f = actor(t, { stage: 8, state: 2 });
  const manni = spawn(f, ID.MANNI, MANNI_TILE);
  await talk(f, manni);
  assert.equal(shown(f).text, "Howdy!");
  await continueLine(f);
  assert.ok(shown(f).text.startsWith("Hey! It's "));
  assert.ok(!shown(f).text.includes("[Fremennik name]"));
  await finishChat(f);
  assert.equal(amount(f, ID.BEER), 1);
});

test("a lit object kept 70-100 s explodes in the inventory (Wiki)", async (t) => {
  const f = actor(t, { items: [ID.TINDERBOX, ID.OBJECT] });
  await useOn(f, ID.TINDERBOX, ID.OBJECT);
  const lit = f.tick;
  ticks(f, 170);
  const boom = f.messages.find((m) => m.text === "The strange object you lit earlier explodes in your inventory!");
  assert.ok(boom && boom.tick - lit >= 117 && boom.tick - lit <= 167, JSON.stringify(boom));
  assert.equal(amount(f, ID.LIT), 0);
  assert.ok(f.chats.some((c) => c.who === "player" && c.text === "Ow!"));
});
