/**
 * The Soul Wars lobby, as recorded (rsprox 229/00668, 227/00078, 00129, 00079; soul-wars.json
 * `lobby`):
 * - the Soul Wars Portals in Edgeville and the Ferox Enclave bring players to the Nomad's camp;
 *   the leave portal asks "Where would you like to go?" (Edgeville / Ferox Enclave / Nowhere);
 * - the waiting-area barrier lets players in (not "while wearing something on your back") and out
 *   ("Are you sure you want to leave?");
 * - the lobby HUD (434) shows "N/20" below the minimum and the count above it, with the
 *   countdown; it runs 290 ticks once 20 wait, with "The next Soul Wars game will start shortly."
 *   20 ticks before the start.
 * Wiki: total level 500 and combat 40 to play, after the Nomad's demonstration; food, potions and followers aren't allowed in
 * the waiting area, nor are the poisoned. World config `SoulWars:minPlayers` lowers the minimum
 * for small worlds.
 */
const Common = require("./Common.SoulWars");
const Match = require("./Match.SoulWars");

const MIN_PLAYERS_CONFIG = "SoulWars:minPlayers";
const LEAVE_PORTAL = "soul_wars_leave_soulwars_portal";
const WAITING_BARRIER = "soul_wars_main_waiting_area_barrier";
const ENTRY_PORTALS = ["soul_wars_edgeville_portal", "soul_wars_enclave_portal"];

/** Players with the lobby HUD up. */
const hud = new Set();
/** The lobby's registered Area (so only its own players are looked at). */
let lobbyArea = null;
/** Who's in the lobby (the area's players; a test can swap it). */
const source = { players: () => lobbyArea?.getPlayers?.() ?? [] };
let countdown = null;
/** Bots (when a world seeds them): who they are, and filling the queue. */
const bots = { isBot: () => false, seed: () => {} };

/** The Wiki's 20, or a world's own (never under 2: a game needs both sides). */
function minPlayers() {
  const configured = Number(Common.api.getPluginConfig?.(MIN_PLAYERS_CONFIG, Common.data.minPlayers)) || Common.data.minPlayers;
  return Math.max(Common.data.minPlayersFloor, configured);
}

function locId(name) {
  return Common.core.CacheDefinitions.getLocId(name);
}

function inLobby(player) {
  const at = player.getLocation();
  return at.getZ() === 0 && Common.inBox(at, Common.data.lobby.bounds);
}

function waiting(player) {
  const at = player.getLocation();
  return at.getZ() === 0 && Common.inBox(at, Common.data.lobby.waiting) && !Match.gameOf(player);
}

function waitingPlayers() {
  return [...source.players()].filter((player) => player?.isRegistered?.() && waiting(player));
}

function enterPortal({ player, object }) {
  if (!ENTRY_PORTALS.some((name) => locId(name) === object?.getId())) return false;
  player.moveTo(Common.toLocation(Common.data.lobby.arrive));
  player.getPacketSender().sendSong?.(Common.data.music.lobby);
  return true;
}

function leaveTo(player, where) {
  closeHud(player);
  player.moveTo(Common.toLocation(Common.data.lobby[where]));
}

function leavePortal({ player, object, option }) {
  if (object?.getId() !== locId(LEAVE_PORTAL)) return false;
  if (option === "Edgeville") return leaveTo(player, "edgeville"), true;
  if (option === "Ferox Enclave") return leaveTo(player, "ferox"), true;
  Common.api.sendMultiChatboxPrompt(player, Common.message("leavePortal"),
    "Edgeville.", () => leaveTo(player, "edgeville"),
    "Ferox Enclave.", () => leaveTo(player, "ferox"),
    "Nowhere.", () => {});
  return true;
}

/** Why the player can't wait for a game, or null (the Wiki's rules, the recorded back-slot line). */
function refusal(player) {
  const { entry } = Common.data;
  const totalLevel = player.getSkillManager().getTotalLevel?.() ?? Infinity;
  const combat = player.getSkillManager().getCombatLevel?.() ?? 126;
  if (totalLevel < entry.totalLevel || combat < entry.combat) return Common.message("requirements");
  if (!require("./Tutorial.SoulWars").finished(player)) return Common.message("needTutorial");
  if (require("./Supplies.SoulWars").banned(player)) return Common.message("banned");
  if ((player.getPoisonDamage?.() ?? 0) > 0) return Common.message("poisoned");
  return restrictedItems(player);
}

/** A cape, food, potions or a follower: kept out of the waiting area and the demonstration. */
function restrictedItems(player) {
  const cape = player.getEquipment().getItems?.()[1];
  if (cape && cape.getId() > 0) return Common.message("backSlot");
  const restricted = player.getInventory().getValidItems?.().some((item) => {
    const actions = Common.core.CacheDefinitions.getItem(item.getId())?.inventoryActions ?? [];
    return actions.includes("Eat") || actions.includes("Drink");
  });
  if (restricted || player.getAttribute?.("pets:current")) return Common.message("restricted");
  return null;
}

/**
 * The waiting-area barrier, in the east wall of the area: in from the east, and out (after asking)
 * from inside, through the barrier's tile to the lobby side (227/00078: (2199,2841) to (2200,2842)).
 */
function barrier({ player, object }) {
  if (object?.getId() !== locId(WAITING_BARRIER)) return false;
  const [bx, by] = Common.data.lobby.barrier;
  if (waiting(player)) {
    Common.api.sendMultiChatboxPrompt(player, Common.message("leaveWaiting"),
      // The game can start while the question is open; Yes then must not walk them out of it.
      "Yes.", () => { if (waiting(player)) player.moveTo(new Common.core.Location(bx + 1, by, 0)); },
      "No.", () => {});
    return true;
  }
  const refused = refusal(player);
  if (refused) {
    player.sendMessage(refused);
    return true;
  }
  player.moveTo(new Common.core.Location(bx - 1, by, 0));
  return true;
}

function countdownText(left) {
  for (const [from, label] of [[200, "3 minutes"], [150, "2 minutes"], [100, "1 minute"], [50, "30 seconds"]]) {
    if (left >= from) return label;
  }
  return "10 seconds";
}

function openHud(player) {
  if (hud.has(player)) return;
  hud.add(player);
  player.getPacketSender().sendSubInterface(Common.component("toplevel_osrs_stretch:overlay_hud"), Common.core.CacheDefinitions.getInterfaceId("soul_wars_lobby"), 1);
}

function closeHud(player) {
  if (!hud.delete(player)) return;
  player.getPacketSender().closeSubInterface?.(Common.component("toplevel_osrs_stretch:overlay_hud"));
}

function tick() {
  const min = minPlayers();
  bots.seed(waitingPlayers(), min, source.players());
  const queued = waitingPlayers();
  if (!Match.current && queued.length >= min && countdown === null) countdown = Common.data.countdownTicks;
  if (countdown !== null && (queued.length < min || Match.current)) countdown = null;
  if (countdown !== null) {
    countdown--;
    if (countdown === Common.data.shortlyAt) for (const player of queued) player.sendMessage(Common.message("shortly"));
    if (countdown <= 0) {
      countdown = null;
      // Whatever they've put on or picked up while waiting is checked again (a cape would be lost).
      const ready = queued.filter((player) => {
        const refused = bots.isBot(player) ? null : refusal(player);
        if (refused) player.sendMessage(refused);
        return !refused;
      });
      if (ready.length >= min) {
        for (const player of ready) closeHud(player);
        new Match.Game(ready).start();
      }
    }
  }
  const players = queued.length >= min ? String(queued.length) : `${queued.length}/${min}`;
  const time = countdown === null ? "-" : countdownText(countdown);
  for (const player of source.players()) {
    if (!player?.isRegistered?.()) continue;
    if (!inLobby(player) || Match.gameOf(player)) {
      closeHud(player);
      continue;
    }
    openHud(player);
    Common.text(player, "soul_wars_lobby:players_text", players);
    Common.text(player, "soul_wars_lobby:time_text", time);
  }
}

function forget({ player }) {
  hud.delete(player);
}

function lobbyAreaClass() {
  return class SoulWarsLobby extends Common.core.Area {
    getName() {
      return "Soul Wars lobby";
    }

    postEnter(mobile) {
      if (mobile.isPlayer?.()) openHud(mobile.getAsPlayer());
    }

    postLeave(mobile) {
      if (mobile.isPlayer?.()) closeHud(mobile.getAsPlayer());
    }
  };
}

function allowBountyHunterWeapons(event) {
  const game = Match.gameOf(event.attacker);
  if (game && !game.over && event.attacker.getPrivateArea() === game.area
    && event.target.getPrivateArea() === game.area) event.allowed = true;
}

function attachLobby(api) {
  const [x0, y0, x1, y1] = Common.data.lobby.bounds;
  lobbyArea = new (lobbyAreaClass())([new Common.core.Boundary(x0, x1, y0, y1, 0)]);
  api.registerArea(lobbyArea);
  api.onObjectInteraction("Soul Wars Portal", { Enter: enterPortal });
  api.onObjectInteraction("Portal", { Enter: leavePortal, Edgeville: leavePortal, "Ferox Enclave": leavePortal });
  api.onObjectInteraction("Barrier", { Pass: barrier });
  api.onPlayerLogout(forget);
  api.onCustomEvent("bounty-hunter:weapon-area", allowBountyHunterWeapons);
  Common.every(tick);
}

module.exports = { attachLobby, tick, refusal, restrictedItems, barrier, countdownText, waitingPlayers, minPlayers, source, bots };
