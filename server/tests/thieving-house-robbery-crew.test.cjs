// Run after `yarn build`: node --test tests/thieving-house-robbery-crew.test.cjs
// Oriana's crew for Stealing valuables, through the REAL NpcDialogues runtime and the generated transcripts
// (npc-dialogues.json from osrsreboxed-db): the urchins' house information, the refusals below 50 Thieving,
// Oriana's first meeting and trade-in, Oli's stew. Captures: rsprox 1102, 1104, 1105, 1098.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, afterEach, test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { Location } = require("../dist/game/model/Location");
const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");
const { ObjectDefinition } = require("../dist/game/definition/ObjectDefinition");

const HouseRobbery = require("../plugins/skills/thieving/HouseRobbery.Thieving");
const Crew = require("../plugins/skills/thieving/HouseRobberyCrew.Thieving");

let core;
let index = 9800;
const cleanups = [];
const KEY = () => CacheDefinitions.getObjId("varlamore_thieving_house_key");
const VALUABLE = () => CacheDefinitions.getObjId("varlamore_thieving_house_valuable");
const NPC = (name) => CacheDefinitions.getNpcId(name);
const LUCIA = () => NPC("varlamore_thieving_house_urchin_c");
const OLI = () => NPC("varlamore_thieving_house_urchin_d");
const ORIANA = () => NPC("varlamore_dodgy_character_multi");

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  ObjectDefinition.init();
  core = PM.getCoreApi();
  require("../plugins/npcs/NpcDialogues.plugin").register(PM.createApi("CrewDialogue"));
  const api = PM.createApi("CrewThieving");
  HouseRobbery({ ...api, core: { ...core, TaskManager: { ...core.TaskManager, submit: () => {} } } });
  Crew(api);
  HouseRobbery._test.start();
});

afterEach(() => {
  while (cleanups.length) cleanups.pop()();
});

/** Puts the owners' cycle in a state: "vacant" (the house's owner out) or "leaving-soon" (it is next). */
function houseIs(key, status) {
  const { cycle, houses } = HouseRobbery._test;
  const house = houses.find((h) => h.key === key);
  cycle.house = status === "vacant" ? house : null;
  cycle.next = status === "leaving-soon" ? house : null;
  cycle.phase = status === "vacant" ? "away" : "home";
}

function actor(npcId, { thieving = 60, items = [], attributes = {} } = {}) {
  const tile = [1660, 3095, 0];
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel), new Location(...tile));
  p.setIndex(index++); p.setRegistered(true); p.setUsername("crew" + index);
  p.setAttribute("bot-skip-persistence", true);
  p.getSkillManager().setMaxLevel(core.Skill.THIEVING, thieving);
  p.getSkillManager().setCurrentLevel(core.Skill.THIEVING, thieving, false);
  for (const [item, amount] of items) p.getInventory().adds(item, amount);
  for (const [key, value] of Object.entries(attributes)) p.setAttribute(key, value);
  const connection = new ClientConnection(channel);
  connection.player = p;
  const npc = core.NPC.create(npcId, new Location(...tile));
  const lines = [];
  const messages = [];
  const events = [];
  const sender = p.getPacketSender();
  const wrap = (name, record) => {
    const original = sender[name].bind(sender);
    sender[name] = (...args) => { record(...args); return original(...args); };
  };
  wrap("sendString", (text) => lines.push(String(text)));
  wrap("sendMessage", (text) => messages.push(String(text)));
  wrap("sendTypedMessage", (_type, text) => messages.push(String(text)));
  wrap("sendPositionalHint", (at, position, height) => events.push(`hint ${at.getX()},${at.getY()} height ${height}`));
  wrap("sendEnterAmountPrompt", (title) => events.push(`prompt ${title}`));
  cleanups.push(() => { p.closeInterruptibleInterfaces(); p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  const send = async (packet) => { await connection.dispatch([packet]); connection.processTurnPackets(); };
  const next = () => send({ type: "dialogue_continue", widgetId: (p.getPacketSender().getChatboxGroupId() << 16) | 5, childIndex: -1 });
  async function choose(text) {
    for (let n = 0; !MultiChatboxPrompt.getPending(p) && n < 60; n++) {
      assert.ok(p.getDialogueManager().getCurrent(), `dialogue ended before "${text}"; lines: ${JSON.stringify(lines)}`);
      await next();
    }
    const prompt = MultiChatboxPrompt.getPending(p);
    assert.ok(prompt?.options.includes(text), `"${text}" offered: ${JSON.stringify(prompt?.options)} (lines ${JSON.stringify(lines.slice(-4))})`);
    await send({ type: "dialogue_continue", widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: prompt.options.indexOf(text) + 1 });
    return prompt;
  }
  async function playToEnd(limit = 120) {
    for (let n = 0; n < limit && p.getDialogueManager().getCurrent(); n++) {
      if (MultiChatboxPrompt.getPending(p)) break;
      await next();
    }
  }
  const varbit = (name) => p.getPacketSender().getVarbit?.(CacheDefinitions.getVarbitId(name));
  return { p, npc, npcId: npc.getContentId(p), lines, messages, events, choose, playToEnd, varbit, count: (id) => p.getInventory().getAmount(id) };
}

const talkTo = (a) => PM.emitNpcInteraction({ player: a.p, npc: a.npc, npcId: a.npc.getContentId(a.p), action: "Talk-to", clickType: 1, handled: false });
const said = (a, text) => a.lines.some((line) => line.includes(text));

test("an urchin's first talk: the crew, then free information and the pointer to the vacant house (rsprox 1105)", async () => {
  houseIs("caius", "vacant");
  const a = actor(LUCIA(), { items: [[KEY(), 1]] });
  talkTo(a);
  await a.choose("Sounds good.");
  assert.ok(said(a, "Me and my mates run these streets."));
  await a.choose("Yes please.");
  await a.playToEnd();
  assert.ok(said(a, "You're new around here. Normally I'd charge 15 valuables for information, but I'm feeling generous."));
  assert.ok(said(a, "Looks like <col=990000>Caius</col> isn't home right now. Go quickly!"), JSON.stringify(a.lines));
  assert.ok(said(a, "Do you want me to point you in the right direction?"));
  assert.ok(said(a, "His house is north west of here."));
  assert.ok(!said(a, "Already forgotten?"), "named once: not also 'already forgotten'");
  assert.deepEqual(a.events, ["hint 1630,3121 height 100"]);
  assert.equal(a.p.getAttribute(Crew._test.LAST_CHECKED_ATTRIBUTE), 3);
  assert.equal(a.p.getAttribute(Crew._test.FREE_INFO_ATTRIBUTE), true);
});

test("a paid lookup: 15 valuables for the next house to go (rsprox 1105 tick 10837)", async () => {
  houseIs("victor", "leaving-soon");
  const a = actor(LUCIA(), {
    items: [[KEY(), 1], [VALUABLE(), 20]],
    attributes: { [Crew._test.URCHIN_INTRO_ATTRIBUTE]: true, [Crew._test.FREE_INFO_ATTRIBUTE]: true, [Crew._test.MET_ATTRIBUTE]: true },
  });
  talkTo(a);
  await a.choose("I could do with some information on houses.");
  assert.ok(said(a, "Hello. A fine day for stealing, wouldn't you say?"));
  const menu = await a.choose("Yes.");
  assert.deepEqual(menu.options, ["Yes.", "Yes, don't ask me again.", "No."]);
  assert.equal(a.count(VALUABLE()), 5);
  await a.choose("Yes please.");
  await a.playToEnd();
  assert.ok(said(a, "I hear that <col=990000>Victor</col> might be leaving his house soon."), JSON.stringify(a.lines));
  assert.ok(said(a, "His house is west of here."));
  assert.equal(a.p.getAttribute(Crew._test.LAST_CHECKED_ATTRIBUTE), 2);
});

test("asked again about the same vacant house: 'Already forgotten?' only", async () => {
  houseIs("caius", "vacant");
  const a = actor(LUCIA(), {
    items: [[KEY(), 1], [VALUABLE(), 20]],
    attributes: { [Crew._test.URCHIN_INTRO_ATTRIBUTE]: true, [Crew._test.FREE_INFO_ATTRIBUTE]: true, [Crew._test.MET_ATTRIBUTE]: true, [Crew._test.LAST_CHECKED_ATTRIBUTE]: 3 },
  });
  talkTo(a);
  await a.choose("I could do with some information on houses.");
  await a.choose("Yes.");
  await a.choose("I'll find my own way.");
  await a.playToEnd();
  assert.ok(said(a, "Already forgotten? Head over to <col=990000>Caius</col>'s house."), JSON.stringify(a.lines));
  assert.ok(!said(a, "isn't home right now"));
});

test("without keys, or with fewer than 15 valuables after the free one, the urchin turns the player away", async () => {
  houseIs("lavinia", "vacant");
  const intro = { [Crew._test.URCHIN_INTRO_ATTRIBUTE]: true, [Crew._test.FREE_INFO_ATTRIBUTE]: true, [Crew._test.MET_ATTRIBUTE]: true };
  const keyless = actor(LUCIA(), { attributes: intro });
  talkTo(keyless);
  await keyless.choose("I could do with some information on houses.");
  await keyless.playToEnd();
  assert.ok(said(keyless, "You don't have any house keys, do you?"));
  const poor = actor(LUCIA(), { items: [[KEY(), 1], [VALUABLE(), 3]], attributes: intro });
  talkTo(poor);
  await poor.choose("I could do with some information on houses.");
  await poor.playToEnd();
  assert.ok(said(poor, "You don't have any valuables worth my time. Come back when you do!"));
  assert.equal(poor.count(VALUABLE()), 3);
});

test("below 50 base Thieving: the urchin's refusal and the House Robbery box (rsprox 1102 tick 11246)", async () => {
  const a = actor(LUCIA(), { thieving: 45 });
  talkTo(a);
  await a.playToEnd();
  assert.ok(said(a, "I'm rather busy here, and you don't seem like the thieving type. Beat it!"));
  assert.ok(said(a, "Rude."));
  assert.ok(said(a, "You need <col=990000>50 Thieving</col> to take part in House Robbery."), JSON.stringify(a.lines));
});

test("Oriana: the first meeting names her (stranger_met), and Trade-in pays 55 coins a valuable (rsprox 1102, 1104)", async () => {
  const a = actor(ORIANA(), { items: [[VALUABLE(), 88]] });
  talkTo(a);
  await a.choose("I'd better get going.");
  assert.ok(said(a, "You look a bit shady, if I do say so myself."));
  assert.equal(a.p.getAttribute(Crew._test.MET_ATTRIBUTE), true);
  assert.equal(a.npc.getContentId(a.p), NPC("varlamore_dodgy_character_met"), "the multinpc now shows Oriana");
  a.p.closeInterruptibleInterfaces();
  assert.equal(Crew._test.tradeIn({ player: a.p, npc: a.npc, npcId: a.npc.getContentId(a.p) }), true);
  assert.deepEqual(a.events, ["prompt How many valuables would you like to hand in? <col=990000>(0 - 88)"]);
  a.p.getEnteredAmountAction().execute(88);
  await a.playToEnd();
  assert.equal(a.count(VALUABLE()), 0);
  assert.equal(a.count(core.ItemIdentifiers.COINS), 4840);
  assert.ok(said(a, "You hand in <col=990000>88</col> valuable items for <col=990000>4,840</col> coins."), JSON.stringify(a.lines));
  assert.ok(said(a, "There ya go! Don't spend it all at once."));
});

test("Oriana below 50 Thieving: lookout duty and the box (rsprox 1102 ticks 18424-18430)", async () => {
  const a = actor(ORIANA(), { thieving: 47 });
  talkTo(a);
  await a.playToEnd();
  assert.ok(said(a, "Sorry, but I'm rather busy here keeping lookout."));
  assert.ok(said(a, "You need <col=990000>50 Thieving</col> to take part in House Robbery."));
  assert.notEqual(a.p.getAttribute(Crew._test.MET_ATTRIBUTE), true, "not met yet");
});

test("stew on Oli: the stew goes, its box, and his thanks (rsprox 1098)", async () => {
  const a = actor(OLI(), { items: [[core.ItemIdentifiers.STEW, 1]] });
  const slot = a.p.getInventory().getItems().findIndex((item) => item?.getId() === core.ItemIdentifiers.STEW);
  const event = PM.emitItemOnNpc({
    player: a.p, target: a.npc, definition: a.npc.getCurrentDefinition(a.p), npcId: a.npc.getContentId(a.p), targetIndex: a.npc.getIndex(),
    interfaceId: 3214, item: a.p.getInventory().getItems()[slot], itemId: core.ItemIdentifiers.STEW, slot, handled: false,
  });
  assert.ok(event?.handled ?? true);
  await a.playToEnd();
  assert.equal(a.count(core.ItemIdentifiers.STEW), 0);
  assert.ok(said(a, "You give the stew to Oli and he gets it down in a flash."));
  assert.ok(said(a, "Thanks! That sure is tasty!"));
});

test("a part of the valuables with no room for the coins is refused, with nothing lost; all of them frees their slot", async () => {
  const axes = Array.from({ length: 27 }, () => [core.ItemIdentifiers.BRONZE_AXE, 1]);
  const a = actor(ORIANA(), { items: [[VALUABLE(), 10], ...axes], attributes: { [Crew._test.MET_ATTRIBUTE]: true } });
  assert.equal(Crew._test.tradeIn({ player: a.p, npc: a.npc, npcId: a.npc.getContentId(a.p) }), true);
  a.p.getEnteredAmountAction().execute(5);
  await a.playToEnd();
  assert.equal(a.count(VALUABLE()), 10);
  assert.equal(a.count(core.ItemIdentifiers.COINS), 0);
  assert.ok(!said(a, "You hand in"));
  Crew._test.tradeIn({ player: a.p, npc: a.npc, npcId: a.npc.getContentId(a.p) });
  a.p.getEnteredAmountAction().execute(10);
  await a.playToEnd();
  assert.equal(a.count(VALUABLE()), 0);
  assert.equal(a.count(core.ItemIdentifiers.COINS), 550);
});
