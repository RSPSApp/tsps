// Building facilities on a boat in the shipyard: aboard it, a Facility hotspot's Build opens the
// customisation interface (939) for that hotspot, and a built facility's Modify removes or
// replaces it. Building costs the facility's materials and gives no XP; removing refunds
// nothing. Flow, animations and sounds from a live capture of building and removing a range
// (docs/sailing-osrs-reference.md); what a hotspot allows, levels and materials are the cache's.
const { BoatManager } = require("../../../src/main/typescript/elvarg/game/content/sailing/BoatManager");
const { Animation } = require("../../../src/main/typescript/elvarg/game/model/Animation");
const { setVarbit, playSound } = require("./sailingContent");
const { HOTSPOT_VARBITS } = require("./sidepanel");
const { sendBoatVarbits } = require("./boatVarbits");
const facilities = require("./boatFacilities");
const {
  aboardVisit,
  ownedBoat,
  openCustomisation,
  closeCustomisation,
  isBuildTrigger,
  refusal,
  readOptionRow,
} = require("./Shipyard.plugin");

const SEQ_BUILD = 3676; // human_poh_build
const SEQ_REMOVE = 3685; // human_throw_away
const SOUND_BUILD = 938;
const SOUND_REMOVE = 10753;

let pluginApi;

/** The hotspot a clicked deck loc stands on, for a player aboard the boat in the shipyard. */
function clickedHotspot(player, location) {
  const visit = aboardVisit(player);
  const boat = visit && ownedBoat(player, visit.slot);
  if (!boat) return undefined;
  const hotspot = facilities.hotspotAt(boat, location.x - visit.shown.deckBaseX, location.y - visit.shown.deckBaseY);
  return hotspot === undefined ? undefined : { visit, boat, hotspot };
}

/** A Facility hotspot's Build: what can be built there. Only at a shipyard. */
function openHotspot({ player, location }) {
  const clicked = clickedHotspot(player, location);
  if (!clicked) return false;
  openHotspotOptions(player, clicked);
}

function openHotspotOptions(player, { visit, boat, hotspot }) {
  openCustomisation(player, visit, hotspot, facilities.optionSlots(boat, hotspot));
}

/** Puts a hotspot's loc (its facility, or the placeholder) on the boat, and describes it. */
function showHotspot(player, visit, boat, hotspot) {
  const loc = facilities.hotspotLocs(boat, true).find((candidate) => candidate.hotspot === hotspot);
  if (loc) BoatManager.setDeckLoc(visit.shown, loc);
  setVarbit(player, HOTSPOT_VARBITS[hotspot], facilities.facilitiesOf(boat)[hotspot]);
  sendBoatVarbits(player);
}

/** A Build in the customisation interface opened on a hotspot. */
function buildFacility(event) {
  const visit = aboardVisit(event.player);
  if (!isBuildTrigger(event) || visit?.hotspot === undefined) return;
  event.handled = true;
  const { player } = event;
  const boat = ownedBoat(player, visit.slot);
  const facility = readOptionRow(event.argsData);
  const hotspot = visit.hotspot;
  if (!boat || facility === undefined || !facilities.allows(boat, hotspot, facility)) return;
  if (facilities.facilityAt(boat, hotspot) === facility) {
    player.sendMessage("Your boat already has that.");
    return;
  }
  const requirements = facilities.facilityRequirements(facility);
  const refused = refusal(player, requirements);
  if (refused) {
    player.sendMessage(refused);
    return;
  }
  for (const [item, count] of requirements.materials) player.getInventory().delete(item, count);
  facilities.setFacility(boat, hotspot, facility);
  closeCustomisation(player, visit);
  player.performAnimation(new Animation(SEQ_BUILD));
  playSound(player, SOUND_BUILD);
  showHotspot(player, visit, boat, hotspot);
}

/** A built facility's Modify, aboard in the shipyard: remove it, replace it, or leave it. */
function modifyFacility(event) {
  if (event.clickType !== 5 || event.definition?.getInteractions?.()?.[4] !== "Modify") return;
  const clicked = clickedHotspot(event.player, event.location);
  if (!clicked || facilities.facilityAt(clicked.boat, clicked.hotspot) === undefined) return;
  event.handled = true;
  pluginApi.sendMultiChatboxPrompt(event.player, "How would you like to modify this facility?",
    "Completely remove it.", (player) => confirmRemoval(player, clicked),
    "Replace it.", (player) => openHotspotOptions(player, clicked),
    "Do nothing.", () => {});
}

function confirmRemoval(player, clicked) {
  pluginApi.sendMultiChatboxPrompt(player, "Really remove it?",
    "Yes.", () => removeFacility(player, clicked),
    "No.", () => {});
}

function removeFacility(player, { visit, boat, hotspot }) {
  if (aboardVisit(player) !== visit) return;
  facilities.setFacility(boat, hotspot, undefined);
  player.performAnimation(new Animation(SEQ_REMOVE));
  playSound(player, SOUND_REMOVE);
  showHotspot(player, visit, boat, hotspot);
}

module.exports = {
  name: "SailingShipyardFacilities",
  members: true,
  register(api) {
    pluginApi = api;
    api.onObjectInteraction("Facility hotspot", { Build: openHotspot });
    api.onObjectInteraction(modifyFacility);
    api.onInterfaceActionClick(buildFacility);
  },
};
