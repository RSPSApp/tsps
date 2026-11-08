const POISON_TIMER_SECONDS_VARP = 7996;
const POISON_TIMER_TYPE_VARP = 7997;
const POISON_TICK_SECONDS = 18;

const states = new WeakMap();

function getState(player) {
  const damage = Math.max(0, Number(player.getPoisonDamage?.() ?? 0));
  if (damage === 0) {
    return [0, 0];
  }
  if (player.isVenomed?.()) {
    return [-1, 2];
  }
  return [damage * POISON_TICK_SECONDS, 1];
}

function sync(player, force = false) {
  const state = getState(player);
  if (!force && states.get(player)?.[0] === state[0] && states.get(player)?.[1] === state[1]) {
    return;
  }
  states.set(player, state);
  const sender = player.getPacketSender();
  sender.sendConfig(POISON_TIMER_SECONDS_VARP, state[0]);
  sender.sendConfig(POISON_TIMER_TYPE_VARP, state[1]);
}

function onLogin(event) {
  sync(event.player, true);
}

function onProcess({ player }) {
  sync(player);
}

function onLogout({ player }) {
  states.delete(player);
}

module.exports = {
  name: "Poison Timer",
  description: "Sends the poison and venom state to the client so the poison timer shows the seconds until the next damage hit.",
  register(api) {
    api.onPlayerLogin(onLogin);
    api.onPlayerProcess(onProcess);
    api.onPlayerLogout(onLogout);
  },
};
