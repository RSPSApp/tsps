/**
 * Scythe of Vitur (Wiki: Scythe of Vitur): against a large target each swing lands
 * as many hits as the target is wide, up to three - one on a 1x1, two on a 2x2,
 * three on a 3x3 or larger. Each hit rolls its own accuracy and damage, and each
 * hit's max is half the one before, rounded down (47 -> 23 -> 11).
 *
 * Charging (Wiki): one vial of blood and 200 blood runes add 100 charges, up to
 * 20,000. One charge is spent per attack as long as at least one of the swing's
 * hits deals damage; at zero it reverts to the uncharged scythe, which still
 * attacks with its weaker uncharged stats. Uncharging clears the charges without
 * returning the materials - in OSRS only the vyre well returns them, and the
 * well is not modelled here.
 *
 * Not modelled: the 1x3 arc that hits three 1x1 targets side by side in multi.
 */
const MAX_CHARGES = 20000;
const CHARGES_PER_VIAL = 100;
const BLOOD_RUNES_PER_VIAL = 200;
const CHARGE_META_KEY = "scythe-of-vitur-charges";
const MAX_HITS = 3;
const SCYTHES = new Set(["scythe of vitur", "holy scythe of vitur", "sanguine scythe of vitur"]);

let core;
let scytheMethod = null;
let chargedIds = new Set();
let unchargedByCharged = new Map();
let chargedByUncharged = new Map();
let bloodRuneId = -1;
let vialOfBloodId = -1;

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
  const left = charges(item) - 1;
  if (left <= 0) {
    swapToUncharged(player, item);
    player.sendMessage("Your scythe of vitur has run out of charges.");
    return;
  }
  item.setMetaValue(CHARGE_META_KEY, left);
}

function createMethod() {
  const { MeleeCombatMethod, PendingHit, CombatFactory, DamageFormulas } = core;
  return new (class ScytheCombatMethod extends MeleeCombatMethod {
    hits(character, target) {
      const maxHit = DamageFormulas.calculateMaxMeleeHit(character);
      const hits = [];
      for (let index = 0; index < hitCount(target); index++) {
        const hit = new PendingHit(character, target, this);
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

/** One vial of blood and 200 blood runes buy 100 charges, as many batches as the inventory affords (Wiki). */
function chargeScythe(event) {
  const { player, usedItem, usedWithItem, usedItemId, usedWithItemId } = event;
  const scythe = isScytheId(usedItemId) ? usedItem : isScytheId(usedWithItemId) ? usedWithItem : null;
  if (!scythe) {
    return;
  }
  const otherId = Number(scythe === usedItem ? usedWithItemId : usedItemId);
  if (otherId !== vialOfBloodId && otherId !== bloodRuneId) {
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
    inventory.getAmount(vialOfBloodId),
    Math.floor(inventory.getAmount(bloodRuneId) / BLOOD_RUNES_PER_VIAL),
    Math.floor(room / CHARGES_PER_VIAL)
  );
  if (batches < 1) {
    player.sendMessage(`You need a vial of blood and ${BLOOD_RUNES_PER_VIAL} blood runes for 100 charges.`);
    event.handled = true;
    return;
  }
  inventory.deleteNumber(vialOfBloodId, batches);
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

/** Wiki: uncharging outside the vyre well loses the materials, and the well is not modelled. */
function uncharge({ player, item }) {
  if (charges(item) <= 0) {
    player.sendMessage("Your scythe has no charges to remove.");
    return true;
  }
  swapToUncharged(player, item);
  player.sendMessage("You uncharge your scythe of vitur. The blood runes and vials of blood are lost.");
  return true;
}

module.exports = {
  name: "ScytheOfVitur",
  members: true,
  register(api) {
    core = api.core;
    const I = core.ItemIdentifiers;
    bloodRuneId = I.BLOOD_RUNE;
    vialOfBloodId = I.VIAL_OF_BLOOD_2;
    unchargedByCharged = new Map([
      [I.SCYTHE_OF_VITUR, I.SCYTHE_OF_VITUR_UNCHARGED_],
      [I.HOLY_SCYTHE_OF_VITUR, I.HOLY_SCYTHE_OF_VITUR_UNCHARGED_],
      [I.SANGUINE_SCYTHE_OF_VITUR, I.SANGUINE_SCYTHE_OF_VITUR_UNCHARGED_],
    ]);
    chargedIds = new Set(unchargedByCharged.keys());
    chargedByUncharged = new Map([...unchargedByCharged].map(([charged, uncharged]) => [uncharged, charged]));
    api.onItemAction("Scythe of Vitur", { Check: checkCharges, Uncharge: uncharge });
    api.onItemAction("Holy Scythe of Vitur", { Check: checkCharges, Uncharge: uncharge });
    api.onItemAction("Sanguine Scythe of Vitur", { Check: checkCharges, Uncharge: uncharge });
    api.onItemOnItem(chargeScythe, { noted: false });
    api.registerCombatMethodResolver({ resolve: resolveScythe });
  },
  _test: {
    hitCount,
    hitMax,
    charges,
    consumeSwingCharge,
    chargeScythe,
    checkCharges,
    uncharge,
    MAX_CHARGES,
    CHARGES_PER_VIAL,
    BLOOD_RUNES_PER_VIAL,
    CHARGE_META_KEY,
  },
};
