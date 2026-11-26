"use strict";

const { validateSpawnSetup } = require("../runtime/SpawnSetup.PlayerBots");

function currentLocation(player) {
  const location = player.getLocation?.();
  if (!location) return null;
  const x = typeof location.getX === "function" ? location.getX() : location.x;
  const y = typeof location.getY === "function" ? location.getY() : location.y;
  const z = typeof location.getZ === "function" ? location.getZ() : location.z;
  return [x, y, z].every(Number.isInteger) ? { x, y, z } : null;
}

function ownerSkillOverrides(player, core) {
  const manager = player?.getSkillManager?.();
  const levels = {};
  for (const skill of core?.Skill?.values?.() ?? []) {
    const name = String(skill.getName?.() ?? "").toLowerCase().replace(/[ -]+/g, "_");
    const level = manager?.getMaxLevel?.(skill) ?? manager?.getCurrentLevel?.(skill);
    if (name && Number.isInteger(level) && level >= 1 && level <= 99) levels[name] = level;
  }
  return Object.keys(levels).length ? levels : null;
}

const prompts = {
  location: "Enter x y plane, here, or default",
  skills: "Enter skill level (e.g. attack 40), copy, or default",
  inventory: "Enter slot(0-27) itemID amount, remove slot, clear, or default",
  equipment: "Enter slot itemID amount, remove slot, clear, or default",
};
const replacementFlag = { inventory: "replaceInventory", equipment: "replaceEquipment" };

function parseSetupOverride(field, text, activity, previous, player, core) {
  const input = String(text ?? "").trim().toLowerCase();
  const overrides = { ...previous };
  if (input === "default") {
    delete overrides[field];
    if (replacementFlag[field]) delete overrides[replacementFlag[field]];
    return overrides;
  }
  const parts = input.split(/\s+/);
  if (field === "location") {
    const [x, y, z] = parts.map(Number);
    const location = input === "here" ? currentLocation(player) : parts.length === 3 ? { x, y, z } : null;
    if (!location || ![location.x, location.y, location.z].every((value, index) => Number.isInteger(value) && value >= 0 && value <= (index === 2 ? 3 : 16383))) {
      throw new Error("Enter valid x y plane coordinates, here, or default.");
    }
    return { ...overrides, location };
  }
  if (field === "skills") {
    if (input === "copy") {
      overrides.skills = ownerSkillOverrides(player, core);
      if (!overrides.skills) throw new Error("Your base skill levels are unavailable.");
    } else {
      const [name, level] = parts;
      if (parts.length !== 2 || !/^[a-z]+$/.test(name) || !/^\d{1,2}$/.test(level)) throw new Error("Enter skill level, copy, or default.");
      overrides.skills = { ...previous.skills, [name]: Number(level) };
    }
  } else if (Object.hasOwn(replacementFlag, field)) {
    const items = previous[field] ?? activity.setup[field] ?? [];
    const match = /^(\d{1,2}) (\d{1,10})(?: (\d{1,10}))?$/.exec(parts.join(" "));
    const remove = /^remove (\d{1,2})$/.exec(parts.join(" "));
    if (input === "clear") overrides[field] = [];
    else if (remove) overrides[field] = items.filter(item => item.slot !== Number(remove[1]));
    else if (match) {
      const slot = Number(match[1]);
      overrides[field] = [...items.filter(item => item.slot !== slot), { slot, id: Number(match[2]), amount: Number(match[3] ?? 1) }];
    } else throw new Error("Enter slot itemID amount, remove slot, clear, or default.");
    overrides[replacementFlag[field]] = true;
  } else throw new Error("That override is not supported.");
  const error = validateSpawnSetup({ skills: overrides.skills ?? {}, inventory: overrides.inventory ?? [], equipment: overrides.equipment ?? [] }, core);
  if (error) throw new Error(error);
  return overrides;
}

function overrideValue(field, overrides) {
  if (!Object.hasOwn(overrides, field)) return "Default";
  const value = overrides[field];
  if (field === "location") return `${value.x}, ${value.y}, plane ${value.z}`;
  if (field === "skills") return `${Object.keys(value).length} levels`;
  return `${value.length} slots`;
}

module.exports = { currentLocation, ownerSkillOverrides, prompts, parseSetupOverride, overrideValue };
