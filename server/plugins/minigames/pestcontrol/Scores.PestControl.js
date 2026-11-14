/**
 * The outpost's Score board (`pest_scores`, loc 27780, "View"): how many games the player has
 * won on each lander (Wiki, Score board (Pest Control): "It shows the amount of times the
 * player has won the minigame").
 *
 * rsprox.net recordings 4006 (ticks 3050, 3084) and 4009 (tick 15408), rev 237: View sets the
 * busy varbit (12393) to 1, runs `toplevel_mainmodal_open` [-1, -1], opens `pest_scores`
 * (628) as the main modal and writes the three counts as bare numbers to `pest_scores:novice`
 * (628:8), `:intermediate` (628:9) and `:veteran` (628:10), in that order (4006 tick 3061,
 * 4009 tick 15412). Closing it sets busy back to 0 (recording 4006 tick 3071).
 *
 * Ours: a game counts when it is won and rewarded ("pest-control:won"); whether live also
 * counts a win the Void Knights refused to reward for inactivity isn't captured.
 */
const WINS_ATTRIBUTE = "pest-control:wins";
const SCORES_INTERFACE = 628;
/** pest_scores:novice / :intermediate / :veteran, by boat key. */
const SCORE_COMPONENTS = { novice: 8, intermediate: 9, veteran: 10 };
const MAIN_MODAL = (161 << 16) | 16;
const BUSY_VARBIT = 12393;
const SCRIPT_MAINMODAL_OPEN = 2524;

function getWins(player) {
  const stored = player?.getAttribute?.(WINS_ATTRIBUTE);
  const wins = {};
  for (const key of Object.keys(SCORE_COMPONENTS)) {
    const value = Math.trunc(Number(stored?.[key]));
    wins[key] = Number.isFinite(value) && value > 0 ? value : 0;
  }
  return wins;
}

function addWin(player, boatKey) {
  if (!(boatKey in SCORE_COMPONENTS)) return;
  const wins = getWins(player);
  wins[boatKey] += 1;
  player.setAttribute(WINS_ATTRIBUTE, wins);
}

function openScores(player) {
  const wins = getWins(player);
  const sender = player.getPacketSender();
  sender.sendVarbit(BUSY_VARBIT, 1);
  sender.sendInterfaceScript(SCRIPT_MAINMODAL_OPEN, [-1, -1]);
  player.setInterfaceId(SCORES_INTERFACE);
  sender.sendSubInterface(MAIN_MODAL, SCORES_INTERFACE, 0);
  for (const [key, component] of Object.entries(SCORE_COMPONENTS)) {
    sender.sendString(String(wins[key]), (SCORES_INTERFACE << 16) | component);
  }
}

function closed({ player, interfaceId }) {
  if (interfaceId === SCORES_INTERFACE) player.getPacketSender().sendVarbit(BUSY_VARBIT, 0);
}

function attachScores(api) {
  api.persistAttribute(WINS_ATTRIBUTE, {});
  // Cache: only the outpost's board (27780) is a "Score board" with View; CoX's has Read.
  api.onObjectInteraction("Score board", { View: ({ player }) => openScores(player) });
  api.onCustomEvent("pest-control:won", ({ player, boat }) => addWin(player, boat));
  api.onCustomEvent("interface:closed", closed);
}

module.exports = {
  WINS_ATTRIBUTE,
  SCORES_INTERFACE,
  SCORE_COMPONENTS,
  BUSY_VARBIT,
  attachScores,
  getWins,
  addWin,
  openScores,
};
