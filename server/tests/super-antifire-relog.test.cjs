// Run after `yarn build`: node --test tests/super-antifire-relog.test.cjs
// The antifire state (tier, label, wall-clock end) isn't saved; only the fire-immunity timer is, and it pauses offline.
// A relog rebuilt the state from the timer as a plain antifire, so a super antifire came back as only the damage cut.
// Its tier and label are saved now and the rebuild uses them. Real Players and the real PlayerSave round trip.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
const Dragonfire = require("../plugins/combat/DragonfireProtection");

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  Dragonfire.initDragonfireProtectionCoreAccess({ core: PluginManager.getCoreApi(), persistAttribute: (key, value) => PlayerSave.persistAttribute(key, value) });
});

const player = () => {
  const p = new Player(null);
  p.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  p.setUsername("super-antifire");
  return p;
};

test("a super antifire is still a super antifire after a relog", () => {
  const before = player();
  Dragonfire.setDragonfireProtection(before, { tier: Dragonfire.DragonfireProtectionTier.SUPER_ANTIFIRE, seconds: 180, label: "super antifire potion" });
  const save = PlayerSave.fromPlayer(before);
  const after = player();
  save.applyToPlayer(after);
  assert.equal(Dragonfire.getDragonfireProtectionTier(after), Dragonfire.DragonfireProtectionTier.SUPER_ANTIFIRE);
});
