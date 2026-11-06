// Run after `yarn build`: node --test tests/skill-guide.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Gamevals } = require("../dist/game/cache/Gamevals");
const SkillGuide = require("../plugins/interface/SkillGuide.plugin");

const { GUIDE_SKILL_BY_STAT, SKILL_GUIDE_V2_INIT } = SkillGuide._test;
const FLOATER_UID = (161 << 16) | 18;
const GUIDE = 860;

let clickHandler;
let claim = () => {};
SkillGuide.register({
  onInterfaceActionClick(handler) {
    clickHandler = handler;
  },
  emitCustomEvent(name, payload) {
    if (name === "skills:stat-clicked") claim(payload);
  },
});

let interfaces;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  interfaces = new Gamevals().allInterfaces();
});

function player() {
  const sent = [];
  const sender = new Proxy({}, { get: (_, method) => (...args) => sent.push([method, ...args]) });
  return { sent, getPacketSender: () => sender };
}

function click(account, groupId, childId, extra = {}) {
  const event = { player: account, groupId, childId, buttonId: (groupId << 16) | childId, action: 2, handled: false, ...extra };
  clickHandler(event);
  return event;
}

/** if_triggeroplocal's encoding of one int: a zigzag varint. */
function triggerInt(value) {
  let zigzag = (value << 1) ^ (value >> 31);
  const bytes = [];
  do {
    bytes.push((zigzag & 0x7f) | (zigzag > 0x7f ? 0x80 : 0));
    zigzag >>>= 7;
  } while (zigzag > 0);
  return Buffer.from(bytes);
}

test("the components are the cache's: the Skills tab's stats and the guide's close, tabs, list, quest and skill links", () => {
  const stats = interfaces.get(320).components;
  const guide = interfaces.get(GUIDE);
  assert.equal(guide.name, "skill_guide_v2");
  assert.deepEqual([4, 7, 17, 18, 21].map((child) => guide.components.get(child)),
    ["close", "tabs", "quest_journal_button_trigger", "skill_guide_button_trigger", "list"]);
  assert.equal(GUIDE_SKILL_BY_STAT.size, 24);
  for (const child of GUIDE_SKILL_BY_STAT.keys()) assert.match(stats.get(child), /^[a-z]+$/, `stats component ${child}`);
  assert.equal(new Set(GUIDE_SKILL_BY_STAT.values()).size, 24, "one guide number per skill");
});

test("View guide opens skill_guide_v2 in the floater with the skill's number, as captured", () => {
  const account = player();
  // Captured numbers: Attack 1, Strength 2, Thieving 10, Sailing 24.
  for (const [child, skill] of [[1, 1], [2, 2], [12, 10], [24, 24]]) {
    account.sent.length = 0;
    assert.equal(click(account, 320, child).handled, true);
    assert.deepEqual(account.sent, [
      ["sendSubInterface", FLOATER_UID, GUIDE, 1],
      ["sendInterfaceFlagsRange", (GUIDE << 16) | 21, -1, -1, 0],
      ["sendInterfaceFlagsRange", (GUIDE << 16) | 7, 0, 200, 1 << 1],
      ["sendInterfaceScript", SKILL_GUIDE_V2_INIT, [skill, 0, 0, 0]],
    ]);
  }
});

test("a click another plugin claims (the PvP level prompt) opens no guide; other options are left alone", (t) => {
  const account = player();
  claim = (offer) => {
    assert.equal(offer.childId, 1);
    offer.handled = true;
  };
  t.after(() => { claim = () => {}; });
  assert.equal(click(account, 320, 1).handled, true);
  assert.deepEqual(account.sent, []);
  claim = () => {};
  assert.equal(click(account, 320, 1, { action: 1 }).handled, false, "option 1 is Toggle XP on some worlds");
  assert.equal(click(account, 320, 25).handled, false);
  assert.deepEqual(account.sent, []);
});

test("the guide's skill link reopens it on that skill, and its close button closes it", () => {
  const account = player();
  assert.equal(click(account, GUIDE, 18, { scriptTrigger: true, argsData: triggerInt(21) }).handled, true);
  assert.deepEqual(account.sent.at(-1), ["sendInterfaceScript", SKILL_GUIDE_V2_INIT, [21, 0, 0, 0]]);
  account.sent.length = 0;
  assert.equal(click(account, GUIDE, 18, { scriptTrigger: true, argsData: triggerInt(99) }).handled, false, "not a guide skill");
  assert.equal(click(account, GUIDE, 18).handled, false, "only the script trigger");
  assert.deepEqual(account.sent, []);
  assert.equal(click(account, GUIDE, 4, { action: 1 }).handled, true);
  assert.deepEqual(account.sent, [["closeInterface", GUIDE]]);
});

/** A real player whose packet sender records what opens and what closes. */
function questPlayer(t, stage) {
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const { PlayerSession } = require("../dist/net/PlayerSession");
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const account = new Player(new PlayerSession(channel));
  account.setUsername("skillguidequest");
  account.setAttribute("quest.pirates_treasure.stage", stage);
  const sender = account.getPacketSender();
  const sent = [];
  for (const method of ["sendSubInterface", "closeInterface", "sendConfig"]) {
    const original = sender[method].bind(sender);
    t.mock.method(sender, method, (...args) => { sent.push([method, ...args]); return original(...args); });
  }
  return { account, sent };
}

test("View-journal on a Quest XP row closes the guide and opens that quest's journal, as the quest list does", (t) => {
  const { PluginManager } = require("../dist/plugins/PluginManager");
  const { questRowById } = require("../plugins/quests/QuestList.QuestRuntime");
  require("../plugins/quests/quests/PiratesTreasure.Quest")(PluginManager.createApi("SkillGuideQuestTest"));
  const cache = PluginManager.getCoreApi().CacheDefinitions;
  const rowNamed = (name) => [...require("../plugins/quests/QuestList.QuestRuntime").metadata(cache).values()].find((row) => row.displayname?.[0] === name);
  const pirates = rowNamed("Pirate's Treasure");
  const cooks = rowNamed("Cook's Assistant");
  const waterfall = rowNamed("Waterfall Quest");
  assert.equal(pirates.id[0], 16);
  assert.equal(questRowById(pirates.id[0], cache), pirates, "the trigger int is the quest table's id column");
  const LATEST_QUEST_JOURNAL = 3679;

  for (const [stage, group] of [[1, 119], [0, 782]]) {
    const { account, sent } = questPlayer(t, stage);
    account.getPacketSender().sendSubInterface(FLOATER_UID, GUIDE, 1);
    sent.length = 0;
    assert.equal(click(account, GUIDE, 17, { scriptTrigger: true, argsData: triggerInt(pirates.id[0]) }).handled, true);
    assert.deepEqual(sent[0], ["closeInterface", GUIDE], "the guide closes first");
    assert.deepEqual(sent.find(([method, id]) => method === "sendConfig" && id === LATEST_QUEST_JOURNAL), ["sendConfig", LATEST_QUEST_JOURNAL, pirates.rowId]);
    assert.deepEqual(sent.filter(([method]) => method === "sendSubInterface").map((args) => args.slice(1, 3)), [[FLOATER_UID, group]],
      stage ? "a started quest opens its journal" : "a quest not started opens its overview");
    assert.equal(account.getAttribute("quest.pirates_treasure.stage"), stage, "viewing changes no progress");
  }

  // A quest tsps doesn't define but has start text for opens its overview, as in the quest list.
  const cooksPlayer = questPlayer(t, 0);
  assert.equal(click(cooksPlayer.account, GUIDE, 17, { scriptTrigger: true, argsData: triggerInt(cooks.id[0]) }).handled, true);
  assert.deepEqual(cooksPlayer.sent.filter(([method]) => method === "sendSubInterface").map((args) => args[2]), [782]);

  // Nothing to open (no quest, no start text, an id no quest has, a plain click): the guide stays.
  const { account, sent } = questPlayer(t, 0);
  for (const extra of [
    { scriptTrigger: true, argsData: triggerInt(waterfall.id[0]) },
    { scriptTrigger: true, argsData: triggerInt(65000) },
    { scriptTrigger: true },
    { action: 1 },
  ]) assert.equal(click(account, GUIDE, 17, extra).handled, false);
  assert.deepEqual(sent, []);
});
