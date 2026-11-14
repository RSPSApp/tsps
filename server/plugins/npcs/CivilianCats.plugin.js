/**
 * West Ardougne civilians buy cats for Death runes (Wiki "Civilian", "Cat"): adult, overgrown, wily, lazy
 * and hell cats, 100 Death runes each, or 200 once the Ardougne easy diary is complete. A kitten and the
 * Witch's cat are refused. "Use the cat on a civilian" and Talk-to are one sale.
 *
 * The words are the generated civilian transcript's (npc-dialogues.json, read-only). NpcDialogues plays it:
 * - "use the cat on the civilian" starts the variant "using-a-cat-on-the-civilian" with "npc-dialogue:start"
 *   (exact), and the runtime plays its steps in order: the receipt message (gRYTQp), the receive action
 *   (s3pDQD, which sells here), then the closing lines.
 * - the receipt message's text gets the real price before the runtime sends it. The runtime's own gendered
 *   "[100/200]" rewrite never sees the token, because it is replaced first.
 * The sellable set is the pet table's ("pets:definitions"); the price is 200 once "diary:is-complete" says the
 * Ardougne easy diary is done. The diary answer is soft: with no diary answer the price is 100.
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
// Only cats of the adult-or-later families sell; these enum names are the pet table's (Pets).
const SELLABLE_ENUM = /^(PET_CAT|OVERGROWN_CAT|OVERGROWN_HELLCAT|HELLCAT|WILY_CAT|WILY_HELLCAT|LAZY_CAT|LAZY_HELLCAT)/;
// The cat the item route is using, carried to the receive step that the started variant plays.
const PENDING_ATTRIBUTE = "civilian-cats:pending";

function civilianIds(core) {
  const ids = core.NpcIdentifiers;
  return new Set([ids.CIVILIAN, ids.CIVILIAN_2, ids.CIVILIAN_3]);
}

function isCivilian(core, npc) {
  return !!npc && civilianIds(core).has(npc.getId());
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

function heldSellableCat(api, player) {
  const inventory = player.getInventory();
  return sellableCatIds(api).find((id) => inventory.getAmount(id) > 0) ?? null;
}

function heldWitchCat(api, player) {
  const inventory = player.getInventory();
  return witchCatIds(api.core).some((id) => inventory.getAmount(id) > 0);
}

/** The cat this sale is for: the item route's cat if it is still held, else a held sellable cat. */
function saleCat(api, player) {
  const pending = player.getAttribute(PENDING_ATTRIBUTE);
  if (pending != null && player.getInventory().getAmount(pending) > 0) return pending;
  return heldSellableCat(api, player);
}

/**
 * The sale itself, at the receive step. The cat leaves first, so a full bag frees the slot the runes need;
 * if the runes still do not fit, the cat goes back and nothing else changes (conservation).
 */
function sell(api, player) {
  const catItemId = saleCat(api, player);
  player.setAttribute(PENDING_ATTRIBUTE, null);
  if (catItemId === null) return false;
  const inventory = player.getInventory();
  const price = priceFor(api, player);
  inventory.deleteNumber(catItemId, 1);
  const runes = new api.core.Item(api.core.ItemIdentifiers.DEATH_RUNE, price);
  if (inventory.getAddableAmount(runes) < price) {
    inventory.adds(catItemId, 1);
    return false;
  }
  inventory.adds(api.core.ItemIdentifiers.DEATH_RUNE, price);
  return true;
}

/**
 * The item route: the cat is used on a civilian. Nothing is sold here; the variant starts, and its receive
 * step sells. An unstarted variant (the runtime refused it) sells nothing and leaves the use unhandled.
 */
function handleItemOnCivilian(api, event) {
  const { player, target, itemId } = event;
  if (!player || !isCivilian(api.core, target)) return;
  if (!sellableCatIds(api).includes(itemId) || player.getInventory().getAmount(itemId) < 1) return;
  player.setAttribute(PENDING_ATTRIBUTE, itemId);
  const start = { player, npc: target, npcId: target.getId(), variant: CIVILIAN_VARIANT, exact: true, handled: false };
  api.emitCustomEvent("npc-dialogue:start", start);
  event.handled = start.handled === true;
  if (!event.handled) player.setAttribute(PENDING_ATTRIBUTE, null);
}

/**
 * The receipt message, before the runtime sends it. With a sellable cat to sell, the text gets the real price;
 * with none, the receipt is suppressed (handled), so no price is shown for a sale that cannot happen. The
 * runtime's text is replaced only for this step and this civilian.
 */
function handleReceiptMessage(api, event) {
  const { player, npc, stepId, kind } = event;
  if (kind !== "message" || stepId !== RECEIPT_STEP || !player || !isCivilian(api.core, npc)) return;
  if (saleCat(api, player) === null) {
    event.handled = true;
    return;
  }
  event.text = String(event.text ?? "").replace(PRICE_TOKEN, String(priceFor(api, player)));
}

function conditionAnswer(api, event) {
  const { player, npc, stepId } = event;
  if (!player || !isCivilian(api.core, npc)) return undefined;
  if (HAS_CAT_STEPS.has(stepId)) return heldSellableCat(api, player) !== null;
  if (WITCH_CAT_STEPS.has(stepId)) return heldWitchCat(api, player);
  if (NO_CAT_STEPS.has(stepId)) return heldSellableCat(api, player) === null && !heldWitchCat(api, player);
  return undefined;
}

/** The receive step: the transcript's sale, only when a sellable cat can be sold. */
function handleReceive(api, event) {
  const { player, npc, stepId } = event;
  if (stepId !== RECEIVE_STEP || !player || !isCivilian(api.core, npc)) return;
  event.handled = sell(api, player);
}

module.exports = {
  name: "CivilianCats",
  description: "West Ardougne civilians buy adult, overgrown, wily, lazy and hell cats for 100 Death runes (200 after the Ardougne easy diary), by use-on-civilian and Talk-to.",
  members: true,
  dependsOn: ["Pets"],
  register(api) {
    api.onItemOnNpc(handleItemOnCivilian.bind(null, api));
    api.onNpcDialogueCondition(conditionAnswer.bind(null, api));
    api.onCustomEvent("npc-dialogue:action", (event) => {
      if (event.kind === "message") handleReceiptMessage(api, event);
      else handleReceive(api, event);
    });
  },
  _test: {
    CIVILIAN_VARIANT, RECEIPT_STEP, RECEIVE_STEP, PRICE_TOKEN, NO_CAT_STEPS, HAS_CAT_STEPS, WITCH_CAT_STEPS,
    PENDING_ATTRIBUTE, civilianIds, sellableCatIds, priceFor, saleCat, sell, handleItemOnCivilian,
    handleReceiptMessage, conditionAnswer, handleReceive,
  },
};
