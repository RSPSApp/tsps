/**
 * Nulodion's "I've lost my cannon." (his Wiki transcript, in npc-dialogues.json): the cannon
 * answers the transcript's conditions, and "The dwarf gives you a new cannon." hands back the
 * lost cannon's parts, as the kind it was.
 */
const Cannon = require("./Common.DwarfCannon");

const GIVES_CANNON = "The dwarf gives you a new cannon.";

/** The lost cannon waiting here, if any: `{ kind, stage }`. */
function lostCannon(player) {
  const lost = player.getAttribute(Cannon.LOST_ATTRIBUTE);
  return lost && Cannon.KINDS[lost.kind] ? lost : null;
}

function answerCondition(event) {
  if (event.npcId !== Cannon.core.NpcIdentifiers.NULODION) return null;
  const { player, text } = event;
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
  for (const part of Cannon.KINDS[lost.kind].parts.slice(0, lost.stage)) inventory.add(new Cannon.core.Item(part, 1), true);
  event.player.setAttribute(Cannon.LOST_ATTRIBUTE, null);
}

module.exports = function attachNulodion(api) {
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:action", giveCannon);
};

Object.assign(module.exports, { answerCondition, giveCannon, lostCannon, GIVES_CANNON });
