/** Wiki: Dark bow (bh) can only attack inside the listed PvP minigames and combat rings. */
let core;
let api;

function restrictWeapon(event) {
  const { attacker, target } = event;
  if (!attacker?.isPlayer?.()) return;
  const weapon = attacker.getAsPlayer().getEquipment().get(core.Equipment.WEAPON_SLOT);
  if (weapon?.getId() !== core.ItemIdentifiers.DARK_BOW_BH_) return;
  const request = { attacker, target, allowed: false };
  api.emitCustomEvent("bounty-hunter:weapon-area", request);
  if (!request.allowed) {
    event.allow = false;
    attacker.getAsPlayer().sendMessage("This weapon can only be used in the permitted PvP minigames and combat rings.");
  }
}

module.exports = {
  name: "BountyHunterWeapons",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    pluginApi.onCanAttack(restrictWeapon);
  },
};
