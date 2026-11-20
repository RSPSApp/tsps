/**
 * The Bellshroom in Fossil Island's Tar Swamp (loc 30670, south-west of the Magic Mushtree): fed
 * breadcrumbs, it swallows the player and puts them in the small clearing to its north-west, where
 * Charles Charlington is. The clearing's own Bellshroom (30671, Exit) brings them back; that one
 * is a loc teleport (plugins/world/data/loc-teleports.json). docs/bellshroom.md.
 *
 * As live OSRS plays it (rsprox capture database, rec 710, rev 231), ticks from the click with the
 * player already beside it:
 * - Investigate (tick 1299): +1 the message box (rec 710 types "Maybe its hungry..."; the text is
 *   the Wiki's "Maybe it's hungry..."), with breadcrumbs in the pack too.
 * - Breadcrumbs used on it (tick 1393): +2 the breadcrumbs go; +4 sound 2454 (6 loops, delay 13)
 *   and the loc's `fossil_bellshroom_swallow` (7744); +5 the screen fades out (script 948 over 15
 *   cycles); +6 the player is at (3656, 3750, 0) facing south, sound 2489; +7 they say "What just
 *   happened?" and the screen fades back in (50 cycles); +9 the fade overlay closes.
 * The handler runs one tick after the click (the tick LocTeleports also counts from).
 *
 * Search on Charles Charlington in the clearing (rec 710 ticks 1651 and 1655), on arrival:
 * - owning no Archaeologist's diary: the game message "You take the Archaeologist's diary." and
 *   the diary in the pack. The Wiki's drop table gives it "only if unowned"; the bank counts here.
 * - owning one: the message box "Doesn't look like he knows I'm here." (the Wiki's repeat-search
 *   line, and what rec 710 sent with the diary in the pack).
 */
const ENTRANCE = "fossil_flora_swamp_bellshroom";
const BELLSHROOM_NAME = "Bellshroom";
const BREADCRUMBS_NAME = "Breadcrumbs";
const HUNGRY = "Maybe it's hungry...";
const SAY = "What just happened?";

const CHARLES_NAME = "Charles Charlington";
const DIARY = "fossil_swamp_diary";
const DIARY_TAKEN = "You take the Archaeologist's diary.";
const ALREADY_OWNED = "Doesn't look like he knows I'm here.";
/** Ours: no capture or Wiki line for a full pack; the server's usual one. */
const NO_SPACE = "You don't have enough inventory space.";

const SWALLOW_ANIMATION = 7744;
const SWALLOW_SOUND = 2454;
const SWALLOW_SOUND_LOOPS = 6;
const SWALLOW_SOUND_DELAY = 13;
const LANDING_SOUND = 2489;
const CLEARING = [3656, 3750, 0];

const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;
const FADE_OVERLAY = 174;
const FADE_SCRIPT = 948;
const FADE_OUT_CYCLES = 15;
const FADE_IN_CYCLES = 50;

/** Task ticks after the handler (capture tick - 1). */
const EAT_TICK = 1;
const SWALLOW_TICK = 3;
const FADE_OUT_TICK = 4;
const MOVE_TICK = 5;
const FADE_IN_TICK = 6;
const CLOSE_TICK = 8;

let core = null;
/** Players being swallowed: further clicks on it are ignored until they are through. */
const swallowing = new WeakSet();

function isEntrance(objectId) {
  return objectId === core.CacheDefinitions.getLocId(ENTRANCE);
}

function fade(player, out) {
  const args = out ? [0, 255, 0, 0, FADE_OUT_CYCLES] : [0, 0, 0, 255, FADE_IN_CYCLES];
  player.getPacketSender().sendSubInterface(OVERLAY_ATMOSPHERE_UID, FADE_OVERLAY, 1, {
    postScripts: [{ scriptId: FADE_SCRIPT, args }],
  });
}

/** The swallow, seen by the player and everyone around them. */
function animateLoc(player, object) {
  const animation = new core.Animation(SWALLOW_ANIMATION);
  const viewers = new Set([player, ...(player.getLocalPlayers?.() ?? [])]);
  for (const viewer of viewers) viewer.getPacketSender().sendObjectAnimation(object, animation);
}

function investigate({ player, objectId }) {
  if (!isEntrance(objectId)) return false;
  if (swallowing.has(player)) return true;
  player.getDialogueManager().startDialogues(new core.DialogueChainBuilder()
    .add(new core.StatementDialogue(0, HUNGRY)));
  return true;
}

function swallow(player, object, breadcrumbs) {
  const { Task, TaskManager, Location } = core;
  const movement = player.getMovementQueue();
  const sender = player.getPacketSender();
  const start = player.getLocation().clone();
  const privateArea = player.getPrivateArea();
  swallowing.add(player);
  movement.setBlockMovement(true).reset();
  let tick = 0;
  TaskManager.submit(new (class extends Task {
    constructor() { super(1, player, false); }
    execute() {
      tick++;
      // Until the move, as LocTeleports: moved off their tile (a teleport, ::tele) or into or out
      // of an instance ends it there; after the move the fade back in still plays.
      const moved = tick <= MOVE_TICK && (!player.getLocation().equals(start) || player.getPrivateArea() !== privateArea);
      if (!player.isRegistered() || player.getHitpoints() <= 0 || moved) {
        this.stop();
        return;
      }
      if (tick === EAT_TICK) {
        // Ours: crumbs no longer in the pack by now (none recorded) end it there.
        if (!player.getInventory().contains(breadcrumbs)) {
          this.stop();
          return;
        }
        player.getInventory().delete(breadcrumbs, 1);
      } else if (tick === SWALLOW_TICK) {
        sender.sendSoundEffect(SWALLOW_SOUND, SWALLOW_SOUND_LOOPS, SWALLOW_SOUND_DELAY, 1);
        animateLoc(player, object);
      } else if (tick === FADE_OUT_TICK) {
        fade(player, true);
      } else if (tick === MOVE_TICK) {
        const [x, y, z] = CLEARING;
        player.moveTo(new Location(x, y, z));
        player.setPositionToFace(new Location(x, y - 1, z));
        sender.sendSound(LANDING_SOUND, 1, 0);
      } else if (tick === FADE_IN_TICK) {
        player.forceChat(SAY);
        fade(player, false);
      } else if (tick === CLOSE_TICK) {
        sender.closeSubInterface(OVERLAY_ATMOSPHERE_UID);
        this.stop();
      }
    }
    stop() {
      // Stopped before the move (crumbs gone, player moved): the faded screen, if any, is cleared too.
      if (tick >= FADE_OUT_TICK && tick < CLOSE_TICK && player.isRegistered()) sender.closeSubInterface(OVERLAY_ATMOSPHERE_UID);
      swallowing.delete(player);
      movement.setBlockMovement(false);
      super.stop();
    }
  })());
}

function feed({ player, object, objectId, itemId }) {
  if (!isEntrance(objectId)) return false;
  if (swallowing.has(player)) return true;
  // Something else holds the player still (another loc's walk, a cutscene): leave it be.
  if (player.getMovementQueue().isMovementBlocked()) return true;
  swallow(player, object, itemId);
  return true;
}

function searchCharles({ player }) {
  const diary = core.CacheDefinitions.getObjId(DIARY);
  if (core.Bank.owns(player, diary)) {
    player.getDialogueManager().startDialogues(new core.DialogueChainBuilder()
      .add(new core.StatementDialogue(0, ALREADY_OWNED)));
    return;
  }
  if (player.getInventory().getFreeSlots() < 1) {
    player.sendMessage(NO_SPACE);
    return;
  }
  player.getInventory().add(new core.Item(diary, 1));
  player.sendMessage(DIARY_TAKEN);
}

module.exports = {
  name: "Bellshroom",
  description: "Fossil Island's Tar Swamp Bellshroom: Investigate, and breadcrumbs used on it swallow the player into Charles Charlington's clearing, where searching Charles gives the Archaeologist's diary.",
  members: true,
  _test: { investigate, feed, searchCharles, CLEARING },
  register(registerApi) {
    core = registerApi.core;
    registerApi.onObjectInteraction(BELLSHROOM_NAME, { Investigate: investigate });
    registerApi.onItemOnObject(BREADCRUMBS_NAME, BELLSHROOM_NAME, feed);
    registerApi.onNpcInteraction(CHARLES_NAME, { Search: searchCharles });
  },
};
