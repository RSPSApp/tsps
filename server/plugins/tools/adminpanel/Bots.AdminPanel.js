function catalogue(api, actor) {
  const event = { actor, action: "catalogue" };
  api.emitCustomEvent("admin:bots", event);
  const controls = { actor, action: "catalogue" };
  api.emitCustomEvent("admin:bot-controls", controls);
  event.controls = controls;
  return event;
}

const CATEGORIES = ["spawn", "active", "self"];
function config(state) {
  return state.botConfig ??= { count: 1, usePlayerLocation: false, copyOwnerSkills: false, setup: {}, category: "spawn", view: "browse" };
}
function snapshot(api, actor, state) {
  config(state);
  return state.botSnapshot = catalogue(api, actor);
}
function rows(api, actor, state) {
  const event = snapshot(api, actor, state), current = config(state), rows = [];
  const add = (key, name, detail, description, primary, extra = {}) => rows.push({ key, name, detail, panel: { description, primary }, ...extra });
  if (current.view !== "browse") return rows;
  if (current.category === "active") {
    for (const bot of event.controls.bots ?? []) add(`manage:${bot.username}`, bot.name, ` (${bot.mode})`,
      "Manage this bot's behavior, stats, equipment and display name, or take manual control.", "Manage bot", { info: `Behavior: ${bot.mode}` });
    if (!rows.length) add("empty", "No active bots", "", "Spawn a bot in Spawn bots, then return here to manage it.", "");
    return rows;
  }
  if (!event.allowed || event.error || !event.handled) {
    add("unavailable", "Bot spawning unavailable", "", event.error ?? "Enable PlayerBots to spawn routines and activities.", "");
    return rows;
  }
  for (const [kind, name] of [["activity", "Bots and activities"], ["routine", "Saved routines"]]) {
    const entries = event.launchers.filter(launcher => launcher.kind === kind);
    if (!entries.length) continue;
    add(`group:${kind}`, name, "", "", "", { group: true });
    for (const launcher of entries) add(launcher.key, launcher.name, "", launcher.description, "Configure", { parent: `group:${kind}`, info: launcher.detail });
  }
  if (!rows.length) add("empty", "No bot launchers available", "", "Save a routine or enable a bot activity to make it available here.", "");
  return rows;
}

function act(api, actor, state, key, amount) {
  const event = catalogue(api, actor), settings = config(state);
  if (key.startsWith("manage:")) {
    const bot = event.controls.bots?.find(bot => bot.username === key.slice(7));
    if (!bot) return "This bot is no longer online. Refresh the Bots tab.";
    settings.bot = bot.username;
    settings.view = "manage";
    settings.category = "active";
    return;
  }
  if (key.startsWith("control:")) {
    const [, operation, mode] = key.split(":");
    const request = { actor, action: "apply", operation, mode, username: settings.bot, name: amount };
    api.emitCustomEvent("admin:bot-controls", request);
    if (request.transferred) settings.transferred = true;
    return request.error ?? (!request.handled ? "Bot controls are unavailable." : undefined);
  }
  if (!event.allowed || event.error || !event.handled) return event.error ?? "Bot deployment is unavailable.";
  if (key === "count-down" || key === "count-up") {
    settings.count = Math.max(1, Math.min(event.limit, settings.count + (key === "count-up" ? 1 : -1)));
  } else if (key === "count") {
    if (!Number.isInteger(amount) || amount < 1 || amount > event.limit) return `Choose 1-${event.limit} bots.`;
    settings.count = amount;
  } else if (key === "location") settings.usePlayerLocation = !settings.usePlayerLocation;
  else if (key === "levels") settings.copyOwnerSkills = !settings.copyOwnerSkills;
  else if (key === "deploy") {
    const request = { actor, action: "deploy", ...settings, setup: settings.setup[settings.key] ?? {} };
    api.emitCustomEvent("admin:bots", request);
    return request.result?.message ?? request.result?.error ?? request.error ?? "Bot deployment is unavailable.";
  } else if (key.startsWith("field:")) {
    const launcher = event.launchers.find(item => item.key === settings.key);
    const field = launcher?.setupFields.find(field => field.id === key.slice(6));
    if (!field) return "This option is no longer available.";
    const values = settings.setup[launcher.key] ??= {};
    const index = field.choices.findIndex(choice => choice.value === (values[field.id] ?? field.defaultValue));
    values[field.id] = field.choices[(index + 1) % field.choices.length].value;
  } else if (event.launchers.some(item => item.key === key)) { settings.key = key; settings.view = "setup"; }
}

module.exports = { rows, act, config, snapshot, CATEGORIES };
