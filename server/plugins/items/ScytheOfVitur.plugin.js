/**
 * Scythe of Vitur (Wiki: Scythe of Vitur): against a large target each swing lands
 * as many hits as the target is wide, up to three - one on a 1x1, two on a 2x2,
 * three on a 3x3 or larger. Each hit rolls its own accuracy and damage, and each
 * hit's max is half the one before, rounded down (47 -> 23 -> 11).
 *
 * Charging (Wiki): the vyre well stores sets of 100 charges, each bought with one
 * vial of blood and 200 blood runes. Charge-at, or using a scythe on the well, moves
 * them into the scythe, up to 20,000; a charged scythe can instead be uncharged into
 * the well, in whole sets. The chatbox follows live (rsprox 20261115T211134).
 * One charge is spent per attack as long as at least one of the swing's hits deals
 * damage; at zero it reverts to the uncharged scythe, which still attacks with its
 * weaker uncharged stats. Uncharging away from the well clears the charges without
 * returning the materials.
 *
 * In multicombat the remaining hits can cleave adjacent targets in the forward 1x3 arc.
 */
const { plainAmount, takePlain, PRESET_TEXT } = require("./PoweredStaff");
const { withHitVictim } = require("../../src/main/typescript/elvarg/game/content/combat/EquipmentEffects");

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

/**
 * "item:fill-charges" { player, item, handled }: content that hands out a scythe ready to use
 * (the PvP Arena's load-outs) asks for a full one: charged, at its most charges.
 */
function fillCharges(event) {
  const { item } = event;
  const id = item?.getId?.();
  if (!chargedIds.has(id) && !chargedByUncharged.has(id)) return;
  if (chargedByUncharged.has(id)) item.setId(chargedByUncharged.get(id));
  item.setMetaValue(CHARGE_META_KEY, MAX_CHARGES);
  event.handled = true;
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
  const consume = { player, itemId: item.getId(), skip: false, extra: 0 };
  pluginApi?.emitCustomEvent("combat:melee-charge", consume);
  pluginApi?.emitCustomEvent("combat:consume-charge", consume);
  if (consume.skip) {
    // Charges given back on top (Demonic Pacts' Regenerate above 100%), up to the scythe's most.
    if (consume.extra > 0) item.setMetaValue(CHARGE_META_KEY, Math.min(MAX_CHARGES, charges(item) + consume.extra));
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
      // Each victim's own max (vampyre tiers, salve, slayer gear): a cleave isn't judged by the primary target.
      const maxHits = new Map();
      const maxHitOf = (victim) => {
        if (!maxHits.has(victim)) {
          maxHits.set(victim, withHitVictim(character, victim, () => DamageFormulas.calculateMaxMeleeHit(character)));
        }
        return maxHits.get(victim);
      };
      const hits = [];
      const budgets = new Map();
      const targets = [...Array(hitCount(target)).fill(target), ...cleaveTargets(character, target)];
      for (const [index, victim] of targets.entries()) {
        if (!budgets.has(victim)) budgets.set(victim, { remaining: victim.getHitpoints() });
        const hit = new PendingHit(character, victim, this, { damageBudget: budgets.get(victim) });
        if (index > 0) CombatFactory.applyStyleDamage(hit, hitMax(maxHitOf(victim), index));
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
/**
 * Only unrestricted copies pay for charges: a scythe's charges can go into the vyre well, and the well's Empty
 * hands back plain blood runes and vials, so a preset (untradeable, unbankable) copy would come back tradeable.
 */
function vialCount(inventory) {
  return vialIds.reduce((total, id) => total + plainAmount(inventory, id), 0) + plainAmount(inventory, notedVialId);
}

const bloodRunes = (inventory) => plainAmount(inventory, bloodRuneId);

/** Nothing plain pays, but preset copies are held: say why rather than asking for materials. */
function onlyPresets(player) {
  const inventory = player.getInventory();
  const anyVial = [...vialIds, notedVialId].some((id) => inventory.getAmount(id) > 0);
  if (!anyVial || inventory.getAmount(bloodRuneId) < BLOOD_RUNES_PER_VIAL) return false;
  player.sendMessage(PRESET_TEXT);
  return true;
}

function takeVials(inventory, amount) {
  let left = amount;
  for (const id of [...vialIds, notedVialId]) {
    if (left <= 0) break;
    const taken = Math.min(left, plainAmount(inventory, id));
    if (taken > 0) {
      takePlain(inventory, id, taken);
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

/**
 * The well's chatbox, as live draws it (rsprox 20261115T211134): its statements are message boxes
 * (229), the scythe's are item boxes (193) showing the scythe, both with their line in the chat too.
 * Tests swap these out to record what the player is shown.
 */
const dialogues = {
  /** A message box, then `next` on Continue. */
  mesbox(player, text, next) {
    const { DialogueChainBuilder, StatementDialogue, ActionDialogue, EndDialogue } = core;
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
      new StatementDialogue(0, text),
      next ? new ActionDialogue(1, { execute: next }) : new EndDialogue(1),
    ));
  },
  /** An item box beside `itemId`, then `next` on Continue. */
  itemBox(player, itemId, text, next) {
    const { DialogueChainBuilder, ItemStatementDialogue, ActionDialogue, EndDialogue } = core;
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
      new ItemStatementDialogue(0, itemId, text),
      next ? new ActionDialogue(1, { execute: next }) : new EndDialogue(1),
    ));
  },
  /** "Select an option" over [text, callback] pairs. */
  options(player, ...pairs) {
    pluginApi.sendMultiChatboxPrompt(player, "Select an option", ...pairs.flat());
  },
  /** The count dialog (script 108); `execute` gets the whole number typed. */
  count(player, title, execute) {
    const input = {
      execute(value) {
        if (player.getEnteredAmountAction?.() === input) player.setEnteredAmountAction(null);
        execute(Math.floor(Number(value) || 0));
      },
    };
    player.setEnteredAmountAction(input);
    player.getPacketSender().sendEnterAmountPrompt(title);
  },
};

const format = (amount) => amount.toLocaleString("en-US");
const wellSets = (player) => Math.floor(wellCharges(player) / CHARGES_PER_VIAL);

/** Charge-at looks in the inventory only: live answers "nothing that can be charged" for a wielded scythe. */
function findScythe(player) {
  for (const item of player.getInventory().getItems()) {
    if (item && isScytheId(item.getId())) return item;
  }
  return null;
}

/** The scythe is still in the inventory, as it was when the dialogue opened. */
function stillHeld(player, item) {
  return player.getInventory().getItems().includes(item) && isScytheId(item.getId());
}

function addScytheCharges(player, item, amount) {
  const added = Math.max(0, Math.min(Math.floor(amount), MAX_CHARGES - charges(item)));
  if (added <= 0) return 0;
  if (chargedByUncharged.has(item.getId())) item.setId(chargedByUncharged.get(item.getId()));
  item.setMetaValue?.(CHARGE_META_KEY, charges(item) + added);
  refresh(player);
  return added;
}

const NEED_MATERIALS = `You need at least ${BLOOD_RUNES_PER_VIAL} blood runes and 1 vial of blood to start filling the well.`;

/** Sets the inventory pays for (a vial and 200 blood runes each), up to the well's room. */
function affordableSets(player) {
  const inventory = player.getInventory();
  return Math.min(
    Math.floor((WELL_MAX_CHARGES - wellCharges(player)) / CHARGES_PER_VIAL),
    vialCount(inventory),
    Math.floor(bloodRunes(inventory) / BLOOD_RUNES_PER_VIAL)
  );
}

/** Fill asks for sets (100 charges each); live's "charges" in the reply are those sets. */
function fillWellSets(player, requested) {
  if (requested < 1) return;
  const sets = Math.min(requested, affordableSets(player));
  if (sets < 1) {
    if (onlyPresets(player)) return;
    player.sendMessage(NEED_MATERIALS);
    return;
  }
  const inventory = player.getInventory();
  takeVials(inventory, sets);
  takePlain(inventory, bloodRuneId, sets * BLOOD_RUNES_PER_VIAL);
  inventory.refreshItems();
  publishWell(player, wellCharges(player) + sets * CHARGES_PER_VIAL);
  // Live: "You fill the well with 160 charges."; the transcript has "one charge" for a single set.
  dialogues.mesbox(player, `You fill the well with ${sets === 1 ? "one" : format(sets)} charge${sets === 1 ? "" : "s"}.`);
}

/**
 * Fill (live): the cost in a message box, then "How many sets of 100 charges do you wish to add? (Up to N)".
 * Without the materials it is a plain game message, no box.
 */
function fillWell({ player }) {
  if (WELL_MAX_CHARGES - wellCharges(player) < CHARGES_PER_VIAL) {
    dialogues.mesbox(player, "The well is full.");
    return true;
  }
  if (vialCount(player.getInventory()) < 1 || bloodRunes(player.getInventory()) < BLOOD_RUNES_PER_VIAL) {
    if (onlyPresets(player)) return true;
    player.sendMessage(NEED_MATERIALS);
    return true;
  }
  dialogues.mesbox(player,
    `Mixing 1 vial of blood with the power of ${BLOOD_RUNES_PER_VIAL} blood runes into this well will add ${CHARGES_PER_VIAL} charges per set.`,
    () => {
      const most = affordableSets(player);
      if (most < 1) return;
      dialogues.count(player, `How many sets of ${CHARGES_PER_VIAL} charges do you wish to add? (Up to ${format(most)})`,
        (sets) => fillWellSets(player, sets));
    });
  return true;
}

/** The sets the scythe can take from the well now: the well's sets, up to the scythe's room. */
function applicableSets(player, scythe) {
  return Math.min(wellSets(player), Math.floor((MAX_CHARGES - charges(scythe)) / CHARGES_PER_VIAL));
}

function applySets(player, scythe, requested) {
  if (requested < 1 || !stillHeld(player, scythe)) return;
  const sets = Math.min(requested, applicableSets(player, scythe));
  if (sets < 1) return;
  const added = addScytheCharges(player, scythe, sets * CHARGES_PER_VIAL);
  if (added < 1) return;
  publishWell(player, wellCharges(player) - added);
  const name = core.ItemDefinition.forId(scythe.getId())?.getName?.() || "Scythe of Vitur";
  dialogues.itemBox(player, scythe.getId(), `You apply ${format(added)} charges to your ${name}.`);
}

/**
 * Charging (live): "You lower your scythe into the well..." beside the scythe, then
 * "How many sets of 100 charges do you wish to apply? (Up to N)", N the well's sets up to the scythe's room.
 */
function lowerScythe(player, scythe) {
  if (charges(scythe) > MAX_CHARGES - CHARGES_PER_VIAL) {
    dialogues.itemBox(player, scythe.getId(), "Your scythe cannot hold any more charges.");
    return;
  }
  if (wellSets(player) < 1) {
    dialogues.mesbox(player, "The well is empty.");
    return;
  }
  dialogues.itemBox(player, scythe.getId(), "You lower your scythe into the well...", () => {
    if (!stillHeld(player, scythe)) return;
    const most = applicableSets(player, scythe);
    if (most < 1) return;
    dialogues.count(player, `How many sets of ${CHARGES_PER_VIAL} charges do you wish to apply? (Up to ${format(most)})`,
      (sets) => applySets(player, scythe, sets));
  });
}

/** The scythe's charges in whole sets: 1,235 deposit 1,200 (Wiki). */
const depositable = (scythe) => Math.floor(charges(scythe) / CHARGES_PER_VIAL) * CHARGES_PER_VIAL;

function unchargeIntoWell(player, scythe) {
  if (!stillHeld(player, scythe) || !chargedIds.has(scythe.getId())) return;
  const deposit = depositable(scythe);
  if (deposit < CHARGES_PER_VIAL || deposit > WELL_MAX_CHARGES - wellCharges(player)) return;
  // Draining empties the scythe; the charges below the last whole set are not deposited.
  swapToUncharged(player, scythe);
  publishWell(player, wellCharges(player) + deposit);
  dialogues.itemBox(player, scythe.getId(),
    `You uncharge your scythe into the well. It now contains ${format(wellSets(player))} sets of ${CHARGES_PER_VIAL} charges.`);
}

/**
 * Uncharging (live): what goes in, beside the charged scythe, then "Proceed" / "Cancel"; Proceed
 * drains it and says what the well now holds, beside the uncharged scythe.
 */
function offerUncharge(player, scythe) {
  const deposit = depositable(scythe);
  if (deposit < CHARGES_PER_VIAL) {
    dialogues.itemBox(player, scythe.getId(), "Your scythe does not have enough charges to deposit.");
    return;
  }
  if (deposit > WELL_MAX_CHARGES - wellCharges(player)) {
    dialogues.mesbox(player, "The well cannot hold any more charges.");
    return;
  }
  dialogues.itemBox(player, scythe.getId(),
    `If you uncharge your scythe into the well, ${format(deposit)} charges will be added to the well.`,
    () => dialogues.options(player, ["Proceed", () => unchargeIntoWell(player, scythe)], ["Cancel", () => {}]));
}

/** A charged scythe asks "Charge the scythe" / "Uncharge the scythe"; an uncharged one is lowered straight in. */
function scytheAtWell(player, scythe) {
  if (!chargedIds.has(scythe.getId())) {
    lowerScythe(player, scythe);
    return;
  }
  dialogues.options(player,
    ["Charge the scythe", () => stillHeld(player, scythe) && lowerScythe(player, scythe)],
    ["Uncharge the scythe", () => stillHeld(player, scythe) && offerUncharge(player, scythe)]);
}

/** Charge-at: the inventory's scythe, as if used on the well (live, tick 96). */
function chargeAtWell({ player }) {
  const scythe = findScythe(player);
  if (!scythe) {
    dialogues.mesbox(player, "You have nothing that can be charged here.");
    return true;
  }
  scytheAtWell(player, scythe);
  return true;
}

/** Both payouts must fit together: each is a new stack or merges into one already held, never the same free slot. */
function refundsFit(inventory, refunds) {
  const items = inventory.getItems();
  const newStacks = refunds.filter((refund) => !items.some((held) =>
    held.getId() === refund.getId() && JSON.stringify(held.getMeta() ?? null) === JSON.stringify(refund.getMeta() ?? null)
  )).length;
  return newStacks <= inventory.getFreeSlots() && refunds.every((refund) =>
    inventory.getAddableAmount(refund) >= refund.getAmount()
  );
}

function emptyWell({ player }) {
  const inventory = player.getInventory();
  const sets = wellSets(player);
  if (sets < 1) {
    dialogues.mesbox(player, "The well is empty.");
    return true;
  }
  const runes = new core.Item(bloodRuneId, sets * BLOOD_RUNES_PER_VIAL);
  const vials = new core.Item(notedVialId, sets);
  if (!refundsFit(inventory, [runes, vials])) {
    player.sendMessage("You don't have enough inventory space.");
    return true;
  }
  inventory.add(runes, false);
  inventory.add(vials, false);
  inventory.refreshItems();
  publishWell(player, 0);
  dialogues.mesbox(player,
    `You take ${format(runes.getAmount())} blood runes and ${format(sets)} vial${sets === 1 ? "" : "s"} of blood out of the well - which are magically converted to noted form.`);
  return true;
}

/** Check (live): a message box, "The well is empty." or the sets it holds. */
function checkWell({ player }) {
  const sets = wellSets(player);
  dialogues.mesbox(player, sets < 1
    ? "The well is empty."
    : `The well contains ${format(sets)} set${sets === 1 ? "" : "s"} of ${CHARGES_PER_VIAL} charges.`);
  return true;
}

/** Using a scythe on the well: the same as Charge-at with that scythe (live). */
function scytheOnWell(event) {
  const { player, itemId, item } = event;
  if (!isScytheId(itemId)) return false;
  if (core.ObjectDefinition.forPlayer(event.objectId, player)?.getName?.() !== WELL_OBJECT) return false;
  // Generic item-on-object hooks must mark the event themselves (the named overload does it).
  event.handled = true;
  scytheAtWell(player, item);
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
    Math.floor(bloodRunes(inventory) / BLOOD_RUNES_PER_VIAL),
    Math.floor(room / CHARGES_PER_VIAL)
  );
  if (batches < 1 && onlyPresets(player)) {
    event.handled = true;
    return;
  }
  if (batches < 1) {
    player.sendMessage(`You need a vial of blood and ${BLOOD_RUNES_PER_VIAL} blood runes for 100 charges.`);
    event.handled = true;
    return;
  }
  takeVials(inventory, batches);
  takePlain(inventory, bloodRuneId, batches * BLOOD_RUNES_PER_VIAL);
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
  description: "Adds the Scythe of Vitur's multi-hit sweeps on large targets, charging at the Theatre of Blood vyre well, and reverting to uncharged.",
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
    api.onCustomEvent("item:fill-charges", fillCharges);
    api.onItemOnObject(scytheOnWell);
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
    emptyWell,
    checkWell,
    scytheOnWell,
    findScythe,
    dialogues,
    MAX_CHARGES,
    CHARGES_PER_VIAL,
    BLOOD_RUNES_PER_VIAL,
    WELL_MAX_CHARGES,
    WELL_VARBIT,
    WELL_ATTRIBUTE,
    CHARGE_META_KEY,
  },
};
