const WELCOME_SCREEN_GROUP_ID = 378;
const PLAY_BUTTON_UID = (WELCOME_SCREEN_GROUP_ID << 16) | 72;
const FIRST_OPTION_FLAG = 1 << 1;
// welcome_screen:motw (378:6) is empty in the cache; live sends its text every login (226/01637).
const MOTW_UID = (WELCOME_SCREEN_GROUP_ID << 16) | 6;
/** world.json pluginConfig: the scroll's text; league worlds replace it with their own. */
const MOTW_CONFIG = "WelcomeScreen:messageOfTheWeek";
const DEFAULT_MOTW = "Welcome to Old School RuneScape!";
const pending = new WeakSet();
const visible = new WeakSet();
let api;

function inWilderness(player) {
  return api.core.Wilderness.isInLocation(player?.getLocation?.());
}

function login({ player, isNewAccount }) {
  // Mobile, new accounts and Wilderness logins enter the world directly.
  if (isNewAccount || player.isPlayerBot?.() === true || inWilderness(player)
      || player.getAttribute(api.core.MOBILE_CLIENT_ATTRIBUTE) === true) return;
  pending.add(player);
  // The synchronous login bootstrap initializes camera, chat and account varcs first.
  queueMicrotask(() => showWelcomeScreen(player));
}

function showWelcomeScreen(player) {
  if (!pending.delete(player) || inWilderness(player)) return;
  visible.add(player);
  const sender = player.getPacketSender();
  sender.sendRootInterface(WELCOME_SCREEN_GROUP_ID);
  sender.sendInterfaceFlags(PLAY_BUTTON_UID, FIRST_OPTION_FLAG);
  sender.sendString(String(api.getPluginConfig(MOTW_CONFIG, DEFAULT_MOTW)), MOTW_UID);
  api.emitCustomEvent("welcome-screen:shown", { player });
}

function play({ player }) {
  if (!visible.delete(player)) return false;
  const root = api.core.resolveGameframeRoot(player);
  for (const packet of api.core.encodeGameframeBootstrap(player.getUsername(), root,
      player.getAttribute(api.core.XPDROPS_ENABLED_ATTRIBUTE) === true)) {
    player.getSession().sendClientPacket(packet);
  }
  // The saved spellbook selector and quest varps were sent at login and survive a root swap.
  api.emitCustomEvent("gameframe:ready", { player });
  return false;
}

function clear({ player }) {
  pending.delete(player);
  visible.delete(player);
}

module.exports = {
  name: "WelcomeScreen",
  dependsOn: ["Wilderness"],
  register(pluginApi) {
    api = pluginApi;
    api.onPlayerLogin(login);
    api.onInterfaceActionButton(PLAY_BUTTON_UID, play);
    api.onPlayerDisconnect(clear);
    api.onPlayerLogout(clear);
    api.log("registered");
  },
};
