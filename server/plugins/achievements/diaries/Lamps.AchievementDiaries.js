/**
 * The diary reward lamps (Wiki: Antique lamp (easy/medium/hard/elite) and Karamja's own three):
 * rub, choose a skill on the xpreward interface (plugins/interface/XpReward.plugin.js) - which
 * offers only skills at the lamp's level - and gain the lamp's experience.
 */
const { LAMPS } = require("./Data.AchievementDiaries");

const pending = new WeakMap();
let pluginApi;

function rub({ player, item, itemId, slot }) {
  const lamp = LAMPS.get(itemId);
  if (!lamp) return false;
  if (player.getInventory().get(slot) !== item) return true;
  const request = { item, slot, lamp };
  pending.set(player, request);
  pluginApi.emitCustomEvent("xpreward:open", {
    player, minLevel: lamp.minLevel, onConfirm: (skill, name) => grant(player, request, skill, name),
  });
  return true;
}

/** The message box text, or null when the lamp is kept. */
function grant(player, request, skill, name = skill.getName()) {
  if (pending.get(player) !== request) return null;
  pending.delete(player);
  const inventory = player.getInventory();
  if (inventory.get(request.slot) !== request.item) return null;
  const manager = player.getSkillManager();
  if (manager.getMaxLevel(skill) < request.lamp.minLevel) return null;
  const before = manager.getExperience(skill);
  manager.addExperience(skill, request.lamp.xp, true);
  if (manager.getExperience(skill) === before) {
    player.sendMessage("You cannot gain experience in that skill right now.");
    return null;
  }
  inventory.deleteAtSlot(request.slot, 1);
  return `<col=0000ff>Your wish has been granted!</col><br>You have been awarded ${request.lamp.xp.toLocaleString("en-GB")} ${name} experience!`;
}

module.exports = function attachLamps(api) {
  pluginApi = api;
  api.onItemAction("Antique lamp", { Rub: rub });
};

Object.assign(module.exports, { rub, grant });
