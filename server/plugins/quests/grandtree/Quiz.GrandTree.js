/**
 * King Narnode's translation quiz (stage 20): five menus after "I think so!". The transcript's conditional
 * options read "If the player chose the previous options correctly/incorrectly:" and its closing branch "If the
 * player chose the correct/wrong options:", so the picks are kept for the conversation and those conditions are
 * answered from them. The runner resolves option conditions when a menu shows, so the third to fifth menus offer
 * five options (four in the last), as live does: rsprox capture local 1002189 ticks 10767-10787 shows the right
 * answers' menus with "None of the above." and without the "incorrectly" options. The right answers are the
 * Wiki's (The Grand Tree, "The dying tree": none, none, then the three lines of Hazelmere's message).
 */
const START = "I think so!";
const ANSWERS = [
  "None of the above.",
  "None of the above.",
  "A man came to me with the King's seal.",
  "I gave the man Daconia rocks.",
  "And Daconia rocks will kill the tree!",
];

module.exports = function createQuiz() {
  /** player -> { picks, correct } for the quiz in progress. */
  const quizzes = new WeakMap();

  function choose(player, option) {
    const text = String(option ?? "");
    if (text === START) {
      quizzes.set(player, { picks: 0, correct: true });
      return;
    }
    const quiz = quizzes.get(player);
    if (!quiz || quiz.picks >= ANSWERS.length) return;
    if (text !== ANSWERS[quiz.picks]) quiz.correct = false;
    quiz.picks++;
  }

  /** True/false for the quiz's conditions, null for any other text. */
  function answer(player, text) {
    const value = String(text ?? "").toLowerCase();
    const quiz = quizzes.get(player);
    const right = quiz ? quiz.correct : true;
    if (value.includes("chose the previous options correctly") || value.includes("chose the correct options")) return right;
    if (value.includes("chose the previous options incorrectly") || value.includes("chose the wrong options")) return !right;
    return null;
  }

  function clear(player) {
    quizzes.delete(player);
  }

  return { choose, answer, clear, ANSWERS };
};
