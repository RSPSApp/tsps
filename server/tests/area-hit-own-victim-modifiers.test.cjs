// Run after `yarn build`: node --test tests/area-hit-own-victim-modifiers.test.cjs
// Target-sensitive max-hit modifiers judge an area hit by its own victim, not the attacker's combat target: a keris
// (Wiki: +33% against kalphites and scabarites) and a rat bone weapon (Wiki: +10 max hit against rats) rolled at a
// secondary victim while the combat target is another NPC. Real engine: every plugin loaded with the NPC definitions,
// a real Player, real NPCs, the real hit boundary (CombatFactory.rollHitDamage).
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { BonusManager } = require("../dist/game/model/equipment/BonusManager");

let core, rolledMax, index = 9730;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
  PM.createApi("AreaHitOwnVictimTest").onCustomEvent("combat:hit-rolled", (e) => { rolledMax = e.maximum; });
});
after(() => PM.emitServerShutdown({}));

function fighter(t, weapon) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(index++); p.setUsername("ownvictim" + index); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3200, 3200, 0));
  for (const skill of [core.Skill.ATTACK, core.Skill.STRENGTH]) p.getSkillManager().setMaxLevel(skill, 70).setCurrentLevel(skill, 70, false);
  p.getEquipment().getItems()[core.Equipment.WEAPON_SLOT] = new core.Item(weapon);
  BonusManager.update(p);
  t.after(() => core.TaskManager.cancelTasks(p.getIndex()));
  return p;
}

const npc = (id) => core.NPC.create(id, new core.Location(3201, 3200, 0));

/** The max hit rolled against `victim` while `primary` is the combat target. */
function maxAgainst(t, p, primary, victim) {
  p.getCombat().setTarget(primary);
  t.mock.method(core.Misc, "randomInclusive", () => 2); // no keris triple hit
  rolledMax = undefined;
  core.CombatFactory.rollHitDamage(p, victim, core.CombatType.MELEE, true, undefined, false, false);
  t.mock.restoreAll();
  return rolledMax;
}

test("a keris rolls a kalphite secondary's boosted max, and a goblin secondary's plain one, whichever is the target", (t) => {
  const p = fighter(t, core.ItemIdentifiers.KERIS);
  const kalphite = npc(core.NpcIdentifiers.KALPHITE_WORKER);
  const goblin = npc(core.NpcIdentifiers.GOBLIN);
  const boosted = maxAgainst(t, p, kalphite, kalphite);
  const plain = maxAgainst(t, p, goblin, goblin);
  assert.ok(boosted > plain, "the keris boosts against a kalphite");
  assert.equal(maxAgainst(t, p, goblin, kalphite), boosted, "kalphite secondary under a goblin target");
  assert.equal(maxAgainst(t, p, kalphite, goblin), plain, "goblin secondary under a kalphite target");
});

test("a rat bone weapon adds its +10 only against a rat victim, whichever is the target", (t) => {
  const p = fighter(t, core.ItemIdentifiers.BONE_MACE);
  const rat = npc(core.NpcIdentifiers.RAT);
  const goblin = npc(core.NpcIdentifiers.GOBLIN);
  const ratMax = maxAgainst(t, p, rat, rat);
  const goblinMax = maxAgainst(t, p, goblin, goblin);
  assert.ok(ratMax > goblinMax, "the bonus against a rat");
  assert.equal(maxAgainst(t, p, goblin, rat), ratMax, "rat secondary under a goblin target");
  assert.equal(maxAgainst(t, p, rat, goblin), goblinMax, "goblin secondary under a rat target");
});
