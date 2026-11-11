// Run after `yarn build`: node --test tests/weapon-switch-combat.test.cjs
// A weapon switch from the inventory keeps the attack running (#4112, docs/weapon-switching.md): live
// swings the new weapon on the tick the old weapon's cooldown ends, with no new click (rsprox captures).
// Two real Players in the Wilderness, the real Wield packet through ClientConnection, the real player turn.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
// Server startup registers the areas; keep its admin page off the main checkout's port.
process.env.WORLD_ADMIN_PORT = "0";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { EquipPacketListener } = require("../dist/net/packet/impl/EquipPacketListener");
const { CombatSpecial } = require("../dist/game/content/combat/CombatSpecial");
const { AreaManager } = require("../dist/game/model/areas/AreaManager");
const { World } = require("../dist/game/World");

let core;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  PM.emitServerStartup({ timestamp: Date.now() });
});
after(() => PM.emitServerShutdown({}));

/** A 99-everything player in level-3 Wilderness west of Edgeville, with its own connection. */
function fighter(t, name, x) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setUsername(name);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(x, 3560, 0));
  for (const skill of core.Skill.values()) p.getSkillManager().setMaxLevels(skill, 99, false).setCurrentLevels(skill, 99, false);
  p.setHitpoints(9999);
  assert.equal(World.getPlayers().add(p), true);
  p.setRegistered(true);
  p.needsPlacement = false;
  AreaManager.process(p);
  const connection = new ClientConnection(channel);
  connection.player = p;
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    World.getPlayers().remove(p);
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
    core.TaskManager.cancelTasks(p);
    p.getCombat().getHitQueue().clear();
  });
  return { p, connection };
}

function wieldNow(p, gameval, amount = 1) {
  const id = CacheDefinitions.getObjId(gameval);
  p.getInventory().add(new core.Item(id, amount), false);
  EquipPacketListener.equip(p, id, p.getInventory().getSlotForItemId(id), 3214);
  assert.equal(p.getEquipment().getItems()[core.Equipment.WEAPON_SLOT].getId(), id, `${gameval} is wielded`);
}

/** The Wield click the client sends for an inventory item, option text from the cache. */
function wieldPacket(p, id, option = "Wield") {
  return { type: "inventory_action", widgetId: 149 << 16, itemId: id, slot: p.getInventory().getSlotForItemId(id),
    option, optionIndex: CacheDefinitions.getItem(id).inventoryActions.indexOf(option) + 1 };
}

/**
 * Plays the fight: the attacker clicks Attack on cycle 1000, `onCycle(cycle)` runs as their clicks at the
 * start of that cycle's turn. Returns each attack the attacker started: the cycle, the weapon and the special.
 */
async function fight(t, attacker, victim, cycles, onCycle) {
  let cycle = 1000;
  t.mock.method(World, "getProcessCycle", () => cycle);
  const attacks = [];
  const emit = PM.emitCustomEvent.bind(PM);
  t.mock.method(PM, "emitCustomEvent", (name, event) => {
    if (name === "combat:attack-started" && event.attacker === attacker.p) {
      attacks.push({ cycle, weapon: CacheDefinitions.getItem(attacker.p.getEquipment().getItems()[core.Equipment.WEAPON_SLOT].getId())?.name,
        special: attacker.p.isSpecialActivated() });
    }
    return emit(name, event);
  });
  attacker.p.getCombat().attack(victim.p);
  for (let i = 0; i < cycles; i++) {
    cycle++;
    await onCycle(cycle);
    victim.connection.processTurnPackets();
    victim.p.process();
    attacker.connection.processTurnPackets();
    attacker.p.process();
  }
  return attacks;
}

test("dragon knives to a Voidwaker special: the special swings when the knives' cooldown ends, with no new click", async (t) => {
  const attacker = fighter(t, "koknifer", 3100);
  const victim = fighter(t, "kovictim", 3101);
  attacker.p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(-1, 0));
  wieldNow(attacker.p, "dragon_knife", 100);
  const voidwaker = CacheDefinitions.getObjId("voidwaker");
  attacker.p.getInventory().add(new core.Item(voidwaker, 1), false);
  const attacks = await fight(t, attacker, victim, 8, async (cycle) => {
    if (cycle !== 1003) return;
    await attacker.connection.dispatch([wieldPacket(attacker.p, voidwaker)]);
    attacker.connection.processTurnPackets();
    CombatSpecial.activate(attacker.p);
    assert.equal(attacker.p.getCombat().getTarget(), victim.p, "the switch keeps the attack on the victim");
  });
  assert.deepEqual(attacks.slice(0, 2), [
    { cycle: 1001, weapon: "Dragon knife", special: false },
    { cycle: 1004, weapon: "Voidwaker", special: true },
  ], "knives throw, then the special the tick their 3-tick cooldown runs out");
  assert.equal(attacks[2]?.cycle, 1008, "and the Voidwaker carries on at its own 4 ticks");
});

test("a maple shortbow to dragon claws at range: the claws walk in and special off the bow's cooldown", async (t) => {
  const attacker = fighter(t, "kobowman", 3110);
  const victim = fighter(t, "kotarget", 3114);
  wieldNow(attacker.p, "maple_shortbow");
  attacker.p.getEquipment().setItem(core.Equipment.AMMUNITION_SLOT, new core.Item(CacheDefinitions.getObjId("adamant_arrow"), 500));
  EquipPacketListener.resetWeapon(attacker.p, true);
  const claws = CacheDefinitions.getObjId("dragon_claws");
  attacker.p.getInventory().add(new core.Item(claws, 1), false);
  const attacks = await fight(t, attacker, victim, 8, async (cycle) => {
    if (cycle !== 1002) return;
    await attacker.connection.dispatch([wieldPacket(attacker.p, claws)]);
    attacker.connection.processTurnPackets();
    CombatSpecial.activate(attacker.p);
  });
  assert.equal(attacks[0]?.weapon, "Maple shortbow");
  assert.equal(attacks[0]?.cycle, 1001);
  assert.equal(attacks[1]?.weapon, "Dragon claws", "the claws swing without the victim being clicked again");
  assert.equal(attacks[1]?.special, true);
  assert.equal(attacks[1]?.cycle, 1001 + 4, "on the bow's 4-tick cooldown, having closed in meanwhile");
});

test("a refused Wield keeps the attack too, and any other inventory action still ends it", async (t) => {
  const attacker = fighter(t, "kowielder", 3120);
  const victim = fighter(t, "kodummy", 3121);
  const dagger = CacheDefinitions.getObjId("dragon_dagger");
  const bones = CacheDefinitions.getObjId("bones");
  attacker.p.getInventory().add(new core.Item(dagger, 1), false);
  attacker.p.getInventory().add(new core.Item(bones, 1), false);
  const targets = {};
  await fight(t, attacker, victim, 6, async (cycle) => {
    if (cycle === 1002) {
      await attacker.connection.dispatch([wieldPacket(attacker.p, dagger)]);
      attacker.connection.processTurnPackets();
      targets.refused = attacker.p.getCombat().getTarget();
    }
    if (cycle === 1004) {
      await attacker.connection.dispatch([wieldPacket(attacker.p, bones, "Drop")]);
      attacker.connection.processTurnPackets();
      targets.dropped = attacker.p.getCombat().getTarget();
    }
  });
  assert.equal(attacker.p.getInventory().getAmount(dagger), 1, "the dragon dagger needs Lost City");
  assert.equal(targets.refused, victim.p, "a refused Wield leaves the fight alone");
  assert.equal(attacker.p.getInventory().getAmount(bones), 0, "the bones were dropped");
  assert.equal(targets.dropped, null, "a Drop is still a hard interruption");
});
