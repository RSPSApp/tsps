"use strict";

/**
 * TzHaar-Ket-Keh takes a spare infernal cape for a 1/100 chance at Jal-Nib-Rek; the cape is lost
 * either way (Wiki: Infernal cape, Jal-nib-rek; his transcript in npc-dialogues.json, "I have a
 * spare infernal cape."). The words are the transcript's; this answers its conditions and rolls on
 * the final choice.
 *
 * Once TzKal-Zuk is beaten Ket-Keh also has "Exchange" (the cache's 11248, picked by
 * total_zuk_kills). His transcript's "right-click-exchange-option" has an owner of Jal-Nib-Rek
 * turned away; for anyone else its content is missing, so "Exchange" (and an infernal cape used on
 * him) goes straight to the same "Sacrifice infernal cape for a chance at Jal-Nib-Rek?" prompt. With
 * no cape to hand over, ours: a game message.
 */

const KET_KEH = "TzHaar-Ket-Keh";
// The multi-NPC spawned by the Inferno (Run.Inferno's TZHAAR_KET_KEH); its own name is "null".
const KET_KEH_ID = 7690;
const PET_CHANCE = 100;
const GAMBLE_CHOICE = /^yes, i accept that i won't get my cape back/i;
/** The transcript's roll outcomes. */
const ROLL_WON = "Nl1UrI";
const ROLL_LOST = "9NLiKz";
/** The talk option that holds the prompt, and the right-click variant. */
const SPARE_CAPE_OPTION = "Wm81Mu";
const SPARE_CAPE_VARIANT = "historical-dialogue";
const EXCHANGE_VARIANT = "right-click-exchange-option";
const NO_CAPE_MESSAGE = "You need an infernal cape to exchange with TzHaar-Ket-Keh.";

let api;
const outcomes = new WeakMap();

const isKetKeh = (definition) => definition?.getName?.() === KET_KEH;
const items = () => api.core.ItemIdentifiers;

function answer({ player, definition, text, stepId }) {
  if (!isKetKeh(definition)) return null;
  if (stepId === ROLL_WON || stepId === ROLL_LOST) {
    const outcome = outcomes.get(player);
    return outcome ? outcome.pet === (stepId === ROLL_WON) : null;
  }
  const value = String(text ?? "").toLowerCase();
  if (value.includes("has an infernal cape in their inventory")) {
    return player.getInventory().contains(items().INFERNAL_CAPE);
  }
  if (value.includes("does not own jal-nib-rek")) return !ownsJalNibRek(player);
  if (value.includes("owns jal-nib-rek")) return ownsJalNibRek(player);
  return null;
}

function ownsJalNibRek(player) {
  const request = { player, itemId: items().JAL_NIB_REK, owns: false };
  api.emitCustomEvent("pets:owns", request);
  return request.owns === true;
}

/** The spare-cape option's prompt, without the lines that lead up to it. */
function gamblePrompt(steps) {
  const find = (node) => {
    if (Array.isArray(node)) {
      for (const entry of node) {
        const found = find(entry);
        if (found) return found;
      }
      return null;
    }
    if (!node || typeof node !== "object") return null;
    if (node.id === SPARE_CAPE_OPTION && Array.isArray(node.steps)) return node.steps.filter((step) => step?.type === "choice");
    for (const value of Object.values(node)) {
      const found = find(value);
      if (found) return found;
    }
    return null;
  };
  return find(steps) ?? [];
}

function exchange({ player, npc, npcId }) {
  if (ownsJalNibRek(player)) {
    api.emitCustomEvent("npc-dialogue:start", { player, npc, npcId, variant: EXCHANGE_VARIANT, exact: true, handled: false });
    return true;
  }
  if (!player.getInventory().contains(items().INFERNAL_CAPE)) {
    player.sendMessage(NO_CAPE_MESSAGE);
    return true;
  }
  api.emitCustomEvent("npc-dialogue:start", {
    player, npc, npcId, variant: SPARE_CAPE_VARIANT, exact: true, select: gamblePrompt, handled: false,
  });
  return true;
}

function useCapeOnKetKeh(event) {
  if (event.itemId !== items().INFERNAL_CAPE) return;
  const definition = event.npc?.getDefinition?.() ?? api.core.NpcDefinition.forId(event.npcId);
  if (!isKetKeh(definition) && event.npcId !== KET_KEH_ID) return;
  event.handled = true;
  exchange(event);
}

function chose(choice) {
  if (!isKetKeh(choice.definition) || typeof choice.option !== "string" || !GAMBLE_CHOICE.test(choice.option)) return;
  const { player } = choice;
  const inventory = player.getInventory();
  if (!inventory.contains(items().INFERNAL_CAPE)) {
    choice.end = true;
    return;
  }
  inventory.delete(items().INFERNAL_CAPE, 1);
  const won = api.core.Misc.getRandom(PET_CHANCE - 1) === 0;
  if (won) api.emitCustomEvent("pets:award", { player, itemId: items().JAL_NIB_REK });
  outcomes.set(player, { pet: won });
}

module.exports = function registerInfernoCapeExchange(pluginApi) {
  api = pluginApi;
  pluginApi.onNpcDialogueCondition(answer);
  pluginApi.onCustomEvent("npc-dialogue:choice", chose);
  pluginApi.onNpcInteraction(KET_KEH, { Exchange: exchange });
  pluginApi.onItemOnNpc(useCapeOnKetKeh);
};

Object.assign(module.exports, { answer, chose, exchange, gamblePrompt, PET_CHANCE });
