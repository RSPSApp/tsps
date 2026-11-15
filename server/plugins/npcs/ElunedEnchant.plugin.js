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
 * she says she has nothing to enchant; with one she says nothing and the box "Although you can't
 * hear anything, your crystals have been chanted." follows, shown with a teleport crystal.
 *
 * rsprox capture local 1000233 (rev 227), Enchant on eluned_prif: with seeds and no coins she says
 * "I'm afraid you don't have enough money." (chatsad1, with a continue) and nothing changes. With
 * coins, her empty line shows as a chat box with chatchant1 and no continue; four ticks later one seed
 * per tick becomes a crystal, each paying its own 150-coin fee, and the tick after the last seed the
 * item box follows.
 *
 * Ours: with coins for some of the seeds but not all, nothing is enchanted and the no-money line is
 * said (no recording shows that case). The count of seeds charged is a saved attribute; live probably
 * keeps it in varbit mourning_eluned_chant (varp 518 bits 26-28), which no capture shows changing.
 */
const RECHARGES_ATTRIBUTE = "teleport-crystal:recharges";
const NPC_NAME = "Eluned";
const VARIANT = "enchant-option";
const NO_SEED = "If the player does not have a Crystal teleport seed:";
const HAS_SEED = "If the player has a Crystal teleport seed:";
const CHANTED = "Although you can't hear anything, your crystals have been chanted.";
/** rsprox capture local 1000233: her line when the coins do not cover the seeds. */
const TOO_FEW_COINS = "I'm afraid you don't have enough money.";
/** The chant: her empty line as live sends it, held without a continue. */
const CHANT_TEXT = "   ";
/** Ticks from the chant line to the first seed changing (capture local 1000233). */
const CHANT_TICKS = 4;

const FIRST_FEE = 750;
const FEE_STEP = 150;
const MIN_FEE = 150;

let pluginApi;
let core;
let ids;
let chantSeq;
let sadSeq;

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

function canPay(player) {
  return player.getInventory().getAmount(ids.coins) >= totalFee(player, seedCount(player));
}

/** One seed into `crystal`, paying its own fee. False when there is no seed or too few coins. */
function enchantOne(player, crystal) {
  const inventory = player.getInventory();
  const fee = feeFor(charged(player));
  if (inventory.getAmount(ids.coins) < fee) return false;
  for (let slot = 0; slot < inventory.capacity(); slot++) {
    if (inventory.get(slot)?.getId?.() !== ids.seed) continue;
    inventory.deleteNumber(ids.coins, fee);
    inventory.setItem(slot, new core.Item(crystal, 1));
    inventory.refreshItems();
    player.setAttribute(RECHARGES_ATTRIBUTE, charged(player) + 1);
    return true;
  }
  return false;
}

/**
 * The "chanted" box: her chant line shows held, then one seed a tick is enchanted, then the box
 * with the new crystal. Leaving the conversation stops the chant; seeds already done stay done.
 */
function action(event) {
  if (event.kind !== "message" || event.text !== CHANTED || !isEluned(event.definition)) return;
  event.handled = true;
  const { player } = event;
  if (seedCount(player) === 0 || !canPay(player)) {
    event.end = true;
    return;
  }
  const crystal = crystalFor(player);
  const npcId = event.npcId ?? event.definition?.getId?.();
  const manager = player.getDialogueManager();
  const { ActionDialogue, CountdownTask, DialogueChainBuilder, ItemStatementDialogue, NpcDialogue, TaskManager } = core;
  const step = () => {
    if (manager.getCurrent?.() !== chant) return;
    if (enchantOne(player, crystal)) {
      TaskManager.submit(new CountdownTask(player, 1, step));
      return;
    }
    manager.advance();
  };
  const chant = new ActionDialogue(0, { execute: () => {
    new NpcDialogue(0, npcId, CHANT_TEXT, NPC_NAME, chantSeq).sendHeld(player);
    TaskManager.submit(new CountdownTask(player, CHANT_TICKS, step));
  } }, true);
  manager.startDialogues(new DialogueChainBuilder()
    .add(chant)
    .add(new ItemStatementDialogue(1, crystal, CHANTED)));
}

/** Seeds but too few coins: her no-money line, and the transcript does not start. */
function enchantOption({ player, npc, npcId, definition }) {
  const id = npcId ?? npc?.getId?.();
  if (seedCount(player) > 0 && !canPay(player)) {
    const { DialogueChainBuilder, NpcDialogue } = core;
    player.getDialogueManager().startDialogues(new DialogueChainBuilder()
      .add(new NpcDialogue(0, id, TOO_FEW_COINS, NPC_NAME, sadSeq)));
    return true;
  }
  const request = {
    player, npc, npcId: id, definition, variant: VARIANT, exact: true, handled: false,
  };
  pluginApi.emitCustomEvent("npc-dialogue:start", request);
  return request.handled === true;
}

module.exports = {
  name: "ElunedEnchant",
  description: "Eluned's Enchant: recharges carried crystal teleport seeds into teleport crystals (3 charges, 5 after the hard Western Provinces Diary) for 750 coins falling to 150.",
  members: true,
  _test: { RECHARGES_ATTRIBUTE, TOO_FEW_COINS, CHANT_TICKS, feeFor, totalFee },
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
    chantSeq = core.CacheDefinitions.getSeqId("chatchant1");
    sadSeq = core.CacheDefinitions.getSeqId("chatsad1");
    api.persistAttribute(RECHARGES_ATTRIBUTE, 0);
    api.onNpcInteraction(NPC_NAME, { Enchant: enchantOption });
    api.onNpcDialogueCondition(condition);
    api.onCustomEvent("npc-dialogue:action", action);
  },
};
