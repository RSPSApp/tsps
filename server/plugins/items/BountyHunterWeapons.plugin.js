/**
 * Wiki: imbued weapons can only attack inside the listed PvP minigames and combat rings. Zuriel's staff (bh) too
 * (Wiki: "it can only be used within" the same areas; only the activated staff can be wielded, cache).
 */

function restrictWeapon(api, event) {
  const { core } = api;
  const { attacker, target } = event;
  if (!attacker?.isPlayer?.()) return;
  const weapon = attacker.getAsPlayer().getEquipment().get(core.Equipment.WEAPON_SLOT);
  const { ItemIdentifiers: I } = core;
  if (![I.DARK_BOW_BH_, I.ABYSSAL_DAGGER_BH_, I.ABYSSAL_DAGGER_BH_P_,
    I.ABYSSAL_DAGGER_BH_P_PLUS_, I.ABYSSAL_DAGGER_BH_P_PLUS_PLUS_, I.ZURIELS_STAFF_BH_].includes(weapon?.getId())) return;
  const request = { attacker, target, allowed: false };
  api.emitCustomEvent("bounty-hunter:weapon-area", request);
  if (!request.allowed) {
    event.allow = false;
    attacker.getAsPlayer().sendMessage("This weapon can only be used in the permitted PvP minigames and combat rings.");
  }
}

module.exports = {
  name: "BountyHunterWeapons",
  description: "Restricts imbued Bounty Hunter weapons, like the dark bow (BH), abyssal daggers (BH) and Zuriel's staff (bh), to permitted PvP minigames and combat rings.",
  members: true,
  register(pluginApi) {
    pluginApi.onCanAttack(restrictWeapon.bind(null, pluginApi));
  },
};
