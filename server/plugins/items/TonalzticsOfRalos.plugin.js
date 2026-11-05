"use strict";

/**
 * Tonalztics of Ralos (https://oldschool.runescape.wiki/w/Tonalztics_of_Ralos).
 *
 * A one-handed thrown weapon: 0-75% of the player's maximum ranged hit, once uncharged and
 * twice when charged, with 6/7 tiles (8/9 on Longrange). It holds up to 20,000 charges, one
 * Sunfire splinter each, and spends one charge per throw whether or not the special is used.
 * Uncharging returns every unused splinter.
 *
 * The cache has the uncharged item (28919) with Wield/Drop only and the charged item (28922)
 * with Wield, Check, Charge and Uncharge, so an uncharged one is charged by using splinters on
 * it. Its special, Division, is in combat/specials/TonalzticsOfRalos.SpecialAttack.js.
 */
const CHARGES_META_KEY = "tonalztics-of-ralos:charges";
const SHOT_EVENT = "tonalztics:shot";
const MAX_CHARGES = 20000;
const MAX_HIT_PERCENT = 75;
const CHARGED_ATTACK_ANIMATION = 10923; // HUMAN_GLAIVE_RALOS01_CHARGED_THROW
const UNCHARGED_ATTACK_ANIMATION = 10922; // HUMAN_GLAIVE_RALOS01_UNCHARGED_THROW

const shots = new WeakMap();
const methods = new WeakMap();
const pendingCharges = new WeakMap();
/** The uncharge prompt's clicked item, so a later answer cannot act on a changed stack. */
const pendingUncharges = new WeakMap();

function isTonalzticsId(api, itemId) {
  const core = api.core, ids = core.ItemIdentifiers;
  const id = Number(itemId);
  return id === ids.TONALZTICS_OF_RALOS || id === ids.TONALZTICS_OF_RALOS_UNCHARGED_;
}

function isChargedId(api, itemId) {
  const core = api.core, ids = core.ItemIdentifiers;
  return Number(itemId) === ids.TONALZTICS_OF_RALOS;
}

function weaponItem(api, player) {
  const core = api.core;
  return player.getEquipment().get(core.Equipment.WEAPON_SLOT);
}

function charges(item) {
  const saved = Number(item?.getMetaValue?.(CHARGES_META_KEY));
  return Number.isFinite(saved) ? Math.max(0, Math.min(MAX_CHARGES, Math.floor(saved))) : 0;
}

/** The item id follows the count: zero charges is the uncharged item. */
function setCharges(api, player, item, value) {
  const core = api.core, ids = core.ItemIdentifiers;
  const clamped = Math.max(0, Math.min(MAX_CHARGES, Math.floor(value)));
  item.setMetaValue(CHARGES_META_KEY, clamped > 0 ? clamped : undefined);
  item.setId(clamped > 0 ? ids.TONALZTICS_OF_RALOS : ids.TONALZTICS_OF_RALOS_UNCHARGED_);
  player.getInventory().refreshItems();
  player.getEquipment().refreshItems();
  player.getUpdateFlag().flag(core.Flag.APPEARANCE);
}

/** A charged id with no stored charges is the uncharged weapon, not a free two-hit shot. */
function normalizeEmpty(api, player, item) {
  if (!isChargedId(api, item?.getId?.()) || charges(item) > 0) {
    return false;
  }
  setCharges(api, player, item, 0);
  return true;
}

/** The final charged throw keeps its profile until hits have been prepared. */
function beginShot(api, player) {
  const item = weaponItem(api, player);
  const charged = isChargedId(api, item?.getId?.()) && charges(item) > 0;
  shots.set(player, charged);
  return charged;
}

function isShotCharged(api, player) {
  if (shots.has(player)) return shots.get(player);
  const item = weaponItem(api, player);
  return isChargedId(api, item?.getId?.()) && charges(item) > 0;
}

function clearShot({ player }) {
  shots.delete(player);
}

/** The item's combat method and separate special exchange only this shot's state. */
function handleShot(api, event) {
  if (event.action === "begin") event.charged = beginShot(api, event.player);
  else if (event.action === "end") clearShot(event);
  else event.charged = isShotCharged(api, event.player);
}

function checkAmmo(api, player) {
  const item = weaponItem(api, player);
  if (!isTonalzticsId(api, item?.getId?.())) {
    return null;
  }
  normalizeEmpty(api, player, item);
  return true;
}

/** The shared ranged-ammo owner: both forms are the weapon itself and never leave the slot. */
function decrementAmmo(api, player) {
  const item = weaponItem(api, player);
  if (!isTonalzticsId(api, item?.getId?.())) {
    return false;
  }
  normalizeEmpty(api, player, item);
  const charged = isChargedId(api, item.getId()) && charges(item) > 0;
  if (!charged) {
    return true;
  }

  // A relic may save the charge (the same hook every charged weapon asks).
  const saving = { player, itemId: item.getId(), skip: false };
  api.emitCustomEvent("combat:consume-charge", saving);
  if (saving.skip) {
    return true;
  }

  const left = charges(item) - 1;
  if (left > 0) {
    item.setMetaValue(CHARGES_META_KEY, left);
    return true;
  }
  setCharges(api, player, item, 0);
  player.sendMessage("Your Tonalztics of Ralos has run out of charges.");
  return true;
}

function ownsClickedItem(api, player, request) {
  const core = api.core;
  const container = request.interfaceId === core.Equipment.INVENTORY_INTERFACE_ID
    ? player.getEquipment()
    : player.getInventory();
  return container?.getItems?.()[request.slot] === request.item
    && request.item.getId() === request.itemId
    && charges(request.item) === request.charges;
}

function refundFits(api, inventory, amount) {
  const core = api.core, ids = core.ItemIdentifiers;
  return amount > 0 && inventory.getAddableAmount(new core.Item(ids.SUNFIRE_SPLINTERS, amount)) >= amount;
}

function completeUncharge(api, request) {
  const core = api.core, ids = core.ItemIdentifiers;
  const { player, item, charges: amount } = request;
  if (pendingUncharges.get(player) !== request) {
    return;
  }
  pendingUncharges.delete(player);
  if (!ownsClickedItem(api, player, request) || !isChargedId(api, item.getId())) {
    return;
  }
  const inventory = player.getInventory();
  if (!refundFits(api, inventory, amount)) {
    player.sendMessage("You don't have enough inventory space to uncharge your Tonalztics of Ralos.");
    return;
  }
  inventory.addItem(new core.Item(ids.SUNFIRE_SPLINTERS, amount));
  setCharges(api, player, item, 0);
  player.sendMessage(`You uncharge your Tonalztics of Ralos, regaining ${amount.toLocaleString("en-US")} sunfire splinter${amount === 1 ? "" : "s"} in the process.`);
}

function cancelUncharge(request) {
  if (pendingUncharges.get(request.player) === request) {
    pendingUncharges.delete(request.player);
  }
}

/** The cache's Uncharge option: Wiki asks first, and the refund is all-or-nothing. */
function confirmUncharge(api, event) {
  const { player, item, itemId, slot, interfaceId } = event;
  if (!isChargedId(api, item?.getId?.())) {
    return false;
  }
  if (normalizeEmpty(api, player, item)) {
    player.sendMessage("Your Tonalztics of Ralos has no charges to remove.");
    return true;
  }
  const amount = charges(item);
  const request = { player, item, itemId, slot, interfaceId, charges: amount };
  pendingUncharges.set(player, request);
  const text = `Uncharge your tonalztics? You'll regain ${amount.toLocaleString("en-US")} sunfire splinter${amount === 1 ? "" : "s"}.`;
  if (!api.sendMultiChatboxPrompt(player, text,
    "Proceed.", () => completeUncharge(api, request),
    "Cancel.", () => cancelUncharge(request))) {
    cancelUncharge(request);
  }
  return true;
}

function chargeWithSplinters(api, event) {
  const { player, usedItem, usedWithItem, usedItemId, usedWithItemId } = event;
  const weapon = isTonalzticsId(api, usedItemId) ? usedItem : isTonalzticsId(api, usedWithItemId) ? usedWithItem : null;
  const other = weapon === usedItem ? usedWithItem : usedItem;
  if (!weapon || Number(other?.getId?.()) !== api.core.ItemIdentifiers.SUNFIRE_SPLINTERS) return false;
  const inventory = player.getInventory();
  const slot = weapon === usedItem ? event.usedItemSlot : event.usedWithItemSlot;
  const otherSlot = other === usedItem ? event.usedItemSlot : event.usedWithItemSlot;
  if (!Number.isInteger(slot) || inventory.getItems()[slot] !== weapon ||
      !Number.isInteger(otherSlot) || inventory.getItems()[otherSlot] !== other) return false;
  return chargeOption(api, { player, item: weapon, itemId: weapon.getId(), slot, interfaceId: api.core.Inventory.INTERFACE_ID });
}

function submitCharges(api, request, amount) {
  const { player, item } = request;
  if (pendingCharges.get(player) !== request || player.getEnteredAmountAction() !== request.action) return;
  pendingCharges.delete(player);
  if (!ownsClickedItem(api, player, request) || !Number.isInteger(amount) || amount <= 0) return;
  const inventory = player.getInventory(), ids = api.core.ItemIdentifiers;
  const applied = Math.min(amount, MAX_CHARGES - charges(item), inventory.getAmount(ids.SUNFIRE_SPLINTERS));
  if (applied <= 0) return;
  inventory.deleteNumber(ids.SUNFIRE_SPLINTERS, applied);
  setCharges(api, player, item, charges(item) + applied);
  player.sendMessage(`You apply ${applied.toLocaleString("en-US")} charge${applied === 1 ? "" : "s"} to your Tonalztics of Ralos.`);
}

/** Both initial use and Charge ask for an amount before spending any splinters. */
function chargeOption(api, event) {
  const { player, item, itemId, slot, interfaceId } = event;
  if (!isTonalzticsId(api, item?.getId?.())) return false;
  const request = { player, item, itemId, slot, interfaceId, charges: charges(item) };
  if (!ownsClickedItem(api, player, request)) return false;
  const room = MAX_CHARGES - charges(item);
  if (room <= 0) {
    player.sendMessage("Your Tonalztics of Ralos is already fully charged.");
    return true;
  }
  const available = player.getInventory().getAmount(api.core.ItemIdentifiers.SUNFIRE_SPLINTERS);
  if (available <= 0) {
    player.sendMessage("You don't appear to have any Sunfire splinter which you can use to charge your Tonalztics of Ralos.");
    return true;
  }
  request.action = { acceptsZero: true, execute: submitCharges.bind(null, api, request) };
  pendingCharges.set(player, request);
  player.setEnteredAmountAction(request.action);
  player.getPacketSender().sendEnterAmountPrompt(`How many charges do you want to apply? (Up to ${Math.min(room, available)})`);
  return true;
}

function checkCharges(api, { player, item }) {
  normalizeEmpty(api, player, item);
  player.sendMessage(`Your Tonalztics of Ralos has ${charges(item).toLocaleString("en-US")} charges.`);
  return true;
}

function createMethod(api) {
  const core = api.core;
  const { PendingHit, RangedCombatMethod } = core;
  return new (class TonalzticsOfRalosCombatMethod extends RangedCombatMethod {
    start(character, target) {
      if (character.isPlayer()) {
        beginShot(api, character.getAsPlayer());
      }
      super.start(character, target);
    }

    finished(character, target) {
      super.finished(character, target);
      clearShot({ player: character.getAsPlayer() });
    }

    onCombatEnded(character, target) {
      super.onCombatEnded(character, target);
      clearShot({ player: character.getAsPlayer() });
    }

    hits(character, target) {
      const player = character.getAsPlayer();
      const charged = isShotCharged(api, player);
      const distance = api.core.CombatPosition.projectileDistance(character, target);
      const hitDelay = api.core.RangedCombatMethod.playerHitDelays(character, target, distance)[0];
      return [new PendingHit(character, target, this, { delay: hitDelay, hitAmount: charged ? 2 : 1 })];
    }
  })();
}

/** The special attack's own method takes over when it is armed. */
function resolveNormal(api, attacker) {
  if (!attacker?.isPlayer?.()) {
    return null;
  }
  const player = attacker.getAsPlayer();
  const item = weaponItem(api, player);
  if (!isTonalzticsId(api, item?.getId?.())) {
    return null;
  }
  normalizeEmpty(api, player, item);
  if (player.isSpecialActivated?.()) {
    return null;
  }
  let method = methods.get(api);
  if (!method) { method = createMethod(api); methods.set(api, method); }
  return method;
}

/** Wiki: every hit, normal or special, rolls 0-75% of the maximum ranged hit. */
function scaleMaxHit(api, attacker, _target, maxHit) {
  if (!attacker?.isPlayer?.()) {
    return null;
  }
  if (!isTonalzticsId(api, weaponItem(api, attacker.getAsPlayer())?.getId?.())) {
    return null;
  }
  return Math.floor((Math.max(0, maxHit) * MAX_HIT_PERCENT) / 100);
}

function scaleAttackRoll() {
  return null;
}

module.exports = {
  name: "TonalzticsOfRalos",
  members: true,
  register(api) {
    api.onItemAction("Tonalztics of Ralos", {
      Check: checkCharges.bind(null, api), Charge: chargeOption.bind(null, api), Uncharge: confirmUncharge.bind(null, api),
    });
    api.onItemOnItem("Sunfire splinters", "Tonalztics of Ralos (uncharged)", chargeWithSplinters.bind(null, api), { noted: false });
    api.onItemOnItem("Sunfire splinters", "Tonalztics of Ralos", chargeWithSplinters.bind(null, api), { noted: false });
    api.onCustomEvent(SHOT_EVENT, handleShot.bind(null, api));
    api.onPlayerLogout(clearShot);
    api.registerWeaponProfile({
      itemIds: [api.core.ItemIdentifiers.TONALZTICS_OF_RALOS_UNCHARGED_],
      attackAnimation: UNCHARGED_ATTACK_ANIMATION,
      npcAttackAnimation: UNCHARGED_ATTACK_ANIMATION,
      rangedDefenceType: "light",
    });
    api.registerWeaponProfile({
      itemIds: [api.core.ItemIdentifiers.TONALZTICS_OF_RALOS],
      attackAnimation: CHARGED_ATTACK_ANIMATION,
      npcAttackAnimation: CHARGED_ATTACK_ANIMATION,
      rangedDefenceType: "light",
    });
    api.registerCombatMethodResolver({ resolve: resolveNormal.bind(null, api) });
    api.registerRangedCombatModifier({ modifyMaxHit: scaleMaxHit.bind(null, api), modifyAttackRoll: scaleAttackRoll });
    api.registerRangedAmmoHandler({ checkAmmo: checkAmmo.bind(null, api), decrementAmmo: decrementAmmo.bind(null, api) });
  },
};
