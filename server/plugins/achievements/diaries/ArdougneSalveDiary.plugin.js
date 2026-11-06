const DIARY = "ardougne";
const TASK = "imbue-a-salve-amulet-at-nightmare-zone-or-equip";

function isActivePlayer(player) {
  return player?.isRegistered?.() === true && player.getHitpoints?.() > 0 && !player.isDyingReturn?.();
}

function completedSalveImbue({ player, baseItemId, imbuedItemId } = {}, api) {
  const ids = api.core.ItemIdentifiers;
  if (!isActivePlayer(player)
    || !((baseItemId === ids.SALVE_AMULET && imbuedItemId === ids.SALVE_AMULET_I_)
      || (baseItemId === ids.SALVE_AMULET_E_ && imbuedItemId === ids.SALVE_AMULET_EI_))) return;
  api.emitCustomEvent("diary:task", { player, diary: DIARY, task: TASK });
}

function equippedSalve({ player, equipped, itemId, slot } = {}, api) {
  if (equipped !== true || !isActivePlayer(player)) return;
  const ids = api.core.ItemIdentifiers;
  if (slot !== api.core.Equipment.AMULET_SLOT || ![ids.SALVE_AMULET_I_, ids.SALVE_AMULET_EI_].includes(itemId)) return;
  api.emitCustomEvent("diary:task", { player, diary: DIARY, task: TASK });
}

function onSalveImbued(api, event) {
  completedSalveImbue(event, api);
}

function onEquipmentChanged(api, event) {
  equippedSalve(event, api);
}

module.exports = {
  name: "ArdougneSalveDiary",
  members: true,
  dependsOn: ["AchievementDiaries"],
  register(api) {
    api.onCustomEvent("nightmare-zone:imbued", onSalveImbued.bind(null, api));
    api.onCustomEvent("equipment:changed", onEquipmentChanged.bind(null, api));
  },
  _test: { isActivePlayer, completedSalveImbue, equippedSalve, TASK },
};
