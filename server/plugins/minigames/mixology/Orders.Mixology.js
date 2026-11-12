"use strict";

/**
 * Orders and the conveyor belt.
 *
 * - Three orders are always up (varbits 11315-11320: a potion index from enum 5542 and a
 *   modifier, 1 Homogenous, 2 Concentrated, 3 Crystalised). Each is drawn by the potion's
 *   weight among those the player's base level can make (Wiki); the HUD (script 7063) reads
 *   stat_base too.
 * - Fulfil-order deposits up to three finished potions: each fills the first open order it
 *   matches, potion and modifier both. With none matching, the first finished potion goes in
 *   unordered for a third of the XP and 10 of its best resin (lye over aga over mox). Digweed
 *   doubles a potion's XP and resin; filling two orders at once pays 20% more resin, three
 *   40% (Wiki; the Leagues captures carry the same 1.4 on their x8).
 * - A hand-in that fills at least one order also plays synth 9512 (delay 20), once however
 *   many it fills. With no finished potion carried, a message box reads "You're not carrying
 *   any finished potions." and nothing else happens.
 * - rsprox captures (4197, 1107): human_pickuptable_walkmerge, synth 2739 (delay 15), one
 *   "You deposit some <col=6800bf>Alco-augmentator</col> and fulfil an order." (or ", but fail
 *   to fulfil an order.") per potion, the resin varps, "You are rewarded <col=0000b2>336</col>/
 *   <col=06600c>448</col>/<col=e00a19>0</col>. You now have ...", every order cleared and
 *   re-drawn on the same tick, varbit 11334 (orders since the last digweed) up by one, a
 *   mm_conveor_travel_<potion> projectile per potion along the belt, and an invisible NPC
 *   (13919) on the belt that says "<col=389cff>+336 Mox</col>   <col=11ff00>+448 Aga</col>"
 *   for ten ticks. total_mixology_orders (varp 4480) counts hand-ins that filled an order.
 */

const Shared = require("./Shared.Mixology");
const Digweed = require("./Digweed.Mixology");

const ORDER_COUNT = 3;
const MODIFIERS = [Shared.MODIFIER.AGITATOR, Shared.MODIFIER.RETORT, Shared.MODIFIER.ALEMBIC];
const MULTI_ORDER_BONUS = 0.2;
const UNORDERED_RESIN = 10;
const UNORDERED_XP_DIVISOR = 3;
const DIGWEED_MULTIPLIER = 2;
const BEST_RESIN_FIRST = ["lye", "aga", "mox"];
const SOUND_DEPOSIT = 2739;
const SOUND_DEPOSIT_DELAY = 15;
const SOUND_ORDER_FILLED = 9512;
const SOUND_ORDER_FILLED_DELAY = 20;
const PROJECTILE = { delay: 10, speed: 120, height: 30, angle: 0, offset: 0 };
const CHATTER_TICKS = 10;
const CHATTER_COLOUR = { mox: "389cff", aga: "11ff00", lye: "ff242f" };
const CHATTER_GAP = "   ";
const NOTHING_TO_DEPOSIT = "You're not carrying any finished potions.";

function orders(player) {
  return Shared.VARBIT.ORDER_TYPE.map((varbit, index) => ({
    index,
    type: Shared.get(player, varbit),
    modifier: Shared.get(player, Shared.VARBIT.ORDER_MODIFIER[index]),
  }));
}

function weightedPick(entries) {
  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll < 0) return entry;
  }
  return entries[entries.length - 1];
}

/** Three new orders: different potions where the player's level allows. */
function drawOrders(player) {
  const level = Shared.herbloreBase(player);
  const eligible = [...Shared.potions().values()].filter((entry) => entry.level <= level);
  const pool = eligible.length ? eligible : [Shared.potion(1)];
  const chosen = [];
  for (let order = 0; order < ORDER_COUNT; order++) {
    const remaining = pool.filter((entry) => !chosen.includes(entry));
    chosen.push(weightedPick(remaining.length ? remaining : pool));
  }
  return chosen.map((entry) => ({ type: entry.index, modifier: MODIFIERS[Math.floor(Math.random() * MODIFIERS.length)] }));
}

function refreshOrders(player) {
  for (let order = ORDER_COUNT - 1; order >= 0; order--) {
    Shared.set(player, Shared.VARBIT.ORDER_MODIFIER[order], 0);
    Shared.set(player, Shared.VARBIT.ORDER_TYPE[order], 0);
  }
  drawOrders(player).forEach((order, index) => {
    Shared.set(player, Shared.VARBIT.ORDER_MODIFIER[index], order.modifier);
    Shared.set(player, Shared.VARBIT.ORDER_TYPE[index], order.type);
  });
}

/** A player who has never had orders gets their first three (login, state sync). */
function ensureOrders(player) {
  if (orders(player).every((order) => order.type === 0)) refreshOrders(player);
}

function finishedPotions(player) {
  const found = [];
  player.getInventory().getItems().forEach((item, slot) => {
    const entry = Shared.potionByItem(item?.getId?.());
    if (!entry || entry.finished !== item.getId()) return;
    found.push({
      slot,
      entry,
      modifier: Number(item.getMetaValue?.(Shared.META.MODIFIER)) || 0,
      digweed: item.getMetaValue?.(Shared.META.DIGWEED) === true,
    });
  });
  return found;
}

/** Each potion fills the first open order it matches; none matching, the first goes unordered. */
function choose(player) {
  const carried = finishedPotions(player);
  const open = orders(player).filter((order) => order.type !== 0);
  const deposits = [];
  for (const potion of carried) {
    const order = open.find((candidate) => !candidate.filled
      && candidate.type === potion.entry.index && candidate.modifier === potion.modifier);
    if (!order) continue;
    order.filled = true;
    deposits.push({ ...potion, ordered: true });
  }
  if (!deposits.length && carried.length) deposits.push({ ...carried[0], ordered: false });
  return deposits;
}

function rewardOf(deposit) {
  const multiplier = deposit.digweed ? DIGWEED_MULTIPLIER : 1;
  const resin = { mox: 0, aga: 0, lye: 0 };
  if (deposit.ordered) {
    for (const reagent of Shared.REAGENTS) resin[reagent] = deposit.entry.resin[reagent] * multiplier;
    return { resin, xp: deposit.entry.xp * multiplier };
  }
  const best = BEST_RESIN_FIRST.find((reagent) => deposit.entry.paste[reagent] > 0);
  resin[best] = UNORDERED_RESIN * multiplier;
  return { resin, xp: (deposit.entry.xp / UNORDERED_XP_DIVISOR) * multiplier };
}

function chatterText(resin) {
  let text = resin.mox > 0 ? `<col=${CHATTER_COLOUR.mox}>+${Shared.formatNumber(resin.mox)} Mox</col>` : "";
  if (resin.aga > 0) text += `${CHATTER_GAP}<col=${CHATTER_COLOUR.aga}>+${Shared.formatNumber(resin.aga)} Aga</col>`;
  if (resin.lye > 0) text += `${CHATTER_GAP}<col=${CHATTER_COLOUR.lye}>+${Shared.formatNumber(resin.lye)} Lye</col>`;
  return text;
}

function rewardMessage(player, gained) {
  const colours = Shared.colours(player);
  const part = (values) => Shared.REAGENTS
    .map((reagent) => `<col=${colours[reagent]}>${Shared.formatNumber(values[reagent])}</col>`)
    .join("/");
  const now = { mox: Shared.resin(player, "mox"), aga: Shared.resin(player, "aga"), lye: Shared.resin(player, "lye") };
  return `You are rewarded ${part(gained)}. You now have ${part(now)}.`;
}

/** The "+N Mox" text over the belt, carried by an invisible NPC for ten ticks. */
function showChatter(player, resin) {
  const npc = Shared.api().spawnNpc({ id: Shared.NPC.CONVEYOR_CHATTER, x: Shared.LOC.CONVEYOR.x, y: Shared.LOC.CONVEYOR.y, z: Shared.LAB.z, wanderRadius: 0, owner: player });
  if (!npc) return;
  const text = chatterText(resin);
  Shared.later(1, () => npc.forceChat(text));
  Shared.later(CHATTER_TICKS, () => Shared.api().removeNpc(npc));
}

function sendAlongBelt(player, entry) {
  const { Location, CacheDefinitions } = Shared.core();
  const graphic = CacheDefinitions.getSpotanimId(`mm_conveor_travel_${entry.code.toLowerCase()}`);
  if (graphic === null) return;
  const start = new Location(Shared.LOC.CONVEYOR.x, Shared.LOC.CONVEYOR.y, Shared.LAB.z);
  const end = new Location(Shared.LOC.CONVEYOR_END.x, Shared.LOC.CONVEYOR_END.y, Shared.LAB.z);
  player.getPacketSender().sendProjectile(start, end, 0, PROJECTILE.speed, graphic,
    PROJECTILE.height, PROJECTILE.height, null, PROJECTILE.delay, PROJECTILE.angle, PROJECTILE.offset);
}

function fulfil({ player }) {
  if (!Shared.permitted(player)) return;
  const deposits = choose(player);
  if (!deposits.length) {
    Shared.statement(player, NOTHING_TO_DEPOSIT);
    return;
  }
  const inventory = player.getInventory();
  const gained = { mox: 0, aga: 0, lye: 0 };
  let xp = 0;
  for (const deposit of deposits.slice().sort((a, b) => b.slot - a.slot)) inventory.deleteAtSlot(deposit.slot, 1, false);
  inventory.refreshItems();
  for (const deposit of deposits) {
    const reward = rewardOf(deposit);
    for (const reagent of Shared.REAGENTS) gained[reagent] += reward.resin[reagent];
    xp += reward.xp;
    const name = Shared.coloured(player, deposit.entry.name);
    player.sendMessage(deposit.ordered
      ? `You deposit some ${name} and fulfil an order.`
      : `You deposit some ${name}, but fail to fulfil an order.`);
  }
  const filled = deposits.filter((deposit) => deposit.ordered).length;
  const bonus = 1 + MULTI_ORDER_BONUS * Math.max(0, filled - 1);
  for (const reagent of Shared.REAGENTS) {
    const award = { player, minigame: "mastering-mixology", points: Math.floor(gained[reagent] * bonus) };
    Shared.api().emitCustomEvent("minigame:points", award);
    gained[reagent] = award.points;
    if (gained[reagent] > 0) Shared.setResin(player, reagent, Shared.resin(player, reagent) + gained[reagent]);
  }
  if (filled > 0) Shared.addOrdersFulfilled(player, 1);
  player.sendMessage(rewardMessage(player, gained));
  refreshOrders(player);
  Shared.set(player, Shared.VARBIT.ORDERS_SINCE_HERB, Shared.get(player, Shared.VARBIT.ORDERS_SINCE_HERB) + 1);
  Shared.addXp(player, xp);
  Shared.animate(player, "human_pickuptable_walkmerge");
  Shared.sound(player, SOUND_DEPOSIT, SOUND_DEPOSIT_DELAY);
  if (filled > 0) Shared.sound(player, SOUND_ORDER_FILLED, SOUND_ORDER_FILLED_DELAY);
  for (const deposit of deposits) sendAlongBelt(player, deposit.entry);
  showChatter(player, gained);
  Digweed.afterHandIn(player);
}

module.exports = function attachOrders(api) {
  api.onObjectInteraction(Shared.OBJECT.CONVEYOR, { "Fulfil-order": fulfil });
};

Object.assign(module.exports, { ensureOrders, refreshOrders, orders, choose, rewardOf, chatterText });
