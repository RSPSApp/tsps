"use strict";

/**
 * Eye of Ayak (docs/powered-staves.md; https://oldschool.runescape.wiki/w/Eye_of_Ayak).
 *
 * Wiki: a powered staff casting every 3 ticks from 6 tiles (8 on Longrange), max hit
 * floor(Magic / 3) - 6, 83 Magic. Up to 50,000 charges, one a cast, each a demon tear or two
 * death runes and a chaos rune; it holds one kind at a time. Uncharging returns every tear or
 * rune. Its special, Soul Rend, is plugins/combat/specials/EyeOfAyak.SpecialAttack.js.
 *
 * The cast (rsprox capture 3080, revision 231): human_eye_of_ayak_normal (12397) with
 * vfx_ayak_player_normal_spotanim (3366) and synth sound 178; vfx_ayak_normal_projectile (3367)
 * from cycle 51 to 51 + 5 a tile past the first, angle 16, progress 64, heights 172 to 124;
 * vfx_ayak_normal_impact (3368, height 124) and area sound 1460 on the target, delayed to the
 * projectile's end, or failedspell_impact (85) and area sound 227 for a splash. The hit lands on
 * the projectile's arrival, with synth sound 3533. Charges show in varbit
 * charges_eye_of_ayak_quantity (16623).
 *
 * Charging (rsprox 3080): demon tears on the staff ask "How many charges do you wish to add?
 * (0 - N)", then "The Eye of Ayak has been charged with demon tears. It currently has N
 * charges." (with runes: "...charged with runes..."). Uncharge asks "Fully uncharge the Eye of
 * Ayak?" (Yes. / No.), then "You uncharge the Eye of Ayak.". Dismantle (Wiki, not captured) turns
 * the uncharged staff into 10,000 demon tears, after a Yes / No.
 */

const { definePoweredStaff, distance, ticksFor } = require("./PoweredStaff");

const CHARGES_KEY = "eye-of-ayak-charges";
const MATERIAL_KEY = "eye-of-ayak-charge-material";
const MAX_CHARGES = 50000;
const DEATH_RUNES_PER_CHARGE = 2;
const CHAOS_RUNES_PER_CHARGE = 1;
const ATTACK_SPEED = 3;
const ATTACK_RANGE = 6;
const LEVEL_REQUIRED = 83;
const MAX_HIT_OFFSET = -6;
const CHARGES_VARBIT = 16623; // cache gameval charges_eye_of_ayak_quantity

const CAST_ANIMATION = 12397; // human_eye_of_ayak_normal
const CAST_GRAPHIC = 3366; // vfx_ayak_player_normal_spotanim
const PROJECTILE_GRAPHIC = 3367; // vfx_ayak_normal_projectile
const IMPACT_GRAPHIC = 3368; // vfx_ayak_normal_impact
const SPLASH_GRAPHIC = 85; // failedspell_impact
const IMPACT_HEIGHT = 124;
const CAST_SOUND = 178;
const IMPACT_SOUND = 1460;
const SPLASH_SOUND = 227;
const LAND_SOUND = 3533;
// Captured: 51 to 51 at one tile, 56 at two, 61 at three, 66 at four. A one-cycle flight is
// never sent (PacketSender.sendProjectile), so one tile ends at 53.
const PROJECTILE = { START: 51, PER_TILE: 5, MIN_END: 53, START_HEIGHT: 172, END_HEIGHT: 124, ANGLE: 16, PROGRESS: 64 };

const DISMANTLE_TEARS = 10000;
const TEARS = "tears";
const RUNES = "runes";

let api = null;
let core = null;
let staff = null;

function ids() {
  return core.ItemIdentifiers;
}

function format(amount) {
  return amount.toLocaleString("en-US");
}

// ------------------------------------------------------------------ combat

function projectileEnd(from, to) {
  return Math.max(PROJECTILE.MIN_END, PROJECTILE.START + (Math.max(1, distance(from, to)) - 1) * PROJECTILE.PER_TILE);
}

function maxHit(player) {
  return Math.max(0, Math.floor(player.getSkillManager().getCurrentLevel(core.Skill.MAGIC) / 3) + MAX_HIT_OFFSET);
}

function look({ Animation, Graphic, Projectile }) {
  return {
    castAnimation: () => new Animation(CAST_ANIMATION),
    startGraphic: () => new Graphic(CAST_GRAPHIC),
    castSound: () => CAST_SOUND,
    castProjectile: (cast, castOn) => Projectile.createProjectile(cast, castOn, PROJECTILE_GRAPHIC, PROJECTILE.START,
      projectileEnd(cast, castOn), PROJECTILE.START_HEIGHT / 4, PROJECTILE.END_HEIGHT / 4)
      .withAngle(PROJECTILE.ANGLE).withProgress(PROJECTILE.PROGRESS),
  };
}

function impact(attacker, target, accurate) {
  const end = projectileEnd(attacker, target);
  return {
    graphic: new core.Graphic(accurate ? IMPACT_GRAPHIC : SPLASH_GRAPHIC, end, IMPACT_HEIGHT),
    areaSound: { id: accurate ? IMPACT_SOUND : SPLASH_SOUND, delay: end },
  };
}

function syncWornCharges(player) {
  const weapon = staff.weaponOf(player);
  const charges = staff.isCharged(weapon?.getId?.()) ? staff.chargesOf(weapon) : 0;
  player.getPacketSender().sendVarbit(CHARGES_VARBIT, charges);
}

function emptied(player) {
  staff.weaponOf(player)?.setMetaValue?.(MATERIAL_KEY, undefined);
  syncWornCharges(player);
}

function defineEye() {
  const I = ids();
  return definePoweredStaff(api, {
    name: "Eye of Ayak",
    chargesKey: CHARGES_KEY,
    maxCharges: MAX_CHARGES,
    pairs: [[I.EYE_OF_AYAK, I.EYE_OF_AYAK_UNCHARGED_]],
    maxHit,
    attackSpeed: ATTACK_SPEED,
    range: ATTACK_RANGE,
    levelRequired: LEVEL_REQUIRED,
    spell: look,
    hitDelay: (attacker, target) => ticksFor(projectileEnd(attacker, target)),
    impact,
    landSound: LAND_SOUND,
    specialId: "eye_of_ayak",
    chargeUsed: (player) => syncWornCharges(player),
    emptied,
    noChargesMessage: "The Eye of Ayak has no charges! You need to charge it with demon tears or runes.",
    ranOutMessage: "The Eye of Ayak has run out of charges.",
  });
}

// ------------------------------------------------------------------ charges

function materialOf(item) {
  return staff.chargesOf(item) > 0 ? (item.getMetaValue(MATERIAL_KEY) ?? null) : null;
}

/** How many charges the inventory pays for in one material. */
function affordable(player, material) {
  const inventory = player.getInventory();
  const I = ids();
  if (material === TEARS) return inventory.getAmount(I.DEMON_TEAR);
  return Math.min(
    Math.floor(inventory.getAmount(I.DEATH_RUNE) / DEATH_RUNES_PER_CHARGE),
    Math.floor(inventory.getAmount(I.CHAOS_RUNE) / CHAOS_RUNES_PER_CHARGE),
  );
}

function pay(player, material, charges) {
  const inventory = player.getInventory();
  const I = ids();
  if (material === TEARS) {
    inventory.deleteNumber(I.DEMON_TEAR, charges);
    return;
  }
  inventory.deleteNumber(I.DEATH_RUNE, charges * DEATH_RUNES_PER_CHARGE);
  inventory.deleteNumber(I.CHAOS_RUNE, charges * CHAOS_RUNES_PER_CHARGE);
}

/** The material a charge would use: what it already holds, else tears before runes. */
function chooseMaterial(player, item, preferred) {
  const held = materialOf(item);
  if (held) return held;
  if (preferred) return preferred;
  return affordable(player, TEARS) > 0 ? TEARS : RUNES;
}

function chargeEye(player, item, preferred = null) {
  const material = chooseMaterial(player, item, preferred);
  const held = materialOf(item);
  if (held && preferred && held !== preferred) {
    player.sendMessage(held === RUNES
      ? "The Eye of Ayak is charged with runes, and thus can only be charged with more runes. You must fully uncharge it to use demon tears."
      : "The Eye of Ayak is charged with demon tears, and thus can only be charged with more demon tears. You must fully uncharge it to use runes.");
    return true;
  }
  const room = MAX_CHARGES - staff.chargesOf(item);
  if (room <= 0) {
    player.sendMessage("The Eye of Ayak cannot hold any more charges.");
    return true;
  }
  const most = Math.min(room, affordable(player, material));
  if (most <= 0) {
    player.sendMessage("You need at least one chaos rune and two death runes or one demon tear in order to charge the Eye of Ayak.");
    return true;
  }
  player.setEnteredAmountAction({
    acceptsZero: true,
    execute: (amount) => addCharges(player, item, material, amount),
  });
  player.getPacketSender().sendEnterAmountPrompt(`How many charges do you wish to add? (0 - ${format(most)})`);
  return true;
}

function addCharges(player, item, material, amount) {
  if (!player.getInventory().getItems().includes(item)) return;
  const current = staff.chargesOf(item);
  const added = Math.min(Math.floor(Number(amount) || 0), MAX_CHARGES - current, affordable(player, material));
  if (!(added > 0)) return;
  pay(player, material, added);
  staff.setCharges(item, current + added);
  item.setMetaValue(MATERIAL_KEY, material);
  player.getInventory().refreshItems();
  player.sendMessage(`The Eye of Ayak has been charged with ${material === TEARS ? "demon tears" : "runes"}. It currently has ${format(current + added)} charges.`);
}

function chargeOption({ player, item }) {
  if (!staff.isStaff(item?.getId?.())) return false;
  return chargeEye(player, item);
}

function chargeWithItem(event) {
  const { player, usedItem, usedWithItem, usedItemId, usedWithItemId } = event;
  const item = staff.isStaff(usedItemId) ? usedItem : staff.isStaff(usedWithItemId) ? usedWithItem : null;
  if (!item) return;
  const I = ids();
  const other = Number(item === usedItem ? usedWithItemId : usedItemId);
  if (other === I.DEMON_TEAR) {
    event.handled = chargeEye(player, item, TEARS);
  } else if (other === I.DEATH_RUNE || other === I.CHAOS_RUNE) {
    event.handled = chargeEye(player, item, RUNES);
  }
}

function checkCharges({ player, item }) {
  const charges = staff.chargesOf(item);
  const material = materialOf(item);
  player.sendMessage(material
    ? `The Eye of Ayak is charged with ${material === TEARS ? "demon tears" : "runes"}. It currently has ${format(charges)} charges.`
    : "The Eye of Ayak has no charges.");
  return true;
}

function refund(player, item) {
  const charges = staff.chargesOf(item);
  const material = materialOf(item);
  if (charges <= 0 || !player.getInventory().getItems().includes(item)) return;
  const inventory = player.getInventory();
  const I = ids();
  const returned = material === TEARS
    ? [[I.DEMON_TEAR, charges]]
    : [[I.DEATH_RUNE, charges * DEATH_RUNES_PER_CHARGE], [I.CHAOS_RUNE, charges * CHAOS_RUNES_PER_CHARGE]];
  const slots = returned.filter(([id]) => !inventory.contains(id)).length;
  if (inventory.getFreeSlots() < slots) {
    player.sendMessage("You don't have enough inventory space to uncharge the Eye of Ayak.");
    return;
  }
  for (const [id, amount] of returned) inventory.addItem(new core.Item(id, amount));
  staff.setCharges(item, 0);
  item.setMetaValue(MATERIAL_KEY, undefined);
  inventory.refreshItems();
  player.sendMessage("You uncharge the Eye of Ayak.");
}

function uncharge({ player, item }) {
  if (staff.chargesOf(item) <= 0) {
    player.sendMessage("The Eye of Ayak has no charges to remove.");
    return true;
  }
  const { DialogueChainBuilder, OptionDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new OptionDialogue(0, {
      executeOption(option) {
        player.getPacketSender().sendInterfaceRemoval();
        if (Number(option) === 1) refund(player, item);
      },
    }, "Yes.", "No.").setTitle("Fully uncharge the Eye of Ayak?"),
  ));
  return true;
}

/** Wiki: the uncharged staff "can be dismantled for 10,000 demon tears". It can't be undone, so it asks. */
function dismantle({ player, item }) {
  if (item?.getId?.() !== ids().EYE_OF_AYAK_UNCHARGED_) return false;
  const { DialogueChainBuilder, OptionDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new OptionDialogue(0, {
      executeOption(option) {
        player.getPacketSender().sendInterfaceRemoval();
        if (Number(option) === 1) dismantleIntoTears(player, item);
      },
    }, "Yes.", "No.").setTitle(`Dismantle the Eye of Ayak into ${format(DISMANTLE_TEARS)} demon tears?`),
  ));
  return true;
}

function dismantleIntoTears(player, item) {
  const inventory = player.getInventory();
  const slot = inventory.getItems().indexOf(item);
  if (slot < 0 || item.getId() !== ids().EYE_OF_AYAK_UNCHARGED_) return;
  inventory.getItems()[slot] = null;
  inventory.addItem(new core.Item(ids().DEMON_TEAR, DISMANTLE_TEARS));
  inventory.refreshItems();
  player.sendMessage(`You dismantle the Eye of Ayak into ${format(DISMANTLE_TEARS)} demon tears.`);
}

function equipmentChanged({ player }) {
  syncWornCharges(player);
}

module.exports = {
  name: "EyeOfAyak",
  members: true,
  _test: {
    CHARGES_KEY, MATERIAL_KEY, MAX_CHARGES, CHARGES_VARBIT,
    get staff() { return staff; },
    maxHit, projectileEnd, chargeEye, addCharges, chargeWithItem, checkCharges, uncharge, refund, dismantle, dismantleIntoTears,
  },
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    staff = defineEye();
    pluginApi.registerCombatMethodResolver(staff.resolver);
    pluginApi.onCustomEvent("powered-staff:spell", staff.answerSpell);
    pluginApi.onItemAction("Eye of Ayak", { Check: checkCharges, Uncharge: uncharge });
    pluginApi.onItemAction("Eye of Ayak (uncharged)", { Charge: chargeOption, Dismantle: dismantle });
    pluginApi.onItemOnItem(chargeWithItem, { noted: false });
    pluginApi.onCustomEvent("equipment:changed", equipmentChanged);
    pluginApi.onPlayerLogin(equipmentChanged);
  },
};
