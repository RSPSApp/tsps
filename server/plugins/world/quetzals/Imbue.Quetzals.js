/**
 * Soar Leader Pitri's Perfected quetzal whistle(i) (Wiki: Perfected quetzal whistle, "An imbued
 * perfected whistle with unlimited charges can be obtained by giving Soar Leader Pitri 10,000
 * charges worth of hunter meat while in possession of a perfected whistle ... they can be in the
 * form of banknotes, and in partial amounts ... she will prioritize taking lower charge meats. Once
 * obtained, subsequent imbued whistles can be purchased from Pitri for 50,000 coins each";
 * Transcript:Soar Leader Pitri). Her generated transcript carries the words; this unit answers its
 * conditions, takes the meat, fills in "[number]" and hands the whistles over:
 * - "Can I get a whistle with unlimited charges?" until she has had any food, then "I have some
 *   more food for the birds." until the 10,000 are in; without a perfected whistle in the
 *   inventory she says so instead (rsprox 237/1104 and 237/4003, a line the Wiki lacks);
 * - the 10,000th charge upgrades the inventory's perfected whistle in its slot (the first one is
 *   free); after that "Can I get a Perfected quetzal whistle with unlimited charges?" sells
 *   another for 50,000 coins.
 */
const Common = require("./Common.Quetzals");

const PITRI = "Soar Leader Pitri";
const FED_ATTRIBUTE = "quetzals:imbue-charges-fed";
const RECEIVED_ATTRIBUTE = "quetzals:imbued-whistle-received";
const NEEDED = 10_000;
const PRICE = 50_000;
const PERFECTED = "hg_quetzalwhistle_perfected";
const IMBUED = "hg_quetzalwhistle_perfected_infinite";

const ASK_OPTION = "Can I get a whistle with unlimited charges?";
const MORE_FOOD_OPTION = "I have some more food for the birds.";
/** rsprox 237/1104: her answer to the question without a perfected whistle. */
const NO_WHISTLE_LINE = "I would be happy to offer you the potential to upgrade a Perfected quetzal whistle, but it seems you do not have one. Ask me again when you have obtained one.";
const STILL_NEED_LINE = "Thanks for the feed, you still need to give me another [number] charges worth of food for the birds.";
const DONE_LINE = "Thanks for all the food, I'll be glad to give you a whistle with infinite charges.";
const BOUGHT_LINE = "Here you go, one Perfected quetzal whistle with unlimited charges.";

const isPitri = (definition) => definition?.getName?.() === PITRI;
const fed = (player) => Math.max(0, Number(player.getAttribute(FED_ATTRIBUTE)) || 0);
const remaining = (player) => Math.max(0, NEEDED - fed(player));
const received = (player) => player.getAttribute(RECEIVED_ATTRIBUTE) === true;
const perfectedSlot = (player) => player.getInventory().getItems().findIndex((item) => item?.getId?.() === Common.obj(PERFECTED));

/** The inventory's hunter meat and quetzal feed, banknotes too, lowest charges first. */
function meatForms() {
  const forms = [];
  for (const [name, charges] of Object.entries(Common.data.meatCharges)) {
    const id = Common.obj(name);
    if (id == null || id < 0) continue;
    forms.push({ id, charges });
    const noted = Common.core.ItemDefinition?.forId?.(id)?.getNoteId?.();
    if (Number.isInteger(noted) && noted > 0 && noted !== id) forms.push({ id: noted, charges });
  }
  return forms.sort((a, b) => a.charges - b.charges);
}

/** Takes meat until the 10,000 are in (a last piece may go over); true when any was taken. */
function feed(player) {
  const inventory = player.getInventory();
  let left = remaining(player);
  let given = 0;
  for (const { id, charges } of meatForms()) {
    if (left <= 0) break;
    const take = Math.min(inventory.getAmount(id), Math.ceil(left / charges));
    if (take <= 0) continue;
    inventory.delete(id, take);
    given += take * charges;
    left -= take * charges;
  }
  if (!given) return false;
  inventory.refreshItems?.();
  player.setAttribute(FED_ATTRIBUTE, Math.min(NEEDED, fed(player) + given));
  return true;
}

/** The perfected whistle becomes the imbued one in its slot (the first one is free). */
function upgrade(player) {
  if (received(player) || remaining(player) > 0) return;
  const slot = perfectedSlot(player);
  if (slot < 0) return;
  const inventory = player.getInventory();
  inventory.setItem(slot, new Common.core.Item(Common.obj(IMBUED), 1));
  inventory.refreshItems?.();
  player.setAttribute(RECEIVED_ATTRIBUTE, true);
}

function answer({ player, definition, text }) {
  if (!isPitri(definition)) return null;
  const value = String(text ?? "").trim();
  if (value === "First time:") return !received(player) && fed(player) === 0;
  if (value === "Subsequent times:") return !received(player) && fed(player) > 0;
  if (/has received the perfected quetzal whistle\(i\)/i.test(value)) return received(player);
  // Her two answers to "Yes." on the first-time question: the turn-in happens on the first.
  if (/turns in less than 10,000 charges/i.test(value)) {
    feed(player);
    return remaining(player) > 0;
  }
  if (/has turned in 10,000 charges/i.test(value)) return remaining(player) === 0;
  if (/has less than 50,000 coins/i.test(value)) return player.getInventory().getAmount(Common.core.ItemIdentifiers.COINS) < PRICE;
  if (/has at least 50,000 coins/i.test(value)) return player.getInventory().getAmount(Common.core.ItemIdentifiers.COINS) >= PRICE;
  return null;
}

/** Without a perfected whistle in the inventory, the question gets her recorded refusal. */
function choose(choice) {
  if (!isPitri(choice.definition) || ![ASK_OPTION, MORE_FOOD_OPTION].includes(choice.option)) return;
  if (perfectedSlot(choice.player) >= 0) return;
  const { DialogueChainBuilder, PlayerDialogue, NpcDialogue } = Common.core;
  const npcId = choice.definition.getId?.() ?? choice.npcId;
  choice.end = true;
  choice.player.getDialogueManager().startDialogues(new DialogueChainBuilder()
    .add(new PlayerDialogue(0, choice.option === ASK_OPTION ? ASK_OPTION : MORE_FOOD_OPTION))
    .add(new NpcDialogue(1, npcId, NO_WHISTLE_LINE)));
}

function line(request) {
  if (!isPitri(request.definition) || typeof request.text !== "string") return;
  const { player } = request;
  if (request.text === STILL_NEED_LINE) {
    request.text = STILL_NEED_LINE.replace("[number]", remaining(player).toLocaleString("en-US"));
  } else if (request.text.startsWith(DONE_LINE)) {
    // "I have some more food for the birds." -> "Yes." has only this line: the turn-in is here.
    feed(player);
    if (remaining(player) > 0) {
      request.text = STILL_NEED_LINE.replace("[number]", remaining(player).toLocaleString("en-US"));
      return;
    }
    if (perfectedSlot(player) < 0 && !received(player)) return;
    request.before = () => upgrade(player);
  } else if (request.text === BOUGHT_LINE) {
    const inventory = player.getInventory();
    const { COINS } = Common.core.ItemIdentifiers;
    const whistle = new Common.core.Item(Common.obj(IMBUED), 1);
    const room = inventory.getAddableAmount(whistle) >= 1 || inventory.getAmount(COINS) === PRICE;
    if (!received(player) || inventory.getAmount(COINS) < PRICE || !room) {
      request.skip = true;
      if (!room) inventory.full();
      return;
    }
    request.before = () => buy(player);
  }
}

/** 50,000 coins for another imbued whistle, checked again as the line shows. */
function buy(player) {
  const inventory = player.getInventory();
  const { COINS } = Common.core.ItemIdentifiers;
  const whistle = new Common.core.Item(Common.obj(IMBUED), 1);
  if (!received(player) || inventory.getAmount(COINS) < PRICE) return;
  if (inventory.getAddableAmount(whistle) < 1 && inventory.getAmount(COINS) !== PRICE) return;
  inventory.delete(COINS, PRICE);
  inventory.add(whistle, true);
}

/** The transcript's "receives a Perfected quetzal whistle(i)": the upgrade on her line before it. */
function receive(action) {
  if (!isPitri(action.definition) || action.action !== "receive" || (action.target ?? action.text) !== "a Perfected quetzal whistle(i)") return;
  action.handled = true;
}

function attach(api) {
  api.persistAttribute(FED_ATTRIBUTE, 0);
  api.persistAttribute(RECEIVED_ATTRIBUTE, false);
  api.onNpcDialogueCondition(answer);
  api.onCustomEvent("npc-dialogue:choice", choose);
  api.onCustomEvent("npc-dialogue:line", line);
  api.onCustomEvent("npc-dialogue:action", receive);
}

module.exports = { attach, answer, choose, line, feed, upgrade, buy, receive, FED_ATTRIBUTE, RECEIVED_ATTRIBUTE, NO_WHISTLE_LINE };
