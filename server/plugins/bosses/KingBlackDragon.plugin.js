// The way in (Wiki: King Black Dragon Lair, Lava Maze Dungeon): the Lava Maze ladder (3017, 3849)
// leads down to a small poison spider room, whose lever (3067, 10253) teleports into the lair. The
// lair's lever (2271, 4680) teleports back beside the spider room's lever, and that room's ladder
// (3069, 10256) climbs back up to the Lava Maze. Landing tiles as the Shortest Path plugin's
// transports record them; the entrance lever's pull, as rsprox_transcripts/242/900155.txt records it
// (docs/king-black-dragon.md).
const KBD_LADDER_DOWN_OBJECT_ID = 18987; // wildymirrorladdertop1
const KBD_LADDER_UP_OBJECT_ID = 18988; // wildymirrorladder1
const KBD_ENTRANCE_LEVER_OBJECT_ID = 1816; // dragonkinginlever
const KBD_LAIR_LEVER_OBJECT_ID = 1817; // dragonkingoutlever

const KING_BLACK_DRAGON_LAIR = [2271, 4680, 0];
const SPIDER_ROOM_LADDER_LANDING = [3069, 10255, 0];
const SPIDER_ROOM_LEVER_LANDING = [3067, 10254, 0];
const ENTRANCE_LEVER_TILE = [3067, 10253, 0];
const LAVA_MAZE_LADDER_LANDING = [3016, 3849, 0];
// The entrance lever's lines, both spam (rsprox_transcripts/242/900155.txt ticks 1109 and 1114). The
// lair lever's pull line is every captured lever's; no capture records a line on its landing.
const PULL_MESSAGE = { spam: "You pull the lever..." };
const INTO_LAIR_MESSAGE = { spam: "... and teleport into the Dragon's lair." };

const { DragonfireProtectionTier, emitDragonfireBreath, getDragonfireProtectionTier, sendDragonfireMessages } = require("../combat/DragonfireProtection");

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
/** Severity, which poisonEntity takes: hit x 5 (the first hit is 8). */
const POISON_SEVERITY = 40;
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
const ECHO_BOSS = "king-black-dragon";
const ECHO_INSIDE_ATTRIBUTE = "king-black-dragon:echo-inside";
const echoSessions = new Map();

/** Echo placeholder: the normal King Black Dragon with its breath tables, protection and
 * effects; no Echo specials. Wiki does not specify an applicable Echo breath cap, so the normal
 * 65/50 tables remain. EchoBosses gives this instance the Echo HP, stats and attack speed. */
function startEcho(request) {
  if (request.boss !== ECHO_BOSS || request.handled) return;
  request.handled = true;
  const { player } = request;
  if (echoSessions.has(player)) return;
  // "Yes." is answered at the spider room's lever: it is pulled as for the normal lair, and the
  // private lair is made when the teleport lands.
  api.emitCustomEvent("lever:teleport", {
    player,
    object: entranceLever(),
    message: PULL_MESSAGE,
    landed: INTO_LAIR_MESSAGE,
    destination: new Location(...KING_BLACK_DRAGON_LAIR),
    onArrival: () => beginEcho(player),
  });
}

function beginEcho(player) {
  if (echoSessions.has(player)) return;
  const claim = { player, boss: ECHO_BOSS, token: null };
  api.emitCustomEvent("echo-boss:claim", claim);
  if (!claim.token) return;
  const session = { player, token: claim.token, variant: "echo", role: "boss", npc: null, ended: false };
  echoSessions.set(player, session);
  try {
    const { PrivateArea, Boundary } = core;
    session.area = new (class extends PrivateArea {
      constructor() { super([new Boundary(2240, 2303, 4672, 4735, 0)]); }
      isMulti() { return true; }
      postLeave(mobile, logout) {
        if (mobile === player) {
          if (logout) player.setLocation(new Location(...SPIDER_ROOM_LEVER_LANDING));
          endEcho(session);
        }
        super.postLeave(mobile, logout);
      }
    })();
    session.npc = api.spawnNpc({ id: core.NpcIdentifiers.KING_BLACK_DRAGON, x: 2269, y: 4697, z: 0, owner: player, ownerOnly: true, wanderRadius: 0 });
    if (!session.npc) throw new Error("Echo KBD spawn failed");
    session.npc.__skipDefaultRespawn = true;
    session.npc.__kbdEchoSession = session;
    session.area.add(session.npc);
    const configure = { player, boss: ECHO_BOSS, role: "boss", npc: session.npc, token: session.token, configured: false };
    api.emitCustomEvent("echo-boss:configure", configure);
    if (!configure.configured) throw new Error("Echo KBD could not be configured");
    session.area.enter(player);
    player.moveTo(new Location(...KING_BLACK_DRAGON_LAIR));
    player.setAttribute(ECHO_INSIDE_ATTRIBUTE, true);
  } catch (error) {
    endEcho(session);
    // Landed in the public lair without the private one: back beside the lever, as before the pull.
    player.moveTo(new Location(...SPIDER_ROOM_LEVER_LANDING));
    player.sendMessage("The Echo encounter could not be started.");
  }
}

function endEcho(session) {
  if (!session || session.ended) return;
  session.ended = true;
  echoSessions.delete(session.player);
  session.player.setAttribute(ECHO_INSIDE_ATTRIBUTE, null);
  session.player.getCombat().reset();
  session.player.getCombat().getHitQueue().clear();
  session.npc?.getCombat().reset();
  session.npc?.getCombat().getHitQueue().clear();
  session.area?.destroy();
  api.emitCustomEvent("echo-boss:release", { player: session.player, token: session.token });
}

function echoDeath({ npc }) {
  const session = npc?.__kbdEchoSession;
  if (!session || session.ended || session.completed) return;
  session.completed = true;
  api.emitCustomEvent("echo-boss:completed", { player: session.player, boss: ECHO_BOSS, token: session.token, npcs: [npc], location: Projectile.centreOf(npc) });
}
function echoLogout({ player }) {
  const session = echoSessions.get(player);
  if (session) player.setLocation?.(new Location(...SPIDER_ROOM_LEVER_LANDING));
  endEcho(session);
}
function echoPlayerDeath({ player }) { endEcho(echoSessions.get(player)); }
function echoShutdown() { for (const session of [...echoSessions.values()]) echoLogout({ player: session.player }); }
function echoLogin({ player }) {
  if (!player.getAttribute(ECHO_INSIDE_ATTRIBUTE)) return;
  player.setAttribute(ECHO_INSIDE_ATTRIBUTE, null);
  player.moveTo(new Location(...SPIDER_ROOM_LEVER_LANDING));
}

/** The Lava Maze ladder: down to the spider room, not into the lair. */
function climbDownToSpiderRoom({ player }) {
  api.emitCustomEvent("ladders:climbDown", { player, destination: new Location(...SPIDER_ROOM_LADDER_LANDING) });
  return true;
}

/** The spider room's ladder: back up to the Lava Maze. */
function climbUpToLavaMaze({ player }) {
  api.emitCustomEvent("ladders:climbUp", { player, destination: new Location(...LAVA_MAZE_LADDER_LANDING) });
  return true;
}

/**
 * The spider room's lever into the lair; a league character carrying the echo orb is asked first
 * ("echo-boss:entry"). Its Commune and Private options are not implemented.
 */
function pullEntranceLever({ player, object }) {
  const entry = { player, boss: "king-black-dragon", enter: () => teleportIntoLair(player, object), handled: false };
  api.emitCustomEvent("echo-boss:entry", entry);
  if (!entry.handled) entry.enter();
  return true;
}

/**
 * Both levers are pulled as the entrance lever's capture shows: the pull, the lever flipping down,
 * then the teleport (lever:teleport given the lever plays the Wilderness levers' captured sequence).
 */
function teleportIntoLair(player, lever) {
  api.emitCustomEvent("lever:teleport", {
    player,
    object: lever,
    message: PULL_MESSAGE,
    landed: INTO_LAIR_MESSAGE,
    destination: new Location(...KING_BLACK_DRAGON_LAIR),
    // The easy Wilderness Diary's "Enter the King Black Dragon's lair.", once the teleport has landed.
    onArrival: () => api.emitCustomEvent("diary:task", { player, diary: "wilderness", task: "enter-the-king-black-dragon-s-lair" }),
  });
}

/** The lair's lever, back out beside the spider room's lever. */
function pullLairLever({ player, object }) {
  api.emitCustomEvent("lever:teleport", { player, object, message: PULL_MESSAGE, destination: new Location(...SPIDER_ROOM_LEVER_LANDING) });
  return true;
}

/** The spider room's lever on the map, for the echo orb prompt's "Yes." (which has no click event). */
function entranceLever() {
  const [x, y, z] = ENTRANCE_LEVER_TILE;
  return core.MapObjects?.get?.(KBD_ENTRANCE_LEVER_OBJECT_ID, new Location(x, y, z), null) ?? undefined;
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
      // Wiki (Dragonfire shield): each adult dragon's dragonfire attack charges a worn shield.
      sendDragonfireMessages(player, emitDragonfireBreath(character, player, []));

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
  description: "The King Black Dragon: the Lava Maze ladder, the spider room's lever into the lair and the lair's lever out, and the fight with dragonfire checked against antifire protection.",
  members: true,
  register(pluginApi) {
    const { NpcIdentifiers } = pluginApi.core;
    pluginApi.registerNpcCombatMethodProvider(
      [NpcIdentifiers.KING_BLACK_DRAGON, NpcIdentifiers.KING_BLACK_DRAGON_2, NpcIdentifiers.KING_BLACK_DRAGON_3],
      combatClass(pluginApi),
    );
    pluginApi.onObjectFirstClick(KBD_LADDER_DOWN_OBJECT_ID, climbDownToSpiderRoom);
    pluginApi.onObjectFirstClick(KBD_LADDER_UP_OBJECT_ID, climbUpToLavaMaze);
    pluginApi.onObjectFirstClick(KBD_ENTRANCE_LEVER_OBJECT_ID, pullEntranceLever);
    pluginApi.onObjectFirstClick(KBD_LAIR_LEVER_OBJECT_ID, pullLairLever);
    pluginApi.persistAttribute(ECHO_INSIDE_ATTRIBUTE);
    pluginApi.onCustomEvent("echo-boss:start", startEcho);
    pluginApi.onNpcDeath(echoDeath);
    pluginApi.onPlayerLogout(echoLogout);
    pluginApi.onPlayerDeath(echoPlayerDeath);
    pluginApi.onPlayerLogin(echoLogin);
    pluginApi.onServerShutdown(echoShutdown);
  },
  _test: { breathMax, FIERY_BREATH_MAX, SPECIAL_BREATH_MAX, DragonfireProtectionTier },
};
