const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const Common = require("../plugins/skills/ectofuntus/Common.Ectofuntus");

let core, worship, useOnEctofuntus;
before(async () => {
  await CachePipeline.initialize();
  core = PluginManager.getCoreApi();
  const api = {
    core,
    onObjectInteraction(name, actions) {
      assert.equal(name, "Ectofuntus");
      worship = actions.Worship;
    },
    onItemOnObject(handler) { useOnEctofuntus = handler; },
  };
  Common.init(api);
  require("../plugins/skills/ectofuntus/Worship.Ectofuntus")(api);
});

const obj = name => {
  const id = core.CacheDefinitions.getObjId(name);
  assert.ok(Number.isInteger(id), `missing cache item ${name}`);
  return id;
};
const ROBES = ["shades_prayer_helm", "shades_prayer_top", "shades_prayer_bottom", "shades_prayer_boots"];

function player({ meal = "pot_bonemeal_bat", count = 1, worn = [], prayer = 70, tokens = 0, slime = true } = {}) {
  const p = new Player(null);
  p.setUsername("EctoWorship");
  const packets = [];
  const sender = new Proxy({}, { get: (_, key) => (...args) => { packets.push([key, ...args]); return sender; } });
  p.getPacketSender = () => sender;
  p.performAnimation = a => packets.push(["animation", a.getId()]);
  const statements = [];
  p.getDialogueManager = () => ({ startDialogues: chain => statements.push(chain.getDialogues().get(0).text) });
  p.getSkillManager().setLevel(core.Skill.PRAYER, prayer);
  for (let i = 0; i < count; i++) {
    if (meal) p.getInventory().adds(obj(meal), 1);
    if (slime) p.getInventory().adds(core.ItemIdentifiers.BUCKET_OF_SLIME, 1);
  }
  const slots = [core.Equipment.HEAD_SLOT, core.Equipment.BODY_SLOT, core.Equipment.LEG_SLOT, core.Equipment.FEET_SLOT];
  worn.forEach((name, index) => p.getEquipment().setItem(slots[index], new core.Item(obj(name), 1)));
  Common.setTokens(p, tokens);
  const experience = () => p.getSkillManager().getSkills().experience[core.Skill.PRAYER.getIndex()];
  const before = experience();
  return { p, packets, statements, xp: () => experience() - before };
}

function use(p, itemId) {
  const event = { player: p, objectId: core.ObjectIdentifiers.ECTOFUNTUS, itemId, handled: false };
  useOnEctofuntus(event);
  assert.equal(event.handled, true);
}

test("bat bonemeal awards 21.2 XP per worship, retaining tenths across repeated offerings (Wiki)", () => {
  const h = player({ count: 5 });
  for (let i = 1; i <= 5; i++) {
    worship({ player: h.p });
    assert.equal(Math.round(h.xp() * 10), 212 * i);
  }
  assert.equal(h.xp(), 106);
  assert.equal(h.p.getInventory().getAmount(core.ItemIdentifiers.POT), 5);
  assert.equal(h.p.getInventory().getAmount(core.ItemIdentifiers.BUCKET), 5);
  assert.equal(Common.tokens(h.p), 25);
});

test("ground-only bones have no Ectofuntus bonemeal mapping", () => {
  assert.equal(Common.bonemealFor(obj("bull_bones")), null);
  assert.equal(Common.bonemealFor(obj("giant_bones")), null);
});

test("normal worship and item-use retain the captured swaps, rewards and feedback (377)", () => {
  const h = player({ meal: "pot_bonemeal_big", count: 3 });
  const beforeSlots = h.p.getInventory().getItems().slice(0, 6).map(item => item.getId());
  worship({ player: h.p });
  use(h.p, obj("pot_bonemeal_big"));
  use(h.p, core.ItemIdentifiers.BUCKET_OF_SLIME);
  assert.equal(h.xp(), 180);
  assert.equal(Common.tokens(h.p), 15);
  assert.deepEqual(h.p.getInventory().getItems().slice(0, 6).map(item => item.getId()),
    beforeSlots.map(id => id === obj("pot_bonemeal_big") ? core.ItemIdentifiers.POT : core.ItemIdentifiers.BUCKET));
  assert.equal(h.packets.filter(([key, id]) => key === "animation" && id === core.CacheDefinitions.getSeqId("ahoy_prayer")).length, 3);
  assert.equal(h.packets.filter(([key, id]) => key === "sendSound" && id === 2671).length, 3);
  assert.equal(h.packets.filter(([key, , text]) => key === "sendTypedMessage" && text === "You put some ectoplasm and bonemeal into the Ectofuntus, and worship it.").length, 3);
});

test("Zealot pieces each save both resources at 1.25%, still awarding XP and five tokens (Wiki)", t => {
  for (let pieces = 1; pieces <= 4; pieces++) {
    const chance = pieces * 0.0125;
    for (const [roll, saved] of [[chance - 0.00001, true], [chance, false]]) {
      t.mock.method(Math, "random", () => roll);
      const h = player({ worn: ROBES.slice(0, pieces) });
      use(h.p, obj("pot_bonemeal_bat"));
      assert.equal(h.p.getInventory().getAmount(obj("pot_bonemeal_bat")), saved ? 1 : 0, `${pieces} pieces, roll ${roll}`);
      assert.equal(h.p.getInventory().getAmount(core.ItemIdentifiers.BUCKET_OF_SLIME), saved ? 1 : 0);
      assert.equal(h.p.getInventory().getAmount(core.ItemIdentifiers.POT), saved ? 0 : 1);
      assert.equal(h.p.getInventory().getAmount(core.ItemIdentifiers.BUCKET), saved ? 0 : 1);
      assert.equal(Math.round(h.xp() * 10), 212);
      assert.equal(Common.tokens(h.p), 5);
    }
  }
});

test("carried robes and unrelated equipment do not save resources even on roll zero", t => {
  t.mock.method(Math, "random", () => 0);
  const h = player({ worn: ["bronze_full_helm"] });
  for (const name of ROBES) h.p.getInventory().adds(obj(name), 1);
  worship({ player: h.p });
  assert.equal(h.p.getInventory().getAmount(obj("pot_bonemeal_bat")), 0);
  assert.equal(h.p.getInventory().getAmount(core.ItemIdentifiers.BUCKET_OF_SLIME), 0);
});

test("robe saving cannot bypass missing ingredients, Prayer requirements or the token cap", t => {
  let rolls = 0;
  t.mock.method(Math, "random", () => { rolls++; return 0; });
  for (const options of [{ meal: null, slime: false }, { slime: false }, { meal: null },
    { meal: "pot_bonemeal_dragon_superior", prayer: 69 }, { tokens: 1000 }]) {
    const h = player({ ...options, worn: ROBES });
    const before = h.p.getInventory().getItems().map(item => item?.getId());
    worship({ player: h.p });
    assert.equal(h.xp(), 0);
    assert.equal(Common.tokens(h.p), options.tokens ?? 0);
    assert.deepEqual(h.p.getInventory().getItems().map(item => item?.getId()), before);
    assert.equal(h.statements.length, 1);
  }
  assert.equal(rolls, 0, "requirements fail before the saving roll");
});

test("a saved offering at 995 tokens reaches the cap, then cannot award more", t => {
  t.mock.method(Math, "random", () => 0);
  const h = player({ tokens: 995, worn: ROBES });
  worship({ player: h.p });
  worship({ player: h.p });
  assert.equal(Common.tokens(h.p), 1000);
  assert.equal(Math.round(h.xp() * 10), 212);
  assert.equal(h.p.getInventory().getAmount(obj("pot_bonemeal_bat")), 1);
  assert.equal(h.statements.at(-1), "There isn't room to put any more in.");
});
