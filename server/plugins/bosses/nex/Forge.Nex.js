/**
 * The Ancient Forge and the anvil beside it, in the Ancient Prison (docs/nex.md).
 *
 * - Forge, "Use" (captured): melts a Bandos chestplate into 3 Bandosian components or tassets into 2,
 *   asked first ("Melt down your Bandos chestplate into 3 Bandosian components?"), with seq 899 and
 *   synth 2725, the components (one a slot) three ticks later. "You don't have anything suitable to
 *   put in the forge." / "You require more inventory space to do that." No skill or XP (Wiki).
 * - Anvil, "Smith" (captured): repairs damaged Torva with Bandosian components ("Repair your Torva
 *   platebody with 2 Bandosian components?"), seq 898 every 4 ticks, then on the 12th tick the
 *   repaired piece in an object box ("... You feel mentally and physically exhausted.") with the
 *   Smithing XP. Wiki: Smithing 90, a hammer, 2,250 XP; helm 1 component, body 2. Legs 2 and the
 *   Strength and Prayer drain (to about 36% and 10%, in three steps) are read from one capture.
 */
const Common = require("./Common.Nex");

const FURNACE_ANIM = 899;
const FURNACE_SOUND = 2725;
const SMITH_ANIM = 898;
const SMITH_STEPS = 3;
const SMITH_STEP_TICKS = 4;
const SMITHING_LEVEL = 90;
const SMITHING_XP = 2250;
const DRAIN = { STRENGTH: [0.76, 0.54, 0.36], PRAYER: [0.58, 0.29, 0.1] };

function meltable() {
  const I = Common.core.ItemIdentifiers;
  return [
    { id: I.BANDOS_CHESTPLATE, name: "Bandos chestplate", components: 3 },
    { id: I.BANDOS_TASSETS, name: "Bandos tassets", components: 2 },
  ];
}

function repairs() {
  const I = Common.core.ItemIdentifiers;
  return [
    { damaged: I.TORVA_FULL_HELM_DAMAGED_, repaired: I.TORVA_FULL_HELM, name: "Torva full helm", components: 1 },
    { damaged: I.TORVA_PLATEBODY_DAMAGED_, repaired: I.TORVA_PLATEBODY, name: "Torva platebody", components: 2 },
    { damaged: I.TORVA_PLATELEGS_DAMAGED_, repaired: I.TORVA_PLATELEGS, name: "Torva platelegs", components: 2 },
  ];
}

function useForge({ player }) {
  const inventory = player.getInventory();
  const armour = meltable().find((piece) => inventory.contains(piece.id));
  if (!armour) {
    player.sendMessage("You don't have anything suitable to put in the forge.");
    return true;
  }
  const melt = () => {
    player.getPacketSender().sendInterfaceRemoval();
    if (!inventory.contains(armour.id)) return;
    if (inventory.getFreeSlots() < armour.components - 1) {
      player.sendMessage("You require more inventory space to do that.");
      return;
    }
    inventory.delete(armour.id, 1);
    player.performAnimation(Common.animation(FURNACE_ANIM));
    player.getPacketSender().sendSoundEffect(FURNACE_SOUND, 1, 0);
    player.sendMessage("You use the forge to melt the armour down into some components.");
    Common.later(3, () => {
      if (!player.isRegistered()) return;
      for (let i = 0; i < armour.components; i++) inventory.adds(Common.core.ItemIdentifiers.BANDOSIAN_COMPONENTS, 1);
    });
  };
  Common.api.sendMultiChatboxPrompt(player, `Melt down your ${armour.name} into ${armour.components} Bandosian components?`,
    "Yes.", melt,
    "No.", () => player.getPacketSender().sendInterfaceRemoval());
  return true;
}

function smith({ player }) {
  const { ItemIdentifiers, Skill } = Common.core;
  const inventory = player.getInventory();
  const piece = repairs().find((each) => inventory.contains(each.damaged));
  if (!piece) return false;
  const skills = player.getSkillManager();
  const components = inventory.getAmount(ItemIdentifiers.BANDOSIAN_COMPONENTS);
  if (components < piece.components) {
    Common.statement(player, components === 0
      ? `You don't have anything suitable to repair your ${piece.name} with.`
      : `You need ${piece.components} Bandosian component${piece.components === 1 ? "" : "s"} to repair your ${piece.name}.`);
    return true;
  }
  if (skills.getCurrentLevel(Skill.SMITHING) < SMITHING_LEVEL) {
    Common.statement(player, `You need a Smithing level of ${SMITHING_LEVEL} to repair your ${piece.name}.`);
    return true;
  }
  if (!inventory.contains(ItemIdentifiers.HAMMER)) {
    Common.statement(player, `You need a hammer to repair your ${piece.name}.`);
    return true;
  }
  const plural = piece.components === 1 ? "component" : "components";
  Common.api.sendMultiChatboxPrompt(player, `Repair your ${piece.name} with ${piece.components} Bandosian ${plural}?`,
    "Yes.", () => repair(player, piece),
    "No.", () => player.getPacketSender().sendInterfaceRemoval());
  return true;
}

function repair(player, piece) {
  const { ItemIdentifiers, Skill } = Common.core;
  player.getPacketSender().sendInterfaceRemoval();
  player.sendMessage(`You set to work on the ${piece.name}...`);
  player.getMovementQueue().reset();
  const skills = player.getSkillManager();
  const start = player.getLocation().clone();
  const step = (index) => {
    if (!player.isRegistered() || !player.getLocation().equals(start)) return;
    if (index < SMITH_STEPS) {
      player.performAnimation(Common.animation(SMITH_ANIM));
      if (index > 0) {
        for (const [skill, levels] of Object.entries(DRAIN)) {
          skills.setCurrentLevel(Skill[skill], Math.min(skills.getCurrentLevel(Skill[skill]), Math.floor(skills.getMaxLevel(Skill[skill]) * levels[index - 1])), true);
        }
      }
      Common.later(SMITH_STEP_TICKS, () => step(index + 1));
      return;
    }
    const inventory = player.getInventory();
    if (!inventory.contains(piece.damaged) || inventory.getAmount(ItemIdentifiers.BANDOSIAN_COMPONENTS) < piece.components) return;
    inventory.delete(piece.damaged, 1);
    inventory.delete(ItemIdentifiers.BANDOSIAN_COMPONENTS, piece.components);
    inventory.adds(piece.repaired, 1);
    for (const [skill, levels] of Object.entries(DRAIN)) {
      skills.setCurrentLevel(Skill[skill], Math.min(skills.getCurrentLevel(Skill[skill]), Math.floor(skills.getMaxLevel(Skill[skill]) * levels[SMITH_STEPS - 1])), true);
    }
    skills.addExperience(Skill.SMITHING, SMITHING_XP);
    const plural = piece.components === 1 ? "component" : "components";
    Common.core.ItemStatementDialogue.send(player, piece.repaired, `You use ${piece.components} Bandosian ${plural} to repair your ${piece.name}. You feel mentally and physically exhausted.`);
  };
  step(0);
}

function attachForge(api) {
  const { objects } = Common.data;
  api.onObjectFirstClick(objects.forge, useForge);
  api.onObjectFirstClick(objects.anvil, smith);
}

module.exports = { attachForge, useForge, smith, repair };
