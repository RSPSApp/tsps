// Lava Maze ladder (3017, 3849) leads straight into the lair; the lair's lever (2271, 4680)
// sends the player back to the tile north of that ladder.
const KBD_LADDER_DOWN_OBJECT_ID = 18987;
const KBD_LAIR_LEVER_OBJECT_ID = 1817;

const KING_BLACK_DRAGON_LAIR = [2271, 4680, 0];
const KING_BLACK_DRAGON_LADDER = [3017, 3850, 0];

const { DragonfireProtectionTier, getDragonfireProtectionTier } = require("../combat/DragonfireProtection");

const Breath = {
  DRAGON: 0,
  ICE: 1,
  POISON: 2,
  SHOCK: 3,
};

/**
 * Wiki (Dragonfire/King_Black_Dragon): maximum damage of the fiery breath and of the three
 * special breaths, by the protection the player has. The plugin resolves KBD's dragonfire
 * itself because his table (65/50) is higher than the chromatic dragons' (50).
 */
const FIERY_BREATH_MAX = Object.freeze({
  unprotected: 65,
  shield: 15,
  prayer: 20,
  shieldPrayer: 15,
  antifire: 50,
  superAntifire: 0,
  shieldAntifire: 0,
  shieldSuperAntifire: 0,
  prayerAntifire: 5,
  prayerSuperAntifire: 0,
  shieldPrayerAntifire: 0,
  shieldPrayerSuperAntifire: 0,
});
const SPECIAL_BREATH_MAX = Object.freeze({
  unprotected: 50,
  shield: 10,
  prayer: 15,
  shieldPrayer: 10,
  antifire: 50,
  superAntifire: 50,
  shieldAntifire: 10,
  shieldSuperAntifire: 10,
  prayerAntifire: 15,
  prayerSuperAntifire: 15,
  shieldPrayerAntifire: 10,
  shieldPrayerSuperAntifire: 10,
});

/** Wiki: shock drains two levels from every stat, poison starts at 8, ice freezes 10 ticks. */
const SHOCK_DRAIN = 2;
const POISON_SEVERITY = 8;
const ICE_FREEZE_TICKS = 10;
/** Wiki (Mod Ash): 1/2 unprotected, 1/8 with a shield and/or Protect from Magic. */
const EFFECT_DENOMINATOR_PROTECTED = 7;
const EFFECT_DENOMINATOR_UNPROTECTED = 1;

const BURN_MESSAGE = "You're horribly burnt by the dragon fire!";
const SHIELD_MESSAGE = "Your shield absorbs most of the dragon fire!";
const PRAYER_MESSAGE = "Your prayers resist some of the dragon fire!";
const ANTIFIRE_MESSAGE = "Your antifire potion helps to protect you from the dragon's breath!";
const SUPER_ANTIFIRE_MESSAGE = "Your super antifire potion completely protects you from the dragon fire!";

function breathMax(special, { shield, prayer, tier }) {
  const superAntifire = tier >= DragonfireProtectionTier.SUPER_ANTIFIRE;
  const antifire = tier >= DragonfireProtectionTier.ANTIFIRE;
  const table = special ? SPECIAL_BREATH_MAX : FIERY_BREATH_MAX;
  if (shield && prayer && superAntifire) return table.shieldPrayerSuperAntifire;
  if (shield && prayer && antifire) return table.shieldPrayerAntifire;
  if (shield && superAntifire) return table.shieldSuperAntifire;
  if (shield && antifire) return table.shieldAntifire;
  if (prayer && superAntifire) return table.prayerSuperAntifire;
  if (prayer && antifire) return table.prayerAntifire;
  if (shield && prayer) return table.shieldPrayer;
  if (shield) return table.shield;
  if (prayer) return table.prayer;
  if (superAntifire) return table.superAntifire;
  if (antifire) return table.antifire;
  return table.unprotected;
}

function sendBreathMessages(player, { shield, prayer, tier }) {
  const superAntifire = tier >= DragonfireProtectionTier.SUPER_ANTIFIRE;
  if (superAntifire) {
    player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, SUPER_ANTIFIRE_MESSAGE);
    return;
  }
  if (shield) player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, SHIELD_MESSAGE);
  else if (prayer) player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, PRAYER_MESSAGE);
  else player.sendMessage(BURN_MESSAGE);
  if (tier >= DragonfireProtectionTier.ANTIFIRE) {
    player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, ANTIFIRE_MESSAGE);
  }
}

function drainAllStats(player, core) {
  const skills = player.getSkillManager();
  for (const skill of core.Skill.values()) {
    if (skill === core.Skill.HITPOINTS) continue;
    skills.decreaseCurrentLevel(skill, SHOCK_DRAIN, 1);
  }
}

let api = null;
let core = null;
let Location, Misc, PendingHit, Projectile, CombatEquipment;
let PrayerHandler;
let CombatFactory;

function climbDownToLair({ player }) {
  const [x, y, z] = KING_BLACK_DRAGON_LAIR;
  api.emitCustomEvent("ladders:climbDown", {
    player,
    destination: new Location(x, y, z),
    // The easy Wilderness Diary's "Enter the King Black Dragon's lair.", once the climb has landed.
    onArrival: () => api.emitCustomEvent("diary:task", { player, diary: "wilderness", task: "enter-the-king-black-dragon-s-lair" }),
  });
  return true;
}

function pullLairLever({ player }) {
  const [x, y, z] = KING_BLACK_DRAGON_LADDER;
  api.emitCustomEvent("lever:teleport", { player, destination: new Location(x, y, z) });
  return true;
}

/** The combat method, built on api.core's classes. */
function combatClass(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  ({ Location, Misc, PendingHit, Projectile, CombatEquipment } = pluginApi.core);
  PrayerHandler = pluginApi.getPrayerHandler();
  CombatFactory = pluginApi.getCombatFactory();
  const { Animation, CombatMethod, CombatType } = pluginApi.core;

  class KingBlackDragonCombatMethod extends CombatMethod {
    constructor() {
      super();
      this.currentAttackType = CombatType.MAGIC;
      this.currentBreath = Breath.DRAGON;
    }

    start(character, target) {
      if (this.currentAttackType === CombatType.MAGIC) {
        character.performAnimation(new Animation(84));
        let projectileId = 393;
        switch (this.currentBreath) {
          case Breath.DRAGON:
            projectileId = 393;
            break;
          case Breath.ICE:
            projectileId = 396;
            break;
          case Breath.POISON:
            projectileId = 394;
            break;
          case Breath.SHOCK:
            projectileId = 395;
            break;
          default:
            break;
        }
        // Leaves the head (43) for the target's chest (31), not the ground for their scalp.
        Projectile.createProjectile(
          character,
          target,
          projectileId,
          40,
          Projectile.arrivalCycles(character, target),
          43,
          31
        ).sendProjectile();
      } else if (this.currentAttackType === CombatType.MELEE) {
        character.performAnimation(new Animation(91));
      }
    }

    attackDistance() {
      return 8;
    }

    type() {
      return this.currentAttackType;
    }

    hits(character, target) {
      // The burn lands when the fire does, not before it.
      const hitDelay =
        this.currentAttackType === CombatType.MAGIC ? Projectile.arrivalTicks(character, target) : 1;
      if (this.currentAttackType !== CombatType.MAGIC) {
        return [new PendingHit(character, target, this, hitDelay)];
      }

      const special = this.currentBreath !== Breath.DRAGON;
      const hit = new PendingHit(character, target, this, { delay: hitDelay, rollAccuracy: false });
      // The breath's own table replaces the generic magic roll (and its protection stage).
      hit.markProtectionBypassed();
      if (!target.isPlayer()) {
        hit.setTotalDamage(Misc.randomInclusive(0, special ? SPECIAL_BREATH_MAX.unprotected : FIERY_BREATH_MAX.unprotected));
        return [hit];
      }

      const player = target.getAsPlayer();
      const shield = CombatEquipment.hasDragonProtectionGear(player);
      const prayer = PrayerHandler.isActivated(player, PrayerHandler.PROTECT_FROM_MAGIC);
      const tier = getDragonfireProtectionTier(player);
      const damage = Misc.randomInclusive(0, breathMax(special, { shield, prayer, tier }));
      hit.setTotalDamage(damage);
      sendBreathMessages(player, { shield, prayer, tier });

      // Wiki: a special breath has a 1/2 chance of its effect unprotected, 1/8 with a
      // shield and/or Protect from Magic, and only on a hit that dealt damage.
      if (special && damage > 0) {
        const denominator = shield || prayer ? EFFECT_DENOMINATOR_PROTECTED : EFFECT_DENOMINATOR_UNPROTECTED;
        if (Misc.randomInclusive(0, denominator) === 0) {
          switch (this.currentBreath) {
            case Breath.ICE:
              CombatFactory.freezeTicks(player, ICE_FREEZE_TICKS);
              break;
            case Breath.POISON:
              CombatFactory.poisonEntity(player, POISON_SEVERITY);
              break;
            case Breath.SHOCK:
              drainAllStats(player, core);
              break;
            default:
              break;
          }
        }
      }
      return [hit];
    }

    finished(character, target) {
      // Distance from the dragon's body, not its south-west corner: standing at its east
      // side read as 5 tiles away, so it breathed on you point blank instead of biting.
      if (character.calculateDistance(target) <= 1) {
        if (Misc.randomInclusive(0, 2) === 0) {
          this.currentAttackType = CombatType.MAGIC;
        } else {
          this.currentAttackType = CombatType.MELEE;
        }
      } else {
        this.currentAttackType = CombatType.MAGIC;
      }
      if (this.currentAttackType === CombatType.MAGIC) {
        // Wiki (Mod Ash): 50% fiery breath, otherwise the three special breaths equally often.
        if (Misc.randomInclusive(0, 1) === 0) {
          this.currentBreath = Breath.DRAGON;
        } else {
          this.currentBreath = [Breath.ICE, Breath.POISON, Breath.SHOCK][Misc.randomInclusive(0, 2)];
        }
      }
    }
  }

  return KingBlackDragonCombatMethod;
}

module.exports = {
  name: "KingBlackDragon",
  members: true,
  register(pluginApi) {
    const { NpcIdentifiers } = pluginApi.core;
    pluginApi.registerNpcCombatMethodProvider(
      [NpcIdentifiers.KING_BLACK_DRAGON, NpcIdentifiers.KING_BLACK_DRAGON_2, NpcIdentifiers.KING_BLACK_DRAGON_3],
      combatClass(pluginApi),
    );
    pluginApi.onObjectFirstClick(KBD_LADDER_DOWN_OBJECT_ID, climbDownToLair);
    pluginApi.onObjectFirstClick(KBD_LAIR_LEVER_OBJECT_ID, pullLairLever);
  },
  _test: { breathMax, FIERY_BREATH_MAX, SPECIAL_BREATH_MAX, DragonfireProtectionTier },
};
