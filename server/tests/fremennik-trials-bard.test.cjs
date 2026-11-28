// Run after `yarn build`: node --test tests/fremennik-trials-bard.test.cjs
//
// The Fremennik Trials, Olaf the Bard's trial, against rsprox 1002236 / 1002247 / 1002250 (rev 242) and
// 1001364 (rev 241): the swaying tree, the knife, the rock soup, Askeladden's rock, spinning and stringing,
// Fossegrimen's altar, the backstage door, tuning and the performance. Real Player, session and connection,
// the real plugins, cache and map: clicks are packets, each tick runs as World.process does.
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

const BARD = 1;
const TREE = { id: 4142, x: 2738, y: 3638, stand: [2737, 3638, 0] };
const ALTAR = { id: 4141, x: 2626, y: 3598, stand: [2626, 3599, 0] };
const CAULDRON = { id: 4149, x: 2772, y: 3623, stand: [2771, 3622, 0] };
const WHEEL = { id: 25824, x: 2710, y: 3471, z: 1, stand: [2711, 3471, 1] };
const DOOR = { id: 4148, x: 2667, y: 3683, stand: [2667, 3683, 0] };
const STAGE = [2659, 3685, 0];
const FOSSEGRIMEN = 808;
const BALLAD = ["The thought of lots of questing,", "Leaves some people unfulfilled,",
  "But I have done my simple best, in", "Entering the Champions' Guild."];

let core;
let I;
let next = 7600;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.ObjectDefinition.init();
  core.RegionManager.init();
  for (const spot of [TREE, ALTAR, CAULDRON, WHEEL, DOOR]) core.RegionManager.loadMapFiles(spot.x, spot.y);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const quest = () => QuestRuntime.getRegisteredQuests().findLast((entry) => entry.key === "fremennik_trials");

function actor(t, { at, bard = 1, items = [], levels = {}, points = 0 } = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel);
  const player = new Player(session);
  session.setPlayer(player);
  player.setUsername("bard" + next++);
  player.setLongUsername(core.Misc.stringToLongBigInt(player.getUsername()));
  player.setAttribute("bot-skip-persistence", true);
  player.setLocation(new core.Location(...at));
  player.needsPlacement = false;
  assert.equal(core.World.getPlayers().add(player), true);
  const connection = new ClientConnection(channel);
  connection.player = player;
  connection.sendPlayerBootstrap();
  const f = { player, connection, tick: 0, calls: [], messages: [], said: [], anims: [] };
  record(f);
  t.after(() => {
    core.World.getPlayers().remove(player);
    PM.emitPlayerLogout({ player, username: player.getUsername() });
    core.TaskManager.cancelTasks(player.getIndex());
    core.TaskManager.cancelTasks(player);
  });
  quest().setStage(player, 1);
  player.setAttribute("quest.fremennik_trials.trials", bard << (BARD * 3));
  player.setAttribute(QuestRuntime.QUEST_POINTS_ATTRIBUTE, points);
  for (const [name, level] of Object.entries(levels)) {
    const skill = core.Skill[name];
    player.getSkillManager().setMaxLevel(skill, level).setCurrentLevel(skill, level)
      .setExperience(skill, core.SkillManager.getExperienceForLevel(level));
  }
  for (const id of items) player.getInventory().add(new core.Item(id, 1), false);
  tick(f);
  f.messages.length = 0;
  f.calls.length = 0;
  f.anims.length = 0;
  f.said.length = 0;
  return f;
}

const RECORDED = /^(sendSound|sendJingle|sendSong|sendObject|sendObjectRemoval|sendObjectAnimation|sendVarbit|sendTypedMessage)$/;
function record(f) {
  const sender = f.player.getPacketSender();
  const proto = Object.getPrototypeOf(sender);
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (!RECORDED.test(name) || typeof proto[name] !== "function") continue;
    const original = proto[name];
    sender[name] = function (...args) {
      f.calls.push({ tick: f.tick, name, args });
      return original.apply(this, args);
    };
  }
  const send = f.player.sendMessage.bind(f.player);
  f.player.sendMessage = (text, ...rest) => {
    f.messages.push(text);
    return send(text, ...rest);
  };
  const chat = f.player.forceChat.bind(f.player);
  f.player.forceChat = (text) => {
    f.said.push({ tick: f.tick, text });
    return chat(text);
  };
  const animate = f.player.performAnimation.bind(f.player);
  f.player.performAnimation = (animation) => {
    f.anims.push({ tick: f.tick, id: animation.getId() });
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
}
const ticks = (f, count) => { for (let i = 0; i < count; i++) tick(f); };

function shown(f) {
  const menu = MultiChatboxPrompt.getPending(f.player);
  if (menu) return { who: "menu", options: menu.options };
  const current = f.player.getDialogueManager().getCurrent?.();
  if (!current || typeof current.getText !== "function") return null;
  return { who: current.constructor.name, text: current.getText(), npc: current.getNpcId?.() };
}

const CHATBOX_GROUP = { NpcDialogue: 231, PlayerDialogue: 217 };
async function continueLine(f) {
  const group = CHATBOX_GROUP[f.player.getDialogueManager().getCurrent?.()?.constructor?.name] ?? 229;
  await f.connection.dispatch([{ type: "dialogue_continue", widgetId: (group << 16) | 5, childIndex: -1 }]);
  tick(f);
}

async function choose(f, text) {
  const options = MultiChatboxPrompt.getPending(f.player).options;
  const index = options.indexOf(text);
  assert.ok(index >= 0, `"${text}" in ${JSON.stringify(options)}`);
  await f.connection.dispatch([{ type: "dialogue_continue", widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: index + 1 }]);
  tick(f);
}

/** Continues until a line containing `text` shows (or fails). */
async function untilLine(f, text, limit = 30) {
  for (let i = 0; i < limit; i++) {
    const now = shown(f);
    if (now?.text?.includes(text)) return now;
    await continueLine(f);
  }
  assert.fail(`no line "${text}"; showing ${JSON.stringify(shown(f))}`);
}

const slotOf = (f, id) => f.player.getInventory().getSlotForItemId(id);
const held = (f, id) => f.player.getInventory().getAmount(id);
const xp = (f, name) => f.player.getSkillManager().skills.experience[core.Skill[name].getIndex()];
const callsOf = (f, name) => f.calls.filter((call) => call.name === name);

async function useOnObject(f, itemId, spot) {
  await f.connection.dispatch([{ type: "item_on_object", objectId: spot.id, x: spot.x, y: spot.y, itemId,
    slot: slotOf(f, itemId), widgetId: 149 << 16 }]);
  tick(f);
}
async function objectOption(f, spot, clickType) {
  await f.connection.dispatch([{ type: "object_option", id: spot.id, x: spot.x, y: spot.y, clickType }]);
  tick(f);
}
async function useOnItem(f, a, b) {
  await f.connection.dispatch([{ type: "inventory_use_on", itemId: a, slot: slotOf(f, a), target: { kind: "inventory", slot: slotOf(f, b) } }]);
  tick(f);
}
async function play(f, itemId) {
  await f.connection.dispatch([{ type: "inventory_action", widgetId: 149 << 16, itemId, slot: slotOf(f, itemId), option: "Play", optionIndex: 0 }]);
  tick(f);
}

test("the swaying tree: no axe refuses; an axe swings, then a branch every cut", async (t) => {
  const bare = actor(t, { at: TREE.stand });
  await objectOption(bare, TREE, 1);
  ticks(bare, 4);
  assert.deepEqual(bare.messages, ["You need an axe to chop down this tree.<br>You do not have an axe that you have the Woodcutting level to use."]);
  assert.equal(held(bare, I.BRANCH), 0);

  const f = actor(t, { at: TREE.stand, items: [I.BRONZE_AXE], levels: { WOODCUTTING: 40 } });
  const before = xp(f, "WOODCUTTING");
  await objectOption(f, TREE, 1);
  const start = f.tick;
  const swing = callsOf(f, "sendTypedMessage").find((call) => call.args[1] === "You swing your axe at the tree.");
  assert.ok(swing, "spam line on arrival");
  assert.ok(f.anims.some((a) => a.id === 879), "the bronze axe's woodcutting seq (1001364)");
  ticks(f, 2);
  assert.equal(held(f, I.BRANCH), 0, "not before 3 ticks");
  tick(f);
  assert.equal(f.tick - start, 3);
  assert.equal(held(f, I.BRANCH), 1);
  assert.deepEqual(f.messages, ["You cut a branch from the strangely musical tree."]);
  assert.equal(xp(f, "WOODCUTTING") - before, 1);
  assert.ok(f.anims.some((a) => a.id === -1 && a.tick === f.tick));
  await objectOption(f, TREE, 1);
  ticks(f, 3);
  assert.equal(held(f, I.BRANCH), 2, "several branches (1001364)");
});

test("knife on the branch: message and fletching seq at once, the unstrung lyre in its slot a tick later", async (t) => {
  const f = actor(t, { at: TREE.stand, items: [I.KNIFE, I.BRANCH] });
  const slot = slotOf(f, I.BRANCH);
  const before = xp(f, "CRAFTING");
  await useOnItem(f, I.KNIFE, I.BRANCH);
  assert.deepEqual(f.messages, ["You craft an unstrung lyre out of the branch."]);
  assert.ok(f.anims.some((a) => a.id === 1248));
  assert.equal(held(f, I.UNSTRUNG_LYRE), 0);
  tick(f);
  assert.equal(f.player.getInventory().forSlot(slot).getId(), I.UNSTRUNG_LYRE);
  assert.equal(xp(f, "CRAFTING") - before, 1);
});

test("golden wool strings the lyre in its slot; 25 Fletching is needed", async (t) => {
  const low = actor(t, { at: TREE.stand, items: [I.UNSTRUNG_LYRE, I.GOLDEN_WOOL], levels: { FLETCHING: 10 } });
  await useOnItem(low, I.GOLDEN_WOOL, I.UNSTRUNG_LYRE);
  assert.deepEqual(low.messages, ["You need to have a Fletching level of 25 to string the lyre."]);
  const f = actor(t, { at: TREE.stand, items: [I.UNSTRUNG_LYRE, I.GOLDEN_WOOL], levels: { FLETCHING: 30 } });
  const before = xp(f, "FLETCHING");
  await useOnItem(f, I.GOLDEN_WOOL, I.UNSTRUNG_LYRE);
  assert.deepEqual(f.messages, ["You attach the golden strings to the lyre."]);
  assert.equal(f.player.getInventory().forSlot(0).getId(), I.LYRE);
  assert.equal(held(f, I.GOLDEN_WOOL), 0);
  assert.equal(xp(f, "FLETCHING") - before, 1);
});

test("the wheel's Spin spins the fleece: seq, loc anim and sound, the wool 3 ticks later, no message", async (t) => {
  const f = actor(t, { at: WHEEL.stand, items: [I.GOLDEN_FLEECE] });
  const before = xp(f, "CRAFTING");
  await f.connection.dispatch([{ type: "object_option", id: WHEEL.id, x: WHEEL.x, y: WHEEL.y, clickType: 2 }]);
  for (let i = 0; i < 4 && !f.anims.some((a) => a.id === 13138); i++) tick(f);
  const start = f.anims.find((a) => a.id === 13138).tick;
  assert.ok(callsOf(f, "sendObjectAnimation").some((call) => call.args[1].getId() === 466));
  assert.ok(callsOf(f, "sendSound").some((call) => call.args[0] === 2590));
  ticks(f, 3 - (f.tick - start));
  assert.equal(held(f, I.GOLDEN_WOOL), 1);
  assert.equal(xp(f, "CRAFTING") - before, 2.5);
  assert.deepEqual(f.messages, []);
  assert.equal(shown(f), null, "no make-x menu");
});

test("Fossegrimen's altar: a raw shark with the strung lyre enchants it into the shark's slot and she speaks", async (t) => {
  const f = actor(t, { at: ALTAR.stand, items: [I.LYRE, I.COINS, I.RAW_SHARK] });
  const sharkSlot = slotOf(f, I.RAW_SHARK);
  await useOnObject(f, I.RAW_SHARK, ALTAR);
  for (let i = 0; i < 3 && f.messages.length === 0; i++) tick(f);
  assert.deepEqual(f.messages, ["Fossegrimen has enchanted your lyre so that you may play it."]);
  assert.equal(f.player.getInventory().forSlot(sharkSlot).getId(), I.ENCHANTED_LYRE);
  assert.equal(held(f, I.LYRE), 0);
  assert.equal(held(f, I.RAW_SHARK), 0);
  assert.ok(f.anims.some((a) => a.id === 8315));
  assert.ok(callsOf(f, "sendSound").some((call) => call.args[0] === 136));
  const npc = core.World.getNpcs().toArray?.().find?.((n) => n?.getId() === FOSSEGRIMEN && n.getOwner?.() === f.player)
    ?? [...core.World.getNpcs()].find((n) => n?.getId?.() === FOSSEGRIMEN && n.getOwner?.() === f.player);
  assert.ok(npc, "Fossegrimen rises for the player");
  assert.deepEqual([npc.getLocation().getX(), npc.getLocation().getY()], [2626, 3596]);
  assert.deepEqual(shown(f), { who: "NpcDialogue", npc: FOSSEGRIMEN,
    text: "Many thanks for the offering outerlander. Please accept as a gift the ability to play your lyre..." });
  await continueLine(f);
  assert.equal(shown(f), null);
});

test("a raw shark without the strung lyre does nothing of the trial's", async (t) => {
  const f = actor(t, { at: ALTAR.stand, items: [I.RAW_SHARK] });
  await useOnObject(f, I.RAW_SHARK, ALTAR);
  ticks(f, 2);
  assert.equal(held(f, I.RAW_SHARK), 1);
  assert.ok(!f.messages.includes("Fossegrimen has enchanted your lyre so that you may play it."));
});

test("Summon: Fossegrimen rises and asks; a fish not held is a message box", async (t) => {
  const f = actor(t, { at: ALTAR.stand, items: [I.LYRE] });
  await objectOption(f, ALTAR, 1);
  for (let i = 0; i < 3 && !shown(f); i++) tick(f);
  assert.deepEqual(shown(f), { who: "NpcDialogue", npc: FOSSEGRIMEN, text: "What can I do for you?" });
  await untilLine(f, "Can I help you with anything else?");
  await continueLine(f);
  await choose(f, "Present offering of a single fish.");
  await choose(f, "Raw manta ray.");
  assert.equal(shown(f)?.text, "You do not have a raw manta ray to offer.");
});

test("the rock soup: each vegetable has its line and Lalli asks; the fourth item plays the done talk", async (t) => {
  const f = actor(t, { at: CAULDRON.stand, items: [I.ONION, I.POTATO, I.CABBAGE, I.PET_ROCK] });
  await useOnObject(f, I.ONION, CAULDRON);
  for (let i = 0; i < 3 && !shown(f); i++) tick(f);
  assert.deepEqual(f.messages, ["You put an onion into the cauldron."]);
  assert.equal(shown(f)?.text, "It am ready now?");
  await continueLine(f);
  assert.equal(shown(f)?.text, "Not just yet...");
  await continueLine(f);
  await useOnObject(f, I.POTATO, CAULDRON);
  for (let i = 0; i < 3 && f.messages.length < 2; i++) tick(f);
  await useOnObject(f, I.CABBAGE, CAULDRON);
  for (let i = 0; i < 3 && f.messages.length < 3; i++) tick(f);
  await useOnObject(f, I.PET_ROCK, CAULDRON);
  for (let i = 0; i < 3 && f.messages.length < 4; i++) tick(f);
  assert.deepEqual(f.messages, ["You put an onion into the cauldron.", "You put a potato into the cauldron.",
    "You put a cabbage into the cauldron.", "You put your pet rock into the cauldron."]);
  assert.equal(shown(f)?.text, "It am ready now?");
  await continueLine(f);
  assert.equal(shown(f)?.text, "Indeed it is. Try it and see.");
  await untilLine(f, "Let me think about that, me like to think.");
  assert.ok(!f.messages.some((m) => /ready to taste/.test(m)));
});

test("Askeladden gives the pet rock on his last line and changes form", async (t) => {
  const f = actor(t, { at: [2660, 3660, 0] });
  PM.emitCustomEvent("npc-dialogue:start", { player: f.player, npcId: 8402,
    variant: "the-council-members-olaf-the-bard-talking-to-askeladden" });
  tick(f);
  await untilLine(f, "Do you have any spare rocks then?");
  assert.equal(held(f, I.PET_ROCK), 0, "not on 'A faithful companion for life!'");
  await continueLine(f);
  assert.ok(shown(f)?.text.startsWith("Sure thing buddy, although I have to say"));
  assert.equal(held(f, I.PET_ROCK), 1);
  assert.ok(callsOf(f, "sendVarbit").some((call) => call.args[0] === 6486 && call.args[1] === 1));
  await continueLine(f);
  assert.equal(held(f, I.PET_ROCK), 1, "one rock");
});

test("the backstage door swaps open, the player walks through and the bouncer speaks", async (t) => {
  const f = actor(t, { at: DOOR.stand, items: [I.ENCHANTED_LYRE] });
  await objectOption(f, DOOR, 1);
  const objects = callsOf(f, "sendObject").map((call) => [call.args[0].getId(), call.args[0].getLocation().getX(), call.args[0].getFace()]);
  assert.deepEqual(objects, [[38848, 2667, 0], [4249, 2666, 1]]);
  assert.ok(callsOf(f, "sendSound").some((call) => call.args[0] === 62));
  tick(f);
  assert.deepEqual([f.player.getLocation().getX(), f.player.getLocation().getY()], [2666, 3683]);
  assert.equal(shown(f)?.text, "Yeah, you're good to go through. Olaf tells me you're some kind of outerlander bard here on tour. I doubt you're worse than Olaf is.");
  tick(f);
  assert.ok(callsOf(f, "sendObject").some((call) => call.args[0].getId() === 4148));
  assert.ok(callsOf(f, "sendObjectRemoval").some((call) => call.args[0].getId() === 4249));
  await continueLine(f);
  // Leaving: the same swap, no dialogue.
  f.calls.length = 0;
  await objectOption(f, DOOR, 1);
  ticks(f, 2);
  assert.deepEqual([f.player.getLocation().getX(), f.player.getLocation().getY()], [2667, 3683]);
  assert.equal(shown(f), null);
});

test("without the enchanted lyre the bouncer turns the player away", async (t) => {
  const f = actor(t, { at: DOOR.stand });
  await objectOption(f, DOOR, 1);
  ticks(f, 2);
  assert.equal(shown(f)?.text, "Hey, outerlander. You can't go through there. Talent only, backstage.");
  assert.deepEqual([f.player.getLocation().getX(), f.player.getLocation().getY()], [2667, 3683]);
});

test("the strung lyre's Play: the player cannot play it yet", async (t) => {
  const f = actor(t, { at: STAGE, items: [I.LYRE] });
  await play(f, I.LYRE);
  assert.deepEqual(shown(f), { who: "PlayerDialogue", text: "I really wouldn't know where to begin playing anything on this...", npc: undefined });
});

test("off stage the enchanted lyre is tuned and kept; walking stops the tuning", async (t) => {
  const f = actor(t, { at: ALTAR.stand, items: [I.ENCHANTED_LYRE] });
  await play(f, I.ENCHANTED_LYRE);
  const click = f.tick;
  // Standing still, the withdraw is on the click tick and the scale starts a tick later (1002313 t536).
  assert.deepEqual(f.messages, ["You withdraw your lyre."]);
  ticks(f, 17);
  assert.deepEqual(f.said.map((s) => [s.tick - click, s.text]),
    [[1, "Doh Ray Me So."], [4, "Fah La Ti Doh."], [7, "La La La La."], [10, "De-Doo-De-Doo."]]);
  assert.deepEqual(f.messages, ["You withdraw your lyre.", "Your lyre is perfectly tuned."]);
  assert.deepEqual(callsOf(f, "sendJingle").map((call) => call.args[0]), [165, 164, 164, 164, 163]);
  assert.equal(held(f, I.ENCHANTED_LYRE), 1);
  assert.equal(quest().getStage(f.player), 1);

  const walker = actor(t, { at: ALTAR.stand, items: [I.ENCHANTED_LYRE] });
  await play(walker, I.ENCHANTED_LYRE);
  ticks(walker, 3);
  await walker.connection.dispatch([{ type: "move", worldX: 2626, worldY: 3604, modifierFlags: 0 }]);
  ticks(walker, 16);
  assert.ok(!walker.messages.includes("Your lyre is perfectly tuned."));
});

test("the performance: ballad, messages, Olaf's two lines, then the trial on the last continue", async (t) => {
  const f = actor(t, { at: STAGE, items: [I.ENCHANTED_LYRE], points: 40 });
  await play(f, I.ENCHANTED_LYRE);
  const m = f.tick;
  assert.deepEqual(f.messages, ["You withdraw your lyre."]);
  ticks(f, 18);
  assert.deepEqual(f.said.filter((s) => s.text !== undefined).map((s) => [s.tick - m, s.text]),
    BALLAD.map((line, index) => [2 + index * 4, line]));
  assert.deepEqual(f.anims.filter((a) => a.id === 1318).map((a) => a.tick - m), [1]);
  assert.deepEqual(callsOf(f, "sendJingle").map((call) => [call.tick - m, call.args[0]]),
    [[2, 165], [6, 164], [10, 164], [14, 164], [18, 163]]);
  assert.deepEqual(f.messages, ["You withdraw your lyre.", "Your lyre is perfectly tuned.",
    "Congratulations! You have completed the Bard's Trial!", "As you finished playing you felt Fossegrimen's power leave you..."]);
  assert.ok(f.anims.some((a) => a.id === 1319 && a.tick - m === 18));
  assert.deepEqual(shown(f), { who: "NpcDialogue", npc: 802,
    text: "Wow! That was awesome! You are one of the greatest bards I have ever had the pleasure of watching performing!" });
  // Held in place while it plays.
  await f.connection.dispatch([{ type: "move", worldX: 2659, worldY: 3680, modifierFlags: 0 }]);
  tick(f);
  assert.deepEqual([f.player.getLocation().getX(), f.player.getLocation().getY()], [STAGE[0], STAGE[1]]);
  assert.equal(quest().getStage(f.player), 1, "not yet");
  await continueLine(f);
  assert.equal(shown(f)?.text, "You have certainly earned my vote! I hope we can duet together soon!");
  await continueLine(f);
  assert.equal(shown(f), null);
  assert.equal(f.messages.at(-1), "You feel the musical ability from Fossegrimen leave you...");
  assert.equal(quest().getStage(f.player), 2);
  assert.equal(held(f, I.ENCHANTED_LYRE), 0);
  assert.equal(held(f, I.LYRE), 1);
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), false);
});

const variantFor = (f, npcId) => PM.emitNpcDialogueVariant({ player: f.player, npcId });
const P = "the-council-members-olaf-the-bard";

test("Olaf: the offer, Yes starts the trial, then the reminder and, once passed, his vote", async (t) => {
  const f = actor(t, { at: [2660, 3660, 0], bard: 0 });
  assert.equal(variantFor(f, 802), P);
  PM.emitCustomEvent("npc-dialogue:start", { player: f.player, npcId: 802, variant: P });
  tick(f);
  for (let i = 0; i < 10 && shown(f)?.who !== "menu"; i++) await continueLine(f);
  await choose(f, "Yes");
  assert.equal(shown(f)?.text, "Sure! This certainly sounds pretty easy to accomplish - I'll have your vote in no time!");
  assert.equal(f.player.getAttribute("quest.fremennik_trials.trials"), 1 << (BARD * 3));
  assert.equal(variantFor(f, 802), `${P}-talking-to-him-again`);
  f.player.setAttribute("quest.fremennik_trials.trials", 2 << (BARD * 3));
  assert.equal(variantFor(f, 802), `${P}-subsequent-dialogue-with-olaf`);
});

test("Lalli: the plan is a message box; after it Lalli only asks for food; the soup brings the fleece", async (t) => {
  const f = actor(t, { at: CAULDRON.stand, items: [I.PET_ROCK] });
  assert.equal(variantFor(f, 803), `${P}-talking-to-lalli-again-with-the-pet-rock`);
  PM.emitCustomEvent("npc-dialogue:start", { player: f.player, npcId: 803, variant: variantFor(f, 803) });
  tick(f);
  const box = await untilLine(f, "You have a cunning plan to trick this troll.");
  assert.deepEqual(box, { who: "StatementDialogue", npc: undefined,
    text: "You have a cunning plan to trick this troll. You need your pet rock, a cabbage, a potato and an onion." });
  await continueLine(f);
  assert.equal(variantFor(f, 803), `${P}-talking-to-lalli-again-with-the-pet-rock-talking-to-lalli-again`);
  for (const bit of [2, 3, 4, 5]) f.player.setAttribute("quest.fremennik_trials.flags",
    (f.player.getAttribute("quest.fremennik_trials.flags") ?? 0) | (1 << bit));
  const soup = variantFor(f, 803);
  assert.equal(soup, `${P}-talking-to-lalli-again-with-the-pet-rock-making-rock-soup-talking-to-lalli-after-making-the-soup`);
  PM.emitCustomEvent("npc-dialogue:start", { player: f.player, npcId: 803, variant: soup });
  tick(f);
  await untilLine(f, "Gee, sorry human");
  assert.equal(held(f, I.GOLDEN_FLEECE), 0);
  await continueLine(f);
  assert.ok(shown(f).text.startsWith("Here you go. Hah! Me trick you human!"));
  assert.equal(held(f, I.GOLDEN_FLEECE), 1, "the fleece comes with the line (1002236 t4213)");
  await continueLine(f);
  assert.equal(shown(f)?.text, "Glad you're happy Lalli!");
  await continueLine(f);
  assert.equal(held(f, I.GOLDEN_FLEECE), 1);
});

test("Askeladden after the rock: the again talk, and the form varbit comes back at login", async (t) => {
  const f = actor(t, { at: [2660, 3660, 0] });
  assert.equal(variantFor(f, 8402), `${P}-talking-to-askeladden`);
  f.player.setAttribute("quest.fremennik_trials.bard", 1 << 1);
  assert.equal(variantFor(f, 8403), `${P}-talking-to-askeladden-talking-to-askeladden-again`);
  f.calls.length = 0;
  PM.emitPlayerLogin({ player: f.player, username: f.player.getUsername() });
  assert.ok(callsOf(f, "sendVarbit").some((call) => call.args[0] === 6486 && call.args[1] === 1));
  // The lost-rock branch hands another over.
  PM.emitCustomEvent("npc-dialogue:start", { player: f.player, npcId: 8403, variant: variantFor(f, 8403) });
  tick(f);
  await untilLine(f, "Sure thing buddy! I'd say take better care of this one");
  await continueLine(f);
  assert.equal(held(f, I.PET_ROCK), 1);
});

test("Summon with a raw shark held offers it as the altar does, on the pick's tick", async (t) => {
  // rsprox 1002313 t524: the slot swap, the message and her blessing all come as "Raw shark." is picked.
  const f = actor(t, { at: ALTAR.stand, items: [I.LYRE, I.RAW_SHARK] });
  await objectOption(f, ALTAR, 1);
  for (let i = 0; i < 3 && !shown(f); i++) tick(f);
  await untilLine(f, "Can I help you with anything else?");
  await continueLine(f);
  await choose(f, "Present offering of a single fish.");
  await choose(f, "Raw shark.");
  assert.equal(held(f, I.ENCHANTED_LYRE), 1);
  assert.equal(held(f, I.RAW_SHARK), 0);
  assert.equal(shown(f)?.text, "Many thanks for the offering outerlander. Please accept as a gift the ability to play your lyre...");
});

test("without any achievement the player sings the plain ballad (Wiki)", async (t) => {
  const f = actor(t, { at: STAGE, items: [I.ENCHANTED_LYRE], points: 0 });
  await play(f, I.ENCHANTED_LYRE);
  ticks(f, 18);
  const lines = f.said.map((s) => s.text);
  assert.equal(lines[0], `${f.player.getUsername()} is my name,`.replace(f.player.getUsername(), f.player.getDisplayName?.() ?? f.player.getUsername()));
  assert.equal(lines[3], "I'll just go ahead and play.");
});

test("golden wool strings into the lower of the two slots (rsprox 1002313 t331, 1002247 t5862)", async (t) => {
  // Wool in slot 0 used on the lyre in slot 1: the strung lyre takes slot 0, and slot 1 empties.
  const f = actor(t, { at: TREE.stand, items: [I.GOLDEN_WOOL, I.UNSTRUNG_LYRE], levels: { FLETCHING: 30 } });
  await useOnItem(f, I.GOLDEN_WOOL, I.UNSTRUNG_LYRE);
  assert.equal(f.player.getInventory().forSlot(0)?.getId(), I.LYRE);
  assert.ok(!(f.player.getInventory().forSlot(1)?.getId() > 0));
});

test("Askeladden's lost-rock branch hands the rock over as 'Sure thing buddy!' shows (rsprox 1002313 t119)", async (t) => {
  const f = actor(t, { at: [2660, 3660, 0] });
  f.player.setAttribute("quest.fremennik_trials.bard", 1 << 1);
  PM.emitCustomEvent("npc-dialogue:start", { player: f.player, npcId: 8403, variant: `${P}-talking-to-askeladden-talking-to-askeladden-again` });
  tick(f);
  await untilLine(f, "Can I have another rock? I lost mine...");
  assert.equal(held(f, I.PET_ROCK), 0);
  await continueLine(f);
  assert.ok(shown(f)?.text.startsWith("Sure thing buddy! I'd say take better care of this one"));
  assert.equal(held(f, I.PET_ROCK), 1);
  await continueLine(f);
  assert.equal(held(f, I.PET_ROCK), 1, "one rock");
});

test("after the Bard's trial Askeladden plays his own talk (rsprox 1002313 t2883)", async (t) => {
  const f = actor(t, { at: [2660, 3660, 0], bard: 2 });
  assert.equal(variantFor(f, 8402), "the-non-council-members-askeladden");
});
