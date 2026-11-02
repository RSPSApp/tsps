/**
 * What starts a ferry (plugins/world/data/ferries.json): a ferryman's right-click option, a loc's
 * option (the Fremennik boat to Ungael, rsprox 229/2334, once Dragon Slayer II shows its Travel), a
 * transcript's travel step, a line a ferryman ends on (Veos's and Captain Bentley's talk has no
 * travel step), and `ferries:travel` { player, route } from quest plugins that own a crossing.
 *
 * The Monks of Entrana search the player first. Live (rsprox 224/1441, 230/312): Take-boat with a
 * forbidden item plays the transcript's "NO WEAPONS OR ARMOUR are permitted on holy Entrana..."
 * lines; without one, "After a quick search, the monk smiles at you and allows you to board."
 * The transcript's conditions are answered the same way, plus its impling jar and supply crate.
 */
const Common = require("./Common.Ferries");
const Voyages = require("./Voyages.Ferries");

/** Worn or carried, these slots' items with any combat bonus count as weapons or armour. */
const COMBAT_SLOTS = ["HEAD_SLOT", "CAPE_SLOT", "WEAPON_SLOT", "BODY_SLOT", "SHIELD_SLOT", "LEG_SLOT", "HANDS_SLOT", "FEET_SLOT", "AMMUNITION_SLOT"];
const ENTRANA_ROUTE = "entrana";

/** Players who sailed to Entrana this login (the transcript searches only the first time). */
const sailedToEntrana = new WeakSet();
/** The destination each player last picked from Veos's menu, for his closing line. */
const picked = new WeakMap();

function definitionName(event) {
  return event.definition?.getName?.() ?? "";
}

function itemsOf(player) {
  return [...player.getInventory().getItems(), ...player.getEquipment().getItems()]
    .filter((item) => item && item.getId?.() > 0);
}

function isWeaponOrArmour(definition) {
  const { Equipment } = Common.core;
  const slot = definition?.getEquipmentType?.()?.getSlot?.() ?? -1;
  if (!COMBAT_SLOTS.some((name) => Equipment[name] === slot)) return false;
  return (definition.getBonuses?.() ?? []).some((bonus) => Number(bonus) !== 0);
}

/** What the monks object to, by the transcript's conditions. */
function contraband(player) {
  const { ItemDefinition } = Common.core;
  const found = { forbidden: false, saradomin: false, implingJar: false, supplyCrate: false };
  for (const item of itemsOf(player)) {
    const definition = ItemDefinition.forId(item.getId());
    const name = definition?.getName?.() ?? "";
    if (/impling jar$/i.test(name)) found.implingJar = true;
    if (/^supply crate$/i.test(name)) found.supplyCrate = true;
    if (isWeaponOrArmour(definition)) {
      found.forbidden = true;
      if (/saradomin/i.test(name)) found.saradomin = true;
    }
  }
  return found;
}

function refused(found) {
  return found.forbidden || found.implingJar || found.supplyCrate;
}

/** The Monk of Entrana's transcript conditions. */
function answerEntrana({ player, definition, text }) {
  if (definition?.getName?.() !== "Monk of Entrana") return null;
  const key = Common.data.entrana.conditions[text];
  if (!key) return null;
  if (key === "firstTrip") return !sailedToEntrana.has(player);
  const found = contraband(player);
  if (key === "allowed") return !refused(found);
  if (key === "forbidden") return found.forbidden && !found.saradomin;
  return found[key];
}

function sail(player, routeName) {
  if (routeName === ENTRANA_ROUTE) sailedToEntrana.add(player);
  return Voyages.travel(player, routeName);
}

/** Take-boat at Port Sarim: the monk's search, then the boat or his refusal. */
function takeEntranaBoat(player, event) {
  if (!refused(contraband(player))) return sail(player, ENTRANA_ROUTE);
  const steps = (all) => Common.conditionSteps(all, Common.data.entrana.refusalCondition) ?? [];
  Common.playTranscript(player, Common.speaker(event), { variant: "standard-dialogue-port-sarim", exact: true, select: steps });
  return true;
}

/** The ops entry a click matches: the NPC's name and label, then its dock (base gameval or nearest tile). */
function opRoute(event) {
  const label = event.definition?.getActions?.()?.[event.clickType - 1];
  const name = definitionName(event);
  const candidates = Common.data.ops.filter((entry) => entry.npc === name && entry.option === label);
  if (!candidates.length) return null;
  const gameval = Common.npcGameval(event.npc, event.npcId);
  const here = event.npc?.getLocation?.() ?? event.player.getLocation();
  const distance = (entry) => (entry.near ? Math.hypot(here.getX() - entry.near[0], here.getY() - entry.near[1]) : 0);
  return candidates
    .filter((entry) => !entry.from || entry.from.includes(gameval))
    .sort((a, b) => distance(a) - distance(b))[0] ?? null;
}

/** A ferryman's travel option. */
function npcOption(event) {
  const entry = opRoute(event);
  if (!entry) return;
  event.handled = true;
  const { player } = event;
  if (Common.travelling(player)) return;
  if (!Common.passes(player, entry.gate)) {
    Common.playTranscript(player, Common.speaker(event), { variant: Common.data.gates[entry.gate].refusal, exact: true });
    return;
  }
  if (entry.check === "entrana") {
    takeEntranaBoat(player, event);
    return;
  }
  sail(player, entry.route);
}

/** The locs entry a click matches: the visible loc's name and label, and its base gameval. */
function locRoute(event) {
  const label = event.definition?.getInteractions?.()?.[event.clickType - 1];
  const name = event.definition?.getName?.() ?? "";
  const gameval = Common.locGameval(event.objectId);
  return (Common.data.locs ?? []).find((entry) => entry.loc === name && entry.option === label
    && (!entry.from || entry.from.includes(gameval))) ?? null;
}

/**
 * A loc's travel option. The multiloc shows it only when the player's varbit says so (the
 * Ungael boat's Travel needs ds2_frem 20 or more), and the click carries the variant they see.
 */
function locOption(event) {
  const entry = locRoute(event);
  if (!entry) return;
  event.handled = true;
  if (Common.travelling(event.player)) return;
  sail(event.player, entry.route);
}

function stepRoute(step, event) {
  if (typeof step === "string") return { route: step };
  if (step.byNpc) return { route: step.byNpc[Common.npcGameval(event.npc, event.npcId)] };
  return step;
}

/** A transcript's travel step (or the message that starts the Sailor's and the Gunnars' trips). */
function transcriptStep(event) {
  if (event.handled || !Object.hasOwn(Common.data.steps, event.stepId ?? "")) return;
  const { route, fare } = stepRoute(Common.data.steps[event.stepId], event);
  if (!route) return;
  const { player } = event;
  event.handled = true;
  event.end = true;
  if (Common.travelling(player)) return;
  if (fare) {
    const inventory = player.getInventory();
    const coins = Common.core.ItemIdentifiers.COINS;
    if (inventory.getAmount(coins) < fare) return;
    inventory.deleteNumber(coins, fare);
    inventory.refreshItems?.();
  }
  sail(player, route);
}

/**
 * A transcript's "If not already at X:" (ferries.json `here`, by NPC name): hidden where the
 * ferryman standing at X is the one being talked to.
 */
function answerHere(event) {
  const conditions = Common.data.here?.[definitionName(event)];
  if (!conditions || !Object.hasOwn(conditions, event.text ?? "")) return undefined;
  const gameval = Common.npcGameval(event.npc, event.npcId);
  return gameval ? gameval !== conditions[event.text] : undefined;
}

function lineEntries(event) {
  return Common.data.lines.filter((entry) => entry.npc === definitionName(event));
}

/** Veos's menu picks the port his closing line sails to. */
function rememberChoice(event) {
  for (const entry of lineEntries(event)) {
    const route = entry.choices?.[event.option];
    if (route) picked.set(event.player, route);
  }
}

/** Lines a ferryman sails after: Veos's "As you wish...", Captain Bentley's "Sure matey!". */
function sailAfterLine(event) {
  for (const entry of lineEntries(event)) {
    // A quest that sails after this line (Dragon Slayer II's Veos) has already said where.
    if (entry.after !== event.text || event.after) continue;
    const route = entry.route ?? picked.get(event.player);
    if (!route) continue;
    picked.delete(event.player);
    const previous = event.after;
    event.after = () => {
      previous?.();
      sail(event.player, route);
    };
  }
}

/** `ferries:travel` { player, route }: a quest plugin hands its crossing over. */
function travelEvent(request) {
  if (!request?.player) return;
  request.handled = sail(request.player, request.route);
}

function attach(api) {
  api.onNpcInteraction(npcOption);
  api.onObjectInteraction(locOption);
  api.onNpcDialogueCondition(answerEntrana);
  api.onNpcDialogueCondition(answerHere);
  api.onCustomEvent("npc-dialogue:action", transcriptStep);
  api.onCustomEvent("npc-dialogue:choice", rememberChoice);
  api.onCustomEvent("npc-dialogue:line", sailAfterLine);
  api.onCustomEvent("ferries:travel", travelEvent);
}

module.exports = { attach, npcOption, locOption, transcriptStep, answerEntrana, answerHere, contraband, sailAfterLine, rememberChoice, travelEvent };
