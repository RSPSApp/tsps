// Run after `yarn build`: node --test tests/araxxor-protect-prayers.test.cjs
// Wiki (Araxxor): protection prayers cap the melee jab at 5 and cut missiles by 45% and magic by 50%. The
// plugin applies those itself, so the engine must not apply the prayer a second time (at the roll or when
// the hit lands), which zeroed every hit. Real engine: every plugin loaded, a real Player with the prayer
// activated through PrayerHandler, a real Araxxor NPC, its combat method's hits and the impact stage
// (CombatFactory.applyHitTimeDefences) each hit passes through when it lands.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { NPC } = require("../dist/game/entity/impl/npc/NPC");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { CombatFactory } = require("../dist/game/content/combat/CombatFactory");
const { PrayerHandler } = require("../dist/game/content/PrayerHandler");
const Combat = require("../plugins/bosses/araxxor/Combat.Araxxor");
const Shared = require("../plugins/bosses/araxxor/Shared.Araxxor");

const ATTACKS = 300;
let core;
let next = 9730;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  new NpcDefinitionLoader().load(); // her real combat stats (max hit), as the server loads them
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

/** Lands ATTACKS of one style on a player (praying `prayer`, or not), returning the landed damage. */
function land(t, kind, prayer) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("arax" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(3632, 9817, 0));
  p.needsPlacement = false;
  t.after(() => p.setRegistered(false));
  for (const skill of [core.Skill.PRAYER, core.Skill.HITPOINTS]) p.getSkillManager().setMaxLevels(skill, 99, false).setCurrentLevels(skill, 99, false);
  if (prayer) {
    PrayerHandler.activatePrayerPrayerId(p, PrayerHandler[prayer]);
    assert.ok(PrayerHandler.isActivated(p, PrayerHandler[prayer]));
  }
  // Adjacent for the jab; out of reach for her ranged and magic.
  const npc = new NPC(Shared.BOSS_ID, new core.Location(kind === "MELEE" ? 3633 : 3620, 9817, 0));
  const method = new (Combat.combatClass())();
  method.attack = Shared.Attack[kind];
  const landed = [];
  for (let i = 0; i < ATTACKS; i++) {
    const [hit] = method.hits(npc, p);
    CombatFactory.applyHitTimeDefences(hit);
    landed.push(hit.getTotalDamage());
  }
  return landed;
}

for (const [kind, prayer, cap, label] of [
  ["MELEE", "PROTECT_FROM_MELEE", Shared.PROTECT_MELEE_CAP, "the jab is capped at 5"],
  ["RANGED", "PROTECT_FROM_MISSILES", Math.floor(Shared.RANGED_MAX * Shared.PROTECT_RANGED_FACTOR), "missiles take 55%"],
  ["MAGIC", "PROTECT_FROM_MAGIC", Math.floor(Shared.MAGIC_MAX * Shared.PROTECT_MAGIC_FACTOR), "magic takes 50%"],
]) {
  test(`through the matching protection prayer ${label}, not 0`, (t) => {
    const landed = land(t, kind, prayer);
    assert.ok(landed.some((damage) => damage > 0), "some hits land");
    assert.ok(Math.max(...landed) <= cap, `none above ${cap}: ${Math.max(...landed)}`);
  });
}

test("off prayer every style still hits up to its full max", (t) => {
  for (const [kind, max] of [["MELEE", Shared.MELEE_MAX], ["RANGED", Shared.RANGED_MAX], ["MAGIC", Shared.MAGIC_MAX]]) {
    const landed = land(t, kind, null);
    assert.ok(Math.max(...landed) > (kind === "MELEE" ? Shared.PROTECT_MELEE_CAP : 0), `${kind} lands`);
    assert.ok(Math.max(...landed) <= max, `${kind} within ${max}`);
  }
});

test("the wrong protection prayer does not reduce the jab", (t) => {
  const landed = land(t, "MELEE", "PROTECT_FROM_MAGIC");
  assert.ok(Math.max(...landed) > Shared.PROTECT_MELEE_CAP, `above the cap: ${Math.max(...landed)}`);
});

// Aranea boots (Wiki; rsprox 4060, 4067): the ranged shot is negated at most once every 8 ticks and a hit the
// boots stop splats a 0 and drains nothing; magic is not negated. Drains take 9% rounded down, and a 0 drains nothing.
function bootsPlayer(t, boots) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("arax" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(3632, 9817, 0));
  p.needsPlacement = false;
  t.after(() => p.setRegistered(false));
  for (const skill of [core.Skill.DEFENCE, core.Skill.PRAYER, core.Skill.HITPOINTS]) p.getSkillManager().setMaxLevels(skill, 99, false).setCurrentLevels(skill, 99, false);
  if (boots) p.getEquipment().setItem(core.Equipment.FEET_SLOT, new core.Item(boots, 1));
  const messages = [];
  p.sendMessage = (text) => messages.push(text);
  p.getPacketSender().sendTypedMessage = (type, text) => messages.push(text);
  return { p, messages };
}

function rangedHit(p) {
  const npc = new NPC(Shared.BOSS_ID, new core.Location(3620, 9817, 0));
  const method = new (Combat.combatClass())();
  method.attack = Shared.Attack.RANGED;
  method.shotDelay = 4;
  return { method, npc, hit: () => method.hits(npc, p)[0] };
}

function damagingRanged(p) {
  for (let i = 0; i < 500; i++) {
    const { hit } = rangedHit(p);
    p.setAttribute(Shared.ARANEA_RANGED_ATTRIBUTE, 0);
    const h = hit();
    CombatFactory.applyHitTimeDefences(h);
    if (h.getTotalDamage() > 0) return true;
  }
  return false;
}

test("Aranea boots negate a ranged shot that would hit, then stay on cooldown for 8 ticks", (t) => {
  const { p, messages } = bootsPlayer(t, core.ItemIdentifiers.ARANEA_BOOTS);
  const { method, npc } = rangedHit(p);
  let negated = 0;
  for (let i = 0; i < 300; i++) {
    p.setAttribute(Shared.ARANEA_RANGED_ATTRIBUTE, 0);
    const before = messages.length;
    const [hit] = method.hits(npc, p);
    if (messages.length > before) {
      negated++;
      assert.equal(messages[messages.length - 1], Shared.ARANEA_MESSAGE);
      assert.equal(hit.getTotalDamage(), 0, "a negated shot lands as 0");
      // Cooldown: the very next shot in the same cycle is not negated again.
      const again = messages.length;
      let landed = false;
      for (let j = 0; j < 100 && !landed; j++) {
        const [next] = method.hits(npc, p);
        assert.equal(messages.length, again, "no second message inside the cooldown");
        landed = next.getTotalDamage() > 0;
      }
      assert.ok(landed, "damage lands again while the boots recharge");
      assert.ok(p.getAttribute(Shared.ARANEA_RANGED_ATTRIBUTE) >= core.World.getProcessCycle() + Shared.ARANEA_RANGED_COOLDOWN_TICKS);
    }
  }
  assert.ok(negated > 100, `most shots that would hit were negated: ${negated}`);
});

test("without Aranea boots the ranged shot is never negated, and magic is not either", (t) => {
  const bare = bootsPlayer(t, null);
  assert.ok(damagingRanged(bare.p));
  assert.equal(bare.messages.filter((m) => m === Shared.ARANEA_MESSAGE).length, 0);
  const worn = bootsPlayer(t, core.ItemIdentifiers.ARANEA_BOOTS_5);
  const npc = new NPC(Shared.BOSS_ID, new core.Location(3620, 9817, 0));
  const method = new (Combat.combatClass())();
  method.attack = Shared.Attack.MAGIC;
  method.shotDelay = 4;
  let landed = 0;
  for (let i = 0; i < 200; i++) landed += method.hits(npc, worn.p)[0].getTotalDamage() > 0 ? 1 : 0;
  assert.ok(landed > 0, "magic still lands through the boots");
  assert.equal(worn.messages.length, 0);
});

test("her drains take 9% rounded down and nothing from a 0", (t) => {
  const { p } = bootsPlayer(t, null);
  p.getSkillManager().setCurrentLevels(core.Skill.DEFENCE, 77, false);
  Combat.drainSkill(p, core.Skill.DEFENCE, Shared.DRAIN_RANGED_DEFENCE);
  assert.equal(p.getSkillManager().getCurrentLevel(core.Skill.DEFENCE), 71, "captured 77 -> 71");
  p.getSkillManager().setCurrentLevels(core.Skill.DEFENCE, 86, false);
  Combat.drainSkill(p, core.Skill.DEFENCE, Shared.DRAIN_RANGED_DEFENCE);
  assert.equal(p.getSkillManager().getCurrentLevel(core.Skill.DEFENCE), 79, "captured 86 -> 79");
  const method = new (Combat.combatClass())();
  const zero = { getTarget: () => p, getTotalDamage: () => 0, araxxorKind: Shared.Attack.RANGED };
  method.handleAfterHitEffects(zero);
  assert.equal(p.getSkillManager().getCurrentLevel(core.Skill.DEFENCE), 79, "a 0 drains nothing");
  method.handleAfterHitEffects({ ...zero, getTotalDamage: () => 5 });
  assert.equal(p.getSkillManager().getCurrentLevel(core.Skill.DEFENCE), 72, "79 - floor(7.11)");
});

test("the enraged cleave is negated once per 20 ticks while the boots are worn", (t) => {
  const { p, messages } = bootsPlayer(t, core.ItemIdentifiers.ARANEA_BOOTS);
  const { _test } = Combat;
  const now = core.World.getProcessCycle();
  assert.equal(_test.araneaNegates(p, Shared.ARANEA_CLEAVE_ATTRIBUTE, Shared.ARANEA_CLEAVE_COOLDOWN_TICKS, 0), false, "a 0 is not negated");
  assert.equal(_test.araneaNegates(p, Shared.ARANEA_CLEAVE_ATTRIBUTE, Shared.ARANEA_CLEAVE_COOLDOWN_TICKS, 17), true);
  assert.equal(messages.at(-1), Shared.ARANEA_MESSAGE);
  assert.equal(p.getAttribute(Shared.ARANEA_CLEAVE_ATTRIBUTE), now + 20);
  assert.equal(_test.araneaNegates(p, Shared.ARANEA_CLEAVE_ATTRIBUTE, Shared.ARANEA_CLEAVE_COOLDOWN_TICKS, 17), false, "on cooldown");
  // The cleave's cooldown is separate from the ranged shot's.
  assert.equal(_test.araneaNegates(p, Shared.ARANEA_RANGED_ATTRIBUTE, Shared.ARANEA_RANGED_COOLDOWN_TICKS, 9), true);
});
