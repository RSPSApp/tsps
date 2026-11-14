/**
 * West Ardougne civilians buy cats for Death runes (Wiki "Civilian", "Cat"): adult, overgrown, wily, lazy
 * and hell cats, 100 Death runes each, or 200 once the Ardougne easy diary is complete. A kitten and the
 * Witch's cat are refused. The sale is the same from "use the cat on a civilian" and from Talk-to.
 *
 * Words come from the generated civilian transcript, read through "npc-dialogue:start" (the same select
 * the treasure trails use): the receipt is its step gRYTQp with "[100/200]" filled in. The step ids below
 * are the transcript's, and nothing here is hand-written dialogue. The sellable set is the pet table's
 * (Pets: "pets:definitions"), so the same cat ids are the ones Pets already tracks.
 */

const CIVILIAN_VARIANT = "using-a-cat-on-the-civilian";
const RECEIPT_STEP = "gRYTQp";
const RECEIVE_STEP = "s3pDQD";
const PRICE_TOKEN = "[100/200]";
const BASE_PRICE = 100;
const DIARY_PRICE = 200;
// Talk-to condition steps (the generated civilian variants 1-3, by their written condition text).
const NO_CAT_STEPS = new Set(["ADBD2l", "qiI7U-", "Uupep7"]);
const HAS_CAT_STEPS = new Set(["D84Vce", "afUrcQ", "ZMFVmW"]);
const WITCH_CAT_STEPS = new Set(["Fqq4ma", "p8ihOR", "_mI9ZL"]);
// Only cats of the adult-or-later families sell; the enum names are the pet table's (Pets).
const SELLABLE_ENUM = /^(PET_CAT|OVERGROWN_CAT|OVERGROWN_HELLCAT|HELLCAT|WILY_CAT|WILY_HELLCAT|LAZY_CAT|LAZY_HELLCAT)/;

function civilianIds(core) {
  const ids = core.NpcIdentifiers;
  return new Set([ids.CIVILIAN, ids.CIVILIAN_2, ids.CIVILIAN_3]);
}

function sellableCatIds(api) {
  const request = { pets: [] };
  api.emitCustomEvent("pets:definitions", request);
  return request.pets.filter((pet) => SELLABLE_ENUM.test(pet.enumName)).map((pet) => pet.itemId);
}

function witchCatIds(core) {
  return [core.ItemIdentifiers.WITCHS_CAT, core.ItemIdentifiers.WITCHS_CAT_2];
}

function priceFor(api, player) {
  const request = { player, diary: "ardougne", tier: "easy", complete: false };
  api.emitCustomEvent("diary:is-complete", request);
  return request.complete === true ? DIARY_PRICE : BASE_PRICE;
}

/** The receipt step's text from the transcript, with the price filled in; null if the transcript has none. */
function receiptText(api, player, npc, npcId, price) {
  let text = null;
  api.emitCustomEvent("npc-dialogue:start", {
    player, npc, npcId, variant: CIVILIAN_VARIANT, exact: true, handled: false,
    select: (steps) => {
      const step = Array.isArray(steps) ? steps.find((candidate) => candidate?.id === RECEIPT_STEP) : null;
      if (step && typeof step.text === "string") text = step.text.replace(PRICE_TOKEN, String(price));
      return [];
    },
  });
  return text;
}

/**
 * One sale of `catItemId` to the civilian. The cat leaves first, so a full bag frees the slot the runes need;
 * if the runes still do not fit, the cat goes back and nothing else changes (conservation).
 */
function sell(api, player, npc, npcId, catItemId) {
  const inventory = player.getInventory();
  if (inventory.getAmount(catItemId) < 1) return false;
  const price = priceFor(api, player);
  inventory.deleteNumber(catItemId, 1);
  const runes = new api.core.Item(api.core.ItemIdentifiers.DEATH_RUNE, price);
  if (inventory.getAddableAmount(runes) < price) {
    inventory.adds(catItemId, 1);
    return false;
  }
  inventory.adds(api.core.ItemIdentifiers.DEATH_RUNE, price);
  const text = receiptText(api, player, npc, npcId, price);
  if (text) player.sendMessage(text);
  return true;
}

function handleItemOnCivilian(api, event) {
  const { player, target, itemId } = event;
  if (!player || !target || !civilianIds(api.core).has(target.getId())) return;
  if (!sellableCatIds(api).includes(itemId)) return;
  event.handled = sell(api, player, target, target.getId(), itemId);
}

function heldSellableCat(api, player) {
  const inventory = player.getInventory();
  return sellableCatIds(api).find((id) => inventory.getAmount(id) > 0) ?? null;
}

function heldWitchCat(api, player) {
  const inventory = player.getInventory();
  return witchCatIds(api.core).some((id) => inventory.getAmount(id) > 0);
}

function conditionAnswer(api, event) {
  const { player, npc, stepId } = event;
  if (!player || !npc || !civilianIds(api.core).has(npc.getId())) return undefined;
  if (HAS_CAT_STEPS.has(stepId)) return heldSellableCat(api, player) !== null;
  if (WITCH_CAT_STEPS.has(stepId)) return heldWitchCat(api, player);
  if (NO_CAT_STEPS.has(stepId)) return heldSellableCat(api, player) === null && !heldWitchCat(api, player);
  return undefined;
}

function handleReceive(api, event) {
  const { player, npc, stepId } = event;
  if (stepId !== RECEIVE_STEP || !player || !npc || !civilianIds(api.core).has(npc.getId())) return;
  const catItemId = heldSellableCat(api, player);
  if (catItemId === null) return;
  event.handled = sell(api, player, npc, npc.getId(), catItemId);
}

module.exports = {
  name: "CivilianCats",
  description: "West Ardougne civilians buy adult, overgrown, wily, lazy and hell cats for 100 Death runes (200 after the Ardougne easy diary), by use-on-civilian and Talk-to.",
  members: true,
  dependsOn: ["Pets"],
  register(api) {
    api.onItemOnNpc(handleItemOnCivilian.bind(null, api));
    api.onNpcDialogueCondition(conditionAnswer.bind(null, api));
    api.onCustomEvent("npc-dialogue:action", handleReceive.bind(null, api));
  },
  _test: {
    CIVILIAN_VARIANT, RECEIPT_STEP, RECEIVE_STEP, NO_CAT_STEPS, HAS_CAT_STEPS, WITCH_CAT_STEPS,
    civilianIds, sellableCatIds, priceFor, receiptText, sell, handleItemOnCivilian, conditionAnswer, handleReceive,
  },
};
