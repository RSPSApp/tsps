/**
 * The Entrance Guardian and the progress hat (Wiki: Entrance_Guardian, Transcript:Entrance_Guardian,
 * Progress_hat, Transcript:Pizazz_Hat). The transcripts are the generated ones; this answers their
 * conditions and actions:
 * - the Entrance Guardian hands out the Pizazz Progress Hat if there's room for it, and again
 *   if it was lost; once given, his second transcript plays;
 * - the hat (Talk-to, carried or worn) reads out the four Pizazz Point totals, filling the
 *   transcript's "[number]" blanks; it shows how far its wearer has got (dull, energised, full).
 */
const Common = require("./Common.MageTrainingArena");

const AFTER_HAT = "after-receiving-the-progress-hat-once";
const NO_SPACE = /does not have inventory space/i;
const HAS_SPACE = /has inventory space/i;
const LOST_HAT = /destroyed or lost their progress hat/i;
const OWNS_HAT = /already owns a progress hat/i;

const isEntranceGuardian = (npcId) => npcId === Common.ids.npcs.entranceGuardian;
const isHat = (npcId) => npcId === Common.ids.npcs.hat;

function variant(context) {
  if (!isEntranceGuardian(context.npcId)) return null;
  return context.player.getAttribute(Common.HAT_GIVEN_ATTRIBUTE) === true ? AFTER_HAT : null;
}

function condition(event) {
  if (!isEntranceGuardian(event.npcId)) return null;
  const { player, text } = event;
  if (NO_SPACE.test(text)) return player.getInventory().getFreeSlots() === 0;
  if (HAS_SPACE.test(text)) return player.getInventory().getFreeSlots() > 0;
  if (LOST_HAT.test(text)) return !Common.ownsHat(player);
  if (OWNS_HAT.test(text)) return Common.ownsHat(player);
  return null;
}

/** "receive Progress hat": the hat for the player's points. */
function action(event) {
  if (!isEntranceGuardian(event.npcId) || event.action !== "receive" || !/progress hat/i.test(event.text ?? "")) return;
  event.handled = true;
  const { player } = event;
  if (player.getInventory().getFreeSlots() === 0) return;
  player.getInventory().adds(Common.hatFor(player), 1);
  player.setAttribute(Common.HAT_GIVEN_ATTRIBUTE, true);
}

/** The hat's totals line: "You have: [number] Telekinetic, [number] Alchemist, ...". */
function line(request) {
  if (!isHat(request.npcId) || !String(request.text ?? "").includes("[number]")) return;
  const totals = Common.POINT_TYPES.map((type) => Common.points(request.player, type).toLocaleString("en-GB"));
  let index = 0;
  request.text = request.text.replace(/\[number\]/g, () => totals[index++] ?? "0");
}

function talkToHat({ player }) {
  const { npcs } = Common.ids;
  const request = { player, npc: null, npcId: npcs.hat, handled: false };
  Common.api.emitCustomEvent("npc-dialogue:start", request);
  return request.handled;
}

function attach(api) {
  api.persistAttribute(Common.HAT_GIVEN_ATTRIBUTE, false);
  for (const type of Common.POINT_TYPES) api.persistAttribute(Common.POINTS_ATTRIBUTE(type), 0);
  api.onNpcDialogueVariant(variant);
  api.onNpcDialogueCondition(condition);
  api.onCustomEvent("npc-dialogue:action", action);
  api.onCustomEvent("npc-dialogue:line", line);
  api.onItemAction("Progress hat", { "Talk-to": talkToHat });
}

module.exports = { attach, variant, condition, action, line, talkToHat, AFTER_HAT };
