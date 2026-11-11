/**
 * Obligator (Wiki: Obligator): a two-handed extending chain mace from the Fractured Archive, 5 ticks
 * on Thrust and 3 on Smash (Smash hits one target only).
 *
 * Passive (Thrust, charged): two damage rolls a swing, and one more for each of stab and slash defence
 * that beats the target's crush defence; the best roll lands. Against a 2x2 target it deals 20% more,
 * against a 3x3 or larger one 40% more (before the hitpoints cap). Each roll is a full hit roll, accuracy
 * then damage (an estimate: the Wiki says "damage rolls").
 *
 * Passive (Thrust, charged or not): it "can reach up to two additional targets on or behind the main
 * target", a reach of 3 tiles (Wiki, Obligator). Those targets are the ones standing on the main target's
 * tiles or on the two tiles behind them, away from the attacker, and need the usual secondary-target
 * rules (multicombat, attackable). The Wiki gives them no different damage, so each takes its own full
 * hit, with the same rolls as the main target's. Smash hits one target and spends no charge.
 *
 * Charging (Wiki): one ascension shard, 20 nature runes and 20 death runes add 10 charges, up to 20,000.
 * Uncharging returns the unused shards and runes. The Wiki does not say what spends a charge or whether
 * the uncharged weapon keeps the passive: one charge an attack, and no passive uncharged, are estimates.
 *
 * Animations are the cache's tfa_human_obligator_multihit (Thrust) and _attack (Smash), with the
 * vfx_obligator_{charged,uncharged}_thrust spotanims, each with a _female twin. Which of the two
 * animations belongs to which style is an estimate: the Thrust one runs as long as its vfx seq.
 */
const { restricted, plainAmount, takePlain, PRESET_TEXT } = require("./PoweredStaff");

const MAX_CHARGES = 20000;
// Wiki (Obligator): 1 ascension shard, 60 nature runes and 60 death runes give 30 charges, since the
// 11 November 2026 update ("Increased the number of charges provided by Ascension Shards ... by 3x").
const CHARGES_PER_BATCH = 30;
const NATURE_RUNES_PER_BATCH = 60;
const DEATH_RUNES_PER_BATCH = 60;
const CHARGES_META_KEY = "obligator-charges";
const SMASH_FIGHT_TYPE_INDEX = 2;
const SMASH_ATTACK_SPEED = 3;
const BASE_ROLLS = 2;
/** Wiki: up to two additional targets, on or up to two tiles behind the main target. */
const EXTRA_TARGETS = 2;
const REACH_BEHIND = 2;
const SIZE_BONUS = { 2: 1.2, 3: 1.4 };
/** BonusManager / NPC defence indices. */
const STAB = 0;
const SLASH = 1;
const CRUSH = 2;
/** Cache seqs and spotanims, by gender: tfa_human_obligator_{multihit,attack}[_female], vfx_obligator_*_thrust_*. */
const THRUST_ANIMATION = { male: 15123, female: 15131 };
const SMASH_ANIMATION = { male: 15122, female: 15130 };
const THRUST_GRAPHIC = { charged: { male: 4423, female: 4425 }, uncharged: { male: 4424, female: 4426 } };

let core;
let method = null;
let chargedId = -1;
let unchargedId = -1;

function isObligatorId(id) {
  return Number(id) === chargedId || Number(id) === unchargedId;
}

function wieldedObligator(player) {
  const weapon = player.getEquipment().get(core.Equipment.WEAPON_SLOT);
  return isObligatorId(weapon?.getId?.()) ? weapon : null;
}

function charges(item) {
  const saved = Number(item?.getMetaValue?.(CHARGES_META_KEY));
  return Number.isFinite(saved) ? Math.max(0, Math.min(MAX_CHARGES, Math.floor(saved))) : 0;
}

/** Charged while it holds charges: the id follows the count. */
function setCharges(player, item, value) {
  const clamped = Math.max(0, Math.min(MAX_CHARGES, Math.floor(value)));
  item.setMetaValue(CHARGES_META_KEY, clamped > 0 ? clamped : undefined);
  item.setId(clamped > 0 ? chargedId : unchargedId);
  player.getInventory().refreshItems();
  player.getEquipment().refreshItems();
  player.getUpdateFlag().flag(core.Flag.APPEARANCE);
}

function isSmash(player) {
  return player.getFightType() === core.WeaponInterfaces.EXTENDING_CHAINMACE.getFightType()[SMASH_FIGHT_TYPE_INDEX];
}

function defenceOf(target, index) {
  return target.isNpc()
    ? target.getAsNpc().getDefenceBonus(index)
    : target.getAsPlayer().getBonusManager().getDefenceBonus()[index];
}

/** Two base rolls plus one for each stab/slash defence above crush (Wiki: Passive effect). */
function rollCount(target) {
  const crush = defenceOf(target, CRUSH);
  return BASE_ROLLS + Number(defenceOf(target, STAB) > crush) + Number(defenceOf(target, SLASH) > crush);
}

/** 1.2 against a 2x2, 1.4 against a 3x3 or larger. */
function sizeMultiplier(target) {
  const size = target.isNpc() ? Number(target.getAsNpc().getSize()) : 1;
  return SIZE_BONUS[Math.min(size, 3)] ?? 1;
}

const tileKey = (x, y, z) => `${x},${y},${z}`;

function sizeOf(mobile) {
  return mobile.isNpc() ? Math.max(1, Number(mobile.getAsNpc().getSize()) || 1) : 1;
}

/** The target's own tiles and the REACH_BEHIND tiles behind them, away from the attacker. */
function reachTiles(character, target) {
  const origin = character.getLocation();
  const at = target.getLocation();
  const size = sizeOf(target);
  const axis = (from, start) => (from < start ? 1 : from >= start + size ? -1 : 0);
  const dx = axis(origin.getX(), at.getX());
  const dy = axis(origin.getY(), at.getY());
  const tiles = new Set();
  for (let step = 0; step <= REACH_BEHIND; step++) {
    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        tiles.add(tileKey(at.getX() + x + dx * step, at.getY() + y + dy * step, at.getZ()));
      }
    }
  }
  return tiles;
}

function occupies(mobile, tiles) {
  const at = mobile.getLocation();
  const size = sizeOf(mobile);
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      if (tiles.has(tileKey(at.getX() + x, at.getY() + y, at.getZ()))) return true;
    }
  }
  return false;
}

/** The additional targets a thrust reaches, nearest the main target first. */
function reachedTargets(character, target) {
  if (!core.CombatFactory.multiCombatBetween(character, target)) return [];
  const candidates = [];
  core.World.getNpcs().forEach((npc) => candidates.push(npc));
  core.World.getPlayers().forEach((player) => candidates.push(player));
  const others = candidates.filter((candidate) => candidate !== target && candidate !== character);
  if (others.length === 0) return [];
  const tiles = reachTiles(character, target);
  const at = target.getLocation();
  return others
    .filter((candidate) => occupies(candidate, tiles) && core.CombatFactory.canAttackSecondaryTarget(character, target, candidate))
    .sort((a, b) => a.getLocation().getDistance(at) - b.getLocation().getDistance(at))
    .slice(0, EXTRA_TARGETS);
}

function createMethod() {
  const { MeleeCombatMethod, PendingHit, Animation, Graphic } = core;
  return new (class ObligatorCombatMethod extends MeleeCombatMethod {
    attackSpeed(character) {
      return isSmash(character.getAsPlayer()) ? SMASH_ATTACK_SPEED : super.attackSpeed(character);
    }

    start(character, target) {
      super.start(character, target);
      const player = character.getAsPlayer();
      const sex = player.getAppearance().isMale() ? "male" : "female";
      if (isSmash(player)) {
        player.performAnimation(new Animation(SMASH_ANIMATION[sex]));
        return;
      }
      player.performAnimation(new Animation(THRUST_ANIMATION[sex]));
      const charged = charges(wieldedObligator(player)) > 0;
      player.performGraphic(new Graphic(THRUST_GRAPHIC[charged ? "charged" : "uncharged"][sex]));
    }

    hits(character, target) {
      const player = character.getAsPlayer();
      const item = wieldedObligator(player);
      if (isSmash(player)) {
        return super.hits(character, target);
      }
      const charged = charges(item) > 0;
      const victims = [target, ...reachedTargets(character, target)];
      const hits = victims.map((victim, index) => charged
        ? new PendingHit(character, victim, this, { bestOf: rollCount(victim), damageMultiplier: sizeMultiplier(victim) })
        : index === 0 ? super.hits(character, victim)[0] : new PendingHit(character, victim, this));
      if (charged) this.useCharge(player, item);
      return hits;
    }

    useCharge(player, item) {
      const left = charges(item) - 1;
      if (left > 0) {
        item.setMetaValue(CHARGES_META_KEY, left);
        return;
      }
      setCharges(player, item, 0);
      player.sendMessage("Your Obligator has run out of charges.");
    }
  })();
}

function resolveObligator(attacker) {
  if (!attacker?.isPlayer?.() || !wieldedObligator(attacker.getAsPlayer())) return null;
  return (method ??= createMethod());
}

/** One shard, 20 nature and 20 death runes a batch of 10 charges, as many batches as the inventory affords. */
function chargeObligator(event) {
  const { player, usedItem, usedWithItem, usedItemId, usedWithItemId } = event;
  const weapon = isObligatorId(usedItemId) ? usedItem : isObligatorId(usedWithItemId) ? usedWithItem : null;
  if (!weapon) return;
  const { ASCENSION_SHARDS, NATURE_RUNE, DEATH_RUNE } = core.ItemIdentifiers;
  const otherId = Number(weapon === usedItem ? usedWithItemId : usedItemId);
  if (![ASCENSION_SHARDS, NATURE_RUNE, DEATH_RUNE].includes(otherId)) return;
  event.handled = true;
  const inventory = player.getInventory();
  // Preset copies never pay: Uncharge refunds plain shards and runes, so they would come back tradeable.
  if (restricted(weapon === usedItem ? usedWithItem : usedItem)) {
    player.sendMessage(PRESET_TEXT);
    return;
  }
  const room = Math.floor((MAX_CHARGES - charges(weapon)) / CHARGES_PER_BATCH);
  if (room < 1) {
    player.sendMessage("Your Obligator cannot hold any more charges.");
    return;
  }
  const affordable = (count) => Math.min(
    room,
    count(ASCENSION_SHARDS),
    Math.floor(count(NATURE_RUNE) / NATURE_RUNES_PER_BATCH),
    Math.floor(count(DEATH_RUNE) / DEATH_RUNES_PER_BATCH),
  );
  const batches = affordable((id) => plainAmount(inventory, id));
  if (batches < 1 && affordable((id) => inventory.getAmount(id)) >= 1) {
    player.sendMessage(PRESET_TEXT);
    return;
  }
  if (batches < 1) {
    player.sendMessage(`You need an ascension shard, ${NATURE_RUNES_PER_BATCH} nature runes and ${DEATH_RUNES_PER_BATCH} death runes for ${CHARGES_PER_BATCH} charges.`);
    return;
  }
  takePlain(inventory, ASCENSION_SHARDS, batches);
  takePlain(inventory, NATURE_RUNE, batches * NATURE_RUNES_PER_BATCH);
  takePlain(inventory, DEATH_RUNE, batches * DEATH_RUNES_PER_BATCH);
  setCharges(player, weapon, charges(weapon) + batches * CHARGES_PER_BATCH);
  player.sendMessage(`You add ${batches * CHARGES_PER_BATCH} charges to your Obligator.`);
}

function chargeOption({ player }) {
  player.sendMessage(`Use an ascension shard, ${NATURE_RUNES_PER_BATCH} nature runes and ${DEATH_RUNES_PER_BATCH} death runes on the Obligator to charge it.`);
  return true;
}

function checkCharges({ player, item }) {
  player.sendMessage(`Your Obligator has ${charges(item).toLocaleString("en-US")} charges left.`);
  return true;
}

function refundsFit(inventory, refunds) {
  const items = inventory.getItems();
  const newStacks = refunds.filter((refund) => !items.some((held) =>
    held.getId() === refund.getId() && JSON.stringify(held.getMeta() ?? null) === JSON.stringify(refund.getMeta() ?? null)
  )).length;
  return newStacks <= inventory.getFreeSlots() && refunds.every((refund) =>
    inventory.getAddableAmount(refund) >= refund.getAmount()
  );
}

/** Wiki: uncharging returns every unused shard and rune (partial batches return their runes and no shard). */
function uncharge({ player, item }) {
  const left = charges(item);
  if (left <= 0) {
    player.sendMessage("Your Obligator has no charges to remove.");
    return true;
  }
  const { Item, ItemIdentifiers } = core;
  const inventory = player.getInventory();
  const returned = [
    [ItemIdentifiers.ASCENSION_SHARDS, Math.floor(left / CHARGES_PER_BATCH)],
    [ItemIdentifiers.NATURE_RUNE, (left / CHARGES_PER_BATCH) * NATURE_RUNES_PER_BATCH],
    [ItemIdentifiers.DEATH_RUNE, (left / CHARGES_PER_BATCH) * DEATH_RUNES_PER_BATCH],
  ].filter(([, amount]) => amount >= 1);
  const refunds = returned.map(([id, amount]) => new Item(id, Math.floor(amount)));
  if (!refundsFit(inventory, refunds)) {
    player.sendMessage("Your inventory is too full to hold the shards and runes.");
    return true;
  }
  for (const refund of refunds) inventory.addItem(refund);
  setCharges(player, item, 0);
  player.sendMessage("You uncharge your Obligator, regaining its ascension shards and runes.");
  return true;
}

function initializeIds() {
  chargedId = core.ItemIdentifiers.OBLIGATOR;
  unchargedId = core.ItemIdentifiers.OBLIGATOR_UNCHARGED_;
}

module.exports = {
  name: "Obligator",
  description: "Adds the Obligator chain mace's multi-roll Thrust with reach behind the target and single-target Smash, plus charging with shards and runes.",
  members: true,
  register(api) {
    core = api.core;
    api.onServerStartup(initializeIds);
    api.onItemAction("Obligator", { Check: checkCharges, Charge: chargeOption, Uncharge: uncharge });
    api.onItemAction("Obligator (uncharged)", { Charge: chargeOption });
    api.onItemOnItem(chargeObligator, { noted: false });
    api.registerCombatMethodResolver({ resolve: resolveObligator });
  },
  _test: {
    charges,
    setCharges,
    rollCount,
    reachTiles,
    reachedTargets,
    sizeMultiplier,
    chargeObligator,
    checkCharges,
    uncharge,
    resolveObligator,
    initializeIds,
    MAX_CHARGES,
    CHARGES_META_KEY,
  },
};
