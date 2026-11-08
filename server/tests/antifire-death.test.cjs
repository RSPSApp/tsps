// Run after `yarn build`: node --test tests/antifire-death.test.cjs
// Antifire carries through a death. In every recorded death with one active (rsprox 227/01857, 227/00543, 227/00555,
// 234/03279, all Leagues worlds) its varbits count on through the death and respawn, then the "about to expire" and
// "has expired" messages arrive, while poison and prayers reset; the Wiki says nothing either way. resetAttributes
// stopped the fire-immunity timer but left the protection on, so a save wrote fireImmunityTimer 0 while dragonfire
// still read a protection. Real Player and the real PlayerDeathTask, the real PlayerSave.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerDeathTask } = require("../dist/game/task/impl/PlayerDeath");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
const { GameConstants } = require("../dist/game/GameConstants");
const Dragonfire = require("../plugins/combat/DragonfireProtection");

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  Dragonfire.initDragonfireProtectionCoreAccess({ core: PluginManager.getCoreApi() });
});

test("a super antifire survives a death: the protection, the fire timer and the save all keep it", (t) => {
  const p = new Player(null);
  const sender = new Proxy({}, { get: () => () => sender });
  t.mock.method(p, "getPacketSender", () => sender);
  t.mock.method(p, "sendMessage", () => {});
  p.setUsername("antifire-death");
  t.mock.method(PluginManager, "emitShouldDropItemsOnDeath", () => false);
  t.mock.method(GameConstants.PLAYER_PERSISTENCE, "requestSave", () => {});
  const Tier = Dragonfire.DragonfireProtectionTier;
  Dragonfire.setDragonfireProtection(p, { tier: Tier.SUPER_ANTIFIRE, seconds: 180, label: "super antifire potion" });
  const task = new PlayerDeathTask(p);
  for (let tick = 0; tick < 5; tick++) task.execute(); // the animation, then the death completes four ticks on
  assert.equal(Dragonfire.getDragonfireProtectionTier(p), Tier.SUPER_ANTIFIRE, "still super antifire after the death");
  const left = p.getCombat().getFireImmunityTimer().secondsRemaining();
  assert.ok(left > 170, `the fire timer still runs (${left}s)`);
  assert.ok(PlayerSave.fromPlayer(p).fireImmunityTimer > 170, "and a save writes it");
});
