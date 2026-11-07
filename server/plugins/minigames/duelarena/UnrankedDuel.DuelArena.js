/**
 * PvP Arena unranked duels: the challenge and the duel screen, as captured (rsprox
 * 20261106T111454, 20261107T010112, 20261107T022508, world 578):
 * - Challenge on a player: "Challenging <name>..." (trade), and they get "<name> is inviting
 *   you to an unranked duel." (chalreq_trade); their Challenge back opens the duel screen
 *   (pvp_arena_unrankedduel, 757) for both, with "As this is an unofficial duel, you will not
 *   receive rank or reward points for participating.";
 * - step 1, the build (pvpa_unrankedduel_transmit_progress 1, _caneditbuild 1, _battletype
 *   1005): the build is the pair's, so either one changing it (buildtypes) changes it for both,
 *   clears both acceptances, and the other is shown the change (script 6213 holds their accept
 *   button); build_confirm accepts it (pvpa_unrankedduel_transmit_iacceptbuild);
 * - step 2, the load-outs (progress 2): each sees the other's load-out for the build (its
 *   spellbook and inv 207, then script 6200) and may edit their own column of it; opponent_copy
 *   copies theirs; opponent_confirm accepts (..._iacceptloadout); both accepted, the fight
 *   starts (Battle);
 * - closing the screen: "Cancelling challenge." to the one who closed it, "<name> has
 *   cancelled the challenge." to the other, whose screen closes too.
 * On a normal world Challenge first asks which duel: an unranked one, or the Legacy Duel
 * (DuelArena.plugin.js keeps that one). Not captured: how long a challenge stands (a minute here)
 * and whether editing a load-out clears the acceptances (it does here, as trades do).
 */
const Common = require("./Common.DuelArena");
const Loadouts = require("./Loadouts.DuelArena");
const Battle = require("./Battle.DuelArena");

const SCREEN = "pvp_arena_unrankedduel";
const PVP_ARENA_WORLD = "DuelArena:pvpArenaWorld";
const PARTNER_SCRIPT = 209;
const BUILD_CHANGED_SCRIPT = 6213;
const BUILD_CHANGED_HOLD = 5;
const LOADOUTS_SHOWN_SCRIPT = 6200;

/** Unranked challenges made: challenger -> { target, expires }. */
const invites = new Map();
/** Duel screens open: player -> session. */
const sessions = new Map();
/** The Legacy Duel's side (DuelArena.plugin.js): its request, whether it holds a player, its menu. */
let legacy = { request: () => {}, pending: () => false, busy: () => false, refreshMenu: () => {} };

const uid = (name) => Common.component(`${SCREEN}:${name}`);

function onPvpArenaWorld() {
  return Common.api.getPluginConfig(PVP_ARENA_WORLD, false) === true;
}

function nearby(a, b) {
  return a.getLocation().getZ() === b.getLocation().getZ() && a.getPrivateArea() === b.getPrivateArea()
    && a.getLocation().getDistance(b.getLocation()) <= 16;
}

function busy(player) {
  return sessions.has(player) || Battle.fightFor(player) != null || legacy.busy(player)
    || player.getHitpoints() <= 0 || player.isDying;
}

function invitedBy(player, target) {
  const invite = invites.get(target);
  return !!invite && invite.target === player && invite.expires > Date.now();
}

// ---------------------------------------------------------------- the challenge

/** Challenge (player option 1 in the Emir's Arena), once the player has walked up. */
function challenge(player, target) {
  if (busy(player) || busy(target) || !nearby(player, target)) return;
  if (invitedBy(player, target)) return accept(player, target);
  if (onPvpArenaWorld()) return invite(player, target);
  // Their Legacy Duel request to this player: Challenge back answers it.
  if (legacy.pending(player, target)) return legacy.request(player, target);
  Common.api.sendMultiChatboxPrompt(player, Common.message("duelType"),
    "Unranked Duel", () => invite(player, target),
    "Legacy Duel", () => legacy.request(player, target));
}

function invite(player, target) {
  if (busy(player) || busy(target) || !nearby(player, target)) return;
  if (invitedBy(player, target)) return accept(player, target);
  invites.set(player, { target, expires: Date.now() + Common.data.inviteTicks * 600 });
  Common.chat(player, Common.CHAT.TRADE, Common.message("challenging", { name: target.getDisplayName() }));
  Common.chat(target, Common.CHAT.CHALREQ_TRADE, Common.message("invited", { name: player.getDisplayName() }), player);
}

function accept(player, challenger) {
  invites.delete(challenger);
  invites.delete(player);
  const session = {
    players: [challenger, player],
    build: Loadouts.preferredBuild(challenger),
    stage: "build",
    acceptedBuild: new Set(),
    acceptedLoadout: new Set(),
  };
  for (const p of session.players) sessions.set(p, session);
  for (const p of session.players) open(p, session);
}

function opponent(session, player) {
  return session.players.find((p) => p !== player);
}

// ---------------------------------------------------------------- the screen

function open(player, session) {
  const other = opponent(session, player);
  const sender = player.getPacketSender();
  const { OP1, OP10 } = Common.EVENTS;
  player.sendMessage(Common.message("unofficial"));
  Common.varbit(player, "pvpa_transmit_build", session.build);
  Common.varbit(player, "pvpa_unrankedduel_transmit_progress", 1);
  Common.varbit(player, "pvpa_transmit_caneditbuild", 1);
  Common.varbit(player, "pvpa_transmit_battletype", Common.data.battletype.unranked);
  resetAccepts(player);
  Loadouts.sendLoadouts(player);
  sender.sendClientScript(PARTNER_SCRIPT, other.getDisplayName());
  Common.openModal(player, SCREEN);
  sender.sendInterfaceFlagsRange(uid("buildtypes"), 0, 2, OP1);
  sender.sendString(`Unranked Duel: ${other.getDisplayName()}`, uid("title"));
  Loadouts.sendColumnEvents(player, SCREEN);
  sender.sendInterfaceFlagsRange(uid("opponentinventory"), 0, 27, OP1 | OP10);
  for (const index of Object.values(Common.data.wornSlots)) sender.sendInterfaceFlagsRange(uid(`opponentslot${index}`), 1, 1, OP10);
}

function resetAccepts(player) {
  for (const name of ["pvpa_unrankedduel_transmit_iacceptbuild", "pvpa_legacyduel_transmit_iacceptoptions",
    "pvpa_unrankedduel_transmit_iacceptloadout", "pvpa_legacyduel_transmit_iacceptconfirm"]) Common.varbit(player, name, 0);
}

function sessionOn(player) {
  const session = sessions.get(player);
  return session && player.getInterfaceId() === Common.interfaceId(SCREEN) ? session : null;
}

/** buildtypes: the pair's build; both accepts go, and the other is shown the change. */
function chooseBuild({ player, slot }) {
  const session = sessionOn(player);
  if (!session || session.stage !== "build" || slot < 0 || slot > 2 || slot === session.build) return true;
  session.build = slot;
  session.acceptedBuild.clear();
  for (const p of session.players) {
    Common.varbit(p, "pvpa_transmit_build", slot);
    Common.varbit(p, "pvpa_unrankedduel_transmit_iacceptbuild", 0);
    Common.varbit(p, "pvpa_legacyduel_transmit_iacceptoptions", 0);
  }
  opponent(session, player).getPacketSender().sendClientScript(BUILD_CHANGED_SCRIPT, BUILD_CHANGED_HOLD, uid("build_warning"), uid("build_confirm"));
  return true;
}

function acceptBuild({ player }) {
  const session = sessionOn(player);
  if (!session || session.stage !== "build") return true;
  session.acceptedBuild.add(player);
  Common.varbit(player, "pvpa_unrankedduel_transmit_iacceptbuild", 1);
  Common.varbit(player, "pvpa_legacyduel_transmit_iacceptoptions", 1);
  if (session.acceptedBuild.size < 2) return true;
  session.stage = "loadout";
  for (const p of session.players) {
    Common.varbit(p, "pvpa_transmit_caneditbuild", 0);
    Common.varbit(p, "pvpa_unrankedduel_transmit_progress", 2);
    Loadouts.sendView(p, opponent(session, p), session.build, LOADOUTS_SHOWN_SCRIPT);
  }
  return true;
}

/** A change to a load-out at step 2: the other sees it, and both accept again. */
function loadoutChanged(player) {
  const session = sessions.get(player);
  if (!session || session.stage !== "loadout") return;
  session.acceptedLoadout.clear();
  for (const p of session.players) {
    Common.varbit(p, "pvpa_unrankedduel_transmit_iacceptloadout", 0);
    Common.varbit(p, "pvpa_legacyduel_transmit_iacceptconfirm", 0);
  }
  Loadouts.sendView(opponent(session, player), player, session.build);
}

function copyOpponent({ player }) {
  const session = sessionOn(player);
  if (!session || session.stage !== "loadout") return true;
  Loadouts.askCopy(player, opponent(session, player), session.build, `${SCREEN}:popup`, () => loadoutChanged(player));
  return true;
}

function acceptLoadout({ player }) {
  const session = sessionOn(player);
  if (!session || session.stage !== "loadout") return true;
  session.acceptedLoadout.add(player);
  Common.varbit(player, "pvpa_unrankedduel_transmit_iacceptloadout", 1);
  Common.varbit(player, "pvpa_legacyduel_transmit_iacceptconfirm", 1);
  if (session.acceptedLoadout.size < 2) return true;
  for (const p of session.players) sessions.delete(p);
  if (session.players.some((p) => !nearby(p, opponent(session, p)) || Battle.fightFor(p))) {
    for (const p of session.players) p.getPacketSender().sendInterfaceRemoval();
    return true;
  }
  Battle.start(session.players, session.build);
  return true;
}

/** The screen closed by any route: the challenge is off for both. */
function closed({ player, interfaceId }) {
  if (interfaceId !== Common.interfaceId(SCREEN)) return;
  cancel(player);
}

function cancel(player) {
  const session = sessions.get(player);
  if (!session) return;
  for (const p of session.players) sessions.delete(p);
  const other = opponent(session, player);
  Common.chat(player, Common.CHAT.TRADE, Common.message("cancelling"));
  Common.chat(other, Common.CHAT.TRADE, Common.message("cancelled", { name: player.getDisplayName() }));
  other.getPacketSender().sendInterfaceRemoval();
  if (player.getInterfaceId() === Common.interfaceId(SCREEN)) player.getPacketSender().sendInterfaceRemoval();
}

function gone({ player }) {
  invites.delete(player);
  for (const [from, invite] of invites) if (invite.target === player) invites.delete(from);
  cancel(player);
}

/** Every tick a screen is open: both still there and close by, or it's off. */
function watch({ player }) {
  const session = sessions.get(player);
  if (session && !nearby(...session.players)) cancel(player);
}

function inFight(player) {
  return Battle.fightFor(player) != null;
}

function attachUnranked(api, options) {
  legacy = { ...legacy, ...options };
  Loadouts.registerEditor(SCREEN, {
    canEdit: (player, build) => {
      const session = sessions.get(player);
      return !!session && session.stage === "loadout" && build === session.build;
    },
    changed: loadoutChanged,
  });
  api.onInterfaceActionButton(uid("buildtypes"), chooseBuild);
  api.onInterfaceActionButton(uid("build_confirm"), acceptBuild);
  api.onInterfaceActionButton(uid("opponent_copy"), copyOpponent);
  api.onInterfaceActionButton(uid("opponent_confirm"), acceptLoadout);
  api.onCustomEvent("interface:closed", closed);
  api.onPlayerProcess(watch);
  api.onPlayerLogout(gone);
  api.onPlayerDisconnect(gone);
}

module.exports = { attachUnranked, challenge, inFight, busy, _test: { invites, sessions, accept, cancel } };
