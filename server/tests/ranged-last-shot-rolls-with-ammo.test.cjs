// Run after `yarn build`: node --test tests/ranged-last-shot-rolls-with-ammo.test.cjs
// A ranged shot is paid on its firing tick, but after the swing is rolled: Combat.attack calls start(), hits(), then
// finished(), and RangedCombatMethod pays in finished(). The last arrow, bolt or knife is still worn while its hit
// is rolled (a lit fire arrow sets a mummy alight, a thrown weapon rolls as itself), and the hit carries what it was
// fired with to its landing (poison, Serpentine helm venom), when the slot is already empty.
// Real engine: every plugin loaded, a real Player, Equipment and RangedCombatMethod.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { RangedCombatMethod } = require("../dist/game/content/combat/method/impl/RangedCombatMethod");
const { RangedWeapon, Ammunition } = require("../dist/game/content/combat/ranged/RangedData");

let core, I, Serpentine;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  Serpentine = require("../plugins/items/SerpentineHelm.plugin")._test;
  core.CombatPoisonData.init(); // GameBuilder does this at startup
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

let next = 9420;
function archer(t, weaponId, weaponAmount, ammoId, ammoAmount) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("lastshot" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3222, 3218, 0));
  t.after(() => { core.TaskManager.cancelTasks(p.getIndex()); p.setRegistered(false); });
  p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(weaponId, weaponAmount));
  if (ammoId > 0) p.getEquipment().setItem(core.Equipment.AMMUNITION_SLOT, new core.Item(ammoId, ammoAmount));
  core.WeaponInterfaceManager.assign(p);
  p.getCombat().setRangedWeapon(RangedWeapon.getFor(p));
  p.getCombat().setAmmunition(Ammunition.getFor(p));
  return p;
}

/** One swing as Combat.attack runs it: start, hits, finished. What was worn when the hit was rolled. */
function swing(t, p, target) {
  const method = new RangedCombatMethod();
  const seen = [];
  const emit = PM.emitCombatHitDamage;
  t.mock.method(PM, "emitCombatHitDamage", (event) => {
    seen.push([p.getEquipment().get(core.Equipment.WEAPON_SLOT).getId(), p.getEquipment().get(core.Equipment.AMMUNITION_SLOT).getId(), p.getWeapon()]);
    return emit.call(PM, event);
  });
  t.mock.method(Math, "random", () => 0.5); // the arrow lands on the floor, no Ava's
  method.start(p, target);
  const hits = method.hits(p, target);
  method.finished(p, target);
  t.mock.restoreAll();
  return { hits, seen };
}

test("the last arrow, bolt and knife are still worn when their hit is rolled, and paid right after", (t) => {
  const target = core.NPC.create(core.NpcIdentifiers.MAN, new core.Location(3224, 3218, 0));
  for (const [label, weapon, weaponAmount, ammo] of [
    ["last rune arrow(p)", I.MAGIC_SHORTBOW, 1, I.RUNE_ARROW_P_],
    ["last diamond bolt (e)", I.RUNE_CROSSBOW, 1, I.DIAMOND_BOLTS_E_],
    ["last rune knife(p)", I.RUNE_KNIFE_P_, 1, -1],
  ]) {
    const p = archer(t, weapon, weaponAmount, ammo, 1);
    const knife = ammo < 0;
    const { hits, seen } = swing(t, p, target);
    assert.ok(seen.length > 0, `${label}: the hit was rolled`);
    for (const [wornWeapon, wornAmmo, weaponInterface] of seen) {
      assert.equal(wornWeapon, weapon, `${label}: the weapon is still worn at the roll`);
      if (!knife) assert.equal(wornAmmo, ammo, `${label}: the ammo is still worn at the roll`);
      if (knife) assert.equal(weaponInterface, core.WeaponInterfaces.KNIFE, `${label}: rolled as a knife, not unarmed`);
    }
    const emptied = knife ? core.Equipment.WEAPON_SLOT : core.Equipment.AMMUNITION_SLOT;
    assert.equal(p.getEquipment().get(emptied).getId(), -1, `${label}: paid on the firing tick`);
    const fired = hits[0].getFiredRangedShot();
    assert.equal(fired.projectile.getId(), knife ? weapon : ammo, `${label}: the hit carries what it fired`);
  }
});

test("a last poisoned shot still poisons and gives the Serpentine helm its venom chance on landing", (t) => {
  const target = core.NPC.create(core.NpcIdentifiers.MAN, new core.Location(3224, 3218, 0));
  for (const [weapon, ammo] of [[I.MAGIC_SHORTBOW, I.RUNE_ARROW_P_], [I.RUNE_KNIFE_P_, -1]]) {
    const p = archer(t, weapon, 1, ammo, 1);
    const { hits } = swing(t, p, target);
    assert.equal(Serpentine.venomChance(p, core.CombatType.RANGED, hits[0]), 0.5, `${weapon}: the (p) shot's venom chance`);
    const fired = hits[0].getFiredRangedShot();
    const poisonItem = fired.weaponInterface === core.WeaponInterfaces.KNIFE ? fired.weapon : fired.ammo;
    assert.ok(core.CombatPoisonData.getPoisonType(poisonItem), `${weapon}: the landing poison reads a (p) item`);
  }
});
