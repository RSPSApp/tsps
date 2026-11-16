/**
 * Cannonballs (https://oldschool.runescape.wiki/w/Cannonball): bars poured into an ammo mould
 * at any furnace, 4 balls a bar; the double ammo mould takes two bars a time for 8 balls at the
 * same speed. Every cannonball needs Dwarf Cannon. The furnace's Smelt menu offers a cannonball
 * for each bar the player carries (with a mould), and a bar used on a furnace opens it too.
 *
 * Not captured: the Wiki gives 8 ticks for the first batch and 10 between, the bone-burying
 * animation (human_pickupfloor), and the experience; the messages are the game's long-standing ones, not
 * checked against a capture (docs/smithing.md).
 *
 * The Ancient Furnace (Grimstone) casts them "at twice the rate of 5 ticks per action instead of 10" (Wiki: Cannonball,
 * Ancient Furnace). The Wiki gives no first-batch figure there; TSPS pours 4 ticks in (half of 8), inside the 5-tick action.
 * Not captured: no recording smelts at the Ancient Furnace.
 */
const Core = require("./Core.Smithing");
const Data = require("./Data.Smithing");
const Sessions = require("./Sessions.Smithing");
const Smelting = require("./Smelting.Smithing");
const { animation } = require("./Common.Smithing");

const FIRST_TICKS = 8;
const INTERVAL_TICKS = 10;
const ANCIENT_FURNACE = "grimstone_furnace";
const ANCIENT_FIRST_TICKS = 4;
const ANCIENT_INTERVAL_TICKS = 5;
const BALLS_PER_BAR = 4;
const QUEST = "dwarf_cannon";

function ancientFurnace(furnaceId) {
  return Number.isInteger(furnaceId) && furnaceId >= 0 && furnaceId === Core.CacheDefinitions.getLocId(ANCIENT_FURNACE);
}

function mouldOf(player) {
  const inventory = player.getInventory();
  if (inventory.contains(Core.ItemIdentifiers.DOUBLE_AMMO_MOULD)) return { bars: 2 };
  if (inventory.contains(Core.ItemIdentifiers.AMMO_MOULD)) return { bars: 1 };
  return null;
}

function cannonballFor(barId) {
  return Data.cannonballs().find((cannonball) => cannonball.barId === barId) ?? null;
}

function pour(player, cannonball) {
  const mould = mouldOf(player);
  const inventory = player.getInventory();
  const bars = Math.min(mould?.bars ?? 0, inventory.getAmount(cannonball.barId));
  if (!mould) {
    player.sendMessage("You need an ammo mould to make cannonballs.");
    return false;
  }
  if (bars <= 0) {
    player.sendMessage(`You have run out of ${Core.ItemDefinition.forId(cannonball.barId).getName().toLowerCase()}s.`);
    return false;
  }
  inventory.deleteNumber(cannonball.barId, bars);
  inventory.addItem(new Core.Item(cannonball.ballId, bars * BALLS_PER_BAR));
  player.getSkillManager().addExperiences(Core.Skill.SMITHING, cannonball.xpPerBar * bars);
  player.sendMessage(`The molten metal cools slowly to form ${bars * BALLS_PER_BAR} cannonballs.`);
  Core.api.emitCustomEvent("smithing:success", { player, skill: Core.Skill.SMITHING, itemId: cannonball.ballId });
  require("./Common.Smithing").produced(player, Core.Skill.SMITHING, cannonball.ballId, bars * BALLS_PER_BAR, cannonball.xpPerBar * bars, "cannonballs");
  return true;
}

function begin(player, cannonball) {
  if (player.getInventory().getAmount(cannonball.barId) <= 0 || !mouldOf(player)) return pour(player, cannonball);
  player.sendMessage(`You heat the ${cannonball.metal} bar into a liquid state.`);
  player.sendMessage("You pour the molten metal into your cannonball mould.");
  player.performAnimation(animation("human_pickupfloor"));
  return true;
}

function start(player, cannonball, amount, furnaceId = -1) {
  if (!Core.WorldDefinition.isMembersWorld()) return false;
  if (!Core.questComplete(player, QUEST)) {
    player.sendMessage(`You need to complete ${Data.questName(QUEST)} to make cannonballs.`);
    return false;
  }
  if (require("./Common.Smithing").smithingLevel(player) < cannonball.level) {
    Smelting.statement(player, `You need a Smithing level of ${cannonball.level} to make ${cannonball.metal} cannonballs.`);
    return false;
  }
  const mould = mouldOf(player);
  const most = mould ? Math.ceil(player.getInventory().getAmount(cannonball.barId) / mould.bars) : 0;
  if (most <= 0) return false;
  Sessions.start(player, {
    type: "cannonballs",
    remaining: Math.min(amount, most),
    interval: ancientFurnace(furnaceId) ? ANCIENT_INTERVAL_TICKS : INTERVAL_TICKS,
    finishDelay: ancientFurnace(furnaceId) ? ANCIENT_FIRST_TICKS : FIRST_TICKS,
    begin: (smith) => begin(smith, cannonball),
    step: (smith) => pour(smith, cannonball),
  });
  return true;
}

/** The Smelt menu's cannonball entries: one per bar carried, with a mould. */
function menuEntries(player, furnaceId = -1) {
  const mould = mouldOf(player);
  if (!mould || !Core.WorldDefinition.isMembersWorld()) return [];
  const inventory = player.getInventory();
  return Data.cannonballs()
    .filter((cannonball) => inventory.contains(cannonball.barId))
    .map((cannonball) => ({
      itemId: cannonball.ballId,
      most: Math.ceil(inventory.getAmount(cannonball.barId) / mould.bars),
      start: (smith, amount) => start(smith, cannonball, amount, furnaceId),
    }));
}

/** A bar used on a furnace, with a mould, opens a menu of its cannonball. */
function useOnFurnace(event) {
  const cannonball = cannonballFor(event.itemId);
  if (!cannonball || !mouldOf(event.player)) return false;
  event.handled = true;
  const furnaceId = event.objectId ?? event.object?.getId?.() ?? -1;
  Smelting.openMenu(event.player, menuEntries(event.player, furnaceId).filter((entry) => entry.itemId === cannonball.ballId));
  return true;
}

module.exports = function attach() {
  Smelting.addMenuEntries(menuEntries);
};

Object.assign(module.exports, { useOnFurnace });
