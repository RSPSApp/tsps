// Run after `yarn build`: node --test tests/nature-spirit-capture.test.cjs
//
// Nature Spirit against the user's whole-quest rsprox capture (NatureSpirit, revision 242.1,
// docs/quests/nature-spirit/README.md). Real Player, PlayerSession and ClientConnection, the
// real plugins, cache and map: talks and clicks are packets, each tick runs as World.process does.
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
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const CAMP = [3439, 3337, 0]; // beside the grotto entrance (capture 364), Filliman appears south-east
const GROTTO_ENTRANCE = [3440, 3337];
const IN_GROTTO = [3442, 9739, 0];
const DREZEL_TILE = [3439, 9894, 0];
const BESIDE_DREZEL = [3440, 9894, 0];
const LOGS = [3406, 3390, 0]; // between the two rotting logs the capture's Bloom grows (868)

let core;
let I;
let N;
let O;
let next = 8200;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  N = core.NpcIdentifiers;
  O = core.ObjectIdentifiers;
  core.ObjectDefinition.init();
  core.RegionManager.init();
  for (const [x, y] of [[3440, 3337], [3442, 9739], [3439, 9894], [3406, 3390]]) core.RegionManager.loadMapFiles(x, y);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const quest = () => QuestRuntime.getRegisteredQuests().findLast((entry) => entry.key === "nature_spirit");
const stage = (f) => quest().getStage(f.player);

function actor(t, { stage: start = 0, items = [], at = CAMP, amulet = true, attributes = {} } = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel);
  const player = new Player(session);
  session.setPlayer(player);
  player.setUsername("druid" + next++);
  player.setLongUsername(core.Misc.stringToLongBigInt(player.getUsername()));
  player.setAttribute("bot-skip-persistence", true);
  player.setLocation(new core.Location(...at));
  player.needsPlacement = false;
  assert.equal(core.World.getPlayers().add(player), true);
  const connection = new ClientConnection(channel);
  connection.player = player;
  connection.sendPlayerBootstrap();
  const f = { t, player, connection, tick: 0, calls: [], said: [], messages: [], npcs: [] };
  record(f);
  t.after(() => {
    for (const npc of f.npcs) core.World.getNpcs().remove(npc);
    PM.emitPlayerLogout({ player, username: player.getUsername() });
    core.World.getPlayers().remove(player);
    core.TaskManager.cancelTasks(player.getIndex());
    core.TaskManager.cancelTasks(player);
  });
  quest().setStage(player, start);
  for (const [key, value] of Object.entries(attributes)) player.setAttribute(key, value);
  if (amulet) player.getEquipment().setItem(core.Equipment.AMULET_SLOT, new core.Item(I.GHOSTSPEAK_AMULET, 1));
  for (const id of items) player.getInventory().add(new core.Item(id, 1), false);
  return f;
}

function spawn(f, id, tile) {
  const npc = core.NPC.create(id, new core.Location(...tile));
  core.World.getNpcs().add(npc);
  f.npcs.push(npc);
  return npc;
}

const RECORDED = /^(sendVarbit|sendConfig|sendSubInterface|sendInterfaceRemoval|sendString|sendSoundEffect|sendGraphic|sendItemOnInterface|sendNpcHeadOnInterface)$/;
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
  const send = f.player.sendMessage.bind(f.player);
  f.player.sendMessage = (text, ...rest) => {
    f.messages.push({ tick: f.tick, text });
    return send(text, ...rest);
  };
  const animate = f.player.performAnimation.bind(f.player);
  f.player.performAnimation = (animation) => {
    (f.animations ??= []).push({ tick: f.tick, id: animation.getId() });
    return animate(animation);
  };
}

function tick(f) {
  f.tick++;
  core.World.processCycle++;
  core.TaskManager.process();
  f.connection.processTurnPackets();
  AreaManager.process(f.player);
  core.TaskManager.processWalkTo(f.player.getIndex());
  f.player.getMovementQueue().process();
  f.player.getSession().flushClient(core.World.processCycle);
  f.player.resetUpdating();
  const line = shown(f);
  if (line && f.said.at(-1)?.text !== line.text) f.said.push({ tick: f.tick, ...line });
}
const ticks = (f, count) => { for (let i = 0; i < count; i++) tick(f); };

function shown(f) {
  const menu = MultiChatboxPrompt.getPending(f.player);
  if (menu) return { who: "menu", text: menu.options.join(" | "), title: menu.title };
  const current = f.player.getDialogueManager().getCurrent?.();
  if (!current || typeof current.getText !== "function") return null;
  return { who: current.constructor.name, text: String(current.getText()).replace(/<br>/g, " ").replace(/\s+/g, " ").trim(), npcId: current.getNpcId?.() };
}

async function dispatch(f, packet) {
  for (let i = 0; i < 10 && f.player.busy(); i++) tick(f);
  await f.connection.dispatch([packet]);
  tick(f);
}

async function clickObject(f, id, [x, y], clickType = 1) {
  await dispatch(f, { type: "object_option", id, x, y, clickType });
  for (let i = 0; i < 15 && !shown(f); i++) tick(f);
}

async function talk(f, npc) {
  for (let i = 0; i < 10 && f.player.busy(); i++) tick(f);
  await f.connection.dispatch([{ type: "npc_option", index: npc.getIndex(), clickType: 1 }]);
  for (let i = 0; i < 20 && !shown(f); i++) tick(f);
}

async function continueLine(f) {
  const group = f.player.getPacketSender().getChatboxGroupId();
  await f.connection.dispatch([{ type: "dialogue_continue", widgetId: (group << 16) | ([231, 217].includes(group) ? 5 : group === 229 ? 4 : 0), childIndex: -1 }]);
  tick(f);
}

async function choose(f, text) {
  if (!MultiChatboxPrompt.getPending(f.player)) assert.fail(`no menu for "${text}"; said: ${JSON.stringify(f.said.slice(-5))} messages: ${JSON.stringify(f.messages.slice(-4))}`);
  const options = MultiChatboxPrompt.getPending(f.player).options;
  const index = options.indexOf(text);
  assert.ok(index >= 0, `"${text}" in ${JSON.stringify(options)}`);
  await f.connection.dispatch([{ type: "dialogue_continue", widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: index + 1 }]);
  tick(f);
}

/** Continues until `text` shows (each continue is one tick), then returns its tick. */
async function until(f, text, limit = 80) {
  for (let i = 0; i < limit; i++) {
    const line = shown(f);
    if (line?.text?.startsWith(text) || (line?.who === "menu" && line.text.includes(text))) return f.tick;
    if (line && line.who !== "menu") await continueLine(f);
    else tick(f);
  }
  assert.fail(`"${text}" never showed; said: ${JSON.stringify(f.said.slice(-6))}`);
}

/** Waits (no continue) until `text` shows, then returns its tick. */
function waitFor(f, text, limit = 20) {
  for (let i = 0; i < limit; i++) {
    if (shown(f)?.text?.startsWith(text)) return f.tick;
    tick(f);
  }
  assert.fail(`"${text}" never showed; said: ${JSON.stringify(f.said.slice(-6))}`);
}

/** The tick an NPC chat line's text was sent (a held line has no dialogue entry to read). */
const chatText = (call) => String(call.args[0]).replace(/<br>/g, " ").replace(/\s+/g, " ").trim();
function chatAt(f, text, from = 0) {
  return f.calls.find((call) => call.tick >= from && call.name === "sendString" && call.args[1] === ((231 << 16) | 6) && chatText(call).startsWith(text))?.tick;
}
/** Ticks on until an NPC line starting `text` is sent, then returns that tick. */
function waitForChat(f, text, limit = 10) {
  const from = f.tick;
  for (let i = 0; i < limit && chatAt(f, text, from) === undefined; i++) tick(f);
  const at = chatAt(f, text, from);
  assert.ok(at !== undefined, `"${text}" never sent; said: ${JSON.stringify(f.said.slice(-4))}`);
  return at;
}

async function finishChat(f, limit = 40) {
  for (let i = 0; i < limit && shown(f); i++) {
    if (shown(f).who === "menu") return;
    await continueLine(f);
  }
}

const spiritOf = (f) => core.World.getNpcs().getAll?.().find?.((npc) => npc && npc.getOwner?.() === f.player)
  ?? [...core.World.getNpcs()].find((npc) => npc && (npc.getAttribute?.("owner") === f.player || npc.owner === f.player || npc.getOwner?.() === f.player)
    && [N.FILLIMAN_TARLOCK, N.NATURE_SPIRIT].includes(npc.getId()));
const npcAt = (f, ids) => [...core.World.getNpcs()].filter(Boolean).filter((npc) => ids.includes(npc.getId()));
const messagesAt = (f, tickNo) => f.messages.filter((m) => m.tick === tickNo).map((m) => m.text);
const sounds = (f) => f.calls.filter((call) => call.name === "sendSoundEffect").map((call) => ({ tick: call.tick, id: call.args[0] }));
const slotOf = (f, id) => f.player.getInventory().getItems().findIndex((item) => item?.getId() === id);
const at = (f) => [f.player.getLocation().getX(), f.player.getLocation().getY(), f.player.getLocation().getZ()];

test("Enter at stage 10: the prepare line, the apparition box and Filliman at his camp; 20 only with his denial (ticks 364-381)", async (t) => {
  const f = actor(t, { stage: 10 });
  await clickObject(f, O.GROTTO, GROTTO_ENTRANCE);
  assert.ok(f.messages.some((m) => m.text === "You prepare to enter the Druid's grotto."), JSON.stringify(f.messages));
  assert.equal(shown(f)?.text, "A shifting apparition appears in front of you.");
  assert.ok(sounds(f).some((s) => s.id === 432), "ghast_appear");
  const filliman = npcAt(f, [N.FILLIMAN_TARLOCK]).at(-1);
  assert.ok(filliman, "Filliman appears");
  assert.deepEqual([filliman.getLocation().getX(), filliman.getLocation().getY()], [3440, 3336]);
  await until(f, "I'm wearing an amulet of ghost speak!");
  await choose(f, "I'm wearing an amulet of ghost speak!");
  await until(f, "Don't be silly now! That in no way reflects the truth!");
  assert.equal(stage(f), 10, "not before the line");
  await continueLine(f);
  assert.equal(stage(f), 20);
});

test("Drezel's blessing: the chant overhead, the star and blessing, stage 40 and his next line three ticks on (ticks 742-750)", async (t) => {
  const f = actor(t, { stage: 35, at: BESIDE_DREZEL });
  const drezel = spawn(f, N.DREZEL, DREZEL_TILE);
  const chants = [];
  const say = drezel.forceChat.bind(drezel);
  drezel.forceChat = (text) => { chants.push({ tick: f.tick, text }); return say(text); };
  await talk(f, drezel);
  await until(f, "Very well my friend, prepare yourself for the blessings of Saradomin. Here we go!");
  await continueLine(f);
  const start = f.tick;
  assert.deepEqual(chants.map((c) => [c.tick - start, c.text]), [[0, "Ashustru, blessidium, adverturasi, fidum!"]]);
  assert.ok(f.animations.some((a) => a.tick === start && a.id === 645), "the player kneels");
  assert.equal(shown(f), null, "no chat during the blessing");
  ticks(f, 2);
  assert.equal(stage(f), 35);
  const line = waitFor(f, "There you go my friend, you're now blessed.");
  assert.equal(line - start, 3);
  assert.equal(stage(f), 40);
  assert.ok(f.said.every((s) => !s.text.startsWith("Ashustru")), "the chant is not a chat line");
});

test("Bloom spell: unblessed it refuses; blessed, the line, then two ticks on the fungi, the used spell and stage 45 (ticks 643, 866-868)", async (t) => {
  const unblessed = actor(t, { stage: 35, items: [I.DRUIDIC_SPELL], at: LOGS });
  await dispatch(unblessed, { type: "inventory_action", slot: slotOf(unblessed, I.DRUIDIC_SPELL), itemId: I.DRUIDIC_SPELL, widgetId: 3214, option: "Cast" });
  assert.deepEqual(unblessed.messages.map((m) => m.text).filter((m) => !m.includes("music") && !m.includes("Diary")), ["You need to be blessed before you can cast this spell."]);
  const f = actor(t, { stage: 40, items: [I.DRUIDIC_SPELL], at: LOGS });
  ticks(f, 2);
  await dispatch(f, { type: "inventory_action", slot: slotOf(f, I.DRUIDIC_SPELL), itemId: I.DRUIDIC_SPELL, widgetId: 3214, option: "Cast" });
  const cast = f.messages.find((m) => m.text === "You cast the spell in the swamp.")?.tick;
  assert.ok(cast, JSON.stringify(f.messages));
  assert.ok(f.player.getInventory().contains(I.DRUIDIC_SPELL), "not used yet");
  ticks(f, 2);
  assert.equal(f.player.getInventory().contains(I.A_USED_SPELL), true);
  assert.equal(stage(f), 45);
  assert.ok(f.animations.some((a) => a.tick === cast + 2 && a.id === 811), "human_casting two ticks on");
  const fungi = [[3406, 3391], [3407, 3389]].map(([x, y]) => core.MapObjects.getPrivateArea(f.player, O.FUNGI_ON_LOG, new core.Location(x, y, 0)));
  assert.ok(fungi.every(Boolean), "both logs beside the player bloom");
  await dispatch(f, { type: "object_option", id: O.FUNGI_ON_LOG, x: 3406, y: 3391, clickType: 2 });
  ticks(f, 3);
  assert.ok(f.messages.some((m) => m.text === "You pick a mushroom from the log."), JSON.stringify(f.messages.slice(-3)));
  assert.equal(stage(f), 50);
});

test("the fungus is shown once (55 after 'Wonderful'), then 'Hello again!'; the puzzle fails, the stones take the offerings and the ritual lands four ticks after the spell (ticks 933-1042)", async (t) => {
  const f = actor(t, { stage: 50, items: [I.MORT_MYRE_FUNGUS, I.DRUIDIC_SPELL] });
  await clickObject(f, O.GROTTO, GROTTO_ENTRANCE);
  await until(f, "Did you manage to get something from nature?");
  await until(f, "You show the fungus to Filliman.");
  await until(f, "Yes, I have a fungus here that I picked.");
  await until(f, "Wonderful, the mushroom represents 'something from nature'.");
  assert.equal(stage(f), 50);
  await continueLine(f);
  assert.equal(stage(f), 55);
  await choose(f, "What are the things that are needed?");
  assert.equal(shown(f)?.text, "What are the things that are needed again?");
  await until(f, "Ok, thanks.");
  await choose(f, "Ok, thanks.");
  await finishChat(f);
  const filliman = npcAt(f, [N.FILLIMAN_TARLOCK]).at(-1);
  await talk(f, filliman);
  assert.equal(shown(f)?.text, "Hello again! I don't suppose you've found out what the other components of the Nature spell are have you?");
  await until(f, "I think I've solved the puzzle!");
  await choose(f, "I think I've solved the puzzle!");
  await continueLine(f);
  const tried = waitForChat(f, "Oh really.. Have you placed all the items on the stones?");
  const failed = waitFor(f, "Hmm, something still doesn't seem right.");
  assert.equal(failed - tried, 4, "the try closes itself two ticks on, his answer two ticks after (958, 960, 962)");
  await finishChat(f);
  assert.equal(stage(f), 55);

  await dispatch(f, { type: "item_on_object", widgetId: 3214, objectId: O.STONE, itemId: I.MORT_MYRE_FUNGUS, slot: slotOf(f, I.MORT_MYRE_FUNGUS), x: 3439, y: 3336 });
  ticks(f, 3);
  assert.ok(f.messages.some((m) => m.text === "The stone seems to absorb the fungus."), JSON.stringify(f.messages.slice(-3)));
  assert.equal(shown(f)?.text, "Aha, yes, that seems right well done!");
  assert.equal(f.player.getInventory().contains(I.MORT_MYRE_FUNGUS), false);
  await finishChat(f);
  await dispatch(f, { type: "item_on_object", widgetId: 3214, objectId: O.STONE_3, itemId: I.DRUIDIC_SPELL, slot: slotOf(f, I.DRUIDIC_SPELL), x: 3441, y: 3336 });
  ticks(f, 3);
  assert.ok(f.messages.some((m) => m.text === "The stone seems to absorb the spell scroll."), JSON.stringify(f.messages.slice(-3)));
  await finishChat(f);

  await talk(f, npcAt(f, [N.FILLIMAN_TARLOCK]).at(-1));
  await until(f, "I think I've solved the puzzle!");
  await choose(f, "I think I've solved the puzzle!");
  await continueLine(f);
  const ritual = waitForChat(f, "Oh really.. Have you placed all the items on the stones?");
  const done = waitFor(f, "Aha, everything seems to be in place!");
  assert.equal(done - ritual, 5, "closes a tick on, stars two ticks later, the spell lands two after (1037-1042)");
  assert.equal(stage(f), 60);
  await finishChat(f);
  await clickObject(f, O.GROTTO, GROTTO_ENTRANCE);
  ticks(f, 2);
  assert.deepEqual(at(f), [3442, 9734, 0], "the grotto lands as captured (1057)");
  assert.equal(stage(f), 65);
  assert.ok(f.messages.some((m) => m.text === "You see a beautifully tended small grotto area."));
});

test("the transformation: Search calls Filliman to 3443,9738, the scene, 70 and the Nature Spirit three ticks after his line (ticks 1068-1075)", async (t) => {
  const f = actor(t, { stage: 65, at: IN_GROTTO, items: [I.SILVER_SICKLE] });
  await clickObject(f, O.GROTTO_2, [3441, 9740]);
  const filliman = npcAt(f, [N.FILLIMAN_TARLOCK]).at(-1);
  assert.ok(filliman);
  assert.deepEqual([filliman.getLocation().getX(), filliman.getLocation().getY()], [3443, 9738]);
  await until(f, "I must complete the transformation now.");
  await continueLine(f);
  const start = f.tick;
  assert.equal(shown(f), null, "the chat closes for the show");
  const spoke = waitForChat(f, "Hmmm, good, the transformation is complete.");
  assert.equal(spoke - start, 3);
  assert.equal(stage(f), 70);
  assert.equal(filliman.getNpcTransformationId(), N.NATURE_SPIRIT, "he changes in place");
  assert.equal(shown(f)?.npcId, N.NATURE_SPIRIT, "the green chathead");
  await until(f, "Ok, thanks.");
  await choose(f, "Ok, thanks.");
  await finishChat(f);

  await talk(f, filliman);
  await until(f, "My friend, I will bless it for you");
  await continueLine(f);
  const blessing = f.tick;
  ticks(f, 2);
  assert.equal(stage(f), 75);
  assert.ok(f.player.getInventory().contains(I.SILVER_SICKLE_B_));
  const box = waitFor(f, "Your sickle has been blessed!");
  assert.equal(box - blessing, 5, "the box five ticks on (1115-1120)");
  await until(f, "The nature spirit gives you an empty pouch.");
  assert.ok(f.player.getInventory().contains(I.DRUID_POUCH));
  await finishChat(f);
  assert.equal(stage(f), 75, "the pouch is not the filling (90 waits for it, 1248)");
});

test("the pouch: Fill before any harvest is the 'not told' box; three items in pack order give their charges (ticks 1130, 1248-1299)", async (t) => {
  const f = actor(t, { stage: 75, items: [I.DRUID_POUCH] });
  ticks(f, 2);
  await dispatch(f, { type: "inventory_action", slot: slotOf(f, I.DRUID_POUCH), itemId: I.DRUID_POUCH, widgetId: 3214, option: "Fill" });
  assert.equal(shown(f)?.text, "You've not been told how to use this item yet.");
  await finishChat(f);
  quest().setStage(f.player, 85);
  for (const id of [I.MORT_MYRE_FUNGUS, I.MORT_MYRE_STEM, I.MORT_MYRE_STEM, I.MORT_MYRE_FUNGUS]) f.player.getInventory().add(new core.Item(id, 1), false);
  await dispatch(f, { type: "inventory_action", slot: slotOf(f, I.DRUID_POUCH), itemId: I.DRUID_POUCH, widgetId: 3214, option: "Fill" });
  assert.ok(f.messages.some((m) => m.text === "You add five harvested items to your druid pouch."), JSON.stringify(f.messages.slice(-2)));
  assert.equal(f.player.getInventory().getAmount(I.DRUID_POUCH_2), 5);
  assert.equal(f.player.getInventory().getAmount(I.MORT_MYRE_FUNGUS), 1, "the fourth item stays");
  assert.equal(stage(f), 90);
  await dispatch(f, { type: "inventory_action", slot: slotOf(f, I.DRUID_POUCH_2), itemId: I.DRUID_POUCH_2, widgetId: 3214, option: "Fill" });
  assert.ok(f.messages.some((m) => m.text === "You need at least three blossomed items to add something to the druid pouch."));
});

test("ghasts: a miss, a pie rotting to its dish and rotten food, and a filled pouch revealing the Ghast two ticks before it appears (ticks 233, 285, 1257-1259)", async (t) => {
  const f = actor(t, { stage: 90, at: [3412, 3355, 0], items: [I.MEAT_PIE] });
  const ghast = spawn(f, N.GHAST, [3413, 3357, 0]);
  f.player.getLocalNpcs().push(ghast);
  const plugin = (text) => f.messages.filter((m) => m.text === text).length;
  const random = Math.random;
  t.after(() => { Math.random = random; });
  Math.random = () => 0.1; // the 7/10 miss
  for (let i = 0; i < 40 && !plugin("An attacking Ghast just misses you."); i++) tick(f);
  assert.equal(plugin("An attacking Ghast just misses you."), 1);
  Math.random = () => 0.9; // a hit: the pie rots
  for (let i = 0; i < 40 && !plugin("You feel something attacking your backpack, and smell a terrible stench."); i++) tick(f);
  assert.equal(f.player.getInventory().getAmount(I.PIE_DISH), 1);
  assert.equal(f.player.getInventory().getAmount(I.ROTTEN_FOOD), 1);
  assert.equal(f.player.getInventory().getAmount(I.MEAT_PIE), 0);
  ticks(f, 3);
  assert.equal(f.player.getHitpoints(), f.player.getSkillManager().getMaxLevel(core.Skill.HITPOINTS), "a rot costs no health");
  f.player.getInventory().add(new core.Item(I.DRUID_POUCH_2, 3), false);
  let revealed;
  for (let i = 0; i < 40 && !revealed; i++) { tick(f); revealed = f.messages.find((m) => m.text === "The druid pouch makes the Ghast visible."); }
  assert.ok(revealed);
  assert.equal(f.player.getInventory().getAmount(I.DRUID_POUCH_2), 2);
  assert.equal(npcAt(f, [N.GHAST_2]).length, 0, "not yet");
  ticks(f, 2);
  assert.equal(npcAt(f, [N.GHAST_2]).length, 1, "the level 30 ghast two ticks on");
});

test("completion: the altar scene, 110 nine ticks after his line, the finished grotto and his farewell; the altar boosts once (ticks 1459-1516)", async (t) => {
  const f = actor(t, { stage: 105, at: IN_GROTTO });
  await clickObject(f, O.GROTTO_2, [3441, 9740]);
  const spirit = npcAt(f, [N.NATURE_SPIRIT]).at(-1);
  assert.deepEqual([spirit.getLocation().getX(), spirit.getLocation().getY()], [3441, 9736]);
  await until(f, "Many thanks my friend, you have completed your quest!");
  await continueLine(f);
  const start = f.tick;
  ticks(f, 8);
  assert.equal(stage(f), 105);
  tick(f);
  assert.equal(stage(f), 110);
  assert.equal(f.player.getLocation().getZ(), 1, "moved up to the finished grotto");
  waitForChat(f, "Welcome to my Altar to Nature!");
  await finishChat(f);
  const skills = f.player.getSkillManager();
  await clickObject(f, O.ALTAR_OF_NATURE, [3441, 9740]);
  ticks(f, 2);
  assert.equal(skills.getCurrentLevel(core.Skill.PRAYER), skills.getMaxLevel(core.Skill.PRAYER) + 2);
  await clickObject(f, O.ALTAR_OF_NATURE, [3441, 9740]);
  ticks(f, 2);
  assert.ok(f.messages.some((m) => m.text === "You have already boosted your prayer points."), JSON.stringify(f.messages.slice(-3)));
  assert.ok(start > 0);
});

test("the washing bowl leaves the mirror on the bench for its finder (ticks 462-466)", async (t) => {
  const f = actor(t, { stage: 20, at: [3438, 3337, 0] });
  PM.emitPlayerLogin({ player: f.player, username: f.player.getUsername() });
  ticks(f, 2);
  await dispatch(f, { type: "ground_item_action", itemId: I.WASHING_BOWL, x: 3437, y: 3337, option: "Take" });
  ticks(f, 3);
  assert.ok(f.messages.some((m) => m.text === "You find a small mirror under the washing bowl."), JSON.stringify(f.messages));
  assert.equal(f.player.getInventory().contains(I.MIRROR), false, "the mirror is on the bench, not in the pack");
  await dispatch(f, { type: "ground_item_action", itemId: I.MIRROR, x: 3437, y: 3337, option: "Take" });
  ticks(f, 3);
  assert.ok(f.player.getInventory().contains(I.MIRROR));
});

test("reading Filliman's journal: its two boxes (ticks 532-535)", async (t) => {
  const f = actor(t, { stage: 25, items: [I.JOURNAL] });
  ticks(f, 2);
  await dispatch(f, { type: "inventory_action", slot: slotOf(f, I.JOURNAL), itemId: I.JOURNAL, widgetId: 3214, option: "Read" });
  assert.equal(shown(f)?.who, "ItemStatementDialogue");
  assert.equal(shown(f)?.text, "Most of the writing is pretty uninteresting, but something inside refers to a nature spirit. The requirements are:");
  await continueLine(f);
  assert.equal(shown(f)?.text, "'Something from nature', 'something with faith' and 'something of the spirit-to-become freely given'. It's all pretty vague.");
});
