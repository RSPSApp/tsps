"use strict";

/**
 * Lithic sceptre (https://oldschool.runescape.wiki/w/Lithic_sceptre), the Echo Grotesque
 * Guardians' unique in the Demonic Pacts League: a one-handed powered staff (PoweredStaff.js).
 *
 * - Built-in spell, max hit max(10, floor(Magic / 3) - 10) (the current Magic level, as the other
 *   powered staves), an attack every 4 ticks from 7 tiles (9 on Longrange), one charge a cast.
 * - The cast: human_eye_of_ayak_normal and synth sound 11409; vfx_lithic_sceptre_projanim_01 from
 *   cycle 51 to 51 + 5 a tile past the first, angle 16, progress 64, heights 172 to 124 (the Eye of
 *   Ayak's timing); vfx_glaive_01_impact_regular_01 (height 124) and area sound 11410 on the target,
 *   delayed to the projectile's end, or failedspell_impact and area sound 227 for a splash.
 * - Charged with 1 body rune and 3 earth runes a charge, up to 10,000. Check: "The Lithic sceptre
 *   currently has N charges."
 * - Shatter stacks, shown in varbit lithic_sceptre_shatter_stacks: one for every attack with the
 *   sceptre, a splash too, as its hit lands, up to 14. Out of combat one is lost every 50 ticks,
 *   sceptre worn or not; teleporting or entering an instance loses them all (`private-area:entered`,
 *   as the player joins it).
 * - Explosive Shatter, its special (combat/specials/LithicSceptre.SpecialAttack.js), uses 5 stacks:
 *   `lithic-sceptre:stacks` { player, stacks, consume, consumed } reads them and takes `consume`.
 */

const { definePoweredStaff, restricted, plainAmount, takePlain, refundsFit, PRESET_TEXT, distance, ticksFor } = require("./PoweredStaff");

const CHARGES_KEY = "lithic-sceptre-charges";
const MAX_CHARGES = 10000;
const BODY_PER_CHARGE = 1;
const EARTH_PER_CHARGE = 3;
const ATTACK_SPEED = 4;
const ATTACK_RANGE = 7;
const MIN_MAX_HIT = 10;
const SPECIAL_ID = "lithic_sceptre";

const STACKS_ATTRIBUTE = "lithic-sceptre:shatter-stacks";
const STACKS_VARBIT = "lithic_sceptre_shatter_stacks";
const MAX_STACKS = 14;
const DECAY_TICKS = 50;

const CAST_ANIMATION = "human_eye_of_ayak_normal";
const CAST_SOUND = 11409;
const PROJECTILE_GRAPHIC = "vfx_lithic_sceptre_projanim_01";
const IMPACT_GRAPHIC = "vfx_glaive_01_impact_regular_01";
const SPLASH_GRAPHIC = 85; // failedspell_impact
const IMPACT_HEIGHT = 124;
const IMPACT_SOUND = 11410;
const SPLASH_SOUND = 227;
const PROJECTILE = { START: 51, PER_TILE: 5, MIN_END: 53, START_HEIGHT: 172, END_HEIGHT: 124, ANGLE: 16, PROGRESS: 64 };

let api = null;
let core = null;
let staff = null;
const decayTasks = new WeakMap();

function plural(amount, word) {
  return `${amount.toLocaleString("en-US")} ${word}${amount === 1 ? "" : "s"}`;
}

/** max(10, floor(Magic / 3) - 10). */
function maxHit(player) {
  const magic = player.getSkillManager().getCurrentLevel(core.Skill.MAGIC);
  return Math.max(MIN_MAX_HIT, Math.floor(magic / 3) - 10);
}

// ------------------------------------------------------------------ Shatter stacks

function stacks(player) {
  return Math.max(0, Math.min(MAX_STACKS, Math.floor(Number(player.getAttribute(STACKS_ATTRIBUTE)) || 0)));
}

function sendStacks(player) {
  const varbit = core.CacheDefinitions.getVarbitId?.(STACKS_VARBIT);
  if (varbit != null) player.getPacketSender?.()?.sendVarbit?.(varbit, stacks(player));
}

function setStacks(player, value) {
  const before = stacks(player);
  player.setAttribute(STACKS_ATTRIBUTE, Math.max(0, Math.min(MAX_STACKS, value)));
  if (stacks(player) !== before) sendStacks(player);
}

/** Every 50 ticks out of combat a stack is lost; the countdown restarts with each change. */
function restartDecay(player) {
  decayTasks.get(player)?.stop();
  decayTasks.delete(player);
  if (stacks(player) === 0) return;
  const task = new (class extends core.Task {
    constructor() {
      super(DECAY_TICKS, player, false);
    }

    execute() {
      // Ours: "out of combat" is having no combat target.
      if (player.getCombat?.()?.getTarget?.() != null) return;
      const left = stacks(player) - 1;
      setStacks(player, left);
      if (left <= 0) {
        decayTasks.delete(player);
        this.stop();
      }
    }
  })();
  decayTasks.set(player, task);
  core.TaskManager.submit(task);
}

/** Each attack with the sceptre gains a stack as its hit lands, a splash too. */
function gainStack(hit) {
  const attacker = hit?.getAttacker?.();
  if (!attacker?.isPlayer?.()) return;
  const player = attacker.getAsPlayer();
  setStacks(player, stacks(player) + 1);
  restartDecay(player);
}

/** `lithic-sceptre:stacks` { player, stacks, consume, consumed }: reads the stacks, and takes `consume` when there are enough. */
function answerStacks(request) {
  const player = request?.player;
  if (!player) return;
  const held = stacks(player);
  request.stacks = held;
  const consume = Math.floor(Number(request.consume) || 0);
  if (consume <= 0 || held < consume) return;
  setStacks(player, held - consume);
  request.stacks = held - consume;
  request.consumed = true;
  restartDecay(player);
}

/** Teleporting or entering an instance loses the stacks. */
function loseStacks({ player }) {
  if (!player || stacks(player) === 0) return;
  setStacks(player, 0);
  restartDecay(player);
}

function login({ player }) {
  if (!player) return;
  if (stacks(player) > 0) sendStacks(player);
  restartDecay(player);
}

// ------------------------------------------------------------------ the staff

function projectileEnd(from, to) {
  return Math.max(PROJECTILE.MIN_END, PROJECTILE.START + (Math.max(1, distance(from, to, core.CombatPosition)) - 1) * PROJECTILE.PER_TILE);
}

function look({ Animation, Projectile, CacheDefinitions }) {
  const projectile = CacheDefinitions.getSpotanimId(PROJECTILE_GRAPHIC);
  return {
    castAnimation: () => new Animation(CacheDefinitions.getSeqId(CAST_ANIMATION)),
    castSound: () => CAST_SOUND,
    castProjectile: (cast, castOn) => (projectile == null ? null
      : Projectile.createProjectile(cast, castOn, projectile, PROJECTILE.START, projectileEnd(cast, castOn),
        PROJECTILE.START_HEIGHT / 4, PROJECTILE.END_HEIGHT / 4).withAngle(PROJECTILE.ANGLE).withProgress(PROJECTILE.PROGRESS)),
  };
}

function impact(attacker, target, accurate) {
  const end = projectileEnd(attacker, target);
  const graphic = accurate ? core.CacheDefinitions.getSpotanimId(IMPACT_GRAPHIC) : SPLASH_GRAPHIC;
  return {
    graphic: graphic == null ? null : new core.Graphic(graphic, end, IMPACT_HEIGHT),
    areaSound: { id: accurate ? IMPACT_SOUND : SPLASH_SOUND, delay: end },
  };
}

function defineSceptre() {
  const I = core.ItemIdentifiers;
  return definePoweredStaff(api, {
    name: "Lithic sceptre",
    chargesKey: CHARGES_KEY,
    maxCharges: MAX_CHARGES,
    pairs: [[I.LITHIC_SCEPTRE, I.LITHIC_SCEPTRE_UNCHARGED_]],
    maxHit,
    attackSpeed: ATTACK_SPEED,
    range: ATTACK_RANGE,
    spell: look,
    hitDelay: (attacker, target) => ticksFor(projectileEnd(attacker, target)),
    impact,
    onHitLanded: gainStack,
    specialId: SPECIAL_ID,
    emptied: (player) => {
      player.getInventory().refreshItems();
      player.getEquipment().refreshItems();
    },
    // Ours: no capture of an empty or emptied sceptre; worded as the warped sceptre's.
    noChargesMessage: "Your lithic sceptre has no charges! You need to charge it with body runes and earth runes.",
    ranOutMessage: "<col=ff3045>Your lithic sceptre has run out of charges!</col>",
  });
}

// ------------------------------------------------------------------ charges

function isSceptre(id) {
  return staff.isStaff(id);
}

/** One body rune and three earth runes a charge, as many as the inventory affords. Its messages are ours. */
function chargeSceptre(player, sceptre) {
  const I = core.ItemIdentifiers;
  const inventory = player.getInventory();
  const current = staff.chargesOf(sceptre);
  if (current >= MAX_CHARGES) {
    player.sendMessage("Your lithic sceptre is already fully charged.");
    return true;
  }
  const batches = (count) => Math.min(
    Math.floor(count(I.BODY_RUNE) / BODY_PER_CHARGE),
    Math.floor(count(I.EARTH_RUNE) / EARTH_PER_CHARGE),
    MAX_CHARGES - current,
  );
  const affordable = batches((id) => plainAmount(inventory, id));
  if (affordable < 1 && batches((id) => inventory.getAmount(id)) >= 1) {
    player.sendMessage(PRESET_TEXT);
    return true;
  }
  if (affordable < 1) {
    player.sendMessage("You need one body rune and three earth runes for each charge.");
    return true;
  }
  takePlain(inventory, I.BODY_RUNE, affordable * BODY_PER_CHARGE);
  takePlain(inventory, I.EARTH_RUNE, affordable * EARTH_PER_CHARGE);
  staff.setCharges(sceptre, current + affordable);
  inventory.refreshItems();
  player.getEquipment().refreshItems();
  player.sendMessage(`The Lithic sceptre currently has ${plural(current + affordable, "charge")}.`);
  return true;
}

function chargeWithRunes(event) {
  const I = core.ItemIdentifiers;
  const { player, usedItem, usedWithItem, usedItemId, usedWithItemId } = event;
  const sceptre = isSceptre(usedItemId) ? usedItem : isSceptre(usedWithItemId) ? usedWithItem : null;
  const other = sceptre === usedItem ? usedWithItem : usedItem;
  const otherId = sceptre === usedItem ? usedWithItemId : usedItemId;
  if (!sceptre || ![I.BODY_RUNE, I.EARTH_RUNE].includes(otherId)) return false;
  event.handled = true;
  if (restricted(other)) {
    player.sendMessage(PRESET_TEXT);
    return true;
  }
  return chargeSceptre(player, sceptre);
}

function chargeOption({ player, item }) {
  if (!item || !isSceptre(item.getId())) return false;
  return chargeSceptre(player, item);
}

/** Check, worn or carried. */
function checkSceptre({ player, item }) {
  player.sendMessage(`The Lithic sceptre currently has ${plural(staff.chargesOf(item), "charge")}.`);
  return true;
}

function refunds(charges) {
  const I = core.ItemIdentifiers;
  return [new core.Item(I.BODY_RUNE, charges * BODY_PER_CHARGE), new core.Item(I.EARTH_RUNE, charges * EARTH_PER_CHARGE)];
}

/** Uncharge returns every rune; its prompt and messages are ours. */
function unchargeSceptre({ player, item }) {
  const charges = staff.chargesOf(item);
  if (charges <= 0) return true;
  const inventory = player.getInventory();
  if (!refundsFit(inventory, refunds(charges))) {
    player.sendMessage("You don't have enough inventory space to uncharge the sceptre.");
    return true;
  }
  const staffId = item.getId();
  api.sendMultiChatboxPrompt(player, "Fully uncharge the Lithic sceptre?", "Yes.", () => {
    const carried = [inventory, player.getEquipment()].some((container) => container.getItems().includes(item));
    const left = staff.chargesOf(item);
    if (!carried || item.getId() !== staffId || left <= 0) return;
    if (!refundsFit(inventory, refunds(left))) {
      player.sendMessage("You don't have enough inventory space to uncharge the sceptre.");
      return;
    }
    for (const rune of refunds(left)) inventory.addItem(rune);
    staff.setCharges(item, 0);
    inventory.refreshItems();
    player.getEquipment().refreshItems();
    player.sendMessage("You uncharge the Lithic sceptre.");
  }, "No.", () => {});
  return true;
}

function resolveSceptre(attacker) {
  return staff?.resolver.resolve(attacker) ?? null;
}

function answerSpell(request) {
  staff?.answerSpell(request);
}

function fillCharges(event) {
  staff?.fillCharges(event);
}

function attach(pluginApi) {
  api = pluginApi;
  core = api.core;
  staff = defineSceptre();
}

module.exports = {
  name: "LithicSceptre",
  description: "The Lithic sceptre: its built-in spell, rune charges, Shatter stacks for Explosive Shatter.",
  members: true,
  register(pluginApi) {
    attach(pluginApi);
    pluginApi.persistAttribute(STACKS_ATTRIBUTE, 0);
    pluginApi.registerCombatMethodResolver({ resolve: resolveSceptre });
    pluginApi.onCustomEvent("powered-staff:spell", answerSpell);
    pluginApi.onCustomEvent("item:fill-charges", fillCharges);
    pluginApi.onCustomEvent("lithic-sceptre:stacks", answerStacks);
    pluginApi.onCustomEvent("teleport:landed", loseStacks);
    pluginApi.onCustomEvent("private-area:entered", loseStacks);
    pluginApi.onPlayerLogin(login);
    pluginApi.onItemOnItem(chargeWithRunes, { noted: false });
    pluginApi.onItemAction("Lithic sceptre", { Check: checkSceptre, Uncharge: unchargeSceptre });
    pluginApi.onItemAction("Lithic sceptre (uncharged)", { Charge: chargeOption });
  },
  _test: {
    maxHit, stacks, setStacks, gainStack, answerStacks, loseStacks, chargeSceptre, chargeWithRunes, chargeOption,
    checkSceptre, unchargeSceptre, resolveSceptre, impact, projectileEnd, staff: () => staff,
    CHARGES_KEY, MAX_CHARGES, MAX_STACKS, STACKS_ATTRIBUTE, SPECIAL_ID, ATTACK_SPEED, ATTACK_RANGE,
  },
};
