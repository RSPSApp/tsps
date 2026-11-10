"use strict";

/**
 * Kolodion in the Mage Arena bank, from his Wiki transcripts (npc-dialogues.json: Transcript:Kolodion
 * and Transcript:Mage Arena II). This unit picks his variant, answers its conditions and does what
 * its steps say; the words are the transcripts'.
 *
 * - MageArenaI.MageArena.js handles the duel offer and post-duel dialogue. This unit takes
 *   over once the player chooses a god cape at the statues.
 * - After it, Mage Arena II's stage picks the variant: "starting-off" (his after-Mage-Arena-I talk
 *   with the cast thresholds, and the miniquest's start), "talking to Kolodion again" (a symbol if
 *   none is owned), a remains hand-in, "after handing in all 3 remains", and after the miniquest.
 * - Hand-ins and imbuing as a live run shows them (rsprox_transcripts/235/03344.txt): each remains
 *   is taken with "You hand Kolodion the remains of ...", the third moves straight on to "now you
 *   just need to hand me the god cape", and the cape is swapped for its imbued one.
 */
const Spells = require("./Spells.MageArena");
const Statues = require("./Statues.MageArena");
const MageArenaII = require("./MageArenaII.MageArena");

const NAME = "Kolodion";
const PAGE = "Mage Arena II";
const HALF_TRAINED = 51;
const ALMOST_TRAINED = 90;
const { STAGE } = MageArenaII;
const { GODS, CASTS_REQUIRED, chargeOf } = Spells;
const { CAPE_RECEIVED_ATTRIBUTE } = Statues;

const VARIANT = Object.freeze({
  start: "starting-off",
  again: "starting-off-talking-to-kolodion-again",
  allRemains: "starting-off-after-handing-in-all-3-remains",
  after: "talking-to-kolodion-after-the-mini-quest",
  holding: "talking-to-kolodion-after-the-mini-quest-if-remains-have-been-given-to-kolodion-but-not-yet-used-to-redeem-a-cape",
});

/** Option and message steps this unit acts on, as the transcript words them. */
const ACCEPT = "Great, I've been waiting for an improvement!";
const SYMBOL_HANDED = "Kolodion hands you an enchanted symbol.";
const CAPE_IMBUED = "Kolodion takes your cape and imbues it with the power of the gods before handing it back.";
const HOLDING_LINE = /^You may currently have .* imbued, just hand over the cape when you're ready\.$/;
/** The live run's game message as a remains changes hands (235/03344). */
const handedMessage = (follower) => `You hand Kolodion the remains of ${follower.handedIn}.`;

const NOT_MASTERED = "If player hasn't mastered all the god spells yet:";
const BELOW_MAGIC = "If player doesn't have 75 Magic:";
const READY = "If player has mastered all the god spells and is 75 Magic:";
const ROOM_FOR_SYMBOL = "If the player has room in their inventory for the symbol:";
const NO_ROOM_FOR_SYMBOL = "If the player doesn't have room in their inventory for the symbol:";
const NO_SYMBOL = "If the player doesn't have an enchanted symbol:";
const NO_SYMBOL_FULL = "If the player doesn't have an enchanted symbol and their inventory is full:";
/** "If player has cast Saradomin Strike less than 51 times:", "... at least 90 times:". */
const CAST_COUNT = /^If player has cast (.+?) (less than|at least) (\d+) times:$/;

let api;
/** Player -> the follower whose remains this Talk-to hands in, or whose cape is being imbued. */
const pending = new WeakMap();
/** Player -> the cape item they used on Kolodion. */
const usedCape = new WeakMap();

function isKolodion(event) {
  return event?.definition?.getName?.() === NAME;
}

function symbolId() {
  return api.core.ItemIdentifiers.ENCHANTED_SYMBOL;
}

/** 0: under 51 casts, 1: 51-89, 2: 90-99, 3: 100 (Transcript:Mage Arena II's thresholds). */
function tierOf(player, god) {
  const casts = chargeOf(player, god);
  if (casts >= CASTS_REQUIRED) return 3;
  if (casts >= ALMOST_TRAINED) return 2;
  if (casts >= HALF_TRAINED) return 1;
  return 0;
}

function mastered(player) {
  return GODS.every((god) => chargeOf(player, god) >= CASTS_REQUIRED);
}

function castCondition(player, match) {
  const god = GODS.find((each) => each.name === match[1]);
  if (!god) return null;
  const casts = chargeOf(player, god);
  const threshold = Number(match[3]);
  if (match[2] === "less than") return casts < threshold;
  // "at least" tiers are a ladder (51, 90, 100): only the highest one reached applies.
  const next = [HALF_TRAINED, ALMOST_TRAINED, CASTS_REQUIRED].find((value) => value > threshold);
  return casts >= threshold && (next === undefined || casts < next);
}

function hasRoom(player) {
  return player.getInventory().getFreeSlots() > 0;
}

/** Remains the player carries that Kolodion doesn't hold yet, Saradomin first. */
function remainsToHandIn(player) {
  return MageArenaII.getFollowers().find((follower) =>
    MageArenaII.carries(player, follower) && !MageArenaII.holds(player, follower)) ?? null;
}

/** Takes every carried copy of a follower's remains into Kolodion's keeping (Wiki: duplicates are all taken). */
function takeRemains(player, follower) {
  const inventory = player.getInventory();
  const amount = inventory.getAmount(follower.remainsId);
  if (amount <= 0) return false;
  inventory.delete(follower.remainsId, amount);
  MageArenaII.setComponents(player, MageArenaII.components(player) | follower.bit);
  player.sendMessage(handedMessage(follower));
  return true;
}

function pickVariant(event) {
  if (!isKolodion(event)) return null;
  const { player } = event;
  if (player?.getAttribute(CAPE_RECEIVED_ATTRIBUTE) !== true) return null;
  const stage = MageArenaII.stageOf(player);
  if (stage === STAGE.NOT_STARTED) return VARIANT.start;
  if (stage === STAGE.STARTED) return VARIANT.again;
  if (stage === STAGE.HUNTING) {
    const follower = remainsToHandIn(player);
    if (!follower) return VARIANT.again;
    pending.set(player, follower);
    return follower.handInVariant;
  }
  if (stage === STAGE.ALL_REMAINS) return VARIANT.allRemains;
  // After the miniquest he keeps remains for later capes (Wiki): carried ones go into his keeping.
  for (const follower of MageArenaII.getFollowers()) {
    if (MageArenaII.carries(player, follower)) takeRemains(player, follower);
  }
  return MageArenaII.components(player) !== 0 ? VARIANT.holding : VARIANT.after;
}

function answerCondition(event) {
  if (!isKolodion(event)) return null;
  const { player, text } = event;
  const cast = CAST_COUNT.exec(String(text ?? ""));
  if (cast) return castCondition(player, cast);
  switch (text) {
    case NOT_MASTERED: return !mastered(player);
    case BELOW_MAGIC: return !MageArenaII.hasMageArenaMagic(player);
    case READY: return mastered(player) && MageArenaII.hasMageArenaMagic(player);
    case ROOM_FOR_SYMBOL: return hasRoom(player);
    case NO_ROOM_FOR_SYMBOL: return !hasRoom(player);
    // A full pack gets the "free up a space" line instead of a symbol.
    case NO_SYMBOL: return !MageArenaII.owns(player, symbolId()) && hasRoom(player);
    case NO_SYMBOL_FULL: return !MageArenaII.owns(player, symbolId()) && !hasRoom(player);
    default: return null;
  }
}

function chooseOption({ player, option, definition }) {
  if (definition?.getName?.() !== NAME || option !== ACCEPT) return;
  if (MageArenaII.stageOf(player) === STAGE.NOT_STARTED) MageArenaII.setStage(player, STAGE.STARTED);
}

function giveSymbol(action) {
  const { player } = action;
  action.handled = true;
  if (!MageArenaII.owns(player, symbolId()) && player.getInventory().adds(symbolId(), 1)) {
    action.box = { items: [symbolId()] };
  }
  if (MageArenaII.stageOf(player) < STAGE.HUNTING) MageArenaII.setStage(player, STAGE.HUNTING);
}

/**
 * "Kolodion takes the <remains>.": into his keeping, shown as its item box. As live, any other
 * carried remains is handed in next in the same conversation, and the third moves the miniquest
 * on and goes straight to the god cape; only the last of the conversation says "we aren't
 * finished yet".
 */
function handInRemains(action, follower) {
  const { player, npc, npcId } = action;
  pending.delete(player);
  action.handled = true;
  if (!takeRemains(player, follower)) {
    action.end = true;
    return;
  }
  const last = MageArenaII.components(player) === MageArenaII.ALL_COMPONENTS;
  if (last) MageArenaII.setStage(player, STAGE.ALL_REMAINS);
  // Live, the next carried remains follows straight on in the same conversation (235/03344).
  const another = last ? null : remainsToHandIn(player);
  if (another) pending.set(player, another);
  const next = last ? { variant: { page: PAGE, variant: VARIANT.allRemains } }
    : another ? { variant: { page: PAGE, variant: another.handInVariant } }
      : { variant: { page: PAGE, variant: follower.handInVariant }, select: handInTail };
  const { DialogueChainBuilder, ItemStatementDialogue, ActionDialogue } = api.core;
  const box = new DialogueChainBuilder();
  box.add(new ItemStatementDialogue(0, follower.remainsId, String(action.text)));
  box.add(new ActionDialogue(1, { execute: () => api.emitCustomEvent("npc-dialogue:start", { player, npc, npcId, ...next }) }));
  player.getDialogueManager().startDialogues(box);
}

/**
 * A hand-in's lines after "Kolodion takes the <remains>.", without its closing "options above"
 * jump: the runtime reads that as the nearest earlier menu on the page, the symbol's god list.
 */
function handInTail(steps) {
  const taken = steps.findIndex((step) => step.type === "message");
  return steps.slice(taken + 1).filter((step, index, tail) => !(step.type === "jump" && index === tail.length - 1));
}

/** The cape Kolodion is imbuing becomes its imbued one; the first imbue completes the miniquest. */
function imbue(action, follower) {
  const { player } = action;
  pending.delete(player);
  action.handled = true;
  const inventory = player.getInventory();
  const used = usedCape.get(player);
  usedCape.delete(player);
  const cape = inventory.contains(used) ? used : follower.capeIds.find((id) => inventory.contains(id));
  if (cape === undefined || !canImbue(player, follower)) {
    action.end = true;
    return;
  }
  inventory.delete(cape, 1);
  inventory.adds(follower.imbuedId, 1);
  action.box = { items: [follower.imbuedId] };
  if (MageArenaII.stageOf(player) === STAGE.ALL_REMAINS) {
    // The live run clears every component and completes on the first imbue (235/03344).
    MageArenaII.setComponents(player, 0);
    MageArenaII.complete(player);
  } else {
    MageArenaII.setComponents(player, MageArenaII.components(player) & ~follower.bit);
  }
}

function runAction(action) {
  if (!isKolodion(action) || action.kind !== "message") return;
  if (action.text === SYMBOL_HANDED) return giveSymbol(action);
  const follower = pending.get(action.player);
  if (!follower) return;
  if (action.text === CAPE_IMBUED) return imbue(action, follower);
  if (MageArenaII.stageOf(action.player) === STAGE.HUNTING) handInRemains(action, follower);
}

/** "You may currently have a Saradomin cape, a Guthix cape and a Zamorak cape imbued": only those he holds remains for. */
function fillHoldingLine(line) {
  if (!isKolodion(line) || !HOLDING_LINE.test(String(line.text ?? ""))) return;
  const capes = MageArenaII.getFollowers().filter((follower) => MageArenaII.holds(line.player, follower))
    .map((follower) => `a ${follower.god} cape`);
  if (!capes.length) return;
  const list = capes.length === 1 ? capes[0] : `${capes.slice(0, -1).join(", ")} and ${capes.at(-1)}`;
  line.text = `You may currently have ${list} imbued, just hand over the cape when you're ready.`;
}

/** Imbuing needs all three remains the first time, then that follower's remains (held or carried). */
function canImbue(player, follower) {
  const stage = MageArenaII.stageOf(player);
  if (stage === STAGE.ALL_REMAINS) return true;
  return stage === STAGE.COMPLETE && (MageArenaII.holds(player, follower) || MageArenaII.carries(player, follower));
}

/** The cape variant's Yes/No menu when the cape can be imbued, otherwise only its "bring me the remains" line. */
function capeSteps(player, follower, steps) {
  if (canImbue(player, follower)) return steps.filter((step) => step.type !== "condition");
  return steps.filter((step) => step.type === "condition").flatMap((step) => step.steps ?? []);
}

/** A god cape used on Kolodion once he can imbue it (from all three remains handed in). */
function useCapeOnKolodion(event) {
  const { player, itemId } = event;
  if (event.definition?.getName?.() !== NAME) return;
  const follower = MageArenaII.followerByCape(itemId);
  if (!follower || MageArenaII.stageOf(player) < STAGE.ALL_REMAINS) return;
  // Post-miniquest remains in the pack are handed over first, as he keeps them (Wiki).
  if (MageArenaII.stageOf(player) === STAGE.COMPLETE && MageArenaII.carries(player, follower)) takeRemains(player, follower);
  pending.set(player, follower);
  usedCape.set(player, itemId);
  const request = {
    player, npc: event.target, npcId: event.npcId, variant: { page: PAGE, variant: follower.capeVariant },
    select: (steps) => capeSteps(player, follower, steps), handled: false,
  };
  api.emitCustomEvent("npc-dialogue:start", request);
  if (request.handled) event.handled = true;
}

module.exports = function registerKolodion(pluginApi) {
  api = pluginApi;
  api.onNpcDialogueVariant(pickVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:choice", chooseOption);
  api.onCustomEvent("npc-dialogue:action", runAction);
  api.onCustomEvent("npc-dialogue:line", fillHoldingLine);
  api.onItemOnNpc(useCapeOnKolodion);
};

Object.assign(module.exports, {
  _test: {
    VARIANT,
    tierOf,
    mastered,
    pickVariant,
    answerCondition,
    chooseOption,
    runAction,
    fillHoldingLine,
    canImbue,
    capeSteps,
    handInTail,
    useCapeOnKolodion,
  },
});
