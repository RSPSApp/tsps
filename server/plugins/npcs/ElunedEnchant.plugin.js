"use strict";

/**
 * Eluned's Enchant option: she re-enchants the crystal teleport seeds the player carries into
 * teleport crystals (docs/teleport-crystal-recharge.md).
 *
 * Wiki (Teleport crystal, Crystal teleport seed): the fee starts at 750 coins and falls by 150 each
 * time a seed is charged, down to 150 from the fifth charge on; she enchants 3 charges, or 5 once the
 * hard Western Provinces Diary is complete (5 March 2015 update). Since 20 June 2013 she recharges
 * all the player's seeds in one go, "subject to you having the right amount of coinage".
 * The lines are the Wiki transcript in npc-dialogues.json (Eluned, "enchant-option"): without a seed
 * she says she has nothing to enchant; with one she says nothing (an empty line, as transcribed) and
 * the box "Although you can't hear anything, your crystals have been chanted." follows, shown with a
 * teleport crystal. This unit answers the two conditions and does the enchanting at that box.
 *
 * Ours: the fee for several seeds is each seed's own fee in turn (the Wiki gives no bulk price);
 * with too few coins for all of them nothing is enchanted and a game message of our own says so.
 * The count of seeds charged is a saved attribute; live probably keeps it in varbit
 * mourning_eluned_chant (varp 518 bits 26-28), which nothing here sends, as no capture shows it.
 */
const RECHARGES_ATTRIBUTE = "teleport-crystal:recharges";
const NPC_NAME = "Eluned";
const VARIANT = "enchant-option";
const NO_SEED = "If the player does not have a Crystal teleport seed:";
const HAS_SEED = "If the player has a Crystal teleport seed:";
const CHANTED = "Although you can't hear anything, your crystals have been chanted.";
/** Ours: no source has a line for too few coins. */
const TOO_FEW_COINS = "You need %s coins to have your crystals enchanted.";

const FIRST_FEE = 750;
const FEE_STEP = 150;
const MIN_FEE = 150;

let pluginApi;
let core;
let ids;

/** The fee for the seed charged after `charged` earlier ones. */
function feeFor(charged) {
  return Math.max(MIN_FEE, FIRST_FEE - FEE_STEP * Math.max(0, charged));
}

function charged(player) {
  const value = Number(player.getAttribute(RECHARGES_ATTRIBUTE));
  return Number.isInteger(value) && value > 0 ? value : 0;
}

/** The fee for `seeds` seeds, each at its own place in the count. */
function totalFee(player, seeds) {
  let total = 0;
  for (let i = 0; i < seeds; i++) total += feeFor(charged(player) + i);
  return total;
}

function seedCount(player) {
  return player.getInventory().getAmount(ids.seed);
}

function westernHard(player) {
  const request = { player, diary: "western", tier: "hard", complete: false };
  pluginApi.emitCustomEvent("diary:is-complete", request);
  return request.complete === true;
}

/** The crystal a seed becomes: (5) after the hard Western Provinces Diary, otherwise (3). */
function crystalFor(player) {
  return westernHard(player) ? ids.crystal5 : ids.crystal3;
}

const isEluned = (definition) => definition?.getName?.() === NPC_NAME;

function condition({ player, definition, text }) {
  if (!isEluned(definition)) return null;
  if (text === NO_SEED) return seedCount(player) === 0;
  if (text === HAS_SEED) return seedCount(player) > 0;
  return null;
}

/** Enchants every seed carried, paying each one's fee. Returns the crystal id, or null. */
function enchant(player) {
  const seeds = seedCount(player);
  if (seeds === 0) return null;
  const fee = totalFee(player, seeds);
  const inventory = player.getInventory();
  if (inventory.getAmount(ids.coins) < fee) {
    player.sendMessage(TOO_FEW_COINS.replace("%s", fee.toLocaleString("en-GB")));
    return null;
  }
  const crystal = crystalFor(player);
  inventory.deleteNumber(ids.coins, fee);
  for (let slot = 0; slot < inventory.capacity(); slot++) {
    if (inventory.get(slot)?.getId?.() === ids.seed) inventory.setItem(slot, new core.Item(crystal, 1));
  }
  inventory.refreshItems();
  player.setAttribute(RECHARGES_ATTRIBUTE, charged(player) + seeds);
  return crystal;
}

/** The "chanted" box: the enchanting happens here, shown with the new crystal. */
function action(event) {
  if (event.kind !== "message" || event.text !== CHANTED || !isEluned(event.definition)) return;
  event.handled = true;
  const crystal = enchant(event.player);
  if (crystal === null) {
    event.end = true;
    return;
  }
  event.box = { items: [crystal] };
}

/** Too few coins ends it before her empty line, so the conversation shows nothing. */
function enchantOption({ player, npc, npcId, definition }) {
  const seeds = seedCount(player);
  if (seeds > 0 && player.getInventory().getAmount(ids.coins) < totalFee(player, seeds)) {
    player.sendMessage(TOO_FEW_COINS.replace("%s", totalFee(player, seeds).toLocaleString("en-GB")));
    return true;
  }
  const request = {
    player, npc, npcId: npcId ?? npc?.getId?.(), definition, variant: VARIANT, exact: true, handled: false,
  };
  pluginApi.emitCustomEvent("npc-dialogue:start", request);
  return request.handled === true;
}

module.exports = {
  name: "ElunedEnchant",
  description: "Eluned's Enchant: recharges carried crystal teleport seeds into teleport crystals (3 charges, 5 after the hard Western Provinces Diary) for 750 coins falling to 150.",
  members: true,
  _test: { RECHARGES_ATTRIBUTE, TOO_FEW_COINS, feeFor, totalFee },
  register(api) {
    pluginApi = api;
    core = api.core;
    const { ItemIdentifiers } = core;
    ids = {
      seed: ItemIdentifiers.CRYSTAL_TELEPORT_SEED,
      crystal3: ItemIdentifiers.TELEPORT_CRYSTAL_3_,
      crystal5: ItemIdentifiers.TELEPORT_CRYSTAL_5_,
      coins: ItemIdentifiers.COINS,
    };
    api.persistAttribute(RECHARGES_ATTRIBUTE, 0);
    api.onNpcInteraction(NPC_NAME, { Enchant: enchantOption });
    api.onNpcDialogueCondition(condition);
    api.onCustomEvent("npc-dialogue:action", action);
  },
};
