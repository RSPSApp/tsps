/**
 * The Tar Swamp's rubber cap mushroom on Fossil Island: Jump on throws the player from the
 * swamp's north-west corner to the mud pit in its centre, a soft landing only if the pit has
 * been filled with 9 bittercap mushrooms (the Mushy Bed). docs/tar-swamp-mushroom.md.
 *
 * As live OSRS plays it (rsprox capture database, rec 711, rev 231):
 * - Mud pit Fill without 9 bittercaps: "You'll need 9 Bittercap mushrooms to fill the pit."
 *   (ticks 617, 769). With them (tick 919): the 9 go, varbits fossil_activity_mushroombed and
 *   fossil_mushroom_bed go to 1 (the pit turns into the Mushy Bed), the pick-mushroom
 *   animation, sound 2432 and the object box "You fill the pit with Bittercap mushrooms.".
 * - Jump on with the bed empty asks first: "That might damage you A LOT if you proceed." /
 *   "I'll take the risk of the damage." / "I'd better not in that case." (ticks 81, 215).
 * - The jump, counted from the click on the risk (tick 221) or, with the bed made, from the
 *   arrival (tick 1186): +1 lifted to level 1 where they stand,
 *   +2 onto the mushroom, (3664, 3810, 1), +5 the bounce (spotanim 1411,
 *   quest_lunar_ejector_thrown, sound 1694), +9 at the pit (3687, 3756, 1), +11 landing on
 *   their face (sound 1695; on the bed also spotanim 1410 and fossil_mushroom_bed back to 0),
 *   +20 two tiles west to (3685, 3756, 1), +23 down to level 0. Without the bed that last step
 *   says "Ow!" and hits 48 (sound 519); the Wiki (Mushy Bed) gives 40 to 50.
 */
const BED_ATTRIBUTE = "tar-swamp-mushroom:bed";
const FILLED_ATTRIBUTE = "tar-swamp-mushroom:filled";
const BED_VARBIT = "fossil_mushroom_bed";
const FILLED_VARBIT = "fossil_activity_mushroombed";

const MUSHROOM_NAME = "Rubber cap mushroom";
const PIT_NAME = "Mud pit";
const MUSHROOMS_NEEDED = 9;
const NEED_MUSHROOMS = "You'll need 9 Bittercap mushrooms to fill the pit.";
const FILLED = "You fill the pit with Bittercap mushrooms.";
const FILL_ANIMATION = 2292;
const FILL_SOUND = 2432;

const WARNING = "That might damage you A LOT if you proceed.";
const TAKE_RISK = "I'll take the risk of the damage.";
const DECLINE = "I'd better not in that case.";

const BOUNCE_GRAPHIC = 1411;
const THROWN_ANIMATION = 4365;
const THROWN_SOUND = 1694;
const BED_GRAPHIC = 1410;
const LANDING_ANIMATION = 4367;
const LANDING_SOUND = 1695;
const HURT_SOUND = 519;
const HURT_SOUND_DELAY = 20;
const HURT_LINE = "Ow!";
/** OSRS Wiki, Mushy Bed: "between 40 and 50 damage" without the bed (rec 711: 48). */
const MIN_DAMAGE = 40;
const MAX_DAMAGE = 50;

/** The mushroom's tile on level 1, walked onto the tick after the lift (rec 711 ticks 223, 1188). */
const ON_MUSHROOM = [3664, 3810, 1];
const LANDING = [3687, 3756, 1];
const STEP_OFF = [3685, 3756, 1];
const GROUND = [3685, 3756, 0];
const LIFT_TICK = 1;
const ON_MUSHROOM_TICK = 2;
const BOUNCE_TICK = 5;
const THROW_TICK = 9;
const LAND_TICK = 11;
const STEP_OFF_TICK = 20;
const GROUND_TICK = 23;

let core = null;
let api = null;
/**
 * Players mid-jump, with how far they are: their clicks and the Logout button are ignored until
 * they are back on the ground (Ours: live holds the logout through scripted moves; none recorded).
 */
const jumping = new WeakMap();

function varbitId(name) {
  return core.CacheDefinitions.getVarbitId(name);
}

function bedMade(player) {
  return player.getAttribute(BED_ATTRIBUTE) === 1;
}

/** The pit's state, kept for the next login, and the client's multiloc with it. */
function setBed(player, made) {
  player.setAttribute(BED_ATTRIBUTE, made ? 1 : 0);
  player.getPacketSender().sendVarbit(varbitId(BED_VARBIT), made ? 1 : 0);
}

/** A hard landing's damage: OSRS Wiki, Mushy Bed, 40 to 50. */
function rollDamage() {
  return MIN_DAMAGE + core.Misc.getRandom(MAX_DAMAGE - MIN_DAMAGE);
}

function holdLogout(event) {
  if (jumping.has(event.player)) event.allow = false;
}

/**
 * A dropped connection mid-jump (the Logout button is held): finish the jump before the save, so
 * the player is saved on the ground rather than in the air on level 1. Ours: a hard landing still
 * costs the 40-50, but leaves at least 1 hitpoint, since the hit queue no longer runs.
 */
function landOnLogout({ player }) {
  const state = jumping.get(player);
  if (!state) return;
  if (state.cushioned == null) {
    state.cushioned = bedMade(player);
    if (state.cushioned) setBed(player, false);
  }
  player.moveTo(location(GROUND));
  if (!state.cushioned && !state.dropped) {
    const { Skill } = core;
    const skills = player.getSkillManager();
    skills.setCurrentLevel(Skill.HITPOINTS, Math.max(1, skills.getCurrentLevel(Skill.HITPOINTS) - rollDamage()), true);
  }
  jumping.delete(player);
}

function restoreVarbits({ player }) {
  const sender = player.getPacketSender();
  if (bedMade(player)) sender.sendVarbit(varbitId(BED_VARBIT), 1);
  if (player.getAttribute(FILLED_ATTRIBUTE) === true) sender.sendVarbit(varbitId(FILLED_VARBIT), 1);
}

function fillPit({ player }) {
  const mushroom = core.ItemIdentifiers.MUSHROOM;
  if (jumping.has(player)) return true;
  if (bedMade(player)) return true;
  const inventory = player.getInventory();
  if (inventory.getAmount(mushroom) < MUSHROOMS_NEEDED) {
    player.sendMessage(NEED_MUSHROOMS);
    return true;
  }
  inventory.delete(mushroom, MUSHROOMS_NEEDED);
  player.setAttribute(FILLED_ATTRIBUTE, true);
  player.getPacketSender().sendVarbit(varbitId(FILLED_VARBIT), 1);
  setBed(player, true);
  player.performAnimation(new core.Animation(FILL_ANIMATION));
  player.getPacketSender().sendSound(FILL_SOUND, 1, 0);
  player.getDialogueManager().startDialogues(new core.DialogueChainBuilder()
    .add(new core.ItemStatementDialogue(0, mushroom, FILLED)));
  return true;
}

function location([x, y, z]) {
  return new core.Location(x, y, z);
}

/** The captured jump, from the tick the player commits to it. */
function jump(player) {
  const { Task, TaskManager, Animation, Graphic, HitDamage, HitMask } = core;
  const movement = player.getMovementQueue();
  const sender = player.getPacketSender();
  movement.setBlockMovement(true).reset();
  const state = { cushioned: null, dropped: false };
  jumping.set(player, state);
  let tick = 0;
  TaskManager.submit(new (class extends Task {
    constructor() { super(1, player, false); }
    execute() {
      tick++;
      // A death mid-air (poison, venom) ends the jump: the respawn isn't pulled back to the pit.
      if (!player.isRegistered() || player.getHitpoints() <= 0) {
        this.stop();
        return;
      }
      if (tick === LIFT_TICK) {
        const here = player.getLocation();
        player.moveTo(new core.Location(here.getX(), here.getY(), here.getZ() + 1));
      } else if (tick === ON_MUSHROOM_TICK) {
        player.moveTo(location(ON_MUSHROOM));
      } else if (tick === BOUNCE_TICK) {
        player.performGraphic(new Graphic(BOUNCE_GRAPHIC));
        player.performAnimation(new Animation(THROWN_ANIMATION));
        sender.sendSound(THROWN_SOUND, 1, 0);
      } else if (tick === THROW_TICK) {
        player.moveTo(location(LANDING));
      } else if (tick === LAND_TICK) {
        state.cushioned = bedMade(player);
        if (state.cushioned) {
          setBed(player, false);
          player.performGraphic(new Graphic(BED_GRAPHIC));
        }
        player.performAnimation(new Animation(LANDING_ANIMATION));
        sender.sendSound(LANDING_SOUND, 1, 0);
      } else if (tick === STEP_OFF_TICK) {
        player.moveTo(location(STEP_OFF));
      } else if (tick === GROUND_TICK) {
        player.moveTo(location(GROUND));
        state.dropped = true;
        if (!state.cushioned) {
          player.forceChat(HURT_LINE);
          player.getCombat().getHitQueue().addPendingDamage([new HitDamage(rollDamage(), HitMask.RED)]);
          sender.sendSound(HURT_SOUND, 1, HURT_SOUND_DELAY);
        }
        this.stop();
      }
    }
    stop() {
      // A player leaving the world keeps the state, whichever comes first: the logout hook
      // (landOnLogout, which lands them before the save) or a stop of this task.
      if (player.isRegistered() && jumping.get(player) === state) jumping.delete(player);
      movement.setBlockMovement(false);
      super.stop();
    }
  })());
}

function jumpOn({ player }) {
  if (jumping.has(player)) return true;
  if (bedMade(player)) {
    jump(player);
    return true;
  }
  api.sendMultiChatboxPrompt(player, WARNING, TAKE_RISK, () => jump(player), DECLINE, () => {});
  return true;
}

module.exports = {
  name: "TarSwampMushroom",
  description: "Fossil Island's Tar Swamp rubber cap mushroom: Jump on throws the player to the mud pit, softened by 9 bittercaps (Fill).",
  members: true,
  _test: { fillPit, jumpOn, jump, holdLogout, landOnLogout, BED_ATTRIBUTE, FILLED_ATTRIBUTE },
  register(registerApi) {
    api = registerApi;
    core = registerApi.core;
    registerApi.persistAttribute(BED_ATTRIBUTE, 0);
    registerApi.persistAttribute(FILLED_ATTRIBUTE, false);
    registerApi.onPlayerLogin(restoreVarbits);
    registerApi.onCanLogout(holdLogout);
    registerApi.onPlayerLogout(landOnLogout);
    registerApi.onObjectInteraction(MUSHROOM_NAME, { "Jump on": jumpOn });
    registerApi.onObjectInteraction(PIT_NAME, { Fill: fillPit });
  },
};
