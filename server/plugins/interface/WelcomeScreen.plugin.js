const WELCOME_SCREEN_GROUP_ID = 378;
const PLAY_BUTTON_UID = (WELCOME_SCREEN_GROUP_ID << 16) | 72;
const FIRST_OPTION_FLAG = 1 << 1;
// welcome_screen:motw (378:6) is empty in the cache; live sends its text every login (226/01637).
const MOTW_UID = (WELCOME_SCREEN_GROUP_ID << 16) | 6;
const ESC_KEY_COMPONENT = "welcome_screen:esckey";
/**
 * welcome_screen:banner (378:76), the large box at the top. welcome_screen_init puts a loading
 * spinner in it (script1188 with struct 781). Live then asks Jagex's content service (clientscript
 * 1189) and, when that has nothing, runs script1207 with a fallback image and menu option: it hides
 * the spinner, shows the image in banner_artcanvas and gives the banner op1. tsps runs script1207
 * straight away with its own banner, sprite 30000 (data/sprites, see CustomSprites), and answers a
 * click on it with the page, as live answers banner clicks with url_open.
 */
const BANNER_UID = (WELCOME_SCREEN_GROUP_ID << 16) | 76;
const BANNER_STRUCT = 781;
const BANNER_FALLBACK_SCRIPT = 1207;
const BANNER_SPRITE = 30000;
const BANNER_OPTION = "Visit rsps.app";
const BANNER_URL = "https://rsps.app";
/** world.json pluginConfig: the scroll's text; league worlds replace it with their own. */
const MOTW_CONFIG = "WelcomeScreen:messageOfTheWeek";
const pending = new WeakSet();
const visible = new WeakSet();
let api;

function inWilderness(player) {
  return api.core.Wilderness.isInLocation(player?.getLocation?.());
}

/**
 * The chatbox greeting, sent as the welcome chat type as live does (rsprox `type=108`). A game mode
 * with worlds of its own rewrites it through `welcome-screen:greeting` { player, worldName, text }
 * (a Hardcore world: "Welcome to Hardcore Old School RuneScape.").
 */
function greet(player) {
  const worldName = api.core.WorldDefinition.getWorldDefinition().name;
  const greeting = { player, worldName, text: `Welcome to ${worldName}.` };
  api.emitCustomEvent("welcome-screen:greeting", greeting);
  player.getPacketSender().sendTypedMessage(api.core.ChatType.WELCOME, String(greeting.text));
  // Live's next line is the "Did you know?" tip (LoginTips).
  api.emitCustomEvent("welcome-screen:greeted", { player });
}

function login({ player, isNewAccount }) {
  greet(player);
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
  sender.sendString(String(api.getPluginConfig(MOTW_CONFIG, `Welcome to ${api.core.WorldDefinition.getWorldDefinition().name}!`)), MOTW_UID);
  // script1207(struct, graphic, op1, coord, coord): struct 781 has no close button, so the coords go unused.
  sender.sendInterfaceFlags(BANNER_UID, FIRST_OPTION_FLAG);
  sender.sendClientScript(BANNER_FALLBACK_SCRIPT, BANNER_STRUCT, BANNER_SPRITE, BANNER_OPTION, 0, 0);
  api.emitCustomEvent("welcome-screen:shown", { player });
}

function openBanner({ player }) {
  if (!visible.has(player)) return false;
  player.getPacketSender().sendUrlOpen(BANNER_URL);
}

function play({ player }) {
  if (!visible.delete(player)) return false;
  const root = api.core.resolveGameframeRoot(player);
  for (const packet of api.core.encodeGameframeBootstrap(player.getUsername(), root,
      player.getAttribute(api.core.XPDROPS_ENABLED_ATTRIBUTE) === true, api.core.GameConstants.WORLD_TYPE.label,
      !api.core.dataOrbsHidden(player), api.core.World.getProcessCycle())) {
    player.getSession().sendClientPacket(packet);
  }
  // The saved spellbook selector and quest varps were sent at login and survive a root swap.
  api.emitCustomEvent("gameframe:ready", { player });
  return false;
}

/**
 * "player:widget-action": Esc on the welcome screen (welcome_screen_init binds it to esckey's op1,
 * "Close") enters the game as Play does: live answers it exactly as it answers Play
 * (rsprox_transcripts/233/00747.txt, 235/03353.txt). It goes on as a Play click, so every
 * plugin waiting for Play (music, emotes, settings, Barrows, quests) sees it too.
 */
function escape(event) {
  const { player, packet } = event;
  if (event.handled || !visible.has(player) || packet.buttonNum !== 1) return;
  if (packet.widgetId !== api.core.CacheDefinitions.getComponentId(ESC_KEY_COMPONENT)) return;
  packet.widgetId = PLAY_BUTTON_UID;
  packet.childId = PLAY_BUTTON_UID & 0xffff;
}

function clear({ player }) {
  pending.delete(player);
  visible.delete(player);
}

module.exports = {
  name: "WelcomeScreen",
  description: "Welcome screen at login with the message of the week, an rsps.app banner and a Play button, with the text set by the world's plugin config.",
  config: {
    "WelcomeScreen:messageOfTheWeek": {
      type: "string", label: "Message of the week", defaultText: "Welcome to <world name>!",
      help: "Text on the scroll at the bottom of the welcome screen. Takes <col=rrggbb> and <br> tags. League worlds show their own message instead.",
    },
  },
  dependsOn: ["Wilderness"],
  register(pluginApi) {
    api = pluginApi;
    api.onPlayerLogin(login);
    api.onInterfaceActionButton(PLAY_BUTTON_UID, play);
    api.onInterfaceActionButton(BANNER_UID, openBanner);
    api.onCustomEvent("player:widget-action", escape);
    api.onPlayerDisconnect(clear);
    api.onPlayerLogout(clear);
    api.log("registered");
  },
};
