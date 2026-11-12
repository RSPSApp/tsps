"use strict";

/**
 * Celestial ring (https://oldschool.runescape.wiki/w/Celestial_ring), from Dusuri's shop.
 *
 * - Worn, charged or not (and the celestial signet), it gives an invisible +4 Mining boost to
 *   success rolls: answered on "mining:level-boost", for rocks and crashed stars alike.
 * - Charged with stardust, one charge each, up to 10,000 ("Charge", or stardust used on it).
 *   "Uncharge" returns every charge as stardust. "Check" tells the charges.
 * - While charged, ores up to adamantite have a 1/10 chance of an extra ore, and each one mined
 *   spends a charge whether or not it procs; crashed stars spend none ("mining:extra-ore").
 *
 * The celestial signet (https://oldschool.runescape.wiki/w/Celestial_signet) is the same item
 * plus the elven signet: it takes stardust, "Check" and "Uncharge" and gives the extra ore exactly
 * like the ring ("Celestial signet" / "Celestial signet (uncharged)").
 *
 * It is sung at a singing bowl from a celestial ring, an elven signet, 1,000 stardust and 100
 * crystal shards: 70 Smithing and 70 Crafting (boostable), 5,000 XP in each, 3 ticks (Wiki). The
 * helpers who sing for players under 70 (Conwenna, Reese) are not modelled.
 *
 * The messages are not captured; the wording here is ours.
 */

const Common = require("./Common.ShootingStars");

const { DATA } = Common;
const RING = DATA.celestialRing;
const CHARGES_META_KEY = "celestial-ring:charges";

function ids() {
  const I = Common.core.ItemIdentifiers;
  return {
    uncharged: new Set([I.CELESTIAL_RING_UNCHARGED_, I.CELESTIAL_SIGNET_UNCHARGED_]),
    charged: new Set([I.CELESTIAL_RING, I.CELESTIAL_SIGNET]),
    // The ring's and the signet's uncharged and charged forms swap with each other.
    chargedOf: new Map([[I.CELESTIAL_RING_UNCHARGED_, I.CELESTIAL_RING], [I.CELESTIAL_SIGNET_UNCHARGED_, I.CELESTIAL_SIGNET]]),
    unchargedOf: new Map([[I.CELESTIAL_RING, I.CELESTIAL_RING_UNCHARGED_], [I.CELESTIAL_SIGNET, I.CELESTIAL_SIGNET_UNCHARGED_]]),
  };
}

/** "ring" or "signet", for the messages. */
function noun(item) {
  const { CELESTIAL_SIGNET, CELESTIAL_SIGNET_UNCHARGED_ } = Common.core.ItemIdentifiers;
  return item.getId() === CELESTIAL_SIGNET || item.getId() === CELESTIAL_SIGNET_UNCHARGED_ ? "signet" : "ring";
}

function charges(item) {
  const saved = Number(item?.getMetaValue?.(CHARGES_META_KEY));
  return Number.isFinite(saved) ? Math.max(0, Math.min(RING.maxCharges, Math.floor(saved))) : 0;
}

function wornRing(player) {
  const ring = player.getEquipment().getItems()[Common.core.Equipment.RING_SLOT];
  return ring && ring.getId() > 0 ? ring : null;
}

function refresh(player) {
  player.getInventory().refreshItems();
  player.getEquipment().refreshItems();
}

function addBoost(request) {
  const ring = wornRing(request.player);
  if (ring && (ids().uncharged.has(ring.getId()) || ids().charged.has(ring.getId()))) request.boost += RING.boost;
}

function extraOre(request, random = Math.random) {
  const ring = wornRing(request.player);
  if (!ring || !ids().charged.has(ring.getId()) || request.rockLevel > RING.extraOreMaxLevel) return;
  if (random() * RING.extraOreChance < 1) request.bonuses.push({});
  const left = charges(ring) - 1;
  if (left > 0) {
    ring.setMetaValue(CHARGES_META_KEY, left);
    return;
  }
  const kind = noun(ring);
  ring.setId(ids().unchargedOf.get(ring.getId()));
  ring.setMetaValue(CHARGES_META_KEY, undefined);
  refresh(request.player);
  request.player.sendMessage(`Your celestial ${kind} has run out of charges.`);
}

/** Whether this very ring is still carried: equipping it puts a copy in the ring slot (EquipPacketListener). */
function held(player, ring) {
  return [player.getInventory(), player.getEquipment()].some((container) => container.getItems().includes(ring));
}

/** Moves up to `amount` stardust from the inventory into the ring. */
function addCharges(player, ring, amount) {
  // The amount prompt outlives a slot change (wearing the ring keeps it open): charge only a ring still carried.
  if (!held(player, ring)) return;
  const inventory = player.getInventory();
  const stardust = Common.core.ItemIdentifiers.STARDUST;
  const room = RING.maxCharges - charges(ring);
  const added = Math.min(Math.floor(amount), inventory.getAmount(stardust), room);
  if (room <= 0) {
    player.sendMessage(`Your celestial ${noun(ring)} cannot hold any more charges.`);
    return;
  }
  if (!(added > 0)) {
    player.sendMessage(`You need stardust to charge the celestial ${noun(ring)}.`);
    return;
  }
  inventory.deleteNumber(stardust, added);
  if (ids().chargedOf.has(ring.getId())) ring.setId(ids().chargedOf.get(ring.getId()));
  ring.setMetaValue(CHARGES_META_KEY, charges(ring) + added);
  refresh(player);
  player.sendMessage(`You add ${added.toLocaleString("en-US")} stardust to the ${noun(ring)}. It has ${charges(ring).toLocaleString("en-US")} charges.`);
}

function charge({ player, item }) {
  player.setEnteredAmountAction({ execute: (amount) => addCharges(player, item, Number(amount)) });
  player.getPacketSender().sendEnterAmountPrompt("How much stardust would you like to add?");
}

function chargeWithStardust(event) {
  const ringIds = ids();
  const isRing = (id) => ringIds.uncharged.has(id) || ringIds.charged.has(id);
  const ring = isRing(event.usedWithItemId) ? event.usedWithItem : isRing(event.usedItemId) ? event.usedItem : null;
  if (!ring) return;
  event.handled = true;
  charge({ player: event.player, item: ring });
}

function check({ player, item }) {
  player.sendMessage(`Your celestial ${noun(item)} has ${charges(item).toLocaleString("en-US")} charges.`);
}

function uncharge({ player, item }) {
  const left = charges(item);
  const inventory = player.getInventory();
  const stardust = Common.core.ItemIdentifiers.STARDUST;
  if (left > 0 && inventory.getAmount(stardust) <= 0 && inventory.getFreeSlots() <= 0) {
    inventory.full();
    return;
  }
  const kind = noun(item);
  item.setId(ids().unchargedOf.get(item.getId()));
  item.setMetaValue(CHARGES_META_KEY, undefined);
  if (left > 0) inventory.adds(stardust, left);
  refresh(player);
  player.sendMessage(`You remove ${left.toLocaleString("en-US")} stardust from the ${kind}.`);
}

const SIGNET_LEVEL = 70;
const SIGNET_XP = 5000;
const SIGNET_STARDUST = 1000;
const SIGNET_SHARDS = 100;
const SIGNET_TICKS = 3;
const SINGING_SEQUENCE = "prif_crystal_singing";
const SINGING_SOUND = 8;
const SINGING_ATTRIBUTE = "celestial-signet:singing";

/** The elven signet itself (23943): 23944 is its noted form and 23945 its bank placeholder (cache obj.sym). */
function elvenSignet(player) {
  const { ELVEN_SIGNET } = Common.core.ItemIdentifiers;
  return player.getInventory().getItems().find((item) => item && item.getId() === ELVEN_SIGNET);
}

function ringToSing(player) {
  const { CELESTIAL_RING, CELESTIAL_RING_UNCHARGED_ } = Common.core.ItemIdentifiers;
  return player.getInventory().getItems().find((item) => item && (item.getId() === CELESTIAL_RING || item.getId() === CELESTIAL_RING_UNCHARGED_));
}

/** The inputs still in the inventory (checked again when the singing ends), or the reason they are not. */
function signetProblem(player) {
  const { Skill, ItemIdentifiers } = Common.core;
  const inventory = player.getInventory();
  const skills = player.getSkillManager();
  if (!ringToSing(player) || !elvenSignet(player)) {
    return "You need a celestial ring and an elven signet to sing a celestial signet.";
  }
  if (inventory.getAmount(ItemIdentifiers.STARDUST) < SIGNET_STARDUST || inventory.getAmount(ItemIdentifiers.CRYSTAL_SHARD) < SIGNET_SHARDS) {
    return `You need ${SIGNET_STARDUST.toLocaleString("en-US")} stardust and ${SIGNET_SHARDS} crystal shards to sing a celestial signet.`;
  }
  if (skills.getCurrentLevel(Skill.SMITHING) < SIGNET_LEVEL || skills.getCurrentLevel(Skill.CRAFTING) < SIGNET_LEVEL) {
    return `You need at least level ${SIGNET_LEVEL} Smithing and Crafting to sing a celestial signet.`;
  }
  return null;
}

function singSignet(player) {
  const problem = signetProblem(player);
  if (problem) {
    player.sendMessage(problem);
    return;
  }
  const { Skill, ItemIdentifiers } = Common.core;
  const inventory = player.getInventory();
  const ring = ringToSing(player);
  const saved = charges(ring);
  inventory.deleteNumber(ItemIdentifiers.STARDUST, SIGNET_STARDUST);
  inventory.deleteNumber(ItemIdentifiers.CRYSTAL_SHARD, SIGNET_SHARDS);
  inventory.deleteNumber(elvenSignet(player).getId(), 1);
  // The ring itself becomes the signet, so the stardust already in it is not lost.
  ring.setId(saved > 0 ? ItemIdentifiers.CELESTIAL_SIGNET : ItemIdentifiers.CELESTIAL_SIGNET_UNCHARGED_);
  inventory.refreshItems();
  const skills = player.getSkillManager();
  skills.addExperiences(Skill.SMITHING, SIGNET_XP);
  skills.addExperiences(Skill.CRAFTING, SIGNET_XP);
  player.sendMessage("You sing the crystal into a celestial signet.");
}

function useOnSingingBowl({ player }) {
  if (player.getAttribute(SINGING_ATTRIBUTE)) return true;
  const problem = signetProblem(player);
  if (problem) {
    player.sendMessage(problem);
    return true;
  }
  const { core } = Common;
  const sequence = core.CacheDefinitions?.getSeqId?.(SINGING_SEQUENCE);
  if (sequence != null) player.performAnimation(new core.Animation(sequence));
  player.getPacketSender().sendSound(SINGING_SOUND, 1, 0);
  player.setAttribute(SINGING_ATTRIBUTE, true);
  core.TaskManager.submit(new (class SingSignetTask extends core.Task {
    constructor() { super(SIGNET_TICKS, player, false); }
    execute() {
      this.stop();
      player.setAttribute(SINGING_ATTRIBUTE, false);
      singSignet(player);
    }
  })());
  return true;
}

module.exports = function attachCelestialRing(api) {
  api.onCustomEvent("mining:level-boost", addBoost);
  api.onCustomEvent("mining:extra-ore", extraOre);
  for (const name of ["Celestial ring", "Celestial signet"]) {
    api.onItemAction(`${name} (uncharged)`, { Charge: charge });
    api.onItemAction(name, { Charge: charge, Check: check, Uncharge: uncharge });
    api.onItemOnItem("Stardust", `${name} (uncharged)`, chargeWithStardust, { noted: false });
    api.onItemOnItem("Stardust", name, chargeWithStardust, { noted: false });
  }
  for (const name of ["Celestial ring", "Celestial ring (uncharged)", "Elven signet"]) {
    api.onItemOnObject(name, "Singing bowl", useOnSingingBowl, { noted: false });
  }
};

Object.assign(module.exports, { charges, addBoost, extraOre, addCharges, charge, uncharge, check, signetProblem, singSignet, useOnSingingBowl, CHARGES_META_KEY });
