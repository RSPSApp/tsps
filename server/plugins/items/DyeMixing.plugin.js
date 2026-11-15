/**
 * Mixing two primary dyes into a secondary one (docs/dye-mixing.md).
 *
 * rsprox captures: red and yellow make orange (227/00090 t5349, local 1000216 t511, 1000218 t1413,
 * 1000359 t8917), blue and yellow make green (232/03198 t6731), red and blue make purple (242/900302
 * t749). Either way round: the player plays mixing_dyes_<pair>, "You mix the two dyes and make a(n)
 * <colour> one." comes as a spam message, and the lower of the two slots holds the new dye while the
 * higher one empties, all on the same tick. 227/00090 (used 7 on 8, result 7), 232/03198 (used 15 on
 * 14, result 14) and the three local orange ones (used 8/10/16 on 7/7/14) all fit the lower slot,
 * whichever dye was clicked first.
 */
const MIXES = [
  { dyes: ["Red dye", "Yellow dye"], result: "orangedye", seq: "mixing_dyes_red+yellow", colour: "an orange" },
  { dyes: ["Blue dye", "Yellow dye"], result: "greendye", seq: "mixing_dyes_blue+yellow", colour: "a green" },
  { dyes: ["Red dye", "Blue dye"], result: "purpledye", seq: "mixing_dyes_red+blue", colour: "a purple" },
];

let core = null;

function cacheId(kind, name) {
  const id = kind === "seq" ? core.CacheDefinitions.getSeqId(name) : core.CacheDefinitions.getObjId(name);
  if (!Number.isInteger(id)) throw new Error(`[DyeMixing] unknown ${kind} gameval ${name}`);
  return id;
}

/** `slot` if it still holds `id`, else the first slot that does (-1: none). */
function heldSlot(inventory, slot, id) {
  const items = inventory.getItems();
  if (Number.isInteger(slot) && items[slot]?.getId?.() === id && items[slot].getAmount() > 0) return slot;
  return items.findIndex((item) => item?.getId?.() === id && item.getAmount() > 0);
}

function mix(mixture, { player, usedItemId, usedWithItemId, usedItemSlot, usedWithItemSlot }) {
  const inventory = player.getInventory();
  const used = heldSlot(inventory, usedItemSlot, usedItemId);
  const target = heldSlot(inventory, usedWithItemSlot, usedWithItemId);
  if (used < 0 || target < 0 || used === target) return true;
  // The lower slot keeps the result, whichever dye was used on which.
  inventory.deleteAtSlot(Math.max(used, target), 1, false);
  inventory.setItem(Math.min(used, target), new core.Item(cacheId("obj", mixture.result), 1));
  inventory.refreshItems();
  player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, `You mix the two dyes and make ${mixture.colour} one.`);
  player.performAnimation(new core.Animation(cacheId("seq", mixture.seq)));
  return true;
}

const mixOrange = (event) => mix(MIXES[0], event);
const mixGreen = (event) => mix(MIXES[1], event);
const mixPurple = (event) => mix(MIXES[2], event);

module.exports = {
  name: "DyeMixing",
  description: "Mixes red, yellow and blue dyes into orange, green and purple dye.",
  MIXES,
  register(api) {
    core = api.core;
    api.onItemOnItem(...MIXES[0].dyes, mixOrange, { noted: false });
    api.onItemOnItem(...MIXES[1].dyes, mixGreen, { noted: false });
    api.onItemOnItem(...MIXES[2].dyes, mixPurple, { noted: false });
  },
};
