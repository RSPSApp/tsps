// Run after `yarn build`: node --test tests/carpenter-outfit.test.cjs
// Wiki (Carpenter's outfit): helmet +0.4%, shirt +0.8%, trousers +0.6%, boots +0.2%, +0.5% more for all
// four, on Construction training: furniture and flatpacks, Mahogany Homes contracts, the shipwrights'
// workbench. Mahogany Homes paid the bonus only for the full set, and nothing else paid it. Real engine:
// every plugin loaded, a real Player, the plugins' own completion functions.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core;
let House;
let Data;
let Mahogany;
let Outfit;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  House = require("../plugins/skills/construction/House.Construction");
  Data = require("../plugins/skills/construction/Data.Construction");
  Mahogany = require("../plugins/skills/construction/MahoganyHomes.Construction");
  Outfit = require("../plugins/skills/construction/CarpenterOutfit.Construction");
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const PIECES = { HEAD_SLOT: "construction_hat", BODY_SLOT: "construction_shirt", LEG_SLOT: "construction_trousers", FEET_SLOT: "construction_boots" };

function makePlayer(t, worn) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(9201); p.setUsername("carpenter9201"); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  t.after(() => { core.TaskManager.cancelTasks(p); p.setRegistered(false); });
  for (const slot of worn) p.getEquipment().setItem(core.Equipment[slot], new core.Item(CacheDefinitions.getObjId(PIECES[slot]), 1));
  return p;
}

function construction(p, act) {
  // getExperience() floors to whole experience; the stored total keeps tenths.
  const stored = () => p.getSkillManager().skills.experience[core.Skill.CONSTRUCTION.getIndex()];
  const before = stored();
  act();
  return Math.round((stored() - before) * 10) / 10;
}

// Seeded hotspot hook input, with the same per-player definition/metadata as the packet caller.
function removeHotspot(p, hotspot) {
  const at = new core.Location(3200, 3200, 0);
  p.setLocation(at.clone());
  p.getPacketSender().sendVarbit(core.CacheDefinitions.getVarbitId(`con_contract_hotspot_${hotspot.index}_display`), 3);
  const object = new core.GameObject(hotspot.loc, at, 10, 0, null);
  const definition = core.ObjectDefinition.forPlayer(hotspot.loc, p);
  const option = definition?.getInteractions()?.[1]?.toLowerCase();
  assert.equal(option, "remove", "the seeded cache variant exposes Remove");
  const location = { x: at.getX(), y: at.getY(), z: at.getZ() };
  assert.equal(PM.emitObjectInteraction({ player: p, object, definition, objectId: hotspot.loc, clickType: 2,
    option, location, sourceLocation: { ...location }, handled: false }), true);
}

const BONUS = [
  [[], 1],
  [["HEAD_SLOT"], 1.004],
  [["BODY_SLOT"], 1.008],
  [["LEG_SLOT"], 1.006],
  [["FEET_SLOT"], 1.002],
  [["HEAD_SLOT", "BODY_SLOT", "LEG_SLOT"], 1.018],
  [Object.keys(PIECES), 1.025],
];

test("each piece adds its own bonus and the full set adds 0.5% more", (t) => {
  for (const [worn, multiplier] of BONUS) {
    assert.ok(Math.abs(Outfit.xpMultiplier(makePlayer(t, worn)) - multiplier) < 1e-9, worn.join());
  }
});

test("building furniture pays the outfit's bonus", (t) => {
  const crude = Data.BUILDABLE_BY_KEY.get("MITHRIL_ARMOUR"); // 135 Construction
  for (const [worn, multiplier] of BONUS) {
    const p = makePlayer(t, worn);
    const gained = construction(p, () => House.completeFurniture(p, { setFurniture() {} }, {}, crude, new Map()));
    assert.equal(gained, Math.floor(crude.experience * multiplier * 10 + 1e-6) / 10, worn.join());
  }
});

test("a Mahogany Homes repair pays the bonus for the pieces worn, not only a full set", (t) => {
  const home = Mahogany.HOMES[0];
  for (const [worn, multiplier] of BONUS) {
    const p = makePlayer(t, worn);
    const contract = { home: home.key, tier: 0, states: { 1: 1 } };
    const gained = construction(p, () => Mahogany.finishJob(p, contract, { index: 1 }, 5, 100));
    assert.equal(gained, Math.floor(100 * multiplier * 10 + 1e-6) / 10, worn.join());
  }
});

test("the outfit multiplier event answers for plugins outside Construction (the shipwrights' workbench)", (t) => {
  const p = makePlayer(t, Object.keys(PIECES));
  const request = { player: p, multiplier: 1 };
  PM.emitCustomEvent("construction:outfit-multiplier", request);
  assert.ok(Math.abs(request.multiplier - 1.025) < 1e-9);
});

// Wiki (Imcando hammer): used as a hammer "both while equipped and unequipped"; Mahogany Homes: it "can be worn in
// the off-hand". Mahogany Homes' tool check wanted a plain hammer in the inventory.
test("a Mahogany Homes hotspot takes an Imcando hammer, worn or carried, as the hammer", (t) => {
  const home = Mahogany.HOMES[0];
  const hotspot = home.hotspots[0];
  for (const where of ["worn", "carried"]) {
    const p = makePlayer(t, []);
    p.getInventory().add(new core.Item(core.ItemIdentifiers.SAW, 1), true);
    const hammer = where === "worn" ? core.ItemIdentifiers.IMCANDO_HAMMER_OFF_HAND_ : core.ItemIdentifiers.IMCANDO_HAMMER;
    if (where === "worn") p.getEquipment().setItem(core.Equipment.SHIELD_SLOT, new core.Item(hammer, 1));
    else p.getInventory().add(new core.Item(hammer, 1), true);
    p.setAttribute("construction:contract", { home: home.key, tier: 0, states: { [hotspot.index]: 3 } });
    const messages = [];
    t.mock.method(p.getPacketSender(), "sendMessage", (m) => { messages.push(m); return p.getPacketSender(); });
    removeHotspot(p, hotspot);
    assert.ok(!messages.includes("You need a hammer and a saw to do that."), `${where}: ${messages.join(" | ")}`);
    assert.equal(p.getAttribute("construction:contract").states[hotspot.index], 4, `${where}: the old furniture is removed`);
  }
});

test("Amy's saw counts as the saw wielded in the weapon slot, and its off-hand copy in the shield slot", (t) => {
  const home = Mahogany.HOMES[0];
  const hotspot = home.hotspots[0];
  const cases = [["weapon", "WEAPON_SLOT", core.ItemIdentifiers.AMYS_SAW], ["off-hand", "SHIELD_SLOT", core.ItemIdentifiers.AMYS_SAW_OFF_HAND_]];
  for (const [label, slot, saw] of cases) {
    const p = makePlayer(t, []);
    p.getInventory().add(new core.Item(core.ItemIdentifiers.HAMMER, 1), true);
    p.getEquipment().setItem(core.Equipment[slot], new core.Item(saw, 1));
    assert.equal(House.hasSaw(p), true, `${label}: building at home finds the saw`);
    p.setAttribute("construction:contract", { home: home.key, tier: 0, states: { [hotspot.index]: 3 } });
    const messages = [];
    t.mock.method(p.getPacketSender(), "sendMessage", (m) => { messages.push(m); return p.getPacketSender(); });
    removeHotspot(p, hotspot);
    assert.ok(!messages.includes("You need a hammer and a saw to do that."), `${label}: ${messages.join(" | ")}`);
    assert.equal(p.getAttribute("construction:contract").states[hotspot.index], 4, `${label}: the old furniture is removed`);
  }
  const bare = makePlayer(t, []);
  bare.getInventory().add(new core.Item(core.ItemIdentifiers.HAMMER, 1), true);
  assert.equal(House.hasSaw(bare), false, "no saw carried or worn");
});
