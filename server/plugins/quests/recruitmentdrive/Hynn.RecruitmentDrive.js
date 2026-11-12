// Ms. Hynn Terprett's room (room 7): one of five riddles.
//
// rsprox capture RecruitmentDrive.bin (revision 242.1), ticks 736-778, 932-964, 2468-2510, 2853-2879:
//   - Arriving sets rd_templock_2 (667) to the riddle: 5 the fingers riddle, 1 the husband and
//     daughter, 3 the captive's fate. She greets the player and asks it straight away.
//   - The number riddles end in the count prompt "Enter amount:" (script 108); 10 passes the husband
//     riddle (ticks 947, 2870), 1,111 fails the fingers riddle (tick 772).
//   - The captive's fate is a menu, "Select your fate"; "The wolves." passes (tick 2497).
//   - Passing sets rd_room7_complete (665) with the observer's line; failing is the failure line.
//   - A talk before answering asks the same riddle again from the greeting (tick 2487); after
//     passing she says "You certainly have the wits to be a Temple Knight. ..." (tick 2500).
module.exports = function createHynnRoom(api, course, ids) {
  const ROOM = 7;
  const NPC = ids.MS_HYNN_TERPRETT;
  const RIDDLE_VARBIT = 667; // rd_templock_2
  const V_ENTER = "the-tests-ms-hynn-terprett-entering-the-room";
  const AFTER_PASS = "You certainly have the wits to be a Temple Knight. Pass on through the portal to find your next challenge.";

  // In the transcript's order. `varbit`: rd_templock_2; the capture shows 5, 1 and 3, ours: 2 and 4.
  const RIDDLES = [
    { id: "I6CCMw", varbit: 5, amount: 0 }, // fingers on everything's left hand
    { id: "JkOLon", varbit: 1, amount: 10 }, // husband and daughter
    { id: "PesVic", varbit: 2, answer: "The number of false statements here is three." },
    { id: "HUY9QS", varbit: 3, answer: "The wolves." },
    { id: "MrB8X8", varbit: 4, answer: "Bucket A (32 degrees)" },
  ];

  const riddles = new WeakMap();

  function enter(player) {
    const riddle = Math.floor((ids.random ?? Math.random)() * RIDDLES.length);
    riddles.set(player, riddle);
    player.getPacketSender().sendVarbit(RIDDLE_VARBIT, RIDDLES[riddle].varbit);
    ask(player);
  }

  function clear(player) {
    riddles.delete(player);
    if (player.getEnteredAmountAction?.()?.riddle === true) player.setEnteredAmountAction(null);
  }

  function ask(player) {
    const riddle = RIDDLES[riddles.get(player)];
    const steps = course.variant(V_ENTER);
    const branch = course.findCondition(steps, riddle.id);
    const entries = [course.lines(steps)[0], ...course.lines(branch)].map((line) => ({ npc: NPC, text: line.text }));
    course.say(player, entries, () => {
      if (!course.inRoom(player, ROOM) || course.isPassed(player, ROOM)) return;
      if (riddle.amount !== undefined) askAmount(player, riddle);
      else askChoice(player, riddle, branch.find((step) => step.type === "choice"));
    });
  }

  function askAmount(player, riddle) {
    player.setEnteredAmountAction({
      acceptsZero: true,
      riddle: true,
      execute: (amount) => answer(player, Number(amount) === riddle.amount),
    });
    player.getPacketSender().sendEnterAmountPrompt("Enter amount:");
  }

  function askChoice(player, riddle, choice) {
    const pairs = [];
    for (const option of choice.options) pairs.push(option.text, () => answer(player, option.text === riddle.answer));
    api.sendMultiChatboxPrompt(player, choice.prompt, ...pairs);
  }

  function answer(player, right) {
    if (!course.inRoom(player, ROOM) || course.isPassed(player, ROOM)) return;
    if (right) {
      course.sayPassed(player, NPC, course.passRoom(player, ROOM));
      return;
    }
    course.fail(player, [{ npc: NPC, text: course.failLine() }]);
  }

  function talk(event) {
    const { player } = event;
    if (!course.inRoom(player, ROOM) || !riddles.has(player)) return false;
    if (course.isPassed(player, ROOM)) course.say(player, [{ npc: NPC, text: AFTER_PASS }]);
    else ask(player);
    return true;
  }

  course.defineRoom(ROOM, { enter, clear });
  api.onNpcInteraction("Ms. Hynn Terprett", { "Talk-to": talk });

  return { RIDDLES };
};
