/**
 * Buying skillcapes from the skill masters (https://oldschool.runescape.wiki/w/Cape_of_Accomplishment).
 *
 * Most masters sell through their Wiki transcripts: they play their "with 99" variant to a
 * player with 99 in the skill, and the transcripts' shared conditions ("If the player has at
 * least 99,000 coins and enough inventory space:") and hand-outs ("an Attack cape and hood")
 * are answered here. A cape costs 99,000 coins with its hood free, and is trimmed for a player
 * with more than one 99. Hoods are reissued free.
 *
 * Masters who sell from their shop (Hickton, Aubury, Wizard Sinina, Martin Thwait, the Ranging
 * Guild armour salesman) open a copy of it with the cape added for a player with 99, and a
 * second copy with the trimmed cape for one with more than one 99 (Wiki: "Hickton's Archery
 * Emporium": "The stock of this shop is not shared with the regular shop"). Buying the cape
 * there needs two free slots, as the hood comes with it (rsprox captures).
 */
const fs = require("fs");
const path = require("path");
const Capes = require("./Common.SkillCapes");

const SAILING_PURCHASED_ATTRIBUTE = "skillcapes:sailing-purchased";
const SAILING_PURCHASED_VARBIT = "skillcape_sailing_purchased";
const HOOD_SLOTS_MESSAGE = "Skillcapes come with a free hood, so you need 2 empty inventory slots for each one that you want to buy.";

/** Master name -> { cape, variants } for dialogue sellers; base shop id -> shop copies. */
const MASTERS = new Map();
const SHOP_MASTERS = new Map();
const SHOP_CAPES = new Map();

function buildMasters() {
  MASTERS.clear();
  for (const cape of Capes.CAPES) {
    for (const [name, master] of Object.entries(cape.masters)) MASTERS.set(name, { cape, ...master });
  }
}

function coins(player) {
  return player.getInventory().getAmount(Capes.core.ItemIdentifiers.COINS);
}

/** The cape and hood need two slots, one of which the coins free if they are all spent. */
function hasRoom(player, price = Capes.DATA.price) {
  return player.getInventory().getFreeSlots() + (coins(player) === price ? 1 : 0) >= 2;
}

function mastered(player, cape) {
  return Capes.baseLevel(player, cape.skill) >= Capes.MAX_LEVEL;
}

/** The cape this player is sold: trimmed once they have more than one 99. */
function capeFor(player, cape) {
  return Capes.count99s(player) > 1 ? cape.trimmed : cape.cape;
}

function owns(player, ids) {
  const has = (container) => ids.some((id) => container.contains(id));
  return has(player.getInventory()) || has(player.getEquipment()) ||
    player.getBanks().some((bank) => bank && has(bank));
}

function ownsCape(player, cape) {
  return owns(player, [cape.cape, cape.trimmed, cape.worn, cape.trimmedWorn].filter((id) => id !== null));
}

function masterFor(event) {
  const name = event.definition?.getName?.() ?? Capes.core.CacheDefinitions.getNpc(event.npcId)?.name;
  return MASTERS.get(name) ?? null;
}

function sellerVariant(event) {
  const master = masterFor(event);
  if (!master) return null;
  if (!mastered(event.player, master.cape)) return master.without99 ?? null;
  if (master.bought && event.player.getAttribute(SAILING_PURCHASED_ATTRIBUTE) === true) return master.bought;
  return master.with99 ?? null;
}

/**
 * The transcripts' shared conditions, most specific first. Each is `[pattern, answer]`; the
 * answer gets `{ player, cape }`.
 */
/**
 * Brother Jered (Wiki: Transcript:Brother Jered) also blesses an unblessed symbol into a holy
 * symbol. The transcript marks the blessing itself "unavailable" and says no Prayer level for it,
 * so a player carrying one is offered it instead of the plain Prayer branch.
 */
const BLESSING_STEP_ID = "4VbQ5b";

function carriesUnblessed({ player, cape }) {
  return cape.skillKey === "PRAYER" && player.getInventory().contains(Capes.core.ItemIdentifiers.UNBLESSED_SYMBOL);
}

function bless(player) {
  const { UNBLESSED_SYMBOL, HOLY_SYMBOL } = Capes.core.ItemIdentifiers;
  const inventory = player.getInventory();
  if (!inventory.contains(UNBLESSED_SYMBOL)) return;
  inventory.deleteNumber(UNBLESSED_SYMBOL, 1);
  inventory.adds(HOLY_SYMBOL, 1);
}

const CONDITIONS = [
  [/pvp arena world|pvp world|deadman world/i, () => false],
  [/has 99 \w+, an? .*cape, but no hood/i, ({ player, cape }) =>
    mastered(player, cape) && ownsCape(player, cape) && !owns(player, [cape.hood])],
  [/(?:at least 99,000 coins|the money) but (?:not enough inventory space|does?e?s not have two free)|at least 99,000 coins without two free/i,
    ({ player }) => coins(player) >= Capes.DATA.price && !hasRoom(player)],
  [/(?:at least 99,000 coins|enough money) and (?:enough inventory space|two free inventory spaces)/i,
    ({ player }) => coins(player) >= Capes.DATA.price && hasRoom(player)],
  [/does not have at least 99,000 coins|doesn't have 99,000 coins|does not have enough money|doesn't have enough (?:coins|gold)/i,
    ({ player }) => coins(player) < Capes.DATA.price],
  [/does not have two free inventory spaces|does not have enough inventory space/i, ({ player }) => !hasRoom(player)],
  [/has no (?:free )?inventory spaces?|does not have a free inventory space/i, ({ player }) => player.getInventory().getFreeSlots() === 0],
  [/has at least (?:one|1) free inventory space/i, ({ player }) => player.getInventory().getFreeSlots() > 0],
  [/carrying an unblessed symbol/i, carriesUnblessed],
  [/(?:does not|doesn't) have 99 \w+/i, ({ player, cape }) => !mastered(player, cape) && !carriesUnblessed({ player, cape })],
  [/has 99 \w+/i, ({ player, cape }) => mastered(player, cape)],
  [/(?:does not|doesn't) have an? (?:skillcape|\w+ cape)|does not have a skillcape of/i, ({ player, cape }) => !ownsCape(player, cape)],
  [/has an? (?:skillcape|\w+ cape)|has a skillcape of|already bought a skillcape before/i, ({ player, cape }) => ownsCape(player, cape)],
];

function sellerCondition(event) {
  const master = masterFor(event);
  if (!master || typeof event.text !== "string") return null;
  for (const [pattern, answer] of CONDITIONS) {
    if (pattern.test(event.text)) return answer({ player: event.player, cape: master.cape });
  }
  return null;
}

/** Sells the cape and its free hood, if the player still can pay and carry them. */
function sell(player, cape) {
  const inventory = player.getInventory();
  if (coins(player) < Capes.DATA.price || !hasRoom(player)) return false;
  inventory.deleteNumber(Capes.core.ItemIdentifiers.COINS, Capes.DATA.price);
  inventory.adds(capeFor(player, cape), 1);
  inventory.adds(cape.hood, 1);
  if (cape.skillKey === "SAILING") {
    player.setAttribute(SAILING_PURCHASED_ATTRIBUTE, true);
    syncSailingVarbit({ player });
  }
  return true;
}

/** Some transcripts both list the hood hand-out and narrate it; one hood per request. */
const HOOD_REPEAT_TICKS = 5;
const lastHood = new WeakMap();

function giveHood(player, cape) {
  const now = Capes.core.World.getProcessCycle();
  const last = lastHood.get(player);
  if (last !== undefined && now - last < HOOD_REPEAT_TICKS) return;
  if (player.getInventory().getFreeSlots() === 0) return;
  lastHood.set(player, now);
  player.getInventory().adds(cape.hood, 1);
}

/** The transcripts' hand-outs: "an Attack cape and hood", "a Cooking hood", "... hands you another hood". */
function sellerAction(event) {
  const master = masterFor(event);
  if (master && event.stepId === BLESSING_STEP_ID && master.cape.skillKey === "PRAYER") {
    bless(event.player);
    event.handled = true;
    return;
  }
  if (!master || typeof event.text !== "string") return;
  const text = event.text;
  // A narrated message still shows; only actions are marked handled so the branch carries on.
  const handled = event.kind !== "message";
  if (/cape and (?:\w+ )?hood|buy a \w+ skillcape from/i.test(text)) {
    const sold = sell(event.player, master.cape);
    // Brass Hand Harry's transcript narrates the sale without checking coins or space.
    if (!sold && event.kind === "message") {
      event.player.sendMessage(coins(event.player) < Capes.DATA.price
        ? "You don't have enough coins." : "You don't have enough inventory space.");
      event.handled = true;
      return;
    }
    event.handled = handled;
  } else if (/hands you another hood|\bhood\.?$/i.test(text) && !/cape/i.test(text.replace(/skillcape/i, ""))) {
    giveHood(event.player, master.cape);
    event.handled = handled;
  } else if (/^99,000 coins$/i.test(text.trim())) {
    // Ignatius Vulcan's transcript lists the payment on its own; the hand-out takes it.
    event.handled = true;
  }
}

function syncSailingVarbit({ player }) {
  const id = Capes.core.CacheDefinitions.getVarbitId(SAILING_PURCHASED_VARBIT);
  if (Number.isInteger(id)) player.getPacketSender().sendVarbit(id, player.getAttribute(SAILING_PURCHASED_ATTRIBUTE) === true ? 1 : 0);
}

// --- Shop masters --------------------------------------------------------------------------

function readBaseShops() {
  const file = path.join(Capes.core.GameConstants.DEFINITIONS_DIRECTORY, "shops.json");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** The skillcape copies of each shop master's shop: [untrimmed, trimmed] per base shop. */
function shopCopies() {
  const bases = readBaseShops();
  const copies = [];
  let id = Capes.DATA.skillcapeShopIds.first;
  SHOP_MASTERS.clear();
  SHOP_CAPES.clear();
  for (const cape of Capes.CAPES) {
    for (const master of Object.values(cape.masters)) {
      if (!master.shop) continue;
      const base = bases.find((shop) => shop.name === master.shop);
      if (!base) continue;
      const ids = [];
      for (const capeId of [cape.cape, cape.trimmed]) {
        copies.push({
          ...base,
          id,
          npcInteractions: [],
          originalStock: [...(base.originalStock ?? []), { id: capeId, amount: 1, price: Capes.DATA.price }],
        });
        SHOP_CAPES.set(id, { cape, capeId });
        ids.push(id++);
      }
      SHOP_MASTERS.set(base.id, { cape, untrimmed: ids[0], trimmed: ids[1] });
    }
  }
  return copies;
}

/** A shop master's own shop opens its skillcape copy for a player with 99. */
function openSkillcapeShop(event) {
  const master = SHOP_MASTERS.get(event.shopId);
  if (!master || !mastered(event.player, master.cape)) return;
  const copy = Capes.count99s(event.player) > 1 ? master.trimmed : master.untrimmed;
  if (Capes.core.ShopManager.open(event.player, copy, true)) event.allow = false;
}

/** The hood comes free with the cape, so each cape bought needs two free slots. */
function limitCapePurchase(limit) {
  const shop = SHOP_CAPES.get(limit.shopId);
  if (!shop || limit.itemId !== shop.capeId) return;
  const affordable = Math.floor(limit.player.getInventory().getFreeSlots() / 2);
  if (affordable < limit.limit) {
    limit.limit = affordable;
    limit.message = HOOD_SLOTS_MESSAGE;
  }
}

function hoodWithCape(event) {
  const shop = SHOP_CAPES.get(event.shopId);
  if (!shop || event.itemId !== shop.capeId) return;
  event.player.getInventory().adds(shop.cape.hood, event.amount);
}

module.exports = function attachSellers(api) {
  buildMasters();
  api.persistAttribute(SAILING_PURCHASED_ATTRIBUTE, false);
  api.registerDefinitionSource("shops", { name: "skillcapes", load: shopCopies });
  api.onNpcDialogueVariant(sellerVariant);
  api.onNpcDialogueCondition(sellerCondition);
  api.onCustomEvent("npc-dialogue:action", sellerAction);
  api.onCanShop(openSkillcapeShop);
  api.onCustomEvent("shop:buy-limit", limitCapePurchase);
  api.onCustomEvent("shop:purchase", hoodWithCape);
  api.onPlayerLogin(syncSailingVarbit);
};

module.exports._test = { MASTERS, SHOP_MASTERS, SHOP_CAPES, CONDITIONS, sellerVariant, sellerCondition, sellerAction, sell, hasRoom, capeFor, shopCopies, openSkillcapeShop, limitCapePurchase };
