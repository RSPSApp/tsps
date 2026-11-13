// Run after `yarn build`: node --test tests/lunar-dream-poison-wake.test.cjs
// Wiki (Dream): "Poison damage will interrupt the dream." Dream kept sleeping (and healing) through
// poison splats; only an action or full Hitpoints ended it. Real Player, real hit queue and tasks.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { LunarSpells } = require("../dist/game/content/combat/magic/LunarSpells");
const { TaskManager } = require("../dist/game/task/TaskManager");
const { HitDamage } = require("../dist/game/content/combat/hit/HitDamage");
const { HitMask } = require("../dist/game/content/combat/hit/HitMask");

let core;
let cycle = 5000;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  // Dream Mentor gives Dream (Wiki); the quest plugins are not loaded here.
  PluginManager.createApi("DreamMentorDone").onCustomEvent("quest:is-complete", (q) => { if (q.key === "dream_mentor") q.complete = true; });
});

function dreamer() {
  const p = new Player(null);
  p.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  p.isRegistered = () => true;
  p.setUsername("lunar-dreamer");
  p.setSpellbook(core.MagicSpellbook.LUNAR);
  for (const skill of [core.Skill.MAGIC, core.Skill.DEFENCE, core.Skill.HITPOINTS]) p.getSkillManager().setLevel(skill, 99);
  p.getSkillManager().setCurrentLevel(core.Skill.HITPOINTS, 50, false);
  const I = core.ItemIdentifiers;
  for (const [slot, id] of [I.ASTRAL_RUNE, I.COSMIC_RUNE, I.BODY_RUNE].entries()) p.getInventory().setItem(slot, new core.Item(id, 100));
  return p;
}

/** One game tick: the player's hit queue, then tasks. */
function tick(p) {
  cycle++;
  p.getCombat().getHitQueue().process(cycle);
  TaskManager.process();
}

test("a poison splat wakes the dreamer; a red hit does not", () => {
  const p = dreamer();
  const animations = [];
  const perform = p.performAnimation.bind(p);
  p.performAnimation = (animation) => { animations.push(animation.getId()); return perform(animation); };
  assert.equal(LunarSpells.handleSelf(p, "Dream"), true);
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.ASTRAL_RUNE), 98, "the cast was paid");
  for (let i = 0; i < 3; i++) tick(p);
  assert.ok(!animations.includes(-1), "still dreaming");

  p.getCombat().getHitQueue().addPendingDamage([new HitDamage(2, HitMask.RED)]);
  for (let i = 0; i < 2; i++) tick(p);
  assert.ok(!animations.includes(-1), "an ordinary hit does not wake (auto-retaliate is what breaks it then)");

  p.getCombat().getHitQueue().addPendingDamage([new HitDamage(3, HitMask.GREEN)]);
  for (let i = 0; i < 2; i++) tick(p);
  assert.ok(animations.includes(-1), "poison damage woke the dreamer");

  const hp = p.getSkillManager().getCurrentLevel(core.Skill.HITPOINTS);
  for (let i = 0; i < 40; i++) tick(p);
  assert.equal(p.getSkillManager().getCurrentLevel(core.Skill.HITPOINTS), hp, "no more dream healing once awake");
});

test("a poison splat wakes the dreamer even when another hit lands after it on the same tick", () => {
  const p = dreamer();
  const animations = [];
  const perform = p.performAnimation.bind(p);
  p.performAnimation = (animation) => { animations.push(animation.getId()); return perform(animation); };
  LunarSpells.handleSelf(p, "Dream");
  tick(p);
  p.getCombat().getHitQueue().addPendingDamage([new HitDamage(3, HitMask.GREEN), new HitDamage(2, HitMask.RED)]);
  for (let i = 0; i < 3; i++) tick(p);
  assert.ok(animations.includes(-1), "poison damage woke the dreamer");
});

test("without poison the dream keeps healing", () => {
  const p = dreamer();
  LunarSpells.handleSelf(p, "Dream");
  const hp = p.getSkillManager().getCurrentLevel(core.Skill.HITPOINTS);
  for (let i = 0; i < 34; i++) tick(p);
  assert.equal(p.getSkillManager().getCurrentLevel(core.Skill.HITPOINTS), hp + 1, "1 Hitpoint after 20 s");
});
