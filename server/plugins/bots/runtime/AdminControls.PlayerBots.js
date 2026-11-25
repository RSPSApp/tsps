const { controlBot, copyStatsToBot, copyGearToBot } = require("./Control.PlayerBots");

const OPERATIONS = {
  self: "botme", behavior: "bh", rename: "botname", info: "botinfo",
  control: "botcontrol", stats: "botstatsme", gear: "botgearme",
};
const title = value => String(value).replace(/[_-]+/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());

function modes(registry) {
  return [...new Set(["recruit", "auto", ...(registry.activities ?? []).filter(activity => !activity.manual).map(activity => activity.mode)])]
    .filter(mode => mode && !["follow", "follow_owner"].includes(mode));
}

function launchers({ api, brainRegistry }, handlers, event) {
  for (const mode of modes(brainRegistry)) {
    const activity = handlers.findBrainActivity(mode);
    if (mode !== "auto" && !activity) continue;
    event.register({
      id: `player-bot.${mode.replace(/_/g, "-")}`,
      name: mode === "recruit" ? "Recruit / follow me" : mode === "auto" ? "Autonomous bot" : `${title(mode)} bot`,
      detail: "Built-in bot",
      description: mode === "recruit" ? "Spawn a geared recruit that follows you and joins your clan chat."
        : mode === "auto" ? "Spawn a bot that chooses its own activities."
        : `Spawn using the existing ${mode} bot behavior.`,
      setupSummary: "Uses the existing bot command's setup. Quantity, location and copied levels can be configured here.",
      spawnLocation: activity?.spawnSetup?.location,
      deploy: deploy.bind(null, api, handlers, mode),
    });
  }
}

function deploy(api, handlers, mode, { player, count, location, skillOverrides }) {
  if (!api.core.PluginManager.playerHasCommandRights(player, "bot")) return { ok: false, error: "You do not have permission to spawn bots." };
  const spawned = [];
  const spawnLocation = new api.core.Location(location.x, location.y, location.z);
  for (let i = 0; i < count; i++) handlers.spawnBot({ player, requestedMode: mode, spawnLocation, skillOverrides, spawnedBots: spawned });
  return { spawned, failures: spawned.length < count ? ["Some bots could not spawn or start their behavior."] : [] };
}

function controls({ api, runtime, brainRegistry }, handlers, event) {
  const player = event.actor, core = api.core;
  event.handled = true;
  if (!core.PlayerRights.hasAdminRights(player) || !core.PluginManager.playerHasCommandRights(player, "admin")) {
    event.error = "Admin access is no longer available.";
    return;
  }
  const allowed = Object.fromEntries(Object.entries(OPERATIONS).map(([operation, command]) => [operation, core.PluginManager.playerHasCommandRights(player, command)]));
  if (event.action === "catalogue") {
    event.allowed = allowed;
    event.selfEnabled = runtime.hasControllerForPlayer(player);
    event.modes = [...new Set(["manual", ...modes(brainRegistry)])];
    event.bots = [...runtime.entriesByUsername.values()]
      .filter(entry => entry.player !== player && entry.player?.isPlayerBot?.() && entry.player.isRegistered())
      .map(entry => ({ username: entry.player.getUsername(), name: entry.player.getDisplayName(),
        mode: entry.manuallyControlled ? "controlled" : entry.behaviorPaused ? "manual" : entry.state?.mode ?? "auto" }))
      .sort((a, b) => a.username.localeCompare(b.username)).slice(0, 200);
    return;
  }
  const operation = event.operation;
  if (!allowed[operation]) { event.error = "You do not have permission to use this bot control."; return; }
  if (operation !== "self") {
    const entry = runtime.entriesByUsername.get(event.username);
    if (!entry?.player?.isPlayerBot?.() || !entry.player.isRegistered()) { event.error = "This bot is no longer online. Refresh the Bots tab."; return; }
    if (entry.manuallyControlled) { event.error = "Return control of this bot before changing it."; return; }
  }
  const args = { player, username: event.username };
  if (operation === "self") handlers.selfBot({ player, requestedMode: runtime.hasControllerForPlayer(player) ? "off" : "on" });
  else if (operation === "behavior") {
    if (!["manual", ...modes(brainRegistry)].includes(event.mode)) { event.error = "Choose an available behavior."; return; }
    handlers.behavior({ ...args, requestedMode: event.mode });
  } else if (operation === "rename") {
    if (typeof event.name !== "string" || event.name.length > 12) { event.error = "Enter a bot name of up to 12 characters."; return; }
    handlers.rename({ ...args, displayName: event.name });
  } else if (operation === "info") handlers.info(args);
  else if (operation === "control") {
    controlBot(args);
    event.transferred = runtime.entriesByUsername.get(event.username)?.manuallyControlled === true;
  }
  else if (operation === "stats") copyStatsToBot(args);
  else if (operation === "gear") copyGearToBot(args);
}

function registerAdminBotControls(options, handlers) {
  options.api.onCustomEvent("bots:collect-launchers", launchers.bind(null, options, handlers));
  options.api.onCustomEvent("admin:bot-controls", controls.bind(null, options, handlers));
}

module.exports = { registerAdminBotControls };
