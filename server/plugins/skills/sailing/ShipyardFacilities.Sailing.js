// Building facilities on a boat in the shipyard: aboard it, a Facility hotspot's Build opens the
// customisation interface (939) for that hotspot, and a built facility's Modify removes or
// replaces it. Building needs a saw and a hammer, costs the facility's materials and gives its
// Construction XP (Wiki: Facilities, sailing-parts.json); removing refunds nothing. Flow,
// animations and sounds from live captures (docs/sailing-osrs-reference.md); what a hotspot
// allows, levels and materials are the cache's.
/** Needed to build a wind or gale catcher, and kept (Wiki). */
const CAPTURED_WIND_MOTE = 31745;
const { BoatManager } = require("../../../src/main/typescript/elvarg/game/content/sailing/BoatManager");
const { Animation } = require("../../../src/main/typescript/elvarg/game/model/Animation");
const { Skill } = require("../../../src/main/typescript/elvarg/game/model/Skill");
const { Equipment } = require("../../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const { ItemIdentifiers } = require("../../../src/main/typescript/elvarg/util/ItemIdentifiers");
const { DialogueChainBuilder } = require("../../../src/main/typescript/elvarg/game/model/dialogues/builders/DialogueChainBuilder");
const { ActionDialogue } = require("../../../src/main/typescript/elvarg/game/model/dialogues/entries/impl/ActionDialogue");
const { Task } = require("../../../src/main/typescript/elvarg/game/task/Task");
const { TaskManager } = require("../../../src/main/typescript/elvarg/game/task/TaskManager");
const { DoubleItemStatementDialogue } = require("../../../src/main/typescript/elvarg/game/model/dialogues/entries/impl/DoubleItemStatementDialogue");
const { setVarbit, playSound, content } = require("./SailingContent.Sailing");
const { HOTSPOT_VARBITS } = require("./Sidepanel.Sailing");
const { sendBoatVarbits } = require("./BoatVarbits.Sailing");
const facilities = require("./BoatFacilities.Sailing");
const { fitInto } = require("./Cargo.Sailing");
const {
  aboardVisit,
  ownedBoat,
  openCustomisation,
  closeCustomisation,
  refreshCustomisation,
  isBuildTrigger,
  refusal,
  readOptionRow,
} = require("./Shipyard.Sailing");

const SEQ_BUILD = 3676; // human_poh_build
const SEQ_REMOVE = 3685; // human_throw_away
const SOUND_BUILD = 938;
const SOUND_REMOVE = 10753;

const EMPTY_HOLD_FIRST = "You'll need to empty your cargo hold first.";
const NEED_TOOLS = "You need a saw and a hammer in order to build a<br>facility.";
const SAWS = [ItemIdentifiers.SAW, ItemIdentifiers.CRYSTAL_SAW, ItemIdentifiers.AMYS_SAW];
const HAMMERS = [ItemIdentifiers.HAMMER, ItemIdentifiers.IMCANDO_HAMMER, ItemIdentifiers.IMCANDO_HAMMER_OFF_HAND_];

/** A tool carried, or wielded in either hand (an Imcando hammer, Amy's saw). */
function hasTool(player, toolIds) {
  if (toolIds.some((id) => player.getInventory().getAmount(id) > 0)) return true;
  const equipment = player.getEquipment();
  return [Equipment.WEAPON_SLOT, Equipment.SHIELD_SLOT].some((slot) => toolIds.includes(equipment.get(slot)?.getId?.()));
}

/** A facility's Construction XP, by its cache name (Wiki: Facilities). */
function facilityXp(name) {
  return content().parts?.facility_construction_xp?.[name] ?? 0;
}

let pluginApi;

/**
 * Whether the hold's cargo still fits once a hotspot holds `facility` (undefined: removed). A
 * smaller hold takes its cargo into its own slots; with more cargo than that, the player is
 * told to empty it first. Ours: the message.
 */
function cargoFitsAfter(player, boat, hotspot, facility) {
  const after = { type: boat.type, facilities: facilities.facilitiesOf(boat) };
  facilities.setFacility(after, hotspot, facility);
  if (fitInto(boat, facilities.cargoCapacityOf(after))) return true;
  player.sendMessage(EMPTY_HOLD_FIRST);
  return false;
}

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
  if (!buildOnHotspot(event.player, visit, readOptionRow(event.argsData))) refreshCustomisation(event.player);
}

/** Runs `action` once, `ticks` from now, while the player is online. */
function later(player, ticks, action) {
  TaskManager.submit(new (class extends Task {
    constructor() { super(ticks, player); }
    execute() {
      action();
      this.stop();
    }
  })());
}

/**
 * Without a saw and a hammer the customisation closes and an item box shows both, as captured.
 * Continuing it reopens the hotspot's customisation the tick after, if the player is still
 * aboard. True when the build may go on.
 */
function checkTools(player, clicked) {
  if (hasTool(player, SAWS) && hasTool(player, HAMMERS)) return true;
  closeCustomisation(player);
  const reopen = () => later(player, 1, () => {
    if (aboardVisit(player) === clicked.visit) openHotspotOptions(player, clicked);
  });
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new DoubleItemStatementDialogue(0, ItemIdentifiers.SAW, ItemIdentifiers.HAMMER, NEED_TOOLS),
    new ActionDialogue(1, { execute: reopen })));
  return false;
}

/**
 * Builds `facility` on the hotspot the customisation is open on. False if it's refused with 939
 * still open; true once built, or refused with 939 closed (no saw or hammer).
 */
function buildOnHotspot(player, visit, facility) {
  const boat = ownedBoat(player, visit.slot);
  const hotspot = visit.hotspot;
  if (!boat || facility === undefined || !facilities.allows(boat, hotspot, facility)) return false;
  if (!checkTools(player, { visit, boat, hotspot })) return true;
  const schematic = { player, row: facility, allow: null };
  pluginApi.emitCustomEvent("sailing:schematic-can-build", schematic);
  if (schematic.allow === false) return false;
  if (facilities.facilityAt(boat, hotspot) === facility) {
    player.sendMessage("Your boat already has that.");
    return false;
  }
  const requirements = facilities.facilityRequirements(facility);
  const refused = refusal(player, requirements);
  if (refused) {
    player.sendMessage(refused);
    return false;
  }
  if (!cargoFitsAfter(player, boat, hotspot, facility)) return false;
  // A catcher's captured wind mote is needed, not used up (Wiki).
  for (const [item, count] of requirements.materials) {
    if (item !== CAPTURED_WIND_MOTE) player.getInventory().delete(item, count);
  }
  facilities.setFacility(boat, hotspot, facility);
  closeCustomisation(player);
  const xp = facilityXp(requirements.name);
  if (xp > 0) player.getSkillManager().addExperience(Skill.CONSTRUCTION, xp, true);
  player.performAnimation(new Animation(SEQ_BUILD));
  playSound(player, SOUND_BUILD);
  showHotspot(player, visit, boat, hotspot);
  pluginApi.emitCustomEvent("sailing:facility-built", { player, boat, hotspot, facility });
  return true;
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
  if (!cargoFitsAfter(player, boat, hotspot, undefined)) return;
  facilities.setFacility(boat, hotspot, undefined);
  player.performAnimation(new Animation(SEQ_REMOVE));
  playSound(player, SOUND_REMOVE);
  showHotspot(player, visit, boat, hotspot);
}

module.exports = {
  register(api) {
    pluginApi = api;
    api.onObjectInteraction("Facility hotspot", { Build: openHotspot });
    api.onObjectInteraction(modifyFacility);
    api.onInterfaceActionClick(buildFacility);
  },
};
