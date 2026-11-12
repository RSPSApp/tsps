/**
 * Mairin's Training (https://oldschool.runescape.wiki/w/Underwater_Agility_and_Thieving): glistening
 * tears exchanged for Agility, Thieving or both, through fossil_underwater_training (287).
 *
 * rsprox captures (231/00712, 00715; 234/03273, 03299):
 * - Training (Mairin's fourth op) sets if1-if4 (varps 261-264) to the whole XP a tear gives at the
 *   player's levels, Agility, Thieving, and Agility and Thieving split, then opens 287 as the modal.
 * - Its three rows (287:3 Agility, 287:5 Thieving, 287:7 both) take Exchange-1, -5, -X ("How many
 *   glistening tears do you wish to exchange? (N)", N carried) and -All.
 * - A tear's XP is level x level x 0.027 for Agility and x 0.099 for Thieving, or x 0.018 and
 *   x 0.066 for both, cut to a tenth; the exchange pays the tears times that, rounded down. Every
 *   captured exchange fits: 251 tears at Agility 83 for 46,686, 220 at 85 for 42,900, 458 at 87
 *   for 93,569, 310 at 90 for 67,797, one at 99 for 264, one at Thieving 99 for 970, 3 split at 99
 *   for 529 and 1,940, 83 split at Agility 62 / Thieving 80 for 5,735 and 35,059. The Wiki's 99
 *   figures are the same: 264.6, 970.2, 176.4 and 646.8.
 * - After an exchange the varps are sent again for the new levels.
 * - Wiki: at most 700 tears go in one exchange; Mairin takes the rest ("Mairin confiscared [sic] a
 *   further N tears; she did not approve of how many you had.").
 */
const INTERFACE = 287;
const ROWS = Object.freeze({ 3: "agility", 5: "thieving", 7: "both" });
const RATE_VARPS = Object.freeze({ agility: 261, thieving: 262, bothAgility: 263, bothThieving: 264 });
const AMOUNTS = Object.freeze({ 1: 1, 2: 5 });
const EXCHANGE_X = 3;
const EXCHANGE_ALL = 4;
// Captured (231/00712 Exchange-1 with none carried).
const NONE_MESSAGE = "You don't have any glistening tears to exchange.";

let core;
let TRAINING;

const uid = (child) => (INTERFACE << 16) | child;

function level(player, skill) {
  return player.getSkillManager().getMaxLevel(skill);
}

/** A tear's XP, cut to a tenth: level squared times the rate. */
function perTear(lvl, rate) {
  return Math.floor(lvl * lvl * rate * 10 + 1e-9) / 10;
}

function rates(player) {
  const { Skill } = core;
  const agility = level(player, Skill.AGILITY);
  const thieving = level(player, Skill.THIEVING);
  const { rates: r } = TRAINING;
  return {
    agility: perTear(agility, r.agility),
    thieving: perTear(thieving, r.thieving),
    bothAgility: perTear(agility, r.bothAgility),
    bothThieving: perTear(thieving, r.bothThieving),
  };
}

function sendRates(player) {
  const sender = player.getPacketSender();
  const current = rates(player);
  for (const [key, varp] of Object.entries(RATE_VARPS)) sender.sendConfig(varp, Math.floor(current[key]));
}

function openTraining({ player }) {
  sendRates(player);
  player.getPacketSender().sendInterface(INTERFACE);
  return true;
}

const amountText = (n) => (n === 1 ? "one glistening tear" : `${n.toLocaleString("en-GB")} glistening tears`);

function exchange(player, row, wanted) {
  const { ItemIdentifiers: I, Skill } = core;
  const held = player.getInventory().getAmount(I.GLISTENING_TEAR);
  if (held <= 0) {
    player.sendMessage(NONE_MESSAGE);
    return;
  }
  const count = Math.min(held, wanted, TRAINING.max);
  const rate = rates(player);
  player.getInventory().delete(I.GLISTENING_TEAR, count);
  const skills = player.getSkillManager();
  if (row === "both") {
    const agility = Math.floor(count * rate.bothAgility + 1e-9);
    const thieving = Math.floor(count * rate.bothThieving + 1e-9);
    skills.addExperiences(Skill.AGILITY, agility);
    skills.addExperiences(Skill.THIEVING, thieving);
    player.sendMessage(`Mairin trains you in Agility and Thieving, exchanging ${amountText(count)} for ${agility.toLocaleString("en-GB")} Agility XP and ${thieving.toLocaleString("en-GB")} Thieving XP.`);
  } else {
    const skill = row === "agility" ? Skill.AGILITY : Skill.THIEVING;
    const name = row === "agility" ? "Agility" : "Thieving";
    const xp = Math.floor(count * rate[row] + 1e-9);
    skills.addExperiences(skill, xp);
    player.sendMessage(`Mairin trains you in ${name}, exchanging ${amountText(count)} for ${xp.toLocaleString("en-GB")} ${name} XP.`);
  }
  const extra = wanted >= held ? held - count : 0;
  if (extra > 0) {
    player.getInventory().delete(I.GLISTENING_TEAR, extra);
    player.sendMessage(`Mairin confiscared a further ${extra.toLocaleString("en-GB")} tears; she did not approve of how many you had.`);
  }
  sendRates(player);
}

function click(event) {
  const { player } = event;
  const row = ROWS[event.childId ?? (event.buttonId & 0xffff)];
  if (!row) return false;
  const op = Number(event.opId ?? event.action);
  if (op === EXCHANGE_X) {
    const held = player.getInventory().getAmount(core.ItemIdentifiers.GLISTENING_TEAR);
    player.setEnteredAmountAction({ execute: (amount) => amount > 0 && exchange(player, row, amount) });
    player.getPacketSender().sendEnterAmountPrompt(`How many glistening tears do you wish to exchange? (${held})`);
    return true;
  }
  exchange(player, row, op === EXCHANGE_ALL ? Number.MAX_SAFE_INTEGER : AMOUNTS[op] ?? 1);
  return true;
}

function attach(api, data) {
  core = api.core;
  TRAINING = data;
  api.onNpcInteraction("Mairin", { Training: openTraining });
  api.onInterfaceActionButton(Object.keys(ROWS).map((child) => uid(Number(child))), click);
}

module.exports = { attach, _test: { perTear, rates, exchange, click, openTraining } };
