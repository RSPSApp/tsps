// Run after `yarn build`: node --test tests/fractured-archive-rewards.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PrayerData, PrayerHandler } = require("../dist/game/content/PrayerHandler");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { ItemIds } = require("../dist/util/IdEnums");
const { Skill } = require("../dist/game/model/Skill");

const rewards = require("../plugins/minigames/tfa/Rewards.FracturedArchive");
const rondache = require("../plugins/combat/effects/Rondache.EquipmentEffects");
rondache._test.bind({ Equipment, ItemIdentifiers: ItemIds });

rewards({
  core: { PrayerData, PrayerHandler, Skill, ItemIdentifiers: ItemIds, Area: class {}, Boundary: class {} },
  persistAttribute() {}, registerArea() {}, onPlayerLogin() {}, onPrayerDisabled() {}, onItemAction() {}, onItemOnNpc() {}, onItemOnItem() {},
});

function player(levels = {}, attributes = {}, shield = 0) {
  const attrs = new Map(Object.entries(attributes));
  const items = new Array(14).fill(null).map(() => ({ getId: () => 0 }));
  items[Equipment.SHIELD_SLOT] = { getId: () => shield };
  return {
    isPlayer: () => true,
    getAsPlayer() { return this; },
    getPacketSender: () => ({ sendVarbit() {} }),
    getCombatSpecial: () => null,
    sendMessage() {},
    getInventory: () => ({ contains: (id) => attrs.get("horn") && id === ItemIds.HORN_OF_BRAN, deleteNumber() { attrs.set("horn", false); } }),
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getSkillManager: () => ({ getMaxLevel: (skill) => levels[skill] ?? 99 }),
    getEquipment: () => ({ getItems: () => items }),
  };
}

test("Zeal is the thirtieth prayer, from the cache's varbit, at 84 Prayer", () => {
  assert.equal(PrayerData.ZEAL.prayerId, PrayerHandler.ZEAL);
  assert.equal(PrayerData.ZEAL.requirement, 84);
  assert.equal(PrayerData.ZEAL.configId, 16577);
});

test("Zeal needs the Horn's unlock and 75 Attack, 75 Strength, 70 Defence", () => {
  const check = (p) => {
    const event = { player: p, prayer: PrayerData.ZEAL, disabled: null };
    rewards._test.zealRequirements(event);
    return event.disabled;
  };
  assert.equal(check(player()), true, "locked");
  assert.equal(check(player({ [Skill.DEFENCE]: 69 }, { "prayer:zeal-unlocked": true })), true);
  assert.equal(check(player({}, { "prayer:zeal-unlocked": true })), null);
});

test("Rondache takes 2 off each hit and charges by what it took", () => {
  const p = player({}, {}, ItemIds.RONDACHE);
  const hit = (damage) => ({ damage, getDamage() { return this.damage; }, setDamage(v) { this.damage = v; } });
  const big = hit(10);
  rondache._test.applyRondache(p, big);
  const small = hit(1);
  rondache._test.applyRondache(p, small);
  assert.deepEqual([big.damage, small.damage], [8, 0]);
  assert.equal(p.getAttribute(rondache._test.CHARGES_ATTRIBUTE), 3);
  for (let i = 0; i < 30; i++) rondache._test.applyRondache(p, hit(10));
  assert.equal(p.getAttribute(rondache._test.CHARGES_ATTRIBUTE), 20, "capped at 20");
  const bare = hit(10);
  rondache._test.applyRondache(player(), bare);
  assert.equal(bare.damage, 10);
});

test("Inspecting the Horn of Bran points the player at Camelot", () => {
  const messages = [];
  rewards._test.inspectHorn({ player: { sendMessage: (message) => messages.push(message) } });
  assert.deepEqual(messages, [
    "You inspect the horn-like item...",
    "You notice a small symbol, similar to the one you've seen the Knights of the Round Table wear.",
  ]);
});

test("Entering Camelot with the Horn of Bran unlocks Zeal and uses the horn up", () => {
  const p = player({}, { horn: true });
  rewards._test.enterCamelot(p);
  assert.equal(p.getAttribute("prayer:zeal-unlocked"), true);
  assert.equal(p.getAttribute("horn"), false);
});


test('native Shield Slam activation respects target policies and melee reach without spending on rejection', async () => {
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PlayerOptionPacketListener } = require('../dist/net/packet/impl/PlayerOptionPacketListener');
  const api = PluginManager.createApi('ShieldSlamPermissionRegression');
  const c = api.core;
  await c.CachePipeline.initialize();
  c.RegionManager.init();
  c.RegionManager.loadMapFiles(3090, 3550);
  require('../plugins/items/ItemDefinitionLoader.plugin').register(api);
  require('../plugins/areas/Wilderness.plugin').register(api);
  PluginManager.emitServerStartup({});
  rondache(api);
  require('../plugins/combat/specials/Rondache.SpecialAttack')(api);
  function realPlayer(name, x, y) {
    const p = new Player(null);
    p.setUsername(name);
    p.getSession = () => ({ sendClientPacket: () => true, write() {} });
    p.sendMessage = () => {};
    p.setLocation(new c.Location(x, y));
    p.onAdd = () => {};
    assert(c.World.getPlayers().add(p));
    p.setRegistered(true);
    p.setAutoRetaliate(false);
    api.getAreaManager().process(p);
    for (const skill of [c.Skill.HITPOINTS, c.Skill.ATTACK, c.Skill.STRENGTH, c.Skill.DEFENCE]) {
      p.getSkillManager().setMaxLevel(skill, 99);
      p.getSkillManager().setCurrentLevel(skill, 99, false);
    }
    return p;
  }
  let deniedTarget = null;
  api.onCanAttack(event => { if (event.target === deniedTarget) event.allow = false; });
  const random = Math.random;
  Math.random = () => 0.8;
  try {
    for (const scenario of ['non-pvp', 'out-of-range', 'plugin-denied', 'invalid', 'valid']) {
      const safe = scenario === 'non-pvp';
      const attacker = realPlayer('slam-' + scenario, safe ? 3200 : 3090, safe ? 3200 : 3550);
      const target = realPlayer('target-' + scenario, safe ? 3220 : scenario === 'out-of-range' ? 3110 : 3091, safe ? 3200 : 3550);
      attacker.getEquipment().set(c.Equipment.WEAPON_SLOT, new c.Item(c.ItemIdentifiers.RUNE_SCIMITAR));
      attacker.getEquipment().set(c.Equipment.SHIELD_SLOT, new c.Item(c.ItemIdentifiers.RONDACHE));
      attacker.setWeapon(c.WeaponInterfaces.SCIMITAR);
      attacker.setFightType(c.WeaponInterfaces.SCIMITAR.getFightType()[0]);
      c.CombatSpecial.assign(attacker);
      rondache.setCharges(attacker, 20);
      attacker.getCombat().setAttackDelay(9);
      const energy = attacker.getSpecialPercentage();
      PlayerOptionPacketListener.executeClientOption(attacker, target.getIndex(), 1);
      assert.equal(attacker.getCombat().getTarget(), target);
      deniedTarget = scenario === 'plugin-denied' ? target : null;
      if (scenario === 'invalid') target.setRegistered(false);
      c.CombatSpecial.activate(attacker);
      assert.equal(attacker.getSpecialPercentage(), energy, scenario + ': special energy unchanged');
      assert.equal(attacker.getCombat().getAttackDelay(), 9, scenario + ': instant slam preserves ordinary cooldown');
      assert.equal(rondache.charges(attacker), scenario === 'valid' ? 0 : 20, scenario + ': charges');
      assert.equal(target.getCombat().getHitQueue().hasPendingWork(), scenario === 'valid', scenario + ': pending hit');
      target.getCombat().getHitQueue().process(c.World.getProcessCycle() + 5);
      assert.equal(target.getHitpoints(), scenario === 'valid' ? 75 : 99, scenario + ': actual health');
    }
  } finally { Math.random = random; }
});

test("charging the folio during its teleport debits that replaced folio, not another one", async () => {
  const path = require("node:path");
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  const { PluginManager } = require("../dist/plugins/PluginManager");
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const { ItemActionPacketListener } = require("../dist/net/packet/impl/ItemActionPacketListener");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));

  const base = PluginManager.createApi("FolioChargeDuringTeleportTest");
  const core = base.core;
  require("../plugins/items/ItemDefinitionLoader.plugin").register(base);
  rewards(base);

  const player = new Player(null);
  player.setUsername("folio-charge-during-teleport");
  player.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  player.setLocation(new core.Location(3200, 3200));
  player.setRegistered(true);
  player.sendMessage = () => {};

  const first = new core.Item(core.ItemIdentifiers.ARCHIVISTS_FOLIO);
  first.setMetaValue("fractured-archive:folio-charges", 20);
  const clicked = new core.Item(core.ItemIdentifiers.ARCHIVISTS_FOLIO);
  clicked.setMetaValue("fractured-archive:folio-charges", 10);
  player.getInventory().setItem(0, first);
  player.getInventory().setItem(1, clicked);
  player.getInventory().setItem(2, new core.Item(core.ItemIdentifiers.ASCENSION_SHARDS, 1));

  ItemActionPacketListener.handleAction(player, 93, core.ItemIdentifiers.ARCHIVISTS_FOLIO, 1, 1, "Read");
  assert.equal(player.isTeleportingReturn(), true, "Read starts the native teleport task");
  ItemActionPacketListener.handleAction(player, 93, core.ItemIdentifiers.ARCHIVISTS_FOLIO, 1, 3, "Charge");
  assert.equal(player.getInventory().getItems()[1].getMetaValue("fractured-archive:folio-charges"), 15);

  for (let tick = 0; tick < 5; tick++) core.TaskManager.process();

  const items = player.getInventory().getItems();
  assert.equal(player.getLocation().getX(), 4127, "the actual teleport task reaches the lobby");
  assert.equal(items[0].getMetaValue("fractured-archive:folio-charges"), 20);
  assert.equal(items[1].getMetaValue("fractured-archive:folio-charges"), 14);
});
