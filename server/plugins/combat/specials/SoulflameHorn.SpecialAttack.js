// Soulflame horn Entice (https://oldschool.runescape.wiki/w/Soulflame_horn): the horn empowers up to
// three other players within three tiles, costing 25% energy per player affected, and the user too
// at no extra cost. An empowered player's next melee attack within 10 ticks is a successful hit (only
// the first accuracy roll of a multi-hit attack); against a player it is +50% accuracy instead. With
// no one eligible nearby it costs nothing and sends "You blow your horn into the wind...". Inside
// Nightmare, Nex, the raids, Royal Titans and Yama everyone can receive it (Ironmen included);
// elsewhere a player needs Accept Aid on (Ironmen never have it). 4-tick cooldown.
//
// rsprox captures (docs/soulflame-horn.md): rec 3865 ticks 428/445 (nobody near: the red message,
// seq soulflame_horn_blow_03_no_fire, no energy spent) and 474 (one ally: 1000 -> 750 energy, the
// blue message, seq soulflame_horn_blow_03, spotanim vfx_soulflame_horn_spotanim01 at height 100,
// synth sound 10236, "The Soulflame horn's effect fades away." 10 ticks later); the receiving side
// in the user's cox_cm_3man_run1 ticks 940, 3105-3115, 3300 (the "<name> encourages you" line,
// spotanim vfx_soulflame_horn_impact_spotanim01 delay 30, sound 10236, the fade 10 ticks on when
// no melee attack spent it, and no fade line when one did).
const DRAIN = 25;
const RADIUS = 3;
const MAX_ALLIES = 3;
const DURATION_TICKS = 10;
const COOLDOWN_TICKS = 4;
/** Wiki: "If attacking another player, the effect is replaced by a 50% accuracy increase". */
const PVP_ACCURACY_MULTIPLIER = 1.5;
const SOUND = 10236;
const NO_ONE_MESSAGE = "<col=ef1020>You blow your horn into the wind. No-one nearby is able to listen.";
const USER_MESSAGE = "<col=3366ff>You encourage nearby allies, which also empowers your next melee attack!";
const FADE_MESSAGE = "<col=3366ff>The Soulflame horn's effect fades away.";
const allyMessage = (name) => `<col=3366ff>${name} encourages you with their Soulflame horn, empowering your next melee attack!`;
/**
 * The areas (by class) where Wiki says everyone receives Entice: Nightmare, Nex, the raids, Royal
 * Titans and Yama. Matched by name so this file needs no require of each boss's area module.
 */
const AID_FREE_AREAS = new Set([
  "NightmareDream",
  "NexChamber", "NexInstance",
  "CoxMap", "TheatreArea", "TheatreOfBloodArea", "TombsOfAmascutArea",
  "RoyalTitansArea",
  "YamasDomain",
]);

module.exports = function registerSoulflameHornSpecialAttack(api) {
  const { Animation, CacheDefinitions, CombatSpecial, CombatType, Graphic, ItemIdentifiers, MeleeCombatMethod, Task, TaskManager, World } = api.core;

  const seq = (name) => new Animation(CacheDefinitions.getSeqId(name));
  const spotanim = (name) => CacheDefinitions.getSpotanimId(name);

  /** player -> the grant object of their pending Entice; a newer grant replaces (and outlives) the old. */
  const empowered = new WeakMap();
  /** player -> the cycle they last blew the horn. */
  const lastBlown = new WeakMap();
  /** attackers whose current roll against a player carries the +50%. */
  const pvpRoll = new WeakSet();

  function inAidFreeContent(player) {
    return [player.getArea?.(), player.getPrivateArea?.()].some((area) => area && AID_FREE_AREAS.has(area.constructor?.name));
  }

  function canReceive(user, other) {
    if (!other || other === user || !other.isRegistered?.() || other.getHitpoints() <= 0) return false;
    if ((user.getPrivateArea?.() ?? null) !== (other.getPrivateArea?.() ?? null)) return false;
    if (!user.getLocation().isWithinDistance(other.getLocation(), RADIUS)) return false;
    return inAidFreeContent(other) || other.getAttribute("accept-aid") !== false;
  }

  /** Eligible players nearest first. */
  function alliesOf(user) {
    const near = [...(user.getLocalPlayers?.()?.values?.() ?? [])].filter((other) => canReceive(user, other));
    const here = user.getLocation();
    const distance = (other) => Math.max(Math.abs(other.getLocation().getX() - here.getX()), Math.abs(other.getLocation().getY() - here.getY()));
    return near.sort((a, b) => distance(a) - distance(b));
  }

  function empower(player) {
    const grant = {};
    empowered.set(player, grant);
    TaskManager.submit(new (class extends Task {
      constructor() {
        super(DURATION_TICKS);
      }

      execute() {
        this.stop();
        if (empowered.get(player) !== grant) return;
        empowered.delete(player);
        if (player.isRegistered?.()) player.sendMessage(FADE_MESSAGE);
      }
    })());
  }

  class SoulflameHornCombatMethod extends MeleeCombatMethod {
    hits() {
      return null;
    }

    start(character) {
      if (!character.isPlayer()) return;
      const player = character.getAsPlayer();
      const now = World.getProcessCycle();
      // Ours: a press inside the 4-tick cooldown does nothing (not captured).
      if (lastBlown.has(player) && now - lastBlown.get(player) < COOLDOWN_TICKS) return;
      lastBlown.set(player, now);

      const allies = alliesOf(player);
      if (allies.length === 0) {
        player.performAnimation(seq("soulflame_horn_blow_03_no_fire"));
        player.sendMessage(NO_ONE_MESSAGE);
        return;
      }
      // Ours: with energy for fewer allies than are eligible, the nearest that can be paid for.
      const affordable = Math.floor(player.getSpecialPercentage() / DRAIN);
      const affected = allies.slice(0, Math.max(1, Math.min(MAX_ALLIES, affordable)));
      CombatSpecial.drain(player, DRAIN * affected.length);
      player.sendMessage(USER_MESSAGE);
      player.performAnimation(seq("soulflame_horn_blow_03"));
      player.performGraphic(Graphic.atHeight(spotanim("vfx_soulflame_horn_spotanim01"), 100));
      player.getPacketSender().sendSoundEffect(SOUND, 1, 0, 255);
      empower(player);
      const name = player.getDisplayName();
      for (const ally of affected) {
        ally.sendMessage(allyMessage(name));
        ally.performGraphic(Graphic.delayed(spotanim("vfx_soulflame_horn_impact_spotanim01"), 30));
        ally.getPacketSender().sendSoundEffect(SOUND, 1, 0, 255);
        empower(ally);
      }
    }
  }

  /** The next melee roll spends the effect: an accurate roll against an NPC, +50% against a player. */
  function onHitRoll(roll) {
    const attacker = roll.attacker;
    if (!attacker?.isPlayer?.() || roll.combatType !== CombatType.MELEE || !empowered.has(attacker)) return;
    empowered.delete(attacker);
    if (roll.target?.isPlayer?.()) pvpRoll.add(attacker);
    else roll.forceAccurate = true;
  }

  const pvpAccuracy = (entity, attackRoll) => (pvpRoll.has(entity) ? Math.floor(attackRoll * PVP_ACCURACY_MULTIPLIER) : attackRoll);

  api.registerCombatSpecial({
    id: "soulflame_horn",
    itemIds: [
      ItemIdentifiers.SOULFLAME_HORN,
      ItemIdentifiers.SOULFLAME_HORN_2,
      ItemIdentifiers.SOULFLAME_HORN_3,
    ],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: { skipAttack: true },
    combatMethod: new SoulflameHornCombatMethod(),
  });
  api.onCombatHitRoll(onHitRoll);
  // The roll is over once its damage is out: the +50% belongs to that one roll.
  api.onCombatHitDamage(({ attacker }) => { if (attacker) pvpRoll.delete(attacker); });
  api.registerMeleeAttackAccuracyModifier(pvpAccuracy);

};
