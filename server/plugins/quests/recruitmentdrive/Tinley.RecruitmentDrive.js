// Sir Tinley's room (room 4): patience.
//
// rsprox capture RecruitmentDrive.bin (revision 242.1), ticks 500-559, 587-625, 804-851, 1807-1848:
//   - Arriving, he says "Ah, [player name], you have arrived. Speak to me to begin your task."
//   - A talk: "... one clue ...: 'Patience'." sets rd_templock_2 (667) to 1; from the tick it is
//     continued the varbit counts up one a tick, and the tick after it reaches 15 the room is passed
//     (rd_room4_complete 662) with the observer's line (ticks 595-611, 825-841, 1823-1838).
//   - Clicking to walk while it counts fails the room: the count goes on that tick and his failure
//     line shows (ticks 550-551). The Wiki: "Do not click anything after continuing".
//   - The hourglass on the floor (5610 at 2475,4956) is an ordinary ground item; picking it up
//     before talking changes nothing (tick 517).
module.exports = function createTinleyRoom(api, course, ids) {
  const ROOM = 4;
  const NPC = ids.SIR_TINLEY;
  const COUNT_VARBIT = 667; // rd_templock_2
  const PASS_AT = 15;
  const V_ENTER = "the-tests-sir-tinley-entering-the-room";
  const V_TALK = "the-tests-sir-tinley-talking-to-sir-tinley";

  /** Player -> { counting, value } once he has given the clue. */
  const waits = new WeakMap();

  function enter(player) {
    waits.delete(player);
    course.say(player, course.lines(course.variant(V_ENTER)).map((line) => ({ npc: NPC, text: line.text })));
  }

  function clear(player) {
    const wait = waits.get(player);
    if (wait) wait.stopped = true;
    waits.delete(player);
  }

  function talk(event) {
    const { player } = event;
    if (!course.inRoom(player, ROOM)) return false;
    if (course.isPassed(player, ROOM)) {
      // Ours: no capture talks to him after the room is passed; the passed line again.
      course.say(player, course.passLines(Math.min(course.passedCount(player), 3)).map((text) => ({ npc: NPC, text })));
      return true;
    }
    if (waits.get(player)?.counting) {
      interrupted(player);
      return true;
    }
    const wait = { counting: false, value: 1, stopped: false };
    waits.set(player, wait);
    player.getPacketSender().sendVarbit(COUNT_VARBIT, 1);
    // The count starts on the continue's tick (597); a closed chatbox starts it too.
    course.say(player, course.lines(course.variant(V_TALK)).map((line) => ({ npc: NPC, text: line.text })),
      () => startCounting(player, wait));
    course.whenChatClear(player, () => startCounting(player, wait));
    return true;
  }

  function startCounting(player, wait) {
    if (waits.get(player) !== wait || wait.stopped || wait.counting || !course.inRoom(player, ROOM)) return;
    wait.counting = true;
    const step = () => {
      if (waits.get(player) !== wait || wait.stopped || !course.inRoom(player, ROOM)) return;
      if (wait.value >= PASS_AT) {
        wait.counting = false;
        course.sayPassed(player, NPC, course.passRoom(player, ROOM));
        return;
      }
      wait.value++;
      player.getPacketSender().sendVarbit(COUNT_VARBIT, wait.value);
      if (wait.failing) {
        wait.stopped = true;
        course.fail(player, [{ npc: NPC, text: course.failLine() }]);
        return;
      }
      course.later(player, 1, step);
    };
    step();
  }

  /** Anything clicked while he counts: the count's next tick shows the failure. */
  function interrupted(player) {
    const wait = waits.get(player);
    if (!wait?.counting || wait.failing) return false;
    wait.failing = true;
    return true;
  }

  function onWalk(event) {
    interrupted(event.player);
  }

  function onAnything(event) {
    if (event.handled || !waits.get(event.player)?.counting) return;
    if (interrupted(event.player)) event.handled = true;
  }

  course.defineRoom(ROOM, { enter, clear });
  api.onNpcInteraction("Sir Tinley", { "Talk-to": talk });
  api.onWalkRoute(onWalk);
  api.onBeforeObjectInteraction(onAnything);
  api.onBeforeNpcInteraction(onAnything);
  api.onGroundItemPickup(onAnything);
  api.onItemAction(onAnything);

  return { waits };
};
