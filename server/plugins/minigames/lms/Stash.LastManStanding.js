/**
 * The player's own belongings while they play (Wiki: "any items in the player's possession are
 * temporarily taken away for the duration of the game, and are returned upon leaving the game"):
 * - entering a game saves the inventory, the equipment (with each item's meta), the combat
 *   skills, the spellbook, special and run energy in a saved attribute, then empties both;
 * - leaving one (death, a win, a forfeit) puts everything back as it was;
 * - a player who logs out or whose world stops mid-game gets theirs back on the next login, in
 *   the lobby.
 */
const Common = require("./Common.LastManStanding");

const COMBAT_SKILLS = ["ATTACK", "DEFENCE", "STRENGTH", "HITPOINTS", "RANGED", "PRAYER", "MAGIC"];

function itemsOf(container) {
  return container.getItems().map((item) => (item && item.getId() > 0 ? [item.getId(), item.getAmount(), item.getMeta()] : null));
}

function skillsOf(player) {
  const skills = player.getSkillManager();
  return COMBAT_SKILLS.map((name) => {
    const skill = Common.core.Skill[name];
    const index = skill.getIndex();
    return [skills.getCurrentLevel(skill), skills.getMaxLevels(index), skills.skills?.experience?.[index] ?? skills.getExperience(skill)];
  });
}

/** Captured: 0 -> 2 as a player steps into a waiting area, 2 -> 0 as their things come back. */
const HOLDING = "holding_inventory_location";
const HOLDING_LMS = 2;

function stashed(player) {
  return player.getAttribute(Common.ATTRIBUTES.stash) ?? null;
}

/** Saves everything the game replaces; a second call while one is held keeps the first. */
function save(player) {
  if (stashed(player)) return;
  player.setAttribute(Common.ATTRIBUTES.stash, {
    inventory: itemsOf(player.getInventory()),
    equipment: itemsOf(player.getEquipment()),
    skills: skillsOf(player),
    spellbook: spellbookName(player),
    special: player.getSpecialPercentage(),
    run: player.getRunEnergy(),
    timers: timersOf(player),
  });
  clear(player);
  stopTimers(player);
  Common.varbit(player, HOLDING, HOLDING_LMS);
}

/**
 * The player's own Tele Block, antifire and poison/venom state are put aside with their things, and the game's
 * stopped when they leave: a Tele Block from an LMS fight never follows them out, and an antifire from before
 * the game is not carried into it.
 */
function timersOf(player) {
  const combat = player.getCombat();
  return {
    teleblock: combat.getTeleblockTimer().secondsRemaining(),
    fire: combat.getFireImmunityTimer().secondsRemaining(),
    poison: combat.getPoisonClock().finished() ? null : combat.getPoisonClock().snapshot(),
  };
}

function stopTimers(player) {
  const combat = player.getCombat();
  combat.getTeleblockTimer().stop();
  combat.getFireImmunityTimer().stop();
  combat.getPoisonClock().stop();
  player.getPacketSender().sendEffectTimer?.(0, Common.core.EffectTimer?.TELE_BLOCK);
}

function restoreTimers(player, timers) {
  stopTimers(player);
  if (!timers) return;
  const combat = player.getCombat();
  if (timers.teleblock > 0) {
    combat.getTeleblockTimer().start(timers.teleblock);
    player.getPacketSender().sendEffectTimer?.(timers.teleblock, Common.core.EffectTimer?.TELE_BLOCK);
  }
  if (timers.fire > 0) combat.getFireImmunityTimer().start(timers.fire);
  if (timers.poison) combat.getPoisonClock().restore(timers.poison);
}

function spellbookName(player) {
  const { MagicSpellbook } = Common.core;
  const book = player.getSpellbook();
  return ["NORMAL", "ANCIENT", "LUNAR", "ARCEUUS"].find((name) => MagicSpellbook[name] === book) ?? "NORMAL";
}

function clear(player) {
  player.getInventory().resetItems().refreshItems();
  player.getEquipment().resetItems().refreshItems();
}

function fill(container, items) {
  const { Item } = Common.core;
  items.forEach((entry, slot) => {
    container.setItem(slot, entry ? new Item(entry[0], entry[1], entry[2] ? { ...entry[2] } : null) : new Item(-1, 0));
  });
  container.refreshItems();
}

/** Everything back as it was before the game; nothing to do when nothing is held. */
function restore(player) {
  const stash = stashed(player);
  if (!stash) return false;
  const { Skill, MagicSpellbook, Flag, WeaponInterfaceManager, BonusManager, CombatSpecial } = Common.core;
  fill(player.getInventory(), stash.inventory);
  fill(player.getEquipment(), stash.equipment);
  const skills = player.getSkillManager();
  COMBAT_SKILLS.forEach((name, index) => {
    const [level, max, experience] = stash.skills[index] ?? [];
    const skill = Skill[name];
    if (max == null) return;
    skills.setMaxLevels(skill, max, false);
    skills.setExperiences(skill, experience, false);
    skills.setCurrentLevel(skill, level, true);
  });
  const book = MagicSpellbook[stash.spellbook] ?? MagicSpellbook.NORMAL;
  player.setSpellbook(book);
  player.getPacketSender().sendTabInterface(6, book.getInterfaceId());
  player.setSpecialPercentage(stash.special ?? 100);
  CombatSpecial.updateBar(player);
  player.setRunEnergy(stash.run ?? 100);
  restoreTimers(player, stash.timers);
  player.setAttribute(Common.ATTRIBUTES.stash, null);
  Common.varbit(player, HOLDING, 0);
  WeaponInterfaceManager.assign(player);
  BonusManager.update(player);
  player.getUpdateFlag().flag(Flag.APPEARANCE);
  return true;
}

/**
 * A save made mid-game (a crash, a restart): their belongings come back as they log in, and they
 * are put in the lobby rather than on an arena copy that no longer exists.
 */
function login({ player }) {
  if (!stashed(player)) return;
  restore(player);
  const [x, y] = Common.pick(Common.data.lobby.afterGame);
  player.moveTo(new Common.core.Location(x, y, 0));
}

function attachStash(api) {
  api.persistAttribute(Common.ATTRIBUTES.stash, null);
  api.onPlayerLogin(login);
}

module.exports = { attachStash, save, restore, stashed, clear, COMBAT_SKILLS };
