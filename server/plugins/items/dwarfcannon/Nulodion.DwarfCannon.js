/**
 * Nulodion's "I've lost my cannon." (his Wiki transcript, in npc-dialogues.json): the cannon
 * answers the transcript's conditions, and "The dwarf gives you a new cannon." hands back the
 * lost cannon's parts, as the kind it was.
 */
const Cannon = require("./Common.DwarfCannon");

const CANNON_PRICE = 750000;
const SALE_SLOTS = 6;
const SELLS_CANNON = "You give the cannon engineer 750,000 coins. He gives you the four parts that make the cannon, plus an ammo mould and an instruction manual.";

const GIVES_CANNON = "The dwarf gives you a new cannon.";

/** The lost cannon waiting here, if any: `{ kind, stage }`. */
function lostCannon(player) {
  const lost = player.getAttribute(Cannon.LOST_ATTRIBUTE);
  return lost && Cannon.KINDS[lost.kind] && Number.isInteger(lost.stage) && lost.stage >= 1 && lost.stage <= 4 ? lost : null;
}

function answerCondition(event) {
  if (event.npcId !== Cannon.core.NpcIdentifiers.NULODION) return null;
  const { player, text } = event;
  const inventory = player.getInventory();
  if (/less than six free inventory space/.test(text)) return inventory.getFreeSlots() < SALE_SLOTS;
  if (/at least 750,000 coins and enough inventory space/.test(text)) return inventory.getAmount(Cannon.core.ItemIdentifiers.COINS) >= CANNON_PRICE && inventory.getFreeSlots() >= SALE_SLOTS;
  if (/does not have at least 750,000 coins/.test(text)) return inventory.getAmount(Cannon.core.ItemIdentifiers.COINS) < CANNON_PRICE;
  if (/cannon is still set-up somewhere/.test(text)) return Cannon.cannonOf(player) != null;
  if (/less than 4 free inventory space/.test(text)) return player.getInventory().getFreeSlots() < (lostCannon(player)?.stage ?? 4);
  if (/lost their cannon by world-hopping or letting it despawn/.test(text)) return lostCannon(player) != null;
  if (/still has their cannon/.test(text)) return lostCannon(player) == null;
  return null;
}

function giveCannon(event) {
  if (event.npcId !== Cannon.core.NpcIdentifiers.NULODION || event.kind !== "message" || event.text !== GIVES_CANNON) return;
  const lost = lostCannon(event.player);
  if (!lost) return;
  const inventory = event.player.getInventory();
  if (Cannon.cannonOf(event.player) || inventory.getFreeSlots() < lost.stage) return;
  for (const part of Cannon.KINDS[lost.kind].parts.slice(0, lost.stage)) inventory.add(new Cannon.core.Item(part, 1), true);
  event.player.setAttribute(Cannon.LOST_ATTRIBUTE, null);
  if (lost.steel || lost.granite) event.player.setAttribute(Cannon.RECOVERED_AMMO_ATTRIBUTE, { steel: lost.steel ?? 0, granite: lost.granite ?? 0 });
}

/** The generated transcript owns the dialogue; only its purchase effect lives here. */
function sellCannon(event) {
  if (event.npcId !== Cannon.core.NpcIdentifiers.NULODION || event.kind !== "message" || event.text !== SELLS_CANNON) return;
  const inventory = event.player.getInventory();
  const I = Cannon.core.ItemIdentifiers;
  if (inventory.getFreeSlots() < SALE_SLOTS || inventory.getAmount(I.COINS) < CANNON_PRICE) return;
  inventory.delete(I.COINS, CANNON_PRICE);
  for (const id of [...Cannon.KINDS.plain.parts, I.AMMO_MOULD, I.INSTRUCTION_MANUAL]) inventory.add(new Cannon.core.Item(id, 1), true);
}

module.exports = function attachNulodion(api) {
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:action", giveCannon);
  api.onCustomEvent("npc-dialogue:action", sellCannon);
};

Object.assign(module.exports, { answerCondition, giveCannon, sellCannon, CANNON_PRICE, SELLS_CANNON, lostCannon, GIVES_CANNON });
