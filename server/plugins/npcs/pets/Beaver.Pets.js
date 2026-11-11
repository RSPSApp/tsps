"use strict";

/**
 * The beaver's forms (Wiki: Beaver, Funky shaped log).
 *
 * - A Funky shaped log used on the beaver (and consumed) "permanently unlock[s] the ability to change
 *   the beaver's colour"; each colour is then applied by using its log on the beaver, which uses the log.
 * - A golden pheasant egg and a fox whistle (each consumed) unlock the pheasant and fox forms, without the
 *   funky log. "Once unlocked, the beaver can be freely transformed between variants", and a recoloured
 *   beaver turned into a fox or pheasant comes back in the default colour.
 * - Every form is its own item and follower in the cache (skillpetwc, skillpet_wc_<log>, _pheasant, _fox),
 *   so the item in the inventory, or the follower, changes to the new form.
 * - rsprox captures 2780 tick 349 and 2783 tick 160: Metamorphosis with nothing unlocked opens the
 *   messagebox below; 2783: magic logs used on a locked beaver give "Nothing interesting happens.".
 *
 * Ours: no capture shows an unlocked beaver. Metamorphosis cycles Beaver -> Pheasant -> Fox through the
 * unlocked forms (the Wiki's order); the unlock lines are ours, and a change uses the lines the other
 * pets' metamorphoses use.
 */

const UNLOCKS_ATTRIBUTE = "pets:beaver-unlocks";
const LOCKED_TEXT = "You can unlock the ability for your pet Beaver to change colour by<br>feeding it a <col=0000b2>Funky shaped log</col>.";
const TRANSFORMED = "Your pet endures metamorphosis and transforms.";
const CANT_CHANGE = "Your pet can't change like that.";

/** The Wiki's variant table, with each form's cache gameval suffix and what changes the beaver into it. */
const FORMS = [
  { key: "normal", gameval: "skillpetwc", log: "logs" },
  { key: "oak", gameval: "skillpet_wc_oak", log: "oak_logs" },
  { key: "willow", gameval: "skillpet_wc_willow", log: "willow_logs" },
  { key: "teak", gameval: "skillpet_wc_teak", log: "teak_logs" },
  { key: "jatoba", gameval: "skillpet_wc_jatoba", log: "jatoba_logs" },
  { key: "maple", gameval: "skillpet_wc_maple", log: "maple_logs" },
  { key: "mahogany", gameval: "skillpet_wc_mahogany", log: "mahogany_logs" },
  { key: "arctic", gameval: "skillpet_wc_arctic", log: "arctic_pine_log" },
  { key: "yew", gameval: "skillpet_wc_yew", log: "yew_logs" },
  { key: "camphor", gameval: "skillpet_wc_camphor", log: "camphor_logs" },
  { key: "magic", gameval: "skillpet_wc_magic", log: "magic_logs" },
  { key: "ironwood", gameval: "skillpet_wc_ironwood", log: "ironwood_logs" },
  { key: "redwood", gameval: "skillpet_wc_redwood", log: "redwood_logs" },
  { key: "rosewood", gameval: "skillpet_wc_rosewood", log: "rosewood_logs" },
  { key: "pheasant", gameval: "skillpet_wc_pheasant", unlock: "pheasant" },
  { key: "fox", gameval: "skillpet_wc_fox", unlock: "fox" },
];
/** Metamorphosis goes round these, skipping locked ones; a coloured beaver counts as the normal one. */
const CYCLE = ["normal", "pheasant", "fox"];
/** The consumable that unlocks each ability, and the line it gives. Ours: the lines. */
const UNLOCK_ITEMS = [
  { gameval: "forestry_funky_shaped_log", unlock: "colours", line: "Your beaver can now change colour: use logs on it to recolour it." },
  { gameval: "forestry_pheasant_pet_egg", unlock: "pheasant", line: "Your beaver can now transform into a pheasant." },
  { gameval: "forestry_fox_pet_whistle", unlock: "fox", line: "Your beaver can now transform into a fox." },
];

let api;
let services;
const formByItem = new Map();
const formByNpc = new Map();
const formByLog = new Map();
const unlockByItem = new Map();

/** The PETS rows for every form but the base one, which Pets.plugin already lists as BEAVER. */
function rows(base, cache) {
  formByItem.clear(); formByNpc.clear(); formByLog.clear(); unlockByItem.clear();
  const added = [];
  for (const form of FORMS) {
    const itemId = cache.getObjId(form.gameval);
    const petId = cache.getNpcId(form.gameval);
    if (!Number.isInteger(itemId) || !Number.isInteger(petId)) continue;
    const entry = { ...form, itemId, petId };
    formByItem.set(itemId, entry);
    formByNpc.set(petId, entry);
    const logId = form.log ? cache.getObjId(form.log) : null;
    if (Number.isInteger(logId)) formByLog.set(logId, entry);
    if (petId === base.petId) continue;
    added.push({ ...base, enumName: `BEAVER_${form.key.toUpperCase()}`, petId, itemId, chance: undefined });
  }
  for (const item of UNLOCK_ITEMS) {
    const itemId = cache.getObjId(item.gameval);
    if (Number.isInteger(itemId)) unlockByItem.set(itemId, item);
  }
  return added;
}

function unlocks(player) {
  const stored = player.getAttribute(UNLOCKS_ATTRIBUTE);
  return Array.isArray(stored) ? stored : [];
}

function unlocked(player, key) {
  return unlocks(player).includes(key);
}

function form(key) {
  return [...formByItem.values()].find((entry) => entry.key === key);
}

/** The next unlocked form round the cycle, or null when there is nowhere else to go. */
function nextForm(player, current) {
  const at = Math.max(0, CYCLE.indexOf(current.unlock ? current.key : "normal"));
  for (let step = 1; step < CYCLE.length; step++) {
    const key = CYCLE[(at + step) % CYCLE.length];
    if (key === "normal" || unlocked(player, key)) return key === "normal" && current.key === "normal" ? null : form(key);
  }
  return null;
}

/** The used item, from the slot it was used from when that slot still holds it. */
function removeOne(player, itemId, slot) {
  const inventory = player.getInventory();
  if (Number.isInteger(slot) && inventory.get(slot)?.getId?.() === itemId) inventory.deleteAtSlot(slot, 1);
  else inventory.deleteNumber(itemId, 1);
}

function showLocked(player) {
  player.getDialogueManager().startDialogues(new api.core.DialogueChainBuilder().add(
    new api.core.StatementDialogue(0, LOCKED_TEXT),
  ));
}

/** Turns the beaver item in `slot` into `next`, or the follower `npc` when there is no slot. */
function become(player, next, { slot, npc }) {
  const pet = services.getPetForItemId(next.itemId);
  if (npc) {
    services.transformFollower(player, npc, pet);
  } else {
    player.getInventory().setItem(slot, new api.core.Item(next.itemId, 1));
    player.getInventory().refreshItems();
    services.recordOwnership(player, pet);
  }
  api.emitCustomEvent("persistence:save", { player, reason: "beaver-form" });
}

function metamorphose(player, current, target) {
  const next = nextForm(player, current);
  if (!next) {
    if (unlocks(player).length === 0) showLocked(player);
    else player.sendMessage(CANT_CHANGE);
    return;
  }
  become(player, next, target);
  player.sendMessage(TRANSFORMED);
}

/** Inventory Metamorphosis on any beaver form's item. */
function itemMetamorphosis(event) {
  const current = formByItem.get(event.itemId);
  if (!current) return false;
  metamorphose(event.player, current, { slot: event.slot });
  return true;
}

/** pets:interact: the follower's own Metamorphosis, before the generic morph. */
function interact(event) {
  if (event.handled || String(event.action).toLowerCase() !== "metamorphosis") return;
  const current = formByNpc.get(event.pet?.petId);
  if (!current) return;
  event.handled = true;
  metamorphose(event.player, current, { npc: event.npc });
}

/** A funky log, pheasant egg, fox whistle or log used on a beaver form (item or follower). */
function use(player, usedId, usedSlot, current, target) {
  const unlock = unlockByItem.get(usedId);
  if (unlock) {
    if (unlocked(player, unlock.unlock)) {
      player.sendMessage(CANT_CHANGE);
      return true;
    }
    removeOne(player, usedId, usedSlot);
    player.setAttribute(UNLOCKS_ATTRIBUTE, [...unlocks(player), unlock.unlock]);
    player.sendMessage(unlock.line);
    api.emitCustomEvent("persistence:save", { player, reason: "beaver-unlock" });
    return true;
  }
  const colour = formByLog.get(usedId);
  // Live answers a log on a beaver that can't change colour with the engine's "Nothing interesting happens."
  if (!colour || !unlocked(player, "colours")) return false;
  if (colour.key === current.key) {
    player.sendMessage(CANT_CHANGE);
    return true;
  }
  removeOne(player, usedId, usedSlot);
  become(player, colour, target);
  player.sendMessage(TRANSFORMED);
  return true;
}

function itemOnItem(event) {
  if (event.handled) return;
  const sides = [
    [event.usedItemId, event.usedItemSlot, event.usedWithItemId, event.usedWithItemSlot],
    [event.usedWithItemId, event.usedWithItemSlot, event.usedItemId, event.usedItemSlot],
  ];
  for (const [usedId, usedSlot, beaverId, beaverSlot] of sides) {
    const current = formByItem.get(beaverId);
    if (!current || formByItem.has(usedId)) continue;
    if (use(event.player, usedId, usedSlot, current, { slot: beaverSlot })) event.handled = true;
    return;
  }
}

function itemOnNpc(event) {
  if (event.handled || !event.target) return;
  const current = formByNpc.get(event.target.getId());
  if (!current || !services.isOwnFollower(event.player, event.target)) return;
  if (use(event.player, event.itemId, event.slot, current, { npc: event.target })) event.handled = true;
}

function attach(pluginApi, helpers) {
  api = pluginApi; services = helpers;
  api.persistAttribute(UNLOCKS_ATTRIBUTE, []);
  api.onCustomEvent("pets:interact", interact);
  api.onItemOnItem(itemOnItem, { noted: false });
  api.onItemOnNpc(itemOnNpc, { noted: false });
  for (const name of ["Beaver", "Pheasant", "Fox"]) api.onItemAction(name, { Metamorphosis: itemMetamorphosis });
}

module.exports = { UNLOCKS_ATTRIBUTE, LOCKED_TEXT, FORMS, rows, attach, nextForm };
