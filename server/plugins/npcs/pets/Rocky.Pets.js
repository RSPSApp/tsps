"use strict";

/**
 * Rocky's forms (Wiki: Rocky): "When Redberries are used, it will change to a red panda named Red",
 * poison ivy berries make the tanuki Ziggy, and "Using white berries on him will cause him to revert
 * to his original raccoon form." Each form is its own item and follower in the cache (skillpetthieving,
 * skillpetthieving_panda, skillpetthieving_tanuki; skillpet_thieving_panda, skillpet_thieving_tanuki),
 * so the follower, and the item it is picked up as, become that form. Each talks with its own section
 * of Transcript:Rocky.
 *
 * Ours (no recording, and the Wiki says neither): the change is silent and the berry is kept. A berry
 * used on the form it already makes is left to the default response.
 */

/** The forms besides Rocky's own row, with each one's cache gameval names and its transcript section. */
const FORMS = [
  { key: "red", itemGameval: "skillpetthieving_panda", npcGameval: "skillpet_thieving_panda",
    houseGameval: "poh_skillpet_thieving_panda", dialogueVariant: "red-panda-dialogue" },
  { key: "ziggy", itemGameval: "skillpetthieving_tanuki", npcGameval: "skillpet_thieving_tanuki",
    houseGameval: "poh_skillpet_thieving_tanuki", dialogueVariant: "tanuki-dialogue" },
];
/** Which berry makes which form ("rocky": his own row). */
const BERRIES = [
  { berryGameval: "redberries", key: "red" },
  { berryGameval: "poisonivy_berries", key: "ziggy" },
  { berryGameval: "white_berries", key: "rocky" },
];

let services;
/** Each form's PETS row, by key, and the form each follower id and berry is. */
const rowByKey = new Map();
const keyByNpc = new Map();
const keyByBerry = new Map();

/** The PETS rows for Red and Ziggy, from Rocky's own (`base`). */
function rows(base, cache) {
  rowByKey.clear(); keyByNpc.clear(); keyByBerry.clear();
  if (!base) return [];
  rowByKey.set("rocky", base);
  keyByNpc.set(base.petId, "rocky");
  const added = [];
  for (const form of FORMS) {
    const itemId = cache.getObjId(form.itemGameval);
    const petId = cache.getNpcId(form.npcGameval);
    if (!Number.isInteger(itemId) || !Number.isInteger(petId)) continue;
    const houseNpcId = cache.getNpcId(form.houseGameval);
    const row = { ...base, enumName: `ROCKY_${form.key.toUpperCase()}`, petId, houseNpcId, itemId,
      dialogueVariant: form.dialogueVariant, chance: undefined };
    rowByKey.set(form.key, row);
    keyByNpc.set(petId, form.key);
    added.push(row);
  }
  for (const { berryGameval, key } of BERRIES) {
    const berryId = cache.getObjId(berryGameval);
    if (Number.isInteger(berryId)) keyByBerry.set(berryId, key);
  }
  return added;
}

/** A berry used on the player's own Rocky, Red or Ziggy: the follower changes form. */
function itemOnNpc(event) {
  if (event.handled || !event.target) return;
  const current = keyByNpc.get(event.target.getId());
  const next = keyByBerry.get(Number(event.itemId));
  if (current == null || next == null || next === current) return;
  if (!services.isOwnFollower(event.player, event.target)) return;
  const row = rowByKey.get(next);
  if (!row) return;
  event.handled = true;
  services.transformFollower(event.player, event.target, row);
}

function attach(api, helpers) {
  services = helpers;
  api.onItemOnNpc(itemOnNpc, { noted: false });
}

module.exports = { FORMS, BERRIES, rows, attach, itemOnNpc };
