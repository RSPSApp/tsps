// Run after `yarn build`: node --test tests/fremennik-trials-completion.test.cjs
//
// The Fremennik Trials: the start, Brundt's acceptance, the scroll, the Fremennik name and
// Rellekka's distrustful stall keepers, as the rsprox captures show them (local 1002236 rev 242
// t3091-3184 and t10284-10338; local 1001646 rev 241 t1538-1551, t3494-3539). Real Player,
// session and connection, the real plugins, cache and dialogue data; ticks run as World.process does.
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

const LONGHALL = [2659, 3669, 0];
const BRUNDT = 9263; // viking_brundt (3926) as the longhall resolves it: viking_brundt_child
const START_HOOK = "quest:the-fremennik-trials:start";
const TRIALS = "quest.fremennik_trials.trials";
const NAME = "quest.fremennik_trials.name";
const ALL_PASSED = [0, 1, 2, 3, 4, 5, 6].reduce((bits, index) => bits | (2 << (index * 3)), 0);
const SCROLL = 153;
const PREFIXES = ["Bal", "Bar", "Dal", "Dar", "Den", "Dok", "Jar", "Jik", "Lar", "Rak", "Ral", "Ril", "Sig", "Tal", "Thor", "Ton"];
const SUFFIXES = ["dar", "dor", "dur", "kal", "kar", "kir", "kur", "lah", "lak", "lim", "lor", "rak", "tin", "ton", "tor", "vald"];
const FISH_STALL = { id: 4277, text: "The fishmonger is staring at you suspiciously. You cannot steal from<br>his stall while he distrusts you." };

let core;
let next = 7700;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(LONGHALL[0], LONGHALL[1]);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const quest = () => QuestRuntime.getRegisteredQuests().findLast((entry) => entry.key === "fremennik_trials");

function actor(t, { stage = 0, trials = 0 } = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel);
  const player = new Player(session);
  session.setPlayer(player);
  player.setUsername("brundt" + next++);
  player.setLongUsername(core.Misc.stringToLongBigInt(player.getUsername()));
  player.setAttribute("bot-skip-persistence", true);
  player.setLocation(new core.Location(...LONGHALL));
  player.needsPlacement = false;
  assert.equal(core.World.getPlayers().add(player), true);
  const connection = new ClientConnection(channel);
  connection.player = player;
  connection.sendPlayerBootstrap();
  const f = { player, connection, tick: 0, calls: [], messages: [] };
  record(f);
  t.after(() => {
    core.World.getPlayers().remove(player);
    PM.emitPlayerLogout({ player, username: player.getUsername() });
    core.TaskManager.cancelTasks(player.getIndex());
    core.TaskManager.cancelTasks(player);
  });
  if (stage) quest().setStage(player, stage);
  player.setAttribute(TRIALS, trials);
  tick(f);
  f.messages.length = 0;
  f.calls.length = 0;
  return f;
}

const RECORDED = /^(sendInterface|sendString|sendJingle|sendItemOnInterfaces)$/;
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
    f.messages.push(text);
    return send(text, ...rest);
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
}
const ticks = (f, count) => { for (let i = 0; i < count; i++) tick(f); };

function shown(f) {
  const menu = MultiChatboxPrompt.getPending(f.player);
  if (menu) return { who: "menu", title: menu.title, options: menu.options };
  const current = f.player.getDialogueManager().getCurrent?.();
  if (!current || typeof current.getText !== "function") return null;
  return { who: current.constructor.name, text: current.getText() };
}

async function continueLine(f) {
  const group = f.player.getPacketSender().getChatboxGroupId();
  await f.connection.dispatch([{ type: "dialogue_continue", widgetId: (group << 16) | 5, childIndex: -1 }]);
  tick(f);
}

/** Every line Brundt's talk shows, continued to its end. */
async function talkToBrundt(f) {
  PM.emitCustomEvent("npc-dialogue:start", { player: f.player, npcId: BRUNDT });
  tick(f);
  const lines = [];
  for (let i = 0; i < 30; i++) {
    const now = shown(f);
    if (!now || now.who === "menu") break;
    lines.push(now.text);
    await continueLine(f);
  }
  return lines;
}

test("Yes. to Brundt starts the quest with live's game message (1002236 t3169)", (t) => {
  const f = actor(t);
  PM.emitCustomEvent("npc-dialogue:hook", { player: f.player, npcId: BRUNDT, hook: START_HOOK });
  assert.equal(quest().getStage(f.player), 1);
  assert.deepEqual(f.messages, ["You've started a new quest: <col=081190>The Fremennik Trials</col>"]);
  PM.emitCustomEvent("npc-dialogue:hook", { player: f.player, npcId: BRUNDT, hook: START_HOOK });
  assert.equal(f.messages.length, 1, "once");
});

test("Brundt's first talk opens with 'Greetings outerlander!' before his menu (1002236 t3093)", (t) => {
  const f = actor(t);
  PM.emitCustomEvent("npc-dialogue:start", { player: f.player, npcId: BRUNDT });
  tick(f);
  assert.equal(shown(f)?.text, "Greetings outerlander!");
});

test("With fewer than seven votes Brundt counts them and reminds the player; nothing completes", async (t) => {
  const f = actor(t, { stage: 4, trials: (2 << 0) | (2 << 3) | (2 << 6) });
  const lines = await talkToBrundt(f);
  assert.equal(lines[0], "Greetings again outerlander! How goes your attempts to gain votes with the council of elders?");
  assert.ok(lines.includes("I only have 3 votes so far."), JSON.stringify(lines));
  assert.ok(lines.some((line) => line.startsWith("Remember: You need to get at least seven council votes")));
  assert.equal(quest().isComplete(f.player), false);
});

test("Seven votes: Brundt accepts the player, the scroll shows live's helm and lines, no blade (1002236 t10284-10305)", async (t) => {
  const f = actor(t, { stage: 7, trials: ALL_PASSED });
  const lines = await talkToBrundt(f);
  assert.deepEqual(lines.slice(0, 4), [
    "Greetings again outerlander! How goes your attempts to gain votes with the council of elders?",
    "I have seven members of the council prepared to vote in my favour now!",
    "I know outerlander, for I have been closely monitoring your progress so far!",
    "Then let us put the formality aside, and let me personally welcome you into the Fremennik! May you bring us honour!",
  ]);
  assert.ok(!lines.some((line) => line.startsWith("Remember:")), "the reminder belongs to the unfinished count");
  assert.equal(quest().isComplete(f.player), true);
  assert.ok(f.messages.includes("Congratulations, you've completed a quest: <col=081190>The Fremennik Trials</col>"));
  ticks(f, 3);
  assert.ok(f.calls.some((call) => call.name === "sendJingle" && call.args[0] === 153), "quest complete 2");
  assert.ok(f.calls.some((call) => call.name === "sendInterface" && call.args[0] === SCROLL));
  const model = f.calls.find((call) => call.name === "sendItemOnInterfaces" && call.args[0] >>> 16 === SCROLL);
  assert.equal(model?.args[1], core.ItemIdentifiers.FREMENNIK_HELM);
  const text = (child) => f.calls.filter((call) => call.name === "sendString" && call.args[1] === ((SCROLL << 16) | child)).at(-1)?.args[0];
  assert.deepEqual([9, 10, 11, 12, 13, 14].map(text), [
    "3 Quest Points", "2,800 XP each in Strength,", "Defence, Attack, Hitpoints,",
    "Fishing, Thieving, Agility,", "Crafting, Fletching &", "Woodcutting",
  ]);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.FREMENNIK_BLADE), 0, "live gives no item");
});

test("Brundt names the player once the scroll is closed; the name is saved and in the journal (1002236 t10313-10314)", async (t) => {
  const f = actor(t, { stage: 7, trials: ALL_PASSED });
  await talkToBrundt(f);
  ticks(f, 3);
  assert.equal(f.player.getInterfaceId(), SCROLL);
  ticks(f, 5);
  assert.equal(shown(f), null, "Brundt waits for the scroll");
  f.player.getPacketSender().sendInterfaceRemoval();
  ticks(f, 2);
  const index = Number(f.player.getAttribute(NAME));
  assert.ok(index >= 1 && index <= 256);
  const name = PREFIXES[Math.floor((index - 1) / 16)] + SUFFIXES[(index - 1) % 16];
  assert.equal(shown(f)?.text,
    `From this day onward, you are outerlander no more! In honour of your acceptance into the Fremennik You gain a new name to be known as. You will now be called ${name}.`);
  const request = { player: f.player, name: null };
  PM.emitCustomEvent("fremennik-trials:name", request);
  assert.equal(request.name, name);
  const journal = quest().buildJournal(f.player, quest());
  assert.deepEqual(journal.slice(-2), ["<col=000080>They also gave me a new name:</col>", `<col=800000>${name}</col>`]);
  assert.equal(journal[journal.indexOf("<col=ff0000>QUEST COMPLETE!</col>") - 8], "<str>I made my way to the far north of Kandarin and found the</str>");
});

test("a completion without the scroll (a quest pack) rolls the name but opens no Brundt dialogue", (t) => {
  const f = actor(t);
  f.player.moveTo(new core.Location(3222, 3218, 0));
  tick(f);
  assert.equal(quest().complete(f.player, { scroll: false, announce: false }), true);
  ticks(f, 6);
  assert.equal(shown(f), null, "no naming dialogue in Lumbridge");
  const index = Number(f.player.getAttribute(NAME));
  assert.ok(index >= 1 && index <= 256, "the name is still rolled");
});

test("[Fremennik name] lines speak the saved name; before the quest nobody has one", (t) => {
  const outerlander = actor(t, { stage: 3 });
  const request = { player: outerlander.player, name: null };
  PM.emitCustomEvent("fremennik-trials:name", request);
  assert.equal(request.name, null);
  const done = actor(t, { stage: 8, trials: ALL_PASSED });
  done.player.setAttribute(NAME, 16 * 14 + 16); // Thor + vald
  const line = { player: done.player, npcId: BRUNDT, text: "Hey! It's [Fremennik name]! Let me buy you a drink!" };
  PM.emitCustomEvent("npc-dialogue:line", line);
  assert.equal(line.text, "Hey! It's Thorvald! Let me buy you a drink!");
  const old = actor(t, { stage: 8, trials: ALL_PASSED });
  const rolled = { player: old.player, name: null };
  PM.emitCustomEvent("fremennik-trials:name", rolled);
  assert.match(rolled.name, new RegExp(`^(${PREFIXES.join("|")})(${SUFFIXES.join("|")})$`), "a save from before names gets one");
  assert.ok(Number(old.player.getAttribute(NAME)) >= 1);
});

test("Rellekka's fishmonger refuses outerlanders with live's message box, then trusts a Fremennik (1001646 t1538)", (t) => {
  const f = actor(t, { stage: 3 });
  const object = { getId: () => FISH_STALL.id };
  const access = { player: f.player, object, name: "Fish stall", refused: false };
  PM.emitCustomEvent("thieving:stall-access", access);
  assert.equal(access.refused, true);
  assert.equal(shown(f)?.text, FISH_STALL.text);
  const done = actor(t, { stage: 8, trials: ALL_PASSED });
  const trusted = { player: done.player, object, name: "Fish stall", refused: false };
  PM.emitCustomEvent("thieving:stall-access", trusted);
  assert.equal(trusted.refused, false);
  const elsewhere = { player: f.player, object: { getId: () => core.ObjectIdentifiers.FISH_STALL + 1000 }, name: "Fish stall", refused: false };
  PM.emitCustomEvent("thieving:stall-access", elsewhere);
  assert.equal(elsewhere.refused, false, "other fish stalls are not Rellekka's");
});

test("Royal Trouble's [dear/[Fremennik name]] is left to Royal Trouble, which speaks the saved name", (t) => {
  const done = actor(t, { stage: 8, trials: ALL_PASSED });
  done.player.setAttribute(NAME, 16 * 14 + 16); // Thorvald
  // Prince Brand's line in Royal Trouble's record.
  const line = { player: done.player, npcId: core.NpcIdentifiers.PRINCE_BRAND, text: "I hear you made peace between our kingdom and Etceteria once more. Well done, [dear/[Fremennik name]]." };
  PM.emitCustomEvent("npc-dialogue:line", line);
  assert.equal(line.text, "I hear you made peace between our kingdom and Etceteria once more. Well done, Thorvald.");
});

test("On Sigmund's chain, Brundt's 'Ask about becoming a Fremennik' is his vote count", (t) => {
  const f = actor(t, { stage: 2, trials: (1 << (2 * 3)) | (2 << 0) });
  f.player.setAttribute("quest.fremennik_trials.merchant_chain", 1);
  PM.emitCustomEvent("npc-dialogue:choice", { player: f.player, npcId: BRUNDT, option: "Ask about becoming a Fremennik" });
  ticks(f, 2);
  assert.equal(shown(f)?.text, "Greetings again outerlander! How goes your attempts to gain votes with the council of elders?");
});
