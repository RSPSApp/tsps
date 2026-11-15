/**
 * Mixing two primary dyes into a secondary one (docs/dye-mixing.md).
 *
 * rsprox captures: red and yellow make orange (227/00090 t5349, local 1000216 t511, 1000218 t1413,
 * 1000359 t8917), blue and yellow make green (232/03198 t6731), red and blue make purple (242/900302
 * t749). Either way round: the player plays mixing_dyes_<pair>, "You mix the two dyes and make a(n)
 * <colour> one." comes as a spam message, and on the same tick the first dye of each colour (by id,
 * not the clicked slot) is used up and the new dye goes in the first free slot. 242/900302 shows it:
 * t730 red 8 on yellow 16 spends the first yellow (14) and puts orange in 8; t749 blue 13 on red 9
 * spends the first blue (11) and red (9) and puts purple in the free slot 8. 227/00090 (7 on 8,
 * result 7), 232/03198 (15 on 14, result 14) and local 1000216/1000218/1000359 (8/10/16 on 7/7/14,
 * results 7/7/14) fit the same rule.
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

/** The first slot holding `id` (-1: none). */
function firstSlot(inventory, id) {
  return inventory.getItems().findIndex((item) => item?.getId?.() === id && item.getAmount() > 0);
}

function mix(mixture, { player, usedItemId, usedWithItemId }) {
  const inventory = player.getInventory();
  const used = firstSlot(inventory, usedItemId);
  const target = firstSlot(inventory, usedWithItemId);
  if (used < 0 || target < 0 || used === target) return true;
  // Resolve both ids before touching the inventory, so a gameval drift never eats a dye.
  const resultId = cacheId("obj", mixture.result);
  const seqId = cacheId("seq", mixture.seq);
  // Like inv_del of each dye then inv_add of the result: first slot of each id, first free slot.
  inventory.deleteAtSlot(used, 1, false);
  inventory.deleteAtSlot(target, 1, false);
  inventory.setItem(inventory.getEmptySlot(), new core.Item(resultId, 1));
  inventory.refreshItems();
  player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, `You mix the two dyes and make ${mixture.colour} one.`);
  player.performAnimation(new core.Animation(seqId));
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
