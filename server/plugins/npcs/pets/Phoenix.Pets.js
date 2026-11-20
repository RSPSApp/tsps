"use strict";

/**
 * The Wintertodt phoenix's colours (Wiki: Phoenix).
 *
 * - "Players can change the Phoenix's colour by using 250 of the desired gnomish firelighters on it
 *   [...] Doing so unlocks that colour permanently, even if the pet is reclaimed from Probita", and
 *   they "can switch freely between the unlocked colours" with Metamorphosis, on the item and the
 *   follower. Each colour is its own cache item, follower and house NPC (phoenixpet_<colour>).
 * - rsprox capture 2783 tick 346: 250 purple firelighters used on the white phoenix item take all 250,
 *   turn the item into phoenixpet_purple and open the double objectbox (firelighter, new phoenix) below,
 *   its text first sent as a mesbox chat line.
 * - rsprox captures 2780 tick 487, 2784 tick 600 (item) and 2783 tick 416 (house phoenix): Metamorphosis
 *   opens the chatmenu "What colour would you like to transform your phoenix into?" with Red, then the
 *   unlocked colours, leaving out the current one, then Cancel. Choosing one (2783 tick 419) changes the
 *   pet with no chat line.
 *
 * Ours: the order of several unlocked colours (the Wiki's variant order Blue, Green, Purple, White);
 * a red phoenix with nothing unlocked gets the pets' "can't change" line; fewer than 250 firelighters,
 * a colour already unlocked, or a red firelighter are left to the engine's "Nothing interesting happens."
 */

const UNLOCKS_ATTRIBUTE = "pets:phoenix-unlocks";
const FIRELIGHTERS_NEEDED = 250;
const MENU_TITLE = "What colour would you like to transform your phoenix into?";
const CANT_CHANGE = "Your pet can't change like that.";

/** The Wiki's variant order; the gameval suffix and the firelighter that unlocks each colour. */
const FORMS = [
  { key: "red", name: "Red", suffix: "" },
  { key: "blue", name: "Blue", suffix: "_blue", firelighter: "gnomish_firelighter_blue" },
  { key: "green", name: "Green", suffix: "_green", firelighter: "gnomish_firelighter_green" },
  { key: "purple", name: "Purple", suffix: "_purple", firelighter: "trail_gnomish_firelighter_purple" },
  { key: "white", name: "White", suffix: "_white", firelighter: "trail_gnomish_firelighter_white" },
];

/** rsprox 2783 tick 346, with its line breaks. */
function unlockText(name) {
  return `You coat your phoenix in the ${name} chemical, turning<br>it a brilliant ${name}! You have now unlocked ${name} as<br>a colour for your pet.`;
}

let api;
let services;
const formByItem = new Map();
const formByNpc = new Map();
const formByFirelighter = new Map();

/** The PETS rows for the four colours; Pets.plugin lists the red one as PHOENIX. */
function rows(base, cache) {
  formByItem.clear(); formByNpc.clear(); formByFirelighter.clear();
  if (!base) return [];
  const added = [];
  for (const form of FORMS) {
    const itemId = cache.getObjId(`phoenixpet${form.suffix}`);
    const petId = cache.getNpcId(`phoenix_pet${form.suffix}`);
    const houseNpcId = cache.getNpcId(`poh_phoenix_pet${form.suffix}`);
    if (!Number.isInteger(itemId) || !Number.isInteger(petId)) continue;
    const firelighterId = form.firelighter ? cache.getObjId(form.firelighter) : null;
    const entry = { ...form, itemId, petId, houseNpcId, firelighterId };
    formByItem.set(itemId, entry);
    formByNpc.set(petId, entry);
    if (Number.isInteger(firelighterId)) formByFirelighter.set(firelighterId, entry);
    if (petId === base.petId) continue;
    added.push({ ...base, enumName: `PHOENIX_${form.key.toUpperCase()}`, petId, itemId,
      houseNpcId: Number.isInteger(houseNpcId) ? houseNpcId : undefined, chance: undefined });
  }
  return added;
}

function unlocks(player) {
  const stored = player.getAttribute(UNLOCKS_ATTRIBUTE);
  return Array.isArray(stored) ? stored : [];
}

/** Red, then every unlocked colour, leaving out the current one. */
function choices(player, current) {
  const unlocked = unlocks(player);
  return [...formByItem.values()].filter((form) => form.key !== current.key
    && (form.key === "red" || unlocked.includes(form.key)));
}

/** The item in `slot` still is `current`, or `npc` is still the player's own follower in that form. */
function stillThere(player, current, { slot, npc }) {
  if (npc) return services.isOwnFollower(player, npc) && formByNpc.get(npc.getId()) === current;
  return player.getInventory().get(slot)?.getId?.() === current.itemId;
}

/** Turns the phoenix item in `slot` into `next`, or the follower `npc` when there is no slot. */
function become(player, next, { slot, npc }) {
  const pet = services.getPetForItemId(next.itemId);
  if (npc) {
    services.transformFollower(player, npc, pet);
  } else {
    player.getInventory().setItem(slot, new api.core.Item(next.itemId, 1));
    player.getInventory().refreshItems();
    // The stored variant follows the item too, or the next summon would bring back the old colour.
    services.setStoredVariant(player, pet, next.petId);
    services.recordOwnership(player, pet);
  }
  api.emitCustomEvent("persistence:save", { player, reason: "phoenix-colour" });
}

function metamorphose(player, current, target) {
  const options = choices(player, current);
  if (options.length === 0) {
    player.sendMessage(CANT_CHANGE);
    return;
  }
  const pairs = [];
  for (const next of options) {
    pairs.push(`${next.name}.`, (who) => {
      if (stillThere(who, current, target)) become(who, next, target);
    });
  }
  pairs.push("Cancel.", () => {});
  api.sendMultiChatboxPrompt(player, MENU_TITLE, ...pairs);
}

/** Inventory Metamorphosis on any phoenix colour's item. */
function itemMetamorphosis(event) {
  const current = formByItem.get(event.itemId);
  if (!current || event.player.busy?.()) return false;
  metamorphose(event.player, current, { slot: event.slot });
  return true;
}

/** pets:interact: the follower's own Metamorphosis, before the generic morph. */
function interact(event) {
  if (event.handled || String(event.action).toLowerCase() !== "metamorphosis") return;
  const current = formByNpc.get(event.npc?.getId?.());
  if (!current) return;
  event.handled = true;
  metamorphose(event.player, current, { npc: event.npc });
}

/** 250 firelighters of a colour not yet unlocked, used on a phoenix (item or follower). */
function use(player, usedId, current, target) {
  const colour = formByFirelighter.get(usedId);
  if (!colour || player.busy?.() || unlocks(player).includes(colour.key)) return false;
  const inventory = player.getInventory();
  if (inventory.getAmount(usedId) < FIRELIGHTERS_NEEDED) return false;
  inventory.delete(usedId, FIRELIGHTERS_NEEDED);
  player.setAttribute(UNLOCKS_ATTRIBUTE, [...unlocks(player), colour.key]);
  become(player, colour, target);
  player.getDialogueManager().startDialogues(new api.core.DialogueChainBuilder().add(
    new api.core.DoubleItemStatementDialogue(0, usedId, colour.itemId, unlockText(colour.name)),
  ));
  return true;
}

function itemOnItem(event) {
  if (event.handled) return;
  const sides = [
    [event.usedItemId, event.usedWithItemId, event.usedWithItemSlot],
    [event.usedWithItemId, event.usedItemId, event.usedItemSlot],
  ];
  for (const [usedId, phoenixId, slot] of sides) {
    const current = formByItem.get(phoenixId);
    if (!current || formByItem.has(usedId)) continue;
    if (use(event.player, usedId, current, { slot })) event.handled = true;
    return;
  }
}

function itemOnNpc(event) {
  if (event.handled || !event.target) return;
  const current = formByNpc.get(event.target.getId());
  if (!current || !services.isOwnFollower(event.player, event.target)) return;
  if (use(event.player, event.itemId, current, { npc: event.target })) event.handled = true;
}

function attach(pluginApi, helpers) {
  api = pluginApi; services = helpers;
  api.persistAttribute(UNLOCKS_ATTRIBUTE, []);
  api.onCustomEvent("pets:interact", interact);
  api.onItemOnItem(itemOnItem, { noted: false });
  api.onItemOnNpc(itemOnNpc, { noted: false });
  api.onItemAction("Phoenix", { Metamorphosis: itemMetamorphosis });
}

module.exports = { UNLOCKS_ATTRIBUTE, FIRELIGHTERS_NEEDED, MENU_TITLE, FORMS, unlockText, rows, attach };
