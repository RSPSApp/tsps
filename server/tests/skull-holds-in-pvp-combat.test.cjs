// Run after `yarn build`: node --test tests/skull-holds-in-pvp-combat.test.cjs
// Wiki (Skull (status), 9 December 2021): a skull "cannot disappear during PvP combat". The skull counted down to 0
// mid-fight, so a skulled player in a long fight could keep three items when it ran out. Its last tick waits now
// while a player is the target or attacker. Real Players in the Wilderness, the real combat state and skull countdown.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { CombatFactory } = require("../dist/game/content/combat/CombatFactory");
const { SkullType } = require("../dist/game/model/SkullType");

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

let next = 9080;
function pker(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("pk" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3100, 3600, 0));
  t.after(() => p.setRegistered(false));
  return p;
}

test("a skull in its last ticks stays while a player is fighting them, and goes once the fight is over", (t) => {
  const skulled = pker(t);
  const foe = pker(t);
  CombatFactory.skull(skulled, SkullType.WHITE_SKULL, 0);
  skulled.setSkullTimer(3);
  skulled.getCombat().setUnderAttack(foe); // a player is hitting them
  for (let tick = 0; tick < 10; tick++) skulled.processSkullTimer();
  assert.equal(skulled.isSkulled(), true, "still skulled in PvP combat");
  skulled.getCombat().setUnderAttack(null); // the fight is over
  skulled.processSkullTimer();
  assert.equal(skulled.isSkulled(), false, "then it runs out");
});

test("a skull in its last tick stays while a player's first hit is still on its way (#3159 review)", (t) => {
  const skulled = pker(t);
  const foe = pker(t);
  CombatFactory.skull(skulled, SkullType.WHITE_SKULL, 0);
  skulled.setSkullTimer(1);
  // A real melee hit queued four ticks out (a projectile in flight): nobody is their target or attacker until it lands.
  const hit = new core.PendingHit(foe, skulled, core.CombatFactory.MELEE_COMBAT, { delay: 4, rollAccuracy: false });
  skulled.getCombat().getHitQueue().addPendingHit(hit, core.World.getProcessCycle() + 4);
  assert.equal(skulled.getCombat().getAttacker(), null);
  skulled.processSkullTimer();
  assert.equal(skulled.isSkulled(), true, "held while the hit is in flight");
  skulled.getCombat().getHitQueue().clearIncoming();
});

test("out of PvP combat the skull runs out as before", (t) => {
  const skulled = pker(t);
  CombatFactory.skull(skulled, SkullType.WHITE_SKULL, 0);
  skulled.setSkullTimer(2);
  for (let tick = 0; tick < 3; tick++) skulled.processSkullTimer();
  assert.equal(skulled.isSkulled(), false);
});
