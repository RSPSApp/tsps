/**
 * Scythe of Vitur (Wiki: Scythe of Vitur): against a large target each swing lands
 * as many hits as the target is wide, up to three - one on a 1x1, two on a 2x2,
 * three on a 3x3 or larger. Each hit rolls its own accuracy and damage, and each
 * hit's max is half the one before, rounded down (47 -> 23 -> 11).
 *
 * Charging (Wiki): the vyre well stores sets of 100 charges, each bought with one
 * vial of blood and 200 blood runes. Charge-at moves them into a scythe, up to
 * 20,000; using a charged scythe on the well deposits them back in whole sets.
 * One charge is spent per attack as long as at least one of the swing's hits deals
 * damage; at zero it reverts to the uncharged scythe, which still attacks with its
 * weaker uncharged stats. Uncharging away from the well clears the charges without
 * returning the materials.
 *
 * In multicombat the remaining hits can cleave adjacent targets in the forward 1x3 arc.
 */
const MAX_CHARGES = 20000;
const CHARGES_PER_VIAL = 100;
const BLOOD_RUNES_PER_VIAL = 200;
const WELL_MAX_CHARGES = 1000000;
/** tob_lobby_well_contents: the well's sets of 100 charges, and 33085's empty/filled transform. */
const WELL_VARBIT = 6455;
const WELL_ATTRIBUTE = "scythe-of-vitur:vyre-well-charges";
const WELL_OBJECT = "Vyre well";
const CHARGE_META_KEY = "scythe-of-vitur-charges";
const MAX_HITS = 3;
const SCYTHES = new Set(["scythe of vitur", "holy scythe of vitur", "sanguine scythe of vitur"]);

let core;
let pluginApi;
/** The area registry, for multicombat (api.getAreaManager(): api.core has no AreaManager). */
let areas;
let scytheMethod = null;
let chargedIds = new Set();
let unchargedByCharged = new Map();
let chargedByUncharged = new Map();
let bloodRuneId = -1;
/** The tradeable vial of blood (22446), then the noted one the well hands back. */
let vialIds = [];
let notedVialId = -1;

function isScytheId(id) {
  return chargedIds.has(Number(id)) || chargedByUncharged.has(Number(id));
}

function scytheItem(player) {
  const weapon = player.getEquipment().get(core.Equipment.WEAPON_SLOT);
  const id = Number(weapon?.getId?.() ?? -1);
  if (isScytheId(id)) {
    return weapon;
  }
  const name = String(core.ItemDefinition.forId(id)?.getName?.() ?? "").toLowerCase();
  return SCYTHES.has(name) ? weapon : null;
}

function wieldsScythe(player) {
  return scytheItem(player) !== null;
}

function charges(item) {
  const saved = Number(item?.getMetaValue?.(CHARGE_META_KEY));
  return Number.isFinite(saved) ? Math.max(0, Math.min(MAX_CHARGES, Math.floor(saved))) : 0;
}

function refresh(player) {
  player.getInventory()?.refreshItems?.();
  player.getEquipment()?.refreshItems?.();
}

function swapToUncharged(player, item) {
  const unchargedId = unchargedByCharged.get(item.getId());
  if (unchargedId !== undefined) {
    item.setId(unchargedId);
  }
  item.setMetaValue?.(CHARGE_META_KEY, undefined);
  refresh(player);
}

/** Hits per swing: the target's size, 1 to 3. Players are 1x1. */
function hitCount(target) {
  const size = target?.isNpc?.() ? Number(target.getAsNpc().getSize?.() ?? 1) : 1;
  return Math.max(1, Math.min(MAX_HITS, Math.trunc(size) || 1));
}

/** Max hit of the nth hit (0-based): halved, rounded down, per hit. */
function hitMax(maxHit, index) {
  return Math.floor(maxHit / 2 ** index);
}

/** One charge per attack, spent only when at least one of the swing's hits deals damage (Wiki). */
function consumeSwingCharge(player, hits) {
  const item = scytheItem(player);
  if (!item || !chargedIds.has(Number(item.getId?.() ?? -1)) || typeof item.setMetaValue !== "function") {
    return;
  }
  const dealtDamage = Array.isArray(hits) && hits.some((hit) => Number(hit?.getTotalDamage?.() ?? 0) > 0);
  if (!dealtDamage) {
    return;
  }
  // Content may spare the charge (a league fragment): the same question every melee weapon with charges asks.
  const consume = { player, itemId: item.getId(), skip: false };
  pluginApi?.emitCustomEvent("combat:melee-charge", consume);
  pluginApi?.emitCustomEvent("combat:consume-charge", consume);
  if (consume.skip) {
    return;
  }
  const left = charges(item) - 1;
  if (left <= 0) {
    swapToUncharged(player, item);
    player.sendMessage("Your scythe of vitur has run out of charges.");
    return;
  }
  item.setMetaValue(CHARGE_META_KEY, left);
}

/** The facing tile and its two neighbours form the scythe's forward arc. */
function cleaveTargets(character, target) {
  if (!character.getLocation || !target.getLocation || !areas.inMulti(character) || !areas.inMulti(target)) return [];
  const origin = character.getLocation();
  const location = target.getLocation();
  const dx = Math.sign(location.getX() - origin.getX());
  const dy = Math.sign(location.getY() - origin.getY());
  const directions = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]];
  const facing = directions.findIndex(([x, y]) => x === dx && y === dy);
  if (facing < 0) return [];
  const tiles = [-1, 0, 1].map((offset) => directions[(facing + offset + 8) % 8]);
  const found = [];
  const candidates = [];
  core.World.getNpcs().forEach((npc) => candidates.push(npc));
  core.World.getPlayers().forEach((player) => candidates.push(player));
  for (const candidate of candidates) {
    if (found.length >= MAX_HITS - hitCount(target)) break;
    if (candidate === target || candidate === character) continue;
    const at = candidate.getLocation();
    const size = candidate.isNpc() ? candidate.getAsNpc().getSize() : 1;
    if (at.getZ() !== origin.getZ() || !tiles.some(([x, y]) =>
      origin.getX() + x >= at.getX() && origin.getX() + x < at.getX() + size &&
      origin.getY() + y >= at.getY() && origin.getY() + y < at.getY() + size)) continue;
    if (core.CombatFactory.canAttackSecondaryTarget(character, target, candidate, 2)) found.push(candidate);
  }
  return found;
}

function createMethod() {
  const { MeleeCombatMethod, PendingHit, CombatFactory, DamageFormulas } = core;
  return new (class ScytheCombatMethod extends MeleeCombatMethod {
    hits(character, target) {
      const maxHit = DamageFormulas.calculateMaxMeleeHit(character);
      const hits = [];
      const budgets = new Map();
      const targets = [...Array(hitCount(target)).fill(target), ...cleaveTargets(character, target)];
      for (const [index, victim] of targets.entries()) {
        if (!budgets.has(victim)) budgets.set(victim, { remaining: victim.getHitpoints() });
        const hit = new PendingHit(character, victim, this, { damageBudget: budgets.get(victim) });
        if (index > 0) CombatFactory.applyStyleDamage(hit, hitMax(maxHit, index));
        hits.push(hit);
      }
      if (character?.isPlayer?.()) {
        consumeSwingCharge(character.getAsPlayer(), hits);
      }
      return hits;
    }
  })();
}

function resolveScythe(attacker) {
  if (!attacker?.isPlayer?.() || !wieldsScythe(attacker.getAsPlayer())) return null;
  scytheMethod ??= createMethod();
  return scytheMethod;
}

/** Vials may be noted (Wiki), so count and consume the unnoted ids before the noted one. */
function vialCount(inventory) {
  return vialIds.reduce((total, id) => total + inventory.getAmount(id), 0) + inventory.getAmount(notedVialId);
}

function takeVials(inventory, amount) {
  let left = amount;
  for (const id of [...vialIds, notedVialId]) {
    if (left <= 0) break;
    const taken = Math.min(left, inventory.getAmount(id));
    if (taken > 0) {
      inventory.deleteNumber(id, taken);
      left -= taken;
    }
  }
  return amount - left;
}

/** The well's stored charges are per player: its varbit is the player's own well state. */
function wellCharges(player) {
  const saved = Number(player.getAttribute?.(WELL_ATTRIBUTE));
  return Number.isFinite(saved) ? Math.max(0, Math.min(WELL_MAX_CHARGES, Math.floor(saved))) : 0;
}

function publishWell(player, amount) {
  const next = Math.max(0, Math.min(WELL_MAX_CHARGES, Math.floor(amount)));
  player.setAttribute?.(WELL_ATTRIBUTE, next);
  player.getPacketSender?.().sendVarbit?.(WELL_VARBIT, Math.floor(next / CHARGES_PER_VIAL));
  return next;
}

function syncWell({ player }) {
  player.getPacketSender?.().sendVarbit?.(WELL_VARBIT, Math.floor(wellCharges(player) / CHARGES_PER_VIAL));
}

/** Charge-at and item-on-well work on a scythe in either hand or inventory. */
function findScythe(player) {
  const equipped = player.getEquipment().get(core.Equipment.WEAPON_SLOT);
  if (isScytheId(equipped?.getId?.())) return equipped;
  for (const item of player.getInventory().getItems()) {
    if (item && isScytheId(item.getId())) return item;
  }
  return null;
}

function addScytheCharges(player, item, amount) {
  const added = Math.max(0, Math.min(Math.floor(amount), MAX_CHARGES - charges(item)));
  if (added <= 0) return 0;
  if (chargedByUncharged.has(item.getId())) item.setId(chargedByUncharged.get(item.getId()));
  item.setMetaValue?.(CHARGE_META_KEY, charges(item) + added);
  refresh(player);
  return added;
}

/** Fill asks for sets (100 charges each); the transcript's "charges" are those sets. */
function fillWellSets(player, requested) {
  if (requested < 1) return;
  const inventory = player.getInventory();
  const sets = Math.min(
    requested,
    Math.floor((WELL_MAX_CHARGES - wellCharges(player)) / CHARGES_PER_VIAL),
    vialCount(inventory),
    Math.floor(inventory.getAmount(bloodRuneId) / BLOOD_RUNES_PER_VIAL)
  );
  if (sets < 1) {
    player.sendMessage(`You need at least ${BLOOD_RUNES_PER_VIAL} blood runes and 1 vial of blood to start filling the well.`);
    return;
  }
  takeVials(inventory, sets);
  inventory.deleteNumber(bloodRuneId, sets * BLOOD_RUNES_PER_VIAL);
  inventory.refreshItems();
  publishWell(player, wellCharges(player) + sets * CHARGES_PER_VIAL);
  // Transcript: "You fill the well with one charge" / "with [number] charges" (each is a set).
  player.sendMessage(`You fill the well with ${sets === 1 ? "one" : sets.toLocaleString("en-US")} charge${sets === 1 ? "" : "s"}.`);
}

function fillWell({ player }) {
  if (WELL_MAX_CHARGES - wellCharges(player) < CHARGES_PER_VIAL) {
    player.sendMessage("The well is full.");
    return true;
  }
  if (vialCount(player.getInventory()) < 1 || player.getInventory().getAmount(bloodRuneId) < BLOOD_RUNES_PER_VIAL) {
    player.sendMessage(`You need at least ${BLOOD_RUNES_PER_VIAL} blood runes and 1 vial of blood to start filling the well.`);
    return true;
  }
  player.sendMessage(
    `Mixing 1 vial of blood with the power of ${BLOOD_RUNES_PER_VIAL} blood runes into this well will add ${CHARGES_PER_VIAL} charges per set.`
  );
  player.setEnteredAmountAction({
    execute: (value) => fillWellSets(player, Math.floor(Number(value) || 0)),
  });
  player.getPacketSender().sendEnterAmountPrompt("Enter amount:");
  return true;
}

function chargeScytheFromWell(player, requested) {
  if (requested < 1) return;
  const scythe = findScythe(player);
  if (!scythe) {
    player.sendMessage("You have nothing that can be charged here.");
    return;
  }
  const amount = Math.min(requested, wellCharges(player), MAX_CHARGES - charges(scythe));
  if (amount < 1) {
    player.sendMessage(MAX_CHARGES - charges(scythe) < 1 ? "Your scythe cannot hold any more charges." : "The well is empty.");
    return;
  }
  if (addScytheCharges(player, scythe, amount) < 1) return;
  publishWell(player, wellCharges(player) - amount);
  player.sendMessage(`You add ${amount.toLocaleString("en-US")} charges to your scythe.`);
}

function chargeAtWell({ player }) {
  const scythe = findScythe(player);
  if (!scythe) {
    player.sendMessage("You have nothing that can be charged here.");
    return true;
  }
  if (charges(scythe) >= MAX_CHARGES) {
    player.sendMessage("Your scythe cannot hold any more charges.");
    return true;
  }
  if (wellCharges(player) < 1) {
    player.sendMessage("The well is empty.");
    return true;
  }
  player.setEnteredAmountAction({
    execute: (value) => chargeScytheFromWell(player, Math.floor(Number(value) || 0)),
  });
  player.getPacketSender().sendEnterAmountPrompt("Enter amount:");
  return true;
}

function emptyWell({ player }) {
  const inventory = player.getInventory();
  const sets = Math.floor(wellCharges(player) / CHARGES_PER_VIAL);
  if (sets < 1) {
    player.sendMessage("The well is empty.");
    return true;
  }
  const runes = new core.Item(bloodRuneId, sets * BLOOD_RUNES_PER_VIAL);
  const vials = new core.Item(notedVialId, sets);
  if (inventory.getAddableAmount(runes) < runes.getAmount() || inventory.getAddableAmount(vials) < vials.getAmount()) {
    player.sendMessage("You don't have enough inventory space.");
    return true;
  }
  inventory.add(runes, false);
  inventory.add(vials, false);
  inventory.refreshItems();
  publishWell(player, 0);
  player.sendMessage(
    `You take ${runes.getAmount().toLocaleString("en-US")} blood runes and ${sets.toLocaleString("en-US")} vial${sets === 1 ? "" : "s"} of blood out of the well - which are magically converted to noted form.`
  );
  return true;
}

function checkWell({ player }) {
  const sets = Math.floor(wellCharges(player) / CHARGES_PER_VIAL);
  player.sendMessage(sets < 1
    ? "The well is empty."
    : `The well contains ${sets.toLocaleString("en-US")} set${sets === 1 ? "" : "s"} of ${CHARGES_PER_VIAL} charges.`);
  return true;
}

/** Using a scythe on the well drains it in whole sets, as the Wiki describes. */
function depositScythe(event) {
  const { player, itemId, item } = event;
  if (!isScytheId(itemId)) return false;
  if (core.ObjectDefinition.forPlayer(event.objectId, player)?.getName?.() !== WELL_OBJECT) return false;
  // Generic item-on-object hooks must mark the event themselves (the named overload does it).
  event.handled = true;
  const held = charges(item);
  const deposit = Math.floor(held / CHARGES_PER_VIAL) * CHARGES_PER_VIAL;
  if (deposit < CHARGES_PER_VIAL) {
    player.sendMessage("Your scythe does not have enough charges to deposit.");
    return true;
  }
  const room = WELL_MAX_CHARGES - wellCharges(player);
  if (deposit > room) {
    player.sendMessage("The well cannot hold any more charges.");
    return true;
  }
  // Draining empties the scythe; the charges below the last whole set are not deposited.
  swapToUncharged(player, item);
  publishWell(player, wellCharges(player) + deposit);
  refresh(player);
  player.sendMessage(`You deposit ${deposit.toLocaleString("en-US")} charges into the well.`);
  return true;
}

/** One vial of blood and 200 blood runes buy 100 charges, as many batches as the inventory affords (Wiki). */
function chargeScythe(event) {
  const { player, usedItem, usedWithItem, usedItemId, usedWithItemId } = event;
  const scythe = isScytheId(usedItemId) ? usedItem : isScytheId(usedWithItemId) ? usedWithItem : null;
  if (!scythe) {
    return;
  }
  const otherId = Number(scythe === usedItem ? usedWithItemId : usedItemId);
  if (!vialIds.includes(otherId) && otherId !== bloodRuneId) {
    return;
  }
  const inventory = player.getInventory();
  const room = MAX_CHARGES - charges(scythe);
  if (room < CHARGES_PER_VIAL) {
    player.sendMessage("Your scythe cannot hold any more charges.");
    event.handled = true;
    return;
  }
  const batches = Math.min(
    vialCount(inventory),
    Math.floor(inventory.getAmount(bloodRuneId) / BLOOD_RUNES_PER_VIAL),
    Math.floor(room / CHARGES_PER_VIAL)
  );
  if (batches < 1) {
    player.sendMessage(`You need a vial of blood and ${BLOOD_RUNES_PER_VIAL} blood runes for 100 charges.`);
    event.handled = true;
    return;
  }
  takeVials(inventory, batches);
  inventory.deleteNumber(bloodRuneId, batches * BLOOD_RUNES_PER_VIAL);
  if (chargedByUncharged.has(scythe.getId())) {
    scythe.setId(chargedByUncharged.get(scythe.getId()));
  }
  scythe.setMetaValue(CHARGE_META_KEY, charges(scythe) + batches * CHARGES_PER_VIAL);
  refresh(player);
  player.sendMessage(`You add ${batches * CHARGES_PER_VIAL} charges to your scythe.`);
  event.handled = true;
}

function checkCharges({ player, item }) {
  player.sendMessage(`Your scythe of vitur has ${charges(item).toLocaleString("en-US")} charges left.`);
  return true;
}

/** Wiki: uncharging outside the vyre well loses the materials (the well's Empty returns them). */
function uncharge({ player, item }) {
  if (charges(item) <= 0) {
    player.sendMessage("Your scythe has no charges to remove.");
    return true;
  }
  swapToUncharged(player, item);
  player.sendMessage("You uncharge your scythe of vitur. The blood runes and vials of blood are lost.");
  return true;
}

function initializeIds() {
  const I = core.ItemIdentifiers;
  bloodRuneId = I.BLOOD_RUNE;
  vialIds = [I.VIAL_OF_BLOOD_2];
  notedVialId = I.VIAL_OF_BLOOD_3;
  unchargedByCharged = new Map([
    [I.SCYTHE_OF_VITUR, I.SCYTHE_OF_VITUR_UNCHARGED_],
    [I.HOLY_SCYTHE_OF_VITUR, I.HOLY_SCYTHE_OF_VITUR_UNCHARGED_],
    [I.SANGUINE_SCYTHE_OF_VITUR, I.SANGUINE_SCYTHE_OF_VITUR_UNCHARGED_],
  ]);
  chargedIds = new Set(unchargedByCharged.keys());
  chargedByUncharged = new Map([...unchargedByCharged].map(([charged, uncharged]) => [uncharged, charged]));
}

module.exports = {
  name: "ScytheOfVitur",
  members: true,
  register(api) {
    core = api.core;
    pluginApi = api;
    areas = api.getAreaManager();
    api.onServerStartup(initializeIds);
    api.persistAttribute(WELL_ATTRIBUTE, 0);
    api.onItemAction("Scythe of Vitur", { Check: checkCharges, Uncharge: uncharge });
    api.onItemAction("Holy Scythe of Vitur", { Check: checkCharges, Uncharge: uncharge });
    api.onItemAction("Sanguine Scythe of Vitur", { Check: checkCharges, Uncharge: uncharge });
    api.onItemOnItem(chargeScythe, { noted: false });
    api.onItemOnObject(depositScythe);
    api.onObjectInteraction(WELL_OBJECT, {
      "Charge-at": chargeAtWell,
      Fill: fillWell,
      Check: checkWell,
      Empty: emptyWell,
    });
    api.onPlayerLogin(syncWell);
    api.registerCombatMethodResolver({ resolve: resolveScythe });
  },
  _test: {
    hitCount,
    cleaveTargets,
    hitMax,
    charges,
    consumeSwingCharge,
    chargeScythe,
    checkCharges,
    uncharge,
    wellCharges,
    fillWell,
    fillWellWithSets: fillWellSets,
    chargeAtWell,
    chargeScytheFromWell,
    emptyWell,
    checkWell,
    depositScythe,
    findScythe,
    MAX_CHARGES,
    CHARGES_PER_VIAL,
    BLOOD_RUNES_PER_VIAL,
    WELL_MAX_CHARGES,
    WELL_VARBIT,
    WELL_ATTRIBUTE,
    CHARGE_META_KEY,
  },
};
