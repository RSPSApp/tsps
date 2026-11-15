// Run after `yarn build`: node --test tests/league-sage-reclaim.test.cjs
// #5586 sub-item: Raging Echoes' tutor, the Sage (cache NPC 14144, Wiki 'The Sage (Raging Echoes League)'), gives back
// the items a character's relics hand out. Real engine: every plugin loaded, a league-5 character, the Talk-to
// interaction through PluginManager.emitNpcInteraction, the Sage's menu through the dialogue manager.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core, next = 9990;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const data = require("../plugins/modes/data/league-relics.json");
const Unlock = require("../plugins/modes/leaguerelics/Unlock.LeagueRelics");
const Common = require("../plugins/modes/leaguerelics/Common.LeagueRelics");
const SageRelics = require("../plugins/modes/leaguerelics/Sage.LeagueRelics");

const SAGE = 14144;
const ASK = "Do I have any League items to collect?";
const L5 = data.leagues["5"];

function leaguer(t, type = 5) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("sage" + p.getIndex()); p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setProfile("league");
  p.setAttribute("league:type", type);
  p.setLocation(new core.Location(3222, 3218, 0)); p.needsPlacement = false;
  const messages = [];
  p.sendMessage = (m) => { messages.push(m); };
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  PM.emitCustomEvent("league:award-task", { player: p, id: "sage", points: 1_000_000, name: "sage" });
  return { p, messages };
}
const count = (p, id) => p.getInventory().getAmount(id);
const unlockKey = (p, key) => {
  L5.tiers.forEach((tier, ti) => tier.relics.forEach((relic, si) => {
    if (relic.key === key) assert.equal(Unlock.unlock(p, ti, si + 1, { bankOpen: true }), true, `unlock ${key}`);
  }));
};
const talk = (p) => {
  const npc = new core.NPC(SAGE, new core.Location(3223, 3214, 0));
  const event = { player: p, npc, npcId: SAGE, action: "Talk-to", clickType: 1, handled: false };
  PM.emitNpcInteraction(event);
  return event;
};
const choose = (p, n) => p.getDialogueManager().handleResume(core.OptionDialogue.OPTIONS_WIDGET_ID, n);

test("Talk-to the Sage offers the collect question; a lost relic item comes back once", (t) => {
  const { p } = leaguer(t);
  unlockKey(p, "power-miner");
  assert.equal(count(p, 25112), 1, "the pick delivered the Echo pickaxe");
  p.getInventory().delete(25112, 1); // lost
  assert.equal(count(p, 25112), 0);

  assert.equal(talk(p).handled, true);
  const menu = p.getDialogueManager().getCurrent();
  assert.ok(menu instanceof core.OptionDialogue);
  assert.equal(menu.getOptions()[0], ASK);
  choose(p, 1);
  assert.equal(count(p, 25112), 1, "handed back");

  talk(p); choose(p, 1);
  assert.equal(count(p, 25112), 1, "nothing twice");
  assert.equal(p.getDialogueManager().getCurrent().getText(), "You have no League items to collect.");
});

test("an item still owned, carried or banked is not handed over again", (t) => {
  const { p } = leaguer(t);
  unlockKey(p, "lumberjack");
  talk(p); choose(p, 1);
  assert.equal(count(p, 25110), 1, "carried: nothing more");
  p.getInventory().delete(25110, 1);
  p.getBank(0).add(new core.Item(25110, 1), false);
  talk(p); choose(p, 1);
  assert.equal(count(p, 25110), 0, "banked: owned");
});

test("a relic the character did not take owes nothing", (t) => {
  const { p } = leaguer(t);
  unlockKey(p, "lumberjack");
  p.getInventory().delete(25110, 1);
  talk(p); choose(p, 1);
  assert.equal(count(p, 25110), 1);
  assert.equal(count(p, 25112), 0, "Power Miner was never chosen (the same tier)");
  assert.equal(count(p, 25114), 0, "nor Animal Wrangler");
});

test("a full inventory takes what fits and says so", (t) => {
  const { p } = leaguer(t);
  unlockKey(p, "lumberjack");
  p.getInventory().delete(25110, 1);
  while (p.getInventory().getFreeSlots() > 0) p.getInventory().add(new core.Item(1265, 1));
  assert.equal(p.getInventory().getFreeSlots(), 0);
  talk(p); choose(p, 1);
  assert.equal(count(p, 25110), 0);
  assert.match(p.getDialogueManager().getCurrent().getText(), /enough inventory space/);
});

test("the other choice plays the Sage's own transcript", (t) => {
  const { p } = leaguer(t);
  talk(p);
  assert.deepEqual(p.getDialogueManager().getCurrent().getOptions(), [ASK, "Talk."]);
  choose(p, 2);
  assert.match(String(p.getDialogueManager().getCurrent()?.getText?.() ?? ""), /Can you hear me up there/);
});

test("off league 5 the Sage is not touched: no menu, no hand-out", (t) => {
  const { p } = leaguer(t, 4);
  assert.equal(Common.leagueOf(p), 4);
  const npc = new core.NPC(SAGE, new core.Location(3223, 3214, 0));
  const event = { player: p, npc, npcId: SAGE, action: "Talk-to", clickType: 1, handled: false };
  PM.emitNpcInteraction(event);
  const current = p.getDialogueManager().getCurrent();
  assert.ok(!(current instanceof core.OptionDialogue), "the transcript plays straight away");
  assert.match(String(current?.getText?.() ?? ""), /Can you hear me up there/);
});

test("the Sage spawns only on a world running league 5, at the Wiki's tile", () => {
  const spawned = [];
  const real = { spawnNpc: Common.api.spawnNpc, getPluginConfig: Common.api.getPluginConfig };
  try {
    Common.api.spawnNpc = (npc) => spawned.push(npc);
    for (const world of [0, 4, 6]) { Common.api.getPluginConfig = () => world; SageRelics.spawn(); }
    assert.deepEqual(spawned, []);
    Common.api.getPluginConfig = () => 5; SageRelics.spawn();
    assert.deepEqual(spawned, [{ id: 14144, x: 3223, y: 3214, z: 0, wanderRadius: 0 }]);
  } finally { Object.assign(Common.api, real); }
});
