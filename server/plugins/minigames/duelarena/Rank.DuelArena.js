/**
 * A player's PvP Arena standing: the rank (Wiki: everyone starts at 2,500, Elo-style, here K 50,
 * which moves equal ranks the captured 25), the Arena Reward Points (16 a ranked win plus 1 per
 * win of the streak, 10 at most; 12 a loss; 15,000 at most), the win streak, the rank's title
 * (Wiki: Bronze to Rune in four steps of 250 per thousand, then Dragon, Dragon Elite, Dragon
 * Master, Dragon Grandmaster) and the week's ranked build (Wiki: rotated weekly).
 * Captured: pvpa_rank_points and pvpa_points_currency carry both on login and on each change.
 */
const Common = require("./Common.DuelArena");

const NUMERALS = ["I", "II", "III", "IV"];

function data() {
  return Common.data.ranked;
}

function rank(player) {
  const saved = player.getAttribute(Common.RANK_ATTRIBUTE);
  return Number.isFinite(saved) ? saved : data().startRank;
}

function setRank(player, value) {
  const next = Math.max(0, Math.min(data().maxRank, Math.round(value)));
  player.setAttribute(Common.RANK_ATTRIBUTE, next);
  Common.varbit(player, "pvpa_rank_points", next);
  return next;
}

function addRank(player, amount) {
  return setRank(player, rank(player) + amount);
}

function points(player) {
  return Common.number(player, Common.REWARD_POINTS_ATTRIBUTE);
}

function addPoints(player, amount) {
  const next = Math.min(data().pointsCap, points(player) + amount);
  player.setAttribute(Common.REWARD_POINTS_ATTRIBUTE, next);
  Common.varbit(player, "pvpa_points_currency", next);
  return next;
}

/** Elo's expected score of `a` against `b`. */
function expected(a, b) {
  return 1 / (1 + 10 ** ((b - a) / 400));
}

/** What a loss costs this player against that rank (the stake), and what a win gains. */
function stakeAgainst(own, other) {
  return Math.round(data().k * expected(own, other));
}

function gainAgainst(own, other) {
  return Math.round(data().k * (1 - expected(own, other)));
}

/** A ranked win's points: 16, plus the streak so far (10 at most); the streak goes on. */
function winPoints(player) {
  const streak = Common.number(player, Common.WIN_STREAK_ATTRIBUTE);
  player.setAttribute(Common.WIN_STREAK_ATTRIBUTE, streak + 1);
  return data().winPoints + Math.min(streak, data().streakBonusCap);
}

function endStreak(player) {
  player.setAttribute(Common.WIN_STREAK_ATTRIBUTE, 0);
}

function tierOf(value) {
  const tiers = data().tiers;
  let index = 0;
  for (let i = 0; i < tiers.length; i++) if (value >= tiers[i][1]) index = i;
  return tiers[index];
}

/** "Steel III" for 2,500 (Wiki's table). */
function title(value) {
  const [name, from] = tierOf(value);
  if (value >= data().numeralTiersBelow) return name;
  return `${name} ${NUMERALS[Math.min(3, Math.floor((value - from) / 250))]}`;
}

/** The week's ranked build (0 Max/Med, 1 Zerker, 2 1 Def Pure), the same on every world. */
function weeklyBuild(now = Date.now()) {
  const { from, builds } = data().rotation;
  const weeks = Math.floor((now - Date.parse(from)) / (7 * 24 * 60 * 60 * 1000));
  return builds[((weeks % builds.length) + builds.length) % builds.length];
}

function login({ player }) {
  Common.varbit(player, "pvpa_rank_points", rank(player));
  Common.varbit(player, "pvpa_points_currency", points(player));
}

/** The tier's icon on the board's Rank: its metal's scimitar (captured for Steel). */
function icon(value) {
  return Common.objId(tierOf(value)[2]) ?? -1;
}

/** The recruitment board's Rank (op 3), as captured: the line beside the tier's icon (objectbox). */
function showRank({ player }) {
  const { DialogueChainBuilder, ItemStatementDialogue } = Common.core;
  const value = rank(player);
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new ItemStatementDialogue(0, icon(value), Common.message("rankLine", { rank: value, title: title(value) })),
  ));
  return true;
}

function attachRank(api) {
  api.persistAttribute(Common.RANK_ATTRIBUTE, data().startRank);
  api.persistAttribute(Common.REWARD_POINTS_ATTRIBUTE, 0);
  api.persistAttribute(Common.WIN_STREAK_ATTRIBUTE, 0);
  api.onPlayerLogin(login);
  // By gameval id, not name: "Arena recruitment board" also has a View (767) that isn't modelled.
  api.onObjectThirdClick([Common.locId("pvpa_recruitment_board"), Common.locId("pvpa_recruitment_board02")].filter((id) => id != null), showRank);
}

module.exports = {
  attachRank, rank, setRank, addRank, points, addPoints, stakeAgainst, gainAgainst,
  expected, winPoints, endStreak, title, icon, weeklyBuild,
};
