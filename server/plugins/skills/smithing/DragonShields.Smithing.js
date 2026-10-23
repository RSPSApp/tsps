/**
 * Shields and armour forged from dragon parts.
 *
 * Dragon sq shield (https://oldschool.runescape.wiki/w/Dragon_sq_shield): both halves at an
 * anvil, 60 Smithing, 75 XP. Captured (rsprox rec 1514): a half used on the anvil opens "You set
 * to work trying to fix the ancient shield...", the hammering starts on continue (twice, 3
 * ticks apart), 6 ticks later "Even for an experienced armourer ...", and the shield and XP come
 * when that box is continued.
 *
 * Visage shields (Wiki: Dragonfire shield, Dragonfire ward): an anti-dragon shield and a
 * draconic or skeletal visage at an anvil, 90 Smithing, 2,000 XP, made uncharged. Captured
 * (rsprox rec 579, Leagues): Smith shows the visage with the first message, the hammering
 * starts on continue (again 4 ticks later) and 8 ticks in the shield is shown and given.
 *
 * Dragon forge (Wiki: Dragon kiteshield, Dragon platebody): after Dragon Slayer II, a dragon sq
 * shield, slice and shard make the kiteshield (75 Smithing, 1,000 XP); a dragon chainbody, lump
 * and shard the platebody (90, 2,000).
 *
 * Ancient wyvern shield (Wiki): a wyvern visage and elemental shield on Fossil Island's shield
 * machine, 66 Smithing and Magic, 2,000 XP in each, draining Magic to 0.
 */
const Core = require("./Core.Smithing");
const Data = require("./Data.Smithing");
const Sessions = require("./Sessions.Smithing");
const { messageBox, itemBox, hasHammer, smithingLevel, obj, hammering } = require("./Common.Smithing");

const DRAGON_FORGE = "ds2_ac_forge_anvil";
const SHIELD_MACHINE = "fossil_lab_shield_maker";

const SQ_SHIELD = {
  level: 60,
  xp: 75,
  start: "You set to work trying to fix the ancient shield. It's seen some heavy action and needs some serious work doing to it.",
  done: "Even for an experienced armourer it is not an easy task, but eventually it is ready. You have restored the dragon square shield to its former glory.",
  noHammer: "You'll need a hammer if you want to attempt to repair this shield.",
  otherHalf: "You need to find the other half of this shield in order to repair it.",
  byHand: "You'll need to repair the shield at an anvil, with a hammer.",
};

/** Visage shields; the ward's messages follow the dragonfire shield's (not captured). */
function visageShields() {
  const shield = (visage, result, visageName, resultName) => ({
    visage: obj(visage),
    result: obj(result),
    level: 90,
    xp: 2000,
    start: `You set to work, trying to attach the ancient ${visageName} to your anti-dragonbreath shield. It's not easy to work with the ancient artefact and it takes all of your skill as a master smith.`,
    done: `Even for an expert armourer it is not an easy task, but eventually it is ready. You have crafted the ${visageName} and anti-dragonbreath shield into a ${resultName}.`,
    noHammer: `You'll need a hammer if you wish to construct a ${resultName}.`,
    lowLevel: `You need a Smithing level of at least 90 to construct a ${resultName}.`,
  });
  return [
    shield("dragonfire_visage", "dragonfire_shield_uncharged", "draconic visage", "dragonfire shield"),
    shield("skeletal_visage", "dragonfire_ward_uncharged", "skeletal visage", "dragonfire ward"),
  ];
}

function forgeRecipes() {
  return [
    { result: obj("dragon_kiteshield"), parts: [obj("dragon_sq_shield"), Core.ItemIdentifiers.DRAGON_METAL_SLICE, Core.ItemIdentifiers.DRAGON_METAL_SHARD], level: 75, xp: 1000, ticks: 2,
      missing: "You need a dragon metal shard, a dragon metal slice and a dragon sq shield." },
    { result: obj("dragon_platebody"), parts: [obj("dragon_chainbody"), Core.ItemIdentifiers.DRAGON_METAL_LUMP, Core.ItemIdentifiers.DRAGON_METAL_SHARD], level: 90, xp: 2000, ticks: 2,
      missing: "You need a dragon metal shard, a dragon metal lump and a dragon chainbody." },
  ];
}

const animate = (player) => player.performAnimation(hammering());
const carries = (player, ids) => ids.every((id) => player.getInventory().contains(id));

function give(player, used, result, xp) {
  if (!carries(player, used)) return false;
  const inventory = player.getInventory();
  for (const id of used) inventory.deleteNumber(id, 1);
  inventory.addItem(new Core.Item(result, 1));
  player.getSkillManager().addExperiences(Core.Skill.SMITHING, xp);
  Core.api.emitCustomEvent("smithing:success", { player, skill: Core.Skill.SMITHING, itemId: result });
  return true;
}

// --- Dragon sq shield.

function repairSqShield(player) {
  const halves = [obj("dragonshield_a"), obj("dragonshield_b")];
  if (!carries(player, halves)) return messageBox(player, SQ_SHIELD.otherHalf);
  if (!hasHammer(player)) return messageBox(player, SQ_SHIELD.noHammer);
  if (smithingLevel(player) < SQ_SHIELD.level) {
    return messageBox(player, `You need a Smithing level of ${SQ_SHIELD.level} to repair this shield.`);
  }
  messageBox(player, SQ_SHIELD.start, () => Sessions.timeline(player, "dragon-sq-shield", [
    { at: 0, run: () => animate(player) },
    { at: 3, run: () => animate(player) },
    { at: 6, run: () => messageBox(player, SQ_SHIELD.done, () => give(player, halves, obj("dragon_sq_shield"), SQ_SHIELD.xp)) },
  ]));
}

// --- Visage shields.

function visageShieldFor(player) {
  return visageShields().find((shield) => carries(player, [shield.visage, Core.ItemIdentifiers.ANTI_DRAGON_SHIELD])) ?? null;
}

function attachVisage(player, shield) {
  if (!hasHammer(player)) return messageBox(player, shield.noHammer);
  if (smithingLevel(player) < shield.level) return messageBox(player, shield.lowLevel);
  const used = [shield.visage, Core.ItemIdentifiers.ANTI_DRAGON_SHIELD];
  itemBox(player, shield.visage, shield.start, () => Sessions.timeline(player, "visage-shield", [
    { at: 0, run: () => animate(player) },
    { at: 4, run: () => animate(player) },
    { at: 8, run: () => give(player, used, shield.result, shield.xp) && itemBox(player, shield.result, shield.done) },
  ]));
}

// --- Dragon forge.

function forgeAtDragonForge(event) {
  const { player, itemId } = event;
  const recipe = forgeRecipes().find((candidate) => candidate.parts.includes(itemId));
  if (!recipe) return false;
  event.handled = true;
  if (!Core.questComplete(player, "dragon_slayer_ii")) {
    player.sendMessage(`You need to complete ${Data.questName("dragon_slayer_ii")} to use the dragon forge.`);
    return true;
  }
  const problem = !carries(player, recipe.parts) ? recipe.missing
    : !hasHammer(player) ? "You need a hammer to work the dragon metal."
    : smithingLevel(player) < recipe.level ? `You need a Smithing level of ${recipe.level} to make that.`
    : null;
  if (problem) {
    messageBox(player, problem);
    return true;
  }
  animate(player);
  Sessions.timeline(player, "dragon-forge", [{ at: recipe.ticks, run: () => give(player, recipe.parts, recipe.result, recipe.xp) }]);
  return true;
}

// --- Ancient wyvern shield.

function useOnShieldMachine(event) {
  const { player, itemId } = event;
  const visage = obj("wyvern_visage");
  const shield = Core.ItemIdentifiers.ELEMENTAL_SHIELD;
  if (itemId !== visage && itemId !== shield) return;
  event.handled = true;
  const skills = player.getSkillManager();
  if (!carries(player, [visage, shield])) return messageBox(player, "You need a wyvern visage and an elemental shield to use this machine.");
  if (!hasHammer(player)) return messageBox(player, "You need a hammer to use this machine.");
  if (smithingLevel(player) < 66 || skills.getCurrentLevel(Core.Skill.MAGIC) < 66) {
    return messageBox(player, "You need level 66 Smithing and Magic to make an ancient wyvern shield.");
  }
  animate(player);
  Sessions.timeline(player, "wyvern-shield", [{ at: 3, run: () => {
    if (!give(player, [visage, shield], obj("wyvern_shield_uncharged"), 2000)) return false;
    skills.addExperiences(Core.Skill.MAGIC, 2000);
    skills.setCurrentLevel(Core.Skill.MAGIC, 0, true);
    player.sendMessage("At a great cost to your personal magical energies, you have crafted the wyvern visage and elemental shield into an ancient wyvern shield.");
  } }]);
}

// --- Entry points from the anvil.

/** Smith on an anvil: a visage and anti-dragon shield take it before the interface. */
function smithAtAnvil(player) {
  const shield = visageShieldFor(player);
  if (!shield) return false;
  attachVisage(player, shield);
  return true;
}

function useOnAnvil(event) {
  const { player, itemId } = event;
  if (event.objectId === Core.CacheDefinitions.getLocId(DRAGON_FORGE) && forgeAtDragonForge(event)) return true;
  if (itemId === obj("dragonshield_a") || itemId === obj("dragonshield_b")) {
    event.handled = true;
    repairSqShield(player);
    return true;
  }
  const shield = visageShields().find((candidate) => candidate.visage === itemId)
    ?? (itemId === Core.ItemIdentifiers.ANTI_DRAGON_SHIELD ? visageShieldFor(player) : null);
  if (!shield) return false;
  event.handled = true;
  if (!carries(player, [shield.visage, Core.ItemIdentifiers.ANTI_DRAGON_SHIELD])) {
    messageBox(player, `You need an anti-dragon shield and a ${Core.ItemDefinition.forId(shield.visage).getName().toLowerCase()} to do that.`);
    return true;
  }
  attachVisage(player, shield);
  return true;
}

function halvesByHand(event) {
  const halves = [obj("dragonshield_a"), obj("dragonshield_b")];
  if (halves.includes(event.usedItemId) && halves.includes(event.usedWithItemId)) {
    event.handled = true;
    event.player.sendMessage(SQ_SHIELD.byHand);
  }
}

module.exports = function attach(api) {
  api.onItemOnItem(halvesByHand, { noted: false });
};

Object.assign(module.exports, { smithAtAnvil, useOnAnvil, useOnShieldMachine, SHIELD_MACHINE });
