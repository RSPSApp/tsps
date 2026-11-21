// Run after `yarn build`: node --test tests/skill-guide.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Gamevals } = require("../dist/game/cache/Gamevals");
const SkillGuide = require("../plugins/interface/SkillGuide.plugin");

const { GUIDE_SKILL_BY_STAT, SKILL_GUIDE_V2_INIT, SKILL_GUIDE_CONTENT_INIT } = SkillGuide._test;
const FLOATER_UID = (161 << 16) | 18;
const GUIDE = 860;
const OLD_GUIDE = 214;
const NEW_STYLE_VARBIT = 15321;

const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { Skill } = require("../dist/game/model/Skill");

let clickHandler;
let levelUpAnnounced;
let claim = () => {};
SkillGuide.register({
  core: { CacheDefinitions, Skill },
  onInterfaceActionClick(handler) {
    clickHandler = handler;
  },
  onCustomEvent(name, handler) {
    if (name === "level-up:announced") levelUpAnnounced = handler;
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

/** A player whose sent packets are recorded; the new-style guide row is on unless `newStyle` is 0. */
function player(newStyle = 1) {
  const sent = [];
  const sender = new Proxy({}, {
    get: (_, method) => method === "getVarbit"
      ? (id) => (id === NEW_STYLE_VARBIT ? newStyle : 0)
      : (...args) => sent.push([method, ...args]),
  });
  return { sent, getPacketSender: () => sender };
}

/** A player whose varbits are kept and whose sends are recorded, at the given levels. */
function levelledPlayer(levels = {}) {
  const sent = [];
  const values = new Map([[NEW_STYLE_VARBIT, 1]]);
  const sender = new Proxy({}, {
    get: (_, method) => {
      if (method === "getVarbit") return (id) => values.get(id) ?? 0;
      return (...args) => {
        if (method === "sendVarbit") values.set(args[0], args[1]);
        sent.push([method, ...args]);
      };
    },
  });
  const skills = { getMaxLevel: (skill) => levels[skill.getName()] ?? 1 };
  return { sent, values, getPacketSender: () => sender, getSkillManager: () => skills };
}

function levelUp(account, skillName, oldLevel, newLevel) {
  const skill = Skill.VALUES.find((stat) => stat.getName() === skillName);
  levelUpAnnounced({ player: account, skill, oldLevel, newLevel });
}

const varbit = (name) => CacheDefinitions.getVarbitId(name);
const FLASHSIDE = 3756; // flashside, as captured

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

test("with the new-style guide row off, View guide opens the old skill_guide with the same skill number, as captured", () => {
  const old = interfaces.get(OLD_GUIDE);
  assert.equal(old.name, "skill_guide");
  assert.deepEqual([30, 32].map((child) => old.components.get(child)), ["close", "icons"]);
  const account = player(0);
  // Captured: Farming 21, Magic 4, Construction 22.
  for (const [child, skill] of [[23, 21], [6, 4], [8, 22]]) {
    account.sent.length = 0;
    assert.equal(click(account, 320, child).handled, true);
    assert.deepEqual(account.sent, [
      ["sendSubInterface", FLOATER_UID, OLD_GUIDE, 1],
      ["sendInterfaceScript", SKILL_GUIDE_CONTENT_INIT, [skill, 0, 0, 0]],
      ["sendInterfaceFlagsRange", (OLD_GUIDE << 16) | 32, -1, -1, 0],
    ]);
  }
  account.sent.length = 0;
  assert.equal(click(account, OLD_GUIDE, 30, { action: 1 }).handled, true);
  assert.deepEqual(account.sent, [["closeInterface", OLD_GUIDE]]);
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

test("every stat's levelup_list varbit is in the cache, and every server skill has one", () => {
  const { LEVELUP_LIST_BY_STAT } = SkillGuide._test;
  assert.deepEqual([...LEVELUP_LIST_BY_STAT.keys()], [...GUIDE_SKILL_BY_STAT.keys()]);
  const stats = interfaces.get(320).components;
  for (const [child, name] of LEVELUP_LIST_BY_STAT) {
    assert.ok(Number.isInteger(varbit(`levelup_list_${name}`)), name);
    // The stat components carry the same names, but Runecraft's is "runecrafting".
    assert.equal(stats.get(child).replace(/^runecrafting$/, "runecraft"), name);
  }
  assert.equal(CacheDefinitions.getVarbitId("flashside"), FLASHSIDE);
  // Captured ids: farming 20179, woodcutting 20169, crafting 20177.
  assert.deepEqual(["farming", "woodcutting", "crafting"].map((name) => varbit(`levelup_list_${name}`)), [20179, 20169, 20177]);
  const account = levelledPlayer();
  for (const skill of Skill.VALUES) {
    account.values.clear();
    levelUpAnnounced({ player: account, skill, oldLevel: 4, newLevel: 5 });
    assert.equal([...account.values.values()].filter((value) => value === 5).length, 1, skill.getName());
  }
});

test("a level-up sets the skill's levelup_list to the first new level and flashes the Skills tab, as captured", () => {
  const account = levelledPlayer();
  // rsprox 1001453 t3791 (rev 241): Woodcutting 40 -> 41 sets levelup_list_woodcutting 41, then flashside 2.
  levelUp(account, "Woodcutting", 40, 41);
  assert.deepEqual(account.sent, [["sendVarbit", 20169, 41], ["sendVarbit", FLASHSIDE, 2]]);
  // A second level before the guide is viewed keeps the first (no capture changes a set value).
  account.sent.length = 0;
  levelUp(account, "Woodcutting", 41, 42);
  assert.deepEqual(account.sent, []);
  // Another skill gets its own, with the tab already flashing.
  levelUp(account, "Cooking", 14, 15);
  assert.deepEqual(account.sent, [["sendVarbit", varbit("levelup_list_cooking"), 15]]);
});

test("View guide with a level-up waiting clears it and highlights from that level to the current one, as captured", () => {
  // rsprox 1001445 t869 (rev 241): Farming 1 -> 9 left levelup_list_farming 2; View guide cleared it
  // and ran skill_guide_v2_init [21, 31, 2, 9].
  const account = levelledPlayer({ Farming: 9 });
  levelUp(account, "Farming", 1, 9);
  account.sent.length = 0;
  assert.equal(click(account, 320, 23).handled, true);
  assert.deepEqual(account.sent, [
    ["sendVarbit", 20179, 0],
    ["sendSubInterface", FLOATER_UID, GUIDE, 1],
    ["sendInterfaceFlagsRange", (GUIDE << 16) | 21, -1, -1, 0],
    ["sendInterfaceFlagsRange", (GUIDE << 16) | 7, 0, 200, 1 << 1],
    ["sendInterfaceScript", SKILL_GUIDE_V2_INIT, [21, 31, 2, 9]],
  ]);
  // Viewed: the next look highlights nothing.
  account.sent.length = 0;
  click(account, 320, 23);
  assert.deepEqual(account.sent.at(-1), ["sendInterfaceScript", SKILL_GUIDE_V2_INIT, [21, 0, 0, 0]]);
  // Another skill's waiting level stays until its own guide is viewed.
  levelUp(account, "Crafting", 8, 9);
  click(account, 320, 23);
  assert.equal(account.values.get(20177), 9);
});

test("clicking the Skills tab stops its flash on every gameframe; other tabs and flashes are left alone", () => {
  const account = levelledPlayer();
  for (const [root, child] of [[161, 60], [548, 65], [164, 53]]) {
    levelUp(account, "Attack", 1, 2);
    account.values.set(varbit("levelup_list_attack"), 0);
    assert.equal(account.values.get(FLASHSIDE), 2);
    click(account, root, child - 1, { action: 1 });
    assert.equal(account.values.get(FLASHSIDE), 2, "the Combat tab");
    click(account, root, child, { action: 1 });
    assert.equal(account.values.get(FLASHSIDE), 0, `stone1 on ${root}`);
  }
  // A tutorial pointing at another tab keeps its flash through a level-up and a Skills click.
  account.values.set(FLASHSIDE, 4);
  levelUp(account, "Attack", 2, 3);
  click(account, 161, 60, { action: 1 });
  assert.equal(account.values.get(FLASHSIDE), 4);
});
