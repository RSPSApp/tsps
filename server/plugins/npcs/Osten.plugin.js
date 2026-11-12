/**
 * Osten, Kourend's tailor in Shayzien, recolours graceful pieces to represent a city of Great Kourend
 * (https://oldschool.runescape.wiki/w/Graceful_outfit#Recolouring). A piece used on him is recoloured
 * for 15 marks of grace, one piece at a time; each house's colour needs that house's quest, and
 * Kourend's own colours (the ones he wears) need all five. A recoloured piece can be reverted to plain
 * free of charge, with nothing refunded.
 *
 * His lines are the transcript in npc-dialogues.json. This plugin answers its marks conditions, fills
 * the "[Name of Zeah house]" choice with the houses the player has unlocked (ours: locked ones and the
 * piece's own colour are left out), and recolours or reverts the piece when the player picks.
 * Variant ids are the colour rows of plugins/items/data/ornament-kits.json.
 */
const KITS = require("../items/data/ornament-kits.json");

const OSTEN = "Osten";
const COST = 15;
const VARIANT_PLAIN = "using-uncoloured-graceful-outfit-pieces-on-osten";
const VARIANT_COLOURED = "using-already-coloured-graceful-outfit-pieces-on-osten";
const HOUSE_PLACEHOLDER = "[Name of Zeah house].";
const OSTENS_COLOURS = "I want the colours you're wearing.";
const REVERT_CONFIRM = "Yes, I'm sure.";
const HAS_MARKS = "If the player has 15 Marks of Grace";
const LACKS_MARKS = /^If the player has less than 15 Marks of Grace:?$/;
const RECOLOUR_ACTION = "osten:recolour";
const REVERT_ACTION = "osten:revert";

/** Each house and the quest its colour needs, in the transcript's choice order. */
const HOUSES = [
  { house: "Arceuus", quest: "The Ascent of Arceuus" },
  { house: "Hosidius", quest: "The Depths of Despair" },
  { house: "Lovakengj", quest: "The Forsaken Tower" },
  { house: "Piscarilius", quest: "The Queen of Thieves" },
  { house: "Shayzien", quest: "Tale of the Righteous" },
];
const KOUREND = "Kourend";
const ALL_HOUSES = [...HOUSES.map(({ house }) => house), KOUREND];

let api = null;
let core = null;
/** Plain piece id -> { house -> coloured id }. */
const colouredByBase = new Map();
/** Coloured id (inventory or worn form) -> { base, house }. */
const pieceByColoured = new Map();
const pending = new WeakMap();

for (const row of KITS.kits ?? []) {
  const house = Number(row.kit) === 0 && ALL_HOUSES.find((name) => String(row.name).startsWith(`${name} graceful `));
  if (!house) continue;
  const base = Number(row.base);
  if (!colouredByBase.has(base)) colouredByBase.set(base, new Map());
  colouredByBase.get(base).set(house, Number(row.result));
  pieceByColoured.set(Number(row.result), { base, house });
  if (Number(row.worn) > 0) pieceByColoured.set(Number(row.worn), { base, house });
}

function questComplete(player, name) {
  const request = { player, name, complete: null };
  api.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

function unlocked(player, house) {
  if (house === KOUREND) return HOUSES.every(({ quest }) => questComplete(player, quest));
  const entry = HOUSES.find((candidate) => candidate.house === house);
  return !!entry && questComplete(player, entry.quest);
}

function marks(player) {
  return player.getInventory().getAmount(core.ItemIdentifiers.MARK_OF_GRACE);
}

function isOsten({ definition, npcId }) {
  return definition?.getName?.() === OSTEN || npcId === core.NpcIdentifiers.OSTEN;
}

/** The transcript's marks conditions, judged on the marks carried. */
function condition(event) {
  if (!isOsten(event)) return null;
  if (event.text === HAS_MARKS) return marks(event.player) >= COST;
  if (LACKS_MARKS.test(event.text)) return marks(event.player) < COST;
  return null;
}

function recolourOption(house, text = `${house}.`) {
  return { text, steps: [{ player: text }, { type: "action", action: RECOLOUR_ACTION, target: house }] };
}

/** The variant with its choices filled in for this player and piece. */
function fillChoices(steps, player, current) {
  const available = (house) => house !== current && unlocked(player, house);
  const visit = (list) => (list ?? []).flatMap((step) => {
    if (step?.type !== "choice") return [step.steps ? { ...step, steps: visit(step.steps) } : step];
    const options = step.options.flatMap((option) => {
      if (option.text === HOUSE_PLACEHOLDER) {
        return HOUSES.map(({ house }) => house).filter(available).map((house) => recolourOption(house));
      }
      if (option.text === OSTENS_COLOURS) {
        return available(KOUREND) ? [recolourOption(KOUREND, OSTENS_COLOURS)] : [];
      }
      if (option.text === REVERT_CONFIRM) {
        return [{ ...option, steps: [...visit(option.steps), { type: "action", action: REVERT_ACTION }] }];
      }
      return [{ ...option, steps: visit(option.steps) }];
    });
    return [{ ...step, options }];
  });
  return visit(steps);
}

function slotOf(player, item, slot) {
  const items = player.getInventory().getItems();
  return Number.isInteger(slot) && items[slot] === item ? slot : items.indexOf(item);
}

/** A plain or Kourend-coloured graceful piece used on Osten. */
function useOnOsten(event) {
  const { player, item, itemId } = event;
  if (!isOsten(event)) return;
  const coloured = pieceByColoured.get(itemId);
  const base = coloured ? coloured.base : colouredByBase.has(itemId) ? itemId : null;
  if (base == null || !item) return;
  pending.set(player, { item, itemId, base, house: coloured?.house ?? null, slot: slotOf(player, item, event.slot) });
  const request = {
    player, npc: event.target, npcId: event.npcId, variant: coloured ? VARIANT_COLOURED : VARIANT_PLAIN, exact: true,
    select: (steps) => fillChoices(steps, player, coloured?.house ?? null), handled: false,
  };
  api.emitCustomEvent("npc-dialogue:start", request);
  event.handled = request.handled;
  if (!request.handled) pending.delete(player);
}

/** The piece used on him, if it is still that piece in that slot. */
function stillHeld(player) {
  const request = pending.get(player);
  pending.delete(player);
  if (!request || request.slot < 0) return null;
  const inventory = player.getInventory();
  return inventory.getItems()[request.slot] === request.item && request.item.getId() === request.itemId ? request : null;
}

/** The conversation ends with the recolour, as the transcript's does. */
function recolour(action) {
  if (action.action !== RECOLOUR_ACTION || !isOsten(action)) return;
  action.handled = true;
  action.end = true;
  const { player } = action;
  const request = stillHeld(player);
  const result = request && colouredByBase.get(request.base)?.get(action.target);
  if (!result || !unlocked(player, action.target) || marks(player) < COST) return;
  player.getInventory().deleteNumber(core.ItemIdentifiers.MARK_OF_GRACE, COST);
  request.item.setId(result);
  player.getInventory().refreshItems();
}

/** Reverting gives the plain piece back; the marks it cost are not returned. */
function revert(action) {
  if (action.action !== REVERT_ACTION || !isOsten(action)) return;
  action.handled = true;
  action.end = true;
  const request = stillHeld(action.player);
  if (!request || request.house == null) return;
  request.item.setId(request.base);
  action.player.getInventory().refreshItems();
}

function logout({ player }) {
  pending.delete(player);
}

module.exports = {
  name: "Osten",
  description: "Lets Osten recolour graceful pieces to the Kourend house colours for 15 marks of grace each, after each house's quest, and revert them for free.",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    core = api.core;
    api.onNpcDialogueCondition(condition);
    api.onItemOnNpc(useOnOsten, { noted: false });
    api.onCustomEvent("npc-dialogue:action", recolour);
    api.onCustomEvent("npc-dialogue:action", revert);
    api.onPlayerLogout(logout);
  },
};
