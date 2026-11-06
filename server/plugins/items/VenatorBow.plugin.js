/**
 * Venator bow (docs/venator-bow.md).
 *
 * Wiki: in multicombat, each shot of the charged bow ricochets to up to two more targets within
 * 2 tiles of the last one hit; the second bounce may return to the first target. Every hit
 * rolls its own accuracy, and the bounces' max hit is two-thirds of the bow's, rounded down.
 * One ancient essence is one charge (up to 50,000) and each attack spends one, however many
 * targets it hits. The uncharged bow shoots without ricochets.
 *
 * Captures (rsprox): the bounces fly as spotanim 2007 from the target just hit, 15 client
 * cycles each, chained onto the arrow's landing, at height 31, angle 127 and progress 0; synth 6672
 * plays with one bounce, 6672 and 6735 with two.
 */
const MAX_CHARGES = 50000;
const CHARGE_META_KEY = "venator-bow:charges";
const SHARDS_PER_BOW = 5;
const BOUNCES = 2;
const BOUNCE_RADIUS = 2;
const BOUNCE_PROJECTILE = 2007;
const BOUNCE_CYCLES = 15;
const BOUNCE_HEIGHT = 31;
const BOUNCE_ANGLE = 127;
const BOUNCE_PROGRESS = 0;
/**
 * Captures (rsprox): the first bounce's hitsplat lands on the same tick as the arrow's, the second's
 * one tick later, whatever the distance.
 */
const BOUNCE_HIT_TICKS = [0, 1];
const BOUNCE_SOUNDS = [6672, 6735];
const CREATE_SOUND = 6647;
/** The bank's op 9 on items with cache param 2257, shown while the bank's item-ops toggle is on. */
const CONFIGURE_CHARGES_OP = 9;
const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five"];

let core;
let pluginApi;
let bowId = -1;
let unchargedId = -1;
let echoBowId = -1;
let echoUnchargedId = -1;
let shardId = -1;
let essenceId = -1;
let venatorMethod = null;

function isBow(id) {
  return id === bowId || id === unchargedId || id === echoBowId || id === echoUnchargedId;
}

function isEchoBow(id) {
  return id === echoBowId || id === echoUnchargedId;
}

function chargedBowId(item) {
  return isEchoBow(item?.getId?.()) ? echoBowId : bowId;
}

function unchargedBowId(item) {
  return isEchoBow(item?.getId?.()) ? echoUnchargedId : unchargedId;
}

function charges(item) {
  const saved = Number(item?.getMetaValue?.(CHARGE_META_KEY));
  return Number.isFinite(saved) ? Math.max(0, Math.min(MAX_CHARGES, Math.floor(saved))) : 0;
}

/** Stores the charges and swaps between the charged and uncharged bow to match. */
function setCharges(item, amount) {
  const left = Math.max(0, Math.min(MAX_CHARGES, Math.floor(amount)));
  const echo = isEchoBow(item.getId());
  item.setMetaValue(CHARGE_META_KEY, left > 0 ? left : undefined);
  item.setId(left > 0 ? (echo ? echoBowId : bowId) : (echo ? echoUnchargedId : unchargedId));
}

function format(amount) {
  return amount.toLocaleString("en-US");
}

function refresh(player) {
  player.getInventory().refreshItems();
  player.getEquipment().refreshItems();
  player.getUpdateFlag().flag(core.Flag.APPEARANCE);
}

function itemStatement(player, itemId, text) {
  const { DialogueChainBuilder, ItemStatementDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new ItemStatementDialogue(0, itemId, text)));
}

function statement(player, text) {
  const { DialogueChainBuilder, StatementDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, text)));
}

function playSound(player, id) {
  core.Sounds.sendSound(player, new core.Sound(id, 1, 0, 0));
}

function chargeMessage(left) {
  return `Your venator bow has <col=ff0000>${format(left)} charges</col> remaining.`;
}

// ------------------------------------------------------------------ ricochets

function sizeOf(mobile) {
  return mobile.isNpc() ? Math.max(1, Number(mobile.getAsNpc().getSize?.() ?? 1)) : 1;
}

/**
 * The tiles a bounce is measured from (Wiki): the centre tile of a 3x3 or larger target, any tile
 * of a smaller one.
 */
function searchArea(mobile) {
  const x = mobile.getLocation().getX();
  const y = mobile.getLocation().getY();
  const size = sizeOf(mobile);
  if (size <= 2) return { x1: x, y1: y, x2: x + size - 1, y2: y + size - 1 };
  const half = Math.floor(size / 2);
  return { x1: x + half, y1: y + half, x2: x + half, y2: y + half };
}

/** Tiles between the bounce's origin and the nearest tile of `candidate`. */
function bounceDistance(origin, candidate) {
  if (origin.getLocation().getZ() !== candidate.getLocation().getZ()) return Infinity;
  const from = searchArea(origin);
  const x = candidate.getLocation().getX();
  const y = candidate.getLocation().getY();
  const size = sizeOf(candidate);
  const dx = Math.max(0, from.x1 - (x + size - 1), x - from.x2);
  const dy = Math.max(0, from.y1 - (y + size - 1), y - from.y2);
  return Math.max(dx, dy);
}

function nearbyMobiles(player) {
  return [...player.getLocalNpcs().values(), ...player.getLocalPlayers().values()];
}

/** The nearest target the arrow can bounce to from `origin`, ties broken at random. */
function nextTarget(player, origin, excluded) {
  const { CombatFactory } = core;
  let best = [];
  let bestDistance = Infinity;
  for (const candidate of nearbyMobiles(player)) {
    if (excluded.has(candidate)) continue;
    const distance = bounceDistance(origin, candidate);
    if (distance > BOUNCE_RADIUS || distance > bestDistance) continue;
    const reach = BOUNCE_RADIUS + sizeOf(origin) + sizeOf(candidate);
    if (!CombatFactory.canAttackSecondaryTarget(player, origin, candidate, reach)) continue;
    if (distance < bestDistance) {
      best = [];
      bestDistance = distance;
    }
    best.push(candidate);
  }
  return best.length > 0 ? best[core.Misc.getRandom(best.length - 1)] : null;
}

/**
 * Up to two bounce targets: never the target just hit, never one already bounced to, but the
 * last bounce may go back to the first target (Wiki).
 */
function bounceTargets(player, primary) {
  const targets = [];
  let origin = primary;
  const hit = new Set([primary]);
  for (let bounce = 0; bounce < BOUNCES; bounce++) {
    const excluded = new Set(hit);
    if (bounce === BOUNCES - 1) excluded.delete(primary);
    excluded.add(origin);
    const next = nextTarget(player, origin, excluded);
    if (!next) break;
    targets.push(next);
    hit.add(next);
    origin = next;
  }
  return targets;
}

/** The arrow's landing cycle, as RangedCombatMethod sends it. */
function arrowEndCycle(player, target) {
  const { RangedCombatMethod, WeaponProfiles } = core;
  const projectile = WeaponProfiles.ranged(player).projectiles?.[0];
  const distance = core.CombatPosition.projectileDistance(player, target);
  return projectile ? RangedCombatMethod.projectileEnd(projectile, distance) : 0;
}

function ricochet(player, primary, method, primaryDelay) {
  const { CombatFactory, DamageFormulas, PendingHit, Projectile } = core;
  const targets = bounceTargets(player, primary);
  if (targets.length === 0) return [];
  const bounceMax = Math.floor((DamageFormulas.calculateMaxRangedHit(player) * 2) / 3);
  const landed = arrowEndCycle(player, primary);
  const hits = [];
  let origin = primary;
  targets.forEach((target, index) => {
    const start = landed + BOUNCE_CYCLES * index;
    const end = start + BOUNCE_CYCLES;
    Projectile.createProjectile(origin, target, BOUNCE_PROJECTILE, start, end, BOUNCE_HEIGHT, BOUNCE_HEIGHT)
      .withAngle(BOUNCE_ANGLE)
      .withProgress(BOUNCE_PROGRESS)
      .sendProjectile();
    const delay = primaryDelay + BOUNCE_HIT_TICKS[index];
    const hit = new PendingHit(player, target, method, delay);
    CombatFactory.applyStyleDamage(hit, bounceMax);
    hits.push(hit);
    origin = target;
  });
  targets.forEach((_, index) => playSound(player, BOUNCE_SOUNDS[index]));
  return hits;
}

/** One charge per attack; at zero the bow reverts to its uncharged form. */
function spendCharge(player) {
  const item = player.getEquipment().get(core.Equipment.WEAPON_SLOT);
  if (!item || ![bowId, echoBowId].includes(item.getId())) return;
  // Content may spare the charge (a league relic): the question every charged weapon asks.
  const consume = { player, itemId: item.getId(), skip: false };
  pluginApi.emitCustomEvent("combat:consume-charge", consume);
  if (consume.skip) return;
  const left = charges(item) - 1;
  setCharges(item, left);
  if (left <= 0) {
    refresh(player);
    player.sendMessage("Your venator bow has run out of charges.");
    return;
  }
  if (left % 500 === 0 || left === 100 || left === 50) player.sendMessage(chargeMessage(left));
}

function createMethod() {
  const { RangedCombatMethod, CombatFactory } = core;
  return new (class VenatorBowCombatMethod extends RangedCombatMethod {
    hits(character, target) {
      const hits = super.hits(character, target);
      if (!character?.isPlayer?.()) return hits;
      const player = character.getAsPlayer();
      const bounces = CombatFactory.multiCombatBetween(player, target)
        ? ricochet(player, target, this, hits[0]?.getDelay?.() ?? 1)
        : [];
      spendCharge(player);
      return hits.concat(bounces);
    }
  })();
}

function resolveVenatorBow(attacker) {
  if (!attacker?.isPlayer?.()) return null;
  const weapon = attacker.getAsPlayer().getEquipment().get(core.Equipment.WEAPON_SLOT);
  if (!weapon || ![bowId, echoBowId].includes(weapon.getId()) || charges(weapon) <= 0) return null;
  venatorMethod ??= createMethod();
  return venatorMethod;
}

// ------------------------------------------------------------------ charges

/** Captures (rsprox): the count prompt, then an objectbox with the bow. */
function charge(event) {
  const { player } = event;
  const bow = isBow(event.usedItemId) ? event.usedItem : event.usedWithItem;
  const inventory = player.getInventory();
  const room = MAX_CHARGES - charges(bow);
  const most = Math.min(room, inventory.getAmount(essenceId));
  if (room <= 0) {
    player.sendMessage("Your venator bow is already fully charged.");
    return true;
  }
  player.setEnteredAmountAction({
    execute(amount) {
      if (!inventory.getItems().includes(bow)) return;
      const used = Math.min(Math.floor(Number(amount)), MAX_CHARGES - charges(bow), inventory.getAmount(essenceId));
      if (!(used > 0)) return;
      inventory.deleteNumber(essenceId, used);
      setCharges(bow, charges(bow) + used);
      refresh(player);
      itemStatement(player, chargedBowId(bow),
        `You use ${format(used)} ancient essence to charge your venator bow. It now has <col=ff0000>${format(charges(bow))}</col> charges.`);
    },
  });
  player.getPacketSender().sendEnterAmountPrompt(`How many charges do you wish to add to your venator bow? (0 - ${format(most)})`);
  return true;
}

function check({ player, item }) {
  player.sendMessage(chargeMessage(charges(item)));
  return true;
}

/** Wiki: uncharging returns every charge as ancient essence. */
function uncharge({ player, item }) {
  const inventory = player.getInventory();
  if (!inventory.getItems().includes(item)) return false;
  const amount = charges(item);
  if (amount <= 0) return true;
  const refund = new core.Item(essenceId, amount);
  if (inventory.getAddableAmount(refund) < amount) {
    player.sendMessage("You don't have enough inventory space to uncharge your venator bow.");
    return true;
  }
  setCharges(item, 0);
  inventory.add(refund);
  refresh(player);
  itemStatement(player, unchargedBowId(item), `You uncharge your venator bow, regaining ${format(amount)} ancient essence.`);
  return true;
}

// ------------------------------------------------------------------ bank

function bankAmount(player, itemId) {
  const { Bank } = core;
  return player.getBank(Bank.getTabForItem(player, itemId)).getAmount(itemId);
}

function refreshBank(player) {
  const { Bank } = core;
  if (!Bank.isOpen(player)) return;
  const tab = player.isSearchingBank() ? Bank.BANK_SEARCH_TAB_INDEX : player.getCurrentBankTab();
  player.getBank(tab).refreshItems();
}

/** Sets a banked bow to the charges asked for, paying with or refunding ancient essence in the bank. */
function configureCharges(player, bow, wanted) {
  const { Bank, Item } = core;
  const current = charges(bow);
  const target = Math.min(Math.floor(Number(wanted)), current + bankAmount(player, essenceId), MAX_CHARGES);
  if (!(target >= 0) || target === current) return;
  if (target > current) {
    player.getBank(Bank.getTabForItem(player, essenceId)).delete(essenceId, target - current);
  } else {
    const bank = player.getBank(Bank.getTabForItem(player, essenceId));
    const refund = new Item(essenceId, current - target);
    if (bank.getAddableAmount(refund) < refund.getAmount()) {
      bank.full();
      return;
    }
    bank.add(refund, false);
  }
  setCharges(bow, target);
  refreshBank(player);
  player.sendMessage(chargeMessage(target));
}

/** Wiki: Configure-Charges in the bank sets the bow's charges from the essence in the bank. */
function bankItemOp(event) {
  const { player, item } = event;
  if (!isBow(item?.getId?.()) || event.op !== CONFIGURE_CHARGES_OP) return;
  event.handled = true;
  if (item.getAmount() !== 1) {
    player.sendMessage("You can only configure one venator bow at a time.");
    return;
  }
  const most = Math.min(MAX_CHARGES, charges(item) + bankAmount(player, essenceId));
  player.setEnteredAmountAction({
    // 0 uncharges the bow.
    acceptsZero: true,
    execute(amount) {
      const { Bank } = core;
      if (!Bank.isOpen(player) || !isBow(item.getId()) || item.getAmount() !== 1) return;
      const stillBanked = player.getBanks().some((bank, tab) =>
        tab !== Bank.BANK_SEARCH_TAB_INDEX && bank?.getItems().includes(item));
      if (stillBanked) configureCharges(player, item, amount);
    },
  });
  player.getPacketSender().sendEnterAmountPrompt(`How many charges do you want your venator bow to have? (0 - ${format(most)})`);
}

// ------------------------------------------------------------------ shards

function createBow(player) {
  const inventory = player.getInventory();
  if (inventory.getAmount(shardId) < SHARDS_PER_BOW) return;
  const bow = new core.Item(unchargedId, 1);
  // deleteNumber consumes shard stacks in slot order; the first may free a slot.
  const firstStack = inventory.getItems().find(item => item.getId() === shardId && item.getAmount() > 0);
  if (inventory.getAddableAmount(bow) < 1 && firstStack.getAmount() > SHARDS_PER_BOW) {
    inventory.full();
    return;
  }
  inventory.deleteNumber(shardId, SHARDS_PER_BOW);
  inventory.add(bow);
  playSound(player, CREATE_SOUND);
  itemStatement(player, unchargedId, "You use five venator shards to create a venator bow.");
}

/** Captures (rsprox): a messagebox warning, then "Yes." / "No.", then an objectbox with the bow. */
function combineShards({ player }) {
  const { DialogueChainBuilder, StatementDialogue, OptionDialogue } = core;
  const missing = SHARDS_PER_BOW - player.getInventory().getAmount(shardId);
  if (missing > 0) {
    statement(player, `Creating a venator bow requires five venator shards. You need ${NUMBER_WORDS[missing]} more.`);
    return true;
  }
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new StatementDialogue(0, "Do you wish to use five venator shards to create a venator bow?<br>This process is non-reversible."),
    new OptionDialogue(1, {
      executeOption(option) {
        player.getPacketSender().sendInterfaceRemoval();
        if (Number(option) === 1) createBow(player);
      },
    }, "Yes.", "No.").setTitle("Do you wish to create a venator bow?"),
  ));
  return true;
}

module.exports = {
  name: "VenatorBow",
  members: true,
  register(api) {
    core = api.core;
    pluginApi = api;
    bowId = core.ItemIdentifiers.VENATOR_BOW;
    unchargedId = core.ItemIdentifiers.VENATOR_BOW_UNCHARGED_;
    echoBowId = core.ItemIdentifiers.ECHO_VENATOR_BOW;
    echoUnchargedId = core.ItemIdentifiers.ECHO_VENATOR_BOW_UNCHARGED_;
    // Echo is cosmetic: let the native ranged registry and item profile resolve through
    // the matching charged/uncharged Venator Bow definitions.
    core.ItemAliases.register(echoBowId, bowId);
    core.ItemAliases.register(echoUnchargedId, unchargedId);
    shardId = core.ItemIdentifiers.VENATOR_SHARD;
    essenceId = core.ItemIdentifiers.ANCIENT_ESSENCE;
    api.registerCombatMethodResolver({ resolve: resolveVenatorBow });
    api.onItemAction("Venator bow", { Check: check, Uncharge: uncharge });
    api.onItemAction("Venator bow (uncharged)", { Check: check, Uncharge: uncharge });
    api.onItemAction("Echo venator bow", { Check: check, Uncharge: uncharge });
    api.onItemAction("Echo venator bow (uncharged)", { Check: check, Uncharge: uncharge });
    api.onItemAction("Venator shard", { Combine: combineShards });
    api.onItemOnItem("Ancient essence", "Venator bow", charge, { noted: false });
    api.onItemOnItem("Ancient essence", "Venator bow (uncharged)", charge, { noted: false });
    api.onItemOnItem("Ancient essence", "Echo venator bow", charge, { noted: false });
    api.onItemOnItem("Ancient essence", "Echo venator bow (uncharged)", charge, { noted: false });
    api.onCustomEvent(core.Bank.ITEM_OP_EVENT, bankItemOp);
  },
  _test: {
    MAX_CHARGES,
    CHARGE_META_KEY,
    bounceDistance,
    charges,
  },
};
