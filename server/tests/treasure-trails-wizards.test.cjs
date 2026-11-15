// Run after `yarn build`: node --test tests/treasure-trails-wizards.test.cjs
// rsprox_transcripts/236/03930.txt (Zamorak wizard, ticks 180-263), 227/00091.txt (Saradomin wizard),
// 227/00127.txt (double agent).
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { NPC } = require("../dist/game/entity/impl/npc/NPC");

const real = PluginManager.getCoreApi();
let nextHitAccurate = true;
class FakeHit {
  constructor(attacker, target, method, delay) {
    Object.assign(this, { attacker, target, method, delay, damage: 0, accurate: nextHitAccurate });
  }
  isAccurate() { return this.accurate; }
  setTotalDamage(value) { this.damage = value; }
}
const providers = [];
const core = {
  ...real,
  PendingHit: FakeHit,
  CombatFactory: { ...real.CombatFactory, applyStyleDamage: (hit, maxHit) => hit.setTotalDamage(maxHit) },
};
const Wizards = require("../plugins/treasuretrails/trails/Wizards.TreasureTrails");

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
  new NpcDefinitionLoader().load();
  Wizards.attach({ core, registerNpcCombatMethodProvider: (ids, ctor, options) => providers.push({ ids, ctor, options }) });
});

function wizard() {
  const shown = [];
  const definition = real.NpcDefinition.forId(real.NpcIdentifiers.ZAMORAK_WIZARD);
  return { shown, getDefinition: () => definition, performAnimation: (a) => shown.push(`anim ${a.getId()}`) };
}

function player() {
  const p = new Player(null);
  p.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  const messages = [], graphics = [];
  p.sendMessage = (text) => messages.push(text);
  p.performGraphic = (g) => graphics.push(`graphic ${g.getId()} height ${g.getHeight()} delay ${g.getDelay()}`);
  return { p, messages, graphics };
}

test("each trail fight calls out its recorded line as it appears", () => {
  const N = real.NpcIdentifiers;
  const said = [];
  for (const id of [N.ZAMORAK_WIZARD, N.SARADOMIN_WIZARD, N.DOUBLE_AGENT, N.DOUBLE_AGENT_2, N.DOUBLE_AGENT_3, N.MAN])
    Wizards.shout({ forceChat: (text) => said.push([id, text]) }, id);
  assert.deepEqual(said, [
    [N.ZAMORAK_WIZARD, "Die, human!"], [N.SARADOMIN_WIZARD, "For Saradomin!"],
    [N.DOUBLE_AGENT, "I expect you to die!"], [N.DOUBLE_AGENT_2, "I expect you to die!"], [N.DOUBLE_AGENT_3, "I expect you to die!"],
  ]);
});

test("the Zamorak wizard casts Flames of Zamorak: flame on a hit, Magic drained once with the message", () => {
  assert.deepEqual(providers.map((entry) => entry.ids), [[real.NpcIdentifiers.ZAMORAK_WIZARD], [real.NpcIdentifiers.SARADOMIN_WIZARD]]);
  const Method = providers[0].ctor;
  const method = new Method();
  assert.equal(method.type(), real.CombatType.MAGIC);
  assert.equal(method.attackSpeed(), 4);
  const npc = wizard();
  const { p, messages, graphics } = player();
  const skills = p.getSkillManager();
  skills.setMaxLevel(real.Skill.MAGIC, 99).setCurrentLevel(real.Skill.MAGIC, 99, false);

  nextHitAccurate = true;
  method.start(npc, p);
  const [hit] = method.hits(npc, p);
  assert.deepEqual(npc.shown, ["anim 811"]);
  assert.equal(hit.delay, 1, "the damage lands a tick after the cast");
  assert.equal(hit.damage, 20, "Wiki max hit 20");
  assert.deepEqual(graphics, ["graphic 78 height 0 delay 64"]);
  assert.equal(skills.getCurrentLevel(real.Skill.MAGIC), 94, "99 to 94, as recorded");
  assert.deepEqual(messages, ["You feel your magical powers weaken."]);

  // A second hit while Magic is still lowered drains nothing and says nothing (tick 192).
  graphics.length = 0;
  method.hits(npc, p);
  assert.deepEqual(graphics, ["graphic 78 height 0 delay 64"]);
  assert.equal(skills.getCurrentLevel(real.Skill.MAGIC), 94);
  assert.equal(messages.length, 1);
});

test("a missed Flames of Zamorak shows the splash and drains nothing", () => {
  const method = new providers[0].ctor();
  const { p, messages, graphics } = player();
  const skills = p.getSkillManager();
  skills.setMaxLevel(real.Skill.MAGIC, 99).setCurrentLevel(real.Skill.MAGIC, 99, false);
  nextHitAccurate = false;
  method.hits(wizard(), p);
  nextHitAccurate = true;
  assert.deepEqual(graphics, ["graphic 85 height 124 delay 56"]);
  assert.equal(skills.getCurrentLevel(real.Skill.MAGIC), 99);
  assert.deepEqual(messages, []);
});

test("the Saradomin wizard counters protection prayers only within melee distance (Wiki Saradomin wizard)", () => {
  assert.equal(Wizards.chooseStyle(true, false), "melee", "next to the player with no Protect from Melee: dagger");
  assert.equal(Wizards.chooseStyle(true, true), "magic", "Protect from Melee next to it: Saradomin Strike");
  assert.equal(Wizards.chooseStyle(false, false), "magic", "out of melee distance: only Magic");
  assert.equal(Wizards.chooseStyle(false, true), "magic");

  const { PrayerHandler, CombatType } = real;
  const method = new providers[1].ctor();
  const wizardAt = (distance) => ({ calculateDistance: () => distance, performAnimation() {}, getAttackAnim: () => -1, getAttackSound: () => null });
  const praying = (prayer) => ({ isPlayer: () => true, getAsPlayer: () => ({}), prayer });
  const original = PrayerHandler.isActivated;
  try {
    let active = null;
    PrayerHandler.isActivated = (_, prayer) => prayer === active;
    const pick = (distance, prayer) => { active = prayer; return method.choose(wizardAt(distance), praying(prayer)); };

    assert.equal(pick(1, null), "melee");
    assert.equal(method.type(), CombatType.MELEE);
    assert.equal(pick(1, PrayerHandler.PROTECT_FROM_MELEE), "magic");
    assert.equal(method.type(), CombatType.MAGIC);
    assert.equal(pick(1, PrayerHandler.PROTECT_FROM_MAGIC), "melee", "melee against Protect from Magic");
    assert.equal(method.type(), CombatType.MELEE);
    assert.equal(pick(5, PrayerHandler.PROTECT_FROM_MAGIC), "magic", "at range it keeps casting");
    assert.equal(pick(5, null), "magic");
  } finally {
    PrayerHandler.isActivated = original;
  }
});

// Reviewer: a wizard with a reach of 10 stood where it spawned, so it never got into melee range to counter anything.
test("a Saradomin wizard three tiles away walks up beside a player praying Protect from Magic", (t) => {
  const registered = [];
  const api = PluginManager.createApi("SaradominWizardWalkTest");
  Wizards.attach({ ...api, registerNpcCombatMethodProvider: (ids, ctor, options) => { registered.push(ids); api.registerNpcCombatMethodProvider(ids, ctor, options); } });
  assert.deepEqual(registered.at(-1), [real.NpcIdentifiers.SARADOMIN_WIZARD]);

  let cycle = 1000;
  t.mock.method(real.World, "getProcessCycle", () => cycle);
  const tasks = [];
  t.mock.method(real.TaskManager, "submit", (task) => { task.setRunning(true); tasks.push(task); });
  const sender = new Proxy({ getVarbit: () => 0, getVarp: () => 0 }, { get: (object, key) => object[key] ?? (() => sender) });
  const p = new Player(null);
  p.setUsername("wizard-walk");
  p.getPacketSender = () => sender;
  p.getSession = () => ({ sendClientPacket: () => true, processPackets: () => {} });
  p.setLocation(new real.Location(3220, 3220, 0));
  p.setRegistered(true);
  p.setNeedsPlacement(false);
  p.autoRetaliateReturn = () => false; // the player stands still, as in the review
  for (const skill of real.Skill.values()) p.getSkillManager().setCurrentLevel(skill, 99).setMaxLevel(skill, 99);
  p.getPrayerActive()[real.PrayerHandler.PROTECT_FROM_MAGIC] = true;

  const npc = NPC.create(real.NpcIdentifiers.SARADOMIN_WIZARD, new real.Location(3220, 3223, 0));
  npc.setSpawnPosition(new real.Location(3220, 3223, 0));
  npc.isRegistered = () => true;
  npc.setNeedsPlacement(false);
  Wizards.closeIn(npc, real.NpcIdentifiers.SARADOMIN_WIZARD);
  t.after(() => { real.World.unregisterNpcPosition(npc); real.World.unregisterPlayerPosition(p); });
  assert.equal(npc.getLocation().getY() - p.getLocation().getY(), 3);

  npc.getCombat().attack(p);
  for (let i = 0; i < 24; i++) {
    cycle++;
    for (let j = tasks.length - 1; j >= 0; j--) if (!(tasks[j].isRunning() && tasks[j].execute() !== false)) tasks.splice(j, 1);
    npc.process();
    const combat = p.getCombat(), movement = p.getMovementQueue();
    combat.getHitQueue().process(cycle);
    p.getTimers().process();
    movement.beginCycle();
    if (combat.hasPendingWork()) combat.preMovementProcess();
    if (movement.hasPendingWork()) movement.process();
    if (combat.hasPendingWork()) combat.postMovementProcess();
  }
  console.log("DBG", npc.getLocation().getY() - p.getLocation().getY(), real.CombatFactory.getMethod(npc).constructor.name, real.CombatFactory.getMethod(npc).attackDistance(npc), npc.hasFlag("combat:close-in"));
  assert.equal(real.CombatRange.beside(npc, p), true, "it closes to melee distance instead of casting from three tiles away");
});
