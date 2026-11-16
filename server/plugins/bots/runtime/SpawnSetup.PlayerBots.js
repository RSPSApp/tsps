"use strict";

function validateSpawnSetup(setup, core) {
  if (!setup) return null;
  const skillNames = new Set(core.Skill.values().map(skill => skill.getName().toLowerCase()));
  const skills = setup.skills;
  if (!skills || typeof skills !== "object" || Array.isArray(skills) ||
      Object.entries(skills).some(([name, level]) => !skillNames.has(name) || !Number.isInteger(level) || level < 1 || level > 99)) {
    return "invalid starting skill levels";
  }
  const validItems = (items, slots) => Array.isArray(items) && items.length <= slots.length &&
    items.every(item => item && Number.isInteger(item.slot) && slots.includes(item.slot) && Number.isInteger(item.id) && item.id > 0 &&
      Number.isInteger(item.amount) && item.amount > 0 && item.amount <= 2147483647) &&
    new Set(items.map(item => item.slot)).size === items.length;
  if (!validItems(setup.inventory, Array.from({ length: 28 }, (_, index) => index)) ||
      !validItems(setup.equipment, [0, 1, 2, 3, 4, 5, 7, 9, 10, 12, 13])) {
    return "invalid starting items or duplicate container slots";
  }
  const items = [...setup.inventory, ...setup.equipment];
  const invalidItem = items.find(item => !core.CacheDefinitions.getItem(item.id));
  if (invalidItem) return `unknown item: ${invalidItem.id}`;
  const badSlot = setup.equipment.find(item => core.CacheDefinitions.getItem(item.id)?.wearPos !== item.slot);
  if (badSlot) return `wrong equipment slot for item ${badSlot.id}`;
  const badAmount = items.find(item => item.amount > 1 && !new core.Item(item.id).getDefinition().isStackable());
  if (badAmount) return `item ${badAmount.id} is not stackable`;
  return null;
}

function applySpawnSetup(bot, setup, core) {
  if (!setup) return;
  const skills = bot.getSkillManager();
  for (const [name, level] of Object.entries(setup.skills ?? {})) {
    const skill = core.Skill[name.toUpperCase()];
    skills.setMaxLevels(skill, level, false)
      .setCurrentLevel(skill, level, false)
      .setExperiences(skill, core.SkillManager.getExperienceForLevel(level), false);
  }
  for (const item of setup.inventory ?? []) bot.getInventory().setItem(item.slot, new core.Item(item.id, item.amount));
  for (const item of setup.equipment ?? []) bot.getEquipment().setItem(item.slot, new core.Item(item.id, item.amount));
  core.BonusManager.update(bot);
  core.WeaponInterfaceManager.assign(bot);
  bot.getUpdateFlag().flag(core.Flag.APPEARANCE);
}

module.exports = { validateSpawnSetup, applySpawnSetup };
