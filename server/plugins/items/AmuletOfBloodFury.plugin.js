// Inventory creation/recharging: https://oldschool.runescape.wiki/w/Transcript:Blood_shard
// Check, the 500-hit countdown and the proc graphic: rsprox captures (docs/blood-fury.md).
let core;
let CombatType, Equipment, Flag, Misc;
let AMULET_OF_FURY_ID, AMULET_OF_BLOOD_FURY_ID, BLOOD_SHARD_ID;

function initialize(coreApi) {
  core = coreApi;
  ({ CombatType, Equipment, Flag, Misc, BonusManager } = core);
  AMULET_OF_FURY_ID = core.ItemIdentifiers.AMULET_OF_FURY;
  AMULET_OF_BLOOD_FURY_ID = core.ItemIdentifiers.AMULET_OF_BLOOD_FURY;
  BLOOD_SHARD_ID = core.ItemIdentifiers.BLOOD_SHARD;
}

const BLOOD_FURY_META_KEY = "blood-fury";
const BLOOD_FURY_CHARGES_PER_SHARD = 10000;
const BLOOD_FURY_MAX_CHARGES = 30000;
/** Live counts the charges down in chat every 500 hits (rsprox rec 481 tick 690: 7,000). */
const BLOOD_FURY_COUNTDOWN_STEP = 500;
/** sanguinesti_staff_heal on the target, the tick of the attack (rsprox rec 481 ticks 273, 279, 327). */
const BLOOD_FURY_PROC_GRAPHIC = 1542;
const BLOOD_FURY_PROC_GRAPHIC_HEIGHT = 92;

function clampCharges(charges) {
  const value = Number.isFinite(Number(charges))
    ? Math.floor(Number(charges))
    : BLOOD_FURY_CHARGES_PER_SHARD;
  return Math.max(0, Math.min(BLOOD_FURY_MAX_CHARGES, value));
}

function bloodFuryCharges(item) {
  if (!item || item.getId() !== AMULET_OF_BLOOD_FURY_ID) {
    return 0;
  }
  return clampCharges(item.getMetaValue?.(BLOOD_FURY_META_KEY)?.charges);
}

function setBloodFuryCharges(item, charges) {
  if (!item) {
    return item;
  }
  const next = clampCharges(charges);
  item.setId(next > 0 ? AMULET_OF_BLOOD_FURY_ID : AMULET_OF_FURY_ID);
  item.setMetaValue(BLOOD_FURY_META_KEY, next > 0 ? { charges: next } : undefined);
  return item;
}

function getBloodFury(player) {
  const item = player?.getEquipment?.()?.get?.(Equipment.AMULET_SLOT);
  return item?.getId?.() === AMULET_OF_BLOOD_FURY_ID ? item : null;
}

function refresh(player) {
  player.getInventory().refreshItems();
  player.getEquipment().refreshItems();
  player.getUpdateFlag()?.flag?.(Flag.APPEARANCE);
  BonusManager.update(player);
}

function sendChargesMessage(player, item) {
  player.sendMessage(
    `Your Amulet of blood fury will work for ${bloodFuryCharges(item).toLocaleString("en-US")} more hits.`,
  );
}

function validIngredients(player, item, id, charges) {
  return player.getInventory().getItems().includes(item) && item.getId() === id &&
    player.getInventory().getAmount(BLOOD_SHARD_ID) > 0 &&
    (id === AMULET_OF_FURY_ID || bloodFuryCharges(item) === charges);
}

function showSuccess(player, text) {
  player.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(
    new core.ItemStatementDialogue(0, AMULET_OF_BLOOD_FURY_ID, text),
  ));
}

function confirmation(player, title, yes, no, accept, warnings = [], itemId = AMULET_OF_FURY_ID) {
  const chain = new core.DialogueChainBuilder();
  for (const text of warnings) {
    chain.add(new core.DoubleItemStatementDialogue(
      chain.getDialogues().size, itemId, BLOOD_SHARD_ID, text,
    ));
  }
  chain.add(new core.OptionDialogue(chain.getDialogues().size, {
    executeOption(option) {
      player.getDialogueManager().reset();
      if (Number(option) === 1) accept();
    },
  }, yes, no).setTitle(title));
  player.getDialogueManager().startDialogues(chain);
}

function createBloodFury(player, furyItem) {
  if (!validIngredients(player, furyItem, AMULET_OF_FURY_ID)) return;
  confirmation(player, "Are you sure you wish to do this?",
    "Yes, combine the Blood shard with the Amulet of fury.", "No, I'll keep my Blood shard.", () => {
      if (!validIngredients(player, furyItem, AMULET_OF_FURY_ID)) return;
      player.getInventory().deleteNumber(BLOOD_SHARD_ID, 1);
      setBloodFuryCharges(furyItem, BLOOD_FURY_CHARGES_PER_SHARD);
      refresh(player);
      showSuccess(player, "You have successfully created an Amulet of blood fury.");
    }, [
      "<col=7f0000>Warning!</col> The Amulet of fury will consume your Blood shard to make the Amulet of blood fury and you won't be able to get it back.",
      "The Amulet of blood fury is untradeable.",
    ]);
}

function chargeBloodFury(player, amuletItem) {
  const charges = bloodFuryCharges(amuletItem);
  if (!validIngredients(player, amuletItem, AMULET_OF_BLOOD_FURY_ID, charges)) return;
  if (charges >= BLOOD_FURY_MAX_CHARGES) {
    player.sendMessage("Your Amulet of blood fury is already at maximum capacity.");
    return;
  }

  function recharge() {
    if (!validIngredients(player, amuletItem, AMULET_OF_BLOOD_FURY_ID, charges)) return;
    const added = Math.min(BLOOD_FURY_CHARGES_PER_SHARD, BLOOD_FURY_MAX_CHARGES - charges);
    player.getInventory().deleteNumber(BLOOD_SHARD_ID, 1);
    setBloodFuryCharges(amuletItem, charges + added);
    refresh(player);
    showSuccess(player, `You have successfully added ${added.toLocaleString("en-US")} hits to your Amulet of blood fury. It will now work for ${(charges + added).toLocaleString("en-US")} more hits.`);
  }

  confirmation(player, "Use the Blood shard to add charges to the amulet?",
    "Yes, recharge my Amulet of blood fury.", "No, keep my Blood shard.", () => {
      if (!validIngredients(player, amuletItem, AMULET_OF_BLOOD_FURY_ID, charges)) return;
      if (charges + BLOOD_FURY_CHARGES_PER_SHARD > BLOOD_FURY_MAX_CHARGES) {
        confirmation(player, "Recharge anyway?", "Yes, recharge my Amulet of blood fury.", "No, keep my Blood shard.", recharge,
          ["<col=7f0000>Warning!</col> Your Amulet of blood fury is nearly at maximum capacity and will be capped at 30,000 hits."],
          AMULET_OF_BLOOD_FURY_ID);
      } else recharge();
    });
}

function revertBloodFury(player, item) {
  setBloodFuryCharges(item, 0);
  refresh(player);
  player.sendMessage("You remove the blood magic from the amulet.");
}

function healFromLandedHit(player, damageTaken) {
  const heal = Math.floor(damageTaken * 0.3);
  if (heal > 0) {
    player.heal(heal);
  }
}

/** Hits that spent a charge on the attack tick, so an impact hook that zeroes one can refund it. */
const chargedHits = new WeakMap();

/** Live shows the proc with the swing, even at full HP (docs/blood-fury.md). */
function showProc(target) {
  target?.performGraphic?.(
    new core.Graphic(BLOOD_FURY_PROC_GRAPHIC, 0, BLOOD_FURY_PROC_GRAPHIC_HEIGHT),
  );
}

/**
 * Runs on the attack's tick ("combat:hit-queued", after protection prayers and damage caps):
 * the charge, the 500-hit countdown, the 20% roll and its graphic all go with the swing, a tick
 * before an NPC's hitsplat (rsprox rec 481 ticks 273/274, 690/691).
 */
function applyBloodFuryEffect(player, target, hit) {
  const amuletItem = getBloodFury(player);
  if (!amuletItem) {
    return;
  }

  const startingCharges = bloodFuryCharges(amuletItem);
  let charges = startingCharges;
  let shown = false;
  for (const resolvedHit of Array.isArray(hit.getHits?.()) ? hit.getHits() : []) {
    const damage = Number(resolvedHit?.getDamage?.() ?? 0);
    if (damage <= 0 || charges <= 0) {
      continue;
    }

    charges -= 1;
    chargedHits.set(resolvedHit, amuletItem);
    if (charges > 0 && charges % BLOOD_FURY_COUNTDOWN_STEP === 0) {
      player.sendMessage(`Your Amulet of blood fury can perform ${charges.toLocaleString("en-US")} more hits.`);
    }
    if (Misc.getRandom(4) !== 0) continue;
    // One graphic per attack: a second proc in a multi-hit swing would only replace it.
    if (!shown) showProc(target);
    shown = true;
    // Heal from the health actually lost when the hitsplat lands, so earlier same-cycle damage
    // and overkill do not count.
    resolvedHit.onApplied((damageTaken) => healFromLandedHit(player, damageTaken));
  }

  if (charges === startingCharges) {
    return;
  }

  setBloodFuryCharges(amuletItem, charges);
  refresh(player);
  if (charges <= 0) {
    player.sendMessage("Your amulet of blood fury has run out of charges.");
  }
}

let BonusManager;

/**
 * "combat:hit-resolved" comes after the impact hooks (wrong-style immunities and the like). A hit
 * they zeroed gives its charge back, as main did by counting only resolved damage. Ours: the
 * proc graphic, already shown with the swing, stays.
 */
function onHitResolved({ hit }) {
  for (const resolvedHit of Array.isArray(hit?.getHits?.()) ? hit.getHits() : []) {
    const amuletItem = chargedHits.get(resolvedHit);
    if (!amuletItem) continue;
    chargedHits.delete(resolvedHit);
    if (Number(resolvedHit.getDamage?.() ?? 0) > 0) continue;
    const player = hit.getAttacker?.()?.getAsPlayer?.();
    if (!player || getBloodFury(player) !== amuletItem) continue;
    setBloodFuryCharges(amuletItem, bloodFuryCharges(amuletItem) + 1);
    refresh(player);
  }
}

function onHitQueued({ player, target, hit }) {
  if (hit?.getCombatType?.() === CombatType.MELEE) applyBloodFuryEffect(player, target ?? hit.getTarget?.(), hit);
}

function createFromShard({ player, usedItem, usedWithItem }) {
  createBloodFury(player, usedItem.getId() === AMULET_OF_FURY_ID ? usedItem : usedWithItem);
}

function chargeFromShard({ player, usedItem, usedWithItem }) {
  chargeBloodFury(player, usedItem.getId() === AMULET_OF_BLOOD_FURY_ID ? usedItem : usedWithItem);
}

function check({ player, item }) {
  if (item.getId() === AMULET_OF_BLOOD_FURY_ID) sendChargesMessage(player, item);
}

function revert({ player, item }) {
  if (item.getId() === AMULET_OF_BLOOD_FURY_ID) revertBloodFury(player, item);
}

/**
 * "item:fill-charges" { player, item, handled }: content that hands out the amulet ready to use
 * (the PvP Arena's load-outs) asks for a full one.
 */
function fillCharges(event) {
  const { item } = event;
  if (item?.getId?.() !== AMULET_OF_BLOOD_FURY_ID) return;
  setBloodFuryCharges(item, BLOOD_FURY_MAX_CHARGES);
  event.handled = true;
}

module.exports = {
  name: "AmuletOfBloodFury",
  description: "Amulet of blood fury: made from a Blood shard and amulet of fury, 30,000 charges, heals from damage dealt with its proc graphic, counts down every 500 hits, with Check and Revert.",
  members: true,
  register(api) {
    api.onServerStartup(initialize.bind(null, api.core));
    api.onItemOnItem("Blood shard", "Amulet of fury", createFromShard, { noted: false });
    api.onItemOnItem("Blood shard", "Amulet of blood fury", chargeFromShard, { noted: false });
    api.onItemAction("Amulet of blood fury", { Check: check, Revert: revert });
    api.onCustomEvent("item:fill-charges", fillCharges);
    api.onCustomEvent("combat:hit-queued", onHitQueued);
    api.onCombatHitResolved(onHitResolved);
  },
};
