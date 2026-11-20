// Run after `yarn build`: node --test tests/in-aid-of-the-myreque-state.test.cjs
//
// In Aid of the Myreque's state (plugins/quests/inaid/State.InAidOfTheMyreque.js): live's varbit 1990
// stages and the quest varbits the cache's multilocs read, saved per player and sent again at login.
// A save from before the capture alignment moves onto live's stages once; a stage set from outside
// the quest (the ::quest command) brings the varbits to what live had by then. Real plugins and Player.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ObjectDefinition } = require("../dist/game/definition/ObjectDefinition");
const { getRegisteredQuests } = require("../plugins/quests/QuestRuntime");
const { VARBIT, impliedVarbits, VARS_ATTRIBUTE, SAVE_VERSION_ATTRIBUTE } = require("../plugins/quests/inaid/State.InAidOfTheMyreque");

const STAGE_ATTRIBUTE = "quest.in_aid_of_the_myreque.stage";
const ROOF_MULTILOC = 12751; // burgh_store_roof multiloc: 12782 broken, 12783 repaired
let core;
let index = 7900;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  ObjectDefinition.init();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const quest = () => getRegisteredQuests().filter((entry) => entry.key === "in_aid_of_the_myreque").at(-1);

function player(t, name) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(index++);
  p.setUsername(name);
  p.setRegistered(true);
  p.setLocation(new core.Location(3515, 3240, 0));
  p.needsPlacement = false;
  const sent = new Map();
  const sender = p.getPacketSender();
  const original = sender.sendVarbit.bind(sender);
  sender.sendVarbit = (id, value) => { sent.set(id, value); return original(id, value); };
  t.after(() => { PM.emitPlayerLogout({ player: p, username: p.getUsername() }); p.setRegistered(false); });
  return { p, sent };
}

const login = (p) => PM.emitPlayerLogin({ player: p, username: p.getUsername() });

test("an old completed save (stage 420) logs in complete at live's 430, with the rod hand-in's varbit", (t) => {
  const { p, sent } = player(t, "inaidold420");
  p.setAttribute(STAGE_ATTRIBUTE, 420);
  login(p);
  assert.equal(quest().getStage(p), 430);
  assert.equal(quest().isComplete(p), true);
  assert.equal(sent.get(VARBIT.QUEST), 430);
  assert.equal(sent.get(VARBIT.TEMPLE_TREK_NPCS), 1);
  assert.equal(sent.get(VARBIT.STORE_ROOF), 1, "the repaired roof is the player's again");
  assert.equal(ObjectDefinition.forPlayer(ROOF_MULTILOC, p)?.id, 12783);
  assert.equal(p.getAttribute(SAVE_VERSION_ATTRIBUTE), 2);
});

test("old mid-quest saves map onto live's stages: fuelled furnace, crate counts and Ivan's armour", (t) => {
  const furnace = player(t, "inaidold210");
  furnace.p.setAttribute(STAGE_ATTRIBUTE, 210); // old "furnace fuelled"
  login(furnace.p);
  assert.equal(quest().getStage(furnace.p), 210);
  assert.equal(furnace.sent.get(VARBIT.FURNACE), 2);

  const crate = player(t, "inaidold165");
  crate.p.setAttribute(STAGE_ATTRIBUTE, 165);
  crate.p.setAttribute("quest.in_aid_of_the_myreque.crate.axes", 4);
  crate.p.setAttribute("quest.in_aid_of_the_myreque.crate.tinder", 3);
  login(crate.p);
  assert.equal(crate.sent.get(VARBIT.CRATE_AXES), 4);
  assert.equal(crate.sent.get(VARBIT.CRATE_TINDERBOXES), 3);
  assert.equal(crate.p.getAttribute("quest.in_aid_of_the_myreque.crate.axes"), 0, "the old attribute is cleared");

  const ivan = player(t, "inaidold300");
  ivan.p.setAttribute(STAGE_ATTRIBUTE, 300); // old hideout talk, members told
  ivan.p.setAttribute("quest.in_aid_of_the_myreque.bits", (1 << 5) | (1 << 6) | (1 << 9));
  login(ivan.p);
  assert.equal(quest().getStage(ivan.p), 300);
  assert.equal(ivan.sent.get(VARBIT.IVAN_HELM), 1);
  assert.equal(ivan.sent.get(VARBIT.IVAN_SICKLE), 1);
  assert.equal(ivan.sent.has(VARBIT.IVAN_BODY), false);
});

test("a saved new-format player is not migrated again", (t) => {
  const { p } = player(t, "inaidnew");
  p.setAttribute(STAGE_ATTRIBUTE, 60); // live's 60, not the old plugin's 60
  p.setAttribute(SAVE_VERSION_ATTRIBUTE, 2);
  login(p);
  assert.equal(quest().getStage(p), 60);
});

test("a stage set from outside (::quest) brings the varbits to that stage, both ways", (t) => {
  const { p, sent } = player(t, "inaidjump");
  quest().setStage(p, 165);
  assert.deepEqual(p.getAttribute(VARS_ATTRIBUTE), impliedVarbits(165));
  assert.equal(sent.get(VARBIT.STORE_WALL), 1);
  assert.equal(ObjectDefinition.forPlayer(ROOF_MULTILOC, p)?.id, 12783);
  quest().setStage(p, 60);
  assert.equal(sent.get(VARBIT.STORE_WALL), 0, "a jump back clears what the earlier stage had not set");
  assert.equal(ObjectDefinition.forPlayer(ROOF_MULTILOC, p)?.id, 12782);
});
