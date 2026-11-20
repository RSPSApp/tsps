/**
 * The bell outside the Wizards' Guild in Yanille (loc 6847, zogre_outdoor_bell), rung in The Hand in the Sand and
 * Zogre Flesh Eaters to fetch Zavistic Rarve. As a revision 242 capture rings it (local 1002235, ticks 7398-7490,
 * 7925-8037, 8539-8574, 9004-9008):
 *
 * - The bell swings (zogre_bell_ring 2103) the tick after the click, ringing (zogre_bell 1959, an area sound of
 *   range 5 at 2598,3086) as it does.
 * - A tick later Zavistic Rarve stands north of it at (2598,3087), facing south, and the conversation opens.
 * - He stays while the player talks to him (ringing again keeps the same Zavistic) and walks off once the chat has
 *   been closed a while (12-16 ticks in the capture); he also goes when the player leaves.
 *
 * Ours: he leaves 12 ticks after the chat closes, and 15 tiles is "leaving"; the capture shows no exact rule. Each
 * ringer gets their own Zavistic, visible to them alone (one recording, one player: whether others see him is
 * uncaptured).
 */
const BELL_RING_ANIM = 2103;
const BELL_SOUND = { soundId: 1959, x: 2598, y: 3086, level: 0, radius: 5 };
const ARRIVAL = { x: 2598, y: 3087, z: 0 };
const LEAVE_AFTER_IDLE_TICKS = 12;
const LEAVE_DISTANCE = 15;
/** A countdown started from the click runs in that tick's task pass, so 2 is the next tick (t7399 swing, t7400 Zavistic). */
const ARRIVAL_TICKS = 2;
/** The Zavistic who answered each player's ring, until he walks off: one per player, whichever quest rang. */
const visitors = new Map();

function createWizardsGuildBell(api) {
  const { Animation, CountdownTask, Direction, NpcIdentifiers, Task, TaskManager } = api.core;

  function swing(player, bell) {
    api.core.Sounds.playAreaSound({ ...BELL_SOUND });
    if (!bell?.getLocation) return;
    const animation = new Animation(BELL_RING_ANIM);
    const viewers = new Set([player, ...(player.getLocalPlayers?.() ?? [])]);
    for (const viewer of viewers) viewer.getPacketSender().sendObjectAnimation(bell, animation);
  }

  /** No conversation, chatbox or menu up. */
  function idle(player) {
    const chatbox = player.getPacketSender().getChatboxGroupId?.();
    return !player.getDialogueManager?.()?.isActive?.() && !(typeof chatbox === "number" && chatbox >= 0);
  }

  function far(player, npc) {
    const at = player.getLocation();
    const from = npc.getLocation();
    return at.getZ() !== from.getZ()
      || Math.max(Math.abs(at.getX() - from.getX()), Math.abs(at.getY() - from.getY())) > LEAVE_DISTANCE;
  }

  function leave(player) {
    const visit = visitors.get(player);
    if (!visit) return;
    visitors.delete(player);
    if (visit.npc?.isRegistered?.()) api.removeNpc(visit.npc);
  }

  /** Watches the visit each tick: gone once the chat has been closed a while, or the player has left. */
  function watch(player, visit) {
    const task = new Task(1, visit, false);
    task.execute = () => {
      if (visitors.get(player) !== visit || !visit.npc?.isRegistered?.()) {
        task.stop();
        return;
      }
      if (player.isRegistered?.() === false || far(player, visit.npc)) {
        leave(player);
        task.stop();
        return;
      }
      visit.idle = idle(player) ? visit.idle + 1 : 0;
      if (visit.idle >= LEAVE_AFTER_IDLE_TICKS) {
        leave(player);
        task.stop();
      }
    };
    TaskManager.submit(task);
  }

  function arrive(player, at = ARRIVAL, face = Direction.SOUTH.id) {
    const current = visitors.get(player);
    if (current?.npc?.isRegistered?.()) {
      current.idle = 0;
      return current.npc;
    }
    // Each ringer's own Zavistic, seen and spoken to by them alone: his stay follows that player's chat and
    // whereabouts, so another player can't stack theirs on him, talk to him, or lose him when the owner leaves.
    const npc = api.spawnNpc({ id: NpcIdentifiers.ZAVISTIC_RARVE, ...at, face, wanderRadius: 1, owner: player, ownerOnly: true });
    if (!npc) return null;
    npc.__skipDefaultRespawn = true;
    const visit = { npc, idle: 0 };
    visitors.set(player, visit);
    watch(player, visit);
    return npc;
  }

  /**
   * Rings `bell` for `player`: the swing now, and a tick later Zavistic arrives and `talk(zavistic)` opens the
   * conversation.
   */
  function ring(player, bell, talk) {
    swing(player, bell);
    player.getMovementQueue?.()?.reset?.();
    TaskManager.submit(new CountdownTask(player, ARRIVAL_TICKS, () => {
      if (player.isRegistered?.() === false) return;
      talk(arrive(player));
    }));
  }

  /**
   * Zavistic standing at `[x, y, z]` for `player`, facing `face`: back beside the bell after a quest's cutscene took the
   * player away (The Hand in the Sand, t8635: (2597,3086) facing south-west). One already there is moved.
   */
  function summon(player, [x, y, z = 0], face) {
    const current = visitors.get(player);
    if (current?.npc?.isRegistered?.()) leave(player);
    return arrive(player, { x, y, z }, face);
  }

  return { ring, summon, leave, visitorOf: (player) => visitors.get(player)?.npc ?? null };
}

module.exports = { createWizardsGuildBell, BELL_RING_ANIM, BELL_SOUND };
