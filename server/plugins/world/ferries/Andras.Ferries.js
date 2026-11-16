/**
 * Andras's rowing boat between Port Phasmatys and Slepe (Wiki: Andras), as rsprox recordings play it
 * (231/372, 231/392, 237/1149, 227/90; docs/andras-boat.md):
 *
 * - Two NPCs: slepe_boatman at Port Phasmatys (3671, 3543) and slepe_boatman_return at Slepe
 *   (3662, 3278). Talk-to plays his transcript (npc-dialogues.json "Andras"): at Port Phasmatys the
 *   variant before or after permanent access, at Slepe the return one.
 * - The fare: 10,000 coins carried, once per trip to Slepe, or 1,000,000 coins once for
 *   permanent access (varbit andras_perm_unlock). Paying for access shows "You pay Andras
 *   1,000,000 coins for for permanent access to his boat." in an item box with coins_10000, with
 *   synth sound 2114. The way back from Slepe is free.
 * - Travel on either Andras, or Travel on the row boats beside them (slepe_boat at Port Phasmatys,
 *   slepe_boat_return at Slepe), sails straight away with no dialogue; at Port Phasmatys without
 *   access or the fare, his "Doesn't look like you have enough money." line instead.
 * - The trip is ferries.json's "slepe" / "slepe-back" fade routes: fade out, the move two ticks
 *   later (to (3661, 3277) facing west, or (3671, 3542)), fade in two ticks after that.
 */
const Common = require("./Common.Ferries");
const Voyages = require("./Voyages.Ferries");

const PAGE = "Andras";
const PHASMATYS_NPC = "slepe_boatman";
const SLEPE_NPC = "slepe_boatman_return";
const PHASMATYS_BOAT = "slepe_boat";
const SLEPE_BOAT = "slepe_boat_return";
const TO_SLEPE = "slepe";
const TO_PHASMATYS = "slepe-back";

const FARE = 10000;
const PERMANENT_FEE = 1000000;
const PERMANENT_ATTRIBUTE = "andras:permanent-access";
const PERMANENT_VARBIT = "andras_perm_unlock";
/** The item box's coins and the sound with it (rsprox 237/1149 tick 1950). */
const PAYMENT_BOX_ITEM = "coins_10000";
const PAYMENT_SOUND = 2114;

const VARIANTS = {
  before: "standard-dialogue-port-phasmatys-before-unlocking-permanent-access",
  after: "standard-dialogue-port-phasmatys-after-unlocking-permanent-access",
  slepe: "standard-dialogue-slepe",
  travel: "right-click-travel-option-or-using-the-boat-to-travel-port-phasmatys",
};

/** The transcript's step ids: the fare, the permanent-access payment and the crossings. */
const STEPS = {
  fare: "oKRC_P",
  permanentMessage: "B-sMVT",
  toSlepe: ["DBbfR9", "h-MPdz"],
  toPhasmatys: ["PPY6Ao"],
};
const POOR_CONDITION = "If the player doesn't have at least 10,000 coins:";

let api = null;

const core = () => Common.core;
const coins = (player) => player.getInventory().getAmount(core().ItemIdentifiers.COINS);
const hasPermanentAccess = (player) => player.getAttribute(PERMANENT_ATTRIBUTE) === true;

function npcGameval(event) {
  return Common.npcGameval(event.npc, event.npcId ?? event.definition?.getId?.());
}

function isAndras(event) {
  return event?.definition?.getName?.() === PAGE || [PHASMATYS_NPC, SLEPE_NPC].includes(npcGameval(event));
}

function syncVarbit(player) {
  const id = core().CacheDefinitions.getVarbitId(PERMANENT_VARBIT);
  if (id != null) player.getPacketSender().sendVarbit(id, hasPermanentAccess(player) ? 1 : 0);
}

function selectVariant(event) {
  if (!event.player) return null;
  const gameval = npcGameval(event);
  if (gameval === SLEPE_NPC) return { page: PAGE, variant: VARIANTS.slepe };
  if (gameval !== PHASMATYS_NPC) return null;
  return { page: PAGE, variant: hasPermanentAccess(event.player) ? VARIANTS.after : VARIANTS.before };
}

function answerCondition(event) {
  if (!isAndras(event)) return null;
  // With permanent access the fare is never asked; the after-access talk's "Where's Slepe?"
  // goes on into the fare branch the transcript shares, so it counts as paid there.
  const carried = hasPermanentAccess(event.player) ? Math.max(FARE, coins(event.player)) : coins(event.player);
  switch (event.text) {
    case "If the player does not have at least 10,000 coins:": return carried < FARE;
    case "If the player has at least 10,000 coins:": return carried >= FARE;
    case "If the player does not have at least 1,000,000 coins:": return carried < PERMANENT_FEE;
    case "If the player does has at least 1,000,000 coins:": return carried >= PERMANENT_FEE;
    case "If the player has paid for permanent access:": return hasPermanentAccess(event.player);
    default: return null;
  }
}

/** Takes `amount` coins if the player still carries them (they may have dropped some mid-talk). */
function take(player, amount) {
  if (coins(player) < amount) return false;
  const inventory = player.getInventory();
  inventory.deleteNumber(core().ItemIdentifiers.COINS, amount);
  inventory.refreshItems();
  return true;
}

function sail(player, route) {
  if (Common.travelling(player)) return false;
  return Voyages.travel(player, route);
}

/** His "Doesn't look like you have enough money." line, from the right-click variant. */
function refuse(player, npc) {
  Common.playTranscript(player, { npc: npc ?? null, npcId: core().CacheDefinitions.getNpcId(PHASMATYS_NPC) }, {
    page: PAGE,
    variant: VARIANTS.travel,
    exact: true,
    select: (steps) => Common.conditionSteps(steps, POOR_CONDITION) ?? [],
  });
}

/** Port Phasmatys to Slepe: free with permanent access, else the fare, else his refusal. */
function travelToSlepe(player, npc) {
  if (Common.travelling(player)) return;
  if (!hasPermanentAccess(player)) {
    // A destination the passenger may not go to refuses before the fare is taken.
    if (!Voyages.canGo(player, TO_SLEPE)) return;
    if (!take(player, FARE)) {
      refuse(player, npc);
      return;
    }
  }
  sail(player, TO_SLEPE);
}

function travelOption(event) {
  if (npcGameval(event) === SLEPE_NPC) sail(event.player, TO_PHASMATYS);
  else travelToSlepe(event.player, event.npc);
}

/** The row boats' Travel: the same as Andras's beside them. */
function boatOption(event) {
  const gameval = Common.locGameval(event.objectId);
  if (gameval !== PHASMATYS_BOAT && gameval !== SLEPE_BOAT) return;
  const label = event.definition?.getInteractions?.()?.[event.clickType - 1];
  if (label !== "Travel") return;
  event.handled = true;
  if (gameval === SLEPE_BOAT) sail(event.player, TO_PHASMATYS);
  else travelToSlepe(event.player, null);
}

/** The talk's fare, permanent-access payment and crossings. */
function dialogueAction(event) {
  if (event.handled || !isAndras(event)) return;
  const { player } = event;
  if (event.stepId === STEPS.permanentMessage) {
    event.handled = true;
    if (!take(player, PERMANENT_FEE)) {
      // Ours: no recording drops the coins mid-talk; he ends the talk without taking anything.
      event.end = true;
      return;
    }
    player.setAttribute(PERMANENT_ATTRIBUTE, true);
    syncVarbit(player);
    player.getPacketSender().sendSound(PAYMENT_SOUND, 1, 0);
    event.box = { items: [core().CacheDefinitions.getObjId(PAYMENT_BOX_ITEM) ?? core().ItemIdentifiers.COINS] };
    api.emitCustomEvent("ferries:andras-permanent-access", { player });
    return;
  }
  if (event.stepId === STEPS.fare) {
    event.handled = true;
    if (hasPermanentAccess(player)) return;
    // A destination the passenger may not go to has said so; nothing is taken.
    if (!Voyages.canGo(player, TO_SLEPE)) {
      event.end = true;
      return;
    }
    if (take(player, FARE)) return;
    // Ours: the coins went between his question and the answer; his not-enough line, then the end.
    event.steps = [{ npc: "Doesn't look like you have enough money. I charge 10,000 coins for the journey." }, { type: "end" }];
    return;
  }
  const route = STEPS.toSlepe.includes(event.stepId) ? TO_SLEPE : STEPS.toPhasmatys.includes(event.stepId) ? TO_PHASMATYS : null;
  if (!route) return;
  event.handled = true;
  event.end = true;
  sail(player, route);
}

function attach(pluginApi) {
  api = pluginApi;
  api.persistAttribute(PERMANENT_ATTRIBUTE, false);
  api.onPlayerLogin(({ player }) => syncVarbit(player));
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:action", dialogueAction);
  api.onNpcInteraction(PAGE, { Travel: travelOption });
  api.onObjectInteraction(boatOption);
}

module.exports = {
  attach, selectVariant, answerCondition, dialogueAction, travelOption, boatOption, syncVarbit,
  PERMANENT_ATTRIBUTE, FARE, PERMANENT_FEE, VARIANTS, STEPS,
};
