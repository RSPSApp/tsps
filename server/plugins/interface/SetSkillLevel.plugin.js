const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");
const { CombatFactory } = require("../../src/main/typescript/elvarg/game/content/combat/CombatFactory");
const { Wilderness } = require("../../src/main/typescript/elvarg/game/content/wilderness/Wilderness");
const { PlayerRights } = require("../../src/main/typescript/elvarg/game/model/rights/PlayerRights");
const Presets = require("../modes/pvp/Presets");

const SKILLS_TAB_GROUP_ID = 320;
// Combat skills, keyed by their component in the Skills tab (interface 320).
const COMBAT_SKILLS = new Map([
  [1, Skill.ATTACK],
  [2, Skill.STRENGTH],
  [3, Skill.DEFENCE],
  [4, Skill.RANGED],
  [5, Skill.PRAYER],
  [6, Skill.MAGIC],
  [9, Skill.HITPOINTS],
]);

function isDeveloper(player) {
  return player.getRights?.()?.getId?.() === PlayerRights.DEVELOPER.getId();
}

/** Why this player cannot set stats here, or null when they can. */
function blockReason(player) {
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

module.exports = {
  name: "SetSkillLevel",
  register(api) {
    api.onInterfaceActionClick((event) => {
      const { player, groupId, childId } = event;
      const skill =
        Number(groupId) === SKILLS_TAB_GROUP_ID
          ? COMBAT_SKILLS.get(Number(childId))
          : undefined;
      if (!skill) return;
      event.handled = true;

      if (!isDeveloper(player)) {
        if (!Presets.isEnabled()) {
          player.sendMessage("Setting skill levels requires enabled presets.");
          return;
        }
        const reason = blockReason(player);
        if (reason) {
          player.sendMessage(reason);
          return;
        }
      }
      promptForLevel(player, skill);
    });
  },
};
