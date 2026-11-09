/**
 * Enchanted bolts (https://oldschool.runescape.wiki/w/Enchanted_bolts): the gem's special effect
 * when a crossbow fires an enchanted bolt. Chances, graphics and sounds are in
 * data/enchanted-bolts.json; docs/enchanted-bolts.md has the sources.
 *
 * The effect is rolled with the shot (onCombatHitDamage), where it changes that hitsplat's
 * damage; its graphic and sound go out at once, delayed by the hit's flight time in ticks, as
 * live does. What waits for the bolt to land (Blood Forfeit's cost, Life Leech's heal, poison,
 * the prayer and Magic drains, the jade knock-down) happens when the hit resolves.
 *
 *   ::boltproc   force the next shot's bolt effect (testing)
 */
const DATA = require("./data/enchanted-bolts.json");

/** Hard Kandarin Diary: every bolt effect is 10% likelier (Wiki). */
const KANDARIN_HARD_CHANCE_MULTIPLIER = 1.1;
/** The jade knock-down lasts 8 ticks (Wiki: Jade bolts (e)). */
const EARTHS_FURY_STUN_TICKS = 8;
/** Poison severities: 5 damage, 6 with a Zaryte crossbow (75 and 87 in total, Wiki). */
const MAGICAL_POISON_SEVERITY = 25;
const ZARYTE_MAGICAL_POISON_SEVERITY = 27;
const FORCE_PROC_ATTRIBUTE = "enchanted-bolts:force-proc";

let core = null;
let pluginApi = null;
let boltsByName = new Map();
/** PendingHit -> the effects it carries, applied when it resolves. */
const landing = new WeakMap();

function attach(api) {
  pluginApi = api;
  core = api.core;
  boltsByName = new Map(DATA.bolts.flatMap((bolt) => bolt.names.map((name) => [name, bolt])));
}

function rangedLevel(player) {
  return player.getSkillManager().getCurrentLevel(core.Skill.RANGED);
}

function hasKandarinHard(player) {
  const request = { player, diary: "kandarin", tier: "hard", complete: false };
  pluginApi.emitCustomEvent("diary:is-complete", request);
  return request.complete === true;
}

function npcHasAttribute(target, attribute) {
  return !target.isPlayer() && target.getAsNpc().getCurrentDefinition()?.hasAttribute?.(attribute) === true;
}

function prays(target, prayer) {
  return target.isPlayer() && core.PrayerHandler.isActivated(target, prayer);
}

function suppliedRunes(player) {
  const request = { player, runes: [] };
  pluginApi.emitCustomEvent("elemental-staves:runes", request);
  return request.runes;
}

/** Sea Curse treats a player as fiery with a fire staff or a fire cape (Wiki: Pearl bolts (e)). */
function isFieryPlayer(player) {
  const cape = player.getEquipment().get(core.Equipment.CAPE_SLOT)?.getId?.();
  return cape === core.ItemIdentifiers.FIRE_CAPE || suppliedRunes(player).includes(core.ItemIdentifiers.FIRE_RUNE);
}

function protectedFromDragonfire(player) {
  return !player.getCombat().getFireImmunityTimer().finished()
    || core.CombatEquipment.hasDragonProtectionGear(player)
    || prays(player, core.PrayerHandler.PROTECT_FROM_MAGIC);
}

/** Dodge chance runs from -16% at Agility 1 to 110% at 99 (Mod Ash, cited on the Wiki). */
function dodgesEarthsFury(player) {
  const agility = player.getSkillManager().getCurrentLevel(core.Skill.AGILITY);
  const dodge = -16 + ((agility - 1) * 126) / 98;
  return Math.random() * 100 < dodge;
}

/** Adds flat damage; a proc that ignores accuracy lands even when the roll missed. */
function addDamage(shot, bonus) {
  shot.event.damage.setDamage(shot.event.damage.getDamage() + bonus);
  shot.event.accurate = true;
}

/** Rerolls the hit between 0 and `percent`% of the max hit, as an accurate hit. */
function rerollFromMaxHit(shot, percent) {
  const { player, target } = shot;
  const ranged = core.CombatType.RANGED;
  const maxHit = core.PluginManager.modifyRangedMaxHit(player, target, core.DamageFormulas.sourceMaxHit(player, ranged));
  const effectMax = Math.trunc((maxHit * percent) / 100);
  const bounds = { minimumMultiplier: 0, maximumMultiplier: 0, minimumBonus: 0, maximumBonus: effectMax };
  shot.event.damage.setDamage(core.CombatFactory.getHitDamage(player, target, ranged, false, bounds).getDamage());
  shot.event.accurate = true;
}

/**
 * Per effect: `blocked` (the effect can't happen against this target), `shoot` (changes the
 * hitsplat as it is rolled; returning false cancels the proc) and `land` (when the hit resolves,
 * with the damage it dealt).
 */
const EFFECTS = {
  "lucky-lightning": {
    shoot: (shot) => addDamage(shot, Math.trunc(rangedLevel(shot.player) / (shot.zaryte ? 9 : 10))),
  },
  "earths-fury": {
    blocked: (shot) => !shot.pvp || prays(shot.target, core.PrayerHandler.PROTECT_FROM_MAGIC) || dodgesEarthsFury(shot.target),
    land: (shot) => core.CombatFactory.stunTicks(shot.target, EARTHS_FURY_STUN_TICKS, false, { graphic: null }),
  },
  "sea-curse": {
    blocked: (shot) => shot.pvp && suppliedRunes(shot.target).includes(core.ItemIdentifiers.WATER_RUNE),
    shoot: (shot) => {
      const fiery = shot.pvp ? isFieryPlayer(shot.target) : npcHasAttribute(shot.target, "fiery");
      const divisor = (fiery ? 15 : 20) - (shot.zaryte ? 2 : 0);
      addDamage(shot, Math.trunc(rangedLevel(shot.player) / divisor));
    },
  },
  "down-to-earth": {
    blocked: (shot) => !shot.pvp,
    land: (shot) => shot.target.getSkillManager().decreaseCurrentLevel(core.Skill.MAGIC, 1, 0),
  },
  "clear-mind": {
    land: (shot, dealt) => {
      const { player, target } = shot;
      if (!shot.pvp) {
        // A tenth of the monster's Ranged level is drained; the shooter gets an eighth of it.
        restorePrayer(player, Math.floor(Math.floor(target.getAsNpc().getBaseAttack(core.CombatType.RANGED) / 10) / 8));
        return;
      }
      // A twentieth of the shooter's Ranged level, at most the target's remaining hitpoints.
      const drain = Math.min(Math.floor(rangedLevel(player) / 20), Math.max(0, target.getHitpoints() - dealt));
      target.getSkillManager().decreaseCurrentLevel(core.Skill.PRAYER, drain, 0);
      restorePrayer(player, Math.floor(drain / 2));
    },
  },
  "magical-poison": {
    land: (shot) => core.CombatFactory.poisonEntity(shot.target, shot.zaryte ? ZARYTE_MAGICAL_POISON_SEVERITY : MAGICAL_POISON_SEVERITY),
  },
  "blood-forfeit": {
    shoot: (shot) => {
      // Not when the shooter can't spare a hitpoint (10% of their current hitpoints).
      if (Math.floor(shot.player.getHitpoints() / 10) < 1) return false;
      const forfeit = Math.trunc((shot.target.getHitpoints() * (shot.zaryte ? 22 : 20)) / 100);
      shot.event.damage.setDamage(Math.min(shot.zaryte ? 110 : 100, forfeit));
      shot.event.accurate = true;
      return true;
    },
    land: (shot) => {
      const cost = Math.floor(shot.player.getHitpoints() / 10);
      if (cost > 0) shot.player.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(cost, core.HitMask.RED)]);
    },
  },
  "armour-piercing": {
    shoot: (shot) => rerollFromMaxHit(shot, shot.zaryte ? 126 : 115),
  },
  "dragons-breath": {
    blocked: (shot) => shot.pvp
      ? protectedFromDragonfire(shot.target)
      : npcHasAttribute(shot.target, "fiery") || npcHasAttribute(shot.target, "dragon"),
    // Wiki (Dragonstone bolts (e)): "20% of the attacker's visible Ranged level, rounded down", "22% instead of 20%"
    // with the Zaryte crossbow (the Zaryte page's /10 -> /9 is opal's row).
    shoot: (shot) => addDamage(shot, Math.floor((rangedLevel(shot.player) * (shot.zaryte ? 22 : 20)) / 100)),
  },
  "life-leech": {
    blocked: (shot) => npcHasAttribute(shot.target, "undead"),
    shoot: (shot) => rerollFromMaxHit(shot, shot.zaryte ? 132 : 120),
    land: (shot, dealt) => shot.player.heal(Math.floor(dealt / 4)),
  },
};

function restorePrayer(player, amount) {
  const skills = player.getSkillManager();
  const current = skills.getCurrentLevel(core.Skill.PRAYER);
  const max = skills.getMaxLevel(core.Skill.PRAYER);
  if (amount > 0 && current < max) skills.setCurrentLevels(core.Skill.PRAYER, Math.min(max, current + amount));
}

function equippedBolt(player) {
  const itemId = player.getCombat().getAmmunition()?.getItemId?.();
  if (!(itemId > 0)) return null;
  return boltsByName.get(core.ItemDefinition.forId(itemId)?.getName?.()) ?? null;
}

/**
 * The Zaryte crossbow's special guarantees the effect on a successful hit and the Armadyl
 * crossbow's doubles its chance (traits on their CombatSpecial definitions).
 */
function procs(bolt, shot) {
  const traits = core.CombatSpecial.activeTraitsFor(shot.player);
  if (shot.player.getAttribute(FORCE_PROC_ATTRIBUTE) === true) {
    shot.player.setAttribute(FORCE_PROC_ATTRIBUTE, false);
    return true;
  }
  if (traits?.guaranteedEnchantedBoltEffect === true && shot.event.accurate) return true;
  if (!bolt.ignoresAccuracy && !shot.event.accurate) return false;
  const base = shot.pvp ? bolt.chance.player : bolt.chance.npc;
  if (!(base > 0)) return false;
  let chance = base * (hasKandarinHard(shot.player) ? KANDARIN_HARD_CHANCE_MULTIPLIER : 1);
  chance *= core.WeaponProfiles.get(shot.player)?.boltEffectChanceMultiplier ?? 1;
  if (traits?.enchantedBoltEffectChanceMultiplier > 0) chance *= traits.enchantedBoltEffectChanceMultiplier;
  // Content may raise it further (a league fragment): "combat:bolt-effect-chance" { player, target, effect, chance }.
  const request = { player: shot.player, target: shot.target, effect: bolt.effect, chance };
  pluginApi.emitCustomEvent("combat:bolt-effect-chance", request);
  if (Number.isFinite(request.chance)) chance = request.chance;
  // Content may scale the chance (a league relic), after the gear and the special have had their say.
  const proc = { player: shot.player, target: shot.event.target, itemId: shot.player.getCombat().getAmmunition()?.getItemId?.() ?? -1, chance };
  pluginApi.emitCustomEvent("combat:bolt-proc-chance", proc);
  return Math.random() < proc.chance;
}

/** Live sends both on the shot, delayed by the hit's flight time in ticks (rsprox captures). */
function showProc(bolt, shot) {
  const delay = shot.event.hit.getDelay();
  // Set after construction: the constructor reads a small number (0-2) as a Priority, not a delay.
  const graphic = new core.Graphic(bolt.spotanim);
  graphic.delay = delay;
  shot.target.performGraphic(graphic);
  if (!shot.player.isPlayerBot?.()) shot.player.getPacketSender().sendSoundEffect(bolt.sound, 1, delay, 255);
}

function rollBoltEffect(event) {
  const { attacker, target, combatType, hit } = event;
  if (combatType !== core.CombatType.RANGED || !attacker?.isPlayer?.() || !target || !hit) return;
  const player = attacker.getAsPlayer();
  if (!core.WeaponProfiles.get(player)?.boltEffects) return;
  const bolt = equippedBolt(player);
  if (!bolt) return;
  const shot = {
    event,
    player,
    target,
    pvp: target.isPlayer(),
    zaryte: player.getCombat().getRangedWeapon() === core.RangedWeapon.ZARYTE_CROSSBOW,
  };
  const effect = EFFECTS[bolt.effect];
  if (!effect || !procs(bolt, shot) || effect.blocked?.(shot)) return;
  if (effect.shoot?.(shot) === false) return;
  showProc(bolt, shot);
  if (effect.land) {
    const effects = landing.get(hit) ?? [];
    effects.push({ effect, shot, damage: event.damage });
    landing.set(hit, effects);
  }
}

function landBoltEffect({ hit }) {
  const effects = landing.get(hit);
  if (!effects) return;
  landing.delete(hit);
  for (const { effect, shot, damage } of effects) {
    effect.land(shot, damage.getDamage());
  }
}

function forceNextProc({ player }) {
  player.setAttribute(FORCE_PROC_ATTRIBUTE, true);
  player.sendMessage("Your next enchanted bolt will activate its effect.");
}

module.exports = {
  name: "EnchantedBolts",
  description: "Enchanted crossbow bolt effects: gem proc chances, graphics, sounds, poison, drains and leech, plus a ::boltproc testing command.",
  members: true,
  register(api) {
    attach(api);
    api.onCombatHitDamage(rollBoltEffect);
    api.onCombatHitResolved(landBoltEffect);
    api.registerCommand("boltproc", forceNextProc, api.core.PlayerRights.DEVELOPER, "Force the next enchanted bolt effect");
  },
  _test: { rollBoltEffect, landBoltEffect, EFFECTS, attach },
};
