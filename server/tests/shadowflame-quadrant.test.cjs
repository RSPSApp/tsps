// Run after `yarn build`: node --test tests/shadowflame-quadrant.test.cjs
//
// #3792: the Shadowflame quadrant worked only as a plain staff. Wiki (Shadowflame quadrant): an
// infinite source of air, water, earth and fire runes; autocasts every spellbook; a standard
// elemental spell fires a second spell for 40% of the first's damage; against a weak NPC the spell
// counts as its weakness for damage and accuracy; an 8-tile melee range without melee. Live
// (rsprox_transcripts/237/01161.txt): the second projectile lands 30 cycles after the first and
// its hitsplat, floor(40%) of the first, a tick after it.
//
// Real Player, Equipment, Inventory, NPCs and plugins; the combat loop and hit queue run as the
// server's tick does. Only the network is stubbed.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { WeaponInterfaceManager } = require("../dist/game/content/combat/WeaponInterfaceManager");
const { Autocasting } = require("../dist/game/content/combat/magic/Autocasting");
const { MagicSpellbook } = require("../dist/game/model/MagicSpellbook");
const { DamageFormulas: Damage } = require("../dist/game/content/combat/formula/DamageFormulas");
const { AccuracyFormulasDpsCalc: Accuracy } = require("../dist/game/content/combat/formula/AccuracyFormulasDpsCalc");
const ElementalSpells = require("../plugins/combat/elementalspells/Common.ElementalSpells");

const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers;
const BLACK_DEMON = 1432; // 40% water weakness
const HILL_GIANT = 2098; // 25% earth weakness
const GUARD = 397; // no elemental weakness
let accurate = true;
const projectiles = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  await new NpcDefinitionLoader().load();
  // The item definitions the server loads (the quadrant's STAFF weapon interface).
  require("../plugins/items/ItemDefinitionLoader.plugin").register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
  require("../plugins/combat/ElementalSpells.plugin").register(PluginManager.createApi("QuadrantElementalSpells"));
  require("../plugins/items/ElementalStaves.plugin").register(PluginManager.createApi("QuadrantElementalStaves"));
  require("../plugins/items/ShadowflameQuadrant.plugin").register(PluginManager.createApi("QuadrantPlugin"));
  PluginManager.createApi("QuadrantAccuracy").onCombatHitRoll((roll) => { if (accurate) roll.forceAccurate = true; });
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3220, 3220);
  const send = core.Projectile.prototype.sendProjectile;
  core.Projectile.prototype.sendProjectile = function () {
    projectiles.push({ id: this.projectileId, ...this.getTiming() });
  };
  void send;
});

let index = 2900;
function wielder(t, { weapon = I.SHADOWFLAME_QUADRANT, spellbook = MagicSpellbook.NORMAL } = {}) {
  const player = new Player(null);
  player.setUsername(`quadrant${index}`);
  player.setIndex(index++);
  const sender = new Proxy({}, { get: () => () => sender });
  player.getPacketSender = () => sender;
  player.getSession = () => ({ sendClientPacket: () => true });
  t.mock.method(player, "sendMessage", () => {});
  player.setLocation(new core.Location(3220, 3220));
  player.setRegistered(true);
  player.setNeedsPlacement(false);
  for (const skill of core.Skill.values()) {
    player.getSkillManager().setMaxLevel(skill, 99);
    player.getSkillManager().setCurrentLevel(skill, 99, false);
  }
  player.setSpellbook(spellbook);
  player.getEquipment().set(core.Equipment.WEAPON_SLOT, new core.Item(weapon));
  WeaponInterfaceManager.assign(player);
  core.BonusManager.update(player);
  t.after(() => {
    player.getCombat().reset();
    player.setRegistered(false);
    core.World.unregisterPlayerPosition(player);
  });
  return player;
}

function npc(t, id, x = 3220, y = 3224) {
  const target = PluginManager.spawnNpc({ id, x, y });
  target.setMaxHitpoints(1000);
  target.setHitpoints(1000);
  target.setNeedsPlacement(false);
  target.getMovementQueue().setBlockMovement(true);
  t.after(() => PluginManager.removeNpc(target));
  return target;
}

/** Runs the server's tick for the attacker and the target's hit queue, recording each tick's damage. */
function fight(attacker, target, ticks) {
  const landed = [];
  for (let i = 0; i < ticks; i++) {
    core.World.processCycle++;
    core.TaskManager.process();
    attacker.getCombat().preMovementProcess();
    attacker.getMovementQueue().process();
    attacker.getCombat().postMovementProcess();
    const before = target.getHitpoints();
    target.getCombat().getHitQueue().process(core.World.processCycle);
    if (target.getHitpoints() !== before) landed.push({ tick: i, damage: before - target.getHitpoints() });
  }
  return landed;
}

const runes = (player, id) => player.getInventory().getAmount(id);

test("the quadrant supplies air, water, earth and fire runes to a real cast; the others are still paid", (t) => {
  const player = wielder(t);
  player.getInventory().add(new core.Item(I.WRATH_RUNE, 10));
  for (const spell of ["WIND_SURGE", "WATER_SURGE", "EARTH_SURGE", "FIRE_SURGE"]) {
    core.World.processCycle += 5; // one cast a cast delay
    assert.equal(core.CombatSpells[spell].canCast(player, true), true, `${spell} is castable with wrath runes only`);
  }
  assert.equal(runes(player, I.WRATH_RUNE), 6, "one wrath rune a surge");
  player.getEquipment().set(core.Equipment.WEAPON_SLOT, new core.Item(I.STAFF_OF_FIRE));
  assert.equal(core.CombatSpells.WIND_SURGE.canCast(player, true), false, "a staff of fire supplies no air");
});

test("the quadrant autocasts the Standard, Ancient and Arceuus spellbooks", (t) => {
  const quadrant = wielder(t);
  for (const spell of [core.CombatSpells.FIRE_SURGE, core.CombatSpells.ICE_BARRAGE, core.CombatSpells.SHADOW_RUSH,
    core.CombatSpells.INFERIOR_DEMONBANE]) {
    assert.ok(spell, "spell exists");
    assert.equal(Autocasting.canAutocast(quadrant, spell), true, `${spell.constructor.name} ${spell.spellId()}`);
  }
  const staff = wielder(t, { weapon: I.STAFF_OF_FIRE });
  assert.equal(Autocasting.canAutocast(staff, core.CombatSpells.ICE_BARRAGE), false, "a plain staff can't autocast Ancients");
  assert.equal(Autocasting.canAutocast(staff, core.CombatSpells.INFERIOR_DEMONBANE), false, "nor Arceuus");
});

test("an autocast standard elemental spell fires a second spell: two projectiles, a second hit of floor(40%) a tick later", (t) => {
  accurate = true;
  t.mock.method(Math, "random", () => 0.7); // a damage roll big enough for a visible 40%
  const player = wielder(t);
  const target = npc(t, GUARD);
  Autocasting.setAutocast(player, core.CombatSpells.FIRE_BLAST);
  player.getInventory().add(new core.Item(I.DEATH_RUNE, 100));
  projectiles.length = 0;
  player.getCombat().attack(target);
  const landed = fight(player, target, 6);
  assert.equal(landed.length, 2, JSON.stringify(landed));
  const [first, second] = landed;
  assert.equal(second.tick, first.tick + 1, "the second hitsplat a tick after the first");
  assert.ok(first.damage >= 5, JSON.stringify(landed));
  assert.equal(second.damage, Math.floor(first.damage * 0.4), JSON.stringify(landed));
  const blast = projectiles.slice(0, 2); // the cast's tick (the next cast comes 5 ticks later)
  assert.equal(projectiles.length, 4, "two casts in six ticks, each sending two projectiles");
  assert.equal(blast[0].startCycleOffset, blast[1].startCycleOffset, "both launched together");
  assert.equal(blast[0].id, blast[1].id);
  assert.equal(blast[1].endCycleOffset - blast[0].endCycleOffset, 30, "the second lands 30 cycles later");
  assert.equal(runes(player, I.DEATH_RUNE), 98, "two casts, one death rune each: the second spell costs nothing, the quadrant pays the fire and air");
});

test("a splashed first spell has no second hitsplat; other spells and other staves fire none", (t) => {
  t.mock.method(Math, "random", () => 0.7); // damage rolls that always show
  const splashed = wielder(t);
  const target = npc(t, GUARD);
  const { PendingHit } = require("../dist/game/content/combat/hit/PendingHit");
  const isAccurate = t.mock.method(PendingHit.prototype, "isAccurate", () => false);
  const queued = [];
  const addPendingHit = core.CombatFactory.addPendingHit;
  const spy = t.mock.method(core.CombatFactory, "addPendingHit", (hit) => { queued.push(hit); return addPendingHit.call(core.CombatFactory, hit); });
  Autocasting.setAutocast(splashed, core.CombatSpells.FIRE_BLAST);
  splashed.getInventory().add(new core.Item(I.DEATH_RUNE, 100));
  projectiles.length = 0;
  splashed.getCombat().attack(target);
  assert.equal(fight(splashed, target, 5).length, 0, "a splash deals nothing");
  assert.equal(projectiles.length, 2, "both projectiles still fly");
  assert.equal(queued.filter((hit) => hit.getTarget() === target).length, 1, "only the cast's own (splashed) hit");
  isAccurate.mock.restore();
  spy.mock.restore();

  const ancient = wielder(t, { spellbook: MagicSpellbook.ANCIENT });
  const other = npc(t, HILL_GIANT, 3222, 3224);
  Autocasting.setAutocast(ancient, core.CombatSpells.SHADOW_RUSH);
  for (const rune of core.CombatSpells.SHADOW_RUSH.itemsRequired(ancient)) ancient.getInventory().add(new core.Item(rune.getId(), 100));
  ancient.getCombat().attack(other);
  assert.equal(fight(ancient, other, 6).length, 1, "an Ancient spell hits once");

  const staff = wielder(t, { weapon: I.STAFF_OF_FIRE });
  const third = npc(t, HILL_GIANT, 3218, 3224);
  Autocasting.setAutocast(staff, core.CombatSpells.FIRE_BLAST);
  staff.getInventory().add(new core.Item(I.DEATH_RUNE, 100));
  staff.getInventory().add(new core.Item(I.AIR_RUNE, 100));
  staff.getCombat().attack(third);
  assert.equal(fight(staff, third, 6).length, 1, "a staff of fire's Fire Blast hits once");
});

test("against a weak NPC the spell counts as its weakness for damage and accuracy; the cast spell stays", (t) => {
  const player = wielder(t);
  const demon = npc(t, BLACK_DEMON);
  const giant = npc(t, HILL_GIANT, 3222, 3224);
  const guard = npc(t, GUARD, 3218, 3224);
  let target = guard;
  t.mock.method(player.getCombat(), "getTarget", () => target);
  const max = (spell) => { player.getCombat().setCastSpell(core.CombatSpells[spell]); return Damage.getMagicMaxhit(player); };
  const roll = (spell) => { player.getCombat().setCastSpell(core.CombatSpells[spell]); return Accuracy.attackMagicRoll(player, target); };

  // Base 24, +15% magic damage: 27; a weakness adds floor(24 * percent).
  const plainMax = max("FIRE_SURGE"), plainRoll = roll("FIRE_SURGE");
  assert.equal(plainMax, 27, "no weakness: no bonus");
  target = demon;
  assert.equal(max("FIRE_SURGE"), 27 + Math.floor(24 * 0.4), "Fire Surge counts as the demon's 40% water weakness");
  assert.equal(max("FIRE_SURGE"), max("WATER_SURGE"));
  assert.equal(roll("FIRE_SURGE"), roll("WATER_SURGE"), "and so does its accuracy");
  assert.equal(roll("FIRE_SURGE"), plainRoll + Math.floor(plainRoll * 0.4), "+40% of the attack roll");
  assert.equal(player.getCombat().getCastSpell(), core.CombatSpells.FIRE_SURGE, "the cast spell is still Fire Surge");
  assert.equal(ElementalSpells.targetWeakness(player, demon, core.CombatSpells.FIRE_SURGE).type, 4, "the shared weakness reads fire");
  target = giant;
  assert.equal(max("WATER_SURGE"), 27 + Math.floor(24 * 0.25), "Water Surge counts as the giant's 25% earth weakness");
  target = guard;
  assert.equal(roll("FIRE_SURGE"), plainRoll);

  const staff = wielder(t, { weapon: I.STAFF_OF_FIRE });
  t.mock.method(staff.getCombat(), "getTarget", () => demon);
  staff.getCombat().setCastSpell(core.CombatSpells.FIRE_SURGE);
  const staffMax = Damage.getMagicMaxhit(staff);
  staff.getCombat().setCastSpell(core.CombatSpells.WATER_SURGE);
  assert.ok(staffMax < Damage.getMagicMaxhit(staff), "without the quadrant Fire Surge gains nothing from a water weakness");
  assert.equal(ElementalSpells.targetWeakness(staff, demon, core.CombatSpells.FIRE_SURGE).type, 2);
});

test("on a melee style it reaches 8 tiles but never swings, keeping its target", (t) => {
  const player = wielder(t);
  const target = npc(t, HILL_GIANT, 3220, 3226);
  const method = core.CombatFactory.getMethod(player);
  assert.equal(method.type(), core.CombatType.MELEE);
  assert.equal(method.attackDistance(player), 8);
  player.getCombat().attack(target);
  assert.equal(fight(player, target, 8).length, 0, "no melee hit");
  assert.equal(player.getCombat().getTarget(), target, "it waits on its target");
  assert.ok(player.getLocation().getDistance(target.getLocation()) > 1, "it does not walk to melee distance");
  const staff = wielder(t, { weapon: I.STAFF_OF_FIRE });
  assert.equal(core.CombatFactory.getMethod(staff).attackDistance(staff), 1, "a plain staff still melees at 1 tile");
});
