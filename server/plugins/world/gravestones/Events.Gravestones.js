"use strict";

/**
 * What other plugins (Death's Office) ask of a player's death storage. The emitter reads the
 * answer back from the payload.
 *
 * - `gravestones:state` { player } -> grave ({ items, fee, officeFee } or null), office
 *   (120 slots of { id, amount, fee } or null), coffer, style, metDeath, inTutorial, ironman.
 * - `gravestones:expire` { player }: the grave collapses now (Death collecting it early).
 * - `gravestones:pay-fee` { player, amount, office } -> source ("coffer", "inventory", "bank" or
 *   null), message: the death-fee payment, Coffer first.
 * - `gravestones:fee` { player, items } -> fee: what a grave of these { id, amount } would cost.
 * - `gravestones:office-take` { player, slot, count } -> taken: moves up to `count` of an office
 *   stack into the inventory, as far as it fits.
 * - `gravestones:coffer-adjust` { player, amount } -> ok: credits (or with a negative amount,
 *   spends) the Coffer; refused past 2^31-1 or below 0.
 * - `gravestones:set-style` { player, style }: the grave style bought from Death (0 basic,
 *   1 angel); a standing grave changes at once.
 * - `gravestones:met-death` { player }: the player has met Death.
 * - `gravestones:tutorial-end` { player }: the first-death tutorial is over; the timer starts.
 * Emitted: `gravestones:first-grave` { player, accepted } when a player who hasn't met Death gets
 * a grave; `gravestones:grave-location` { player, location, tile } for an instance to say where
 * its deaths' graves go.
 */
const Common = require("./Common.Gravestones");
const Storage = require("./Storage.Gravestones");
const Fees = require("./Fees.Gravestones");
const Grave = require("./Grave.Gravestones");
const Timer = require("./Timer.Gravestones");

function state(query) {
  const { player } = query;
  const iron = Common.ironmanMode(player) != null;
  const held = Storage.grave(player);
  query.grave = held
    ? {
      items: held.items.map((entry) => ({ ...entry })),
      fee: Grave.fee(player, held),
      officeFee: held.items.reduce((sum, { id, amount }) => sum + Fees.officeFee(id, iron) * amount, 0),
    }
    : null;
  query.office = Storage.office(player).map((entry) => (entry ? { ...entry, fee: Fees.officeFee(entry.id, iron) } : null));
  query.coffer = Storage.coffer(player);
  query.style = Storage.style(player);
  query.metDeath = Storage.metDeath(player);
  query.inTutorial = Storage.inTutorial(player);
  query.ironman = Common.ironmanMode(player);
}

function expire({ player }) {
  Timer.expire(player);
}

function payFee(request) {
  const { player, amount, office } = request;
  request.source = Fees.pay(player, amount);
  request.message = request.source && amount > 0 ? Fees.paymentMessage(request.source, amount, office) : null;
}

function officeTake(request) {
  const { player, slot, count } = request;
  const records = Storage.office(player);
  const entry = records[slot];
  request.taken = 0;
  if (!entry || count <= 0) return;
  const inventory = player.getInventory();
  const room = inventory.getAddableAmount(Common.toItem(entry));
  const taken = Math.min(count, entry.amount, room);
  if (taken <= 0) return;
  inventory.add(Common.toItem(entry, taken), true);
  entry.amount -= taken;
  if (entry.amount <= 0) records[slot] = null;
  Storage.setOffice(player, records);
  request.taken = taken;
}

function cofferAdjust(request) {
  const next = Storage.coffer(request.player) + Math.trunc(request.amount);
  request.ok = next >= 0 && next <= Common.MAX_STACK;
  if (request.ok) Storage.setCoffer(request.player, next);
}

function setStyle({ player, style }) {
  Storage.setStyle(player, style);
  if (Storage.grave(player)) Grave.spawn(player);
}

function metDeath({ player }) {
  Storage.setMetDeath(player);
}

function tutorialEnd({ player }) {
  Timer.startCountdown(player);
}

function feeFor(request) {
  request.fee = Fees.graveFee(request.items ?? [], Common.ironmanMode(request.player) != null);
}

function attach(api) {
  Common.bind(api);
  api.onCustomEvent("gravestones:fee", feeFor);
  api.onCustomEvent("gravestones:state", state);
  api.onCustomEvent("gravestones:expire", expire);
  api.onCustomEvent("gravestones:pay-fee", payFee);
  api.onCustomEvent("gravestones:office-take", officeTake);
  api.onCustomEvent("gravestones:coffer-adjust", cofferAdjust);
  api.onCustomEvent("gravestones:set-style", setStyle);
  api.onCustomEvent("gravestones:met-death", metDeath);
  api.onCustomEvent("gravestones:tutorial-end", tutorialEnd);
}

module.exports = { attach };
