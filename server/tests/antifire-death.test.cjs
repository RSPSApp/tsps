// Run after `yarn build`: node --test tests/antifire-death.test.cjs
// A death ends antifire protection. Player.resetAttributes stopped the fire-immunity timer, but the protection that
// dragonfire reads is DragonfireProtection's attribute (tier, label, end time), which was left: a super antifire's
// full immunity carried through the death with the infobox blank. Real Player, the real resetAttributes.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const Dragonfire = require("../plugins/combat/DragonfireProtection");

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  Dragonfire.initDragonfireProtectionCoreAccess(PluginManager.getCoreApi());
});

test("a death ends a super antifire's protection", () => {
  const p = new Player(null);
  p.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  p.setUsername("antifire-death");
  Dragonfire.setDragonfireProtection(p, { tier: Dragonfire.DragonfireProtectionTier.SUPER_ANTIFIRE, seconds: 180, label: "super antifire potion" });
  assert.equal(Dragonfire.getDragonfireProtectionTier(p), Dragonfire.DragonfireProtectionTier.SUPER_ANTIFIRE);
  p.resetAttributes(); // what a death does
  assert.equal(Dragonfire.getDragonfireProtectionTier(p), Dragonfire.DragonfireProtectionTier.NONE, "no protection after the death");
});
