"use strict";

/**
 * Pirate Jackie the Fruit's Agility Arena Store: the cache's omnishop (DB row
 * agilityarena_rewards_newshop) with its stock and prices (vouchers, herbs handed over noted).
 * Her Trade option and her transcript's "I'd like to trade in my tickets" open it. This unit
 * answers the two rows that are not items and the transcript's old-ticket parts.
 *
 * rsprox 75, 1102, 1738, 1863, 4308: Trade (op 3) opens the store; the info texts below; Buy
 * 1/5/10/50 on Agility XP spends that many tickets, then "You don't have enough Agility Arena
 * Tickets." when they run out.
 *
 * Wiki (Agility Arena Store, Graceful outfit, Pirate Jackie the Fruit's transcript):
 * - Agility XP: 345 per Agility arena ticket, 379.5 with Karamja gloves 2 or better equipped.
 * - Graceful recolour: 250 vouchers and the whole default outfit (the cache's cost takes the six
 *   pieces as currencies) become the Agility Arena outfit.
 * - Holding old (2996) and new tickets, "trade in my tickets" asks which shop; otherwise the new
 *   one opens. The old Ticket Exchange stays the shops.json one.
 * - A discontinued ticket used on Jackie converts them to Brimhaven vouchers. No rate is given;
 *   the transcript names one [number] for both, so this converts 1:1.
 */

const Shared = require("./Shared.BrimhavenAgilityArena");

const JACKIE = "Pirate Jackie the Fruit";
const STORE = "agilityarena_rewards_newshop";
const STORE_NAME = "Agility Arena Store";
const STOCK = { XP: "agility_arena_shop_stock_1", RECOLOUR: "agility_arena_shop_stock_4" };
const TICKET_XP = 345;
/** The outfit the recolour hands over; the cost takes graceful_<piece>, this gives graceful_<piece>_skillcapecolour. */
const RECOLOURED = ["hood", "cape", "top", "legs", "gloves", "boots"].map((piece) => `graceful_${piece}_skillcapecolour`);
const BOTH_TICKETS = "If the player has both old and new tickets:";
const CONVERT_VARIANT = "using-a-discontinued-agility-arena-ticket-on-pirate-jackie-the-fruit";
/** "Pirate Jackie the Fruit converts [number] Agility Arena Tickets into Agility Arena Vouchers". */
const CONVERT_STEP = "DTDJGP";
/** The info panel texts, as live sends them (the cache carries none). */
const DESCRIPTION = {
  agility_arena_shop_stock_1: "Grants a flat amount of Agility experience.",
  agility_arena_shop_stock_2: "A useful herb.",
  agility_arena_shop_stock_3: "A powerful herb.",
  agility_arena_shop_stock_4: "Recolours your Graceful set to be in the Brimhaven colour scheme.",
  agility_arena_shop_stock_5: "You should see the shark...",
  agility_arena_shop_stock_6: "A pack containing 100 crystals of amylase.",
};

let api = null;

function items() {
  return Shared.core().ItemIdentifiers;
}

function isJackie(definition) {
  return definition?.getName?.() === JACKIE;
}

function afterTick(action) {
  const { Task, TaskManager } = Shared.core();
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(1);
    }
    execute() {
      this.stop();
      action();
    }
  })());
}

function open(player) {
  const request = { player, shop: STORE, handled: false };
  api.emitCustomEvent("omnishop:open", request);
  return request.handled;
}

function trade({ player }) {
  return open(player);
}

/** The transcript's open_shop for the new store; the dialogue closes its chatbox first. */
function openFromDialogue(request) {
  if (request.action !== "open_shop" || request.target !== STORE_NAME) return;
  request.handled = true;
  request.end = true;
  const { player } = request;
  afterTick(() => open(player));
}

function answerCondition({ definition, text, player }) {
  if (!isJackie(definition) || text !== BOTH_TICKETS) return null;
  const inventory = player.getInventory();
  return inventory.getAmount(items().AGILITY_ARENA_TICKET) > 0
    && inventory.getAmount(items().AGILITY_ARENA_TICKET_3) > 0;
}

function describe(request) {
  if (request.shop === STORE && DESCRIPTION[request.stock]) request.description = DESCRIPTION[request.stock];
}

/** Agility XP hands over no item, so it needs no inventory space. */
function canBuy(request) {
  if (request.shop === STORE && request.stock === STOCK.XP) request.unlock = true;
}

/** Buy 5/10/50 on Agility XP spends that many tickets. */
function units(request) {
  if (request.shop === STORE && request.stock === STOCK.XP) request.single = false;
}

function recolour(player) {
  const inventory = player.getInventory();
  for (const piece of RECOLOURED) inventory.adds(Shared.core().CacheDefinitions.getObjId(piece), 1);
  inventory.refreshItems();
}

function purchase(request) {
  if (request.shop !== STORE) return;
  if (request.stock === STOCK.XP) {
    request.handled = true;
    Shared.addXp(request.player, Shared.wearsBonusGloves(request.player) ? TICKET_XP * Shared.GLOVES_XP_BONUS : TICKET_XP);
  } else if (request.stock === STOCK.RECOLOUR) {
    request.handled = true;
    recolour(request.player);
  }
}

/** The old-ticket variant with its [number] filled in: how many the player holds now. */
function withCount(steps, count) {
  return JSON.parse(JSON.stringify(steps).replaceAll("[number]", String(count)));
}

function useOldTicket(event) {
  if (event.itemId !== items().AGILITY_ARENA_TICKET) return;
  if (!isJackie(event.definition ?? event.target?.getDefinition?.())) return;
  event.handled = true;
  const count = event.player.getInventory().getAmount(items().AGILITY_ARENA_TICKET);
  api.emitCustomEvent("npc-dialogue:start", {
    player: event.player, npc: event.target, npcId: event.npcId ?? event.target?.getId?.(),
    variant: CONVERT_VARIANT, exact: true, select: (steps) => withCount(steps, count), handled: false,
  });
}

function convert(event) {
  if (event.kind !== "message" || event.stepId !== CONVERT_STEP) return;
  const inventory = event.player.getInventory();
  const count = inventory.getAmount(items().AGILITY_ARENA_TICKET);
  if (count <= 0) {
    event.handled = true;
    return;
  }
  inventory.delete(items().AGILITY_ARENA_TICKET, count);
  inventory.adds(items().BRIMHAVEN_VOUCHER, count);
  inventory.refreshItems();
}

module.exports = function attachStore(pluginApi) {
  api = pluginApi;
  api.onNpcInteraction(JACKIE, { Trade: trade });
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:action", openFromDialogue);
  api.onCustomEvent("npc-dialogue:action", convert);
  api.onCustomEvent("omnishop:describe", describe);
  api.onCustomEvent("omnishop:can-buy", canBuy);
  api.onCustomEvent("omnishop:units", units);
  api.onCustomEvent("omnishop:purchase", purchase);
  api.onItemOnNpc(useOldTicket);
};

Object.assign(module.exports, {
  open, trade, openFromDialogue, answerCondition, describe, canBuy, units, purchase, useOldTicket, convert,
  withCount, STORE, STOCK, TICKET_XP, RECOLOURED,
});
