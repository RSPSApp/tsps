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
 * turns it back into its parts. A scroll of imbuing on a black mask or helmet
 * makes its (i) form instead; a charged mask keeps its charges.
 *
 * Assembling needs the Malevolent masquerade unlock (varbit slayer_helm_unlocked, bought
 * in the Slayer Rewards interface). Reinforced goggles are not required.
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
// ponytail: scroll of imbuing only; NMZ points and Soul Wars zeal shops aren't modelled.
// Add their purchases here when those reward shops land.
/** Scroll of imbuing ids, filled at register. */
let IMBUE_SCROLLS = new Set();
/** Black mask / Slayer helmet id -> its imbued id, filled at register. */
let IMBUED_ITEMS = new Map();

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

function isImbueScroll(itemId) {
  return IMBUE_SCROLLS.has(Number(itemId));
}

function findMask(inventory) {
  return inventory.getItems().find((item) => item && maskId(item.getId()) != null) ?? null;
}

/** Scroll of imbuing on a black mask or Slayer helmet (Wiki: "Imbuing first"). */
function imbue(event) {
  if (event.handled) return;
  const { player, usedItem, usedWithItem, usedItemId, usedWithItemId } = event;
  const scrollOnUsed = isImbueScroll(usedItemId);
  const scrollOnWith = isImbueScroll(usedWithItemId);
  if (scrollOnUsed === scrollOnWith) return;
  const targetId = Number(scrollOnUsed ? usedWithItemId : usedItemId);
  const result = IMBUED_ITEMS.get(targetId);
  if (result == null) return;
  event.handled = true;
  const targetItem = scrollOnUsed ? usedWithItem : usedItem;
  player.getInventory().deleteNumber(scrollOnUsed ? Number(usedItemId) : Number(usedWithItemId), 1);
  targetItem.setId(result);
  player.getInventory().refreshItems();
  pluginApi.emitCustomEvent("equipment:changed", { player });
  player.sendMessage(
    targetId === ItemIdentifiers.SLAYER_HELMET
      ? "You imbue the Slayer helmet with the scroll."
      : "You imbue the black mask with the scroll."
  );
}

/** Ours: the Wiki gives no message for assembling without the unlock. */
const HELM_LOCKED = "You need to unlock the Malevolent masquerade from a Slayer master to make a Slayer helmet.";

function helmUnlocked(player) {
  const id = pluginApi.core.CacheDefinitions.getVarbitId("slayer_helm_unlocked");
  return id != null && player.getPacketSender().getVarbit(id) === 1;
}

function assemble(event) {
  if (event.handled) return;
  const { player, usedItemId, usedWithItemId } = event;
  const scrollOnUsed = isImbueScroll(usedItemId);
  const scrollOnWith = isImbueScroll(usedWithItemId);
  const usingScroll = scrollOnUsed || scrollOnWith;
  const otherId = Number(scrollOnUsed ? usedWithItemId : usedItemId);
  if (usingScroll) {
    if (!isPart(otherId)) return;
  } else if (!isPart(usedItemId) || !isPart(usedWithItemId) || usedItemId === usedWithItemId) {
    return;
  }
  const inventory = player.getInventory();
  const mask = findMask(inventory);
  if (!mask || PARTS.some((part) => !inventory.contains(part))) return;
  event.handled = true;
  if (!helmUnlocked(player)) {
    player.sendMessage(HELM_LOCKED);
    return;
  }
  if (player.getSkillManager().getCurrentLevel(Skill.CRAFTING) < CRAFTING_LEVEL) {
    player.sendMessage(`You need a Crafting level of ${CRAFTING_LEVEL} to make a Slayer helmet.`);
    return;
  }
  const imbued = usingScroll || maskId(mask.getId()) === "imbued";
  inventory.deleteNumber(mask.getId(), 1);
  for (const part of PARTS) inventory.deleteNumber(part, 1);
  if (usingScroll) inventory.deleteNumber(scrollOnUsed ? Number(usedItemId) : Number(usedWithItemId), 1);
  inventory.adds(imbued ? ItemIdentifiers.SLAYER_HELMET_I_ : ItemIdentifiers.SLAYER_HELMET, 1);
  inventory.refreshItems();
  pluginApi.emitCustomEvent("equipment:changed", { player });
  player.sendMessage("You combine the items into a Slayer helmet.");
}

/** Check (inventory or worn): the task, as the enchanted gem inside it shows (Slayer.plugin.js). */
function check({ player }) {
  pluginApi.emitCustomEvent("slayer:check", { player, handled: false });
  return true;
}

function notBuilt() {
  return true;
}

function disassemble(event) {
  const { player, item } = event;
  const inventory = player.getInventory();
  if (inventory.getFreeSlots() < PARTS.length) {
    player.sendMessage("You don't have enough inventory space to disassemble the helmet.");
    return true;
  }
  const imbued = itemName(item.getId()).includes("(i)");
  inventory.deleteNumber(item.getId(), 1);
  inventory.adds(imbued ? ItemIdentifiers.BLACK_MASK_I_ : ItemIdentifiers.BLACK_MASK, 1);
  for (const part of PARTS) inventory.adds(part, 1);
  inventory.refreshItems();
  pluginApi.emitCustomEvent("equipment:changed", { player });
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
    IMBUE_SCROLLS = new Set([ItemIdentifiers.SCROLL_OF_IMBUING, ItemIdentifiers.SCROLL_OF_IMBUING_2]);
    IMBUED_ITEMS = new Map([
      [ItemIdentifiers.BLACK_MASK_10_, ItemIdentifiers.BLACK_MASK_10_I_],
      [ItemIdentifiers.BLACK_MASK_9_, ItemIdentifiers.BLACK_MASK_9_I_],
      [ItemIdentifiers.BLACK_MASK_8_, ItemIdentifiers.BLACK_MASK_8_I_],
      [ItemIdentifiers.BLACK_MASK_7_, ItemIdentifiers.BLACK_MASK_7_I_],
      [ItemIdentifiers.BLACK_MASK_6_, ItemIdentifiers.BLACK_MASK_6_I_],
      [ItemIdentifiers.BLACK_MASK_5_, ItemIdentifiers.BLACK_MASK_5_I_],
      [ItemIdentifiers.BLACK_MASK_4_, ItemIdentifiers.BLACK_MASK_4_I_],
      [ItemIdentifiers.BLACK_MASK_3_, ItemIdentifiers.BLACK_MASK_3_I_],
      [ItemIdentifiers.BLACK_MASK_2_, ItemIdentifiers.BLACK_MASK_2_I_],
      [ItemIdentifiers.BLACK_MASK_1_, ItemIdentifiers.BLACK_MASK_1_I_],
      [ItemIdentifiers.BLACK_MASK, ItemIdentifiers.BLACK_MASK_I_],
      [ItemIdentifiers.SLAYER_HELMET, ItemIdentifiers.SLAYER_HELMET_I_],
    ]);
    api.registerMeleeAttackAccuracyModifier(meleeBoost);
    api.registerMeleeHitModifier(meleeBoost);
    api.registerRangedAttackAccuracyModifier(rangedAccuracyBoost);
    api.registerRangedHitModifier(rangedDamageBoost);
    api.registerMagicAttackAccuracyModifier(magicBoost);
    api.registerMagicHitModifier(magicBoost);
    api.onCustomEvent("slayer:imbued-active", imbuedActive);
    api.onItemOnItem(imbue, { noted: false });
    api.onItemOnItem(assemble, { noted: false });
    // Worn Partner and Log aren't built; handling them keeps an unhandled worn click from
    // taking the helmet off.
    const actions = { Disassemble: disassemble, Check: check, Partner: notBuilt, Log: notBuilt };
    api.onItemAction("Slayer helmet", actions);
    api.onItemAction("Slayer helmet (i)", actions);
  },
  _test: { slayerHeadwear, meleeBoost, rangedAccuracyBoost, rangedDamageBoost, magicBoost, imbue, assemble },
};
