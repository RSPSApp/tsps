"use strict";

/**
 * Cells and the seven cell tiles: the barriers between the rift and the Great Guardian.
 *
 * rsprox captures (rev 241):
 * - Uncharged cells: Take-10 tops the stack up to ten, Take-1 adds one; at ten, mesbox "You can
 *   only carry ten of these at a time." Weak cells: Take gives one, Take-chisel a chisel
 *   (human_pickuptable, sound 2582). Both tables: human_pickuptable_walkmerge, sound 2581.
 * - A cell dropped: "The Uncharged cell is destroyed as you drop it." (spam), sound 2739.
 * - Place-cell (human_pickupfloor):
 *   - on an inactive tile, the tile and its barrier change to the cell's tier, sound 5455;
 *   - with a stronger cell, the barrier and its NPC go up a tier: "The strong cell is consumed as
 *     it <col=ff0000>strengthens</col> the barrier.", sound 5441, both energies +13 for a strong
 *     cell, +22 overcharged, Runecraft XP 190/260;
 *   - otherwise "The weak cell is consumed as it <col=ff0000>recharges</col> the barrier.", sound
 *     5428, both energies +2/+5/+9 (weak/medium/strong), Runecraft XP 30/100/180 (250 overcharged).
 * - At the close every tile goes back to gotr_cell_tile_inactive and the barriers go; players
 *   build and strengthen barriers again straight away, through the grace and the lobby.
 * Wiki: placing gives 17/20/24/30 of both energies, recharging restores 10/25/50/100 health; a
 * barrier's NPC has the cache's 50/100/200/400 hitpoints; a destroyed barrier leaves a broken tile
 * that 12 guardian fragments repair for 25 of each energy; at 60% power every barrier takes 50.
 * Wiki (13 November 2024): before the game begins an uncharged cell builds a weak barrier, and
 * barriers built then give no experience. Energy before the open would be wiped by it, so none.
 */

const Shared = require("./Shared.GuardiansOfTheRift");
const Game = require("./Game.GuardiansOfTheRift");

/** Per cell tier 1-4 (Wiki; XP from the captures). */
const CELL = [
  null,
  { name: "weak", place: 17, strengthen: 0, recharge: 2, heal: 10, xp: 30 },
  { name: "medium", place: 20, strengthen: 7, recharge: 5, heal: 25, xp: 100 },
  { name: "strong", place: 24, strengthen: 13, recharge: 9, heal: 50, xp: 180 },
  { name: "overcharged", place: 30, strengthen: 22, recharge: 15, heal: 100, xp: 250 },
];
const STRENGTHEN_BONUS_XP = 10;

/** The seven tiles and the barrier each raises (rsprox captures). `large` barriers are 3x3. */
const TILES = [
  { x: 3608, y: 9503, face: 3, barrier: { x: 3605, y: 9502, type: 10, face: 1 }, large: true },
  { x: 3609, y: 9507, face: 3, barrier: { x: 3607, y: 9507, type: 11, face: 1 } },
  { x: 3611, y: 9509, face: 0, barrier: { x: 3610, y: 9510, type: 11, face: 1 } },
  { x: 3615, y: 9510, face: 0, barrier: { x: 3614, y: 9511, type: 10, face: 0 }, large: true },
  { x: 3619, y: 9509, face: 0, barrier: { x: 3619, y: 9510, type: 11, face: 2 } },
  { x: 3621, y: 9507, face: 1, barrier: { x: 3622, y: 9507, type: 11, face: 2 } },
  { x: 3622, y: 9503, face: 1, barrier: { x: 3623, y: 9502, type: 10, face: 3 }, large: true },
];
const TILE_TYPE = 22;

const SOUND = { TAKE: 2581, TAKE_CHISEL: 2582, PLACE: 5455, STRENGTHEN: 5441, RECHARGE: 5428, DROP: 2739 };
const MAX_UNCHARGED = 10;
const REPAIR_FRAGMENTS = 12;
const REPAIR_ENERGY = 25;
const SURGE_DAMAGE = 50;
/** Wiki: recharging a barrier at full health stops paying past this much a game. */
const FULL_HEALTH_CAP = { xp: 2500, energy: 450 };

const DROP_DESTROYS = [Shared.ITEM.UNCHARGED_CELL, ...Shared.ITEM.CELLS, ...Shared.ITEM.PORTAL_TALISMANS];

/** Each tile's state: tier 0 inactive, 1-4; broken; the barrier loc and NPC standing on it. */
const tiles = TILES.map((tile) => ({ ...tile, tier: 0, broken: false, loc: null, npc: null }));
let api = null;

function eventTile(event) {
  const location = event.location ?? event.object?.getLocation?.();
  if (!location) return null;
  const x = location.x ?? location.getX();
  const y = location.y ?? location.getY();
  return tiles.find((tile) => tile.x === x && tile.y === y) ?? null;
}

function bestCell(player) {
  for (let tier = 4; tier >= 1; tier--) {
    if (Shared.count(player, Shared.ITEM.CELLS[tier - 1]) > 0) return tier;
  }
  return 0;
}

// ------------------------------------------------------------------ the world's locs and NPCs

function register(id, x, y, type, face) {
  const { GameObject, ObjectManager } = Shared.core();
  const object = new GameObject(id, Shared.location({ x, y }), type, face, null);
  ObjectManager.register(object, true);
  return object;
}

function tileLoc(tile) {
  const name = tile.broken ? "gotr_cell_tile_broken_repairable"
    : tile.tier === 0 ? "gotr_cell_tile_inactive" : `gotr_cell_tile_tier${tile.tier}`;
  register(Shared.loc(name), tile.x, tile.y, TILE_TYPE, tile.face);
}

function barrierNpcName(tier, large) {
  return `gotr_barrier_npc_tier${tier}${large ? "_large" : ""}`;
}

function raiseBarrier(tile) {
  const { barrier } = tile;
  const name = `gotr_barrier_tier${tile.tier}${tile.large ? "_3x3" : ""}`;
  if (tile.loc) Shared.core().ObjectManager.deregister(tile.loc, true);
  tile.loc = register(Shared.loc(name), barrier.x, barrier.y, barrier.type, barrier.face);
  if (tile.npc && tile.npc.isRegistered?.()) {
    tile.npc.setNpcTransformationId(Shared.npc(barrierNpcName(tile.tier, tile.large)));
    tile.npc.setHitpoints(tile.npc.getMaxHitpoints());
  } else {
    tile.npc = api.spawnNpc({ id: Shared.npc(barrierNpcName(tile.tier, tile.large)), x: barrier.x, y: barrier.y, z: 0, wanderRadius: 0 });
    if (tile.npc) {
      Shared.prepareNpc(tile.npc);
      tile.npc.getMovementQueue().setBlockMovement(true);
    }
  }
  tileLoc(tile);
}

function lowerBarrier(tile) {
  if (tile.loc) Shared.core().ObjectManager.deregister(tile.loc, true);
  if (tile.npc) api.removeNpc(tile.npc);
  tile.loc = null;
  tile.npc = null;
}

/** A barrier's NPC died: the tile breaks and needs fragments (Wiki). The NPC's death removes it. */
function destroyed(tile) {
  tile.npc = null;
  lowerBarrier(tile);
  tile.tier = 0;
  tile.broken = true;
  tileLoc(tile);
  Game.message("<col=ef1020>A barrier has been destroyed!</col>");
}

/** The close: every tile back to inactive, every barrier gone (rsprox captures). */
function reset() {
  for (const tile of tiles) {
    lowerBarrier(tile);
    tile.tier = 0;
    tile.broken = false;
    tileLoc(tile);
  }
}

function surge() {
  for (const tile of tiles) {
    if (!tile.npc || tile.tier === 0) continue;
    damage(tile, SURGE_DAMAGE);
  }
}

/** The surge and the creatures hurt a barrier through its NPC's hit queue. */
function damage(tile, amount) {
  if (tile.npc) Shared.damageNpc(tile.npc, amount);
}

/** A barrier whose NPC has died breaks. */
function checkBarriers() {
  for (const tile of tiles) {
    if (tile.npc && (tile.npc.getHitpoints() <= 0 || !tile.npc.isRegistered())) destroyed(tile);
  }
}

function barrierNpcs() {
  return tiles.filter((tile) => tile.npc && tile.tier > 0);
}

function tileOfNpc(npc) {
  return tiles.find((tile) => tile.npc === npc) ?? null;
}

// ------------------------------------------------------------------ the tables

/** Temple of the Eye players keep the tutorial's tables until the quest is done. */
function inPlay(player) {
  return Shared.inTemple(player.getLocation()) && Shared.questComplete(player);
}

function takeTable({ player, objectId }, amount) {
  if (!Shared.isLoc(objectId, "gotr_uncharged_cells") || !inPlay(player)) return false;
  const held = Shared.count(player, Shared.ITEM.UNCHARGED_CELL);
  if (held >= MAX_UNCHARGED) {
    Shared.statement(player, "You can only carry ten of these at a time.");
    return true;
  }
  if (held === 0 && player.getInventory().getFreeSlots() <= 0) {
    player.getInventory().full();
    return true;
  }
  player.getInventory().adds(Shared.obj(Shared.ITEM.UNCHARGED_CELL), Math.min(amount, MAX_UNCHARGED - held));
  Shared.animate(player, "human_pickuptable_walkmerge");
  Shared.sound(player, SOUND.TAKE);
  return true;
}

function takeTen(event) {
  return takeTable(event, MAX_UNCHARGED);
}

function takeOne(event) {
  return takeTable(event, 1);
}

function takeWeakCell({ player, objectId }) {
  if (!Shared.isLoc(objectId, "gotr_weak_cells") || !inPlay(player)) return false;
  if (player.getInventory().getFreeSlots() <= 0) {
    player.getInventory().full();
    return true;
  }
  player.getInventory().adds(Shared.obj(Shared.ITEM.CELLS[0]), 1);
  Shared.animate(player, "human_pickuptable_walkmerge");
  Shared.sound(player, SOUND.TAKE);
  return true;
}

function takeChisel({ player, objectId }) {
  if (!Shared.isLoc(objectId, "gotr_weak_cells") || !inPlay(player)) return false;
  if (player.getInventory().getFreeSlots() <= 0) {
    player.getInventory().full();
    return true;
  }
  player.getInventory().adds(Shared.obj("chisel"), 1);
  Shared.animate(player, "human_pickuptable");
  Shared.sound(player, SOUND.TAKE_CHISEL);
  return true;
}

// ------------------------------------------------------------------ placing cells

/** Before the game an uncharged cell builds a weak barrier on an inactive tile (Wiki). */
function pregameCell(player, tile) {
  if (Game.isRunning() || tile.tier !== 0 || Shared.count(player, Shared.ITEM.UNCHARGED_CELL) <= 0) return null;
  return Shared.ITEM.UNCHARGED_CELL;
}

function placeCell(event) {
  const { player } = event;
  const tile = eventTile(event);
  if (!tile || !Shared.questComplete(player) || !Game.isPlaying(player)) return false;
  let tier = bestCell(player);
  const item = tier > 0 ? Shared.ITEM.CELLS[tier - 1] : pregameCell(player, tile);
  if (!item) {
    Shared.itemStatement(player, Shared.ITEM.CELLS[0], "You need a charged cell to place on the tile.");
    return true;
  }
  if (tier === 0) tier = 1;
  const inventory = player.getInventory();
  inventory.delete(Shared.obj(item), 1);
  inventory.refreshItems();
  Shared.animate(player, "human_pickupfloor");
  const cell = CELL[tier];
  if (tile.tier === 0) {
    tile.tier = tier;
    raiseBarrier(tile);
    Shared.sound(player, SOUND.PLACE);
    reward(player, cell.place, cell.xp);
  } else if (tier > tile.tier) {
    tile.tier = tier;
    raiseBarrier(tile);
    Shared.sound(player, SOUND.STRENGTHEN);
    player.sendMessage(`The ${cell.name} cell is consumed as it <col=ff0000>strengthens</col> the barrier.`);
    reward(player, cell.strengthen, cell.xp + STRENGTHEN_BONUS_XP);
  } else {
    const full = tile.npc && tile.npc.getHitpoints() >= tile.npc.getMaxHitpoints();
    tile.npc?.heal(cell.heal);
    Shared.sound(player, SOUND.RECHARGE);
    player.sendMessage(`The ${cell.name} cell is consumed as it <col=ff0000>recharges</col> the barrier.`);
    if (full) rewardCapped(player, cell.recharge, cell.xp);
    else reward(player, cell.recharge, cell.xp);
  }
  return true;
}

function reward(player, energy, xp) {
  if (!Game.isRunning()) return;
  Game.addEnergy(player, "elemental", energy);
  Game.addEnergy(player, "catalytic", energy);
  Shared.addXp(player, "RUNECRAFTING", xp);
}

/** Wiki: recharging a full barrier pays up to 2,500 XP and 450 energy a game. */
function rewardCapped(player, energy, xp) {
  const state = Game.stateOf(player);
  if (!state || !Game.isRunning()) return;
  state.fullRecharge ??= { xp: 0, energy: 0 };
  const paidEnergy = Math.max(0, Math.min(energy, FULL_HEALTH_CAP.energy - state.fullRecharge.energy));
  const paidXp = Math.max(0, Math.min(xp, FULL_HEALTH_CAP.xp - state.fullRecharge.xp));
  state.fullRecharge.energy += paidEnergy;
  state.fullRecharge.xp += paidXp;
  if (paidEnergy > 0) {
    Game.addEnergy(player, "elemental", paidEnergy);
    Game.addEnergy(player, "catalytic", paidEnergy);
  }
  if (paidXp > 0) Shared.addXp(player, "RUNECRAFTING", paidXp);
}

function repair(event) {
  const { player } = event;
  const tile = eventTile(event);
  if (!tile || !tile.broken || !Game.isPlaying(player)) return false;
  if (Shared.count(player, Shared.ITEM.FRAGMENTS) < REPAIR_FRAGMENTS) {
    Shared.itemStatement(player, Shared.ITEM.FRAGMENTS, `You need ${REPAIR_FRAGMENTS} guardian fragments to repair the cell tile.`);
    return true;
  }
  player.getInventory().delete(Shared.obj(Shared.ITEM.FRAGMENTS), REPAIR_FRAGMENTS);
  player.getInventory().refreshItems();
  Shared.animate(player, "human_pickupfloor");
  tile.broken = false;
  tileLoc(tile);
  Game.addEnergy(player, "elemental", REPAIR_ENERGY);
  Game.addEnergy(player, "catalytic", REPAIR_ENERGY);
  return true;
}

/** Cells and talismans don't survive being dropped (rsprox captures). */
function dropDestroys(event) {
  const { player, itemId } = event;
  const name = DROP_DESTROYS.find((item) => Shared.obj(item) === itemId);
  if (!name || Shared.count(player, name) <= 0) return;
  event.handled = true;
  const amount = Shared.count(player, name);
  player.getInventory().delete(itemId, amount);
  player.getInventory().refreshItems();
  const itemName = Shared.core().ItemDefinition.forId(itemId).getName();
  Shared.spam(player, `The ${itemName} is destroyed as you drop it.`);
  Shared.sound(player, SOUND.DROP);
}

function start() {
  for (const tile of tiles) tileLoc(tile);
}

module.exports = {
  CELL, TILES, tiles, bestCell, damage, barrierNpcs, tileOfNpc, reset,
  attach(pluginApi) {
    api = pluginApi;
    pluginApi.onServerStartup(start);
    pluginApi.onObjectInteraction("Uncharged cells", { "Take-10": takeTen, "Take-1": takeOne });
    pluginApi.onObjectInteraction("Weak cells", { Take: takeWeakCell, "Take-chisel": takeChisel });
    pluginApi.onObjectInteraction("Inactive cell tile", { "Place-cell": placeCell });
    pluginApi.onObjectInteraction("Weak cell tile", { "Place-cell": placeCell });
    pluginApi.onObjectInteraction("Medium cell tile", { "Place-cell": placeCell });
    pluginApi.onObjectInteraction("Strong cell tile", { "Place-cell": placeCell });
    pluginApi.onObjectInteraction("Overpowered cell tile", { "Place-cell": placeCell });
    pluginApi.onObjectInteraction("Cell tile (broken)", { Repair: repair });
    pluginApi.onItemDropPolicy(dropDestroys);
    Game.on("surge", surge);
    Game.on("ended", reset);
    Game.on("tick", checkBarriers);
  },
};
