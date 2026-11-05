"use strict";

/**
 * Tridents of the seas and the swamp, including enhanced and ornamented versions (docs/powered-staves.md).
 *
 * OSRS Wiki (https://oldschool.runescape.wiki/w/Trident_of_the_seas,
 * https://oldschool.runescape.wiki/w/Trident_of_the_swamp): powered staves casting every 4 ticks
 * from 7 tiles (9 on Longrange), max hit floor(Magic / 3) - 5 (seas, at least 1) or - 2 (swamp, at
 * least 4), 75 / 78 Magic to wield. 2,500 charges, 20,000 for the (e) versions. A charge is a
 * death rune, a chaos rune, five fire runes and 10 coins (seas) or a Zulrah's scale (swamp);
 * uncharging returns the runes and scales but not the coins. The swamp trident venoms 1 in 4
 * successful hits (a serpentine helm makes it certain, SerpentineHelm.plugin.js).
 *
 * The cast (rsprox captures 471-476, 4151, 4288, revisions 233-239): human_castwave_staff_walkmerge
 * (11430), slayer_tots_casting (1251, height 92) and synth sound 178; slayer_tots_projectile (1252)
 * from cycle 51 to 46 + 10 a tile, angle 16, progress 64, heights 92 to 60; slayer_tots_impact
 * (1253, height 92) with area sound 1460 on the target, both delayed to the projectile's end. The
 * hit lands on the projectile's arrival. Check: "Your Trident of the seas has N charges."; every
 * 100 charges a cast leaves: "Your Trident of the seas has N charges left.". The swamp trident is
 * not captured; it casts the same way with toxic_tots_casting / _projectile / _impact (665, 1040,
 * 1042).
 */

const { definePoweredStaff, refundsFit, restricted, plainAmount, takePlain, PRESET_TEXT, distance, ticksFor } = require("./PoweredStaff");

const TRIDENT_CHARGE_META_KEY = "trident-charges";
const TRIDENT_MAX_CHARGES = 2500;
const ENHANCED_MAX_CHARGES = 20000;
const FIRE_RUNES_PER_CHARGE = 5;
const COINS_PER_CHARGE = 10;
const ATTACK_SPEED = 4;
const ATTACK_RANGE = 7;
const WARNING_EVERY = 100;
const VENOM_CHANCE = 0.25;
const VENOM_SEVERITY = 6;

const CAST_ANIMATION = 11430; // cache gameval human_castwave_staff_walkmerge
const CAST_SOUND = 178;
const IMPACT_SOUND = 1460;
const SPLASH_GRAPHIC = 85; // cache gameval failedspell_impact
const SPLASH_SOUND = 227;
const IMPACT_HEIGHT = 92;
const SPLASH_HEIGHT = 124;
const PROJECTILE = { START: 51, BASE: 46, PER_TILE: 10, START_HEIGHT: 92, END_HEIGHT: 60, ANGLE: 16, PROGRESS: 64 };

const SEAS_LOOK = { name: "Trident of the seas", casting: 1251, projectile: 1252, impact: 1253 }; // slayer_tots_*
const SWAMP_LOOK = { name: "Trident of the swamp", casting: 665, projectile: 1040, impact: 1042 }; // toxic_tots_*

let core = null;
let api = null;
let ItemIdentifiers = null;
let DEATH_RUNE_ID = 0;
let CHAOS_RUNE_ID = 0;
let FIRE_RUNE_ID = 0;
let COINS_ID = 0;
let ZULRAH_SCALES_ID = 0;
let RECIPES = [];
let staves = [];

function initialize(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  ItemIdentifiers = core.ItemIdentifiers;
  const I = ItemIdentifiers;
  DEATH_RUNE_ID = I.DEATH_RUNE;
  CHAOS_RUNE_ID = I.CHAOS_RUNE;
  FIRE_RUNE_ID = I.FIRE_RUNE;
  COINS_ID = I.COINS;
  ZULRAH_SCALES_ID = I.ZULRAHS_SCALES;
  const runes = [[DEATH_RUNE_ID, 1], [CHAOS_RUNE_ID, 1], [FIRE_RUNE_ID, FIRE_RUNES_PER_CHARGE]];
  const seas = (unchargedId, chargedId, maxCharges, ornamented, fullChargedIds = []) => ({
    unchargedId, chargedId, maxCharges, look: SEAS_LOOK, venom: false,
    pairs: [
      ...fullChargedIds.map((id) => [id, unchargedId]),
      [chargedId, unchargedId],
      ...(ornamented ? [
        ...(ornamented.fullChargedId ? [[ornamented.fullChargedId, ornamented.unchargedId]] : []),
        [ornamented.chargedId, ornamented.unchargedId],
      ] : []),
    ],
    fullChargedIds: new Set([...fullChargedIds, ...(ornamented?.fullChargedId ? [ornamented.fullChargedId] : [])]),
    minimumMaxHit: 1, maxHitOffset: -5, levelRequired: 75,
    primaryResourceId: COINS_ID, primaryPerCharge: COINS_PER_CHARGE, primaryName: "coins",
    refundResources: runes,
  });
  const swamp = (unchargedId, chargedId, maxCharges, ornamented) => ({
    unchargedId, chargedId, maxCharges, look: SWAMP_LOOK, venom: true,
    pairs: [[chargedId, unchargedId], [ornamented.chargedId, ornamented.unchargedId]],
    fullChargedIds: new Set(),
    minimumMaxHit: 4, maxHitOffset: -2, levelRequired: 78,
    primaryResourceId: ZULRAH_SCALES_ID, primaryPerCharge: 1, primaryName: "Zulrah scales",
    refundResources: [...runes, [ZULRAH_SCALES_ID, 1]],
  });
  RECIPES = [
    seas(I.UNCHARGED_TRIDENT, I.TRIDENT_OF_THE_SEAS, TRIDENT_MAX_CHARGES, {
      chargedId: I.TRIDENT_OF_THE_SEAS_O_,
      unchargedId: I.UNCHARGED_TRIDENT_O_,
      fullChargedId: I.TRIDENT_OF_THE_SEAS_FULL_O_,
    }, [I.TRIDENT_OF_THE_SEAS_FULL_]),
    swamp(I.UNCHARGED_TOXIC_TRIDENT, I.TRIDENT_OF_THE_SWAMP, TRIDENT_MAX_CHARGES, {
      chargedId: I.TRIDENT_OF_THE_SWAMP_O_, unchargedId: I.UNCHARGED_TOXIC_TRIDENT_O_,
    }),
    seas(I.UNCHARGED_TRIDENT_E_, I.TRIDENT_OF_THE_SEAS_E_, ENHANCED_MAX_CHARGES, {
      chargedId: I.TRIDENT_OF_THE_SEAS_E_O_, unchargedId: I.UNCHARGED_TRIDENT_E_O_,
    }),
    swamp(I.UNCHARGED_TOXIC_TRIDENT_E_, I.TRIDENT_OF_THE_SWAMP_E_, ENHANCED_MAX_CHARGES, {
      chargedId: I.TRIDENT_OF_THE_SWAMP_E_O_, unchargedId: I.UNCHARGED_TOXIC_TRIDENT_E_O_,
    }),
  ];
  staves = RECIPES.map((recipe) => {
    recipe.staff = definePoweredStaff(api, staffConfig(recipe));
    return recipe.staff;
  });
}

// ------------------------------------------------------------------ combat

function projectileEnd(from, to) {
  return PROJECTILE.BASE + Math.max(1, distance(from, to, core.CombatPosition)) * PROJECTILE.PER_TILE;
}

function maxHit(recipe, player) {
  const magic = player.getSkillManager().getCurrentLevel(core.Skill.MAGIC);
  return Math.max(recipe.minimumMaxHit, Math.floor(magic / 3) + recipe.maxHitOffset);
}

function look(recipe) {
  return ({ Animation, Graphic, Projectile }) => ({
    castAnimation: () => new Animation(CAST_ANIMATION),
    startGraphic: () => new Graphic(recipe.look.casting, 0, IMPACT_HEIGHT),
    castSound: () => CAST_SOUND,
    castProjectile: (cast, castOn) => Projectile.createProjectile(cast, castOn, recipe.look.projectile, PROJECTILE.START,
      projectileEnd(cast, castOn), PROJECTILE.START_HEIGHT / 4, PROJECTILE.END_HEIGHT / 4)
      .withAngle(PROJECTILE.ANGLE).withProgress(PROJECTILE.PROGRESS),
  });
}

/** Live sends the impact (or the splash) with the cast, delayed to the projectile's end. */
function impact(recipe) {
  return (attacker, target, accurate) => {
    const end = projectileEnd(attacker, target);
    return accurate
      ? { graphic: new core.Graphic(recipe.look.impact, end, IMPACT_HEIGHT), areaSound: { id: IMPACT_SOUND, delay: end } }
      : { graphic: new core.Graphic(SPLASH_GRAPHIC, end, SPLASH_HEIGHT), areaSound: { id: SPLASH_SOUND, delay: end } };
  };
}

/** Wiki: the swamp trident venoms a quarter of its successful hits. */
function venom(hit) {
  const target = hit.getTarget();
  if (!hit.isAccurate() || !(hit.getTotalDamage() > 0) || target?.isVenomed?.()) return;
  if (Math.random() >= VENOM_CHANCE) return;
  core.CombatFactory.poisonEntity(target, VENOM_SEVERITY, 2);
}

function chargeUsed(recipe) {
  return (player, staff, left) => {
    if (left > 0 && left % WARNING_EVERY === 0) {
      player.sendMessage(`Your ${recipe.look.name} has ${left.toLocaleString("en-US")} charges left.`);
    }
  };
}

function staffConfig(recipe) {
  return {
    name: recipe.look.name,
    chargesKey: TRIDENT_CHARGE_META_KEY,
    maxCharges: recipe.maxCharges,
    pairs: recipe.pairs,
    maxHit: (player) => maxHit(recipe, player),
    attackSpeed: ATTACK_SPEED,
    range: ATTACK_RANGE,
    levelRequired: recipe.levelRequired,
    spell: look(recipe),
    hitDelay: (attacker, target) => ticksFor(projectileEnd(attacker, target)),
    impact: impact(recipe),
    onHitLanded: recipe.venom ? venom : undefined,
    chargeUsed: chargeUsed(recipe),
    noChargesMessage: "Your trident has no charges! You need to charge it with runes.",
    ranOutMessage: "Your trident has run out of charges.",
  };
}

function resolveTrident(attacker) {
  if (attacker?.isPlayer?.()) {
    const item = attacker.getAsPlayer().getEquipment().get(core.Equipment.WEAPON_SLOT);
    const recipe = recipeForTridentId(item?.getId?.());
    if (recipe?.fullChargedIds.has(item.getId()) && item.getMetaValue?.(TRIDENT_CHARGE_META_KEY) == null) {
      item.setMetaValue(TRIDENT_CHARGE_META_KEY, recipe.maxCharges);
    }
  }
  for (const staff of staves) {
    const method = staff.resolver.resolve(attacker);
    if (method) return method;
  }
  return null;
}

// ------------------------------------------------------------------ charges

function recipeForTridentId(itemId) {
  return RECIPES.find((recipe) => recipe.pairs.some(([charged, uncharged]) => charged === itemId || uncharged === itemId)) ?? null;
}

function isTridentId(itemId) {
  return recipeForTridentId(itemId) !== null;
}

function getCharges(item) {
  const recipe = recipeForTridentId(item?.getId?.());
  if (!recipe) return 0;
  if (recipe.fullChargedIds.has(item.getId()) && item.getMetaValue?.(TRIDENT_CHARGE_META_KEY) == null) return recipe.maxCharges;
  return recipe.staff.chargesOf(item);
}

function setCharges(item, value) {
  return recipeForTridentId(item.getId())?.staff.setCharges(item, value) ?? 0;
}

function getItemContainer(player, item, preferredSlot = -1) {
  const inventory = player.getInventory();
  if (preferredSlot >= 0 && inventory.getItems()[preferredSlot] === item) {
    return inventory;
  }
  if (inventory.getItems().includes(item)) {
    return inventory;
  }
  const equipment = player.getEquipment();
  if (equipment.getItems().includes(item)) {
    return equipment;
  }
  return null;
}

function refreshTridentState(player, item, slot = -1) {
  const container = getItemContainer(player, item, slot);
  if (container) {
    container.refreshItems();
    if (container === player.getEquipment()) {
      player.getUpdateFlag()?.flag?.(core.Flag.APPEARANCE);
    }
  }
}

function chargeTrident(player, tridentItem, tridentSlot, recipe) {
  const current = getCharges(tridentItem);
  if (current >= recipe.maxCharges) {
    player.sendMessage("Your trident cannot hold any more charges.");
    return;
  }

  const inventory = player.getInventory();
  const batches = (amountOf) => Math.min(
    amountOf(DEATH_RUNE_ID),
    amountOf(CHAOS_RUNE_ID),
    Math.floor(amountOf(FIRE_RUNE_ID) / FIRE_RUNES_PER_CHARGE),
    Math.floor(amountOf(recipe.primaryResourceId) / recipe.primaryPerCharge),
    recipe.maxCharges - current
  );
  const affordable = batches((id) => plainAmount(inventory, id));

  if (affordable <= 0) {
    if (batches((id) => inventory.getAmount(id)) > 0) {
      player.sendMessage(PRESET_TEXT);
      return;
    }
    player.sendMessage(
      `You need death runes, chaos runes, fire runes and ${recipe.primaryName} to charge this.`
    );
    return;
  }

  takePlain(inventory, DEATH_RUNE_ID, affordable);
  takePlain(inventory, CHAOS_RUNE_ID, affordable);
  takePlain(inventory, FIRE_RUNE_ID, affordable * FIRE_RUNES_PER_CHARGE);
  takePlain(inventory, recipe.primaryResourceId, affordable * recipe.primaryPerCharge);

  setCharges(tridentItem, current + affordable);
  refreshTridentState(player, tridentItem, tridentSlot);
  player.sendMessage(
    `You add ${affordable} charge${affordable === 1 ? "" : "s"} to your trident. It now has ${current + affordable} charges.`
  );
  return true;
}

/** rsprox: "Your Trident of the seas has N charges." */
function sendChargeStatus({ player, item: tridentItem }) {
  const recipe = recipeForTridentId(tridentItem?.getId?.());
  if (!recipe) return false;
  player.sendMessage(`Your ${recipe.look.name} has ${getCharges(tridentItem).toLocaleString("en-US")} charges.`);
  return true;
}

function chargeOption({ player, item, slot }) {
  const recipe = recipeForTridentId(item?.getId?.());
  if (!recipe) return false;
  return chargeTrident(player, item, slot, recipe) !== false;
}

function chargeWithResources(event) {
  const { player, usedItemId, usedWithItemId, usedItemSlot, usedWithItemSlot, usedItem, usedWithItem } = event;
  const tridentOnLeft = isTridentId(usedItemId);
  const tridentOnRight = isTridentId(usedWithItemId);
  if (!tridentOnLeft && !tridentOnRight) return;

  const tridentItem = tridentOnLeft ? usedItem : usedWithItem;
  const tridentSlot = tridentOnLeft ? usedItemSlot : usedWithItemSlot;
  const otherItemId = tridentOnLeft ? usedWithItemId : usedItemId;
  const recipe = recipeForTridentId(tridentItem.getId());
  if (!recipe || ![DEATH_RUNE_ID, CHAOS_RUNE_ID, FIRE_RUNE_ID, recipe.primaryResourceId].includes(otherItemId)) {
    return;
  }

  event.handled = true;
  if (restricted(tridentOnLeft ? usedWithItem : usedItem)) {
    player.sendMessage(PRESET_TEXT);
    return;
  }
  chargeTrident(player, tridentItem, tridentSlot, recipe);
}

function unchargeTrident({ player, item }) {
  const recipe = recipeForTridentId(item?.getId?.());
  if (!recipe || !recipe.pairs.some(([charged]) => charged === item.getId())) return false;
  const current = getCharges(item);
  if (current <= 0) {
    player.sendMessage("Your trident has no charges to remove.");
    return true;
  }

  const inventory = player.getInventory();
  const refunds = recipe.refundResources.map(([resourceId, amountPerCharge]) => new core.Item(resourceId, current * amountPerCharge));
  if (!refundsFit(inventory, refunds)) {
    player.sendMessage("Your inventory is too full to uncharge your trident.");
    return true;
  }

  for (const refund of refunds) inventory.addItem(refund);
  setCharges(item, 0);
  refreshTridentState(player, item);
  player.sendMessage(
    recipe.primaryResourceId === ZULRAH_SCALES_ID
      ? "You uncharge your trident and regain its runes and Zulrah scales."
      : "You uncharge your trident and regain its runes. The coins are not refunded."
  );
  return true;
}

/**
 * Wiki (Uncharged toxic trident): Dismantle asks "Remove the fang from the trident?" and gives the
 * uncharged trident and the magic fang back.
 */
function dismantle({ player, item }) {
  const I = ItemIdentifiers;
  const trident = new Map([
    [I.UNCHARGED_TOXIC_TRIDENT, I.UNCHARGED_TRIDENT],
    [I.UNCHARGED_TOXIC_TRIDENT_E_, I.UNCHARGED_TRIDENT_E_],
  ]).get(item?.getId?.());
  if (trident === undefined) return false;
  const { DialogueChainBuilder, OptionDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new OptionDialogue(0, {
      executeOption(option) {
        player.getPacketSender().sendInterfaceRemoval();
        if (Number(option) === 1) removeFang(player, item, trident);
      },
    }, "Yes.", "No.").setTitle("Remove the fang from the trident?"),
  ));
  return true;
}

function removeFang(player, item, trident) {
  const inventory = player.getInventory();
  if (!inventory.getItems().includes(item)) return;
  if (inventory.getFreeSlots() < 1) {
    player.sendMessage("You don't have enough inventory space to do that.");
    return;
  }
  item.setId(trident);
  inventory.addItem(new core.Item(ItemIdentifiers.MAGIC_FANG, 1));
  inventory.refreshItems();
  player.sendMessage("You wrench the fang off the trident. Both items seem to be unharmed.");
}

function answerSpell(request) {
  for (const staff of staves) staff.answerSpell(request);
}

module.exports = {
  name: "Trident",
  members: true,
  _test: {
    get RECIPES() { return RECIPES; },
    get TRIDENT_CHARGE_META_KEY() { return TRIDENT_CHARGE_META_KEY; },
    get TRIDENT_MAX_CHARGES() { return TRIDENT_MAX_CHARGES; },
    get ENHANCED_MAX_CHARGES() { return ENHANCED_MAX_CHARGES; },
    recipeForTridentId,
    getCharges,
    setCharges,
    chargeTrident,
    chargeWithResources,
    unchargeTrident,
    sendChargeStatus,
    resolveTrident,
    maxHit,
    projectileEnd,
    venom,
    dismantle,
    removeFang,
  },
  register(pluginApi) {
    initialize(pluginApi);
    pluginApi.onItemOnItem(chargeWithResources, { noted: false });
    for (const name of [
      "Trident of the Seas", "Trident of the Seas (full)", "Trident of the Seas (o)", "Trident of the Seas (full) (o)",
      "Trident of the Seas (e)", "Trident of the Seas (e) (o)",
      "Trident of the Swamp", "Trident of the Swamp (o)", "Trident of the Swamp (e)", "Trident of the Swamp (e) (o)",
    ]) {
      pluginApi.onItemAction(name, { Check: sendChargeStatus, Charge: chargeOption, Uncharge: unchargeTrident });
    }
    for (const name of ["Uncharged trident", "Uncharged trident (e)", "Uncharged toxic trident", "Uncharged toxic trident (e)"]) {
      // Check works uncharged too, in the inventory and worn (an unhandled worn option unequips).
      pluginApi.onItemAction(name, { Check: sendChargeStatus, Charge: chargeOption, Dismantle: dismantle });
    }
    for (const name of [
      "Uncharged trident (o)", "Uncharged trident (e) (o)",
      "Uncharged toxic trident (o)", "Uncharged toxic trident (e) (o)",
    ]) {
      // Ornament removal takes the Dismantle option; the generic ornament handler owns it.
      pluginApi.onItemAction(name, { Check: sendChargeStatus, Charge: chargeOption });
    }
    pluginApi.registerCombatMethodResolver({ resolve: resolveTrident });
    pluginApi.onCustomEvent("powered-staff:spell", answerSpell);
  },
};
