/**
 * Cannonballs (https://oldschool.runescape.wiki/w/Cannonball): bars poured into an ammo mould
 * at any furnace, 4 balls a bar; the double ammo mould takes two bars a time for 8 balls at the
 * same speed. Every cannonball needs Dwarf Cannon. The furnace's Smelt menu offers a cannonball
 * for each bar the player carries (with a mould), and a bar used on a furnace opens it too.
 *
 * Not captured: the Wiki gives 8 ticks for the first batch and 10 between, the bone-burying
 * animation (human_pickupfloor), and the experience; the messages are the game's long-standing ones, not
 * checked against a capture (docs/smithing.md).
 */
const Core = require("./Core.Smithing");
const Data = require("./Data.Smithing");
const Sessions = require("./Sessions.Smithing");
const Smelting = require("./Smelting.Smithing");
const { animation } = require("./Common.Smithing");

const FIRST_TICKS = 8;
const INTERVAL_TICKS = 10;
const BALLS_PER_BAR = 4;
const QUEST = "dwarf_cannon";

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
  return true;
}

function begin(player, cannonball) {
  if (player.getInventory().getAmount(cannonball.barId) <= 0 || !mouldOf(player)) return pour(player, cannonball);
  player.sendMessage(`You heat the ${cannonball.metal} bar into a liquid state.`);
  player.sendMessage("You pour the molten metal into your cannonball mould.");
  player.performAnimation(animation("human_pickupfloor"));
  return true;
}

function start(player, cannonball, amount) {
  if (!Core.WorldDefinition.isMembersWorld()) return false;
  if (!Core.questComplete(player, QUEST)) {
    player.sendMessage(`You need to complete ${Data.questName(QUEST)} to make cannonballs.`);
    return false;
  }
  if (player.getSkillManager().getCurrentLevel(Core.Skill.SMITHING) < cannonball.level) {
    Smelting.statement(player, `You need a Smithing level of ${cannonball.level} to make ${cannonball.metal} cannonballs.`);
    return false;
  }
  const mould = mouldOf(player);
  const most = mould ? Math.ceil(player.getInventory().getAmount(cannonball.barId) / mould.bars) : 0;
  if (most <= 0) return false;
  Sessions.start(player, {
    type: "cannonballs",
    remaining: Math.min(amount, most),
    interval: INTERVAL_TICKS,
    finishDelay: FIRST_TICKS,
    begin: (smith) => begin(smith, cannonball),
    step: (smith) => pour(smith, cannonball),
  });
  return true;
}

/** The Smelt menu's cannonball entries: one per bar carried, with a mould. */
function menuEntries(player) {
  const mould = mouldOf(player);
  if (!mould || !Core.WorldDefinition.isMembersWorld()) return [];
  const inventory = player.getInventory();
  return Data.cannonballs()
    .filter((cannonball) => inventory.contains(cannonball.barId))
    .map((cannonball) => ({
      itemId: cannonball.ballId,
      most: Math.ceil(inventory.getAmount(cannonball.barId) / mould.bars),
      start: (smith, amount) => start(smith, cannonball, amount),
    }));
}

/** A bar used on a furnace, with a mould, opens a menu of its cannonball. */
function useOnFurnace(event) {
  const cannonball = cannonballFor(event.itemId);
  if (!cannonball || !mouldOf(event.player)) return false;
  event.handled = true;
  Smelting.openMenu(event.player, menuEntries(event.player).filter((entry) => entry.itemId === cannonball.ballId));
  return true;
}

module.exports = function attach() {
  Smelting.addMenuEntries(menuEntries);
};

Object.assign(module.exports, { useOnFurnace });
