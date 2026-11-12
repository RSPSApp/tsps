/**
 * Native legacy chat-channel challenges for bounded Plateau, Sylvan and Quarry/melee-only team battles.
 * Messages are implementation wording; there is no team-match recording to quote.
 * Pinned rev242: setup accept31, cap dropdown43 children1..8, confirm button7;
 * scripts554/591 supply confirmation and opponent-change presentation respectively.
 */
const Common = require("./Common.ClanWars");
const Rules = require("./Rules.ClanWars");
const Layout = require("./Layout.ClanWars");

const CHALLENGE_OPTION = 4;
const OP1 = 1 << 1;
const CONFIRM_SCRIPT = 554;
const OPPONENT_CHANGED_SCRIPT = 591;
// Cache script554 waits150 client cycles (3s), corner_update waits250 (5s).
// Server authority rounds the latter up to whole 600ms game ticks.
const CONFIRM_DELAY_TICKS = 5;
const CHANGE_DELAY_TICKS = 9;
const requests = new Map();
const HIDDEN_SETUP_PARTS = [
  "other_container",
  "melee", "ranged", "magic",
];

function group(stage) { return Common.group(stage === "confirm" ? "clanwars_confirm" : "clanwars_setup"); }
function sameChannelKeys(players, keys) {
  const channels = players.map((player) => Common.captain(player));
  return channels.every((channel, index) => channel && channel.key === keys.get(players[index]))
    && channels[0].key !== channels[1].key;
}

function channelsReserved(keys, except = null) {
  for (const key of keys.values()) if (Common.channelGames.has(key)) return true;
  for (const session of Common.negotiations.values()) {
    if (session === except) continue;
    for (const key of keys.values()) if ([...session.channelKeys.values()].includes(key)) return true;
  }
  return false;
}

function validPair(players, keys, except = null) {
  return players.length === 2 && players[0] !== players[1]
    && players.every((player) => Common.live(player) && Common.inLobby(player)
      && player.getHitpoints() > 0 && !player.isTeleportingReturn()
      && !Common.matches.has(player))
    && sameChannelKeys(players, keys) && !channelsReserved(keys, except);
}

function sendRules(player, rules) {
  for (const [name, value] of Object.entries(rules)) Common.bit(player, `clanwars_${name}`, value);
  Common.bit(player, "clanwars_useclansystem", 0);
}

function renderSetup(session) {
  session.changing = true;
  session.stage = "setup";
  session.accepted.clear();
  try {
    for (const player of session.players) {
      Common.bit(player, "clanwars_accept", 0);
      sendRules(player, session.rules);
      const sender = player.getPacketSender();
      sender.sendInterface(Common.group("clanwars_setup"));
      sender.sendString("Melee team battles - choose an arena", Common.uid("clanwars_setup:title"));
      // The cache creates mode rows at index * 3 (script 576). Every actual row
      // must transmit even when its mode is unsupported: script579
      // optimistically changes the client varbit even on unsupported selections.
      for (const name of HIDDEN_SETUP_PARTS) {
        sender.sendInterfaceDisplayState(Common.uid(`clanwars_setup:${name}`), true);
      }
      sender.sendInterfaceDisplayState(Common.uid("clanwars_setup:arena_container"), false);
      sender.sendInterfaceFlagsRange(Common.uid("clanwars_setup:arena"), 0, 41, 0);
      for (let arena = 0; arena < 14; arena++) {
        sender.sendInterfaceFlagsRange(Common.uid("clanwars_setup:arena"), arena * 3, arena * 3, OP1);
      }
      sender.sendInterfaceFlagsRange(Common.uid("clanwars_setup:wincondition"), 0, 71, 0);
      for (let mode = 0; mode < 24; mode++) {
        sender.sendInterfaceFlagsRange(Common.uid("clanwars_setup:wincondition"), mode * 3, mode * 3, OP1);
      }
      sender.sendInterfaceDisplayState(Common.uid("clanwars_setup:stragglers_container"), false);
      sender.sendInterfaceFlagsRange(Common.uid("clanwars_setup:stragglers"), 0, 5, 0);
      // This is script576's scrollbox, with option rectangles at value * 3.
      // Both rows transmit so unsupported combinations can reset optimistic bits.
      for (let value = 0; value < Rules.STRAGGLER_LIMITS.length; value++) {
        sender.sendInterfaceFlagsRange(Common.uid("clanwars_setup:stragglers"), value * 3, value * 3, OP1);
      }
      for (const name of Object.keys(Rules.RESTRICTIONS)) {
        sender.sendInterfaceDisplayState(Common.uid(`clanwars_setup:${name}`), false);
        // Script2877 creates highlight child0, then option children index+1.
        // The deferred special row also transmits, so its optimistic bit is reset.
        const count = name === "prayer" || name === "specialattacks" ? 3 : 2;
        sender.sendInterfaceFlagsRange(Common.uid(`clanwars_setup:dropdown_${name}`), 1, count, OP1);
      }
      sender.sendInterfaceFlags(Common.uid("clanwars_setup:accept"), OP1);
      sender.sendInterfaceFlagsRange(Common.uid("clanwars_setup:dropdown_playercap"), 1, Rules.TEAM_CAPS.length, OP1);
    }
  } finally { session.changing = false; }
}

function renderConfirm(session) {
  session.changing = true;
  session.stage = "confirm";
  session.accepted.clear();
  session.confirmRevision = session.revision;
  session.confirmAfter = Common.now() + CONFIRM_DELAY_TICKS;
  try {
    for (const player of session.players) {
      Common.bit(player, "clanwars_accept", 0);
      sendRules(player, session.rules);
      player.getPacketSender().sendInterface(Common.group("clanwars_confirm"))
        .sendString("Confirm Clan Wars challenge", Common.uid("clanwars_confirm:title"))
        .sendClientScript(CONFIRM_SCRIPT, 0, Rules.summary(session.rules))
        .sendInterfaceFlags(Common.uid("clanwars_confirm:button"), OP1);
    }
  } finally { session.changing = false; }
}

function close(session) {
  session.task?.stop();
  session.changing = true;
  for (const player of session.players) Common.negotiations.delete(player);
  try {
    for (const player of session.players) {
      Common.bit(player, "clanwars_accept", 0);
      if ([Common.group("clanwars_setup"), Common.group("clanwars_confirm")].includes(player.getInterfaceId())) {
        player.getPacketSender().sendInterfaceRemoval();
      }
    }
  } finally { session.changing = false; }
}

function cancel(session, message = "The Clan Wars challenge was cancelled.") {
  if (session.closed) return;
  session.closed = true;
  close(session);
  for (const player of session.players) if (Common.live(player)) player.sendMessage(message);
}

function cancelPlayer(player) {
  const session = Common.negotiations.get(player);
  if (session) cancel(session);
  for (const [sender, request] of requests) {
    if (sender === player || request.target === player) requests.delete(sender);
  }
}

function challenge(player, target) {
  const own = Common.captain(player);
  const other = Common.captain(target);
  if (!own || !other || own.key === other.key) {
    player.sendMessage("Both challengers must be captains or higher in different chat-channels.");
    return;
  }
  const players = [player, target];
  const channelKeys = new Map([[player, own.key], [target, other.key]]);
  if (!validPair(players, channelKeys) || players.some((p) => Common.negotiations.has(p) || p.busy())) {
    player.sendMessage("That chat-channel is not available for a Clan Wars challenge.");
    return;
  }
  const reciprocal = requests.get(target);
  if (reciprocal?.target === player && validPair(players, reciprocal.channelKeys)) {
    requests.delete(player);
    requests.delete(target);
    const session = {
      players, channelKeys, rules: Rules.create(), stage: "setup", accepted: new Set(),
      revision: 0, acceptAfter: new Map(players.map((p) => [p, Common.now()])), closed: false,
    };
    for (const p of players) {
      Common.negotiations.set(p, session);
      p.getMovementQueue().reset();
      p.sendMessage("This challenge offers melee-only Last Team Standing, First to X kills or Most kills on Plateau, Sylvan Glade, Forsaken Quarry or Soggy Swamp. Objective modes are unavailable. Choose a mode, team cap and supported melee restrictions, then check the confirmation screen.");
    }
    renderSetup(session);
    // Scope polling to this live negotiation. The existing Ferox area retains ownership
    // of the lobby's Wilderness/protection state; no competing area or global process hook.
    session.task = new (class extends Common.core.Task {
      constructor() { super(1, false); }
      execute() { process(session.players[0]); if (session.closed) this.stop(); }
    })();
    Common.core.TaskManager.submit(session.task);
    return;
  }
  requests.set(player, { target, channelKeys });
  player.sendMessage(`You challenge ${target.getDisplayName()}'s chat-channel to Clan Wars.`);
  target.sendMessage(`${player.getDisplayName()} challenges your chat-channel to Clan Wars. Right-click them and choose Challenge to review the terms.`);
}

function route(event) {
  const { player, target, option } = event;
  if (event.handled || option !== CHALLENGE_OPTION || !Common.inLobby(player)) return;
  event.handled = true;
  if (!target || !Common.inLobby(target) || player === target) return;
  player.getMovementQueue().walkToEntity(target, () => {
    if (!Common.inLobby(player) || !Common.inLobby(target) || !Common.live(target)) return;
    const a = player.getLocation(), b = target.getLocation();
    if (a.getZ() !== b.getZ() || Math.max(Math.abs(a.getX() - b.getX()), Math.abs(a.getY() - b.getY())) > 2) return;
    challenge(player, target);
  });
}

function changeRules(session, player, key, index) {
  const next = { ...session.rules, [key]: index };
  if (!Rules.validate(next)) {
    player.sendMessage("Ignore 5 is only supported in Last Team Standing battles.");
    sendRules(player, session.rules);
    Common.bit(player, "clanwars_accept", session.accepted.has(player) ? 1 : 0);
    return;
  }
  if (session.rules[key] === index) {
    sendRules(player, session.rules);
    return;
  }
  session.rules = next;
  session.revision++;
  session.accepted.clear();
  for (const p of session.players) {
    Common.bit(p, "clanwars_accept", 0);
    sendRules(p, next);
    if (p !== player) {
      session.acceptAfter.set(p, Common.now() + CHANGE_DELAY_TICKS);
      p.getPacketSender().sendClientScript(OPPONENT_CHANGED_SCRIPT);
    }
  }
}

function accept(session, player) {
  if (!validPair(session.players, session.channelKeys, session) || !Rules.validate(session.rules)) return cancel(session);
  if (session.players.some((p) => p.getInterfaceId() !== group(session.stage))) return cancel(session);
  if (Common.now() < (session.acceptAfter.get(player) ?? 0)) {
    Common.bit(player, "clanwars_accept", 0);
    return;
  }
  if (session.stage === "confirm"
    && (Common.now() < session.confirmAfter || session.confirmRevision !== session.revision)) {
    Common.bit(player, "clanwars_accept", 0);
    return;
  }
  session.accepted.add(player);
  Common.bit(player, "clanwars_accept", 1);
  if (session.accepted.size !== 2) return;
  if (session.stage === "setup") return renderConfirm(session);
  // Remove the modal ownership before Match takes it over; retained rules cannot change.
  session.rules = Object.freeze({ ...session.rules });
  session.closed = true;
  close(session);
  const started = require("./Match.ClanWars").start({
    players: session.players,
    channelKeys: session.players.map((p) => session.channelKeys.get(p)),
    rules: session.rules,
  });
  if (!started) {
    for (const p of session.players) if (Common.live(p)) p.sendMessage("The Clan Wars challenge could not be started.");
  }
}

function click(event) {
  const button = event.buttonId;
  const setup = Common.group("clanwars_setup"), confirm = Common.group("clanwars_confirm");
  const eventGroup = event.groupId ?? (button >>> 16);
  if (eventGroup !== setup && eventGroup !== confirm) return;
  event.handled = true;
  const { player } = event;
  const session = Common.negotiations.get(player);
  if (!session || session.closed || player.getInterfaceId() !== group(session.stage)
    || eventGroup !== group(session.stage) || (event.opId ?? 1) !== 1) return;
  if (!validPair(session.players, session.channelKeys, session)) return cancel(session);
  const child = event.childId ?? (button & 0xffff);
  const clicked = (name) => child === (Common.uid(name) & 0xffff);
  if (session.stage === "setup") {
    if (clicked("clanwars_setup:accept")) return accept(session, player);
    if (clicked("clanwars_setup:arena")) {
      const slot = event.slot ?? event.action;
      if (Number.isInteger(slot) && slot >= 0 && slot % 3 === 0
        && Layout.get(slot / 3)) return changeRules(session, player, "arena", slot / 3);
      player.sendMessage("Only Plateau, Sylvan Glade, Forsaken Quarry and Soggy Swamp are supported.");
    }
    if (clicked("clanwars_setup:stragglers")) {
      const slot = event.slot ?? event.action;
      if (Number.isInteger(slot) && slot >= 0 && slot % 3 === 0
        && slot / 3 < Rules.STRAGGLER_LIMITS.length) return changeRules(session, player, "stragglers", slot / 3);
      player.sendMessage("That Clan Wars stragglers option is not supported.");
    }
    if (clicked("clanwars_setup:dropdown_playercap")) {
      const slot = event.slot ?? event.action;
      if (Number.isInteger(slot) && slot >= 1 && slot <= Rules.TEAM_CAPS.length) return changeRules(session, player, "playercap", slot - 1);
    }
    for (const [name, values] of Object.entries(Rules.RESTRICTIONS)) {
      if (!clicked(`clanwars_setup:dropdown_${name}`)) continue;
      const slot = event.slot ?? event.action;
      if (Number.isInteger(slot) && values.includes(slot - 1)) return changeRules(session, player, name, slot - 1);
      player.sendMessage("That Clan Wars rule option is not supported.");
      sendRules(player, session.rules);
      return;
    }
    if (clicked("clanwars_setup:wincondition")) {
      const slot = event.slot ?? event.action;
      if (Number.isInteger(slot) && slot >= 0 && slot % 3 === 0
        && Rules.create(session.rules.playercap, slot / 3)) return changeRules(session, player, "wincondition", slot / 3);
      player.sendMessage("Only Last Team Standing, First to X kills and Most kills are supported.");
    }
    // A forged unsupported selection cannot alter the server's offer, nor leave a
    // client-only optimistic selection behind for the confirmation screen.
    sendRules(player, session.rules);
    Common.bit(player, "clanwars_accept", session.accepted.has(player) ? 1 : 0);
  } else if (clicked("clanwars_confirm:button")) accept(session, player);
}

function process(player) {
  const request = requests.get(player);
  if (request && !validPair([player, request.target], request.channelKeys)) requests.delete(player);
  const session = Common.negotiations.get(player);
  if (!session || session.changing || session.closed) return;
  if (!validPair(session.players, session.channelKeys, session)
    || session.players.some((p) => p.getInterfaceId() !== group(session.stage))) cancel(session);
}

function gone({ player }) { cancelPlayer(player); }
function closed({ player, interfaceId }) {
  const session = Common.negotiations.get(player);
  if (session && !session.changing && interfaceId === group(session.stage)) cancel(session);
}
function opened({ player, groupId, targetUid }) {
  const session = Common.negotiations.get(player);
  if (session && !session.changing && targetUid === Common.uid("toplevel_osrs_stretch:mainmodal")
    && groupId !== group(session.stage)) cancel(session);
}
function shutdown() {
  for (const session of new Set(Common.negotiations.values())) cancel(session);
  requests.clear();
}
function attach(api) {
  api.onCustomEvent("player:option-route", route);
  api.onInterfaceActionClick(click);
  api.onPlayerDisconnect(gone);
  api.onPlayerLogout(gone);
  api.onCustomEvent("friends-chat:left", gone);
  api.onCustomEvent("interface:closed", closed);
  api.onCustomEvent("interface:opened", opened);
}

module.exports = { attach, process, cancelPlayer, shutdown };
