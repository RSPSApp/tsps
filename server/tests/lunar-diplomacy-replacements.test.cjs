// Run after `yarn build`: node --test tests/lunar-diplomacy-replacements.test.cjs
// Lunar Diplomacy, from the ceremony (stage 155) on: the Oneiromancer's "I've lost my Lunar helm" replaces a
// piece that is truly lost. One still worn or in the bank is not lost, so it is neither offered nor replaced.
// Real engine: every plugin loaded, a real Player, the quest's real dialogue condition (8CB0D5) and the
// replacement action (rSaPSD) as the npc-dialogue page raises them.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

const LUNAR_HELM = 9096;
const ONEIROMANCER = 3835;
const KINDLING_STAGE = 155;
const ALL_GIVEN = { helm: true, torso: true, trousers: true, gloves: true, boots: true, cape: true, amulet: true, ring: true };
let core;
let quest;
let next = 9740;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  quest = require("../plugins/quests/QuestRuntime").getRegisteredQuests().find((entry) => entry.key === "lunar_diplomacy");
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("lunar" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(2077, 3913, 0));
  p.needsPlacement = false;
  t.after(() => p.setRegistered(false));
  quest.setStage(p, KINDLING_STAGE);
  p.setAttribute("quest.lunar_diplomacy.oneiro-given", { ...ALL_GIVEN });
  return p;
}

const offered = (p) => PM.emitNpcDialogueCondition({ player: p, npcId: ONEIROMANCER, stepId: "8CB0D5", pages: [] });
const claim = (p) => PM.emitCustomEvent("npc-dialogue:action", { player: p, npcId: ONEIROMANCER, stepId: "rSaPSD", pages: [], handled: false });
const helms = (p) => p.getInventory().getAmount(LUNAR_HELM);

test("a worn Lunar helm is not lost: no offer and no replacement", (t) => {
  const p = actor(t);
  p.getEquipment().setItem(core.Equipment.HEAD_SLOT, new core.Item(LUNAR_HELM, 1));
  assert.equal(offered(p), false);
  claim(p);
  assert.equal(helms(p), 0);
});

test("a banked Lunar helm is not lost: no offer and no replacement", (t) => {
  const p = actor(t);
  p.getBank(0).add(new core.Item(LUNAR_HELM, 1), false);
  assert.equal(offered(p), false);
  claim(p);
  assert.equal(helms(p), 0);
});

test("a truly lost Lunar helm is offered and replaced once", (t) => {
  const p = actor(t);
  assert.equal(offered(p), true);
  claim(p);
  assert.equal(helms(p), 1);
  assert.equal(offered(p), false, "carried again");
  claim(p);
  assert.equal(helms(p), 1, "a second claim gives nothing");
});
