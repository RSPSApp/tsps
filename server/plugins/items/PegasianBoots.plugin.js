const { Item } = require("../../src/main/typescript/elvarg/game/model/Item");
const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");
const { ItemIdentifiers } = require("../../src/main/typescript/elvarg/util/ItemIdentifiers");

const MAGIC_LEVEL = 60;
const RUNECRAFTING_LEVEL = 60;
const EXPERIENCE = 200;

function combine(player) {
  const skills = player.getSkillManager();
  if (
    skills.getMaxLevel(Skill.MAGIC) < MAGIC_LEVEL ||
    skills.getMaxLevel(Skill.RUNECRAFTING) < RUNECRAFTING_LEVEL
  ) {
    player.sendMessage("You need level 60 Magic and Runecrafting to do this.");
    return false;
  }

  const inventory = player.getInventory();
  if (
    inventory.getAmount(ItemIdentifiers.PEGASIAN_CRYSTAL) < 1 ||
    inventory.getAmount(ItemIdentifiers.RANGER_BOOTS) < 1
  ) {
    return false;
  }

  inventory.deleteNumber(ItemIdentifiers.PEGASIAN_CRYSTAL, 1);
  inventory.deleteNumber(ItemIdentifiers.RANGER_BOOTS, 1);
  inventory.addItem(new Item(ItemIdentifiers.PEGASIAN_BOOTS, 1));
  skills.addExperiences(Skill.MAGIC, EXPERIENCE);
  skills.addExperiences(Skill.RUNECRAFTING, EXPERIENCE);
  player.sendMessage("You combine the pegasian crystal with the ranger boots.");
  return true;
}

function handleCombine({ player }) {
  combine(player);
}

module.exports = {
  name: "PegasianBoots",
  members: true,
  register(api) {
    api.onItemOnItem("Pegasian crystal", "Ranger boots", handleCombine, { noted: false });
  },
  _test: { combine },
};
