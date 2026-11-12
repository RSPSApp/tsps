const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");
const { CombatFactory } = require("../../src/main/typescript/elvarg/game/content/combat/CombatFactory");
const { Wilderness } = require("../../src/main/typescript/elvarg/game/content/wilderness/Wilderness");
const { PlayerRights } = require("../../src/main/typescript/elvarg/game/model/rights/PlayerRights");
const Presets = require("../modes/pvp/Presets.PvpMode");

// Skills keyed by their component in the Skills tab (interface 320).
const SKILLS = new Map([
  [1, Skill.ATTACK],
  [2, Skill.STRENGTH],
  [3, Skill.DEFENCE],
  [4, Skill.RANGED],
  [5, Skill.PRAYER],
  [6, Skill.MAGIC],
  [7, Skill.RUNECRAFTING],
  [8, Skill.CONSTRUCTION],
  [9, Skill.HITPOINTS],
  [10, Skill.AGILITY],
  [11, Skill.HERBLORE],
  [12, Skill.THIEVING],
  [13, Skill.CRAFTING],
  [14, Skill.FLETCHING],
  [15, Skill.SLAYER],
  [16, Skill.HUNTER],
  [17, Skill.MINING],
  [18, Skill.SMITHING],
  [19, Skill.FISHING],
  [20, Skill.COOKING],
  [21, Skill.FIREMAKING],
  [22, Skill.WOODCUTTING],
  [23, Skill.FARMING],
  [24, Skill.SAILING],
]);

function isDeveloper(player) {
  return player.getRights?.()?.getId?.() === PlayerRights.DEVELOPER.getId();
}

/** Why this player cannot set stats here, or null when they can. */
function blockReason(player, skill) {
  if (isDeveloper(player)) return null;
  if (!skill.canSetLevel()) return "Only Developers can set non-combat skill levels.";
  if (!Presets.isEnabled()) return "Setting skill levels requires enabled presets.";
  if (player.getEquipment().getItems().some((item) => (item?.getId?.() ?? 0) > 0)) {
    return "You must remove all of your gear to set stats.";
  }
  if (Wilderness.isIn(player)) return "You cannot set stats in the Wilderness.";
  if (CombatFactory.inCombat(player)) return "You cannot set stats while in combat.";
  if (player.busy()) return "You cannot set stats while busy.";
  return null;
}

function promptForLevel(player, skill) {
  const minimum = skill === Skill.HITPOINTS ? 10 : 1;
  player.getPacketSender().sendInterfaceRemoval();
  player.setEnteredAmountAction({
    execute: (amount) => {
      const reason = blockReason(player, skill);
      if (reason) {
        player.sendMessage(reason);
        return;
      }
      const level = Number(amount);
      if (!Number.isInteger(level) || level < minimum || level > 99) {
        player.sendMessage(`Invalid level. Please enter a level from ${minimum} to 99.`);
        return;
      }
      player.getSkillManager().setLevel(skill, level);
    },
  });
  player.getPacketSender().sendEnterAmountPrompt(`Set ${skill.getName()} Level (${minimum}-99)`);
}

/**
 * A Skills tab click, offered by SkillGuide before it opens the guide: on PvP worlds (presets
 * enabled) a settable skill gets the level prompt instead; everywhere else the guide opens.
 */
function claimStatClick(offer) {
  const { player, childId } = offer;
  if (offer.handled || !Presets.isEnabled()) return;
  const skill = SKILLS.get(Number(childId));
  if (!skill || (!skill.canSetLevel() && !isDeveloper(player))) return;
  offer.handled = true;

  const reason = blockReason(player, skill);
  if (reason) {
    player.sendMessage(reason);
    return;
  }
  promptForLevel(player, skill);
}

module.exports = {
  name: "SetSkillLevel",
  description: "On PvP worlds with presets, clicking a Skills tab stat prompts you to set that skill's level, with checks against gear, combat and the Wilderness.",
  register(api) {
    api.onCustomEvent("skills:stat-clicked", claimStatClick);
  },
};
