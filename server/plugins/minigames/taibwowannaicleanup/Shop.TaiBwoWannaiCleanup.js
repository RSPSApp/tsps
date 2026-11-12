/**
 * Tai Bwo Wannai Cleanup: Gabooty's shops, where the trading sticks are spent
 * (https://oldschool.runescape.wiki/w/Gabooty%27s_Tai_Bwo_Wannai_Cooperative.).
 *
 * The generated shops.json splits each into a Default and a Karamja gloves version; the gloves
 * one opens while any Karamja gloves are worn (Wiki), from Trade-Co-op and from his transcript's
 * open_shop steps. Both shops open only once the player has asked Gabooty "What do you do here?"
 * (Wiki); his transcript's "Can you open the shop please?" is guarded by that. Trade-Co-op and
 * Trade-Drinks before it play his conversation instead (not recorded). The generated data binds
 * both shops to op 3, which Shopkeepers drops as a conflict, so the ops are bound here.
 *
 * Data gap: the generated shops lack the Wiki's 0-stock gem and gout tuber lines, so Gabooty
 * buys only what he lists; selling gems to him waits on the shop import.
 */
const Common = require("./Common.TaiBwoWannaiCleanup");

const ASKED_ATTRIBUTE = "tai-bwo-wannai-cleanup:asked-gabooty";

const shopData = () => Common.data.shop;
const versionName = (shop, version) => `${shop}${shopData().versions[version]}`;

function wearsKaramjaGloves(player) {
  const worn = player.getEquipment().getItems()[Common.core.Equipment.HANDS_SLOT];
  const id = worn ? worn.getId() : -1;
  return id > 0 && shopData().gloves.some((name) => Common.objId(name) === id);
}

const asked = (player) => player.getAttribute(ASKED_ATTRIBUTE) === true;

/** The version of `shop` (a base name) this player is served: the gloves one while they're worn. */
function versionFor(player, shop) {
  return versionName(shop, wearsKaramjaGloves(player) ? "gloves" : "default");
}

function shopId(name) {
  return Common.core.ShopDefinition.all().find((definition) => definition.getName() === name)?.getId() ?? null;
}

const isGabooty = (event) => event.definition?.getName?.() === "Gabooty";
const gabootyShop = (name) => [shopData().coop, shopData().drinks].some((shop) =>
  Object.keys(shopData().versions).some((version) => versionName(shop, version) === name));

/** Opens `shop` (a base name) for the player, or plays Gabooty's conversation until they've asked. */
function trade(event, shop) {
  const { player } = event;
  event.handled = true;
  if (!asked(player)) {
    Common.api.emitCustomEvent("npc-dialogue:start", { player, npc: event.npc, npcId: event.npcId, handled: false });
    return true;
  }
  const id = shopId(versionFor(player, shop));
  if (id !== null) Common.core.ShopManager.open(player, id, true);
  return true;
}

const tradeCoop = (event) => trade(event, shopData().coop);
const tradeDrinks = (event) => trade(event, shopData().drinks);

/** His "What do you do here?" unlocks the shops. */
function onChoice(event) {
  if (isGabooty(event) && event.option === shopData().asked.option) event.player.setAttribute(ASKED_ATTRIBUTE, true);
}

function answerCondition(event) {
  if (!isGabooty(event) || event.text !== shopData().asked.condition) return undefined;
  return asked(event.player);
}

/** His transcript's open_shop steps list both versions: the gloves one while they're worn. */
function pickVersion(request) {
  if (!gabootyShop(request.shops?.[0])) return;
  request.shop = versionFor(request.player, request.target);
}

/** Every way into either shop waits for the question. */
function canShop(event) {
  if (event.shopId == null) return;
  const name = Common.core.ShopDefinition.forId(event.shopId)?.getName?.();
  if (gabootyShop(name) && !asked(event.player)) event.allow = false;
}

function attachShop(api) {
  api.persistAttribute(ASKED_ATTRIBUTE, false);
  api.onNpcInteraction("Gabooty", { "Trade-Co-op": tradeCoop, "Trade-Drinks": tradeDrinks });
  api.onCustomEvent("npc-dialogue:choice", onChoice);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:shop", pickVersion);
  api.onCanShop(canShop);
}

module.exports = { attachShop, ASKED_ATTRIBUTE, wearsKaramjaGloves, versionFor, shopId, answerCondition };
