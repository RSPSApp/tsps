/**
 * Tai Bwo Wannai Cleanup: the villagers' favour, 0-1000 points saved per player and shown as a
 * percentage (favour_percentage is points / 10, rsprox 227/01858). vill_comm_max follows the
 * highest total and does not drop on a claim. The village_community_score overlay shows inside the
 * four map squares around the village once the player has started (it opened at the first favour
 * gain in 01858 and closed on leaving them). Other plugins read and spend it through custom
 * events ("tai-bwo-wannai-cleanup:favour", ":add-favour", ":spend-favour", in percent): My Arm's
 * Big Adventure takes 60% at Murcaily.
 */
const Common = require("./Common.TaiBwoWannaiCleanup");

const { ATTR } = Common;
/** The welcome screen's Play: the gameframe it re-boots needs the overlay again. */
const WELCOME_PLAY_BUTTON_UID = (378 << 16) | 72;
const points = (player) => Number(player.getAttribute(ATTR.POINTS)) || 0;
const percentage = (player) => Math.floor(points(player) / 10);

let area = null;

function send(player) {
  Common.varbit(player, "points", points(player));
  Common.varbit(player, "max", Number(player.getAttribute(ATTR.MAX)) || 0);
  Common.varbit(player, "favour", percentage(player));
}

function setPoints(player, value, quiet = false) {
  const total = Math.max(0, Math.min(Common.data.maxPoints, Math.floor(value)));
  player.setAttribute(ATTR.POINTS, total);
  if (total > (Number(player.getAttribute(ATTR.MAX)) || 0)) player.setAttribute(ATTR.MAX, total);
  if (!quiet) send(player);
}

/**
 * Adds `amount` points at once (so a logout can't lose them); the varbits and the cap message
 * follow `delay` ticks later, as the hack's do. At the cap the player is told to cash in instead.
 */
function gain(player, amount, delay = 0) {
  const before = points(player);
  const room = Common.data.maxPoints - before;
  const report = () => {
    send(player);
    if (amount > room) player.sendMessage(Common.message("favourFull"));
    showOverlay(player);
  };
  setPoints(player, before + amount, delay > 0);
  if (delay > 0) Common.later(player, delay, report);
  else report();
  Common.api.emitCustomEvent("tai-bwo-wannai-cleanup:favour-gained", { player, percentage: percentage(player) });
}

/** Spends `amount` points (a claim). */
function spend(player, amount) {
  setPoints(player, points(player) - amount);
}

const started = (player) => Common.progress(player) >= Common.data.progress.hacked || points(player) > 0;
const inVillage = (player) => area !== null && area.getBoundaries().some((bounds) => bounds.inside(player.getLocation()));

function showOverlay(player) {
  if (!started(player) || !inVillage(player) || player.getAttribute(ATTR.OVERLAY) === true) return;
  const cache = Common.core.CacheDefinitions;
  player.setAttribute(ATTR.OVERLAY, true);
  Common.varbit(player, "overlay", 1);
  player.getPacketSender().sendSubInterface(cache.getComponentId(Common.data.interfaces.hud), cache.getInterfaceId(Common.data.interfaces.overlay), 1);
}

function hideOverlay(player) {
  if (player.getAttribute(ATTR.OVERLAY) !== true) return;
  player.setAttribute(ATTR.OVERLAY, false);
  Common.varbit(player, "overlay", 0);
  player.getPacketSender().closeSubInterface(Common.core.CacheDefinitions.getComponentId(Common.data.interfaces.hud));
}

function createArea() {
  const { Area, Boundary } = Common.core;
  return new (class TaiBwoWannaiVillage extends Area {
    constructor() {
      super(Common.data.regions.map(([minX, maxX, minY, maxY]) => new Boundary(minX, maxX, minY, maxY, 0)));
    }
    getName() {
      return "Tai Bwo Wannai";
    }
    postEnter(mobile) {
      if (mobile.isPlayer?.()) showOverlay(mobile.getAsPlayer());
    }
    postLeave(mobile) {
      if (mobile.isPlayer?.()) hideOverlay(mobile.getAsPlayer());
    }
  })();
}

function sendOnLogin({ player }) {
  send(player);
  Common.varbit(player, "progress", Common.progress(player));
  // The login gameframe is replaced by the welcome screen's (desktop); mobile skips it.
  player.setAttribute(ATTR.OVERLAY, false);
  if (player.getAttribute("mobile-client") === true) showOverlay(player);
}

function showAfterWelcome({ player }) {
  player.setAttribute(ATTR.OVERLAY, false);
  showOverlay(player);
}

function answerFavour(request) {
  request.percentage = percentage(request.player);
}

function addFavour(request) {
  gain(request.player, Math.round(Number(request.percentage) * 10) || 0);
  request.handled = true;
}

function spendFavour(request) {
  spend(request.player, Math.round(Number(request.percentage) * 10) || 0);
  request.handled = true;
}

function attachFavour(api) {
  api.persistAttribute(ATTR.POINTS, 0);
  api.persistAttribute(ATTR.MAX, 0);
  api.persistAttribute(ATTR.PROGRESS, 0);
  area = createArea();
  api.registerArea(area);
  api.onPlayerLogin(sendOnLogin);
  api.onInterfaceActionButton(WELCOME_PLAY_BUTTON_UID, showAfterWelcome);
  api.onCustomEvent("tai-bwo-wannai-cleanup:favour", answerFavour);
  api.onCustomEvent("tai-bwo-wannai-cleanup:add-favour", addFavour);
  api.onCustomEvent("tai-bwo-wannai-cleanup:spend-favour", spendFavour);
}

module.exports = { attachFavour, gain, spend, points, percentage, showOverlay, hideOverlay, inVillage, area: () => area };
