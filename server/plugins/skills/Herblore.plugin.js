const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");
const { Item } = require("../../src/main/typescript/elvarg/game/model/Item");
const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { Sound } = require("../../src/main/typescript/elvarg/game/Sound");
const { Sounds } = require("../../src/main/typescript/elvarg/game/Sounds");
const { ItemIds } = require("../../src/main/typescript/elvarg/util/IdEnums");

const HERB_CLEAN_DELAY_MS = 150;
const HERBLORE_ANIM = new Animation(363);

const CLEANABLE_HERBS = new Map([
  [ItemIds.GRIMY_GUAM_LEAF, { clean: ItemIds.GUAM_LEAF, level: 1, xp: 2 }],
  [ItemIds.GRIMY_MARRENTILL, { clean: ItemIds.MARRENTILL, level: 5, xp: 4 }],
  [ItemIds.GRIMY_TARROMIN, { clean: ItemIds.TARROMIN, level: 11, xp: 5 }],
  [ItemIds.GRIMY_HARRALANDER, { clean: ItemIds.HARRALANDER, level: 20, xp: 6 }],
  [ItemIds.GRIMY_RANARR_WEED, { clean: ItemIds.RANARR_WEED, level: 25, xp: 7 }],
  [ItemIds.GRIMY_IRIT_LEAF, { clean: ItemIds.IRIT_LEAF, level: 40, xp: 10 }],
  [ItemIds.GRIMY_AVANTOE, { clean: ItemIds.AVANTOE, level: 48, xp: 12 }],
  [ItemIds.GRIMY_KWUARM, { clean: ItemIds.KWUARM, level: 54, xp: 13 }],
  [ItemIds.GRIMY_CADANTINE, { clean: ItemIds.CADANTINE, level: 65, xp: 14 }],
  [ItemIds.GRIMY_DWARF_WEED, { clean: ItemIds.DWARF_WEED, level: 70, xp: 18 }],
  [ItemIds.GRIMY_TORSTOL, { clean: ItemIds.TORSTOL, level: 75, xp: 21 }],
]);

const UNFINISHED_POTIONS = new Map([
  [ItemIds.GUAM_LEAF, { potion: ItemIds.GUAM_POTION_UNF_, level: 1 }],
  [ItemIds.MARRENTILL, { potion: ItemIds.MARRENTILL_POTION_UNF_, level: 5 }],
  [ItemIds.TARROMIN, { potion: ItemIds.TARROMIN_POTION_UNF_, level: 12 }],
  [ItemIds.HARRALANDER, { potion: ItemIds.HARRALANDER_POTION_UNF_, level: 22 }],
  [ItemIds.RANARR_WEED, { potion: ItemIds.RANARR_POTION_UNF_, level: 30 }],
  [ItemIds.IRIT_LEAF, { potion: ItemIds.IRIT_POTION_UNF_, level: 45 }],
  [ItemIds.AVANTOE, { potion: ItemIds.AVANTOE_POTION_UNF_, level: 50 }],
  [ItemIds.KWUARM, { potion: ItemIds.KWUARM_POTION_UNF_, level: 55 }],
  [ItemIds.CADANTINE, { potion: ItemIds.CADANTINE_POTION_UNF_, level: 66 }],
  [ItemIds.DWARF_WEED, { potion: ItemIds.DWARF_WEED_POTION_UNF_, level: 72 }],
  [ItemIds.TORSTOL, { potion: ItemIds.TORSTOL_POTION_UNF_, level: 78 }],
]);

const FINISHED_POTIONS = new Map([
  [`${ItemIds.GUAM_POTION_UNF_}:${ItemIds.EYE_OF_NEWT}`, { potion: ItemIds.ATTACK_POTION_3_, level: 1, xp: 25 }],
  [`${ItemIds.MARRENTILL_POTION_UNF_}:${ItemIds.UNICORN_HORN_DUST}`, { potion: ItemIds.ANTIPOISON_3_, level: 5, xp: 38 }],
  [`${ItemIds.TARROMIN_POTION_UNF_}:${ItemIds.LIMPWURT_ROOT}`, { potion: ItemIds.STRENGTH_POTION_3_, level: 12, xp: 50 }],
  [`${ItemIds.HARRALANDER_POTION_UNF_}:${ItemIds.RED_SPIDERS_EGGS}`, { potion: ItemIds.RESTORE_POTION_3_, level: 22, xp: 63 }],
  [`${ItemIds.RANARR_POTION_UNF_}:${ItemIds.SNAPE_GRASS}`, { potion: ItemIds.PRAYER_POTION_3_, level: 38, xp: 88 }],
  [`${ItemIds.IRIT_POTION_UNF_}:${ItemIds.EYE_OF_NEWT}`, { potion: ItemIds.SUPER_ATTACK_3_, level: 45, xp: 100 }],
  [`${ItemIds.KWUARM_POTION_UNF_}:${ItemIds.LIMPWURT_ROOT}`, { potion: ItemIds.SUPER_STRENGTH_3_, level: 55, xp: 125 }],
  [`${ItemIds.CADANTINE_POTION_UNF_}:${ItemIds.WHITE_BERRIES}`, { potion: ItemIds.SUPER_DEFENCE_3_, level: 66, xp: 150 }],
  [`${ItemIds.DWARF_WEED_POTION_UNF_}:${ItemIds.WINE_OF_ZAMORAK}`, { potion: ItemIds.RANGING_POTION_3_, level: 72, xp: 163 }],
]);

function finishedPotionKey(a, b) {
  return `${a}:${b}`;
}

module.exports = {
  name: "Herblore",
  members: true,
  register(api) {
    api.onItemFirstAction((event) => {
      const { player, itemId, slot } = event;
      const herb = CLEANABLE_HERBS.get(itemId);
      if (!herb) {
        return false;
      }

      if (!player.getClickDelay().elapsedTime(HERB_CLEAN_DELAY_MS)) {
        return true;
      }

      if (player.getSkillManager().getCurrentLevel(Skill.HERBLORE) < herb.level) {
        player.sendMessage(
          `You need a Herblore level of at least ${herb.level} to clean this leaf.`
        );
        return true;
      }

      player.getInventory().deleteAtSlot(slot, 1);
      player.getInventory().addItem(new Item(herb.clean, 1));
      player.getSkillManager().addExperiences(Skill.HERBLORE, herb.xp);
      player.sendMessage("You clean the dirt off the leaf.");
      player.getClickDelay().reset();
      return true;
    });

    api.onItemOnItem((event) => {
      const { player, usedItemId, usedWithItemId } = event;
      const hasVialWater =
        usedItemId === ItemIds.VIAL_OF_WATER ||
        usedWithItemId === ItemIds.VIAL_OF_WATER;
      if (hasVialWater) {
        const herbId =
          usedItemId === ItemIds.VIAL_OF_WATER ? usedWithItemId : usedItemId;
        const unfinished = UNFINISHED_POTIONS.get(herbId);
        if (!unfinished) {
          return;
        }

        if (
          player.getSkillManager().getCurrentLevel(Skill.HERBLORE) <
          unfinished.level
        ) {
          player.sendMessage(
            `You need a Herblore level of at least ${unfinished.level} to do this.`
          );
          event.handled = true;
          return;
        }

        player.performAnimation(HERBLORE_ANIM);
        Sounds.sendSound(player, Sound.POTION_MIX);
        player.getInventory().deleteNumber(ItemIds.VIAL_OF_WATER, 1);
        player.getInventory().deleteNumber(herbId, 1);
        player.getInventory().addItem(new Item(unfinished.potion, 1));
        player.getSkillManager().addExperiences(Skill.HERBLORE, 10);
        event.handled = true;
        return;
      }

      const key1 = finishedPotionKey(usedItemId, usedWithItemId);
      const key2 = finishedPotionKey(usedWithItemId, usedItemId);
      const finished = FINISHED_POTIONS.get(key1) || FINISHED_POTIONS.get(key2);
      if (!finished) {
        return;
      }

      if (player.getSkillManager().getCurrentLevel(Skill.HERBLORE) < finished.level) {
        player.sendMessage(
          `You need a Herblore level of at least ${finished.level} to do this.`
        );
        event.handled = true;
        return;
      }

      player.performAnimation(HERBLORE_ANIM);
      Sounds.sendSound(player, Sound.POTION_MIX);
      player.getInventory().deleteNumber(usedItemId, 1);
      player.getInventory().deleteNumber(usedWithItemId, 1);
      player.getInventory().addItem(new Item(finished.potion, 1));
      player.getSkillManager().addExperiences(Skill.HERBLORE, finished.xp);
      event.handled = true;
    }, { noted: false });

    api.log("registered", {
      cleanables: CLEANABLE_HERBS.size,
      unfinisheds: UNFINISHED_POTIONS.size,
      finisheds: FINISHED_POTIONS.size,
    });
  },
};
