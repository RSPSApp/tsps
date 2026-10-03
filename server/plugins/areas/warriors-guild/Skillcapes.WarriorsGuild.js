/**
 * Warriors' Guild: Ajjat sells the Cape of Attack and Sloane the Cape of Strength, with a free
 * hood, for 99,000 coins to players with 99 in the skill, through their Wiki transcripts. The
 * cape is trimmed for anyone with more than one 99.
 */
const Guild = require("./Common.WarriorsGuild");

const PRICE = 99000;
const MAX_LEVEL = 99;

let SELLERS = new Map();

function buildSellers() {
  const { Skill, ItemIdentifiers: Items } = Guild.core;
  return new Map([
    [Guild.NPCS.AJJAT, { skill: Skill.ATTACK, variant: "with-99-attack", fallback: null,
      cape: Items.ATTACK_CAPE, trimmed: Items.ATTACK_CAPE_T_, hood: Items.ATTACK_HOOD }],
    [Guild.NPCS.SLOANE, { skill: Skill.STRENGTH, variant: "dialogue-with-99-strength", fallback: "dialogue-without-99-strength",
      cape: Items.STRENGTH_CAPE, trimmed: Items.STRENGTH_CAPE_T_, hood: Items.STRENGTH_HOOD }],
  ]);
}

function mastered(player, skill) {
  return Guild.baseLevel(player, skill) >= MAX_LEVEL;
}

function hasCape(player, seller) {
  return [seller.cape, seller.trimmed].some((id) => player.getInventory().contains(id) || player.getEquipment().contains(id));
}

function coins(player) {
  return player.getInventory().getAmount(Guild.core.ItemIdentifiers.COINS);
}

/** The cape and hood need two slots, one of which the coins free if they are all spent. */
function hasRoom(player) {
  return player.getInventory().getFreeSlots() + (coins(player) === PRICE ? 1 : 0) >= 2;
}

function sellerVariant({ player, npcId }) {
  const seller = SELLERS.get(npcId);
  if (!seller) return null;
  return mastered(player, seller.skill) ? seller.variant : seller.fallback;
}

function sellerCondition({ player, npcId, text }) {
  const seller = SELLERS.get(npcId);
  if (!seller) return null;
  if (/^If the player does not have a (Skill)?cape of/i.test(text)) return !hasCape(player, seller);
  if (/^If the player has a (Skill)?cape of/i.test(text)) return hasCape(player, seller);
  if (/does not have at least 99,000 coins/.test(text)) return coins(player) < PRICE;
  if (/at least 99,000 coins but not enough inventory space/.test(text)) return coins(player) >= PRICE && !hasRoom(player);
  if (/at least 99,000 coins and enough inventory space/.test(text)) return coins(player) >= PRICE && hasRoom(player);
  return null;
}

function trimmed(player) {
  const { Skill } = Guild.core;
  return Skill.values().filter((skill) => Guild.baseLevel(player, skill) >= MAX_LEVEL).length > 1;
}

function sellCape(event) {
  const seller = SELLERS.get(event.npcId);
  if (!seller || typeof event.text !== "string") return;
  const inventory = event.player.getInventory();
  if (/cape and hood/i.test(event.text)) {
    if (coins(event.player) >= PRICE && hasRoom(event.player)) {
      inventory.deleteNumber(Guild.core.ItemIdentifiers.COINS, PRICE);
      inventory.adds(trimmed(event.player) ? seller.trimmed : seller.cape, 1);
      inventory.adds(seller.hood, 1);
    }
    event.handled = true;
  } else if (/hood$/i.test(event.text)) {
    if (inventory.getFreeSlots() > 0) inventory.adds(seller.hood, 1);
    event.handled = true;
  }
}

module.exports = function attachSkillcapes(api) {
  SELLERS = buildSellers();
  api.onNpcDialogueVariant(sellerVariant);
  api.onNpcDialogueCondition(sellerCondition);
  api.onCustomEvent("npc-dialogue:action", sellCape);
};
