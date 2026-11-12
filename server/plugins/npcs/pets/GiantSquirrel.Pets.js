"use strict";

/**
 * The giant squirrel's forms (Wiki: Giant Squirrel, Dark acorn, Calcified acorn).
 *
 * - "Players can also permanently unlock the ability to metamorph the giant squirrel by using certain
 *   items on them": a dark acorn turns it dark and a calcified acorn turns it skeletal, each consumed.
 *   The squirrel eats them immediately, so the item in the inventory, or the follower, becomes that
 *   form, and the form stays unlocked for later Metamorphoses.
 * - The Wiki's conversion lines are the messages: "The squirrel happily eats the dark acorn and
 *   magically turns into a darker colour. How unexpected." and "The squirrel carefully crunches the
 *   calcified acorn and magically turns into a skeleton. Whoops!"; a calcified acorn on a bone squirrel
 *   answers "Your squirrel has had enough of those. It doesn't get more skeletal than this.".
 * - Every form is its own item and follower in the cache (skillpetagility, skillpetagility_dark,
 *   skillpetagility_bone; skillpet_agility, skillpet_agility_dark, skillpet_agility_bone), so the item
 *   in the inventory, or the follower, changes to the new form.
 *
 * Ours: no capture shows the Metamorphosis click itself. Once a form is unlocked, Metamorphosis cycles
 * the Wiki's order (Giant -> Dark -> Bone) through the unlocked forms for free, like the other pets'
 * metamorphoses; the locked message uses the "You need ... to metamorphose your pet like that." wording
 * the generic morph uses. A dark acorn on an already-dark squirrel uses the generic refusal, as the Wiki
 * only records the bone one.
 */

const UNLOCKS_ATTRIBUTE = "pets:giant-squirrel-unlocks";
const TRANSFORMED = "Your pet endures metamorphosis and transforms.";
const CANT_CHANGE = "Your pet can't change like that.";
const LOCKED = "You need a dark acorn or a calcified acorn to metamorphose your pet like that.";

/** The Wiki's variant table, with each form's cache gameval names and the acorn that changes it. */
const FORMS = [
  { key: "giant", itemGameval: "skillpetagility", npcGameval: "skillpet_agility", houseGameval: "poh_skillpet_agility" },
  { key: "dark", itemGameval: "skillpetagility_dark", npcGameval: "skillpet_agility_dark", houseGameval: "poh_skillpet_agility_dark",
    acornGameval: "dark_acorn", line: "The squirrel happily eats the dark acorn and magically turns into a darker colour. How unexpected." },
  { key: "bone", itemGameval: "skillpetagility_bone", npcGameval: "skillpet_agility_bone", houseGameval: "poh_skillpet_agility_bone",
    acornGameval: "calcified_acorn", line: "The squirrel carefully crunches the calcified acorn and magically turns into a skeleton. Whoops!",
    refused: "Your squirrel has had enough of those. It doesn't get more skeletal than this." },
];
/** Metamorphosis goes round these, skipping locked ones; the giant form is always available. */
const CYCLE = ["giant", "dark", "bone"];

let api;
let services;
const formByItem = new Map();
const formByNpc = new Map();
const formByAcorn = new Map();

/** The PETS rows for every form but the base one, which Pets.plugin already lists as GIANT_SQUIRREL. */
function rows(base, cache) {
  formByItem.clear(); formByNpc.clear(); formByAcorn.clear();
  const added = [];
  for (const form of FORMS) {
    const itemId = cache.getObjId(form.itemGameval);
    const petId = cache.getNpcId(form.npcGameval);
    if (!Number.isInteger(itemId) || !Number.isInteger(petId)) continue;
    const houseNpcId = cache.getNpcId(form.houseGameval);
    const entry = { ...form, itemId, petId, houseNpcId };
    formByItem.set(itemId, entry);
    formByNpc.set(petId, entry);
    const acornId = form.acornGameval ? cache.getObjId(form.acornGameval) : null;
    if (Number.isInteger(acornId)) formByAcorn.set(acornId, entry);
    if (petId === base.petId) continue;
    added.push({ ...base, enumName: `GIANT_SQUIRREL_${form.key.toUpperCase()}`, petId, houseNpcId, itemId, chance: undefined });
  }
  return added;
}

function unlocks(player) {
  const stored = player.getAttribute(UNLOCKS_ATTRIBUTE);
  return Array.isArray(stored) ? stored : [];
}

function unlocked(player, key) {
  return key === "giant" || unlocks(player).includes(key);
}

function form(key) {
  return [...formByItem.values()].find((entry) => entry.key === key);
}

/** The next unlocked form round the cycle, or null when there is nowhere else to go. */
function nextForm(player, current) {
  const at = Math.max(0, CYCLE.indexOf(current.key));
  for (let step = 1; step < CYCLE.length; step++) {
    const key = CYCLE[(at + step) % CYCLE.length];
    if (unlocked(player, key)) return key === current.key ? null : form(key);
  }
  return null;
}

/** The used item, from the slot it was used from when that slot still holds it. */
function removeOne(player, itemId, slot) {
  const inventory = player.getInventory();
  if (Number.isInteger(slot) && inventory.get(slot)?.getId?.() === itemId) inventory.deleteAtSlot(slot, 1);
  else inventory.deleteNumber(itemId, 1);
}

/** Turns the squirrel item in `slot` into `next`, or the follower `npc` when there is no slot. */
function become(player, next, { slot, npc }) {
  const pet = services.getPetForItemId(next.itemId);
  if (npc) {
    services.transformFollower(player, npc, pet);
  } else {
    player.getInventory().setItem(slot, new api.core.Item(next.itemId, 1));
    player.getInventory().refreshItems();
    // The stored variant follows the item too, or the next summon would bring back the old form.
    services.setStoredVariant(player, pet, next.petId);
    services.recordOwnership(player, pet);
  }
  api.emitCustomEvent("persistence:save", { player, reason: "giant-squirrel-form" });
}

function metamorphose(player, current, target) {
  const next = nextForm(player, current);
  if (!next) {
    player.sendMessage(unlocks(player).length === 0 ? LOCKED : CANT_CHANGE);
    return;
  }
  become(player, next, target);
  player.sendMessage(TRANSFORMED);
}

/** pets:interact: the follower's own Metamorphosis, before the generic morph. */
function interact(event) {
  if (event.handled || String(event.action).toLowerCase() !== "metamorphosis") return;
  const current = formByNpc.get(event.pet?.petId);
  if (!current) return;
  event.handled = true;
  metamorphose(event.player, current, { npc: event.npc });
}

/** A dark or calcified acorn used on a squirrel form (item or follower). */
function use(player, usedId, usedSlot, current, target) {
  const acorn = formByAcorn.get(usedId);
  if (!acorn) return false;
  if (current.key === acorn.key) {
    player.sendMessage(acorn.refused ?? CANT_CHANGE);
    return true;
  }
  removeOne(player, usedId, usedSlot);
  if (!unlocked(player, acorn.key)) {
    player.setAttribute(UNLOCKS_ATTRIBUTE, [...unlocks(player), acorn.key]);
  }
  become(player, acorn, target);
  player.sendMessage(acorn.line);
  return true;
}

function itemOnItem(event) {
  if (event.handled) return;
  const sides = [
    [event.usedItemId, event.usedItemSlot, event.usedWithItemId, event.usedWithItemSlot],
    [event.usedWithItemId, event.usedWithItemSlot, event.usedItemId, event.usedItemSlot],
  ];
  for (const [usedId, usedSlot, squirrelId, squirrelSlot] of sides) {
    const current = formByItem.get(squirrelId);
    if (!current || formByItem.has(usedId)) continue;
    if (use(event.player, usedId, usedSlot, current, { slot: squirrelSlot })) event.handled = true;
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
}

module.exports = { UNLOCKS_ATTRIBUTE, LOCKED, FORMS, rows, attach, nextForm };
