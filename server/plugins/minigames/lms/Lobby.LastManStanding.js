/**
 * The Last Man Standing lobby in the Ferox Enclave, as captured (rsprox 20261026T161730):
 * - Lisa (br_host, a multinpc on varbit br_tutorial): her introduction ("Tell me more.") ends on
 *   "Now that you know more, would you like to take part in a game of Last Man Standing?", which
 *   sets br_tutorial and the rank 500; then "I'd like to play." -> "Which mode would you like to
 *   play?" (High Stakes struck through while it isn't running, Competitive (free entry), Casual,
 *   Cancel); a mode puts the player in its waiting area (Competitive: varbit br_mode_selected 1).
 *   Her Join option asks for the mode straight away (inferred);
 * - each mode's barrier (Competitive on the ground floor, Casual on the first, High Stakes on the
 *   second) lets a briefed player in ("You haven't completed the Last Man Standing introduction,
 *   please talk to Lisa before entering a game." otherwise) and out after "Forfeit - Are you
 *   sure?" (Yes. / No.);
 * - the lobby overlay (333) shows the rank ("Novice (500)"), the coffer and each mode's queue
 *   ("(13/24)", recoloured while the player waits in it), refreshed every 5 ticks; each mode's
 *   wizard calls "Come on, we need 5 more competitive participants!" ("... High Stakes
 *   participants!");
 * - a game starts as the last player it needs arrives;
 * - the scoreboard: "Wins: 1", "Kills: 5", "Games played: 8" (395 in the chatbox).
 * Wiki: Casual starts with 4; Competitive and High Stakes need a total level of 750 and 30 quest
 * points, or 1,500; Competitive only on members' worlds; no High Stakes for Ironmen; three
 * forfeits in a day bar both for the rest of the day. World config `LastManStanding:minPlayers`
 * lowers the 24 for small worlds, and `LastManStanding:highStakes` runs High Stakes.
 */
const Common = require("./Common.LastManStanding");
const Profile = require("./Profile.LastManStanding");
const Match = require("./Match.LastManStanding");
const Coffer = require("./Coffer.LastManStanding");
const Stash = require("./Stash.LastManStanding");
const QuestRuntime = require("../../quests/QuestRuntime");

const MIN_PLAYERS_CONFIG = "LastManStanding:minPlayers";
const HIGH_STAKES_CONFIG = "LastManStanding:highStakes";
const QUEUED_COLOUR = 992;
const IDLE_COLOUR = 32767;
const LISA_HEAD = "br_host_main";
const LISA_FORMS = ["br_host", "br_host_tutorial", "br_host_main"];
const DAY_MS = 24 * 60 * 60 * 1000;

/** Players with the lobby overlay up. */
const overlay = new Set();
/**
 * Players in the map squares the lobby is in. The lobby is inside the Ferox Enclave's own Area
 * (which holds its players first), so it is followed per map square instead.
 */
const nearby = new Set();
let clock = 0;
/** Who is near the lobby (a test can swap it). */
const source = { players: () => [...nearby] };
/** Bots (when the world seeds them). */
const bots = { seed: () => {}, tidy: () => {}, isBot: () => false };

const modes = () => Common.data.modes;
const modeOf = (key) => modes().find((mode) => mode.key === key) ?? null;

function minPlayers(mode = modeOf("competitive")) {
  const configured = Number(Common.api.getPluginConfig(MIN_PLAYERS_CONFIG, mode.minPlayers)) || mode.minPlayers;
  return Math.max(Common.data.minPlayersFloor, Math.min(mode.minPlayers, configured));
}

function highStakesOpen() {
  return Common.api.getPluginConfig(HIGH_STAKES_CONFIG, false) === true;
}

/** The mode whose waiting area the player stands in, or null. */
function waitingMode(player) {
  if (Match.gameOf(player)) return null;
  const at = player.getLocation();
  return modes().find((mode) => at.getZ() === mode.plane && Common.inBox(at, mode.waiting)) ?? null;
}

function waiting(player, mode) {
  const there = waitingMode(player);
  return mode ? there === mode : there != null;
}

function queued(mode = modeOf("competitive")) {
  return source.players().filter((player) => player?.isRegistered?.() !== false && waitingMode(player) === mode);
}

// ---------------------------------------------------------------- Lisa

/** Pages of [speaker, text]; then a menu ([text, action] pairs) or `done`. */
function talk(player, pages, { menu, done, title } = {}) {
  const { DialogueChainBuilder, NpcDialogue, PlayerDialogue, StatementDialogue, ActionDialogue, OptionDialogue } = Common.core;
  const manager = player.getDialogueManager();
  const chain = new DialogueChainBuilder();
  let index = 0;
  for (const [speaker, text] of pages) {
    if (speaker === "player") chain.add(new PlayerDialogue(index++, text));
    else if (speaker === "box") chain.add(new StatementDialogue(index++, text));
    else chain.add(new NpcDialogue(index++, Common.npcId(LISA_HEAD), text, speaker));
  }
  if (menu) {
    const options = new OptionDialogue(index++, {
      executeOption(option) {
        player.getPacketSender().sendInterfaceRemoval();
        menu[Number(option) - 1]?.[1]();
      },
    }, ...menu.map(([text]) => text));
    if (title) options.setTitle(title);
    chain.add(options);
  } else {
    chain.add(new ActionDialogue(index++, {
      execute: () => {
        manager.reset();
        player.getPacketSender().sendInterfaceRemoval();
        done?.();
      },
    }));
  }
  manager.startDialogues(chain);
}

const LISA = "Lisa";
const WELCOME = "Welcome, are you looking to take part in a game of Last Man Standing?";
const BRIEFING = [
  ["player", "Tell me more."],
  [LISA, "It's simple. Anyone looking to participate enters the relevant waiting area. Once the waiting area has enough people, they are taken to the arena."],
  ["player", "Arena?"],
  [LISA, "Indeed. We have set up two arenas on another plane. When a game starts, we pick one at random. Once everyone arrives in the arena, the fight for survival begins."],
  [LISA, "Now, there's a few important things to be aware of. While in an arena, your physical and mental abilities will be boosted. Also, praying to the gods will not cost you any precious energies."],
  [LISA, "After a game has started, lethal fog will soon start filling the arena. This forces contenders to a designated safe zone and ensures no one escapes the fighting."],
  [LISA, "Be aware, you can't take any of your own belongings into the game. Instead, you can use only what you find in the arena, including anything we give you on arrival."],
  [LISA, "Regarding what you are given on arrival, you have a few options to pick from. Use my supply chest to configure your load-outs for the different battle styles."],
  [LISA, "Remember, this is a solo competition! Anyone attempting to form teams for an unfair advantage will be banished from further participation."],
];

function notNow(player) {
  talk(player, [["player", "Not right now."], [LISA, "No problem, come back if you happen to change your mind."]]);
}

function tellMore(player) {
  talk(player, BRIEFING, {
    done: () => {
      Profile.finishTutorial(player);
      talk(player, [[LISA, "Now that you know more, would you like to take part in a game of Last Man Standing?"]], {
        menu: [["I'd like to play.", () => play(player)], ["Not right now.", () => notNow(player)]],
      });
    },
  });
}

function play(player) {
  talk(player, [["player", "I'd like to play."], [LISA, "Which mode would you like to play?"]], { done: () => chooseMode(player) });
}

/** The captured menu: High Stakes, Competitive, Casual, Cancel (High Stakes struck while closed). */
function chooseMode(player) {
  Profile.sendLoadouts(player);
  const entry = (key) => {
    const mode = modeOf(key);
    const struck = key === "highstakes" && !highStakesOpen();
    return [struck ? `<str>${mode.menu}</str>` : mode.menu, () => enterWaiting(player, mode, null)];
  };
  talk(player, [], { menu: [entry("highstakes"), entry("competitive"), entry("casual"), ["Cancel", () => {}]] });
}

function talkToLisa({ player }) {
  if (!Profile.tutorialDone(player)) {
    talk(player, [[LISA, WELCOME]], { menu: [["Tell me more.", () => tellMore(player)], ["Not right now.", () => notNow(player)]] });
    return true;
  }
  talk(player, [[LISA, WELCOME]], {
    menu: [["I'd like to play.", () => play(player)], ["Tell me more.", () => tellMore(player)], ["Not right now.", () => notNow(player)]],
  });
  return true;
}

function joinLisa({ player }) {
  if (!Profile.tutorialDone(player)) return talkToLisa({ player });
  chooseMode(player);
  return true;
}

// ---------------------------------------------------------------- entry rules

function forfeitsToday(player) {
  const record = player.getAttribute(Common.ATTRIBUTES.forfeits);
  if (!record || Date.now() - record.since > DAY_MS) return 0;
  return record.count;
}

/** A forfeit in a ranked game counts towards the day's three (Wiki). */
function forfeited(player) {
  const record = player.getAttribute(Common.ATTRIBUTES.forfeits);
  const fresh = !record || Date.now() - record.since > DAY_MS;
  player.setAttribute(Common.ATTRIBUTES.forfeits, { since: fresh ? Date.now() : record.since, count: (fresh ? 0 : record.count) + 1 });
}

function isIronman(player) {
  const query = { player, mode: "none" };
  Common.api.emitCustomEvent("ironman:mode", query);
  return query.mode !== "none";
}

/** Why a player can't wait for a mode, or null. */
function refusal(player, mode) {
  if (!Profile.tutorialDone(player)) return { box: Common.message("introNeeded") };
  if (bots.isBot(player) || !mode.ranked) return null;
  if (forfeitsToday(player) >= Common.data.forfeitsPerDay) return { line: Common.message("forfeited", { mode: mode.name }) };
  const { totalLevel, questPoints, totalLevelAlone } = Common.data.requirements;
  const total = player.getSkillManager().getTotalLevel();
  const points = Number(player.getAttribute(QuestRuntime.QUEST_POINTS_ATTRIBUTE)) || 0;
  if (total < totalLevelAlone && (total < totalLevel || points < questPoints)) return { line: Common.message("requirements", { mode: mode.name }) };
  if (mode.key === "competitive" && Common.core.WorldDefinition.isMembersWorld() === false) return { line: Common.message("membersOnly") };
  if (mode.key === "highstakes") {
    if (!highStakesOpen()) return { line: Common.message("highStakesClosed") };
    if (isIronman(player)) return { line: Common.message("ironman") };
    if (!Coffer.canPay(player, mode.fee)) return { line: Common.message("needFee") };
  }
  return null;
}

function refuse(player, refused) {
  if (refused.box) talk(player, [["box", refused.box]]);
  else player.sendMessage(refused.line);
}

/** Into a mode's waiting area, beside the barrier tile they used (captured). */
function enterWaiting(player, mode, x) {
  const refused = refusal(player, mode);
  if (refused) {
    refuse(player, refused);
    return;
  }
  if (mode.selected != null) Common.varbit(player, "br_mode_selected", mode.selected);
  const at = x ?? Common.randomInt(...Common.data.lobby.entryX);
  player.moveTo(new Common.core.Location(at, mode.insideY, mode.plane));
  // Everyone waits empty-handed; their things come back as they leave or after their game.
  Stash.save(player);
}

/** Out through the barrier: their own things back. */
function leaveWaiting(player, mode, x) {
  player.moveTo(new Common.core.Location(x, mode.outsideY, mode.plane));
  Stash.restore(player);
}

function barrier({ player, object }) {
  const id = object?.getId?.();
  const mode = modes().find((candidate) => Common.locId(candidate.entrance) === id);
  if (!mode) return false;
  const x = object?.getLocation?.().getX?.() ?? player.getLocation().getX();
  if (waiting(player, mode)) {
    Common.api.sendMultiChatboxPrompt(player, Common.message("forfeit"),
      // The game can start while the question is open; Yes then leaves nothing (their stash is the game's to give back).
      "Yes.", () => { if (waiting(player, mode)) leaveWaiting(player, mode, x); },
      "No.", () => {});
    return true;
  }
  enterWaiting(player, mode, x);
  return true;
}

// ---------------------------------------------------------------- the overlay

function cofferText(player) {
  const coins = Profile.coffer(player);
  if (coins <= 0) return "Empty";
  return coins >= 1000000 ? `${Math.floor(coins / 100000) / 10}M` : `${Math.floor(coins / 1000)}K`;
}

function openOverlay(player) {
  if (!overlay.has(player)) {
    overlay.add(player);
    player.getPacketSender().sendSubInterface(Common.component("toplevel_osrs_stretch:overlay_hud"), Common.interfaceId("br_lobbyoverlay"), 1);
  }
  refreshOverlay(player);
}

function closeOverlay(player) {
  if (!overlay.delete(player)) return;
  player.getPacketSender().closeSubInterface(Common.component("toplevel_osrs_stretch:overlay_hud"));
}

function refreshOverlay(player, counts = null) {
  if (!overlay.has(player)) return;
  const sender = player.getPacketSender();
  const mine = waitingMode(player);
  Common.text(player, "br_lobbyoverlay:rank", Common.rankText(Common.rankOf(player)));
  Common.text(player, "br_lobbyoverlay:coffer_amount", cofferText(player));
  for (const mode of modes()) {
    const count = counts?.get(mode) ?? queued(mode).length;
    Common.text(player, `br_lobbyoverlay:${mode.overlay}`, `(${count}/${minPlayers(mode)})`);
    sender.sendInterfaceColour(Common.component(`br_lobbyoverlay:${mode.overlay}`), mine === mode ? QUEUED_COLOUR : IDLE_COLOUR);
  }
}

/** A mode's wizard calls for players (captured line), when someone waits for more. */
function shout(mode, count, min) {
  const id = Common.npcId(mode.wizard);
  const wizard = Common.core.World.getNpcs().search((npc) => npc?.getId() === id);
  wizard?.forceChat(Common.message("wizardNeed", { n: min - count, mode: mode.shout }));
}

/** A full waiting area becomes a game; High Stakes players pay as it starts. */
function startGame(mode, queue) {
  let players = queue.slice(0, mode.maxPlayers);
  if (mode.fee) {
    players = players.filter((player) => {
      if (bots.isBot(player) || Coffer.pay(player, mode.fee)) return true;
      player.sendMessage(Common.message("needFee"));
      return false;
    });
    if (players.length < minPlayers(mode)) return;
  }
  for (const player of players) closeOverlay(player);
  new Match.Game(players, mode).start();
}

function tick() {
  clock++;
  const about = source.players().filter((player) => !Match.gameOf(player));
  const counts = new Map();
  for (const mode of modes()) {
    const min = minPlayers(mode);
    bots.seed(mode, queued(mode), min);
    const queue = queued(mode);
    if (queue.length >= min) {
      startGame(mode, queue);
      counts.set(mode, queued(mode).length);
      continue;
    }
    counts.set(mode, queue.length);
    if (queue.length > 0 && clock % Common.data.lobby.shoutEvery === 0) shout(mode, queue.length, min);
  }
  bots.tidy(about);
  const refresh = clock % Common.data.lobby.overlayEvery === 0;
  for (const player of source.players()) {
    if (!player?.isRegistered?.() || player.isPlayerBot?.()) continue;
    returnBelongings(player);
    const here = player.getLocation();
    const inLobby = !Match.gameOf(player) && here.getZ() <= 2 && Common.inBox(here, Common.data.lobby.bounds);
    if (!inLobby) closeOverlay(player);
    else if (!overlay.has(player)) openOverlay(player);
    else if (refresh) refreshOverlay(player, counts);
  }
}

/**
 * Someone out of the waiting areas some other way (a teleport) with their things still held: they
 * come back, as they would through the barrier.
 */
function returnBelongings(player) {
  if (!Stash.stashed(player) || waitingMode(player) || Match.gameOf(player) || player.isDyingReturn?.() === true) return;
  Stash.restore(player);
}

/** Whether a location's map square overlaps the lobby. */
function nearLobby(location) {
  const [x0, y0, x1, y1] = Common.data.lobby.bounds;
  const sx = location.getX() >> 6;
  const sy = location.getY() >> 6;
  return sx >= x0 >> 6 && sx <= x1 >> 6 && sy >= y0 >> 6 && sy <= y1 >> 6;
}

function follow({ player, location }) {
  const at = location ?? player?.getLocation?.();
  if (!player || !at) return;
  if (nearLobby(at)) nearby.add(player);
  else {
    nearby.delete(player);
    closeOverlay(player);
  }
}

// ---------------------------------------------------------------- scoreboard

function scoreboard({ player }) {
  const sender = player.getPacketSender();
  Common.text(player, "br_scoreboard:wins", `Wins: ${Common.number(player, Common.ATTRIBUTES.wins)}`);
  Common.text(player, "br_scoreboard:kills", `Kills: ${Common.number(player, Common.ATTRIBUTES.kills)}`);
  Common.text(player, "br_scoreboard:games", `Games played: ${Common.number(player, Common.ATTRIBUTES.games)}`);
  sender.sendSubInterface(Common.component("chatbox:chatmodal"), Common.interfaceId("br_scoreboard"), 0);
  return true;
}

/** Lisa's ids: the multinpc and both of her forms. */
function lisaIds() {
  return LISA_FORMS.map(Common.npcId);
}

function entranceIds() {
  return modes().map((mode) => Common.locId(mode.entrance));
}

function forget({ player }) {
  overlay.delete(player);
  nearby.delete(player);
}

/** Captured: a teleport cast in a waiting area is refused, "Please use the door if you need to leave." */
function canTeleport(event) {
  if (!waiting(event.player)) return;
  event.allow = false;
  event.player.sendMessage(Common.message("useDoor"));
}

function attachLobby(api) {
  api.persistAttribute(Common.ATTRIBUTES.forfeits, null);
  api.onPlayerMapSquareChange(follow);
  api.onPlayerLogin(follow);
  api.onNpcFirstClick(lisaIds(), talkToLisa);
  api.onNpcThirdClick(lisaIds(), joinLisa);
  api.onObjectFirstClick(entranceIds(), barrier);
  api.onCanTeleport(canTeleport);
  api.onObjectFirstClick([Common.locId("br_scoreboard")], scoreboard);
  api.onPlayerLogout(forget);
  Common.every(tick);
}

module.exports = {
  canTeleport,
  attachLobby, follow, openOverlay, closeOverlay, refreshOverlay, queued, minPlayers, talk, source, bots, waiting, waitingMode,
  modeOf, refusal, forfeited, forfeitsToday, tick,
};
