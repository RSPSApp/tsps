// Crystal saw: invisible +3 Construction from the inventory, 28/56 charges, Check, seed on the last charge.
// Wiki (Crystal saw); Check line from rsprox captures, recordings 260 (rev 229) and 310 (rev 230).
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");

let core, I, Data, House, Saw;
const westernMedium = new Set();

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  I = core.ItemIdentifiers;
  const api = PluginManager.createApi("CrystalSawTest");
  require("../plugins/skills/construction/Core.Construction").init(api);
  api.onCustomEvent("diary:is-complete", (request) => {
    if (request.diary === "western" && request.tier === "medium" && westernMedium.has(request.player)) request.complete = true;
  });
  Saw = require("../plugins/items/CrystalSaw.plugin.js");
  Saw.register(api);
  Data = require("../plugins/skills/construction/Data.Construction");
  House = require("../plugins/skills/construction/House.Construction");
});

function player(level, tools) {
  const p = new Player(null);
  const skills = p.getSkillManager();
  skills.setMaxLevels(core.Skill.CONSTRUCTION, level, false)
    .setExperiences(core.Skill.CONSTRUCTION, core.SkillManager.getExperienceForLevel(level), false)
    .setCurrentLevel(core.Skill.CONSTRUCTION, level, false);
  p.messages = [];
  p.sendMessage = (text) => p.messages.push(text);
  p.getInventory().refreshItems = () => {}; // no session to send to
  for (const id of tools) p.getInventory().add(new core.Item(id, 1), false);
  return p;
}

function stock(p, buildable) {
  for (const m of buildable.materials) {
    if (m.itemId != null) p.getInventory().add(new core.Item(m.itemId, m.amount), false);
    else if (m.source === "NAILS") p.getInventory().add(new core.Item(I.STEEL_NAILS, m.amount), false);
  }
}

const chair = () => Data.BUILDABLE_BY_KEY.get("CRUDE_WOODEN_CHAIR");

test("the crystal saw in the inventory builds furniture up to 3 levels higher, a normal saw doesn't", () => {
  const b = { ...chair(), level: 4 };
  const plain = player(1, [I.HAMMER, I.SAW]);
  stock(plain, b);
  assert.match(String(House.getBuildMaterials(plain, null, undefined, b)), /Construction level 4/);
  const crystal = player(1, [I.HAMMER, I.CRYSTAL_SAW]);
  stock(crystal, b);
  assert.ok(House.getBuildMaterials(crystal, null, undefined, b) instanceof Map);
  assert.match(String(House.getBuildMaterials(crystal, null, undefined, { ...b, level: 5 })), /Construction level 5/);
  // Garden plants (watering-can builds) get no boost.
  assert.equal(House.furnitureLevel(crystal, { ...b, tool: "watering-can" }), 1);
  const tree = Data.BUILDABLE_BY_KEY.get("BIG_DEAD_TREE");
  assert.equal(House.furnitureLevel(crystal, tree), 1);
  const planter = player(tree.level - 3, [I.HAMMER, I.CRYSTAL_SAW]);
  stock(planter, tree);
  assert.match(String(House.getBuildMaterials(planter, null, undefined, tree)), new RegExp(`Construction level ${tree.level}`));
});

test("a charge goes only when the boost was needed, and the last one reverts the saw to its seed", () => {
  const p = player(10, [I.HAMMER, I.CRYSTAL_SAW]);
  const b = chair();
  House.useMaterials(p, { ...b, level: 10 }, new Map());
  assert.equal(Saw._test.chargesLeft(p), 28);
  House.useMaterials(p, null, new Map()); // Mahogany Homes jobs: no buildable, no charge
  assert.equal(Saw._test.chargesLeft(p), 28);
  House.useMaterials(p, { ...b, level: 12 }, new Map());
  assert.equal(Saw._test.chargesLeft(p), 27);
  Saw._test.check({ player: p, item: new core.Item(I.CRYSTAL_SAW, 1) });
  assert.deepEqual(p.messages, ["Your saw has 27 charges left."]);
  for (let i = 0; i < 27; i++) House.useMaterials(p, { ...b, level: 12 }, new Map());
  assert.equal(p.getInventory().contains(I.CRYSTAL_SAW), false);
  assert.equal(p.getInventory().contains(I.CRYSTAL_SAW_SEED), true);
  assert.equal(p.getAttribute(Saw._test.CHARGES_USED_ATTRIBUTE), 0);
  assert.equal(p.messages.length, 2);
  assert.equal(House.furnitureLevel(p, b), 10);
});

test("the medium Western Provinces Diary gives 56 charges, and a freshly sung saw starts full", () => {
  const p = player(1, [I.CRYSTAL_SAW]);
  p.setAttribute(Saw._test.CHARGES_USED_ATTRIBUTE, 5);
  assert.equal(Saw._test.chargesLeft(p), 23);
  westernMedium.add(p);
  assert.equal(Saw._test.chargesLeft(p), 51);
  Saw._test.sawMade({ player: p });
  assert.equal(Saw._test.chargesLeft(p), 56);
});

test("a saw left in the bank gives no boost and spends nothing", () => {
  const p = player(1, [I.HAMMER, I.SAW]);
  p.setAttribute(Saw._test.CHARGES_USED_ATTRIBUTE, 3);
  assert.equal(House.furnitureLevel(p, chair()), 1);
  House.useMaterials(p, { ...chair(), level: 3 }, new Map());
  assert.equal(p.getAttribute(Saw._test.CHARGES_USED_ATTRIBUTE), 3);
});

// Decision approved 2026-11-15: trophy rows are furniture costing planks and nails (a saw-and-hammer build), so the
// crystal saw's +3 counts for mounting too, and a charge goes only when the boost was needed.
test("the crystal saw's +3 mounts a skill hall trophy, spending a charge only when the boost was needed", () => {
  const Trophies = require("../plugins/skills/construction/Trophies.Construction");
  const Instance = require("../plugins/skills/construction/Instance.Construction");
  const trophy = [...Trophies._test.byKey.values()].find((t) => !t.experience.combat && t.level >= 4 && Object.keys(t.locs).length);
  assert.ok(trophy, "a trophy without a combat offer");
  const tier = Number(Object.keys(trophy.locs)[0]);
  const mountAt = (level, tools) => {
    const p = player(level, [...tools, trophy.item]);
    const house = Object.create(Instance.PlayerHouseInstance.prototype);
    house.owner = p;
    house.save = {};
    house.redrawFurniture = () => {};
    p.getPrivateArea = () => house;
    p.performAnimation = () => {};
    p.getSkillManager().addExperiences = () => {}; // no session for the XP drop
    const out = new Proxy({}, { get: () => () => out }); // no session: packets go nowhere
    p.getPacketSender = () => out;
    const found = { house, furniture: {}, display: { type: trophy.display, tier } };
    Trophies._test.mount(p, found, trophy);
    return { p, found };
  };
  const plain = mountAt(trophy.level - 3, [I.HAMMER, I.SAW]);
  assert.deepEqual(plain.p.messages, [`You need a Construction level of ${trophy.level} to mount that.`]);
  assert.equal(plain.p.getInventory().contains(trophy.item), true);

  const boosted = mountAt(trophy.level - 3, [I.HAMMER, I.CRYSTAL_SAW]);
  assert.equal(boosted.found.furniture.trophy, trophy.key, "mounted with the boost");
  assert.equal(boosted.p.getInventory().contains(trophy.item), false);
  assert.equal(Saw._test.chargesLeft(boosted.p), 27, "the boost was needed: one charge");

  const level = mountAt(trophy.level, [I.HAMMER, I.CRYSTAL_SAW]);
  assert.equal(level.found.furniture.trophy, trophy.key);
  assert.equal(Saw._test.chargesLeft(level.p), 28, "the level already met it: no charge");

  const short = mountAt(trophy.level - 4, [I.HAMMER, I.CRYSTAL_SAW]);
  assert.equal(short.found.furniture.trophy, undefined, "+3 only");
});
