/**
 * The skull sceptre, from stronghold-of-security.json's `sceptre`:
 * - its pieces combine into the Strange skull, the Runed sceptre and the sceptre, each with the
 *   captured item box;
 * - Invoke is a standard teleport to the Stronghold's entrance (up to level 20 Wilderness, Wiki)
 *   that spends a charge and says how many are left, as captured; Divine says the same;
 * - charges (Wiki): 10, plus 4 for each Varrock diary tier done. Every unimbued sceptre shares
 *   one pool, and one that spends its last charge crumbles, leaving the next one full;
 * - Solztun imbues every sceptre the player has once they show him the Cradle of Life's boots.
 *   An imbued sceptre never crumbles and takes pieces (3 charges, 5 for the left skull half, +1
 *   per diary tier) or bone fragments (1 each) as charges;
 * - a chisel breaks any unimbued piece, or the whole sceptre, into the fragments its parts give.
 * The charges are kept as charges spent, so a sceptre that has never been used is full.
 */
const Data = require("./Data.StrongholdOfSecurity");

const SCEPTRE = Data.DATA.sceptre;
const SPENT_ATTRIBUTE = "stronghold-of-security:sceptre-charges-spent";
const IMBUED_ATTRIBUTE = "stronghold-of-security:sceptre-imbued";
const DIARY_TIERS = ["easy", "medium", "hard", "elite"];
const SOLZTUN = "Solztun";
const SOLZTUN_USE_VARIANT = "using-a-skull-sceptre-on-him";

let api;
let ids;
/** Piece and combined-item ids to their names in the data. */
let names;

function bind(pluginApi) {
  api = pluginApi;
  const { ItemIdentifiers } = api.core;
  ids = {
    sceptre: ItemIdentifiers.SKULL_SCEPTRE,
    imbued: ItemIdentifiers.SKULL_SCEPTRE_I_,
    fragments: ItemIdentifiers.BONE_FRAGMENTS,
    boots: [ItemIdentifiers.FANCY_BOOTS, ItemIdentifiers.FIGHTING_BOOTS, ItemIdentifiers.FANCIER_BOOTS],
  };
  names = new Map([...Object.keys(SCEPTRE.pieces), ...SCEPTRE.combines.map((entry) => entry.result)].map((name) => [item(name), name]));
}

const item = (name) => api.core.ItemIdentifiers[name];
const itemName = (id) => api.core.CacheDefinitions.getItem(id)?.name;
const fill = (text, charges) => text.replace("{charges}", charges);

function diaryTiers(player) {
  return DIARY_TIERS.filter((tier) => {
    const request = { player, diary: SCEPTRE.diaryTask.diary, tier, complete: false };
    api.emitCustomEvent("diary:is-complete", request);
    return request.complete === true;
  }).length;
}

function maxCharges(player) {
  return SCEPTRE.baseCharges + SCEPTRE.chargesPerDiaryTier * diaryTiers(player);
}

function charges(player) {
  return Math.max(0, maxCharges(player) - (Number(player.getAttribute(SPENT_ATTRIBUTE)) || 0));
}

function setCharges(player, value) {
  player.setAttribute(SPENT_ATTRIBUTE, Math.max(0, maxCharges(player) - value));
}

function isImbued(player) {
  return player.getAttribute(IMBUED_ATTRIBUTE) === true;
}

function sendCharges(player) {
  player.sendMessage(fill(SCEPTRE.chargesMessage, charges(player)));
}

function itemBox(player, itemId, text) {
  const { DialogueChainBuilder, ItemStatementDialogue, EndDialogue } = api.core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new ItemStatementDialogue(0, itemId, text), new EndDialogue(1)));
}

/** The pieces an item is made of, down to the four drops. */
function partsOf(name) {
  const combine = SCEPTRE.combines.find((entry) => entry.result === name);
  return combine ? combine.items.flatMap(partsOf) : [name];
}

/** A piece's worth in charges or fragments: its base value, +1 per Varrock diary tier done. */
function pieceValue(player, name) {
  return partsOf(name).reduce((sum, part) => sum + SCEPTRE.pieces[part] + diaryTiers(player), 0);
}

/** The combine whose two items these are, either way round. */
function combineFor(event) {
  const used = [event.usedItemId, event.usedWithItemId];
  return SCEPTRE.combines.find((entry) => entry.items.every((name) => used.includes(item(name)))) ?? null;
}

function combine(event) {
  const entry = combineFor(event);
  if (!entry) return false;
  const { player } = event;
  const inventory = player.getInventory();
  inventory.deleteAtSlot(event.usedItemSlot);
  inventory.deleteAtSlot(event.usedWithItemSlot);
  if (entry.result === "SKULL_SCEPTRE") {
    // Wiki: a new sceptre starts with the most charges the player's diary allows.
    setCharges(player, maxCharges(player));
    const sceptre = isImbued(player) ? ids.imbued : ids.sceptre;
    inventory.adds(sceptre, 1);
    itemBox(player, sceptre, fill(entry.message, charges(player)));
    return;
  }
  inventory.adds(item(entry.result), 1);
  itemBox(player, item(entry.result), entry.message);
}

/** Where the sceptre was invoked from, so a crumbling one leaves the right slot. */
function source(event) {
  const { Equipment } = api.core;
  const worn = event.interfaceId === Equipment.INVENTORY_INTERFACE_ID;
  return { container: worn ? event.player.getEquipment() : event.player.getInventory(), slot: event.slot, worn };
}

function crumble(player, from) {
  const { Equipment, Item, Flag, WeaponInterfaceManager } = api.core;
  const { container, slot, worn } = from;
  const held = container.get(slot)?.getId?.() === ids.sceptre ? slot : container.getSlotForItemId(ids.sceptre);
  if (held < 0) return;
  if (worn) {
    container.set(Equipment.WEAPON_SLOT, new Item(-1));
    container.refreshItems();
    WeaponInterfaceManager.assign(player);
    player.getUpdateFlag().flag(Flag.APPEARANCE);
  } else {
    container.deleteAtSlot(held);
  }
  // Wiki: "when one shatters, the next is magically back at full charge". The message is not captured.
  setCharges(player, maxCharges(player));
  player.sendMessage("Your Skull Sceptre crumbles to dust.");
}

function arrive(player, from, imbued) {
  setCharges(player, charges(player) - 1);
  if (!imbued && charges(player) === 0) crumble(player, from);
  else sendCharges(player);
  api.emitCustomEvent("diary:task", { player, ...SCEPTRE.diaryTask });
}

function invoke(event) {
  const { player } = event;
  const { TeleportHandler, TeleportType } = api.core;
  const destination = Data.toLocation(Data.DATA.surface);
  if (charges(player) === 0) {
    // Only an imbued sceptre can be empty; not captured.
    player.sendMessage("Your Skull Sceptre has no charges left.");
    return;
  }
  if (!TeleportHandler.checkReqs(player, destination)) return;
  const from = source(event);
  const imbued = event.itemId === ids.imbued;
  TeleportHandler.confirm(player, destination, () => TeleportHandler.teleport(player, destination, TeleportType.NORMAL, false, () => arrive(player, from, imbued)));
}

function divine({ player }) {
  sendCharges(player);
}

function recharge(player, worth, use) {
  const room = maxCharges(player) - charges(player);
  if (room <= 0) {
    // Not captured.
    player.sendMessage("Your Skull Sceptre is already fully charged.");
    return;
  }
  setCharges(player, charges(player) + use(Math.min(worth, room)));
  sendCharges(player);
}

/** The other item of an item-on-item: its id, its slot and its name in the data. */
function other(event, id) {
  const [otherId, slot] = event.usedItemId === id ? [event.usedWithItemId, event.usedWithItemSlot] : [event.usedItemId, event.usedItemSlot];
  return { id: otherId, slot, name: names.get(otherId) ?? null };
}

function rechargeWithPiece(event) {
  const { player } = event;
  const { slot, name } = other(event, ids.imbued);
  if (!name || !(name in SCEPTRE.pieces)) return false;
  recharge(player, pieceValue(player, name), (added) => {
    player.getInventory().deleteAtSlot(slot);
    return added;
  });
}

function rechargeWithFragments(event) {
  const { player } = event;
  if (other(event, ids.imbued).id !== ids.fragments) return false;
  const inventory = player.getInventory();
  recharge(player, inventory.getAmount(ids.fragments), (added) => {
    inventory.delete(ids.fragments, added);
    return added;
  });
}

function chisel(event) {
  const { player } = event;
  const { slot, name } = other(event, api.core.ItemIdentifiers.CHISEL);
  if (!name) return false;
  const fragments = pieceValue(player, name);
  player.getInventory().deleteAtSlot(slot);
  player.getInventory().adds(ids.fragments, fragments);
  // Not captured.
  player.sendMessage(`You chisel the ${itemName(item(name)).toLowerCase()} into ${fragments} bone fragments.`);
}

/** Solztun "imbues any Skull sceptres the player has": carried, worn and banked. */
function imbue(player) {
  const { Bank } = api.core;
  player.setAttribute(IMBUED_ATTRIBUTE, true);
  player.getPacketSender().sendVarbit(SCEPTRE.imbuedVarbit, 1);
  const containers = [player.getInventory(), player.getEquipment(),
    ...player.getBanks().filter((bank, tab) => bank && tab !== Bank.BANK_SEARCH_TAB_INDEX)];
  for (const container of containers) {
    for (const held of container.getItems()) if (held?.getId?.() === ids.sceptre) held.setId(ids.imbued);
  }
  player.getInventory().refreshItems();
  player.getEquipment().refreshItems();
}

const carries = (player, id) => player.getInventory().contains(id);
const hasSceptre = (player) => carries(player, ids.sceptre) || player.getEquipment().contains(ids.sceptre);
const carriesBoots = (player, boots = ids.boots) => boots.some((id) => carries(player, id));
const banksBoots = (player, boots) => boots.some((id) => player.getBanks().some((bank) => bank?.contains?.(id)));

/**
 * Solztun's transcript conditions. The server has no RuneScape Authenticator, so the account
 * counts as safe, as the Cradle of Life's boots already do.
 */
function solztunCondition({ player, definition, stepId }) {
  if (definition?.getName?.() !== SOLZTUN) return null;
  const { ItemIdentifiers } = api.core;
  const fancyOrFighting = [ItemIdentifiers.FANCY_BOOTS, ItemIdentifiers.FIGHTING_BOOTS];
  switch (stepId) {
    case "KfXhQ0": return hasSceptre(player) && carriesBoots(player);
    case "VxmOO-": return carriesBoots(player, fancyOrFighting);
    case "VjwWD6": case "ZJg2oD": case "RT1Gi_": return false;
    case "Z90S7u": case "n1blRS": case "Wrp_jR": return true;
    case "kXhUXq": return carries(player, ItemIdentifiers.FANCY_BOOTS);
    case "DM2B8U": return carries(player, ItemIdentifiers.FIGHTING_BOOTS);
    case "P09MTz": return carries(player, ItemIdentifiers.FANCIER_BOOTS);
    case "rctGRz": return carriesBoots(player, fancyOrFighting) || banksBoots(player, fancyOrFighting);
    case "Jvhok1": return !(carriesBoots(player, fancyOrFighting) || banksBoots(player, fancyOrFighting));
    default: return null;
  }
}

function solztunAction(action) {
  if (action.stepId !== "ZHlxEk" || action.definition?.getName?.() !== SOLZTUN) return;
  imbue(action.player);
  action.handled = true;
}

function useOnSolztun(event) {
  if ((event.definition ?? event.target?.getDefinition?.())?.getName?.() !== SOLZTUN || event.itemId !== ids.sceptre) return;
  event.handled = true;
  api.emitCustomEvent("npc-dialogue:start", { player: event.player, npc: event.target, npcId: event.npcId, variant: SOLZTUN_USE_VARIANT });
}

function restore({ player }) {
  if (isImbued(player)) player.getPacketSender().sendVarbit(SCEPTRE.imbuedVarbit, 1);
}

/** Hooks the sceptre's items, by the names the cache gives them, and Solztun. */
function attach(pluginApi) {
  bind(pluginApi);
  const name = (key) => itemName(item(key));
  const sceptre = itemName(ids.sceptre);
  const imbued = itemName(ids.imbued);
  api.persistAttribute(SPENT_ATTRIBUTE, 0);
  api.persistAttribute(IMBUED_ATTRIBUTE, false);
  api.onPlayerLogin(restore);
  for (const entry of SCEPTRE.combines) api.onItemOnItem(name(entry.items[0]), name(entry.items[1]), combine);
  for (const held of [sceptre, imbued]) api.onItemAction(held, { Invoke: invoke, Divine: divine });
  for (const piece of Object.keys(SCEPTRE.pieces)) api.onItemOnItem(name(piece), imbued, rechargeWithPiece);
  api.onItemOnItem(itemName(ids.fragments), imbued, rechargeWithFragments);
  for (const id of names.keys()) api.onItemOnItem(itemName(api.core.ItemIdentifiers.CHISEL), itemName(id), chisel);
  api.onNpcDialogueCondition(solztunCondition);
  api.onCustomEvent("npc-dialogue:action", solztunAction);
  api.onItemOnNpc(useOnSolztun);
}

module.exports = {
  SPENT_ATTRIBUTE, IMBUED_ATTRIBUTE,
  attach, bind, combine, invoke, divine, rechargeWithPiece, rechargeWithFragments, chisel,
  solztunCondition, solztunAction, useOnSolztun, restore, charges, maxCharges, pieceValue, imbue,
};
