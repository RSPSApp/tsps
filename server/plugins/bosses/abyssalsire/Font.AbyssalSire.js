/**
 * The Font of Consumption (Wiki: Unsired), as captured: an unsired used on it brings "You place the
 * Unsired into the Font of Consumption..." with the unsired shown, the player busy and reaching in
 * (human_pickupfloor) a tick later, the font's splash and sound a tick after that, and at 4 the
 * unsired gone, the reward in the pack and "The Font consumes the Unsired and returns you a
 * reward." with the reward shown.
 *
 * The roll (Wiki): out of 128 - 62 a bludgeon piece, 26 an abyssal dagger, 12 a whip, 13 a jar of
 * miasma, 10 an abyssal head and 5 the abyssal orphan; out of 123 without the orphan for a player
 * who owns it (Pets, "pets:owns"). No bludgeon piece comes twice until all three have. The reward
 * goes through "npc-drops:roll", so the collection log counts it and Pets takes the orphan.
 */
const Common = require("./Common.AbyssalSire");

const BUSY_ATTRIBUTE = "abyssal-sire:at-font";
const BLUDGEON = "bludgeon";

function ownsOrphan(player, orphan) {
  const request = { player, itemId: orphan, owns: false };
  Common.api.emitCustomEvent("pets:owns", request);
  return request.owns === true;
}

/** A piece the player hasn't had since their last full set (attribute bits, as the pieces' order). */
function rollPiece(player) {
  const pieces = Common.data.font.bludgeonPieces;
  const full = (1 << pieces.length) - 1;
  let had = Number(player.getAttribute(Common.PIECES_ATTRIBUTE)) || 0;
  if (had === full) had = 0;
  const left = pieces.map((piece, index) => ({ piece, index })).filter(({ index }) => !(had & (1 << index)));
  const { piece, index } = left[Math.floor(Math.random() * left.length)];
  player.setAttribute(Common.PIECES_ATTRIBUTE, had | (1 << index));
  return piece;
}

function roll(player) {
  const { font } = Common.data;
  const orphan = Common.core.ItemIdentifiers.ABYSSAL_ORPHAN;
  const table = ownsOrphan(player, orphan) ? font.table.filter((entry) => entry.item !== orphan) : font.table;
  const entry = Common.weighted(table);
  return entry.item === BLUDGEON ? rollPiece(player) : entry.item;
}

function objectBox(player, itemId, text) {
  const { DialogueChainBuilder, ItemStatementDialogue } = Common.core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new ItemStatementDialogue(0, itemId, text)));
}

function useUnsired(event) {
  const { player, object } = event;
  const { ItemIdentifiers, Animation } = Common.core;
  const { font, anims, spotanims, sounds } = Common.data;
  if (player.getAttribute(BUSY_ATTRIBUTE) === true) return true;
  player.setAttribute(BUSY_ATTRIBUTE, true);
  objectBox(player, ItemIdentifiers.UNSIRED, font.placeText);
  Common.later(1, () => {
    Common.busyFor(player, font.rewardTicks - 1);
    player.performAnimation(new Animation(anims.fontPlace, 15));
  });
  const where = object?.getLocation?.() ?? Common.toLocation([event.location.x, event.location.y, event.location.z]);
  Common.later(font.splashTicks, () => {
    if (!player.isRegistered()) return;
    Common.tileGraphic([player], where, spotanims.fontSplash);
    Common.areaSound([player], sounds.fontSplash, where);
  });
  Common.later(font.rewardTicks, () => {
    player.setAttribute(BUSY_ATTRIBUTE, false);
    if (!player.isRegistered() || !player.getInventory().contains(ItemIdentifiers.UNSIRED)) return;
    const reward = roll(player);
    player.getInventory().delete(ItemIdentifiers.UNSIRED, 1);
    const drops = [{ itemId: reward, amount: 1 }];
    Common.api.emitCustomEvent("npc-drops:roll", { player, drops });
    for (const drop of drops) player.getInventory().adds(drop.itemId, drop.amount);
    // `abyssal-sire:font-consumed` { player, itemId } (a league's "Offer an Unsired to the Font of Consumption").
    Common.api.emitCustomEvent("abyssal-sire:font-consumed", { player, itemId: reward });
    objectBox(player, reward, font.rewardText);
  });
  return true;
}

function attachFont(api) {
  api.persistAttribute(Common.PIECES_ATTRIBUTE, 0);
  api.onItemOnObject("Unsired", "The Font of Consumption", useUnsired);
}

module.exports = { attachFont, roll, rollPiece };
