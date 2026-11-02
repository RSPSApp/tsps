"use strict";

let core;
let game;
const SCORER = "scorer";
const DEFENDER = "defender";
const ACTION_INTERVAL_MS = 600;

function isPractice(role) {
  return role === SCORER || role === DEFENDER;
}

function gear(player, slot, id) {
  if (player.getEquipment().getSlot(slot) === id) return false;
  player.getEquipment().setItem(slot, new core.Item(id, 1));
  return true;
}

function supply(player, id, amount = 1) {
  const inventory = player.getInventory();
  if (inventory.getAmount(id) < amount) inventory.adds(id, amount - inventory.getAmount(id));
}

function useOnBarricade(player, npc, itemId) {
  // Practice opponents keep tool supplies available for the full session.
  if (itemId === core.ItemIdentifiers.BUCKET_OF_WATER && !player.getInventory().contains(itemId)) player.getInventory().delete(core.ItemIdentifiers.BUCKET, 1);
  supply(player, itemId);
  const slot = player.getInventory().getSlotForItemId(itemId);
  if (slot < 0) return false;
  return core.PluginManager.emitItemOnNpc({ player, target: npc, npcId: npc.getId(), targetIndex: npc.getIndex(), item: player.getInventory().getItems()[slot], itemId, slot, interfaceId: 0, handled: false });
}

function nearestBarricade(player, radius) {
  let nearest = null;
  let distance = radius + 1;
  for (const npc of core.World.getNpcs()) {
    if (!npc || !game.isBarricade(npc) || npc.getLocation().getZ() !== player.getLocation().getZ()) continue;
    const next = Math.abs(player.getLocation().getX() - npc.getLocation().getX()) + Math.abs(player.getLocation().getY() - npc.getLocation().getY());
    if (next < distance) { nearest = npc; distance = next; }
  }
  return nearest;
}

function scorerTools(ctx, state) {
  if (ctx.nowMs < (state.nextToolAt ?? 0)) return "failure";
  const npc = nearestBarricade(ctx.player, 1);
  if (!npc) return "failure";
  const burning = npc.getNpcTransformationId() !== -1;
  const used = useOnBarricade(ctx.player, npc, burning ? core.ItemIdentifiers.BUCKET_OF_WATER : core.ItemIdentifiers.EXPLOSIVE_POTION);
  if (!used) return "failure";
  state.nextToolAt = ctx.nowMs + ACTION_INTERVAL_MS;
  return "running";
}

function defenderTools(ctx, state, target) {
  if (!target || ctx.nowMs < (state.nextToolAt ?? 0)) return "failure";
  const player = ctx.player;
  const I = core.ItemIdentifiers;
  const npc = nearestBarricade(player, 1);
  if (npc) {
    const burning = npc.getNpcTransformationId() !== -1;
    // Burning barriers resist explosives; water saves them before they collapse.
    const item = burning ? I.BUCKET_OF_WATER : player.calculateDistance(target) <= 3 ? I.TINDERBOX : null;
    if (item && useOnBarricade(player, npc, item)) {
      state.nextToolAt = ctx.nowMs + 1800;
      return "running";
    }
    return "failure";
  }
  if (player.calculateDistance(target) > 4 || ctx.nowMs < (state.nextBarricadeAt ?? 0)) return "failure";
  supply(player, I.BARRICADE);
  const barricadeSlot = player.getInventory().getSlotForItemId(I.BARRICADE);
  if (barricadeSlot < 0) return "failure";
  core.PluginManager.emitItemAction({ player, itemId: I.BARRICADE, item: player.getInventory().getItems()[barricadeSlot], slot: barricadeSlot, interfaceId: 0, clickType: 1, option: "Set-up", handled: false });
  state.nextBarricadeAt = ctx.nowMs + 6000;
  state.nextToolAt = ctx.nowMs + ACTION_INTERVAL_MS;
  return "running";
}

function defenderAttack(ctx, state, target) {
  if (!target) return "failure";
  const player = ctx.player;
  const spear = player.calculateDistance(target) === 1 && target.getTimers().has(core.TimerKey.FREEZE) && player.getSpecialPercentage() >= 25;
  if (gear(player, core.Equipment.WEAPON_SLOT, spear ? core.ItemIdentifiers.ZAMORAKIAN_HASTA : core.ItemIdentifiers.KODAI_WAND)) game.refreshPlayerAppearance(player, true);
  if (spear) {
    player.getCombat().setCastSpell(null);
    player.getCombat().setAutocastSpell(null);
    player.setSpecialActivated(true);
    player.getCombat().attack(target);
  } else {
    player.setSpecialActivated(false);
    const level = player.getSkillManager().getCurrentLevel(core.Skill.MAGIC);
    const spell = [core.CombatSpells.ICE_BARRAGE, core.CombatSpells.ICE_BLITZ, core.CombatSpells.ICE_BURST, core.CombatSpells.ICE_RUSH]
      .map((entry) => entry.getSpell()).find((spell) => spell.levelRequired() <= level);
    if (!spell) { player.getCombat().attack(target); return "running"; }
    core.Autocasting.setAutocast(player, spell);
    player.getCombat().castSpellOn(target, spell);
  }
  return "running";
}

module.exports = function attachCastleWarsPractice(api, castleWars) {
  core = api.core;
  game = castleWars;
  game.practiceBots = { supply, scorerTools, defenderTools, defenderAttack };
};

module.exports._test = { SCORER, DEFENDER, isPractice, nearestBarricade, scorerTools, defenderTools, defenderAttack };
