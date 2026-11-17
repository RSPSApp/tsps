// Run after `yarn build`: node --test tests/keris-partisan-sun.test.cjs
// Keris partisan of the sun (Wiki), only in the Tombs of Amascut: +25% accuracy against targets below 25% health,
// and a kill heals 12 hitpoints (up to 12 over base) for 5 prayer points. Real engine: every plugin loaded, a real
// Player wielding the partisan, real NPCs, the registered accuracy modifiers and a real NPCDeathTask.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { NPCDeathTask } = require("../dist/game/task/impl/NPCDeathTask");
const Effects = require("../dist/game/content/combat/EquipmentEffects");

const TOMBS = [3680, 5280, 0];
const OUTSIDE = [3200, 3200, 0];

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function player(t, weapon, [x, y, z]) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(9977); p.setUsername("sunkeris"); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  t.after(() => p.setRegistered(false));
  p.setLocation(new core.Location(x, y, z));
  p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(weapon, 1));
  return p;
}

function cow(hitpoints) {
  const npc = core.NPC.create(core.NpcIdentifiers.COW, new core.Location(3200, 3200, 0));
  npc.setHitpoints(hitpoints);
  return npc;
}

test("in the tombs the sun partisan rolls 25% more accuracy against a target below 25% health", (t) => {
  const p = player(t, core.ItemIdentifiers.KERIS_PARTISAN_OF_THE_SUN, TOMBS);
  let target = null;
  t.mock.method(p.getCombat(), "getTarget", () => target);
  const roll = (hitpoints) => { target = cow(hitpoints); return Effects.applyMeleeAttackAccuracyModifiers(p, 1000); };
  const max = cow(1).getMaxHitpoints();
  assert.equal(max, 8, "a cow has 8 hitpoints");
  assert.equal(roll(1), 1250, "1/8 hitpoints: below 25%");
  assert.equal(roll(2), 1000, "2/8 is exactly 25%, not below");
  assert.equal(roll(8), 1000, "full health");

  p.setLocation(new core.Location(...OUTSIDE));
  assert.equal(roll(1), 1000, "outside the tombs: no boost");

  p.setLocation(new core.Location(...TOMBS));
  p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(core.ItemIdentifiers.KERIS_PARTISAN, 1));
  assert.equal(roll(1), 1000, "a plain partisan has no boost");
});

function kill(p, npc) {
  npc.getCombat().addDamage(p, 5);
  const task = new NPCDeathTask(npc);
  task.execute();
  task.execute();
}

test("a kill in the tombs heals 12, overheals to 12 over base, and costs 5 prayer", (t) => {
  const p = player(t, core.ItemIdentifiers.KERIS_PARTISAN_OF_THE_SUN, TOMBS);
  const skills = p.getSkillManager();
  const { HITPOINTS, PRAYER } = core.Skill;
  skills.setMaxLevel(HITPOINTS, 99); skills.setMaxLevel(PRAYER, 70);
  const set = (hp, prayer) => { skills.setCurrentLevels(HITPOINTS, hp); skills.setCurrentLevels(PRAYER, prayer); };
  const state = () => [skills.getCurrentLevel(HITPOINTS), skills.getCurrentLevel(PRAYER)];

  set(50, 70); kill(p, cow(8));
  assert.deepEqual(state(), [62, 65], "+12 hitpoints, -5 prayer");

  set(95, 70); kill(p, cow(8));
  assert.deepEqual(state(), [107, 65], "overheals past 99");

  set(105, 70); kill(p, cow(8));
  assert.deepEqual(state(), [111, 65], "capped at base + 12");

  set(111, 70); kill(p, cow(8));
  assert.deepEqual(state(), [111, 70], "at the cap: nothing healed, no prayer spent");

  set(50, 4); kill(p, cow(8));
  assert.deepEqual(state(), [50, 4], "below 5 prayer: no heal");

  set(50, 70); p.setLocation(new core.Location(...OUTSIDE)); kill(p, cow(8));
  assert.deepEqual(state(), [50, 70], "outside the tombs: no heal");

  p.setLocation(new core.Location(...TOMBS));
  p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(core.ItemIdentifiers.KERIS_PARTISAN_OF_AMASCUT, 1));
  set(50, 70); kill(p, cow(8));
  assert.deepEqual(state(), [50, 70], "another partisan: no heal");
});

test("the heal goes to the player who landed the killing hit, not the top damager", (t) => {
  const top = player(t, core.ItemIdentifiers.KERIS_PARTISAN_OF_THE_SUN, TOMBS);
  const finisher = player(t, core.ItemIdentifiers.KERIS_PARTISAN_OF_THE_SUN_2, TOMBS);
  finisher.setIndex(9976); finisher.setUsername("sunfinisher");
  for (const p of [top, finisher]) {
    p.getSkillManager().setMaxLevel(core.Skill.HITPOINTS, 99);
    p.getSkillManager().setCurrentLevels(core.Skill.HITPOINTS, 50);
    p.getSkillManager().setCurrentLevels(core.Skill.PRAYER, 70);
  }
  const npc = cow(8);
  npc.getCombat().addDamage(top, 7);
  npc.getCombat().addDamage(finisher, 1);
  const task = new NPCDeathTask(npc);
  task.execute();
  task.execute();
  assert.equal(top.getSkillManager().getCurrentLevel(core.Skill.HITPOINTS), 50, "top damager: no heal");
  assert.equal(finisher.getSkillManager().getCurrentLevel(core.Skill.HITPOINTS), 62, "killing hit: healed");
});

test("the heal follows the weapon that killed, not one swapped to during the death", (t) => {
  const p = player(t, core.ItemIdentifiers.KERIS_PARTISAN_OF_THE_SUN, TOMBS);
  const skills = p.getSkillManager();
  const { HITPOINTS, PRAYER } = core.Skill;
  skills.setMaxLevel(HITPOINTS, 99);
  const wield = (id) => p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(id, 1));
  const killSwapping = (killWeapon, swapTo) => {
    skills.setCurrentLevels(HITPOINTS, 50); skills.setCurrentLevels(PRAYER, 70);
    wield(killWeapon);
    const npc = cow(8);
    npc.getCombat().addDamage(p, 5);
    const task = new NPCDeathTask(npc);
    task.execute();
    wield(swapTo);
    task.execute();
    return [skills.getCurrentLevel(HITPOINTS), skills.getCurrentLevel(PRAYER)];
  };
  const SUN = core.ItemIdentifiers.KERIS_PARTISAN_OF_THE_SUN;
  const WHIP = core.ItemIdentifiers.ABYSSAL_WHIP;
  assert.deepEqual(killSwapping(SUN, WHIP), [62, 65], "killed with the partisan, swapped away: healed");
  assert.deepEqual(killSwapping(WHIP, SUN), [50, 70], "killed with a whip, swapped to the partisan: no heal");
});
