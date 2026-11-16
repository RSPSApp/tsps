/**
 * The Taxidermist in Canifis stuffs monster heads and big fish for the player's house trophy
 * displays, and a stuffed trophy can be unstuffed again from the inventory (docs/taxidermist.md).
 *
 * Using an item on her plays that item's variant of her transcript in npc-dialogues.json: her
 * remark, "I can preserve that for you for N coins.", then (with the coins) "Yes please" / "No
 * thanks". This plugin answers the coin conditions and swaps the head for its stuffed copy, in its
 * own slot, as her "There you go!" is shown. The price is the one her line names.
 *
 * rsprox captures (rec 2617, rev 229): a kurask head used on her at t7780 plays the transcript's
 * lines, the menu, and at "There you go!" takes 6,000 coins and puts the stuffed kurask head in the
 * head's slot. Unstuff (t6388) opens a chat menu titled "Re-stuffing it will cost 6,000 coins."
 * with "Remove the stuffing." / "Cancel"; removing it puts the head back in that slot and shows it
 * in an item box, "You carefully unstuff it." Other trophies' Unstuff titles name their own price;
 * ours, from the same transcript lines.
 */
const TAXIDERMIST_NPC = "poh_taxidermist";
const COINS = "coins";
const PAGE = "Taxidermist";
const VARIANT_PREFIX = "using-items-on-her-";
const VARIANT_OTHER = `${VARIANT_PREFIX}anything-other-than-the-items-below`;
/** The variant whose tail (the coin conditions and her offer) every trophy's "same as above" means. */
const VARIANT_TAIL = `${VARIANT_PREFIX}big-bass`;
const CONDITION_POOR = "If the player does not have enough coins:";
const CONDITION_RICH = "If the player has enough coins:";
const LINE_DONE = "There you go!";
const PRICE_LINE = /^I can preserve that for you for ([\d,]+) coins\.$/;
const UNSTUFF_OPTIONS = ["Remove the stuffing.", "Cancel"];
const UNSTUFF_TEXT = "You carefully unstuff it.";

/** Each trophy's unstuffed item (gameval) and its transcript variant; the stuffed item is `<gameval>_stuffed`. */
const TROPHIES = [
  ["poh_trophydrop_crawlinghand", "crawling-hand"],
  ["poh_trophydrop_cockatrice", "cockatrice-head"],
  ["poh_trophydrop_basilisk", "basilisk-head"],
  ["poh_trophydrop_kurask", "kurask-head"],
  ["poh_trophydrop_abyssaldemon", "abyssal-head"],
  ["poh_trophydrop_kbd", "kbd-heads"],
  ["poh_trophydrop_kalphitequeen", "kq-head"],
  ["poh_pitydrop_kalphitequeen", "kq-head-tattered"],
  ["vorkath_head", "vorkath-s-head"],
  ["poh_alchemical_hydra_head", "alchemical-hydra-heads"],
  ["poh_trophydrop_bass", "big-bass"],
  ["poh_trophydrop_swordfish", "big-swordfish"],
  ["poh_trophydrop_harpoonfish", "big-harpoonfish"],
  ["poh_trophydrop_shark", "big-shark"],
  ["poh_trophydrop_giant_krill", "giant-blue-krill"],
  ["poh_trophydrop_haddock", "golden-haddock"],
  ["poh_trophydrop_yellowfin", "orangefin"],
  ["poh_trophydrop_halibut", "huge-halibut"],
  ["poh_trophydrop_bluefin", "purplefin"],
  ["poh_trophydrop_marlin", "swift-marlin"],
];
/** Items with a remark of their own and nothing to stuff. */
const REMARKS = [["raw_chicken", "raw-chicken"]];

let api = null;
let core = null;
let built = false;
let taxidermistId = -1;
let coinsId = -1;
/** unstuffed item id -> { unstuffed, stuffed, variant, price } */
const byUnstuffed = new Map();
/** stuffed item id -> the same trophy */
const byStuffed = new Map();
/** remark item id -> variant */
const remarks = new Map();
/** player -> { trophy, item, slot } while her offer is open */
const pending = new WeakMap();
let transcript = null;

function variants() {
  if (!transcript) transcript = require("../../data/definitions/npc-dialogues.json")[PAGE]?.variants ?? {};
  return transcript;
}

/** Her lines for a trophy, then the shared tail: the transcript writes "same as above" for every trophy but the bass. */
function offerSteps(trophy) {
  const own = (variants()[trophy.variant] ?? []).filter((step) => typeof step.npc === "string");
  const tail = (variants()[VARIANT_TAIL] ?? []).filter((step) => step.type === "condition");
  return [...own, ...tail];
}

function priceOf(variant) {
  for (const step of variants()[variant] ?? []) {
    const match = typeof step.npc === "string" ? PRICE_LINE.exec(step.npc) : null;
    if (match) return Number(match[1].replace(/,/g, ""));
  }
  return null;
}

/** Built from the cache and the transcript on first use. */
function trophies() {
  if (built) return byStuffed;
  built = true;
  const { CacheDefinitions } = core;
  taxidermistId = CacheDefinitions.getNpcId(TAXIDERMIST_NPC) ?? -1;
  coinsId = CacheDefinitions.getObjId(COINS) ?? -1;
  for (const [gameval, name] of TROPHIES) {
    const unstuffed = CacheDefinitions.getObjId(gameval);
    const stuffed = CacheDefinitions.getObjId(`${gameval}_stuffed`);
    const variant = VARIANT_PREFIX + name;
    const price = priceOf(variant);
    if (!Number.isInteger(unstuffed) || !Number.isInteger(stuffed) || !Number.isInteger(price)) continue;
    const trophy = { unstuffed, stuffed, variant, price };
    byUnstuffed.set(unstuffed, trophy);
    byStuffed.set(stuffed, trophy);
  }
  for (const [gameval, name] of REMARKS) {
    const id = CacheDefinitions.getObjId(gameval);
    if (Number.isInteger(id)) remarks.set(id, VARIANT_PREFIX + name);
  }
  return byStuffed;
}

function play(event, variant, select) {
  const request = { player: event.player, npc: event.target, npcId: taxidermistId, variant, exact: true, select, handled: false };
  api.emitCustomEvent("npc-dialogue:start", request);
  return request.handled;
}

function slotOf(player, item, slot) {
  const items = player.getInventory().getItems();
  return Number.isInteger(slot) && items[slot] === item ? slot : items.indexOf(item);
}

/** An item used on the Taxidermist: a trophy gets her offer, anything else her remark. */
function useOnTaxidermist(event) {
  const { player, item, itemId } = event;
  trophies();
  if (event.npcId !== taxidermistId) return;
  pending.delete(player);
  const trophy = byUnstuffed.get(itemId);
  if (!trophy) {
    event.handled = play(event, remarks.get(itemId) ?? VARIANT_OTHER);
    return;
  }
  pending.set(player, { trophy, item, slot: slotOf(player, item, event.slot) });
  event.handled = play(event, trophy.variant, () => offerSteps(trophy));
  if (!event.handled) pending.delete(player);
}

/** The transcript's coin conditions, for the trophy she is offering to stuff. */
function coinCondition({ player, npcId, text }) {
  if (npcId !== taxidermistId || (text !== CONDITION_POOR && text !== CONDITION_RICH)) return null;
  const offer = pending.get(player);
  if (!offer) return null;
  const enough = player.getInventory().getAmount(coinsId) >= offer.trophy.price;
  return text === CONDITION_RICH ? enough : !enough;
}

/**
 * "There you go!" is where the coins go and the stuffed trophy takes the head's slot: as that line is
 * shown (its `before`), not when "Yes please" is picked, which builds this line one page early.
 */
function stuffOnLine(line) {
  if (line.npcId !== taxidermistId || line.text !== LINE_DONE) return;
  const offer = pending.get(line.player);
  if (!offer) return;
  line.before = () => stuff(line.player, offer);
}

function stuff(player, offer) {
  if (pending.get(player) !== offer) return;
  pending.delete(player);
  const inventory = player.getInventory();
  const { trophy, item, slot } = offer;
  const stillThere = slot >= 0 && inventory.getItems()[slot] === item && item.getId() === trophy.unstuffed;
  if (!stillThere || inventory.getAmount(coinsId) < trophy.price) {
    // Ours: nothing to stuff any more, so she doesn't claim "There you go!"; the chat closes.
    player.getDialogueManager().reset();
    player.getPacketSender().sendInterfaceRemoval();
    return;
  }
  inventory.deleteNumber(coinsId, trophy.price);
  item.setId(trophy.stuffed);
  inventory.refreshItems();
}

/** Unstuff: a chat menu naming the re-stuffing price, then the head goes back into the trophy's slot. */
function unstuff(event) {
  const { player, item } = event;
  const trophy = trophies().get(event.itemId);
  if (!trophy) return false;
  const slot = slotOf(player, item, event.slot);
  const { DialogueChainBuilder, OptionDialogue, ItemStatementDialogue } = core;
  const owner = {};
  const menu = new OptionDialogue(0, {
    executeOption: (option) => {
      player.getPacketSender().closeChatboxFor(owner);
      if (Number(option) !== 1) return;
      const inventory = player.getInventory();
      if (slot < 0 || inventory.getItems()[slot] !== item || item.getId() !== trophy.stuffed) return;
      item.setId(trophy.unstuffed);
      inventory.refreshItems();
      player.getDialogueManager().startDialogues(new DialogueChainBuilder()
        .add(new ItemStatementDialogue(0, trophy.unstuffed, UNSTUFF_TEXT)));
    },
  }, ...UNSTUFF_OPTIONS).setTitle(`Re-stuffing it will cost ${trophy.price.toLocaleString("en-US")} coins.`);
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(menu), owner);
  return true;
}

function forget({ player }) {
  pending.delete(player);
}

/** The stuffed trophies' cache names, for the Unstuff hooks. */
function stuffedNames() {
  return new Set([...trophies().keys()].map((id) => core.CacheDefinitions.getItem(id)?.name).filter(Boolean));
}

module.exports = {
  name: "Taxidermist",
  description: "The Canifis Taxidermist stuffs monster heads and big fish for the coins her transcript names, and stuffed trophies can be unstuffed from the inventory.",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    core = api.core;
    for (const name of stuffedNames()) api.onItemAction(name, { Unstuff: unstuff });
    api.onItemOnNpc(useOnTaxidermist, { noted: false });
    api.onNpcDialogueCondition(coinCondition);
    api.onCustomEvent("npc-dialogue:line", stuffOnLine);
    api.onPlayerLogout(forget);
  },
  _test: { byUnstuffed, byStuffed, offerSteps },
};
