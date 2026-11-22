// Run after `yarn build`: node --test --test-concurrency=1 tests/daddys-home.test.cjs
//
// Daddy's Home against the rsprox capture DaddysHome (rev 242.1) and the older recordings docs/daddys-home.md cites.
// Real Player, PlayerSession and ClientConnection, the real plugins (Construction, Mahogany Homes, the sawmill and its
// generated dialogue), the real map and real packets: npc_option / object_option / dialogue_continue / inventory_action
// go through the connection, and each tick runs in World.process order. Quest stages are seeded checkpoints. The
// lecture's own scene (copies, return, interruptions) is in quest-scene-return-state.test.cjs; this file plays it once
// end to end for its lines and statuses.
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
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
const JsonPersistence = require("../plugins/persistence/JsonPlayerPersistence.plugin");
const QuestRuntime = require("../plugins/quests/QuestRuntime");
const LECTURE = require("../plugins/quests/data/daddys-home-lecture.json");

const FURNITURE_VARBITS = [10563, 10564, 10565, 10566, 10567, 10568, 10569];
const LOC = { stool1: 40300, stool2: 40301, chair: 40302, table1: 40223, table2: 40224, bed: 40303, carpet: 40304, crate: 40214 };
// The capture's oploc tiles.
const AT = {
  bed: [3241, 3397], carpet: [3239, 3395], stool2: [3239, 3394], table2: [3240, 3394], chair: [3241, 3393],
  stool1: [3244, 3394], table1: [3245, 3394], crate: [3243, 3398],
};
const PIECE = { stool1: 0, stool2: 1, chair: 2, table1: 3, table2: 4, bed: 5, carpet: 6 };
const HOUSE = [3240, 3396, 0];
const YARLO = [3240, 3395, 0];
const SAWMILL = [3302, 3492, 0];
const MARLO_AT = [3240, 3472, 0];
const BESIDE_MARLO = [3240, 3471, 0];
const DISCUSSED = "construction:contract-discussed"; // Mahogany Homes: Amy has taken the player on

let core;
let I;
let codec;
let next = 2400;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  require("../plugins/skills/shootingstars/Noticeboard.ShootingStars").resetForTests();
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.ObjectDefinition.init();
  core.RegionManager.init();
  for (const at of [HOUSE, SAWMILL, MARLO_AT, [1800, 5700]]) core.RegionManager.loadMapFiles(at[0], at[1]);
  PM.emitServerStartup({});
  JsonPersistence.register({
    getSkillManager: () => require("../dist/game/content/skill/SkillManager").SkillManager,
    setPlayerPersistence: (backend) => { codec = backend; }, log() {},
  });
  // A browser-host environment (BROWSER_HOST*) skips the plugin's own backend; the codec is the same class.
  codec ??= new JsonPersistence.JsonPlayerPersistence();
});
after(() => PM.emitServerShutdown({}));

const quest = () => QuestRuntime.getRegisteredQuests().findLast((entry) => entry.key === "daddys_home");
const objId = (name) => core.CacheDefinitions.getObjId(name);

function actor(t, start = HOUSE) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel);
  const player = new Player(session);
  session.setPlayer(player);
  player.setUsername("daddy" + next++);
  player.setLongUsername(core.Misc.stringToLongBigInt(player.getUsername()));
  player.setAttribute("bot-skip-persistence", true);
  player.setLocation(new core.Location(...start));
  player.needsPlacement = false;
  assert.equal(core.World.getPlayers().add(player), true);
  const connection = new ClientConnection(channel);
  connection.player = player;
  const f = { t, player, connection, tick: 0, log: [] };
  const sender = player.getPacketSender();
  for (const name of ["sendVarbit", "sendClientScript", "sendSound", "sendInterface", "sendJingle", "sendString", "sendTypedMessage"]) {
    const original = sender[name].bind(sender);
    sender[name] = (...args) => { f.log.push({ tick: f.tick, name, args }); return original(...args); };
  }
  const message = player.sendMessage.bind(player);
  player.sendMessage = (text, ...rest) => { f.log.push({ tick: f.tick, name: "message", args: [text] }); return message(text, ...rest); };
  const perform = player.performAnimation.bind(player);
  player.performAnimation = (animation) => { f.log.push({ tick: f.tick, name: "anim", args: [animation.getId(), animation.delay ?? 0] }); return perform(animation); };
  t.after(() => {
    const area = player.getArea?.();
    if (area) area.leave(player, true);
    core.World.getPlayers().remove(player);
    PM.emitPlayerLogout({ player, username: player.getUsername() });
    core.TaskManager.cancelTasks(player.getIndex());
    core.TaskManager.cancelTasks(player);
  });
  return f;
}

function tick(f) {
  f.tick++;
  core.World.processCycle++;
  core.TaskManager.process();
  f.connection.processTurnPackets();
  AreaManager.process(f.player);
  core.TaskManager.processWalkTo(f.player.getIndex());
  f.player.getMovementQueue().process();
  core.World.updateLocalNpcs(f.player, [...core.World.getNpcs()]);
  f.player.getSession().flushClient(core.World.processCycle);
  f.player.resetUpdating();
}
const ticks = (f, count) => { for (let i = 0; i < count; i++) tick(f); };
const since = (f, from, name) => f.log.filter((entry) => entry.tick >= from && (!name || entry.name === name));

function spawn(f, id, at) {
  const npc = core.NPC.create(id, new core.Location(...at));
  assert.equal(core.World.getNpcs().add(npc), true);
  f.t.after(() => core.World.getNpcs().remove(npc));
  return npc;
}

/** A checkpoint: the stage and the furniture, its varbits sent as login sends them (the locs' ops follow them). */
function seed(f, stage, furniture) {
  quest().setStage(f.player, stage);
  if (!furniture) return;
  f.player.setAttribute("daddys-home:furniture", furniture.slice());
  furniture.forEach((value, index) => f.player.getPacketSender().sendVarbit(FURNITURE_VARBITS[index], value));
}

function ownHouse(f) {
  const grant = { player: f.player, granted: false };
  PM.emitCustomEvent("construction:grant-house", grant);
  assert.equal(grant.granted, true);
}

function stopTalking(f) {
  f.player.getDialogueManager().reset();
  f.player.getPacketSender().sendInterfaceRemoval();
}

async function talkTo(f, npc) {
  stopTalking(f);
  // The NPC has to be in the player's local list first, as a client only clicks what it was sent.
  ticks(f, 2);
  await f.connection.dispatch([{ type: "npc_option", index: npc.getIndex(), clickType: 1 }]);
  for (let i = 0; i < 30 && !f.player.getDialogueManager().isActive(); i++) tick(f);
}

/** The open chatbox: a menu's title and options, or the dialogue's class and text. */
function chat(f) {
  // Generated NPC dialogue (the sawmill's) asks through a multi-option prompt.
  const prompt = MultiChatboxPrompt.getPending(f.player);
  if (prompt) return { kind: "menu", title: prompt.title, options: prompt.options };
  const current = f.player.getDialogueManager().getCurrent();
  if (current instanceof core.OptionDialogue) return { kind: "menu", title: current.getTitle?.(), options: current.getOptions() };
  if (!current || !f.player.getDialogueManager().isActive()) return { kind: "none" };
  return { kind: current.constructor.name, text: current.getText?.() };
}

/** Continues through lines until a menu (or the end), returning each line shown. */
async function read(f, limit = 30) {
  const lines = [];
  for (let i = 0; i < limit; i++) {
    const now = chat(f);
    if (now.kind === "menu" || now.kind === "none" || now.kind === "ActionDialogue") return lines;
    lines.push(now);
    const group = f.player.getPacketSender().getChatboxGroupId();
    await f.connection.dispatch([{ type: "dialogue_continue", widgetId: (group << 16) | ([231, 217].includes(group) ? 5 : 0), childIndex: -1 }]);
    tick(f);
  }
  return lines;
}

async function pick(f, label) {
  const now = chat(f);
  assert.equal(now.kind, "menu", `a menu offering ${label}`);
  const index = now.options.indexOf(label);
  assert.ok(index >= 0, `menu ${JSON.stringify(now.options)} offers ${label}`);
  await f.connection.dispatch([{ type: "dialogue_continue", widgetId: core.OptionDialogue.OPTIONS_WIDGET_ID, childIndex: index + 1 }]);
  tick(f);
}

async function objectOption(f, name, clickType = 1) {
  const [x, y] = AT[name];
  ticks(f, 1);
  await f.connection.dispatch([{ type: "object_option", id: LOC[name], x, y, clickType }]);
}

async function pickBuild(f) {
  await f.connection.dispatch([{ type: "dialogue_continue", widgetId: (458 << 16) | 2, childIndex: 1 }]);
  tick(f);
}

function until(f, done, limit = 30) {
  for (let i = 0; i < limit && !done(); i++) tick(f);
  assert.ok(done(), "condition reached in time");
}

const texts = (lines) => lines.map((line) => line.text);
const furniture = (f, piece) => f.player.getPacketSender().getVarbit(FURNITURE_VARBITS[PIECE[piece]]);
const xp = (f) => f.player.getSkillManager().getExperience(core.Skill.CONSTRUCTION);

test("Marlo, joined: the contractor greeting, a favour menu that drops the question asked, and the start prompt", async (t) => {
  const f = actor(t, BESIDE_MARLO);
  f.player.setAttribute(DISCUSSED, true);
  const marlo = spawn(f, core.NpcIdentifiers.MARLO_2, MARLO_AT);
  await talkTo(f, marlo);
  assert.deepEqual(texts(await read(f)), [
    "Hello - it's lovely to see a Mahogany Homes contractor on their rounds! Now, can I help you with something? Or might you be able to do me a little favour?",
  ]);
  assert.deepEqual(chat(f).options, ["What's my current construction contract?", "What kind of favour do you want me to do?", "Maybe another time."]);
  await pick(f, "What kind of favour do you want me to do?");
  assert.equal((await read(f)).length, 2);
  assert.deepEqual(chat(f).options, ["Aren't you in a construction company yourself though?", "Why has he got such a bad house?", "Tell me more about the job.", "I'd rather not."]);
  await pick(f, "Aren't you in a construction company yourself though?");
  assert.equal((await read(f)).length, 3, "the player's question and Marlo's two lines");
  assert.deepEqual(chat(f).options, ["Why has he got such a bad house?", "Tell me more about the job.", "I'd rather not."], "capture tick 1426");
  await pick(f, "Why has he got such a bad house?");
  await read(f);
  assert.deepEqual(chat(f).options, ["Aren't you in a construction company yourself though?", "Tell me more about the job.", "I'd rather not."], "capture tick 1430");
  await pick(f, "Tell me more about the job.");
  await read(f);
  assert.equal(chat(f).title, "Start the Daddy's Home quest?");
  assert.deepEqual(chat(f).options, ["Yes.", "No."]);
  await pick(f, "No.");
  assert.deepEqual(texts(await read(f)), ["I'd rather not.", "Okay, suit yourself."]);
  assert.equal(quest().getStage(f.player), 0);
});

test("Marlo, not joined: the Varrock branch welcome; Yes starts the quest on the tick Marlo answers", async (t) => {
  const f = actor(t, BESIDE_MARLO);
  const marlo = spawn(f, core.NpcIdentifiers.MARLO, MARLO_AT);
  await talkTo(f, marlo);
  assert.deepEqual(texts(await read(f)), [
    "Welcome to the Varrock branch of Mahogany Homes, Gielinor's first construction company. Would you like to work for us? Or might you be able to do me a little favour?",
  ]);
  assert.deepEqual(chat(f).options, ["Tell me about working for Mahogany Homes.", "What kind of favour do you want me to do?", "Maybe another time."]);
  await pick(f, "What kind of favour do you want me to do?");
  await read(f);
  await pick(f, "Tell me more about the job.");
  await read(f);
  const from = f.tick;
  await pick(f, "Yes.");
  assert.equal(chat(f).text, "Tell me where he lives, and I'll do the job.");
  assert.equal(quest().getStage(f.player), 0, "not started on the player's line");
  const lines = await read(f);
  assert.equal(lines[1].text, "Fabulous! Dad lives in the south-east of Varrock, west of Aubury's Rune Shop. His name's Yarlo. Old Man Yarlo, they call him.");
  assert.equal(quest().getStage(f.player), 1);
  assert.ok(since(f, from, "message").some((m) => /You've started a new quest: .*Daddy's Home/.test(m.args[0])));
});

test("Yarlo sets status 2 and the furniture with his answer; removal is silent and the hotspot comes a tick later", async (t) => {
  const f = actor(t);
  seed(f, 1);
  const yarlo = spawn(f, core.NpcIdentifiers.OLD_MAN_YARLO, YARLO);
  await talkTo(f, yarlo);
  assert.equal(chat(f).text, "What brings you here, young man?");
  const lines = await read(f);
  assert.deepEqual(texts(lines).slice(0, 2), ["What brings you here, young man?", "Marlo sent me to fix your furniture."]);
  assert.equal(quest().getStage(f.player), 2);
  for (const varbit of FURNITURE_VARBITS) assert.equal(f.player.getPacketSender().getVarbit(varbit), 1);

  const from = f.tick;
  await objectOption(f, "bed");
  until(f, () => since(f, from, "anim").some((a) => a.args[0] === 3685));
  const anim = since(f, from, "anim").find((a) => a.args[0] === 3685);
  assert.equal(anim.args[1], 10, "throw-away sequence delay 10");
  const sound = since(f, from, "sendSound").find((s) => [2097, 2098].includes(s.args[0]));
  assert.ok(sound && sound.tick === anim.tick && sound.args[2] === 20, "a demolish sound with delay 20 on the animation's tick");
  assert.equal(furniture(f, "bed"), 1, "still broken on the animation's tick");
  tick(f);
  assert.equal(furniture(f, "bed"), 2, "the hotspot the tick after");
  assert.equal(since(f, from, "message").length, 0, "no chat message");
  assert.equal(quest().getStage(f.player), 2);
  const built = f.tick;
  await objectOption(f, "bed");
  until(f, () => since(f, built, "message").length > 0);
  assert.equal(since(f, built, "message")[0].args[0], "You should get Yarlo to tell you about the furniture he wants, before you try building any.");
});

test("Yarlo after the removal: status 3 with the player's line, the owner's line names the town; Skip's statuses", async (t) => {
  const f = actor(t);
  ownHouse(f);
  seed(f, 2, [2, 2, 2, 2, 2, 2, 2]);
  const yarlo = spawn(f, core.NpcIdentifiers.OLD_MAN_YARLO, YARLO);
  await talkTo(f, yarlo);
  assert.equal(chat(f).text, "Ah, young man, how's the redecoration coming on?");
  assert.equal(quest().getStage(f.player), 2);
  assert.deepEqual(texts(await read(f)), [
    "Ah, young man, how's the redecoration coming on?",
    "I've finished removing all the old furniture.",
    "Jolly good, young man. Now, we'll need to have a talk about what you'll build for me to replace it.",
    "You see, I used to be a carpenter myself, before the arthritis got me. Such wonderful things I could build. Let me tell you about the things Construction can do for you...",
    "Is this necessary? I've got a house of my own, in Rimmington, and I've been learning about Construction for a while.",
  ]);
  assert.equal(quest().getStage(f.player), 3);
  assert.deepEqual(chat(f).options, ["Listen to Yarlo.", "Skip Yarlo's lecture. He'll offer it later if you like."]);
  await pick(f, "Skip Yarlo's lecture. He'll offer it later if you like.");
  assert.match(chat(f).text, /^You young people are always rushing around/);
  await read(f, 1);
  assert.match(chat(f).text, /^Now, I was just getting round to telling you/);
  assert.equal(quest().getStage(f.player), 4, "status 4 with its line (rev 241, local 1001562 tick 4444)");
  const briefing = await read(f);
  assert.deepEqual(briefing.map((line) => line.kind), [
    "NpcDialogue", "DoubleItemStatementDialogue", "ItemStatementDialogue", "NpcDialogue", "ItemStatementDialogue", "DoubleItemStatementDialogue", "NpcDialogue",
  ]);
  assert.equal(quest().getStage(f.player), 5);
});

test("the lecture: three copies, every line held then continued, the start tile, the briefing from status 3", async (t) => {
  const f = actor(t);
  seed(f, 3, [2, 2, 2, 2, 2, 2, 2]);
  const yarlo = spawn(f, core.NpcIdentifiers.OLD_MAN_YARLO, YARLO);
  await talkTo(f, yarlo);
  await read(f);
  const start = f.player.getLocation().clone();
  const from = f.tick;
  await pick(f, "Listen to Yarlo.");
  const lines = LECTURE.steps.filter((step) => step.text !== null).map((step) => step.text);
  const seen = [];
  const areas = new Set();
  for (let i = 0; i < 800 && seen.length < lines.length; i++) {
    const area = f.player.getArea();
    if (area) areas.add(area);
    const current = f.player.getDialogueManager().getCurrent();
    if (current instanceof core.StatementDialogue && current.getText() === lines[seen.length]) {
      seen.push(current.getText());
      assert.equal(quest().getStage(f.player), 3, "the lecture leaves the status alone");
      await f.connection.dispatch([{ type: "dialogue_continue", widgetId: (229 << 16) | 4, childIndex: -1 }]);
    }
    tick(f);
  }
  assert.deepEqual(seen, lines);
  assert.equal(areas.size, 3, "one copy per rebuild");
  assert.ok(since(f, from, "sendJingle").some((j) => j.args[0] === 20), "the Rimmington jingle");
  until(f, () => !f.player.getMovementQueue().isMovementBlocked(), 20);
  for (const area of areas) assert.equal(area.isDestroyed(), true);
  assert.ok(f.player.getLocation().equals(start), "back on the tile the player stood on");
  until(f, () => chat(f).kind === "NpcDialogue", 5);
  assert.match(chat(f).text, /^Now, I was just getting round to telling you/);
  assert.equal(quest().getStage(f.player), 4);
  assert.equal(f.player.getPacketSender().getVarbit(542), 0);
});

test("Yarlo's help menu: the player's opening line, each answer back to the menu without it, the map tip box", async (t) => {
  const f = actor(t);
  seed(f, 5, [2, 2, 2, 2, 2, 2, 2]);
  f.player.getInventory().add(new core.Item(I.HAMMER, 1), false);
  f.player.getInventory().add(new core.Item(I.SAW, 1), false);
  const yarlo = spawn(f, core.NpcIdentifiers.OLD_MAN_YARLO, YARLO);
  await talkTo(f, yarlo);
  assert.deepEqual(texts(await read(f)), ["I've been working on your furniture.", "Do you need some help with the building work, young man?"]);
  const all = ["How do I build furniture?", "Where do I get planks, nails and cloth?", "I need some tools.", "Tell me about the waxwood for the bed.", "I'll get on with it."];
  assert.deepEqual(chat(f).options, all);
  const from = f.tick;
  await pick(f, "Where do I get planks, nails and cloth?");
  const lines = await read(f);
  assert.equal(lines.at(-1).kind, "GraphicStatementDialogue");
  assert.equal(lines.at(-1).text, "Look on your World Map to find the sawmill.");
  assert.ok(since(f, from, "sendClientScript").some((s) => s.args[0] === 3374 && s.args[1] === 1698 && s.args[2] === 32 && s.args[3] === 32),
    "graphicbox_set_graphic 1698 at 32 x 32 (capture tick 1791)");
  assert.deepEqual(chat(f).options, all.filter((option) => option !== "Where do I get planks, nails and cloth?"));
  await pick(f, "I need some tools.");
  assert.deepEqual(texts(await read(f)), ["I need some tools.", "You've got a hammer and a saw. I wouldn't be able to offer you anything else."]);
  assert.deepEqual(chat(f).options, all.filter((option) => option !== "I need some tools."));
});

test("Yarlo offers a missing hammer; Yes please gives it with its box and returns to the menu", async (t) => {
  const f = actor(t);
  seed(f, 5, [2, 2, 2, 2, 2, 2, 2]);
  f.player.getInventory().add(new core.Item(I.SAW, 1), false);
  const yarlo = spawn(f, core.NpcIdentifiers.OLD_MAN_YARLO, YARLO);
  await talkTo(f, yarlo);
  await read(f);
  await pick(f, "I need some tools.");
  assert.deepEqual(texts(await read(f)), ["I need some tools.", "Would you like a hammer? I can spare one."]);
  await pick(f, "Yes please.");
  assert.deepEqual(texts(await read(f)), ["Yes please.", "Yarlo gives you a hammer."]);
  assert.equal(f.player.getInventory().getAmount(I.HAMMER), 1);
  assert.equal(chat(f).kind, "menu");
});

test("building: the one-entry menu, the materials box, a stool's nail ticks, the carpet's single tick", async (t) => {
  const f = actor(t, [3240, 3395, 0]);
  seed(f, 5, [2, 2, 2, 2, 2, 2, 2]);
  const inv = f.player.getInventory();
  inv.add(new core.Item(I.HAMMER, 1), false);
  inv.add(new core.Item(I.SAW, 1), false);
  // Without materials the entry can't be built, and the pick shows what is missing in red.
  let from = f.tick;
  await objectOption(f, "bed");
  until(f, () => f.player.getInterfaceId() === 458);
  const entry = since(f, from, "sendClientScript").find((s) => s.args[0] === 7988);
  assert.deepEqual(entry.args, [7988, 1, objId("cert_beta_elder_maul"), 1, "Waxwood bed|Waxwood plank: 3<br>Bolt of cloth: 2<br><br>", 0]);
  assert.ok(since(f, from, "sendClientScript").some((s) => s.args[0] === 1406 && s.args[1] === 1 && s.args[2] === 0));
  await pickBuild(f);
  assert.equal(chat(f).text, "You don't have the right materials:<br><col=ef1020>3 x Waxwood plank</col>, <col=ef1020>2 x Bolt of cloth</col>");
  assert.ok(since(f, from, "sendClientScript").some((s) => s.args[0] === 2158), "chatdefault_restoreinput");
  stopTalking(f);

  // A stool: animation and sound on the pick, a nail a tick, the plank with the last, the piece and 29 XP after.
  inv.add(new core.Item(I.PLANK, 1), false);
  inv.add(new core.Item(I.DRAGON_NAILS, 10), false);
  t.mock.method(Math, "random", () => 0.99); // no nail bends
  const before = xp(f);
  await objectOption(f, "stool2");
  until(f, () => f.player.getInterfaceId() === 458);
  from = f.tick + 1;
  await pickBuild(f);
  assert.deepEqual(since(f, from, "anim").map((a) => a.args[0]), [3676]);
  assert.ok(since(f, from, "sendSound").some((s) => s.args[0] === 938));
  tick(f);
  const nails = () => since(f, from, "sendTypedMessage").filter((m) => m.args[1] === "You use a nail.");
  assert.equal(nails().length, 1);
  assert.equal(inv.getAmount(I.PLANK), 1);
  tick(f);
  assert.equal(nails().length, 2);
  assert.equal(inv.getAmount(I.PLANK), 0, "the plank goes with the last nail");
  assert.equal(furniture(f, "stool2"), 2, "not built on the last nail's tick");
  assert.deepEqual(since(f, from, "anim").map((a) => a.args[0]), [3676, 3676], "no animation after the last nail");
  tick(f);
  assert.equal(furniture(f, "stool2"), 3);
  assert.equal(xp(f) - before, 29);

  // The carpet: no nails, the cloth on the pick, built with 45 XP the tick after, animation 3676 too.
  inv.add(new core.Item(I.BOLT_OF_CLOTH, 3), false);
  await objectOption(f, "carpet", 5);
  until(f, () => f.player.getInterfaceId() === 458);
  from = f.tick + 1;
  const carpetXp = xp(f);
  await pickBuild(f);
  assert.deepEqual(since(f, from, "anim").map((a) => a.args[0]), [3676]);
  assert.equal(inv.getAmount(I.BOLT_OF_CLOTH), 0);
  assert.equal(furniture(f, "carpet"), 2);
  tick(f);
  assert.equal(furniture(f, "carpet"), 3);
  assert.equal(xp(f) - carpetXp, 45);
});

test("building without the tools shows the saw-and-hammer box, not the menu", async (t) => {
  const f = actor(t, [3240, 3395, 0]);
  seed(f, 5, [2, 2, 2, 2, 2, 2, 2]);
  await objectOption(f, "stool2");
  until(f, () => chat(f).kind === "DoubleItemStatementDialogue");
  assert.equal(chat(f).text, "You need a saw and hammer in order to make furniture.");
  assert.notEqual(f.player.getInterfaceId(), 458);
});

test("the crate: too little room; three logs and their box; nothing more once the planks are made", async (t) => {
  const f = actor(t, [3243, 3397, 0]);
  seed(f, 5, [2, 2, 2, 2, 2, 2, 2]);
  const inv = f.player.getInventory();
  while (inv.getFreeSlots() > 2) inv.add(new core.Item(I.LOGS, 1), false);
  await objectOption(f, "crate");
  until(f, () => chat(f).kind === "DoubleItemStatementDialogue");
  assert.match(chat(f).text, /He said you'd need three planks, so you'll need some more inventory space\.$/);
  stopTalking(f);
  inv.resetItems();
  await objectOption(f, "crate");
  until(f, () => chat(f).kind === "ItemStatementDialogue");
  assert.equal(chat(f).text, "The crate contains that water-repellent waxwood Old Man Yarlo described. You take some.");
  assert.equal(inv.getAmount(objId("daddyshome_waxwood_logs")), 3);
  stopTalking(f);
  let from = f.tick;
  await objectOption(f, "crate");
  until(f, () => since(f, from, "message").length > 0);
  assert.equal(since(f, from, "message")[0].args[0], "You won't need any more waxwood for Old Man Yarlo's furniture.", "three logs carried");
  // Status 6 with the planks destroyed and the bed not built: the crate gives logs again (the review found the softlock).
  inv.resetItems();
  seed(f, 6, [3, 3, 3, 3, 3, 2, 3]);
  await objectOption(f, "crate");
  until(f, () => chat(f).kind === "ItemStatementDialogue");
  assert.equal(inv.getAmount(objId("daddyshome_waxwood_logs")), 3);
  stopTalking(f);
  // Once the bed is built: recording 3218's line.
  seed(f, 10, [3, 3, 3, 3, 3, 3, 3]);
  inv.resetItems();
  from = f.tick;
  await objectOption(f, "crate");
  until(f, () => since(f, from, "message").length > 0);
  assert.equal(since(f, from, "message")[0].args[0], "You won't need any more waxwood for Old Man Yarlo's furniture.");
});

test("the sawmill offers waxwood again at status 6 when the planks were lost before the bed", async (t) => {
  const f = actor(t, [SAWMILL[0], SAWMILL[1] - 1, 0]);
  seed(f, 6, [3, 3, 3, 3, 3, 2, 3]);
  f.player.getInventory().add(new core.Item(objId("daddyshome_waxwood_logs"), 3), false);
  const operator = spawn(f, core.NpcIdentifiers.SAWMILL_OPERATOR, SAWMILL);
  await talkTo(f, operator);
  await read(f);
  await pick(f, "I need some waxwood planks for Old Man Yarlo.");
  await read(f);
  assert.equal(f.player.getInventory().getAmount(objId("daddyshome_waxwood_plank")), 3);
  assert.equal(quest().getStage(f.player), 6);
});

test("the Varrock sawmill: the waxwood line third in its own menu at status 5, planks and status 6, gone after", async (t) => {
  const f = actor(t, [SAWMILL[0], SAWMILL[1] - 1, 0]);
  seed(f, 5, [2, 2, 2, 2, 2, 2, 2]);
  const logs = objId("daddyshome_waxwood_logs");
  const planks = objId("daddyshome_waxwood_plank");
  f.player.getInventory().add(new core.Item(logs, 3), false);
  const operator = spawn(f, core.NpcIdentifiers.SAWMILL_OPERATOR, SAWMILL);
  await talkTo(f, operator);
  const greeting = await read(f);
  assert.match(greeting[0].text, /^Hello there\. Do you want me to make some planks for you\?/);
  assert.deepEqual(chat(f).options, ["Yes, please make me some planks.", "Can I buy some housing supplies?", "I need some waxwood planks for Old Man Yarlo.", "I'm good, thanks."]);
  await pick(f, "I need some waxwood planks for Old Man Yarlo.");
  assert.deepEqual(texts(await read(f)), ["I need some waxwood planks for Old Man Yarlo.", "That old geezer? Oh, alright. I won't charge for this, since it's for him."]);
  assert.equal(f.player.getInventory().getAmount(planks), 3);
  assert.equal(f.player.getInventory().getAmount(logs), 0);
  assert.equal(quest().getStage(f.player), 6);
  await talkTo(f, operator);
  await read(f);
  assert.deepEqual(chat(f).options, ["Yes, please make me some planks.", "Can I buy some housing supplies?", "I'm good, thanks."]);
});

test("everything built: Yarlo's status 10; Marlo's 11, his reminder, the reward and scroll, the crate's status 14", async (t) => {
  const f = actor(t);
  ownHouse(f);
  seed(f, 6, [3, 3, 3, 3, 3, 3, 3]);
  const yarlo = spawn(f, core.NpcIdentifiers.OLD_MAN_YARLO, YARLO);
  await talkTo(f, yarlo);
  assert.equal(chat(f).text, "I've been working on your furniture.");
  assert.equal(quest().getStage(f.player), 6);
  const lines = await read(f);
  assert.equal(lines[1].text, "That's everything! Thank you so much, young man. Trot off back to my boy Marlo, now. He'll have something for you.");
  assert.equal(quest().getStage(f.player), 10);

  f.player.moveTo(new core.Location(...BESIDE_MARLO));
  ticks(f, 2);
  f.player.setAttribute(DISCUSSED, true);
  const marlo = spawn(f, core.NpcIdentifiers.MARLO_2, MARLO_AT);
  await talkTo(f, marlo);
  assert.equal(chat(f).text, "I've finished building the new furniture for your dad.");
  await read(f);
  assert.equal(quest().getStage(f.player), 11);
  assert.deepEqual(chat(f).options, ["Yeah, what have you got for me?", "What's my current construction contract?"]);
  await talkTo(f, marlo);
  assert.equal(chat(f).text, "I haven't forgotten that I promised to pay you for your help. Is this a good time for that?");
  await read(f);
  const coins = f.player.getInventory().getAmount(I.COINS);
  const before = xp(f);
  const from = f.tick;
  await pick(f, "Yeah, what have you got for me?");
  const reward = await read(f);
  assert.equal(reward.at(-1).text, "I've included some handy spell tablets that'll take you to your house, to cut down on the walking a bit, as well as one for visiting my boss in Falador. Hope you find it all useful.");
  until(f, () => quest().getStage(f.player) === 13, 3);
  ticks(f, 2); // the scroll opens once the chatbox has closed
  assert.equal(f.player.getInventory().getAmount(I.COINS) - coins, 1000);
  assert.equal(xp(f) - before, 400);
  const crate = objId("daddyshome_reward");
  assert.equal(f.player.getInventory().getAmount(crate), 1);
  const strings = since(f, from, "sendString").map((s) => s.args[0]);
  for (const line of ["1 Quest Point", "400 Construction XP", "1,000 Coins", "A crate of supplies"]) {
    assert.ok(strings.includes(line), `the scroll says ${line} (capture tick 2158)`);
  }

  stopTalking(f);
  const opened = f.tick;
  await f.connection.dispatch([{ type: "inventory_action", widgetId: 149 << 16, slot: f.player.getInventory().getSlotForItemId(crate), itemId: crate, option: "Open" }]);
  until(f, () => quest().getStage(f.player) === 14, 3);
  assert.equal(chat(f).text, "You find a variety of useful Construction supplies.");
  assert.ok(since(f, opened, "sendSound").some((s) => s.args[0] === 2655), "found_gem");
  assert.equal(f.player.getInventory().getAmount(I.MITHRIL_NAILS), 50);
  assert.equal(f.player.getInventory().getAmount(I.TELEPORT_TO_HOUSE), 5);
});

test("after the quest: Marlo's menus by membership, Yarlo's lecture offer first", async (t) => {
  const f = actor(t, BESIDE_MARLO);
  seed(f, 14, [3, 3, 3, 3, 3, 3, 3]);
  const marlo = spawn(f, core.NpcIdentifiers.MARLO, MARLO_AT);
  await talkTo(f, marlo);
  assert.deepEqual(texts(await read(f)), ["Thanks again for helping my dad. He's so much more comfortable in his home now. You're a really good friend, you know!"]);
  assert.deepEqual(chat(f).options, ["So can I do some more building for you?", "Great. I'll leave you to it."]);
  f.player.setAttribute(DISCUSSED, true);
  await talkTo(f, marlo);
  await read(f);
  assert.deepEqual(chat(f).options, ["What's my current construction contract?", "Great. I'll leave you to it."]);

  stopTalking(f);
  f.player.moveTo(new core.Location(...HOUSE));
  ticks(f, 2);
  const yarlo = spawn(f, core.NpcIdentifiers.OLD_MAN_YARLO, YARLO);
  await talkTo(f, yarlo);
  await read(f);
  assert.deepEqual(chat(f).options, ["Tell me about more things I can do with Construction.", "That's good to hear. Goodbye now."]);
});

test("login: a pre-242 opened crate becomes status 14; a pre-242 completion gets its Quest Point once", async (t) => {
  const f = actor(t);
  seed(f, 13, [3, 3, 3, 3, 3, 3, 3]);
  f.player.setAttribute("daddys-home:crate-opened", 1);
  const points = Number(f.player.getAttribute(QuestRuntime.QUEST_POINTS_ATTRIBUTE)) || 0;
  PM.emitPlayerLogin({ player: f.player, username: f.player.getUsername() });
  assert.equal(quest().getStage(f.player), 14);
  assert.equal(Number(f.player.getAttribute(QuestRuntime.QUEST_POINTS_ATTRIBUTE)), points + 1);
  PM.emitPlayerLogin({ player: f.player, username: f.player.getUsername() });
  assert.equal(Number(f.player.getAttribute(QuestRuntime.QUEST_POINTS_ATTRIBUTE)), points + 1);
  for (const varbit of FURNITURE_VARBITS) assert.equal(f.player.getPacketSender().getVarbit(varbit), 3);
});

/** The real PlayerSave and JSON codec round trip, then a login, as a server restart loads the save. */
function reload(t, f) {
  const raw = JSON.parse(JSON.stringify(PlayerSave.fromPlayer(f.player), codec.replacer.bind(codec)), codec.reviver.bind(codec));
  const g = actor(t);
  codec.hydratePlayerSave(raw).applyToPlayer(g.player);
  g.player.setRegistered(true);
  g.player.needsPlacement = false;
  PM.emitPlayerLogin({ player: g.player, username: g.player.getUsername(), isNewAccount: false });
  return g;
}

test("a save taken in the lecture's copy reloads at the start tile, status 3, ready to watch again", async (t) => {
  const f = actor(t);
  seed(f, 3, [2, 2, 2, 2, 2, 2, 2]);
  const yarlo = spawn(f, core.NpcIdentifiers.OLD_MAN_YARLO, YARLO);
  await talkTo(f, yarlo);
  await read(f);
  const start = f.player.getLocation().clone();
  await pick(f, "Listen to Yarlo.");
  until(f, () => f.player.getArea() instanceof core.TemplatedInstanceArea, 5);
  ticks(f, 20);
  assert.ok(f.player.getLocation().getX() >= 8192, "saved inside the copy");
  const g = reload(t, f);
  ticks(g, 2);
  assert.ok(g.player.getLocation().equals(start), "the login puts the player back at the scene's exit");
  assert.equal(quest().getStage(g.player), 3);
  assert.deepEqual(g.player.getAttribute("daddys-home:furniture"), [2, 2, 2, 2, 2, 2, 2]);
  assert.equal(g.player.getAttribute("daddys-home:lecture-exit"), null);
  assert.equal(g.player.getMovementQueue().isMovementBlocked(), false);
});

test("status 14 and the crate's contents survive a save and reload; a later crate opens empty", async (t) => {
  const f = actor(t);
  seed(f, 13, [3, 3, 3, 3, 3, 3, 3]);
  const crate = objId("daddyshome_reward");
  f.player.getInventory().add(new core.Item(crate, 1), false);
  ticks(f, 1);
  await f.connection.dispatch([{ type: "inventory_action", widgetId: 149 << 16, slot: f.player.getInventory().getSlotForItemId(crate), itemId: crate, option: "Open" }]);
  until(f, () => quest().getStage(f.player) === 14, 3);
  const g = reload(t, f);
  assert.equal(quest().getStage(g.player), 14);
  assert.equal(g.player.getInventory().getAmount(I.MITHRIL_NAILS), 50);
  g.player.getInventory().add(new core.Item(crate, 1), false);
  ticks(g, 1);
  await g.connection.dispatch([{ type: "inventory_action", widgetId: 149 << 16, slot: g.player.getInventory().getSlotForItemId(crate), itemId: crate, option: "Open" }]);
  tick(g);
  assert.equal(g.player.getInventory().getAmount(crate), 0);
  assert.equal(g.player.getInventory().getAmount(I.MITHRIL_NAILS), 50, "nothing paid twice");
});

test("a click on something else between the last nail and the build still builds the piece the planks went into", async (t) => {
  const f = actor(t, [3240, 3395, 0]);
  seed(f, 5, [2, 2, 2, 2, 2, 2, 2]);
  const inv = f.player.getInventory();
  for (const [id, amount] of [[I.HAMMER, 1], [I.SAW, 1], [I.PLANK, 3], [I.DRAGON_NAILS, 10]]) inv.add(new core.Item(id, amount), false);
  t.mock.method(Math, "random", () => 0.99); // no nail bends
  const before = xp(f);
  await objectOption(f, "table2");
  until(f, () => f.player.getInterfaceId() === 458);
  await pickBuild(f); // the pick's tick: the animation, no nail yet
  ticks(f, 3); // three nails
  assert.equal(inv.getAmount(I.PLANK), 3);
  // The in-game run found this: another click handled on the last nail's tick (after the nail took the planks)
  // stopped the build, and the planks were lost with no table.
  await f.connection.dispatch([{ type: "object_option", id: LOC.chair, x: AT.chair[0], y: AT.chair[1], clickType: 1 }]);
  tick(f);
  assert.equal(inv.getAmount(I.PLANK), 0, "the last nail took the planks");
  tick(f);
  assert.equal(furniture(f, "table2"), 3);
  assert.equal(xp(f) - before, 86);
});

test("a save taken between the last nail and the build holds the piece built with its materials gone", async (t) => {
  const f = actor(t, [3240, 3395, 0]);
  seed(f, 5, [2, 2, 2, 2, 2, 2, 2]);
  const inv = f.player.getInventory();
  for (const [id, amount] of [[I.HAMMER, 1], [I.SAW, 1], [I.PLANK, 3], [I.DRAGON_NAILS, 10]]) inv.add(new core.Item(id, amount), false);
  t.mock.method(Math, "random", () => 0.99); // no nail bends
  await objectOption(f, "table2");
  until(f, () => f.player.getInterfaceId() === 458);
  await pickBuild(f);
  ticks(f, 4); // four nails: the planks go with the last
  assert.equal(inv.getAmount(I.PLANK), 0);
  assert.equal(furniture(f, "table2"), 2, "the client still sees the hotspot on this tick, as captured");
  const saved = xp(f);
  const g = reload(t, f); // a save on this tick, then a restart
  assert.equal(g.player.getAttribute("daddys-home:furniture")[PIECE.table2], 3, "the piece the planks went into is saved built");
  assert.equal(xp(g) - saved, 86, "and its XP, owed in the save, is paid at login (review: UnhealthyKraken)");
  assert.equal(g.player.getAttribute("daddys-home:pending-xp"), 0);
  PM.emitPlayerLogin({ player: g.player, username: g.player.getUsername(), isNewAccount: false });
  assert.equal(xp(g) - saved, 86, "never twice");
  // The session that saved carries on: its build lands a tick later with the XP once.
  tick(f);
  assert.equal(furniture(f, "table2"), 3);
  assert.equal(xp(f) - saved, 86);
  assert.equal(f.player.getAttribute("daddys-home:pending-xp"), 0);
});
