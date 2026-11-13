// Lady Table's room (room 2): the twelve statues, one missing, then brought back in the dark.
//
// rsprox capture RecruitmentDrive.bin (revision 242.1), ticks 625-710, 1848-1977, 2718-2781,
// 2879-2940, 3512-3589 (times from the tick her first line shows, 2 ticks after arriving):
//   - rd_room_order (658) and rd_templock_2 (667) take the layout (12 and 7 in the captures); the
//     twelve rd_statue_multi locs (7290-7301) read 658, one of them showing nothing.
//   - Her four lines show at +0, +5, +10 and +15, none with a continue, and close at +18.
//   - At +38 "We will now dim the lights ..." with the fade out; at +43 658 goes back to 0 (every
//     statue shows) with "Please touch the statue you think has been added."; the fade in at +46.
//   - Touching the statue that was missing passes (rd_room2_complete 660, the observer's line);
//     any other fails.
//   - A talk once the statues are back: "What am I supposed to be doing again?" and her two
//     answers; after passing: "Very well done, [player name]. We might make a Temple Knight of you
//     yet." (tick 1924).
//   - The Wiki: talking to her holds the room change until the conversation is closed.
module.exports = function createTableRoom(api, course, ids) {
  const ROOM = 2;
  const NPC = ids.LADY_TABLE;
  const LAYOUT_VARBIT = 658; // rd_room_order
  const LAYOUT_COPY_VARBIT = 667; // rd_templock_2
  const FIRST_STATUE = 7290;
  const STATUES = 12;
  const V_ENTER = "the-tests-lady-table-entering-the-room";
  const V_AFTER = "the-tests-lady-table-after-waiting-10-seconds";
  const V_TALK = "the-tests-lady-table-talking-to-lady-table-after-the-statues-have-shuffled";
  const AFTER_PASS = "Very well done, [player name]. We might make a Temple Knight of you yet.";
  const LINE_GAP = 5;
  const CLOSE_AT = 18;
  const DIM_AT = 38;
  const REVEAL_AFTER_DIM = 5;
  const FADE_IN_AFTER_REVEAL = 3;

  /** Player -> { answer, revealed, talking } for the room. */
  const attempts = new WeakMap();

  function layoutAnswer(layout) {
    const statues = Array.from({ length: STATUES }, (_, i) => api.core.CacheDefinitions.getObject(FIRST_STATUE + i).transforms);
    const visible = statues.map((variants) => variants[layout < variants.length - 1 ? layout : variants.length - 1]);
    return statues.map((variants) => variants[0]).find((id) => !visible.includes(id));
  }

  function enter(player) {
    const layout = 1 + Math.floor((ids.random ?? Math.random)() * STATUES);
    const attempt = { answer: layoutAnswer(layout), revealed: false, talking: false };
    attempts.set(player, attempt);
    player.getPacketSender().sendVarbit(LAYOUT_VARBIT, layout).sendVarbit(LAYOUT_COPY_VARBIT, layout);
    const intro = course.lines(course.variant(V_ENTER));
    intro.forEach((line, index) => {
      const show = () => {
        if (attempts.get(player) === attempt && !attempt.talking) course.heldLine(player, NPC, line.text);
      };
      if (index === 0) show();
      else course.later(player, index * LINE_GAP, show);
    });
    course.later(player, CLOSE_AT, () => {
      if (!attempt.talking) course.closeChat(player);
    });
    course.later(player, DIM_AT, () => dim(player, attempt));
  }

  function dim(player, attempt) {
    if (attempts.get(player) !== attempt || !course.inRoom(player, ROOM)) return;
    if (attempt.talking) {
      course.whenChatClear(player, () => dim(player, attempt));
      return;
    }
    const [dimLine, touchLine] = course.lines(course.variant(V_AFTER));
    course.heldLine(player, NPC, dimLine.text);
    course.fade(player, true);
    course.later(player, REVEAL_AFTER_DIM, () => {
      if (attempts.get(player) !== attempt) return;
      attempt.revealed = true;
      player.getPacketSender().sendVarbit(LAYOUT_VARBIT, 0);
      course.heldLine(player, NPC, touchLine.text);
      course.later(player, FADE_IN_AFTER_REVEAL, () => {
        course.fade(player, false);
        course.whenChatClear(player, () => course.closeFade(player));
      });
    });
  }

  function clear(player) {
    attempts.delete(player);
  }

  function touch(event) {
    const { player, objectId, definition } = event;
    if (objectId < FIRST_STATUE || objectId >= FIRST_STATUE + STATUES) return false;
    if (!course.inRoom(player, ROOM)) return false;
    const attempt = attempts.get(player);
    if (!attempt?.revealed || course.isPassed(player, ROOM)) return true;
    if (definition?.id === attempt.answer) {
      course.sayPassed(player, NPC, course.passRoom(player, ROOM));
      return true;
    }
    course.fail(player, [{ npc: NPC, text: course.failLine() }]);
    return true;
  }

  function talk(event) {
    const { player } = event;
    const attempt = attempts.get(player);
    if (!course.inRoom(player, ROOM) || !attempt) return false;
    if (course.isPassed(player, ROOM)) {
      course.say(player, [{ npc: NPC, text: AFTER_PASS }]);
      return true;
    }
    const talkLines = course.lines(course.variant(V_TALK));
    attempt.talking = true;
    course.say(player, talkLines.map((line) => (line.player ? { player: line.player } : { npc: NPC, text: line.text })),
      () => { attempt.talking = false; });
    course.whenChatClear(player, () => { attempt.talking = false; });
    return true;
  }

  course.defineRoom(ROOM, { enter, clear });
  api.onObjectInteraction("Statue", { Touch: touch });
  api.onNpcInteraction("Lady Table", { "Talk-to": talk });

  return { layoutAnswer };
};
