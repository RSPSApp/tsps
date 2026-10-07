/**
 * Ring of life and Defence cape (https://oldschool.runescape.wiki/w/Ring_of_life).
 *
 * When a combat hit leaves the wearer at 10% or less of their maximum Hitpoints
 * (but not dead), the ring teleports them to their respawn point and crumbles;
 * a worn Defence cape does the same without being destroyed. The teleport works
 * up to level 30 Wilderness, but Tele Block stops it and the effect never cures
 * poison.
 */
const Equipment = require("../../src/main/typescript/elvarg/game/model/container/impl/Equipment").Equipment;
const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");

let core = null;
let ringIds = new Set();
let capeIds = new Set();

function onIncomingDamage(entity, hitDamage) {
  if (!entity?.isPlayer?.() || !(hitDamage?.getDamage?.() > 0)) {
    return;
  }
  const player = entity.getAsPlayer();
  const hitpoints = player.getSkillManager();
  const current = hitpoints.getCurrentLevel(Skill.HITPOINTS);
  const max = hitpoints.getMaxLevel(Skill.HITPOINTS);
  const remaining = current - hitDamage.getDamage();
  if (remaining <= 0 || remaining > Math.floor(max / 10)) {
    return;
  }

  const equipment = player.getEquipment();
  const ringItem = equipment.get(Equipment.RING_SLOT);
  const ringId = ringItem?.getId?.();
  const capeId = equipment.get(Equipment.CAPE_SLOT)?.getId?.();
  const hasRing = ringIds.has(ringId);
  const hasCape = capeIds.has(capeId);
  if (!hasRing && !hasCape) {
    return;
  }

  if (!player.getCombat()?.getTeleblockTimer?.()?.finished?.()) {
    return;
  }
  const destination = core.GameConstants.DEFAULT_LOCATION;
  if (!core.TeleportHandler.checkReqs(player, destination, 30)) {
    return;
  }

  if (hasRing) {
    equipment.deleteNumber(ringId, 1);
    equipment.refreshItems();
    player.sendMessage("Your Ring of Life saves you and is destroyed in the process.");
  } else {
    player.sendMessage("Your Defence cape saves you.");
  }
  core.TeleportHandler.teleport(player, destination, core.TeleportType.NORMAL, false);
}

module.exports = {
  name: "RingOfLife",
  members: true,
  _test: { onIncomingDamage },
  register(api) {
    core = api.core;
    ringIds = new Set([core.ItemIdentifiers.RING_OF_LIFE]);
    capeIds = new Set([
      core.ItemIdentifiers.DEFENCE_CAPE,
      core.ItemIdentifiers.DEFENCE_CAPE_T_,
    ]);
    api.registerIncomingDamageModifier(onIncomingDamage);
  },
};
