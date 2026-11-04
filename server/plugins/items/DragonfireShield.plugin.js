/**
 * Dragonfire shield (https://oldschool.runescape.wiki/w/Dragonfire_shield): charges, Inspect,
 * Check, Empty, Bottled dragonbreath, absorbing dragonfire and the Activate blast. Live behaviour from a rev 242 RSProx
 * recording; see docs/dragonfire-shield.md.
 */
const { DRAGONFIRE_BREATH_EVENT } = require("../combat/DragonfireProtection");

const CHARGES_META_KEY = "dragonfire-shield";
const MAX_CHARGES = 50;
const RECHARGE_ATTRIBUTE = "dragonfire-shield:recharge";
const ARMED_ATTRIBUTE = "dragonfire-shield:armed";

// Cache gamevals.
const SA_ATTACK_VARP = 301; // sa_attack: 2 while the blast is armed
const RECHARGE_VARBIT = 6539; // dragonfire_shield_recharge
const UNLEASH_ANIMATION = 6696; // qip_dragon_slayer_player_unleashing_fire
const UNLEASH_GRAPHIC = 1165; // qip_dragon_slayer_shield_attack_spotanim
const BLAST_PROJECTILE = 1166; // qip_dragon_slayer_player_projanim
const IMPACT_GRAPHIC = 1167; // qip_dragon_slayer_player_impact
const VENT_ANIMATION = 6700; // qip_dragon_slayer_player_releasing_charge
const VENT_GRAPHIC = 1168; // qip_dragon_slayer_player_releasing_charge
const ABSORB_ANIMATION = 6695; // qip_dragon_slayer_player_absorbing_fire
const CHARGE_GRAPHICS = [1160, 1161, 1162, 1163, 1164]; // qip_dragon_slayer_shield_charge_one .. _five
const ABSORB_DELAY = 30; // Live: animation and graphic both delay 30
const ABSORB_SOUNDS = [3750, 3740];
const UNLEASH_SOUND = 3761;
const IMPACT_SOUND = 161;
const VENT_SOUND = 3760;

// Live: recharge 24 on the blast tick, falling by one every 8 ticks (Mod Ash: 192 ticks).
const RECHARGE_STEPS = 24;
const RECHARGE_STEP_TICKS = 8;
// Live at 1 tile: projectile 80 -> 85 client cycles, impact graphic and sound delayed 85,
// hit on the third tick. The per-tile flight time beyond one tile is not in the recording.
const PROJECTILE_START = 80;
const PROJECTILE_CYCLES_PER_TILE = 5;
const BLAST_HEIGHT = 120;
const BLAST_RANGE = 10; // Wiki
const BLAST_MAX_HIT = 25; // Wiki
const PROTECTED_MAX_HIT = 3; // Wiki (Mod Ash): against an anti-dragon shield
const DEFENCE_XP_PER_DAMAGE = 4; // Live: 9 damage gave 36 Defence xp on the blast tick

const COOL_DOWN_MESSAGE = "You must let the shield cool down before using it again.";
const VENT_MESSAGE = "You vent the shield's remaining charges harmlessly into the air.";
const DRAGONBREATH_MESSAGE = "You charge your shield using the bottled dragonbreath.";
const FULLY_CHARGED_MESSAGE = "Your dragonfire shield is already fully charged."; // Wiki
const GLOW_MESSAGE = "Your dragonfire shield glows more brightly.";
// Live has charge_one at 1 charge; the other four are assumed to follow in tens (11-20 -> two...).
const CHARGES_PER_GRAPHIC = 10;

let core = null;
let chargedId = -1;
let unchargedId = -1;
let blastMethod = null;
const rechargeTasks = new WeakMap();

function charges(item) {
  if (!item || item.getId() !== chargedId) return 0;
  const saved = Number(item.getMetaValue?.(CHARGES_META_KEY));
  // A charged shield with no saved count (spawned, or from before charges were tracked) is full.
  return Number.isFinite(saved) ? Math.max(0, Math.min(MAX_CHARGES, Math.floor(saved))) : MAX_CHARGES;
}

/** Stores the charges and swaps between the charged and uncharged shield to match. */
function setCharges(item, amount) {
  const left = Math.max(0, Math.min(MAX_CHARGES, Math.floor(amount)));
  item.setId(left > 0 ? chargedId : unchargedId);
  item.setMetaValue(CHARGES_META_KEY, left > 0 && left < MAX_CHARGES ? left : undefined);
}

function refresh(player) {
  player.getInventory().refreshItems();
  player.getEquipment().refreshItems();
  core.BonusManager.update(player);
  player.getUpdateFlag().flag(core.Flag.APPEARANCE);
}

function wornShield(player) {
  const shield = player.getEquipment().getItems()[core.Equipment.SHIELD_SLOT];
  return shield && (shield.getId() === chargedId || shield.getId() === unchargedId) ? shield : null;
}

function inspect({ player, item }) {
  const left = charges(item);
  player.sendMessage(left > 0 ? `The shield has ${left} charges.` : "The shield has no charges.");
  return true;
}

function rechargeSteps(player) {
  return Math.max(0, Number(player.getAttribute(RECHARGE_ATTRIBUTE)) || 0);
}

function setRechargeSteps(player, steps) {
  player.setAttribute(RECHARGE_ATTRIBUTE, steps);
  player.getPacketSender().sendVarbit(RECHARGE_VARBIT, steps);
}

function startRecharge(player) {
  if (rechargeTasks.has(player) || rechargeSteps(player) <= 0) return;
  const { Task, TaskManager } = core;
  const task = new (class extends Task {
    constructor() {
      super(RECHARGE_STEP_TICKS, player, false);
    }

    execute() {
      const left = rechargeSteps(player) - 1;
      setRechargeSteps(player, Math.max(0, left));
      if (left <= 0 || !player.isRegistered?.()) {
        rechargeTasks.delete(player);
        this.stop();
      }
    }
  })();
  rechargeTasks.set(player, task);
  TaskManager.submit(task);
}

function setArmed(player, armed) {
  player.setAttribute(ARMED_ATTRIBUTE, armed);
  player.getPacketSender().sendConfig(SA_ATTACK_VARP, armed ? 2 : 0);
}

/** Worn Activate: arms the blast for the next attack, or disarms it. */
function activate({ player, item }) {
  if (rechargeSteps(player) > 0) {
    player.sendMessage(COOL_DOWN_MESSAGE);
    return true;
  }
  if (charges(item) <= 0) {
    player.sendMessage("The shield has no charges.");
    return true;
  }
  if (player.isSpecialActivated()) {
    player.setSpecialActivated(false);
  }
  setArmed(player, player.getAttribute(ARMED_ATTRIBUTE) !== true);
  return true;
}

function empty({ player, item }) {
  setCharges(item, 0);
  refresh(player);
  player.sendMessage(VENT_MESSAGE);
  player.performAnimation(new core.Animation(VENT_ANIMATION));
  player.performGraphic(new core.Graphic(VENT_GRAPHIC));
  player.getPacketSender().sendSoundEffect(VENT_SOUND, 1, 0);
  return true;
}

function chargeWithDragonbreath(event) {
  const { player } = event;
  const shield = event.usedItemId === core.ItemIdentifiers.BOTTLED_DRAGONBREATH ? event.usedWithItem : event.usedItem;
  if (charges(shield) >= MAX_CHARGES) {
    player.sendMessage(FULLY_CHARGED_MESSAGE);
    return true;
  }
  player.getInventory().deleteNumber(core.ItemIdentifiers.BOTTLED_DRAGONBREATH, 1);
  setCharges(shield, MAX_CHARGES);
  refresh(player);
  player.sendMessage(DRAGONBREATH_MESSAGE);
  return true;
}

/** Any dragonfire breath on a worn shield adds a charge (Wiki), the uncharged shield included. */
function absorbDragonfire({ player, messages }) {
  const shield = player ? wornShield(player) : null;
  if (!shield || !Array.isArray(messages)) return;
  const current = charges(shield);
  if (current >= MAX_CHARGES) {
    messages.push({ text: FULLY_CHARGED_MESSAGE, spam: true });
    return;
  }
  setCharges(shield, current + 1);
  refresh(player);
  messages.push({ text: GLOW_MESSAGE, spam: true });
  const graphic = CHARGE_GRAPHICS[Math.min(CHARGE_GRAPHICS.length - 1, Math.floor(current / CHARGES_PER_GRAPHIC))];
  player.performAnimation(new core.Animation(ABSORB_ANIMATION, ABSORB_DELAY));
  player.performGraphic(new core.Graphic(graphic, ABSORB_DELAY));
  for (const sound of ABSORB_SOUNDS) player.getPacketSender().sendSoundEffect(sound, 1, 0);
}

function blastMaxHit(target) {
  return target.isPlayer() && core.CombatEquipment.hasDragonProtectionGear(target.getAsPlayer())
    ? PROTECTED_MAX_HIT
    : BLAST_MAX_HIT;
}

/** Wiki (Mod Ash): the attacker's Defence against the target's Magic defence; exact formula unpublished. */
function blastAccurate(player, target) {
  const { AccuracyFormulasDpsCalc, Skill } = core;
  const attackRoll = (player.getSkillManager().getCurrentLevel(Skill.DEFENCE) + 9) * 64;
  const defenceRoll = AccuracyFormulasDpsCalc.defenseMagicRoll(target);
  return Math.random() < AccuracyFormulasDpsCalc.hitChance(attackRoll, defenceRoll);
}

function projectileEnd(player, target) {
  const distance = Math.max(1, player.getLocation().getDistance(target.getLocation()));
  return PROJECTILE_START + PROJECTILE_CYCLES_PER_TILE * distance;
}

function areaSound(entity, soundId, delay) {
  const at = entity.getLocation();
  core.Sounds.playAreaSound({ soundId, x: at.getX(), y: at.getY(), level: at.getZ(), delay, radius: BLAST_RANGE });
}

function createBlastMethod() {
  const { Animation, CombatMethod, CombatType, Graphic, PendingHit, Projectile, Skill } = core;
  return new (class DragonfireShieldBlast extends CombatMethod {
    type() {
      return CombatType.MAGIC;
    }

    attackDistance() {
      return BLAST_RANGE;
    }

    hits(character, target) {
      const player = character.getAsPlayer();
      const damage = blastAccurate(player, target) ? Math.floor(Math.random() * (blastMaxHit(target) + 1)) : 0;
      const dealt = Math.min(damage, Math.max(0, target.getHitpoints()));
      if (dealt > 0) {
        player.getSkillManager().addExperience(Skill.DEFENCE, dealt * DEFENCE_XP_PER_DAMAGE);
      }
      const delay = Math.ceil(projectileEnd(player, target) / 30);
      return [new PendingHit(character, target, this, { delay, damage, rollAccuracy: false, experience: false, bypassProtectionPrayer: true })];
    }

    start(character, target) {
      const player = character.getAsPlayer();
      const shield = wornShield(player);
      setArmed(player, false);
      setRechargeSteps(player, RECHARGE_STEPS);
      startRecharge(player);
      if (shield) {
        setCharges(shield, charges(shield) - 1);
        refresh(player);
      }
      const end = projectileEnd(player, target);
      player.performAnimation(new Animation(UNLEASH_ANIMATION));
      player.performGraphic(new Graphic(UNLEASH_GRAPHIC));
      target.performGraphic(new Graphic(IMPACT_GRAPHIC, end, BLAST_HEIGHT));
      Projectile.createProjectile(player, target, BLAST_PROJECTILE, PROJECTILE_START, end, BLAST_HEIGHT / 4, BLAST_HEIGHT / 4)
        .sendProjectile();
      areaSound(player, UNLEASH_SOUND, 0);
      areaSound(target, IMPACT_SOUND, end);
    }
  })();
}

/** The armed blast replaces the next attack; an armed weapon special goes first. */
function resolveBlast(attacker) {
  const player = attacker.getAsPlayer();
  if (player.getAttribute(ARMED_ATTRIBUTE) !== true || player.isSpecialActivated()) return null;
  const shield = wornShield(player);
  if (!shield || charges(shield) <= 0 || rechargeSteps(player) > 0) {
    setArmed(player, false);
    return null;
  }
  return blastMethod;
}

function login({ player }) {
  const steps = rechargeSteps(player);
  if (steps > 0) {
    player.getPacketSender().sendVarbit(RECHARGE_VARBIT, steps);
    startRecharge(player);
  }
}

function attach(api) {
  core = api.core;
  chargedId = core.ItemIdentifiers.DRAGONFIRE_SHIELD;
  unchargedId = core.ItemIdentifiers.DRAGONFIRE_SHIELD_2;
  blastMethod = createBlastMethod();
}

module.exports = {
  name: "DragonfireShield",
  members: true,
  register(api) {
    attach(api);
    api.persistAttribute(RECHARGE_ATTRIBUTE, 0);
    api.onPlayerLogin(login);
    api.onItemAction("Dragonfire shield", { Inspect: inspect, Check: inspect, Activate: activate, Empty: empty });
    api.onItemOnItem("Bottled dragonbreath", "Dragonfire shield", chargeWithDragonbreath, { noted: false });
    api.registerCombatMethodResolver({ resolve: resolveBlast, overridesWeapon: true });
    api.onCustomEvent(DRAGONFIRE_BREATH_EVENT, absorbDragonfire);
  },
  _test: { charges, setCharges, inspect, activate, empty, chargeWithDragonbreath, resolveBlast, absorbDragonfire, MAX_CHARGES },
};
