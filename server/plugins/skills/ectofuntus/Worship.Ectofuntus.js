/**
 * Worshipping the Ectofuntus: a bucket of slime and a pot of bonemeal for four times the bones'
 * burying experience and 5 ecto-tokens, held by the ghost disciples until claimed (Wiki). One
 * worship per click, the slime or bonemeal used on it too.
 *
 * As captured (rsprox recordings 375-377, 703, rev 229-231):
 * - ahoy_prayer with synth 2671, "You put some ectoplasm and bonemeal into the Ectofuntus, and
 *   worship it.", the bucket and pot emptied in their slots, ahoy_ectotokens_base +5.
 * - Missing either, a message box: "You don't have any ectoplasm or crushed bones to put into
 *   the<br>Ectofuntus." / "You need a bucket of ectoplasm to put into the Ectofuntus." / "You need
 *   a pot of crushed bones to put into the Ectofuntus."
 * Not captured: with 1000 tokens unclaimed the Wiki's "There isn't room to put any more in.";
 * superior dragon bonemeal below 70 Prayer (the Wiki's requirement) is passed over.
 */
const Common = require("./Common.Ectofuntus");

const TOKENS_PER_WORSHIP = 5;
const MAX_UNCLAIMED_TOKENS = 1000;
const WORSHIP_SOUND = 2671;
// Wiki Zealot's robes: each worn piece adds 1.25% to save both ingredients on one roll.
const ZEALOT_PIECES = ["shades_prayer_helm", "shades_prayer_top", "shades_prayer_bottom", "shades_prayer_boots"];
const SAVE_CHANCE_PER_PIECE = 0.0125;

function savesOffering(player) {
  const worn = new Set(player.getEquipment().getItems().map(item => item?.getId()));
  const pieces = ZEALOT_PIECES.filter(name => worn.has(Common.gameval("obj", name))).length;
  return pieces > 0 && Math.random() < pieces * SAVE_CHANCE_PER_PIECE;
}

/** The first bonemeal pot carried that the player's Prayer level can worship with. */
function bonemeal(player) {
  const level = player.getSkillManager().getMaxLevel(Common.core.Skill.PRAYER);
  for (const item of player.getInventory().getItems()) {
    const id = item?.getId?.() ?? -1;
    const row = id > 0 ? Common.worshipFor(id) : null;
    if (row && (row.level ?? 1) <= level) return { id, row };
  }
  return null;
}

function worship({ player }) {
  const { ItemIdentifiers, Skill } = Common.core;
  const slime = player.getInventory().contains(ItemIdentifiers.BUCKET_OF_SLIME);
  const pot = bonemeal(player);
  if (!slime && !pot) {
    Common.mesbox(player, "You don't have any ectoplasm or crushed bones to put into the<br>Ectofuntus.");
    return true;
  }
  if (!slime) {
    Common.mesbox(player, "You need a bucket of ectoplasm to put into the Ectofuntus.");
    return true;
  }
  if (!pot) {
    Common.mesbox(player, "You need a pot of crushed bones to put into the Ectofuntus.");
    return true;
  }
  if (Common.tokens(player) + TOKENS_PER_WORSHIP > MAX_UNCLAIMED_TOKENS) {
    Common.mesbox(player, "There isn't room to put any more in.");
    return true;
  }
  if (!savesOffering(player)) {
    Common.swap(player, ItemIdentifiers.BUCKET_OF_SLIME, ItemIdentifiers.BUCKET);
    Common.swap(player, pot.id, ItemIdentifiers.POT);
  }
  Common.animate(player, "ahoy_prayer");
  Common.sound(player, WORSHIP_SOUND);
  Common.spam(player, "You put some ectoplasm and bonemeal into the Ectofuntus, and worship it.");
  player.getSkillManager().addExperiences(Skill.PRAYER, pot.row.xp);
  Common.setTokens(player, Common.tokens(player) + TOKENS_PER_WORSHIP);
  // "ectofuntus:worshipped" { player, itemId }: a worship made, with that bonemeal.
  Common.api.emitCustomEvent("ectofuntus:worshipped", { player, itemId: pot.id });
  return true;
}

/** Slime or bonemeal used on the Ectofuntus worships as the option does. */
function useOnEctofuntus(event) {
  const { objectId, itemId } = event;
  if (objectId !== Common.core.ObjectIdentifiers.ECTOFUNTUS) return;
  if (itemId !== Common.core.ItemIdentifiers.BUCKET_OF_SLIME && !Common.worshipFor(itemId)) return;
  event.handled = worship(event);
}

module.exports = function attachWorship(api) {
  api.onObjectInteraction("Ectofuntus", { Worship: worship });
  api.onItemOnObject(useOnEctofuntus, { noted: false });
};
