/**
 * Icthlarin's Little Helper: the Wanderer, her tent and the way into Sophanem (stages 0-3), as the capture
 * plays them (local 1002310 t445-t515; docs/quests/ictlharins-little-helper).
 *
 * - "Yes." to "Start the Icthlarin's Little Helper quest?" starts it (stage 1) and picks the jar (varbit 397).
 * - With a full waterskin and a tinderbox, "Don't blink..." continued is the hypnosis (t485): the hypnotise
 *   synth, the screen to black and an empty held chatbox; the minimap off a tick later; 4 ticks on (t489)
 *   stages 2 and 3, Klenter's shade (449), the player outside Klenter's Pyramid with the jar in the
 *   waterskin's slot and the tinderbox gone; the kneel (t492); then the music, "You slowly pick yourself off
 *   the ground..." and the screen back (t493), and the city-of-the-dead talk as it is continued.
 * - The rock north-east of her tent (6621, its multiloc open from stage 2) leads in, the wall crack (6620,
 *   world/data/loc-teleports.json) back out.
 */
function createStart(api, state, common, { STAGE, VARBIT, JARS }) {
  const { Location, NpcIdentifiers, Skill } = api.core;

  const SOPHANEM_WAKE = [3294, 2782, 0]; // t489
  const WAKE_FACING = [3294, 2780]; // facing the door (t489)
  const INSIDE_CITY = [3320, 2796, 0]; // through the rock (t535)
  const ENTRANCE_ROCK = 6621; // ics_little_entrance_multi
  const TENT_FLAP = 6581; // icthalarins_tent_door
  const HYPNOTISE_TO_ARRIVAL = 4;
  const ARRIVAL_TO_KNEEL = 3;
  const ARRIVAL_TO_WAKE = 4;

  /**
   * The jar (Wiki, Getting Started): the highest of Attack/Strength (Het), Ranged (Apmeken) and Magic
   * (Scabaras), with the matching equipment bonuses; Crondis only for quests started before 27 April 2022.
   * Ours: the Wiki's "still a chance to get a different one" has no odds, so the highest always wins (ties to
   * Het, as the Wiki lists it first).
   */
  function pickJar(player) {
    const skills = player.getSkillManager();
    const bonuses = player.getBonusManager?.() ?? null;
    const other = bonuses?.getOtherBonus?.() ?? [];
    const defence = bonuses?.getDefenceBonus?.() ?? [];
    const melee = Math.max(skills.getMaxLevel(Skill.ATTACK), skills.getMaxLevel(Skill.STRENGTH)) + (other[0] ?? 0)
      + (defence[0] ?? 0) + (defence[1] ?? 0) + (defence[2] ?? 0);
    const ranged = skills.getMaxLevel(Skill.RANGED) + (other[1] ?? 0) + (defence[4] ?? 0);
    const magic = skills.getMaxLevel(Skill.MAGIC) + (other[2] ?? 0) + (defence[3] ?? 0);
    if (melee >= ranged && melee >= magic) return 1;
    return ranged >= magic ? 2 : 3;
  }

  function gertrudesCatComplete(player) {
    const request = { player, key: "gertrudes_cat", complete: undefined };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  /** The start menu's "Yes." (the transcript's quest hook). */
  function startHook(player) {
    if (state.stage(player) !== STAGE.NOT_STARTED) return;
    if (!gertrudesCatComplete(player)) {
      player.sendMessage("You must complete Gertrude's Cat to start this quest.");
      return;
    }
    state.clear(player);
    state.setStage(player, STAGE.STARTED);
    state.set(player, VARBIT.JAR, pickJar(player));
  }

  /** "Don't blink..." continued: the hypnosis to the arrival (t485-t493). */
  function hypnotise(player) {
    if (state.stage(player) !== STAGE.STARTED || !common.hasSupplies(player)) return;
    common.lock(player, true);
    common.sfx(player, "hypnotise");
    common.fade(player, common.FADE.TO_BLACK);
    common.hold(player);
    common.later(player, 1, () => common.minimap(player, true));
    common.later(player, HYPNOTISE_TO_ARRIVAL, () => arrive(player));
  }

  function arrive(player) {
    if (state.stage(player) !== STAGE.STARTED || !common.hasSupplies(player)) {
      common.release(player);
      common.lock(player, false);
      common.minimap(player, false);
      common.fade(player, common.FADE.FROM_BLACK, { close: 4 });
      return;
    }
    state.setStage(player, STAGE.HYPNOTISED);
    state.setStage(player, STAGE.IN_SOPHANEM);
    state.set(player, VARBIT.KLENTER, 1);
    const jar = state.jar(player) ?? JARS[2];
    // The jar takes the waterskin's slot; the tinderbox goes (t489).
    const skin = common.ITEM.WATERSKINS.find((id) => common.held(player, id));
    common.replaceInSlot(player, skin, jar.item);
    common.take(player, common.ITEM.TINDERBOX);
    player.moveTo(new Location(...SOPHANEM_WAKE));
    player.setPositionToFace?.(new Location(WAKE_FACING[0], WAKE_FACING[1], 0));
    common.later(player, ARRIVAL_TO_KNEEL, () => common.animate(player, "drop_to_knee"));
    common.later(player, ARRIVAL_TO_WAKE, () => {
      common.minimap(player, false);
      common.lock(player, false);
      common.fade(player, common.FADE.FROM_BLACK);
      common.play(player, NpcIdentifiers.KLENTER, "city-of-the-dead");
    });
  }

  /** Through the rock into the city (t528-t538): black, the far side, back. */
  function enterRock(event) {
    const { player } = event;
    if (state.stage(player) < STAGE.HYPNOTISED) return false;
    common.lock(player, true);
    common.fade(player, common.FADE.TO_BLACK);
    common.later(player, 2, () => {
      player.moveTo(new Location(...INSIDE_CITY));
      common.later(player, 1, () => {
        common.lock(player, false);
        common.fade(player, common.FADE.FROM_BLACK, { close: 2 });
      });
    });
    return true;
  }

  function tentFlap({ player }) {
    common.play(player, NpcIdentifiers.WANDERER_2, "starting-out-entering-the-wanderer-s-tent");
    return true;
  }

  return { startHook, hypnotise, enterRock, tentFlap, pickJar, ENTRANCE_ROCK, TENT_FLAP, SOPHANEM_WAKE };
}

module.exports = { createStart };
