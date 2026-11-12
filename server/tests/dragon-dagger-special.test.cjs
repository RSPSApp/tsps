// Run after `yarn build`: node --test tests/dragon-dagger-special.test.cjs
//
// Wiki (Dragon dagger): Puncture "rolls against opponent's slash defence roll", for 25% special energy, with "an extra
// 15% accuracy and 15% damage for each of the two hits". Real plugins, a real Player wielding the dagger on its stab
// style, and a real NPC: the special's accuracy roll asks for the target's slash defence; a normal stab asks for stab.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, after } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { BotPlayerSession } = require("../dist/net/BotPlayerSession");
const { PendingHit } = require("../dist/game/content/combat/hit/PendingHit");
const { AccuracyFormulasDpsCalc } = require("../dist/game/content/combat/formula/AccuracyFormulasDpsCalc");
const { WeaponInterfaceManager } = require("../dist/game/content/combat/WeaponInterfaceManager");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");

const STAB = 0, SLASH = 1;
let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function defenceIndexRolled(t, special) {
  const p = new Player(new BotPlayerSession());
  p.setUsername("ddsroll");
  p.getEquipment().setItem(Equipment.WEAPON_SLOT, new core.Item(core.ItemIdentifiers.DRAGON_DAGGER, 1));
  WeaponInterfaceManager.assign(p);
  assert.equal(p.getFightType().getBonusType(), STAB, "the dagger's default style stabs");
  p.setSpecialPercentage(100);
  p.setSpecialActivated(special);
  const target = new core.NPC(core.NpcIdentifiers.MAN, new core.Location(3222, 3218, 0));
  const asked = [];
  const roll = AccuracyFormulasDpsCalc.defenseMeleeRoll.bind(AccuracyFormulasDpsCalc);
  t.mock.method(AccuracyFormulasDpsCalc, "defenseMeleeRoll", (enemy, index) => { asked.push(index); return roll(enemy, index); });
  const method = special ? p.getCombatSpecial().getCombatMethod() : core.CombatFactory.getMethod(p);
  new PendingHit(p, target, method);
  t.mock.restoreAll();
  return { asked, spec: p.getCombatSpecial() };
}

test("Puncture rolls against slash defence; a normal stab against stab", (t) => {
  const special = defenceIndexRolled(t, true);
  assert.ok(special.asked.length > 0, "the special rolled accuracy");
  assert.ok(special.asked.every((index) => index === SLASH), `asked ${special.asked}`);
  assert.equal(special.spec.getDrainAmount(), 25);
  const normal = defenceIndexRolled(t, false);
  assert.ok(normal.asked.length > 0 && normal.asked.every((index) => index === STAB), `asked ${normal.asked}`);
});
