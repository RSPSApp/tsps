/**
 * Primio and Regulus Cento's Travel between Varrock and Civitas illa Fortis, after Children of the
 * Sun, on Renu's captured flight (Renu.Quetzals.js) without a last destination.
 *
 * The first trip goes through Regulus's transcript: Travel opens its first-trip menu
 * (vmq2_first_travel 2, the shorter retry menu once it has been seen), its "Kectpl" action flies,
 * and landing records varlamore_visited, sets vmq2_first_travel 3 and resumes the transcript after
 * Kectpl with Regulus in Fortis. Its last welcome line sets vmq2_first_travel 4.
 */
const Common = require("./Common.Quetzals");
const Renu = require("./Renu.Quetzals");

const { VARLAMORE_VISITED, FIRST_TRIP_STATE } = Common;
const CHILDREN_OF_THE_SUN = "children_of_the_sun";
const FIRST_TRIP_VARIANT = "talking-in-varrock-talking-to-take-the-first-trip";
const REPEAT_FIRST_TRIP_VARIANT = "talking-in-varrock-talking-again-before-taking-the-first-trip";
const FIRST_TRIP_ACTION = "Kectpl";
const WELCOME_END = "Why don't you head on over and introduce yourself?";
const REGULUS_VARROCK_ID = 12884;
const REGULUS_FORTIS_ID = 12885;
const PRIMIO_VARROCK_ID = 12888;
const PRIMIO_FORTIS_ID = 12889;
const VARROCK_LANDING = { id: 0, x: 3281, y: 3413, z: 0 };
// Primio's landing, distinct from Renu's Fortis entry in the transport-system table.
const FORTIS_LANDING = { id: 1, x: 1700, y: 3141, z: 0 };

function startFirstTripMenu(player, firstTime) {
  if (Common.varbit(player, FIRST_TRIP_STATE) < 2) Common.setVarbits(player, { [FIRST_TRIP_STATE]: 2 });
  Common.api.emitCustomEvent("npc-dialogue:start", {
    player,
    npcId: REGULUS_VARROCK_ID,
    variant: firstTime ? FIRST_TRIP_VARIANT : REPEAT_FIRST_TRIP_VARIANT,
  });
}

/** The first-trip transcript after its Kectpl action: what Regulus says on landing. */
function firstTripArrivalTail(steps) {
  for (const step of steps ?? []) {
    if (step.type !== "choice") continue;
    for (const option of step.options ?? []) {
      const actionIndex = option.steps?.findIndex((entry) => entry.type === "action" && entry.id === FIRST_TRIP_ACTION) ?? -1;
      if (actionIndex >= 0) return option.steps.slice(actionIndex + 1);
    }
  }
  return [];
}

function arriveInFortis(player) {
  Common.setVarbits(player, { [VARLAMORE_VISITED]: 1, [FIRST_TRIP_STATE]: 3 });
  Common.api.emitCustomEvent("npc-dialogue:start", {
    player,
    npcId: REGULUS_FORTIS_ID,
    variant: FIRST_TRIP_VARIANT,
    select: firstTripArrivalTail,
  });
}

function destinationForNpc(npcId) {
  if (npcId === PRIMIO_VARROCK_ID || npcId === REGULUS_VARROCK_ID) {
    return { site: FORTIS_LANDING, firstTrip: true };
  }
  if (npcId === PRIMIO_FORTIS_ID || npcId === REGULUS_FORTIS_ID) return { site: VARROCK_LANDING, firstTrip: false };
  return null;
}

function travel(event) {
  const { player, npcId } = event;
  const destination = destinationForNpc(npcId);
  if (!destination) return false;
  event.handled = true;
  if (!Common.questComplete(player, CHILDREN_OF_THE_SUN)) {
    player.sendMessage(Common.message("childrenOfTheSun"));
    return true;
  }
  const firstTripState = Common.varbit(player, FIRST_TRIP_STATE);
  const firstTime = destination.firstTrip && Common.varbit(player, VARLAMORE_VISITED) === 0;
  if (firstTime && firstTripState < 3) {
    startFirstTripMenu(player, firstTripState < 2);
    return true;
  }
  Renu.fly(player, destination.site, { recordDestination: false, onLand: firstTime ? () => arriveInFortis(player) : undefined });
  return true;
}

function acceptFirstTrip(event) {
  if (event.stepId !== FIRST_TRIP_ACTION || event.npcId !== REGULUS_VARROCK_ID) return;
  event.handled = true;
  event.end = true;
  Renu.fly(event.player, FORTIS_LANDING, { recordDestination: false, onLand: () => arriveInFortis(event.player) });
}

function finishWelcome(event) {
  if (event.npcId !== REGULUS_FORTIS_ID || !String(event.text).endsWith(WELCOME_END)) return;
  event.after = () => Common.setVarbits(event.player, { [FIRST_TRIP_STATE]: 4 });
}

function attach(api) {
  api.onNpcInteraction("Primio", { Travel: travel });
  api.onNpcInteraction("Regulus Cento", { Travel: travel });
  api.onCustomEvent("npc-dialogue:action", acceptFirstTrip);
  api.onCustomEvent("npc-dialogue:line", finishWelcome);
}

module.exports = { attach, travel, acceptFirstTrip, finishWelcome, firstTripArrivalTail };
