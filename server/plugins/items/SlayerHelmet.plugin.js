/**
 * Black mask and Slayer helmet (https://oldschool.runescape.wiki/w/Slayer_helmet).
 *
 * On a Slayer task the black mask and slayer helmet boost melee accuracy and damage
 * by 7/6; their imbued forms also boost Ranged and Magic accuracy and damage by 15%.
 * A salve amulet that boosts the same style wins over them ("salve:applies"), and
 * the dragon hunter crossbow's damage adds to the imbued ranged bonus instead of
 * multiplying it ("slayer:imbued-ranged-bonus").
 * The helmet is assembled at 55 Crafting by using any component on another with
 * them all in the inventory (a charged mask loses its charges), and Disassemble
 * turns it back into its parts.
 *
 * ponytail: the Malevolent masquerade unlock (400 Slayer points) is not checked
 * because the Slayer rewards have no unlock store yet; Reinforced goggles are not
 * required because A Porcine of Interest is not implemented.
 */
const CRAFTING_LEVEL = 55;
const MELEE_NUMERATOR = 7;
const MELEE_DENOMINATOR = 6;
const IMBUED_NUMERATOR = 23;
const IMBUED_DENOMINATOR = 20;

let pluginApi;
let ItemIdentifiers;
let Skill;
/** Components besides the mask, filled at register. */
let PARTS = [];

function headName(player) {
  const head = player.getEquipment?.()?.getItems?.()?.[pluginApi.core.Equipment.HEAD_SLOT];
  return head && head.getId() > 0 ? itemName(head.getId()) : "";
}

function itemName(itemId) {
  return String(pluginApi.core.ItemDefinition.forId(itemId)?.getName?.() ?? "").toLowerCase();
}

/** "melee" for a mask/helmet, "all" for an imbued one, null otherwise. */
function slayerHeadwear(player) {
  const name = headName(player);
  if (!name.includes("slayer helmet") && !name.includes("black mask")) return null;
  return name.includes("(i)") ? "all" : "melee";
}

function onTask(player) {
  const target = player.getCombat?.()?.getTarget?.();
  if (!target?.isNpc?.()) return false;
  const request = { player, npc: target.getAsNpc(), onTask: false };
  pluginApi.emitCustomEvent("slayer:on-task", request);
  return request.onTask === true;
}

function salveApplies(player, style) {
  const query = { player, style, applies: false };
  pluginApi.emitCustomEvent("salve:applies", query);
  return query.applies === true;
}

/** Whether the headwear boosts `style` against the player's current target. */
function boostActive(player, style) {
  const headwear = slayerHeadwear(player);
  if (!headwear || (style !== "melee" && headwear !== "all")) return false;
  return onTask(player) && !salveApplies(player, style);
}

function boost(style) {
  return (entity, value) => {
    if (!entity?.isPlayer?.() || !boostActive(entity.getAsPlayer(), style)) return value;
    return style === "melee"
      ? Math.floor((value * MELEE_NUMERATOR) / MELEE_DENOMINATOR)
      : Math.floor((value * IMBUED_NUMERATOR) / IMBUED_DENOMINATOR);
  };
}

const meleeBoost = boost("melee");
const rangedAccuracyBoost = boost("ranged");
const magicBoost = boost("magic");

/** Ranged damage: 23/20, plus what other gear adds to it (the dragon hunter crossbow's 5). */
function rangedDamageBoost(entity, value) {
  if (!entity?.isPlayer?.() || !boostActive(entity.getAsPlayer(), "ranged")) return value;
  const bonus = { player: entity.getAsPlayer(), numerator: IMBUED_NUMERATOR };
  pluginApi.emitCustomEvent("slayer:imbued-ranged-bonus", bonus);
  return Math.floor((value * bonus.numerator) / IMBUED_DENOMINATOR);
}

/** "slayer:imbued-active": { player, style } -> active = true when the imbued boost applies. */
function imbuedActive(query) {
  if (query?.player && slayerHeadwear(query.player) === "all" && boostActive(query.player, query.style)) {
    query.active = true;
  }
}

/** "plain" / "imbued" for any black mask, charged or not; null for anything else. */
function maskId(itemId) {
  const name = itemName(itemId);
  return name.startsWith("black mask") ? (name.includes("(i)") ? "imbued" : "plain") : null;
}

function isPart(itemId) {
  return maskId(itemId) != null || PARTS.includes(itemId);
}

function findMask(inventory) {
  return inventory.getItems().find((item) => item && maskId(item.getId()) != null) ?? null;
}

function assemble(event) {
  const { player, usedItemId, usedWithItemId } = event;
  if (!isPart(usedItemId) || !isPart(usedWithItemId) || usedItemId === usedWithItemId) return;
  const inventory = player.getInventory();
  const mask = findMask(inventory);
  if (!mask || PARTS.some((part) => !inventory.contains(part))) return;
  event.handled = true;
  if (player.getSkillManager().getCurrentLevel(Skill.CRAFTING) < CRAFTING_LEVEL) {
    player.sendMessage(`You need a Crafting level of ${CRAFTING_LEVEL} to make a Slayer helmet.`);
    return;
  }
  const imbued = maskId(mask.getId()) === "imbued";
  inventory.deleteNumber(mask.getId(), 1);
  for (const part of PARTS) inventory.deleteNumber(part, 1);
  inventory.adds(imbued ? ItemIdentifiers.SLAYER_HELMET_I_ : ItemIdentifiers.SLAYER_HELMET, 1);
  player.sendMessage("You combine the items into a Slayer helmet.");
}

function disassemble(event) {
  const { player, item } = event;
  const inventory = player.getInventory();
  if (inventory.getFreeSlots() < PARTS.length) {
    player.sendMessage("You don't have enough inventory space to disassemble the helmet.");
    return true;
  }
  const imbued = item.getId() === ItemIdentifiers.SLAYER_HELMET_I_;
  inventory.deleteNumber(item.getId(), 1);
  inventory.adds(imbued ? ItemIdentifiers.BLACK_MASK_I_ : ItemIdentifiers.BLACK_MASK, 1);
  for (const part of PARTS) inventory.adds(part, 1);
  player.sendMessage("You disassemble the Slayer helmet.");
  return true;
}

module.exports = {
  name: "SlayerHelmet",
  members: true,
  register(api) {
    pluginApi = api;
    ({ ItemIdentifiers, Skill } = api.core);
    PARTS = [
      ItemIdentifiers.EARMUFFS,
      ItemIdentifiers.FACEMASK,
      ItemIdentifiers.NOSE_PEG,
      ItemIdentifiers.SPINY_HELMET,
      ItemIdentifiers.ENCHANTED_GEM,
    ];
    api.registerMeleeAttackAccuracyModifier(meleeBoost);
    api.registerMeleeHitModifier(meleeBoost);
    api.registerRangedAttackAccuracyModifier(rangedAccuracyBoost);
    api.registerRangedHitModifier(rangedDamageBoost);
    api.registerMagicAttackAccuracyModifier(magicBoost);
    api.registerMagicHitModifier(magicBoost);
    api.onCustomEvent("slayer:imbued-active", imbuedActive);
    api.onItemOnItem(assemble, { noted: false });
    api.onItemAction("Slayer helmet", { Disassemble: disassemble });
    api.onItemAction("Slayer helmet (i)", { Disassemble: disassemble });
  },
  _test: { slayerHeadwear, meleeBoost, rangedAccuracyBoost, rangedDamageBoost, magicBoost },
};
