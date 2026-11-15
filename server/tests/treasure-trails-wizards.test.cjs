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
  assert.deepEqual(providers.map((entry) => entry.ids), [[real.NpcIdentifiers.ZAMORAK_WIZARD]]);
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
