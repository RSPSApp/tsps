const VENGEANCE_TIME_LIMIT_VARBIT = 2451;
// vengeance_rebound: 1 while the next hit will be rebounded, 0 once it has (rsprox captures).
const VENGEANCE_REBOUND_VARBIT = 2450;

const cooldownStates = new WeakMap();
const reboundStates = new WeakMap();

function syncCooldown(player, force = false) {
  const timer = player.getVengeanceTimer?.();
  const active = Math.max(0, Number(timer?.secondsRemaining?.() ?? 0)) > 0;

  if (!force && cooldownStates.get(player) === active) {
    return;
  }

  cooldownStates.set(player, active);
  player.getPacketSender().sendVarbit(VENGEANCE_TIME_LIMIT_VARBIT, active ? 1 : 0);
}

function syncRebound(player, force = false) {
  const active = player.hasVengeanceReturn?.() === true;

  if (!force && reboundStates.get(player) === active) {
    return;
  }

  reboundStates.set(player, active);
  player.getPacketSender().sendVarbit(VENGEANCE_REBOUND_VARBIT, active ? 1 : 0);
}

function syncLogin({ player }) {
  syncCooldown(player, true);
  syncRebound(player, true);
}

function syncProcess({ player }) {
  syncCooldown(player);
  syncRebound(player);
}

function forget({ player }) {
  cooldownStates.delete(player);
  reboundStates.delete(player);
}

module.exports = {
  name: "Vengeance Timer",
  description: "Keeps the client's 30-second Vengeance cooldown overlay in sync with the player's cooldown.",
  register(api) {
    api.onPlayerLogin(syncLogin);
    api.onPlayerProcess(syncProcess);
    api.onPlayerLogout(forget);
  },
};
