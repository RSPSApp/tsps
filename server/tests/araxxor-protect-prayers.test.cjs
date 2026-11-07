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
