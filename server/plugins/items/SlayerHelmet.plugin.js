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
 *
 * Uncharge on a charged black mask, (1) to (10), asks "Remove the charges from this item?" and,
 * on "Yes.", turns it into the plain black mask with an objectbox and sound 2672 (rsprox
 * captures, docs/slayer.md). Black mask (i) and (1) (i) to (10) (i) Uncharge back to the same plain
 * mask, charges kept, asked the same way, and give back what the imbue cost (Wiki, Black mask (i)).
 * A mask the Nightmare Zone imbued (marked IMBUED_BY_NMZ_META, carried through a helmet and back)
 * refunds its whole price in points. Any other (a scroll of imbuing, or one imbued before the mark
 * existed) gives a scroll of imbuing back. No recording shows it, so the plain mask's prompt and
 * sound are used and no line is sent. The Soul Wars and Emir's Arena ids aren't built.
 *
 * A black mask (i) a PvP death loses (to a player, in the Wilderness, not protected) loses its imbue:
 * it drops for the killer as the plain mask, charges kept, and the victim gets the imbue back as
 * the Uncharge does, points for a Nightmare Zone imbue, else a scroll of imbuing (Wiki, Black mask
 * (i): "If lost on death in PvP situations, the mask will lose its imbued status, but the player
 * will be reimbursed"). The Items Kept on Death preview shows it lost (`items:lost-to-pvp-killer`).
 * A Slayer helmet or Slayer helmet (i), any colour, lost the same way drops for the killer as the plain
 * black mask, the other parts are lost, and an imbued one's imbue is given back as the mask's is (Wiki,
 * Items Kept on Death: "Dropped to the PKer as a black mask. The imbue cost is refunded to the victim.
 * The other parts are lost."). A recolour's head goes back to the victim with the death's other
 * untradeables ("The recolour item goes to the victim's gravestone"), except the Hooded and Oathplate
 * heads, which that page's "Hooded, Radiant or Oathplate" row loses with the other parts. The Soul Wars and Emir's Arena helmets keep
 * today's handling: neither shop's imbue is modelled, so there is nothing to refund.
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
/** Black mask (1) to (10) ids, filled at register. */
let CHARGED_MASK_IDS = new Set();
/** The imbued black masks (the ids both imbues make) -> the plain mask each came from, filled at register. */
let NMZ_IMBUED_MASKS = new Map();
/** Item meta: this mask or helmet was imbued by the Nightmare Zone, so Uncharge refunds points. */
const IMBUED_BY_NMZ_META = "slayer-helmet:nmz-imbued";

/** Victim -> the imbues a PvP death took from their black masks, given back once the death returns kept items. */
const pendingDeathRefunds = new WeakMap();
/** Victim -> the recolour heads of the helmets a PvP death took, handed to the death's untradeables. */
const pendingDeathHeads = new WeakMap();
/** Recolours whose head a PvP death loses with the helmet's other parts (Wiki, Items Kept on Death). */
const PVP_HEAD_LOST = new Set(["Hooded", "Oathplate", "Radiant"]);

const COMBINE_SOUND = 2241;
const UNCHARGE_SOUND = 2672;
const UNCHARGE_TITLE = "Remove the charges from this item?";
const UNCHARGED_TEXT = "You remove the charges from the item.";
/** "Black mask (1)" to "Black mask (10)": the charged plain masks. */
const CHARGED_MASK_NAMES = Array.from({ length: 10 }, (_, i) => `Black mask (${i + 1})`);
/** "Black mask (i)" and "Black mask (1) (i)" to "Black mask (10) (i)" (the cache's names). */
const IMBUED_MASK_NAMES = ["Black mask (i)", ...CHARGED_MASK_NAMES.map((name) => `${name} (i)`)];
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
  const target = pluginApi.core.hitTargetOf(player);
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
  const nmzImbued = usingScroll ? null : nmzMark(mask);
  if (selectedMask) inventory.deleteAtSlot(selectedSlot, 1);
  else inventory.deleteNumber(mask.getId(), 1);
  for (const part of PARTS) inventory.deleteNumber(part, 1);
  if (usingScroll) inventory.deleteNumber(scrollOnUsed ? Number(usedItemId) : Number(usedWithItemId), 1);
  if (nmzImbued) inventory.add(new pluginApi.core.Item(result, 1, nmzImbued), false);
  else inventory.adds(result, 1);
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
  const { DialogueChainBuilder, StatementDialogue } = pluginApi.core;
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
  const nmzImbued = nmzMark(item);
  inventory.deleteNumber(item.getId(), 1);
  if (nmzImbued) inventory.add(new pluginApi.core.Item(entry.mask, 1, nmzImbued), false);
  else inventory.adds(entry.mask, 1);
  for (const part of PARTS) inventory.adds(part, 1);
  if (head != null) inventory.adds(head, 1);
  inventory.refreshItems();
  pluginApi.emitCustomEvent("equipment:changed", { player });
  sendSpam(player, "You disassemble your Slayer helm.");
  combineSound(player);
  return true;
}

/** Uncharge on a charged black mask: asks first, nothing changes until "Yes.". */
function uncharge({ player, item }) {
  if (!CHARGED_MASK_IDS.has(Number(item?.getId?.()))) return false;
  const inventory = player.getInventory();
  const slot = inventory.getItems().indexOf(item);
  if (slot < 0) return false;
  pluginApi.sendMultiChatboxPrompt(player, UNCHARGE_TITLE,
    "Yes.", () => removeCharges(player, item, slot),
    "No.", () => {});
  return true;
}

/** Yes: only if the same charged mask is still in that slot. */
function removeCharges(player, item, slot) {
  const inventory = player.getInventory();
  if (inventory.getItems()[slot] !== item || !CHARGED_MASK_IDS.has(Number(item.getId()))) return;
  item.setId(ItemIdentifiers.BLACK_MASK);
  inventory.refreshItems();
  player.getPacketSender().sendSoundEffect(UNCHARGE_SOUND, 1, 0, 255);
  const { DialogueChainBuilder, ItemStatementDialogue } = pluginApi.core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new ItemStatementDialogue(0, ItemIdentifiers.BLACK_MASK, UNCHARGED_TEXT)));
}

/** The meta an item made from `item` keeps when its imbue was the Nightmare Zone's (null if not). */
function nmzMark(item) {
  return item?.getMetaValue?.(IMBUED_BY_NMZ_META) === true ? { [IMBUED_BY_NMZ_META]: true } : null;
}

/** "nightmare-zone:imbued": marks a black mask or Slayer helmet the Nightmare Zone just imbued. */
function markNmzImbue({ item, imbuedItemId }) {
  const id = Number(imbuedItemId);
  if (!item || !(NMZ_IMBUED_MASKS.has(id) || helmetTable().byId.get(id)?.form?.helm === "slayer_helm_i")) return;
  item.setMetaValue(IMBUED_BY_NMZ_META, true);
}

/** Uncharge on an imbued black mask: asks first, as the plain masks' Uncharge. */
function unimbue({ player, item }) {
  if (!NMZ_IMBUED_MASKS.has(Number(item?.getId?.()))) return false;
  const inventory = player.getInventory();
  const slot = inventory.getItems().indexOf(item);
  if (slot < 0) return false;
  pluginApi.sendMultiChatboxPrompt(player, UNCHARGE_TITLE,
    "Yes.", () => removeImbue(player, item, slot),
    "No.", () => {});
  return true;
}

/**
 * Yes: only if the same mask is still in that slot. A Nightmare Zone imbue is refunded in points
 * first; any other gives its scroll of imbuing back, which needs room.
 */
function removeImbue(player, item, slot) {
  const inventory = player.getInventory();
  const base = NMZ_IMBUED_MASKS.get(Number(item.getId()));
  if (inventory.getItems()[slot] !== item || base == null) return;
  if (item.getMetaValue?.(IMBUED_BY_NMZ_META) === true) {
    const request = { player, baseItemId: base, refunded: null };
    pluginApi.emitCustomEvent("nightmare-zone:refund-imbue", request);
    if (request.refunded == null) return;
    const meta = { ...(item.getMeta?.() ?? {}) };
    delete meta[IMBUED_BY_NMZ_META];
    item.setMeta(Object.keys(meta).length ? meta : null);
  } else {
    const scroll = new pluginApi.core.Item(ItemIdentifiers.SCROLL_OF_IMBUING, 1);
    if (inventory.getAddableAmount(scroll) < 1) return;
    inventory.add(scroll, false);
  }
  item.setId(base);
  inventory.refreshItems();
  player.getPacketSender().sendSoundEffect(UNCHARGE_SOUND, 1, 0, 255);
}

/** As BrokenItems: a PvP death is one in the Wilderness to a player killer. */
function isPvpDeath(player, killer) {
  return killer != null && killer !== player && pluginApi.core.Wilderness.isIn(player) === true;
}

/** An imbued black mask a PvP death would take, imbue and all; preset copies were never paid for and stay as they are. */
function losesImbueToKiller(item) {
  if (!item || item.isPresetItem?.() === true || item.isUntradeable?.() === true) return false;
  return NMZ_IMBUED_MASKS.has(Number(item.getId?.())) || helmetLostToKiller(item) != null;
}

/** The helmet forms a PvP death turns into a black mask: the plain and the scroll / Nightmare Zone imbued ones. */
const PVP_DROPPED_HELM_FORMS = new Set(["slayer_helm", "slayer_helm_i"]);

/**
 * A Slayer helmet a PvP death drops as a black mask: { imbued, base, head } (base: the plain helmet of its colour, the
 * id a Nightmare Zone refund is priced by; head: the recolour item the victim gets back, or null), or null. Preset copies stay as they are, as the masks.
 */
function helmetLostToKiller(item) {
  if (!item || item.isPresetItem?.() === true || item.isUntradeable?.() === true) return null;
  const entry = helmetTable().byId.get(Number(item.getId?.()));
  if (!entry || !PVP_DROPPED_HELM_FORMS.has(entry.form.helm)) return null;
  const base = objId(entry.recolour ? entry.recolour.item("slayer_helm") : "slayer_helm");
  const head = entry.recolour && !PVP_HEAD_LOST.has(entry.recolour.name) ? entry.recolour.headId ?? null : null;
  return { imbued: entry.form.helm === "slayer_helm_i", base, head };
}

/**
 * A Slayer helmet lost to a PvP death: the killer gets a plain black mask in its place (extraDrops, so core drops it
 * for them), the helmet and its other parts are gone, its recolour head is owed back, and an imbued one's imbue is owed
 * to the victim.
 */
function loseHelmetOnPvpDeath(event, helm) {
  if (!Array.isArray(event.extraDrops)) return;
  const { player, item } = event;
  event.extraDrops.push(new pluginApi.core.Item(ItemIdentifiers.BLACK_MASK, 1));
  event.handled = true;
  if (helm.head != null) {
    const heads = pendingDeathHeads.get(player) ?? [];
    heads.push(helm.head);
    pendingDeathHeads.set(player, heads);
  }
  if (!helm.imbued) return;
  const owed = pendingDeathRefunds.get(player) ?? [];
  owed.push({ base: helm.base, nmz: item.getMetaValue?.(IMBUED_BY_NMZ_META) === true });
  pendingDeathRefunds.set(player, owed);
}

/**
 * `onPlayerDeathItemDrop`: an unprotected black mask (i) lost to a PvP death becomes the plain mask, which the death
 * drops for the killer, and its imbue is owed to the victim.
 */
function loseImbueOnPvpDeath(event) {
  const { player, killer, item } = event;
  if (event.kept || event.shouldDropItems === false || !isPvpDeath(player, killer) || !losesImbueToKiller(item)) return;
  const helm = helmetLostToKiller(item);
  if (helm) {
    loseHelmetOnPvpDeath(event, helm);
    return;
  }
  const nmz = item.getMetaValue?.(IMBUED_BY_NMZ_META) === true;
  if (nmz) {
    const meta = { ...(item.getMeta?.() ?? {}) };
    delete meta[IMBUED_BY_NMZ_META];
    item.setMeta(Object.keys(meta).length ? meta : null);
  }
  const base = NMZ_IMBUED_MASKS.get(Number(item.getId()));
  item.setId(base);
  // Our cache marks Black mask (1)-(9) untradeable, so core would hand them back to the victim (a free uncharge);
  // the Wiki (Black mask: Tradeable "Yes") and osrsreboxed-db list every charge level as tradeable, so drop it here.
  if (!item.isTradeable() && Array.isArray(event.extraDrops)) {
    event.extraDrops.push(item);
    event.handled = true;
  }
  const owed = pendingDeathRefunds.get(player) ?? [];
  owed.push({ base, nmz });
  pendingDeathRefunds.set(player, owed);
}

/**
 * `onPlayerDeathDrops`: the recolour heads the PvP death took off its helmets join its untradeables, which go where the
 * death's other untradeables do (back to the victim, as a death with a killer makes no grave).
 */
function returnRecolourHeads({ player, untradeables }) {
  const heads = pendingDeathHeads.get(player);
  if (!heads) return;
  pendingDeathHeads.delete(player);
  if (!Array.isArray(untradeables)) return;
  for (const head of heads) untradeables.push(new pluginApi.core.Item(head, 1));
}

/**
 * "player:died" (after the kept items are back): the imbues a PvP death took. A Nightmare Zone imbue is refunded in
 * points; any other, or one whose points would pass the cap (ours: the Wiki says nothing of the cap), as a scroll
 * of imbuing (deliverScroll).
 */
function refundPvpDeathImbues({ player }) {
  const owed = pendingDeathRefunds.get(player);
  if (!owed) return;
  pendingDeathRefunds.delete(player);
  for (const { base, nmz } of owed) {
    if (nmz) {
      const request = { player, baseItemId: base, refunded: null };
      pluginApi.emitCustomEvent("nightmare-zone:refund-imbue", request);
      if (request.refunded != null) continue;
    }
    deliverScroll(player);
  }
}

/**
 * Ours (the Wiki doesn't say where it goes): the refunded scroll goes to the inventory, else the bank (none for an
 * Ultimate Ironman), else on the floor where the victim stands a tick later, past the respawn's move, so it never
 * lies on the death tile for the killer.
 */
function deliverScroll(player) {
  const { Item, Bank, ItemOnGroundManager, TaskManager, Task } = pluginApi.core;
  const id = ItemIdentifiers.SCROLL_OF_IMBUING;
  const scroll = new Item(id, 1);
  const inventory = player.getInventory();
  if (inventory.getAddableAmount(scroll) >= 1) {
    inventory.add(scroll);
    return;
  }
  const mode = { player, mode: "none" };
  pluginApi.emitCustomEvent("ironman:mode", mode);
  if (mode.mode !== "ultimate") {
    const bank = player.getBank(Bank.getTabForItem(player, id));
    if (bank.getAddableAmount(scroll) >= 1) {
      bank.add(scroll, false);
      return;
    }
  }
  TaskManager.submit(new (class extends Task {
    constructor() { super(1, player, false); }
    execute() {
      this.stop();
      if (player.isRegistered?.() === false) return;
      ItemOnGroundManager.registerLocation(player, scroll, player.getLocation().clone());
    }
  })());
}

/** `items:lost-to-pvp-killer` { item, lost }: the Items Kept on Death preview of a PvP death. */
function answerLostToPvpKiller(query) {
  if (losesImbueToKiller(query?.item)) query.lost = true;
}

module.exports = {
  name: "SlayerHelmet",
  description: "Adds the black mask and Slayer helmet: Slayer-task accuracy and damage boosts, assembling and disassembling, imbuing with a scroll, and uncharging a charged black mask.",
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
    CHARGED_MASK_IDS = new Set([ItemIdentifiers.BLACK_MASK_1_, ItemIdentifiers.BLACK_MASK_2_, ItemIdentifiers.BLACK_MASK_3_,
      ItemIdentifiers.BLACK_MASK_4_, ItemIdentifiers.BLACK_MASK_5_, ItemIdentifiers.BLACK_MASK_6_, ItemIdentifiers.BLACK_MASK_7_,
      ItemIdentifiers.BLACK_MASK_8_, ItemIdentifiers.BLACK_MASK_9_, ItemIdentifiers.BLACK_MASK_10_]);
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
    NMZ_IMBUED_MASKS = new Map([...IMBUED_ITEMS]
      .filter(([plain]) => plain !== ItemIdentifiers.SLAYER_HELMET)
      .map(([plain, imbued]) => [imbued, plain]));
    api.registerMeleeAttackAccuracyModifier(meleeBoost);
    api.registerMeleeHitModifier(meleeBoost);
    api.registerRangedAttackAccuracyModifier(rangedAccuracyBoost);
    api.registerRangedHitModifier(rangedDamageBoost);
    api.registerMagicAttackAccuracyModifier(magicBoost);
    api.registerMagicHitModifier(magicBoost);
    api.onCustomEvent("slayer:imbued-active", imbuedActive);
    api.onCustomEvent("nightmare-zone:imbued", markNmzImbue);
    api.onItemOnItem(imbue, { noted: false });
    api.onItemOnItem(assemble, { noted: false });
    api.onItemOnItem(recolour, { noted: false });
    // Partner and Log aren't built; handling them keeps the worn click from taking the helmet off.
    const actions = { Disassemble: disassemble, Check: check, Partner: notBuilt, Log: notBuilt };
    for (const name of HELMET_NAMES) api.onItemAction(name, actions);
    for (const name of CHARGED_MASK_NAMES) api.onItemAction(name, { Uncharge: uncharge });
    for (const name of IMBUED_MASK_NAMES) api.onItemAction(name, { Uncharge: unimbue });
    api.onPlayerDeathItemDrop(loseImbueOnPvpDeath);
    api.onPlayerDeathDrops(returnRecolourHeads);
    api.onCustomEvent("player:died", refundPvpDeathImbues);
    api.onCustomEvent("items:lost-to-pvp-killer", answerLostToPvpKiller);
  },
  _test: { uncharge, unimbue, removeImbue, loseImbueOnPvpDeath, refundPvpDeathImbues, markNmzImbue, IMBUED_BY_NMZ_META, CHARGED_MASK_NAMES, IMBUED_MASK_NAMES, slayerHeadwear, meleeBoost, rangedAccuracyBoost, rangedDamageBoost, magicBoost, imbue, assemble, recolour, disassemble, HELMET_NAMES, FORMS, RECOLOURS },
};
