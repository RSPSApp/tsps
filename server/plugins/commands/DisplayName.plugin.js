const { DisplayNames } = require("../../src/main/typescript/elvarg/game/entity/impl/player/DisplayNames");

/**
 * ::displayname <new name> - the name other players see; the login name stays the account's key
 * (DisplayNames). OSRS rules: at most 12 characters, never "mod", a new name only every 28 days,
 * and the name given up held for its old owner for 35 days. Both periods are world.json
 * `pluginConfig` settings.
 */

const MAX_LENGTH = 12;
const DAY_MS = 24 * 60 * 60 * 1000;
const COOLDOWN_DAYS_CONFIG = "DisplayName:cooldownDays";
const HOLD_DAYS_CONFIG = "DisplayName:holdDays";

let pluginApi = null;

/** As the login screen treats names: underscores are spaces, and spaces don't pile up. */
function cleanName(raw) {
  return String(raw ?? "").replace(/_/g, " ").trim().replace(/\s+/g, " ");
}

function days(config, fallback) {
  const value = Number(pluginApi.getPluginConfig(config, fallback));
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function daysLeft(ms) {
  const count = Math.ceil(ms / DAY_MS);
  return `${count} day${count === 1 ? "" : "s"}`;
}

/** Ms until the player may change name again (0 when they may now). */
function cooldownLeft(player, now) {
  const changedAt = DisplayNames.entryOf(player.getUsername())?.changedAt ?? 0;
  if (!changedAt) return 0;
  return Math.max(0, changedAt + days(COOLDOWN_DAYS_CONFIG, 28) * DAY_MS - now);
}

/** Why the player can't take `name` now (a message), or null. */
function refusal(player, name, now) {
  if (name.length < 1) return "Usage: ::displayname <new name>";
  if (name.length > MAX_LENGTH) return `Display names can be at most ${MAX_LENGTH} characters long.`;
  if (!/^[A-Za-z0-9 ]+$/.test(name)) return "Display names can only use letters, numbers and spaces.";
  // OSRS: nobody may pass as a moderator; staff are the moderators.
  if (!player.isStaff() && name.replace(/ /g, "").toLowerCase().includes("mod")) {
    return "Display names can't contain \"mod\".";
  }
  if (name === player.getDisplayName()) return "That is already your display name.";
  const wait = cooldownLeft(player, now);
  if (wait > 0) return `You can change your display name again in ${daysLeft(wait)}.`;
  return DisplayNames.refusal(player.getUsername(), name, now);
}

function showDisplayName(player, now) {
  player.sendMessage(`Your display name is ${player.getDisplayName()}.`);
  const wait = cooldownLeft(player, now);
  player.sendMessage(wait > 0
    ? `You can change it again in ${daysLeft(wait)}.`
    : "Change it with ::displayname <new name>.");
}

function changeDisplayName(player, name) {
  const now = Date.now();
  // Checked again: the name may have been taken while the prompt was open.
  const problem = refusal(player, name, now);
  if (problem) {
    player.sendMessage(problem);
    return;
  }
  const previous = player.getDisplayName();
  try {
    DisplayNames.set(player.getUsername(), name, now, days(HOLD_DAYS_CONFIG, 35) * DAY_MS);
  } catch (error) {
    console.error(`[display-name] failed to save ${player.getUsername()}'s new name`, error);
    player.sendMessage("Your display name could not be changed. Please try again later.");
    return;
  }
  player.setDisplayName(name);
  player.sendMessage(`Your display name is now ${name}.`);
  pluginApi.emitCustomEvent("display-names:changed", { player, previous, name });
}

function displayNameCommand({ player, raw }) {
  if (raw.includes("\r") || raw.includes("\n")) return true;
  const now = Date.now();
  // Everything after the command word, which may have come as "::displayname" or "/displayname".
  const name = cleanName(raw.replace(/^\S+/, ""));
  if (!name) {
    showDisplayName(player, now);
    return true;
  }
  const problem = refusal(player, name, now);
  if (problem) {
    player.sendMessage(problem);
    return true;
  }
  const cooldown = days(COOLDOWN_DAYS_CONFIG, 28);
  if (cooldown > 0) player.sendMessage(`You won't be able to change it again for ${daysLeft(cooldown * DAY_MS)}.`);
  pluginApi.sendMultiChatboxPrompt(
    player,
    `Change your display name to ${name}?`,
    "Yes",
    () => changeDisplayName(player, name),
    "No",
    () => {}
  );
  return true;
}

module.exports = {
  name: "DisplayName",
  register(api) {
    pluginApi = api;
    api.registerCommand("displayname", displayNameCommand, undefined, "Change the name other players see");
  },
};
