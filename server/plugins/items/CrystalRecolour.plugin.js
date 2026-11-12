"use strict";

/**
 * Recolouring crystal equipment with the Elven Clan crystals from Lliann's Wares
 * (https://oldschool.runescape.wiki/w/Crystal_equipment).
 *
 * A crystal used on a crystal helm, body or legs, or on a corrupted blade of Saeldor or bow of
 * Faerdhinen, asks "Are you sure you wish to recolour your <item>?" (Yes / No). Yes uses up the
 * crystal and turns the item into that clan's colour in the same slot, keeping its charges, with
 * animation 'human_xbow_enchant_arrowtip', graphic 'xbows_enchanting_tips_spot', sound 144 and an item
 * box of the new item and the crystal.
 * Armour's own colour is Meilyr's and the weapons' Hefin's, so those crystals turn any colour back.
 * A crystal of the item's current colour does nothing (ours: no capture of it).
 */
const CLANS = ["ithell", "iorwerth", "trahaearn", "cadarn", "crwys", "meilyr", "hefin", "amlodd"];
const ARMOUR = ["crystal_helmet", "crystal_chestplate", "crystal_platelegs"];
const ARMOUR_BASE_CLAN = "meilyr";
const WEAPONS = ["blade_of_saeldor_infinite", "bow_of_faerdhinen_infinite"];
const WEAPON_BASE_CLAN = "hefin";
/** Kept in the families so a Deadman piece can be recoloured; no crystal gives this colour. */
const DEADMAN = "deadman";
const RECOLOUR_SEQUENCE = "human_xbow_enchant_arrowtip";
const RECOLOUR_GRAPHIC = "xbows_enchanting_tips_spot";
const RECOLOUR_SOUND = 144;

let core = null;
let api = null;
/** Item id -> { family: Map<clan, id> }. */
let familyById = new Map();
/** Clan crystal id -> clan. */
let clanByCrystal = new Map();

/** One family per item and state: clan -> id, the base colour under its own clan. */
function addFamily(base, baseClan) {
  const obj = (name) => core.CacheDefinitions.getObjId(name);
  const family = new Map();
  const baseId = obj(base);
  if (baseId == null) return;
  family.set(baseClan, baseId);
  for (const clan of [...CLANS, DEADMAN]) {
    if (clan === baseClan) continue;
    const id = obj(`${base}_${clan}`);
    if (id != null) family.set(clan, id);
  }
  for (const id of family.values()) familyById.set(id, family);
}

function build() {
  familyById = new Map();
  clanByCrystal = new Map();
  for (const piece of ARMOUR) {
    addFamily(piece, ARMOUR_BASE_CLAN);
    addFamily(`${piece}_inactive`, ARMOUR_BASE_CLAN);
  }
  for (const weapon of WEAPONS) addFamily(weapon, WEAPON_BASE_CLAN);
  for (const clan of CLANS) {
    const id = core.CacheDefinitions.getObjId(`prif_clan_crystal_${clan}`);
    if (id != null) clanByCrystal.set(id, clan);
  }
}

function nameOf(id) {
  return core.ItemDefinition.forId(id).getName();
}

/** The clan crystal and the item it is used on, either way round, or null (also for the item's own colour). */
function pairOf(event) {
  const { usedItem, usedWithItem } = event;
  const [crystal, target] = clanByCrystal.has(usedItem?.getId?.()) ? [usedItem, usedWithItem] : [usedWithItem, usedItem];
  const clan = clanByCrystal.get(crystal?.getId?.());
  const family = familyById.get(target?.getId?.());
  const nextId = family?.get(clan);
  if (!clan || nextId == null || nextId === target.getId()) return null;
  return { crystal, target, clan };
}

/** The colour is looked up again on Yes: the item may have gone active or inactive meanwhile. */
function recolour(player, { crystal, target, clan }, name = nameOf(target.getId())) {
  const inventory = player.getInventory();
  const items = inventory.getItems();
  const crystalSlot = items.indexOf(crystal);
  const nextId = familyById.get(target.getId())?.get(clan);
  if (crystalSlot < 0 || !items.includes(target) || nextId == null || crystal.getId() == null || !clanByCrystal.has(crystal.getId())) return false;
  const crystalId = crystal.getId();
  inventory.deleteItem(crystal, crystalSlot);
  target.setId(nextId);
  inventory.refreshItems();
  const sequence = core.CacheDefinitions.getSeqId?.(RECOLOUR_SEQUENCE);
  if (sequence != null) player.performAnimation(new core.Animation(sequence));
  const graphic = core.CacheDefinitions.getSpotanimId?.(RECOLOUR_GRAPHIC);
  if (graphic != null) player.performGraphic(new core.Graphic(graphic));
  player.getPacketSender().sendSound(RECOLOUR_SOUND, 1, 0);
  const text = `You use the crystal to colour your ${name}.`;
  player.getPacketSender().sendTypedMessage(core.ChatType.MESBOX, text);
  const { DialogueChainBuilder, DoubleItemStatementDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new DoubleItemStatementDialogue(0, nextId, crystalId, text)));
  return true;
}

function useCrystal(event) {
  const pair = pairOf(event);
  if (!pair) return;
  event.handled = true;
  const { player } = event;
  const name = nameOf(pair.target.getId());
  api.sendMultiChatboxPrompt(player, `Are you sure you wish to recolour your ${name}?`,
    "Yes", () => recolour(player, pair, name),
    "No", () => {});
}

function attach(pluginApi) {
  api = pluginApi;
  core = api.core;
  build();
}

module.exports = {
  name: "CrystalRecolour",
  description: "Crystal equipment recolours: the Elven Clan crystals recolour crystal armour and the corrupted blade of Saeldor and bow of Faerdhinen, keeping their charges.",
  members: true,
  register(pluginApi) {
    attach(pluginApi);
    api.onItemOnItem(useCrystal, { noted: false });
  },
  _test: { attach, pairOf, recolour, useCrystal, familyOf: (id) => familyById.get(id), clanOf: (id) => clanByCrystal.get(id) },
};
