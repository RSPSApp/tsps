// Run after `yarn build`: node --test tests/spirit-of-scorpius.test.cjs
// The Spirit of Scorpius after Observatory Quest (plugins/quests/observatory/Scorpius.ObservatoryQuest.js): the unholy
// mould and the blessing. Real engine: every plugin loaded, a real Player, and real dialogue packets. No client ran.
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
const QuestRuntime = require("../plugins/quests/QuestRuntime");
const Scorpius = require("../plugins/quests/observatory/Scorpius.ObservatoryQuest");
const DIALOGUES = require("../data/definitions/npc-dialogues.json");

const T = Scorpius._test;
/** Where the player stands: in front of the Spirit (spawned at 2465,3227). */
const STAND = [2465, 3226, 0];

let core;
let quest;
let next = 9950;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  PM.emitServerStartup({});
  core.RegionManager.loadMapFiles(STAND[0], STAND[1]);
  quest = QuestRuntime.questNamed("Observatory Quest");
});
after(() => PM.emitServerShutdown({}));

/** `worn`: equipment by slot name; by default an amulet of ghostspeak, so Talk-to sends no message of its own. */
function actor(t, { complete = true, items = [], worn = { AMULET_SLOT: 552 } } = {}) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("scorpqa" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(...STAND));
  p.needsPlacement = false;
  if (complete) quest.complete(p, { scroll: false, announce: false });
  for (let slot = 0; slot < 28; slot++) p.getInventory().setItem(slot, new core.Item(-1, 0));
  items.forEach((id, slot) => p.getInventory().setItem(slot, new core.Item(id, 1)));
  for (const [slot, id] of Object.entries(worn)) p.getEquipment().setItem(core.Equipment[slot], new core.Item(id, 1));
  const connection = new ClientConnection(channel);
  connection.player = p;
  const messages = [];
  const sender = p.getPacketSender();
  t.mock.method(sender, "sendMessage", (message) => {
    messages.push(message);
    return sender;
  });
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
    core.TaskManager.cancelTasks(p);
  });
  return { p, connection, messages };
}

const amount = (f, id) => f.p.getInventory().getAmount(id);
const seq = (name) => core.CacheDefinitions.getSeqId(name);
const current = (f) => f.p.getDialogueManager().getCurrent();
const talking = (f) => Boolean(f.p.getDialogueManager().getCurrent());
const shownText = (f) => {
  const entry = f.p.getDialogueManager().getCurrent();
  return String(entry?.getText?.() ?? entry?.text ?? "");
};

async function tick(f) {
  f.connection.processTurnPackets();
  for (let i = 0; i < 4; i++) core.TaskManager.process();
}

function talk(f) {
  const npc = core.NPC.create(core.NpcIdentifiers.SPIRIT_OF_SCORPIUS, new core.Location(2465, 3227, 0));
  const definition = npc.getCurrentDefinition(f.p);
  return PM.emitNpcInteraction({
    player: f.p, npc, npcId: npc.getContentId(f.p), definition,
    clickType: definition.getActions().indexOf("Talk-to") + 1, handled: false,
  });
}

function continuePacket(f, choice) {
  const group = f.p.getPacketSender().getChatboxGroupId();
  return {
    type: "dialogue_continue",
    widgetId: choice == null ? (group << 16) | ([231, 217].includes(group) ? 5 : 0) : core.MultiChatboxPrompt.OPTIONS_WIDGET_ID,
    childIndex: choice ?? -1,
  };
}

async function resume(f, choice) {
  await f.connection.dispatch([continuePacket(f, choice)]);
  await tick(f);
}

async function choose(f, text) {
  for (let i = 0; i < 10; i++) {
    const options = core.MultiChatboxPrompt.getPending(f.p)?.options;
    if (options) {
      const index = options.indexOf(text);
      assert.ok(index >= 0, `"${text}" in ${options}`);
      return resume(f, index + 1);
    }
    assert.ok(talking(f), `the conversation is still open before "${text}"`);
    await resume(f);
  }
  return assert.fail(`no menu with "${text}"`);
}

async function finish(f) {
  for (let i = 0; i < 12 && talking(f); i++) await resume(f);
}

/** Continues to the end, collecting each shown entry as "Kind: text" (kind: the dialogue entry's class). */
async function trace(f) {
  const shown = [];
  for (let i = 0; i < 12 && talking(f); i++) {
    const text = shownText(f);
    if (text) shown.push(`${current(f).constructor.name}: ${text}`);
    await resume(f);
  }
  return shown;
}

test("before the quest he only says his two lines, and gives nothing", async (t) => {
  const { UNHOLY_MOULD, UNPOWERED_SYMBOL, UNHOLY_SYMBOL } = core.ItemIdentifiers;
  const f = actor(t, { complete: false, items: [UNPOWERED_SYMBOL] });
  talk(f);
  await tick(f);
  for (const line of ["Who treads upon my grave?", "How dare you disturb me!"]) {
    assert.equal(shownText(f), line);
    assert.equal(current(f).expression, seq("chatang1"), "Lost City's angry head");
    assert.equal(core.MultiChatboxPrompt.getPending(f.p), null, "no menu");
    await resume(f);
  }
  assert.equal(talking(f), false);
  await finish(f);
  assert.equal(amount(f, UNHOLY_MOULD), 0);
  assert.equal(amount(f, UNPOWERED_SYMBOL), 1);
  assert.equal(amount(f, UNHOLY_SYMBOL), 0);
});

test("the first conversation after the quest gives the mould, once", async (t) => {
  const { UNHOLY_MOULD } = core.ItemIdentifiers;
  const f = actor(t);
  talk(f);
  await tick(f);
  await choose(f, "I seek your wisdom.");
  const shown = await trace(f);
  assert.ok(!shown.some((line) => line.includes("casting mould.")), `no box (${shown})`);
  assert.deepEqual(f.messages, ["The ghost gives you a casting mould."], "a game message, as the video shows");
  assert.equal(amount(f, UNHOLY_MOULD), 1);
  assert.equal(f.p.getAttribute(T.MOULD_GIVEN_ATTRIBUTE), true);
  // From then on the standard dialogue plays: its menu, not the first meeting's.
  talk(f);
  await tick(f);
  await choose(f, "I need another unholy symbol mould.");
  await finish(f);
  assert.equal(amount(f, UNHOLY_MOULD), 1, "one already in the inventory: no second mould");
});

test("threatening him at the first meeting gives nothing, and the next talk is the first meeting again", async (t) => {
  const { UNHOLY_MOULD } = core.ItemIdentifiers;
  const f = actor(t);
  talk(f);
  await tick(f);
  await choose(f, "I have come to kill you.");
  await finish(f);
  assert.equal(amount(f, UNHOLY_MOULD), 0);
  assert.notEqual(f.p.getAttribute(T.MOULD_GIVEN_ATTRIBUTE), true);
  talk(f);
  await tick(f);
  await choose(f, "I seek your wisdom.");
  await finish(f);
  assert.equal(amount(f, UNHOLY_MOULD), 1);
});

test("a blessing turns one unpowered symbol into an unholy symbol", async (t) => {
  const { UNPOWERED_SYMBOL, UNHOLY_SYMBOL } = core.ItemIdentifiers;
  const f = actor(t, { items: [UNPOWERED_SYMBOL, UNPOWERED_SYMBOL] });
  f.p.setAttribute(T.MOULD_GIVEN_ATTRIBUTE, true);
  talk(f);
  await tick(f);
  await choose(f, "I have come to seek a blessing.");
  const shown = await trace(f);
  assert.ok(!shown.some((line) => line.startsWith("StatementDialogue")), `no boxes (${shown})`);
  assert.deepEqual(f.messages, ["The ghost mutters in a strange voice.", "The unholy symbol throbs with power."]);
  assert.ok(shown.some((line) => line.endsWith(": The symbol of our Lord has been blessed with power!")), `${shown}`);
  assert.equal(amount(f, UNPOWERED_SYMBOL), 1);
  assert.equal(amount(f, UNHOLY_SYMBOL), 1);
});

test("an unpowered symbol is blessed even beside an unholy one", async (t) => {
  const { UNPOWERED_SYMBOL, UNHOLY_SYMBOL } = core.ItemIdentifiers;
  const f = actor(t, { items: [UNHOLY_SYMBOL, UNPOWERED_SYMBOL] });
  f.p.setAttribute(T.MOULD_GIVEN_ATTRIBUTE, true);
  talk(f);
  await tick(f);
  await choose(f, "I have come to seek a blessing.");
  await finish(f);
  assert.equal(amount(f, UNPOWERED_SYMBOL), 0);
  assert.equal(amount(f, UNHOLY_SYMBOL), 2);
});

test("no blessing without an unpowered symbol, and none for one already blessed", async (t) => {
  const { UNPOWERED_SYMBOL, UNHOLY_SYMBOL } = core.ItemIdentifiers;
  for (const [items, reply] of [
    [[], "No blessings will be given to those who have no symbol of our Lord's love."],
    [[UNHOLY_SYMBOL], "I see you have the unholy symbol of our Lord. It is blessed with the Lord Zamorak's power."],
  ]) {
    const f = actor(t, { items });
    f.p.setAttribute(T.MOULD_GIVEN_ATTRIBUTE, true);
    talk(f);
    await tick(f);
    await choose(f, "I have come to seek a blessing.");
    if (items.length) {
      // Already blessed: his next line follows at once, with no pause (only the blessing has one).
      for (let i = 0; i < 4 && shownText(f) !== reply; i++) await resume(f);
      assert.equal(shownText(f), reply);
      // The continue alone, no tick after it: a pause of any length would close the chatbox here.
      await f.connection.dispatch([continuePacket(f)]);
      f.connection.processTurnPackets();
      assert.notEqual(f.p.getPacketSender().getChatboxGroupId(), -1, "the chatbox stays open");
      assert.equal(shownText(f), "Come to me when your faith weakens.");
    }
    const shown = await trace(f);
    if (!items.length) assert.ok(shown.some((line) => line.endsWith(`: ${reply}`)), `${reply} (${shown})`);
    assert.equal(amount(f, UNPOWERED_SYMBOL), 0);
    assert.equal(amount(f, UNHOLY_SYMBOL), items.length);
  }
});

test("before the mould is claimed, an unpowered symbol is not blessed", async (t) => {
  const { UNPOWERED_SYMBOL, UNHOLY_SYMBOL } = core.ItemIdentifiers;
  const f = actor(t, { items: [UNPOWERED_SYMBOL] });
  talk(f);
  await tick(f);
  await choose(f, "I seek your wisdom.");
  await finish(f);
  assert.equal(amount(f, UNPOWERED_SYMBOL), 1);
  assert.equal(amount(f, UNHOLY_SYMBOL), 0);
});

for (const closeBy of ["close", "walk"]) test(`closing the chatbox at his first reply (${closeBy}), then talking again, still blesses`, async (t) => {
  const { UNPOWERED_SYMBOL, UNHOLY_SYMBOL } = core.ItemIdentifiers;
  const f = actor(t, { items: [UNPOWERED_SYMBOL] });
  f.p.setAttribute(T.MOULD_GIVEN_ATTRIBUTE, true);
  talk(f);
  await tick(f);
  await choose(f, "I have come to seek a blessing.");
  for (let i = 0; i < 4 && !shownText(f).includes("I will bless it"); i++) await resume(f);
  assert.match(shownText(f), /I will bless it/);
  await f.connection.dispatch([{ type: closeBy === "walk" ? "move" : "interface_close", worldX: 2464, worldY: 3224, modifierFlags: 0, run: false }]);
  for (let i = 0; i < 4; i++) {
    core.TaskManager.processWalkTo(f.p.getIndex());
    f.p.getMovementQueue().process();
    await tick(f);
  }
  assert.equal(talking(f), false, "closed");
  assert.equal(amount(f, UNPOWERED_SYMBOL), 1, "nothing blessed yet");
  const shown = [];
  talk(f);
  await tick(f);
  shown.push(shownText(f));
  await choose(f, "I have come to seek a blessing.");
  await finish(f);
  assert.equal(shown[0], "Who treads upon my grave?", "the first talk after closing starts the conversation");
  assert.equal(amount(f, UNHOLY_SYMBOL), 1);
});

test("a lost mould is replaced", async (t) => {
  const { UNHOLY_MOULD } = core.ItemIdentifiers;
  const f = actor(t);
  f.p.setAttribute(T.MOULD_GIVEN_ATTRIBUTE, true);
  talk(f);
  await tick(f);
  await choose(f, "I need another unholy symbol mould.");
  await finish(f);
  assert.deepEqual(f.messages, ["The ghost hands you another mould."]);
  assert.equal(amount(f, UNHOLY_MOULD), 1);
});

test("with a mould already carried, the first meeting gives no second one, and blessings unlock", async (t) => {
  const { UNHOLY_MOULD, UNPOWERED_SYMBOL, UNHOLY_SYMBOL } = core.ItemIdentifiers;
  const f = actor(t, { items: [UNHOLY_MOULD, UNPOWERED_SYMBOL] });
  talk(f);
  await tick(f);
  await choose(f, "I seek your wisdom.");
  const shown = await trace(f);
  assert.ok(shown.some((line) => line.endsWith(": Here is a mould to make a token for our Lord; a mould for the unholy symbol of Zamorak.")), `${shown}`);
  assert.equal(amount(f, UNHOLY_MOULD), 1, "no second mould");
  assert.deepEqual(f.messages, [], "no \"gives you a casting mould\" line");
  assert.equal(f.p.getAttribute(T.MOULD_GIVEN_ATTRIBUTE), true);
  talk(f);
  await tick(f);
  await choose(f, "I have come to seek a blessing.");
  await finish(f);
  assert.equal(amount(f, UNHOLY_SYMBOL), 1, "blessed at the next conversation");
});

test("Talk-to without an amulet of ghostspeak sends the Wiki's message before his first line", async (t) => {
  const message = "This powerful spirit seems capable of speaking to you even though you are not wearing an Amulet of Ghostspeak.";
  for (const complete of [true, false]) {
    for (const [worn, expected] of [
      [{}, [message]],
      [{ AMULET_SLOT: 552 }, []],
      [{ AMULET_SLOT: 4250 }, []],
      [{ LEG_SLOT: 13113 }, []],
      [{ LEG_SLOT: 13112 }, [message]],
    ]) {
      const f = actor(t, { complete, worn });
      talk(f);
      assert.deepEqual(f.messages, expected, `${JSON.stringify(worn)}, quest complete: ${complete}`);
      await tick(f);
      assert.equal(shownText(f), "Who treads upon my grave?");
      assert.deepEqual(f.messages, expected, "once");
    }
  }
});

test("lines carry Lost City's moods in the transcript conversations too", async (t) => {
  const f = actor(t);
  talk(f);
  await tick(f);
  const heads = [[shownText(f), current(f).expression]];
  await resume(f);
  await resume(f, core.MultiChatboxPrompt.getPending(f.p).options.indexOf("I have come to kill you.") + 1);
  for (let i = 0; i < 4 && talking(f); i++) {
    heads.push([shownText(f), current(f).expression]);
    await resume(f);
  }
  assert.deepEqual(heads, [
    ["Who treads upon my grave?", seq("chatang1")],
    ["I have come to kill you.", seq("chatang1")],
    ["The might of mortals, to me, is as the dust to the sea.", seq("chatneu1")],
  ]);
});

test("past the blessing line: the two messages, then the chatbox closes for five ticks before he speaks again", async (t) => {
  const { UNPOWERED_SYMBOL } = core.ItemIdentifiers;
  const f = actor(t, { items: [UNPOWERED_SYMBOL] });
  f.p.setAttribute(T.MOULD_GIVEN_ATTRIBUTE, true);
  talk(f);
  await tick(f);
  await choose(f, "I have come to seek a blessing.");
  for (let i = 0; i < 6 && !shownText(f).includes("I will bless it for you."); i++) await resume(f);
  assert.equal(shownText(f), "I see you have the unholy symbol of our Lord. I will bless it for you.");
  assert.deepEqual(f.messages, [], "nothing before the line is continued");
  const group = f.p.getPacketSender().getChatboxGroupId();
  await f.connection.dispatch([{ type: "dialogue_continue", widgetId: (group << 16) | ([231, 217].includes(group) ? 5 : 0), childIndex: -1 }]);
  f.connection.processTurnPackets();
  assert.deepEqual(f.messages, ["The ghost mutters in a strange voice.", "The unholy symbol throbs with power."], "both messages on the continue");
  assert.equal(amount(f, core.ItemIdentifiers.UNHOLY_SYMBOL), 1, "blessed then");
  const after = [];
  for (let i = 1; i <= 7; i++) {
    core.TaskManager.process();
    const line = shownText(f).includes("has been blessed with power");
    if (i < 5) assert.equal(f.p.getPacketSender().getChatboxGroupId(), -1, `the chatbox is closed on tick ${i}`);
    after.push(line ? i : 0);
  }
  assert.equal(after.find(Boolean), 5, `the next line comes on tick 5 (${after})`);
});

test("the grave's Read shows its inscription", async (t) => {
  const f = actor(t, { complete: false });
  let tile = null;
  for (let x = 2458; x <= 2470 && !tile; x++) {
    for (let y = 3222; y <= 3234 && !tile; y++) {
      if (core.MapObjects.get(core.ObjectIdentifiers.GRAVE_OF_SCORPIUS, new core.Location(x, y, 0), null)) tile = [x, y];
    }
  }
  assert.ok(tile, "the map places the grave");
  await f.connection.dispatch([{ type: "object_option", id: core.ObjectIdentifiers.GRAVE_OF_SCORPIUS, x: tile[0], y: tile[1], clickType: 1 }]);
  f.connection.processTurnPackets();
  for (let i = 0; i < 12; i++) {
    core.TaskManager.processWalkTo(f.p.getIndex());
    f.p.getMovementQueue().process();
    core.TaskManager.process();
  }
  assert.equal(shownText(f), "Here lies Scorpius: Only those who have seen beyond the stars may seek his counsel.");
});

test("one mood per spoken line, and none for anything else", () => {
  const record = DIALOGUES["Spirit of Scorpius"];
  const spoken = new Set(T.PRE_QUEST_LINES);
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    for (const key of ["npc", "player"]) if (typeof node[key] === "string") spoken.add(node[key]);
    Object.values(node).forEach(walk);
  };
  walk(record.variants);
  walk(record.branches);
  for (const line of Object.keys(T.MOODS)) assert.ok(spoken.has(line), line);
  for (const line of spoken) assert.ok(Object.hasOwn(T.MOODS, line), `no mood for "${line}"`);
});

test("both variants and the step ids the plugin answers are in the generated transcript", () => {
  const variants = DIALOGUES["Spirit of Scorpius"]?.variants ?? {};
  const text = JSON.stringify(variants);
  for (const [id, words] of [
    [T.STEPS.FIRST_MOULD_STEP, "The ghost gives you a casting mould."],
    [T.STEPS.MUTTER_STEP, "The ghost mutters in a strange voice."],
    [T.STEPS.BLESS_STEP, "The unholy symbol throbs with power."],
    [T.STEPS.REPLACE_MOULD_STEP, "The ghost hands you another mould."],
  ]) {
    assert.ok(text.includes(`"text":${JSON.stringify(words)},"id":"${id}"`), `${id}: ${words}`);
  }
  assert.ok(variants[T.FIRST_VARIANT] && variants[T.STANDARD_VARIANT]);
});
