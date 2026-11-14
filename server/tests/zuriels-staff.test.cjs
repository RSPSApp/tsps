// Run after `yarn build`: node --test tests/zuriels-staff.test.cjs
//
// Wiki (Zuriel's staff (bh), Passive effects): standard and Ancient offensive spells cast in 4
// ticks; Ancient Ice spells +10% accuracy, Blood spells heal 50% more, Smoke poison damage and
// Shadow Attack drain +100%.
//
// Real Player, Equipment, Inventory, NPC and plugins; the combat loop runs as the server's tick
// does. Only the network is stubbed.
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

const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers;
const GUARD = 397;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  await new NpcDefinitionLoader().load();
  require("../plugins/items/ItemDefinitionLoader.plugin").register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
  require("../plugins/items/ZurielsStaff.plugin").register(PluginManager.createApi("ZurielsStaffPlugin"));
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3220, 3220);
  core.Projectile.prototype.sendProjectile = function () {};
});

let index = 3300;
function wielder(t, weapon = I.ZURIELS_STAFF_BH_) {
  const player = new Player(null);
  player.setUsername(`zuriel${index}`);
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
  player.setSpellbook(MagicSpellbook.NORMAL);
  player.getEquipment().set(core.Equipment.WEAPON_SLOT, new core.Item(weapon));
  player.getInventory().add(new core.Item(I.FIRE_RUNE, 1000));
  player.getInventory().add(new core.Item(I.AIR_RUNE, 1000));
  for (const rune of [I.DEATH_RUNE, I.WATER_RUNE, I.BLOOD_RUNE, I.CHAOS_RUNE, I.SOUL_RUNE]) player.getInventory().add(new core.Item(rune, 1000));
  WeaponInterfaceManager.assign(player);
  core.BonusManager.update(player);
  t.after(() => {
    player.getCombat().reset();
    player.setRegistered(false);
    core.World.unregisterPlayerPosition(player);
  });
  return player;
}

function npc(t) {
  const target = PluginManager.spawnNpc({ id: GUARD, x: 3220, y: 3224 });
  target.setMaxHitpoints(10000);
  target.setHitpoints(10000);
  target.setNeedsPlacement(false);
  target.getMovementQueue().setBlockMovement(true);
  t.after(() => PluginManager.removeNpc(target));
  return target;
}

/** Runs the server's tick for `ticks` ticks and returns the ticks the attacker cast on. */
function castTicks(attacker, target, ticks, recast = null) {
  const casts = [];
  const listener = PluginManager.createApi(`ZurielCasts${index++}`);
  let tick = 0;
  listener.onCustomEvent("combat:attack-started", ({ attacker: who }) => { if (who === attacker) casts.push(tick); });
  for (tick = 0; tick < ticks; tick++) {
    if (recast && attacker.getCombat().getAttackDelay() <= 1 && !attacker.getCombat().getCastSpell()) recast();
    core.World.processCycle++;
    core.TaskManager.process();
    attacker.getCombat().preMovementProcess();
    attacker.getMovementQueue().process();
    attacker.getCombat().postMovementProcess();
    target.getCombat().getHitQueue().process(core.World.processCycle);
  }
  return casts;
}

const gaps = (ticks) => ticks.slice(1).map((tick, i) => tick - ticks[i]);
const { AccuracyFormulasDpsCalc } = require("../dist/game/content/combat/formula/AccuracyFormulasDpsCalc");
const { CombatFactory } = require("../dist/game/content/combat/CombatFactory");

function castGaps(t, { weapon = I.ZURIELS_STAFF_BH_, book = MagicSpellbook.NORMAL, spell, autocast = false }) {
  const player = wielder(t, weapon);
  player.setSpellbook(book);
  const target = npc(t);
  let recast = null;
  if (autocast) {
    Autocasting.setAutocast(player, spell);
    player.getCombat().attack(target);
  } else {
    recast = () => player.getCombat().castSpellOn(target, spell);
    recast();
  }
  const casts = castTicks(player, target, 18, recast);
  assert.ok(casts.length >= 3, `cast ${casts.length} times`);
  return [...new Set(gaps(casts))];
}

test("standard spells cast every 4 ticks with the staff, autocast or by hand", (t) => {
  assert.deepEqual(castGaps(t, { spell: core.CombatSpells.FIRE_BLAST, autocast: true }), [4]);
  assert.deepEqual(castGaps(t, { spell: core.CombatSpells.FIRE_BLAST }), [4]);
});

test("Ancient Magicks cast every 4 ticks with the staff", (t) => {
  assert.deepEqual(castGaps(t, { book: MagicSpellbook.ANCIENT, spell: core.CombatSpells.BLOOD_BARRAGE }), [4]);
  assert.deepEqual(castGaps(t, { book: MagicSpellbook.ANCIENT, spell: core.CombatSpells.ICE_BURST, autocast: true }), [4]);
});

test("another staff keeps the spells' 5 ticks", (t) => {
  assert.deepEqual(castGaps(t, { weapon: I.NIGHTMARE_STAFF, spell: core.CombatSpells.FIRE_BLAST, autocast: true }), [5]);
  assert.deepEqual(castGaps(t, { weapon: I.NIGHTMARE_STAFF, book: MagicSpellbook.ANCIENT, spell: core.CombatSpells.BLOOD_BARRAGE }), [5]);
});

test("the inactive staff keeps 5 ticks; Arceuus spells keep their own speed", (t) => {
  const { attackSpeed } = require("../plugins/items/ZurielsStaff.plugin")._test;
  const speedWith = (weapon, spell, speed = spell.getAttackSpeed()) => {
    const player = wielder(t, weapon);
    player.getCombat().setCastSpell(spell);
    const event = { attacker: player, combatType: core.CombatType.MAGIC, speed };
    attackSpeed(event);
    return event.speed;
  };
  assert.equal(speedWith(I.ZURIELS_STAFF_BH_, core.CombatSpells.FIRE_BLAST), 4);
  assert.equal(speedWith(I.ZURIELS_STAFF_BH_INACTIVE_, core.CombatSpells.FIRE_BLAST), 5);
  const arceuus = core.CombatSpells.INFERIOR_DEMONBANE;
  assert.equal(speedWith(I.ZURIELS_STAFF_BH_, arceuus), arceuus.getAttackSpeed(), "its own speed");
  assert.equal(speedWith(I.ZURIELS_STAFF_BH_, arceuus, 5), 5, "never capped by the staff");
});

function magicRoll(player, spell) {
  player.getCombat().setCastSpell(spell);
  return AccuracyFormulasDpsCalc.attackMagicRoll(player);
}

test("Ice spells roll 10% more Magic accuracy with the staff; other spells and staves don't", (t) => {
  const player = wielder(t);
  player.setSpellbook(MagicSpellbook.ANCIENT);
  const blood = magicRoll(player, core.CombatSpells.BLOOD_BARRAGE);
  for (const ice of ["ICE_RUSH", "ICE_BURST", "ICE_BLITZ", "ICE_BARRAGE"]) {
    assert.equal(magicRoll(player, core.CombatSpells[ice]), Math.floor(blood * 110 / 100), ice);
  }
  const other = wielder(t, I.ANCIENT_STAFF);
  other.setSpellbook(MagicSpellbook.ANCIENT);
  assert.equal(magicRoll(other, core.CombatSpells.ICE_BARRAGE), magicRoll(other, core.CombatSpells.BLOOD_BARRAGE));
});

const fakeHit = (cast, target, damage, accurate = true) => ({
  isAccurate: () => accurate, getAttacker: () => cast, getTarget: () => target, getTotalDamage: () => damage,
});

test("Blood spells heal 50% more with the staff", (t) => {
  for (const [weapon, healed] of [[I.ZURIELS_STAFF_BH_, 15], [I.ANCIENT_STAFF, 10]]) {
    const player = wielder(t, weapon);
    player.setHitpoints(50);
    core.CombatSpells.BLOOD_BARRAGE.onHitCalc(fakeHit(player, npc(t), 40)); // 40 × 0.25 (× 1.5)
    assert.equal(player.getHitpoints(), 50 + healed, String(weapon));
  }
});

test("Smoke spells poison twice as hard with the staff", (t) => {
  t.mock.method(core.Misc, "getRandom", () => 0); // the 1-in-8 poison roll lands
  for (const [weapon, rush, barrage] of [[I.ZURIELS_STAFF_BH_, 20, 40], [I.ANCIENT_STAFF, 10, 20]]) {
    const severities = [];
    const poison = t.mock.method(CombatFactory, "poisonEntity", (_e, severity) => severities.push(severity));
    const player = wielder(t, weapon);
    core.CombatSpells.SMOKE_RUSH.onHitCalc(fakeHit(player, npc(t), 5));
    core.CombatSpells.SMOKE_BARRAGE.onHitCalc(fakeHit(player, npc(t), 5));
    poison.mock.restore();
    assert.deepEqual(severities, [rush, barrage], String(weapon));
  }
});

test("Shadow spells drain twice the Attack with the staff", (t) => {
  for (const [weapon, multiplier] of [[I.ZURIELS_STAFF_BH_, 2], [I.ANCIENT_STAFF, 1]]) {
    for (const [spell, percent] of [["SHADOW_RUSH", 0.1], ["SHADOW_BARRAGE", 0.15]]) {
      const target = npc(t);
      const level = target.getCurrentLevel(core.Skill.ATTACK);
      assert.ok(level >= 10, `guard Attack ${level}`);
      core.CombatSpells[spell].onHitCalc(fakeHit(wielder(t, weapon), target, 5));
      assert.equal(target.getCurrentLevel(core.Skill.ATTACK), level - Math.floor(level * percent * multiplier), `${weapon} ${spell}`);
    }
  }
});

test("Ice spells' freeze stays the spell's own", (t) => {
  for (const weapon of [I.ZURIELS_STAFF_BH_, I.ANCIENT_STAFF]) {
    const ticks = [];
    const freeze = t.mock.method(CombatFactory, "freezeTicks", (_e, n) => ticks.push(n));
    core.CombatSpells.ICE_BARRAGE.onHitCalc(fakeHit(wielder(t, weapon), npc(t), 5));
    freeze.mock.restore();
    assert.deepEqual(ticks, [32], String(weapon));
  }
});
