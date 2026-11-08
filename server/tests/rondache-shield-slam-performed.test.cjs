// Run after `yarn build`: node --test tests/rondache-shield-slam-performed.test.cjs
// Rondache's Shield Slam spends the shield's charges, not special energy, so it never called CombatSpecial.drain -
// where "combat-special:performed" is sent - and a slam did not count for the leagues' "Perform a special attack" deeds.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { NPC } = require("../dist/game/entity/impl/npc/NPC");
const { CombatFactory, CanAttackResponse } = require("../dist/game/content/combat/CombatFactory");

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  require("../plugins/items/ItemDefinitionLoader.plugin").register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
  const api = PluginManager.createApi("RondacheSlamTest");
  require("../plugins/combat/effects/Rondache.EquipmentEffects")(api);
  require("../plugins/combat/specials/Rondache.SpecialAttack")(api);
});

test("a Shield Slam counts as a special attack performed, and spends no energy", (t) => {
  const Effects = require("../plugins/combat/effects/Rondache.EquipmentEffects");
  const p = new Player(null);
  p.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  p.setUsername("rondache");
  p.setRegistered(true);
  p.setLocation(new core.Location(3200, 3200, 0));
  p.getEquipment().setItem(core.Equipment.SHIELD_SLOT, new core.Item(core.ItemIdentifiers.RONDACHE, 1));
  p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(core.ItemIdentifiers.DRAGON_AXE, 1));
  Effects.setCharges(p, 20);
  const target = new NPC(core.NpcIdentifiers.MAN ?? 3106, new core.Location(3201, 3200, 0));
  target.setRegistered(true);
  t.after(() => { p.setRegistered(false); target.setRegistered(false); core.TaskManager.cancelTasks(p); });
  p.getCombat().setTarget?.(target);
  t.mock.method(p.getCombat(), "getTarget", () => target);
  t.mock.method(p.getCombat(), "resolveCanReachForCurrentCycle", () => true);
  t.mock.method(CombatFactory, "canAttack", () => CanAttackResponse.CAN_ATTACK);
  t.mock.method(CombatFactory, "addPendingHit", () => {});
  const performed = [];
  const original = PluginManager.emitCustomEvent.bind(PluginManager);
  t.mock.method(PluginManager, "emitCustomEvent", (name, event) => {
    if (name === "combat-special:performed") performed.push(event);
    return original(name, event);
  });
  const special = core.CombatSpecial.getForWeaponId(core.ItemIdentifiers.RONDACHE);
  assert.ok(special, "the shield's special");
  const energy = p.getSpecialPercentage();
  special.getCombatMethod().start(p, target);
  assert.equal(Effects.charges(p), 0, "the slam spent the charges");
  assert.equal(performed.length, 1, "one combat-special:performed");
  assert.equal(performed[0].itemId, core.ItemIdentifiers.RONDACHE, "the rondache's special, not the wielded weapon's");
  assert.equal(p.getSpecialPercentage(), energy, "no energy spent");
});
