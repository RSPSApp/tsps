// Run after `yarn build`: node --test tests/twinflame-staff.test.cjs
//
// Wiki (Twinflame staff): an attack and cast speed of 6; autocasting at an NPC with a different
// elemental weakness casts that element's spell instead, given the Magic level and runes (level 75
// Wind Wave at a moss giant casts Fire Wave), the Royal Titans' walls included; each standard
// elemental spell, Strike to Surge, fires a second spell for floor(40%) of the first's damage a
// tick later, with no XP, runes or tome charges.
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

const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers;
const S = () => core.CombatSpells;
const MOSS_GIANT = 2090; // 50% fire weakness
const GUARD = 397; // no elemental weakness
let Twinflame;
let accurate = true;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  await new NpcDefinitionLoader().load();
  require("../plugins/items/ItemDefinitionLoader.plugin").register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
  require("../plugins/combat/ElementalSpells.plugin").register(PluginManager.createApi("TwinflameElementalSpells"));
  require("../plugins/items/ElementalStaves.plugin").register(PluginManager.createApi("TwinflameElementalStaves"));
  Twinflame = require("../plugins/items/TwinflameStaff.plugin");
  Twinflame.register(PluginManager.createApi("TwinflamePlugin"));
  // The Royal Titans' walls name their weakness for the swap.
  const Specials = require("../plugins/bosses/royaltitans/Specials.RoyalTitans");
  PluginManager.createApi("TwinflameRows").onCustomEvent("twinflame:weakness", Specials._test.rowWeakness);
  PluginManager.createApi("TwinflameAccuracy").onCombatHitRoll((roll) => { if (accurate) roll.forceAccurate = true; });
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3220, 3220);
  core.Projectile.prototype.sendProjectile = function () {};
});

let index = 3100;
function wielder(t, { weapon = I.TWINFLAME_STAFF, magic = 99 } = {}) {
  const player = new Player(null);
  player.setUsername(`twinflame${index}`);
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
  player.getSkillManager().setMaxLevel(core.Skill.MAGIC, magic);
  player.getSkillManager().setCurrentLevel(core.Skill.MAGIC, magic, false);
  player.setSpellbook(MagicSpellbook.NORMAL);
  player.getEquipment().set(core.Equipment.WEAPON_SLOT, new core.Item(weapon));
  WeaponInterfaceManager.assign(player);
  core.BonusManager.update(player);
  for (const rune of [I.AIR_RUNE, I.EARTH_RUNE, I.MIND_RUNE, I.CHAOS_RUNE, I.DEATH_RUNE, I.BLOOD_RUNE, I.WRATH_RUNE]) {
    player.getInventory().add(new core.Item(rune, 1000));
  }
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

/** Runs the server's tick for the attacker and the target's hit queue: each tick's damage, and the spells cast. */
function fight(attacker, target, ticks) {
  const landed = [];
  const casts = [];
  for (let i = 0; i < ticks; i++) {
    core.World.processCycle++;
    core.TaskManager.process();
    const previous = attacker.getCombat().getPreviousCast();
    const cycle = attacker.getCombat().getAttackDelay();
    attacker.getCombat().preMovementProcess();
    attacker.getMovementQueue().process();
    attacker.getCombat().postMovementProcess();
    if (attacker.getCombat().getAttackDelay() > cycle) casts.push({ tick: i, spell: attacker.getCombat().getPreviousCast() ?? previous });
    const before = target.getHitpoints();
    target.getCombat().getHitQueue().process(core.World.processCycle);
    if (target.getHitpoints() !== before) landed.push({ tick: i, damage: before - target.getHitpoints() });
  }
  return { landed, casts };
}

test("the staff casts at speed 6; a speed already brought lower is kept", (t) => {
  const player = wielder(t);
  const speed = (attacker, combatType, value) => {
    const event = { attacker, target: null, combatType, speed: value };
    Twinflame._test.attackSpeed(event);
    return event.speed;
  };
  assert.equal(speed(player, core.CombatType.MAGIC, 5), 6, "a spell's 5 becomes 6");
  assert.equal(speed(player, core.CombatType.MAGIC, 1), 1, "a 1-tick Royal Titans wall clear stays 1");
  assert.equal(speed(player, core.CombatType.MELEE, 6), 6);
  assert.equal(speed(wielder(t, { weapon: I.STAFF_OF_FIRE }), core.CombatType.MAGIC, 5), 5, "another staff keeps 5");

  accurate = true;
  const target = npc(t, GUARD);
  Autocasting.setAutocast(player, S().FIRE_BOLT);
  player.getCombat().attack(target);
  const { casts } = fight(player, target, 14);
  assert.deepEqual(casts.map((cast) => cast.tick), [0, 6, 12], "a cast every 6 ticks");
});

test("autocasting Wind Wave at a moss giant casts Fire Wave at level 75, and Wind Wave below it", (t) => {
  accurate = true;
  for (const [magic, expected] of [[75, "FIRE_WAVE"], [74, "WIND_WAVE"]]) {
    const player = wielder(t, { magic });
    const target = npc(t, MOSS_GIANT, 3220 + (magic - 74) * 2, 3224);
    Autocasting.setAutocast(player, S().WIND_WAVE);
    player.getCombat().attack(target);
    const { casts } = fight(player, target, 3);
    assert.equal(casts.length, 1, `level ${magic}`);
    assert.equal(casts[0].spell, S()[expected], `level ${magic} casts ${expected}`);
    assert.equal(player.getCombat().getAutocastSpell(), S().WIND_WAVE, "the autocast spell itself stays Wind Wave");
  }
});

test("no swap without the runes, against an NPC with no weakness, by hand, or with another staff", (t) => {
  accurate = true;
  const swapped = (player, target) => {
    const event = { attacker: player, target };
    Twinflame._test.swapForWeakness(event);
    return player.getCombat().getCastSpell();
  };
  // Fire Wave needs blood runes the staff doesn't supply.
  const poor = wielder(t);
  poor.getInventory().resetItems();
  poor.getInventory().add(new core.Item(I.AIR_RUNE, 1000));
  Autocasting.setAutocast(poor, S().WIND_WAVE);
  assert.equal(swapped(poor, npc(t, MOSS_GIANT)), null, "no blood runes: Wind Wave is cast as set");
  const plain = wielder(t);
  Autocasting.setAutocast(plain, S().WIND_WAVE);
  assert.equal(swapped(plain, npc(t, GUARD, 3222)), null, "no weakness");
  const byHand = wielder(t);
  Autocasting.setAutocast(byHand, S().EARTH_WAVE);
  byHand.getCombat().setCastSpell(S().WIND_WAVE);
  assert.equal(swapped(byHand, npc(t, MOSS_GIANT, 3224)), S().WIND_WAVE, "a hand cast stays as chosen");
  const other = wielder(t, { weapon: I.STAFF_OF_AIR });
  Autocasting.setAutocast(other, S().WIND_WAVE);
  assert.equal(swapped(other, npc(t, MOSS_GIANT, 3226)), null, "only the twinflame staff swaps");
  // An autocaster's permission check copies the autocast spell into the cast slot
  // (MagicCombatMethod.canAttack): that is still autocasting, and swaps.
  const copied = wielder(t);
  Autocasting.setAutocast(copied, S().WIND_WAVE);
  copied.getCombat().setCastSpell(S().WIND_WAVE);
  copied.getCombat().setAutocastSpell(S().WIND_WAVE);
  assert.equal(swapped(copied, npc(t, MOSS_GIANT, 3232)), S().FIRE_WAVE, "the autocast spell in the cast slot still swaps");
  // The swap lasts one attack: the next attack decides afresh.
  const player = wielder(t);
  Autocasting.setAutocast(player, S().WIND_WAVE);
  assert.equal(swapped(player, npc(t, MOSS_GIANT, 3228)), S().FIRE_WAVE);
  assert.equal(swapped(player, npc(t, GUARD, 3230)), null, "undone against the next target");
});

test("the Royal Titans' walls: Fire Wave autocast at a fire wall casts Water Wave, Water Wave at an ice wall casts Fire Wave", (t) => {
  const wall = (id) => ({ getId: () => id, isNpc: () => true, getAsNpc() { return this; } });
  const player = wielder(t);
  Autocasting.setAutocast(player, S().FIRE_WAVE);
  Twinflame._test.swapForWeakness({ attacker: player, target: wall(14152) });
  assert.equal(player.getCombat().getCastSpell(), S().WATER_WAVE, "fire wall: water");
  Autocasting.setAutocast(player, S().WATER_WAVE);
  Twinflame._test.swapForWeakness({ attacker: player, target: wall(14153) });
  assert.equal(player.getCombat().getCastSpell(), S().FIRE_WAVE, "ice wall: fire");
  Autocasting.setAutocast(player, S().FIRE_WAVE);
  Twinflame._test.swapForWeakness({ attacker: player, target: wall(14153) });
  assert.equal(player.getCombat().getCastSpell(), null, "fire at an ice wall is already right");
});

test("Strike, Wave and Surge each fire a second spell: floor(40%) of the first a tick later, no XP, no runes", (t) => {
  accurate = true;
  t.mock.method(Math, "random", () => 0.8);
  for (const [i, name] of ["WIND_STRIKE", "FIRE_WAVE", "WATER_SURGE"].entries()) {
    const player = wielder(t);
    const target = npc(t, GUARD, 3220 + i * 2, 3224);
    Autocasting.setAutocast(player, S()[name]);
    const xp = () => player.getSkillManager().getExperience(core.Skill.MAGIC);
    const hpXp = () => player.getSkillManager().getExperience(core.Skill.HITPOINTS);
    const air = player.getInventory().getAmount(I.AIR_RUNE);
    player.getCombat().attack(target);
    const first = fight(player, target, 1);
    const castXp = xp(), castHpXp = hpXp();
    const { landed } = fight(player, target, 4);
    assert.equal(landed.length, 2, `${name}: ${JSON.stringify(landed)}`);
    const [hit, second] = landed;
    assert.equal(second.tick, hit.tick + 1, `${name}: a tick after the first`);
    assert.equal(second.damage, Math.floor(hit.damage * 0.4), `${name}: 40% rounded down`);
    assert.equal(xp(), castXp, `${name}: no Magic XP for the second`);
    assert.equal(hpXp(), castHpXp, `${name}: no Hitpoints XP for the second`);
    const spent = air - player.getInventory().getAmount(I.AIR_RUNE);
    const cost = S()[name].itemsRequired(player).filter((item) => item?.id === I.AIR_RUNE).reduce((sum, item) => sum + item.getAmount(), 0);
    assert.equal(spent, cost, `${name}: one cast's air runes, none for the second`);
    void first;
  }
});

test("a battlestaff and both element staff crowns make the twinflame staff in 4 ticks; any two of them used together", (t) => {
  const make = (pair, have) => {
    const player = wielder(t, { weapon: I.STAFF_OF_FIRE });
    const messages = [];
    player.sendMessage.mock.mockImplementation((text) => messages.push(text));
    player.getInventory().resetItems();
    for (const id of have) player.getInventory().add(new core.Item(id, 1));
    const [used, usedWith] = pair;
    Twinflame._test.createStaff({ player, usedItemId: used, usedWithItemId: usedWith });
    return { player, messages };
  };
  const all = [I.BATTLESTAFF, I.FIRE_ELEMENT_STAFF_CROWN, I.ICE_ELEMENT_STAFF_CROWN];
  const tick = (n) => { for (let i = 0; i < n; i++) { core.World.processCycle++; core.TaskManager.process(); } };
  for (const pair of [[I.FIRE_ELEMENT_STAFF_CROWN, I.ICE_ELEMENT_STAFF_CROWN], [I.FIRE_ELEMENT_STAFF_CROWN, I.BATTLESTAFF],
    [I.BATTLESTAFF, I.ICE_ELEMENT_STAFF_CROWN]]) {
    const { player } = make(pair, all);
    const inventory = player.getInventory();
    const staffSlot = inventory.getSlotForItemId(I.BATTLESTAFF);
    tick(Twinflame._test.CREATE_TICKS - 1);
    assert.equal(inventory.contains(I.TWINFLAME_STAFF), false, "not before the 4th tick");
    tick(1);
    assert.equal(inventory.getItems()[staffSlot].getId(), I.TWINFLAME_STAFF, "made in the battlestaff's slot");
    for (const id of all) assert.equal(inventory.contains(id), false, `${id} used up`);
  }

  // A part missing: the message, and nothing changes.
  const { player, messages } = make([I.FIRE_ELEMENT_STAFF_CROWN, I.BATTLESTAFF], [I.BATTLESTAFF, I.FIRE_ELEMENT_STAFF_CROWN]);
  tick(Twinflame._test.CREATE_TICKS);
  assert.deepEqual(messages, [Twinflame._test.MISSING_PART]);
  assert.equal(player.getInventory().contains(I.TWINFLAME_STAFF), false);
  assert.equal(player.getInventory().contains(I.BATTLESTAFF), true, "the parts are kept");

  // A part gone before the 4th tick (dropped, banked): no staff, the rest kept.
  const dropped = make([I.FIRE_ELEMENT_STAFF_CROWN, I.ICE_ELEMENT_STAFF_CROWN], all).player;
  dropped.getInventory().delete(I.ICE_ELEMENT_STAFF_CROWN, 1);
  tick(Twinflame._test.CREATE_TICKS);
  assert.equal(dropped.getInventory().contains(I.TWINFLAME_STAFF), false);
  assert.equal(dropped.getInventory().contains(I.FIRE_ELEMENT_STAFF_CROWN), true);
});
