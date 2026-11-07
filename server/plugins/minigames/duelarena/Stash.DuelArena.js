/**
 * The player's own character while they fight an unranked duel. Live PvP Arena worlds give a
 * separate arena character; here the main one fights, so its belongings are put aside for the
 * fight, as Last Man Standing does (lms/Stash.LastManStanding.js has the same shape):
 * - the fight starting saves the inventory, the equipment (with each item's meta), the combat
 *   skills, the spellbook, special and run energy in a saved attribute, then empties both;
 * - leaving the arena (a win, a death, a forfeit) puts everything back as it was;
 * - a player who logs out or whose world stops mid-fight gets theirs back on the next login, in
 *   the Emir's Arena.
 */
const Common = require("./Common.DuelArena");

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

function stashed(player) {
  return player.getAttribute(Common.ATTRIBUTES.stash) ?? null;
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

/** Saves everything the fight replaces; a second call while one is held keeps the first. */
function save(player) {
  if (stashed(player)) return;
  player.setAttribute(Common.ATTRIBUTES.stash, {
    inventory: itemsOf(player.getInventory()),
    equipment: itemsOf(player.getEquipment()),
    skills: skillsOf(player),
    spellbook: spellbookName(player),
    special: player.getSpecialPercentage(),
    run: player.getRunEnergy(),
  });
  clear(player);
}

function fill(container, items) {
  const { Item } = Common.core;
  items.forEach((entry, slot) => {
    container.setItem(slot, entry ? new Item(entry[0], entry[1], entry[2] ? { ...entry[2] } : null) : new Item(-1, 0));
  });
  container.refreshItems();
}

/** Everything back as it was before the fight; nothing to do when nothing is held. */
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
  player.setAttribute(Common.ATTRIBUTES.stash, null);
  WeaponInterfaceManager.assign(player);
  BonusManager.update(player);
  player.getUpdateFlag().flag(Flag.APPEARANCE);
  return true;
}

/** A save made mid-fight (a crash, a restart): their belongings back, in the Emir's Arena. */
function login({ player }) {
  if (!stashed(player)) return;
  restore(player);
  const exits = Common.data.arena.sides[0].exits;
  player.moveTo(Common.location(exits[Math.floor(Math.random() * exits.length)]));
}

function attachStash(api) {
  api.persistAttribute(Common.ATTRIBUTES.stash, null);
  api.onPlayerLogin(login);
}

module.exports = { attachStash, save, restore, stashed, clear, COMBAT_SKILLS };
