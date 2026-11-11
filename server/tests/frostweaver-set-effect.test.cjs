// node --test tests/frostweaver-set-effect.test.cjs
// Frostweaver (OSRS Wiki Blue Moon armour, set effects): full Blue Moon armour (broken pieces count) and the Blue Moon
// spear; a Bind/Snare/Entangle/Ancient ice cast has a 20% chance, an Arceuus grasp 50%, of an instant melee spear attack.
const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const { Server } = require("../dist/Server"); Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const core = PluginManager.getCoreApi();

before(async () => {
  await CachePipeline.initialize(process.cwd());
  PluginManager.loadFromDirectory(require("node:path").resolve(__dirname, "../plugins")); // the real loader: the unit is found, or absent
  // Skeletal and Undead Grasp need A Kingdom Divided (ArceuusQuestLock); the player here has finished it.
  PluginManager.createApi("FrostweaverQuest").onCustomEvent("quest:is-complete", (event) => { event.complete = true; });
});

function fixture(t, spellName, { armour = "normal", weapon = "BLUE_MOON_SPEAR", roll = 0, at = [1, 0], z = 0, hp = 200, realTarget = false, enabled = true } = {}) {
  t.mock.method(core.Sounds, "sendSound", () => {});
  t.mock.method(Math, "random", () => roll);
  const queued = [];
  const armedWhenQueued = [];
  const p = new Player(null);
  if (enabled) p.setAttribute("frostweaver:enabled", true);
  t.mock.method(core.CombatFactory, "addPendingHit", (hit) => { queued.push(hit); armedWhenQueued.push(p.isSpecialActivated()); });
  t.mock.method(p, "getSession", () => ({ sendClientPacket: () => true }));
  t.mock.method(p, "sendMessage", () => {});
  p.getSkillManager().setMaxLevel(core.Skill.MAGIC, 99);
  p.getSkillManager().setCurrentLevel(core.Skill.MAGIC, 99, false);
  // The target stands at (3200, 3200); the player at an explicit offset from it ("at"), adjacent by default.
  const target = new core.NPC(core.NpcIdentifiers.MAN, new core.Location(3200, 3200, z));
  p.setLocation(new core.Location(3200 + at[0], 3200 + at[1], 0));
  t.mock.method(target, "getHitpoints", () => hp);
  t.mock.method(target, "isRegistered", () => true);
  if (realTarget === true) p.getCombat().attack(target); // the real order: the target is set before the cast
  else if (realTarget === null) t.mock.method(p.getCombat(), "getTarget", () => null);
  else t.mock.method(p.getCombat(), "getTarget", () => target);
  const I = core.ItemIdentifiers, E = core.Equipment, items = p.getEquipment().getItems();
  const sets = { normal: ["", ""], broken: ["_BROKEN_", "_BROKEN_"], mixed: ["_6", "_BROKEN_"], missing: ["", ""], none: ["", ""] };
  const [a, b] = sets[armour];
  if (armour !== "none") {
    items[E.HEAD_SLOT] = new core.Item(I[`BLUE_MOON_HELM${a}`]);
    items[E.BODY_SLOT] = new core.Item(I[`BLUE_MOON_CHESTPLATE${b}`]);
    items[E.LEG_SLOT] = new core.Item(I[`BLUE_MOON_TASSETS${a}`]);
  }
  if (armour === "missing") items[E.LEG_SLOT] = new core.Item(-1);
  if (weapon) items[E.WEAPON_SLOT] = new core.Item(I[weapon]);
  const spell = core.CombatSpells[spellName];
  p.setSpellbook(spell.getSpellbook());
  p.getCombat().setCastSpell(spell);
  for (const rune of spell.itemsRequired(p)) p.getInventory().add(new core.Item(rune.getId(), rune.getAmount() * 10));
  return { p, target, spell, queued, armedWhenQueued, cast: () => spell.canCast(p, true) };
}

function swings(f) {
  return f.queued.filter((h) => h.getAttacker() === f.p && h.getCombatType() === core.CombatType.MELEE);
}

test("a committed binding or ice cast in the full set with the spear queues one instant melee hit", (t) => {
  for (const name of ["BIND", "SNARE", "ENTANGLE", "ICE_RUSH", "ICE_BURST", "ICE_BLITZ", "ICE_BARRAGE"]) {
    const f = fixture(t, name);
    assert.equal(f.cast(), true, name);
    assert.equal(swings(f).length, 1, name);
  }
});

test("both spears with equipment data work, in the full set", (t) => {
  for (const weapon of ["BLUE_MOON_SPEAR", "BLUE_MOON_SPEAR_4"]) {
    const f = fixture(t, "ICE_BARRAGE", { weapon });
    assert.equal(f.cast(), true, weapon);
    assert.equal(swings(f).length, 1, weapon);
  }
});

test("broken and mixed-tier pieces still count", (t) => {
  for (const armour of ["broken", "mixed"]) {
    const f = fixture(t, "BIND", { armour });
    assert.equal(f.cast(), true);
    assert.equal(swings(f).length, 1, armour);
  }
});

test("Arceuus grasps proc at 50%, the others at 20% (boundary rolls)", (t) => {
  for (const [name, chance] of [["GHOSTLY_GRASP", 0.5], ["SKELETAL_GRASP", 0.5], ["UNDEAD_GRASP", 0.5], ["BIND", 0.2], ["ICE_BARRAGE", 0.2]]) {
    for (const [roll, expected] of [[chance - 0.001, 1], [chance, 0]]) {
      const f = fixture(t, name, { roll });
      f.cast();
      assert.equal(swings(f).length, expected, `${name} roll ${roll}`);
    }
  }
});

test("a missing piece, no armour or another weapon gives no attack", (t) => {
  for (const options of [{ armour: "missing" }, { armour: "none" }, { weapon: null }, { weapon: "BLUE_MOON_SPEAR_4", armour: "missing" }]) {
    const f = fixture(t, "ENTANGLE", options);
    f.cast();
    assert.equal(swings(f).length, 0, JSON.stringify(options));
  }
});

test("a different real weapon in the full set gives no attack", (t) => {
  const f = fixture(t, "BIND", { weapon: "STAFF_OF_AIR" });
  f.cast();
  assert.equal(swings(f).length, 0);
});

test("other spells give no attack: standard strike, the other Ancient elements, Arceuus non-grasps", (t) => {
  for (const name of ["FIRE_STRIKE", "SMOKE_RUSH", "SHADOW_BURST", "BLOOD_BARRAGE", "INFERIOR_DEMONBANE"]) {
    const f = fixture(t, name);
    f.cast();
    assert.equal(swings(f).length, 0, name);
  }
});

test("the spear must reach the target: adjacent and diagonal hit, two tiles, far away or another floor do not", (t) => {
  for (const [options, expected] of [[{ at: [1, 0] }, 1], [{ at: [-1, 1] }, 1], [{ at: [1, 1] }, 1], [{ at: [2, 0] }, 0], [{ at: [2, 2] }, 0], [{ at: [9, 0] }, 0], [{ at: [-3000, -3000] }, 0], [{ at: [1, 0], z: 1 }, 0]]) {
    const f = fixture(t, "ICE_BARRAGE", options);
    assert.equal(f.cast(), true, JSON.stringify(options));
    assert.equal(swings(f).length, expected, JSON.stringify(options));
  }
});

test("no attack on a dead target or with no target", (t) => {
  for (const options of [{ hp: 0 }, { realTarget: null }]) {
    const f = fixture(t, "BIND", options);
    f.cast();
    assert.equal(swings(f).length, 0, JSON.stringify(options));
  }
});

test("through the real combat entry: the target set by attack() is the one the spear hits", (t) => {
  const f = fixture(t, "ENTANGLE", { realTarget: true });
  assert.equal(f.p.getCombat().getTarget(), f.target);
  assert.equal(f.cast(), true);
  assert.equal(swings(f).length, 1);
  assert.equal(swings(f)[0].getTarget(), f.target);
});

test("an armed special is neither used nor spent by the attack", (t) => {
  const f = fixture(t, "BIND");
  f.p.setSpecialActivated(true);
  f.cast();
  assert.equal(swings(f).length, 1);
  assert.deepEqual(f.armedWhenQueued, [false], "the hit is built and queued as an ordinary swing");
  assert.equal(f.p.isSpecialActivated(), true, "and the special stays armed for the next attack");
});

test("the set effect starts off and the combat tab's Toggle set effect button (593:37) switches it, sending varbit 9870", (t) => {
  const f = fixture(t, "BIND", { enabled: false });
  const varbits = [];
  t.mock.method(f.p.getPacketSender(), "sendVarbit", (id, value) => varbits.push([id, value]));
  let tick = 1000; // each cast waits out the shared spell cast delay
  t.mock.method(core.World, "getProcessCycle", () => tick);
  f.cast();
  assert.equal(swings(f).length, 0, "off by default");
  const click = () => PluginManager.emitInterfaceActionClick({ player: f.p, buttonId: (593 << 16) | 37, action: 1, groupId: 593, childId: 37, opId: 1, handled: false });
  assert.equal(click(), true);
  assert.deepEqual(varbits, [[9870, 1]]);
  tick += 10;
  f.cast();
  assert.equal(swings(f).length, 1, "on after the click");
  assert.equal(click(), true);
  assert.deepEqual(varbits, [[9870, 1], [9870, 0]]);
  tick += 10;
  f.cast();
  assert.equal(swings(f).length, 1, "off again after the second click");
});
