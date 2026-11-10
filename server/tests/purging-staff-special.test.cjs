// Run after `yarn build`: node --test tests/purging-staff-special.test.cjs
//
// The purging staff's special against a non-demon, as recorded (rsprox_transcripts/235/03315.txt:39781 and :40372, a
// skeleton): sa_attack goes 1 -> 0 with "You can't use this special attack against non-demon enemies." and no energy
// is spent. Real plugins, a real Player wielding the staff, real NPCs.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, after } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { BotPlayerSession } = require("../dist/net/BotPlayerSession");
const { WeaponInterfaceManager } = require("../dist/game/content/combat/WeaponInterfaceManager");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  // The Wiki's monster attributes (demon, undead, ...) come with the NPC definitions.
  new (require("../dist/game/definition/loader/impl/NpcDefinitionLoader").NpcDefinitionLoader)().load();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function armed(t) {
  const p = new Player(new BotPlayerSession());
  p.setUsername("purging");
  const messages = [];
  t.mock.method(p, "sendMessage", (m) => messages.push(m));
  p.getEquipment().setItem(Equipment.WEAPON_SLOT, new core.Item(core.ItemIdentifiers.PURGING_STAFF, 1));
  WeaponInterfaceManager.assign(p);
  p.setSpecialPercentage(100);
  p.setSpecialActivated(true);
  assert.ok(p.getCombatSpecial(), "the staff has its special");
  return { p, messages, method: p.getCombatSpecial().getCombatMethod() };
}
const npc = (id) => new core.NPC(id, new core.Location(3222, 3218, 0));

test("against a non-demon: refused with the recorded line, the special disarmed, no energy spent", (t) => {
  const f = armed(t);
  assert.equal(f.method.canAttack(f.p, npc(core.NpcIdentifiers.MAN)), false);
  assert.deepEqual(f.messages, ["You can't use this special attack against non-demon enemies."]);
  assert.equal(f.p.isSpecialActivated(), false);
  assert.equal(f.p.getSpecialPercentage(), 100);
});

test("against a demon the special is allowed", (t) => {
  const f = armed(t);
  assert.equal(f.method.canAttack(f.p, npc(core.NpcIdentifiers.LESSER_DEMON)), true);
  assert.deepEqual(f.messages, []);
  assert.equal(f.p.isSpecialActivated(), true);
});
