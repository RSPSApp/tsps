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
 * Content may give a player the (i) or plain helmet's effects without one ("slayer:helmet").
 *
 * Assembling needs the Malevolent masquerade unlock (varbit slayer_helm_unlocked, bought
 * in the Slayer Rewards interface). Reinforced goggles are not required.
 *
 * Recolours: using a recolour's head on a plain or imbued helmet asks "Combine the <head> with
 * your helm?" and, on Yes, makes that colour of the same helmet. Each needs its Slayer reward
 * unlock; without it the player is told to learn it from a Slayer master. A recoloured helmet
 * takes no second head. Disassemble gives back the mask, the components and the head. The
 * Soul Wars and Emir's Arena imbued helmets keep their own copy of each colour and of the
 * imbued black mask. The Tztok, Vampyric and Tzkal colours come from Ghommal and Laidee
 * Gnonock and give back no head; the Radiant colour is made from the Oathplate one.
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

const COMBINE_SOUND = 2241;
const LEARN_FIRST = "You must first learn how to do this from a Slayer Master.";
const HELM_LOCKED = "You have not unlocked the ability to combine these items.";

/** Each form's helmet and black mask gamevals: plain, then the NMZ, Soul Wars and Emir's Arena imbued copies. */
const FORMS = [
  { helm: "slayer_helm", mask: null },
  { helm: "slayer_helm_i", mask: "nzone_black_mask" },
  { helm: "sw_slayer_helm_i", mask: "sw_black_mask" },
  { helm: "pvpa_slayer_helm_i", mask: "pvpa_black_mask" },
];

const suffixed = (colour) => (helm) => `${helm}_${colour}`;
const league6 = (n) => (helm) => helm.replace("slayer_helm", `league_6_slayer_helm${n}`);

/**
 * Every recolour: its item name prefix, its helmet gameval per form, and the head and unlock
 * that make it (none for the colours an NPC gives, or Radiant, which is made from Oathplate).
 */
const RECOLOURS = [
  { name: "Black", item: suffixed("black"), head: "poh_trophydrop_kbd", unlock: "slayer_unlock_helm_black" },
  { name: "Green", item: suffixed("green"), head: "poh_trophydrop_kalphitequeen", unlock: "slayer_unlock_helm_green" },
  { name: "Red", item: suffixed("red"), head: "poh_trophydrop_abyssaldemon", unlock: "slayer_unlock_helm_red" },
  { name: "Purple", item: suffixed("purple"), head: "cata_boss_claw", unlock: "slayer_unlock_helm_purple" },
  { name: "Turquoise", item: suffixed("turquoise"), head: "vorkath_head", unlock: "slayer_unlock_helm_turquoise" },
  { name: "Hydra", item: suffixed("hydra"), head: "poh_alchemical_hydra_head", unlock: "slayer_unlock_helm_hydra" },
  { name: "Twisted", item: suffixed("twisted"), head: "twisted_horns", unlock: "slayer_unlock_helm_twisted" },
  { name: "Araxyte", item: suffixed("araxyte"), head: "poh_araxyte_head", unlock: "slayer_unlock_helm_araxyte" },
  { name: "Hooded", item: suffixed("hooded"), head: "skillcape_slayer_hood", unlock: "slayer_unlock_helm_hooded" },
  { name: "Oathplate", item: league6(1), head: "league_6_demonic_quill", unlock: "slayer_unlock_helm_league_6" },
  { name: "Tztok", item: suffixed("jad") },
  { name: "Vampyric", item: suffixed("verzik") },
  { name: "Tzkal", item: suffixed("zuk") },
  // Ours: what taking a Radiant helmet apart gives back isn't known, so it has no Disassemble.
  { name: "Radiant", item: league6(2), disassemble: false },
];

/** Every helmet's item name, for its options. */
const HELMET_NAMES = [
  "Slayer helmet",
  "Slayer helmet (i)",
  ...RECOLOURS.flatMap(({ name }) => [`${name} slayer helmet`, `${name} slayer helmet (i)`]),
];

/** Helmet id -> { form, recolour (null for the plain colour), mask, base }, and head id -> recolour; built on first use. */
let helmets = null;

function objId(name) {
  return pluginApi.core.CacheDefinitions.getObjId?.(name) ?? null;
}

function helmetTable() {
  if (helmets?.api === pluginApi) return helmets;
  const byId = new Map();
  const heads = new Map();
  const recolours = RECOLOURS.map((recolour) => ({ ...recolour, headId: recolour.head ? objId(recolour.head) : null }));
  for (const form of FORMS) {
    const base = objId(form.helm);
    const mask = form.mask ? objId(form.mask) : ItemIdentifiers.BLACK_MASK;
    if (base == null || mask == null) continue;
    byId.set(base, { form, recolour: null, mask, base });
    for (const recolour of recolours) {
      const id = objId(recolour.item(form.helm));
      if (id != null) byId.set(id, { form, recolour, mask, base });
    }
  }
  for (const recolour of recolours) if (recolour.headId != null) heads.set(recolour.headId, recolour);
  helmets = { api: pluginApi, byId, heads };
  return helmets;
}

function sendSpam(player, text) {
  player.getPacketSender().sendTypedMessage(pluginApi.core.ChatType.SPAM, text);
}

function combineSound(player) {
  player.getPacketSender().sendSoundEffect(COMBINE_SOUND, 1, 0, 255);
}

function varbitSet(player, name) {
  const id = pluginApi.core.CacheDefinitions.getVarbitId(name);
  return id != null && player.getPacketSender().getVarbit(id) === 1;
}

function headName(player) {
  const head = player.getEquipment?.()?.getItems?.()?.[pluginApi.core.Equipment.HEAD_SLOT];
  return head && head.getId() > 0 ? itemName(head.getId()) : "";
}

function itemName(itemId) {
  return String(pluginApi.core.ItemDefinition.forId(itemId)?.getName?.() ?? "").toLowerCase();
}

/**
 * "melee" for a mask/helmet, "all" for an imbued one, null otherwise. Without one, content may
 * give its effects ("slayer:helmet" { player, worn }: set `worn` to "imbued" or "plain", a league
 * relic's).
 */
function slayerHeadwear(player) {
  const name = headName(player);
  if (!name.includes("slayer helmet") && !name.includes("black mask")) {
    const request = { player, worn: null };
    pluginApi.emitCustomEvent("slayer:helmet", request);
    return request.worn === "imbued" ? "all" : request.worn === "plain" ? "melee" : null;
  }
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

/** "slayer-helmet:superseded" { player, style, superseded }: a worn item whose bonus replaces the helmet's (avarice). */
function superseded(player, style) {
  const query = { player, style, superseded: false };
  pluginApi.emitCustomEvent("slayer-helmet:superseded", query);
  return query.superseded === true;
}

/** Whether the headwear boosts `style` against the player's current target. */
function boostActive(player, style) {
  const headwear = slayerHeadwear(player);
  if (!headwear || (style !== "melee" && headwear !== "all")) return false;
  return onTask(player) && !salveApplies(player, style) && !superseded(player, style);
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
  if (entity?.isPlayer?.() && pluginApi.core?.WeaponProfiles?.usesMeleeStrength(entity.getAsPlayer())) {
    return meleeBoost(entity, value);
  }
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
  const helm = helmetTable().byId.get(targetId);
  const recoloured = helm?.recolour && helm.form.helm === "slayer_helm" ? objId(helm.recolour.item("slayer_helm_i")) : null;
  const result = IMBUED_ITEMS.get(targetId) ?? recoloured;
  if (result == null) return;
  event.handled = true;
  const targetItem = scrollOnUsed ? usedWithItem : usedItem;
  player.getInventory().deleteNumber(scrollOnUsed ? Number(usedItemId) : Number(usedWithItemId), 1);
  targetItem.setId(result);
  player.getInventory().refreshItems();
  pluginApi.emitCustomEvent("equipment:changed", { player });
  player.sendMessage(
    helm
      ? "You imbue the Slayer helmet with the scroll."
      : "You imbue the black mask with the scroll."
  );
}

function helmUnlocked(player) {
  return varbitSet(player, "slayer_helm_unlocked");
}

/** The imbued helmet an imbued mask makes: the Soul Wars and Emir's Arena masks make their own copy. */
function imbuedHelmFor(maskItemId) {
  const name = pluginApi.core.CacheDefinitions.getObjNames?.()?.get(Number(maskItemId));
  const form = FORMS.find((entry) => entry.mask && entry.mask !== "nzone_black_mask" && entry.mask === name);
  return (form && objId(form.helm)) ?? ItemIdentifiers.SLAYER_HELMET_I_;
}

function assemble(event) {
  if (event.handled) return;
  const { player, usedItem, usedWithItem, usedItemId, usedWithItemId, usedItemSlot, usedWithItemSlot } = event;
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
  const maskOnUsed = maskId(usedItemId) != null && PARTS.includes(usedWithItemId);
  const maskOnWith = maskId(usedWithItemId) != null && PARTS.includes(usedItemId);
  const selectedMask = maskOnUsed ? usedItem : maskOnWith ? usedWithItem : null;
  const selectedSlot = maskOnUsed ? usedItemSlot : usedWithItemSlot;
  const mask = selectedMask ?? findMask(inventory);
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
  const result = !imbued ? ItemIdentifiers.SLAYER_HELMET
    : usingScroll ? ItemIdentifiers.SLAYER_HELMET_I_ : imbuedHelmFor(mask.getId());
  if (selectedMask) inventory.deleteAtSlot(selectedSlot, 1);
  else inventory.deleteNumber(mask.getId(), 1);
  for (const part of PARTS) inventory.deleteNumber(part, 1);
  if (usingScroll) inventory.deleteNumber(scrollOnUsed ? Number(usedItemId) : Number(usedWithItemId), 1);
  inventory.adds(result, 1);
  inventory.refreshItems();
  pluginApi.emitCustomEvent("equipment:changed", { player });
  pluginApi.emitCustomEvent("league:complete-task", { player, id: "assemble-a-slayer-helm" });
  sendSpam(player, "You combine the items into a Slayer helm.");
  combineSound(player);
}

/** A recolour's head on a helmet of the plain colour, either way round. */
function recolour(event) {
  if (event.handled) return;
  const { player, usedItem, usedWithItem, usedItemId, usedWithItemId, usedItemSlot, usedWithItemSlot } = event;
  const { byId, heads } = helmetTable();
  const headOnUsed = heads.has(Number(usedItemId));
  const colour = heads.get(Number(headOnUsed ? usedItemId : usedWithItemId));
  const helm = byId.get(Number(headOnUsed ? usedWithItemId : usedItemId));
  // A recoloured helmet takes no second head: "Nothing interesting happens."
  if (!colour || !helm || helm.recolour) return;
  const result = objId(colour.item(helm.form.helm));
  if (result == null) return;
  event.handled = true;
  if (!varbitSet(player, colour.unlock)) {
    learnFirst(player);
    return;
  }
  const helmItem = headOnUsed ? usedWithItem : usedItem;
  const helmSlot = headOnUsed ? usedWithItemSlot : usedItemSlot;
  const headName = pluginApi.core.ItemDefinition.forId(colour.headId)?.getName?.() ?? "head";
  pluginApi.sendMultiChatboxPrompt(player, `Combine the ${headName} with your helm?`,
    "Yes", () => combineRecolour(player, helmItem, helmSlot, helm.base, colour, result),
    "No", () => {});
}

function learnFirst(player) {
  const { ChatType, DialogueChainBuilder, StatementDialogue } = pluginApi.core;
  player.getPacketSender().sendTypedMessage(ChatType.MESBOX, LEARN_FIRST);
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, LEARN_FIRST)));
}

/** Yes: the head goes into the helmet, if both are still there and the helmet is still the same uncoloured one. */
function combineRecolour(player, helmItem, helmSlot, base, colour, result) {
  const inventory = player.getInventory();
  const helm = helmetTable().byId.get(Number(helmItem.getId()));
  if (inventory.getItems()[helmSlot] !== helmItem || helm?.base !== base || helm.recolour ||
    !inventory.contains(colour.headId)) return;
  inventory.deleteNumber(colour.headId, 1);
  helmItem.setId(result);
  inventory.refreshItems();
  pluginApi.emitCustomEvent("equipment:changed", { player });
  sendSpam(player, `You combine the items into a ${pluginApi.core.ItemDefinition.forId(result)?.getName?.()}.`);
  combineSound(player);
}

/** Check (inventory or worn): the task, as the enchanted gem inside it shows (Slayer.plugin.js). */
function check({ player }) {
  pluginApi.emitCustomEvent("slayer:check", { player, handled: false });
  return true;
}

function notBuilt() {
  return true;
}

/** Disassemble: the helmet's own black mask, the components and any recolour's head. */
function disassemble(event) {
  const { player, item } = event;
  const entry = helmetTable().byId.get(Number(item.getId()));
  if (!entry || entry.recolour?.disassemble === false) return true;
  const head = entry.recolour?.headId ?? null;
  const inventory = player.getInventory();
  // Ours: no message is recorded for a full inventory.
  if (inventory.getFreeSlots() < PARTS.length + (head != null ? 1 : 0)) {
    player.sendMessage("You don't have enough inventory space to disassemble the helmet.");
    return true;
  }
  inventory.deleteNumber(item.getId(), 1);
  inventory.adds(entry.mask, 1);
  for (const part of PARTS) inventory.adds(part, 1);
  if (head != null) inventory.adds(head, 1);
  inventory.refreshItems();
  pluginApi.emitCustomEvent("equipment:changed", { player });
  sendSpam(player, "You disassemble your Slayer helm.");
  combineSound(player);
  return true;
}

module.exports = {
  name: "SlayerHelmet",
  description: "Adds the black mask and Slayer helmet: Slayer-task accuracy and damage boosts, assembling and disassembling, and imbuing with a scroll.",
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
    api.onItemOnItem(recolour, { noted: false });
    // Partner and Log aren't built; handling them keeps the worn click from taking the helmet off.
    const actions = { Disassemble: disassemble, Check: check, Partner: notBuilt, Log: notBuilt };
    for (const name of HELMET_NAMES) api.onItemAction(name, actions);
  },
  _test: { slayerHeadwear, meleeBoost, rangedAccuracyBoost, rangedDamageBoost, magicBoost, imbue, assemble, recolour, disassemble, HELMET_NAMES, FORMS, RECOLOURS },
};
