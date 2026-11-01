"use strict";

/**
 * Barbarian Assault.
 *
 * Entry: Commander Connad (role and rewards) and the Barbarian Outpost ladder
 * (object 20226). The match runs in the cache's own arena maps, one private
 * area per game, with wave 1-9 on the southern copy and wave 10 on the
 * northern copy that carries the Queen's craters and mushrooms.
 *
 * Behaviour follows the OSRS Wiki (Barbarian Assault, /Strategies, /Gambles).
 * The RSProx archive has no indexed Barbarian Assault gameplay recording:
 * searches for the Penance NPCs, their varbits and "Barbarian Assault" only
 * return journal/achievement text and login state (recordings 2908, 2520,
 * 1521 and 787). Ids therefore come from the active cache, and the wave/score
 * numbers from the Wiki.
 */

const data = require("./barbarianassault/Data.BarbarianAssault");
const Points = require("./barbarianassault/Points.BarbarianAssault");
const Items = require("./barbarianassault/Items.BarbarianAssault");
const Match = require("./barbarianassault/Match.BarbarianAssault");
const Lobby = require("./barbarianassault/Lobby.BarbarianAssault");
const Shop = require("./barbarianassault/Shop.BarbarianAssault");

const HORN_ROLE = new Map();
for (const role of data.ROLES) for (const itemId of data.HORN_ITEMS[role]) HORN_ROLE.set(itemId, role);

let core = null;

function matchOf(player) {
  return Match.matchFor(player);
}

function inside(bounds, location) {
  return location
    && location.getX() >= bounds.minX && location.getX() <= bounds.maxX
    && location.getY() >= bounds.minY && location.getY() <= bounds.maxY
    && location.getZ() === bounds.z;
}

function inArena(player) {
  const at = player?.getLocation?.();
  return inside(data.ARENA.normal.bounds, at) || inside(data.ARENA.queen.bounds, at);
}

function handleObjectInteraction(event) {
  if (event.objectId === data.OBJECT.ENTRY_LADDER) {
    Lobby.climbDown({ player: event.player });
    event.handled = true;
    return;
  }
  const match = matchOf(event.player);
  if (!match) return;
  if (match.handleObject(event.player, event.object, event.clickType)) event.handled = true;
}

function handleItemAction(event) {
  const match = matchOf(event.player);
  if (!match) return;
  const itemId = event.itemId;
  const option = event.option;
  if (HORN_ROLE.has(itemId)) {
    const call = data.HORN_ACTION_CALL[option];
    if (call) {
      match.call(event.player, call);
      event.handled = true;
      return;
    }
    if (option === "Medic") {
      match.medic(event.player);
      event.handled = true;
      return;
    }
  }
  if (itemId === data.ITEM.COLLECTION_BAG || data.COLLECTION_BAGS.includes(itemId)) {
    if (option === "Empty") {
      match.emptyBag(event.player);
      event.handled = true;
      return;
    }
    if (option === "Look-in") {
      match.lookInBag(event.player);
      event.handled = true;
      return;
    }
  }
  if (data.BAIT_CALL[itemId] && option === "Drop") {
    match.handleBaitDrop(event.player, itemId);
    event.handled = true;
    return;
  }
  if (data.EGG_CALL[itemId] || [data.ITEM.YELLOW_EGG, data.ITEM.POISONED_EGG, data.ITEM.SPIKED_POISONED_EGG, data.ITEM.OMEGA_EGG].includes(itemId)) {
    if (option === "Destroy") {
      event.player.getInventory().delete(itemId, 1);
      event.player.sendMessage("You destroy the egg.");
      event.handled = true;
      return;
    }
  }
  if ((data.ROLE_ITEM_IDS.has(itemId) || Items.isTracked(event.player, itemId)) && option === "Drop") {
    event.player.sendMessage("You cannot drop that inside Barbarian Assault.");
    event.handled = true;
  }
}

function handleItemOnNpc(event) {
  const match = matchOf(event.player);
  if (!match) return;
  if (match.handleItemOnNpc(event.player, event.target, event.itemId)) event.handled = true;
}

function handleItemOnPlayer(event) {
  const match = matchOf(event.player);
  if (!match) return;
  if (match.handleItemOnPlayer(event.player, event.target, event.itemId)) event.handled = true;
}

function handleItemOnItem(event) {
  const match = matchOf(event.player);
  if (!match) return;
  if (match.handleItemOnItem(event.player, event.usedItemId, event.usedWithItemId)) event.handled = true;
}

function handleItemOnObject(event) {
  const match = matchOf(event.player);
  if (!match) return;
  if (match.handleItemOnObject(event.player, event.itemId, event.objectId)) event.handled = true;
}

function suppressMatchDrops(event) {
  if (!event?.npc || !Array.isArray(event.drops)) return;
  const area = event.npc.getPrivateArea?.();
  if (event.npc.__baType || area?.match instanceof Match.BarbarianAssaultMatch) event.drops.length = 0;
}

function handleGroundItemPickup(event) {
  const match = matchOf(event.player);
  if (!match) return;
  if (match.handleGroundItem(event)) event.handled = true;
}

function handleCanAttack(event) {
  const player = event.attacker?.getAsPlayer?.();
  const match = matchOf(player);
  if (match && match.handleCanAttack(player, event.target?.getAsNpc?.()) === false) event.allow = false;
}

function handleDealtDamage({ player, target, hit }) {
  const match = matchOf(player);
  if (match) match.handleDamage(player, target, hit?.getTotalDamage?.() ?? 0);
}

function handleNpcDeath({ npc }) {
  const area = npc?.getPrivateArea?.();
  if (area?.match instanceof Match.BarbarianAssaultMatch) area.match.handleNpcDeath(npc);
}

function handlePlayerDeath(event) {
  const match = matchOf(event.player);
  if (!match) return;
  event.player.getCombat().reset();
  event.player.setPoisonDamage?.(0);
  event.player.setHitpoints(event.player.getSkillManager().getMaxLevel(match.core.Skill.HITPOINTS));
  const spawn = match.arena.spawn;
  event.player.moveTo(new (match.core.Location)(spawn.x, spawn.y, spawn.z));
  event.handled = true;
}

function handleShouldDropItems(event) {
  if (matchOf(event.player)) event.shouldDrop = false;
}

function handleLogin({ player }) {
  if (!inArena(player)) return;
  player.setAttribute("barbarian-assault:match", null);
  Items.stripRoleItems(player);
  player.moveTo(new core.Location(data.SURFACE_RETURN.x, data.SURFACE_RETURN.y, data.SURFACE_RETURN.z));
}

function handleLogout({ player }) {
  const match = matchOf(player);
  if (match) match.abort("A team member left the arena. The wave is lost.");
}

function handleCanTeleport(event) {
  const match = matchOf(event.player);
  if (!match) return;
  event.player.sendMessage("You cannot teleport out of Barbarian Assault.");
  event.allow = false;
}

function handleCanTrade(event) {
  if (matchOf(event.player) || matchOf(event.target)) event.allow = false;
}

function attach(pluginApi) {
  core = pluginApi.core;
  Points.attach(pluginApi);
  Items.init(pluginApi);
  Match.attachCombat(pluginApi);
  Lobby.attach(pluginApi);
  Shop.attach(pluginApi);
  pluginApi.onBeforeObjectInteraction?.(handleObjectInteraction);
  pluginApi.onItemAction?.(handleItemAction);
  pluginApi.onItemOnNpc?.(handleItemOnNpc);
  pluginApi.onItemOnPlayer?.(handleItemOnPlayer);
  pluginApi.onItemOnItem?.(handleItemOnItem);
  pluginApi.onItemOnObject?.(handleItemOnObject);
  pluginApi.onGroundItemPickup?.(handleGroundItemPickup);
  pluginApi.onCustomEvent?.("npc-drops:roll", suppressMatchDrops);
  pluginApi.onCanAttack?.(handleCanAttack);
  pluginApi.onPlayerDealtDamage?.(handleDealtDamage);
  pluginApi.onNpcDeath?.(handleNpcDeath);
  pluginApi.onPlayerDeath?.(handlePlayerDeath);
  pluginApi.onShouldDropItemsOnDeath?.(handleShouldDropItems);
  pluginApi.onPlayerLogin?.(handleLogin);
  pluginApi.onPlayerLogout?.(handleLogout);
  pluginApi.onPlayerDisconnect?.(handleLogout);
  pluginApi.onCanTeleport?.(handleCanTeleport);
  pluginApi.onCanTrade?.(handleCanTrade);
  pluginApi.registerRangedAmmoHandler?.(Items.rangedAmmoHandler);
}

module.exports = {
  name: "BarbarianAssault",
  members: true,
  // Our role-aware Honour Points handler must replace Shopkeepers' generic one.
  dependsOn: ["Shopkeepers"],
  register(pluginApi) {
    attach(pluginApi);
  },
  _test: {
    data, Points, Items, Lobby, Shop, Match,
    inArena, HORN_ROLE,
    ...Points._test,
    PENANCE_PET_ITEM_ID: Points.PENANCE_PET_ITEM_ID,
    QUEEN_KILL_HONOUR: Points.QUEEN_KILL_HONOUR,
    highGamble: Points.highGamble,
    recordQueenKill: Points.recordQueenKill,
    queenKilled: Points.queenKilled,
    honourOf: Points.honourOf,
    addHonour: Points._test.addLegacyHonour,
  },
};
