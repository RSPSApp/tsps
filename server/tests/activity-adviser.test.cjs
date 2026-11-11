// Run after `yarn build`: node --test tests/activity-adviser.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");

require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Gamevals } = require("../dist/game/cache/Gamevals");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const QuestRuntime = require("../plugins/quests/QuestRuntime");
const ActivityAdviser = require("../plugins/interface/ActivityAdviser.plugin");

const { classify, suggestions, serialise, onInterfaceClick, replaced, FLOATER_UID, CR_UI, ORB_BUTTONS } = ActivityAdviser._test;
const COOKS_ASSISTANT = 1;
const DRAGON_SLAYER_I = 17;
const PLAGUE_CITY = 36;
const BIOHAZARD = 39;
const KIND_TARGET = 2;

let core;
let gamevals;
let next = 5200;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  gamevals = new Gamevals();
});

function player() {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("adviser" + p.getIndex());
  const real = p.getPacketSender();
  const sent = [];
  const recorded = new Set(["sendSubInterface", "closeSubInterface", "sendInterfaceFlagsRange", "sendInterfaceScript", "sendVarbit"]);
  const sender = new Proxy(real, {
    get(target, method) {
      const value = target[method];
      if (typeof value !== "function") return value;
      return (...args) => {
        if (recorded.has(method)) sent.push([method, ...args]);
        const result = value.apply(target, args);
        return result === target ? sender : result;
      };
    },
  });
  p.getPacketSender = () => sender;
  return { p, sent };
}

function click(p, groupId, childId, slot = -1) {
  const event = { player: p, groupId, childId, slot, buttonId: (groupId << 16) | childId, action: 1, handled: false };
  onInterfaceClick(event);
  return event;
}

/** Script 2493's string back as rows, the way scripts 1453/1451/1442 read it. */
function parse(text) {
  const [count, rows, columns, ...cells] = text.split("||").map(Number);
  assert.equal(count, cells.length + 2);
  assert.equal(cells.length, rows * columns);
  return Array.from({ length: rows }, (_, row) => cells.slice(row * columns, row * columns + columns));
}

test("the components are the cache's", () => {
  const names = (uids) => [...uids].map((uid) => gamevals.componentName(uid));
  assert.deepEqual(names(ORB_BUTTONS), ["orbs:cr_button", "orbs_nomap:cr_button", "orbs_osm:cr_button", "orbs_osm_nomap:cr_button"]);
  assert.equal(gamevals.componentName(FLOATER_UID), "toplevel_osrs_stretch:floater");
  assert.deepEqual([4, 14, 15, 18].map((child) => gamevals.componentName((CR_UI << 16) | child)),
    ["cr_ui:btn_close", "cr_ui:quests_members_tabs", "cr_ui:quests_refresh_button", "cr_ui:quests_journal_buttons"]);
});

test("the list is script 2493's serialised table: cell count, rows, five columns", () => {
  assert.equal(serialise([[1, 7, 4], [2, 17, 1]]), "12||2||5||1||7||4||0||0||2||17||1||0||0");
  assert.equal(serialise([]), "2||0||5");
});

test("a new account is offered Cook's Assistant and works towards Dragon Slayer I", () => {
  const { p } = player();
  const rows = suggestions(p);
  assert.ok(rows.length > 0);
  const cooks = rows.find(([, id]) => id === COOKS_ASSISTANT);
  assert.ok(cooks, "Cook's Assistant is suggested");
  assert.notEqual(cooks[0], KIND_TARGET);
  const dragonSlayer = rows.find(([, id]) => id === DRAGON_SLAYER_I);
  if (dragonSlayer) assert.equal(dragonSlayer[0], KIND_TARGET, "32 quest points are needed first");
  for (const [kind, id] of rows) {
    assert.ok(QuestRuntime.hasQuestJournal(id), `quest ${id} has a journal`);
    assert.ok(kind === 1 || kind === KIND_TARGET);
  }
});

test("a started quest comes first and a finished one drops out", () => {
  const { p } = player();
  const cooks = QuestRuntime.questNamed("Cook's Assistant");
  cooks.setStage(p, 1);
  QuestRuntime.sendQuestVarps({ player: p });
  assert.deepEqual(suggestions(p)[0], [1, COOKS_ASSISTANT, 4]);
  cooks.setStage(p, cooks.completionValue ?? 2);
  QuestRuntime.sendQuestVarps({ player: p });
  assert.equal(suggestions(p).some(([, id]) => id === COOKS_ASSISTANT), false);
});

test("the Free Quests Only tab leaves out members quests", () => {
  const { p } = player();
  p.setAttribute("activity-adviser:include-members", false);
  const rows = new Map([...core.CacheDefinitions.getDbTableRows(0)].map((row) => [row.column(0)?.[0], row.column(5)?.[0]]));
  for (const [, id] of suggestions(p)) assert.notEqual(rows.get(id), 1, `quest ${id} is free`);
});

test("the minimap button opens the Adviser in the floater and closes it again", () => {
  const { p, sent } = player();
  assert.equal(click(p, 160, 4).handled, true);
  assert.deepEqual(sent[0], ["sendSubInterface", FLOATER_UID, CR_UI, 1]);
  assert.ok(sent.some(([method, uid, from, to]) => method === "sendInterfaceFlagsRange" && uid === ((CR_UI << 16) | 14) && from === 0 && to === 1));
  const script = sent.find(([method, id]) => method === "sendInterfaceScript" && id === 2493);
  assert.ok(script);
  assert.ok(parse(script[2][0]).length > 0);
  sent.length = 0;
  assert.equal(click(p, 160, 4).handled, true);
  assert.deepEqual(sent, [["closeSubInterface", FLOATER_UID], ["sendInterfaceScript", 6378]]);
});

test("Close, the tabs, Refresh and View journal answer while the Adviser is open", () => {
  const { p, sent } = player();
  assert.equal(click(p, CR_UI, 4).handled, false, "nothing to close yet");
  click(p, 160, 4);
  sent.length = 0;
  assert.equal(click(p, CR_UI, 14, 1).handled, true);
  assert.deepEqual(sent.find(([method, id]) => method === "sendVarbit" && id === 5367), ["sendVarbit", 5367, 0]);
  assert.ok(sent.some(([method, id]) => method === "sendInterfaceScript" && id === 2493));
  sent.length = 0;
  assert.equal(click(p, CR_UI, 15, 0).handled, true);
  assert.ok(sent.some(([method, id]) => method === "sendInterfaceScript" && id === 2493));
  sent.length = 0;
  assert.equal(click(p, CR_UI, 4).handled, true);
  assert.deepEqual(sent, [["closeSubInterface", FLOATER_UID], ["sendInterfaceScript", 6378]]);
});

test("View journal opens the quest's journal in the Adviser's place", () => {
  const { p, sent } = player();
  click(p, 160, 4);
  sent.length = 0;
  assert.equal(click(p, CR_UI, 18, COOKS_ASSISTANT).handled, true);
  assert.ok(sent.some(([method, target, group]) => method === "sendSubInterface" && target === FLOATER_UID && group !== CR_UI), "the journal opens in the floater");
  assert.ok(sent.some(([method, id]) => method === "sendInterfaceScript" && id === 6378), "the Adviser is marked closed");
  assert.equal(p.getPacketSender().isSubInterfaceOpen(CR_UI), false);
});

test("another floater interface taking the Adviser's place marks it closed once", () => {
  const { p, sent } = player();
  click(p, 160, 4);
  sent.length = 0;
  replaced({ player: p, groupId: 621, targetUid: FLOATER_UID });
  replaced({ player: p, groupId: 621, targetUid: FLOATER_UID });
  assert.deepEqual(sent, [["sendInterfaceScript", 6378]]);
});

function complete(p, name) {
  const quest = QuestRuntime.questNamed(name);
  quest.setStage(p, quest.completionValue ?? 2);
}

/** The rows of the last list sent to script 2493. */
function lastList(sent) {
  const scripts = sent.filter(([method, id]) => method === "sendInterfaceScript" && id === 2493);
  return parse(scripts[scripts.length - 1][2][0]);
}

test("finishing a quest's required quest offers it: Plague City opens up Biohazard", () => {
  const { p } = player();
  const ids = (entries) => entries.map(({ row }) => row.id[0]);
  let { available, targets } = classify(p);
  assert.ok(ids(available).includes(PLAGUE_CITY));
  assert.equal(ids(available).includes(BIOHAZARD), false, "Plague City comes first");
  assert.equal(ids(targets).includes(BIOHAZARD), false);
  complete(p, "Plague City");
  ({ available, targets } = classify(p));
  assert.ok(ids(available).includes(BIOHAZARD), "Biohazard can be started now");
  assert.equal(ids(available).includes(PLAGUE_CITY), false, "a finished quest is not offered");
  assert.equal(ids(targets).includes(PLAGUE_CITY), false);
});

test("Refresh after finishing a quest sends a list without it", () => {
  const { p, sent } = player();
  click(p, 160, 4);
  assert.ok(lastList(sent).some(([, id]) => id === COOKS_ASSISTANT), "Cook's Assistant is listed at first");
  complete(p, "Cook's Assistant");
  sent.length = 0;
  assert.equal(click(p, CR_UI, 15, 0).handled, true);
  const rows = lastList(sent);
  assert.ok(rows.length > 0);
  assert.equal(rows.some(([, id]) => id === COOKS_ASSISTANT), false, "the finished quest's row is gone");
  click(p, 160, 4);
  sent.length = 0;
  click(p, 160, 4);
  assert.equal(lastList(sent).some(([, id]) => id === COOKS_ASSISTANT), false, "and stays gone when reopened");
});
