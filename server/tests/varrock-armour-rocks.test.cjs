// Run after `yarn build`: node --test tests/varrock-armour-rocks.test.cjs
// Wiki (Mining enhancers, the Varrock armour column): each tier's 10% extra ore also covers blurite (1), sandstone,
// granite, lovakite, soft clay and rubium (2), sunstone (3), and nickel and amethyst (4). Those rocks gave none.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  require("../plugins/skills/mining/VarrockArmour.Mining").attach(PluginManager.createApi("VarrockArmourRocks"));
});

function wearer(t, armourId) {
  t.mock.method(core.WorldDefinition, "isMembersWorld", () => true);
  t.mock.method(Math, "random", () => 0);
  const p = new Player(null);
  p.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  p.getEquipment().setItem(core.Equipment.BODY_SLOT, new core.Item(armourId, 1));
  return p;
}

function bonus(player, oreId) {
  const request = { player, oreId, rockLevel: 1, bonuses: [] };
  PluginManager.emitCustomEvent("mining:extra-ore", request);
  return request.bonuses.length;
}

test("each tier adds an ore from the Wiki's rocks for it, and not from the next tier's", (t) => {
  const I = core.ItemIdentifiers;
  const armour = [I.VARROCK_ARMOUR_1, I.VARROCK_ARMOUR_2, I.VARROCK_ARMOUR_3, I.VARROCK_ARMOUR_4];
  const rocks = [
    [I.BLURITE_ORE, 1], [6971, 2], [6977, 2], [6979, 2], [6983, 2], [I.LOVAKITE_ORE, 2], [I.SOFT_CLAY, 2],
    [I.RUBIUM_SPLINTERS, 2], [I.SUNSTONE, 3], [I.NICKEL_ORE, 4], [I.AMETHYST, 4],
  ];
  for (const [oreId, tier] of rocks) {
    assert.equal(bonus(wearer(t, armour[tier - 1]), oreId), 1, `ore ${oreId} at tier ${tier}`);
    if (tier > 1) assert.equal(bonus(wearer(t, armour[tier - 2]), oreId), 0, `ore ${oreId} not at tier ${tier - 1}`);
  }
});

test("nickel rocks ask the enhancers, so Varrock armour 4 can add one", () => {
  const Mining = require("../plugins/skills/Mining.plugin");
  const nickel = Mining.ROCKS.find((rock) => rock.objectName === "Nickel rocks");
  assert.ok(nickel && !nickel.noExtraOre && !nickel.infinite);
  assert.ok(nickel.level > 70, "above the Mining cape's and celestial ring's level 70, so only the armour applies");
});
