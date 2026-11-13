// Sir Ren Itchood's room (room 5): the riddle and the door's four-letter combination lock.
//
// rsprox capture RecruitmentDrive.bin (revision 242.1), ticks 348-458, 2970-3011, 3138-3174:
//   - Arriving sets rd_templock_1 (666) to the answer (6 in all three runs, whose clue spells
//     LAST); Sir Ren greets the player with the clue menu, its clue answered by that word.
//   - "Can I have a different clue?" sets rd_templock_2 (667) to 1, after which the menu's second
//     option is "Can I have the final clue?" (667 = 2); a talk after the final clue plays the
//     player's "Can I have the final clue for the door?" and the final clue, with no menu (tick
//     437). "Can I have the clue for the door?" gives the latest clue (tick 423).
//   - The door (rd_room5_exitdoor 7323) opens rd_combolock (285): the letters rda..rdd (285:43-46)
//     start at "A", each arrow (47-54) moves its letter one step, Z wrapping to A, with the lever
//     sound (2400); rdenter (56) checks the word.
//   - Right: rd_room5_complete (663), the lock closes and "Your wit is sharp, ..." (with a continue).
//   - Wrong: "You have failed to solve the riddle." and "It's sad to say, ..." held for 3 ticks,
//     then the fade out (ticks 452-455).
module.exports = function createRenRoom(api, course, ids) {
  const ROOM = 5;
  const NPC = ids.SIR_REN_ITCHOOD;
  const ANSWER_VARBIT = 666; // rd_templock_1
  const CLUES_VARBIT = 667; // rd_templock_2
  const LOCK = 285; // rd_combolock
  const LETTERS = [43, 44, 45, 46]; // rda, rdb, rdc, rdd
  const LEFT = [47, 49, 51, 53]; // rda_left ...
  const RIGHT = [48, 50, 52, 54]; // rda_right ...
  const ENTER = 56; // rdenter
  const LEVER_SOUND = 2400;
  const uid = (child) => (LOCK << 16) | child;

  const V_ENTER = "the-tests-sir-ren-itchood-entering-the-room";
  const V_SECOND = "the-tests-sir-ren-itchood-talking-to-sir-ren-itchood-after-getting-the-second-clue";
  const V_DOOR = "the-tests-sir-ren-itchood-entering-the-combination-lock-door";
  const RIGHT_ID = "qNmbLN";
  const WRONG_ID = "lA3dy2";
  // The transcript's word order ("If the answer is word N:"), by the acrostic each clue spells.
  const WORDS = ["BITE", "TIME", "FISH", "MEAT", "LAST", "RAIN"];
  const FIRST_CLUES = ["Lcr4_8", "LgNNqJ", "QKLW3b", "pY2LFM", "RHR_7Q", "Cw4TJj"];
  const SECOND_CLUES = ["mSbRBW", "Is77SA", "5_H_K_", "biWU_y", "Lh8PMl", "OZ2kJM"];
  const FINAL_CLUES = ["H3nHTW", "mK3Jo7", "_YALpO", "7UhaJw", "wrry80", "byUNkj"];
  // rd_templock_1 for each word. The capture shows 6 = LAST only; ours: the other words take
  // 1-5 in the transcript's order.
  const VARBIT_BY_WORD = [1, 2, 3, 4, 6, 5];
  const CLUE_SETS = [FIRST_CLUES, SECOND_CLUES, FINAL_CLUES];

  /** Player -> { word, letters } for the room. */
  const states = new WeakMap();

  function state(player) {
    return states.get(player) ?? null;
  }

  function clues(player) {
    return player.getPacketSender().getVarbit(CLUES_VARBIT);
  }

  function enter(player) {
    const word = Math.floor((ids.random ?? Math.random)() * WORDS.length);
    states.set(player, { word, letters: [0, 0, 0, 0] });
    player.getPacketSender().sendVarbit(ANSWER_VARBIT, VARBIT_BY_WORD[word]);
    course.say(player, [{ npc: NPC, text: course.lines(course.variant(V_ENTER))[0].text }], () => clueMenu(player));
  }

  function clear(player) {
    states.delete(player);
    if (player.getInterfaceId?.() === LOCK) player.getPacketSender().sendInterfaceRemoval();
  }

  function clueText(player, set) {
    const word = state(player).word;
    return course.lines(course.findCondition(course.variant(set === 2 ? V_SECOND : V_ENTER), CLUE_SETS[set][word]))[0].text;
  }

  function sayClue(player, set, before = []) {
    course.say(player, [...before, { npc: NPC, text: clueText(player, set) }]);
  }

  function clueMenu(player) {
    const asked = clues(player);
    if (asked >= 2) {
      // Tick 437: no menu once the final clue is given.
      sayClue(player, 2, [{ player: "Can I have the final clue for the door?" }]);
      return;
    }
    const second = asked >= 1;
    api.sendMultiChatboxPrompt(player, "Select an option",
      "Can I have the clue for the door?", () => sayClue(player, asked),
      second ? "Can I have the final clue?" : "Can I have a different clue?", () => {
        player.getPacketSender().sendVarbit(CLUES_VARBIT, asked + 1);
        sayClue(player, asked + 1, [{ player: "I don't get that riddle..." },
          { player: second ? "Can I have the final clue for the door?" : "Can I have a different one?" }]);
      });
  }

  function talk(event) {
    const { player } = event;
    if (!course.inRoom(player, ROOM) || !state(player)) return false;
    if (course.isPassed(player, ROOM)) {
      course.say(player, [{ npc: NPC, text: doorLine(RIGHT_ID) }]);
      return true;
    }
    clueMenu(player);
    return true;
  }

  function doorLine(id) {
    return course.lines(course.findCondition(course.variant(V_DOOR), id))[0].text;
  }

  /** The door before the riddle is solved opens the lock. */
  function lockedDoor(player) {
    const current = state(player);
    if (!current) return false;
    current.letters = [0, 0, 0, 0];
    const sender = player.getPacketSender();
    LETTERS.forEach((child) => sender.sendString("A", uid(child)));
    sender.sendInterfaceScript(2524, [-1, -1]);
    sender.sendInterface(LOCK);
    return true;
  }

  function turn(event) {
    const { player, buttonId } = event;
    const current = state(player);
    if (!current || !course.inRoom(player, ROOM)) return false;
    const child = buttonId & 0xffff;
    const dial = LEFT.includes(child) ? LEFT.indexOf(child) : RIGHT.indexOf(child);
    const step = LEFT.includes(child) ? 25 : 1;
    current.letters[dial] = (current.letters[dial] + step) % 26;
    player.getPacketSender().sendSound(LEVER_SOUND, 255, 0)
      .sendString(String.fromCharCode(65 + current.letters[dial]), uid(LETTERS[dial]));
    return true;
  }

  function enterCode(event) {
    const { player } = event;
    const current = state(player);
    if (!current || !course.inRoom(player, ROOM)) return false;
    const entered = current.letters.map((letter) => String.fromCharCode(65 + letter)).join("");
    player.getPacketSender().sendInterfaceRemoval();
    if (entered === WORDS[current.word]) {
      const count = course.passRoom(player, ROOM);
      course.say(player, [{ npc: NPC, text: doorLine(RIGHT_ID) }], () => {
        if (count >= course.ROOMS_PER_RUN) course.finish(player);
      });
      return true;
    }
    player.sendMessage("You have failed to solve the riddle.");
    course.fail(player, [{ npc: NPC, text: doorLine(WRONG_ID) }], { heldTicks: 3 });
    return true;
  }

  function answerCondition({ npcId, player, stepId }) {
    if (npcId !== NPC || !player) return null;
    for (const set of CLUE_SETS) {
      const word = set.indexOf(stepId);
      if (word >= 0) return state(player)?.word === word;
    }
    return null;
  }

  course.defineRoom(ROOM, { enter, clear, lockedDoor });
  api.onNpcInteraction("Sir Ren Itchood", { "Talk-to": talk });
  api.onInterfaceActionButton([...LEFT, ...RIGHT].map(uid), turn);
  api.onInterfaceActionButton(uid(ENTER), enterCode);
  api.onNpcDialogueCondition(answerCondition);

  return { WORDS, VARBIT_BY_WORD, state };
};
