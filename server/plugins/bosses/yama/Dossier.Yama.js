/**
 * The dossier's rite (Wiki: Rite of vile transference, Dossier): the first dossier opened from 100
 * Yama victories gives the rite, and a rite the player has already had becomes chasm teleport
 * scrolls. OpenableItems rolls the table and asks here before giving anything. Reading the rite
 * isn't built yet, so having received one stands in for the Wiki's "owned or used".
 */
const Common = require("./Common.Yama");

const DOSSIER_NAME = "Dossier";
const RITE_ENTRY = "RITE_OF_VILE_TRANSFERENCE";
const SCROLLS_ENTRY = "CHASM_TELEPORT_SCROLL";
const GUARANTEED_VICTORIES = 100;
const RITE_RECEIVED_ATTRIBUTE = "yama:rite-received";

function entryNamed({ tables }, item) {
  return tables[0].entries.find((entry) => entry.item === item);
}

function applyRite(request) {
  if (request.name !== DOSSIER_NAME) return;
  const { player, rolled } = request;
  const received = player.getAttribute(RITE_RECEIVED_ATTRIBUTE) === true;
  if (!received && Common.count(player, Common.SUCCESS_COUNT_ATTRIBUTE) >= GUARANTEED_VICTORIES) {
    rolled[0] = entryNamed(request, RITE_ENTRY);
  }
  if (rolled[0].item !== RITE_ENTRY) return;
  if (received) rolled[0] = entryNamed(request, SCROLLS_ENTRY);
  else player.setAttribute(RITE_RECEIVED_ATTRIBUTE, true);
}

function attachDossier(api) {
  api.persistAttribute(RITE_RECEIVED_ATTRIBUTE, false);
  api.onCustomEvent("openable-items:rolled", applyRite);
}

module.exports = { attachDossier, RITE_RECEIVED_ATTRIBUTE };
