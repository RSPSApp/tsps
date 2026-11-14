// Run after `yarn build`: node --test tests/wilderness-boss-scripted-hits.test.cjs
// Common.bossHit lands damage its caller already weighed against prayer (Callisto's melee halved by
// Protect from Melee, Venenatis' shots through prayer while spiderlings live, Vet'ion's bolts and bash,
// which prayer does not stop). The engine must not apply the protection prayer a second time when the
// hit is queued or read in the victim's turn (CombatFactory.applyProtectionPrayer). Real Player, real NPC.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { NPC } = require("../dist/game/entity/impl/npc/NPC");
const { CombatFactory } = require("../dist/game/content/combat/CombatFactory");
const { CombatType } = require("../dist/game/content/combat/CombatType");
const { PrayerHandler } = require("../dist/game/content/PrayerHandler");
const Common = require("../plugins/bosses/wildernessbosses/Common.WildernessBosses");
const Bears = require("../plugins/bosses/wildernessbosses/Bears.WildernessBosses");

const core = PluginManager.getCoreApi();
Common.attach(new Proxy({ core }, { get: (target, name) => (name in target ? target[name] : () => {}) }));

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
});

function prayingPlayer(t, prayer) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(9740);
  player.setUsername("wildboss");
  player.setRegistered(true);
  player.setLocation(new core.Location(3358, 10335, 0));
  player.needsPlacement = false;
  t.after(() => player.setRegistered(false));
  for (const skill of [core.Skill.PRAYER, core.Skill.HITPOINTS]) {
    player.getSkillManager().setMaxLevels(skill, 99, false).setCurrentLevels(skill, 99, false);
  }
  PrayerHandler.activatePrayerPrayerId(player, PrayerHandler[prayer]);
  assert.ok(PrayerHandler.isActivated(player, PrayerHandler[prayer]));
  return player;
}

for (const [type, prayer] of [[CombatType.MELEE, "PROTECT_FROM_MELEE"], [CombatType.RANGED, "PROTECT_FROM_MISSILES"], [CombatType.MAGIC, "PROTECT_FROM_MAGIC"]]) {
  test(`a boss's scripted blow lands as weighed through ${prayer}, not cut again`, (t) => {
    const queued = [];
    t.mock.method(CombatFactory, "addPendingHit", (hit) => queued.push(hit));
    const player = prayingPlayer(t, prayer);
    const callisto = new NPC(Number(Object.keys(Bears._test.BEARS)[0]), new core.Location(3360, 10335, 0));
    const method = new (class extends core.CombatMethod { type() { return type; } })();
    Common.bossHit(callisto, method, player, 20);
    assert.equal(queued.length, 1);
    const [hit] = queued;
    // What addPendingHit (or HitQueue.process, in the victim's turn) does with it.
    CombatFactory.applyProtectionPrayer(hit);
    assert.equal(hit.getTotalDamage(), 20);
  });
}
