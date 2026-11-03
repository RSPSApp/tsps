const { GameConstants } = require("../../src/main/typescript/elvarg/game/GameConstants");
const { Misc } = require("../../src/main/typescript/elvarg/util/Misc");
const { PasswordUtil } = require("../../src/main/typescript/elvarg/util/PasswordUtil");
const { Item } = require("../../src/main/typescript/elvarg/game/model/Item");
const { SkullType } = require("../../src/main/typescript/elvarg/game/model/SkullType");
const { DonatorRights } = require("../../src/main/typescript/elvarg/game/model/rights/DonatorRights");
const { PlayerRights } = require("../../src/main/typescript/elvarg/game/model/rights/PlayerRights");

const INAPPROPRIATE_TITLES = ["nigger", "ass", "boobs"];
const XP_LOCKED_ATTRIBUTE = "skills:xp-locked";
const LOYALTY_TITLE_ATTRIBUTE = "loyalty:title";
const YELL_UNTIL_ATTRIBUTE = "yell:until";
const JOURNAL_GROUP = 119;
const JOURNAL_TITLE = (JOURNAL_GROUP << 16) | 5;
const JOURNAL_CLOSE = (JOURNAL_GROUP << 16) | 8;
const JOURNAL_SWITCH = (JOURNAL_GROUP << 16) | 9;
const JOURNAL_BACK = (JOURNAL_GROUP << 16) | 10;
const JOURNAL_FIRST_LINE = 11;
const JOURNAL_LINE_COUNT = 210;
const JOURNAL_LINES_VARP = 4398;
const JOURNAL_RESET_SCRIPT = 5240;
const JOURNAL_SCROLL_SCRIPT = 2523;
const FLOATER_OVERLAY = (161 << 16) | 18;

function home({ player }) {
  const destination = core.WorldDefinition.WORLD_SPAWN.clone();
  if (core.TeleportHandler.checkReqs(player, destination)) {
    core.TeleportHandler.teleport(player, destination, core.TeleportType.NORMAL, false);
  }
  return true;
}

function staff({ player }) {
  const online = [...World.getPlayers()].filter((candidate) => candidate &&
    candidate.isPlayerBot?.() !== true && World.isPlayerSessionConnected(candidate) && candidate.isStaff());
  online.sort((a, b) => a.getUsername().localeCompare(b.getUsername()));
  const lines = online.map((candidate) => {
    const rank = Object.entries(core.PlayerRights).find(([, rights]) => rights === candidate.getRights())[0];
    return `${candidate.getUsername()} - ${rank.charAt(0)}${rank.slice(1).toLowerCase()}`;
  });
  if (lines.length === 0) lines.push("No staff are currently online.");
  // shortcut: the native journal has 210 rows; add paging if a world exceeds that many online staff.
  if (lines.length > JOURNAL_LINE_COUNT) lines.splice(JOURNAL_LINE_COUNT - 1, Infinity, "More staff are online than this scroll can display.");
  const sender = player.getPacketSender();
  sender.sendConfig(JOURNAL_LINES_VARP, lines.length);
  sender.sendSubInterface(FLOATER_OVERLAY, JOURNAL_GROUP, 0);
  sender.sendInterfaceFlagsRange(JOURNAL_CLOSE, -1, -1, 1 << 1);
  sender.sendInterfaceScript(JOURNAL_RESET_SCRIPT, []);
  sender.sendInterfaceDisplayState(JOURNAL_SWITCH, true);
  sender.sendInterfaceDisplayState(JOURNAL_BACK, true);
  sender.sendString(`<col=7f0000>Online staff (${online.length})</col>`, JOURNAL_TITLE);
  lines.forEach((line, index) => sender.sendString(`<col=000080>${line}</col>`, (JOURNAL_GROUP << 16) | (JOURNAL_FIRST_LINE + index)));
  sender.sendInterfaceScript(JOURNAL_SCROLL_SCRIPT, [0, lines.length]);
  return true;
}

function closeStaff({ player }) {
  player.getPacketSender().closeSubInterface(FLOATER_OVERLAY);
}

function commandTail(raw, parts) {
  return raw.substring(parts[0].length).trim();
}

function parseIntArg(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function sendOnlinePlayers(player) {
  const connectedNames = [];
  for (const worldPlayer of World.getPlayers()) {
    if (!worldPlayer || worldPlayer.isPlayerBot?.() === true || !World.isPlayerSessionConnected(worldPlayer)) {
      continue;
    }
    connectedNames.push(worldPlayer.getUsername());
  }
  connectedNames.sort((a, b) => a.localeCompare(b));
  player.sendMessage(`Online players (${connectedNames.length}):`);
  if (connectedNames.length === 0) {
    player.sendMessage("none");
    return;
  }

  let line = "";
  for (const name of connectedNames) {
    const next = line.length === 0 ? name : `${line}, ${name}`;
    if (next.length > 180) {
      player.sendMessage(line);
      line = name;
    } else {
      line = next;
    }
  }
  if (line.length > 0) {
    player.sendMessage(line);
  }
}

function yellPrefix(player) {
  const staffTag = player.getRights()?.getYellTag?.();
  if (staffTag && staffTag.length > 0) {
    return staffTag;
  }
  const donatorTag = DonatorRights.getYellTag(player.getDonatorRights?.());
  return donatorTag || "";
}

function yellDelaySeconds(player) {
  if (player.isStaff()) {
    return 0;
  }
  return DonatorRights.getYellDelay(player.getDonatorRights?.());
}

function canChangeSkull(player) {
  if (!CombatFactory.inCombat(player)) {
    return true;
  }
  player.sendMessage("You cannot change that during combat!");
  return false;
}

function confirmSkull(api, player, type, duration, warning) {
  if (!canChangeSkull(player)) {
    return;
  }
  api.sendMultiChatboxPrompt(
    player,
    warning,
    "Yes",
    () => {
      if (canChangeSkull(player)) {
        CombatFactory.skull(player, type, duration);
      }
    },
    "No",
    () => {}
  );
}

let World;
let ItemOnGroundManager;
let CombatFactory;
let PlayerPunishment;
let core;

module.exports = {
  name: "PlayerCommands",
  register(api) {
    core = api.core;
    World = api.getWorld();
    ItemOnGroundManager = api.getItemOnGroundManager();
    CombatFactory = api.getCombatFactory();
    PlayerPunishment = api.getPlayerPunishment();
    api.registerCommand("home", home, api.core.PlayerRights.NONE, "Teleport to the world spawn");
    api.registerCommand("staff", staff, api.core.PlayerRights.NONE, "List online staff and their ranks");
    api.onInterfaceActionButton(JOURNAL_CLOSE, closeStaff);
    api.registerCommand("players", ({ player }) => {
      sendOnlinePlayers(player);
      return true;
    }, undefined, "List online players");

    api.registerCommand("online", ({ player }) => {
      sendOnlinePlayers(player);
      return true;
    }, undefined, "List online players");

    api.registerCommand("who", ({ player }) => {
      sendOnlinePlayers(player);
      return true;
    }, undefined, "List online players");

    api.registerCommand("claim", ({ player }) => {
      player.sendMessage("To claim purchased items, please talk to the Financial Advisor at home.");
      return true;
    }, undefined, "Purchase-claim information");

    api.registerCommand("store", ({ player }) => {
      player.getPacketSender().sendURL("http://www.deadlypkers.net");
      return true;
    }, undefined, "Open the store");

    api.registerCommand("donate", ({ player }) => {
      player.getPacketSender().sendURL("http://www.deadlypkers.net");
      return true;
    }, undefined, "Open the store");

    api.registerCommand("timeplayed", ({ player }) => {
      player.forceChat(`I've been playing for ${Misc.getFormattedPlayTime(player)}.`);
      return true;
    }, undefined, "Say your play time");

    api.registerCommand("creationdate", ({ player }) => {
      const calendar = new Date(player.getCreationDate().getTime());
      let dateSuffix = "th";
      switch (calendar.getDate() % 10) {
        case 1:
          dateSuffix = "st";
          break;
        case 2:
          dateSuffix = "nd";
          break;
        case 3:
          dateSuffix = "rd";
          break;
      }
      player.forceChat(
        `I started playing on the ${calendar.getDate()}${dateSuffix} of ${new Intl.DateTimeFormat("en-US", {
          month: "long",
        }).format(calendar)}, ${calendar.getFullYear()}!`
      );
      return true;
    }, undefined, "Say your account creation date");

    api.registerCommand("changepassword", async ({ player, raw, parts }) => {
      if (raw.includes("\r") || raw.includes("\n")) {
        return true;
      }
      const pass = commandTail(raw, parts);
      if (pass.length <= 3 || pass.length >= 20) {
        player.sendMessage("Invalid password input.");
        return true;
      }
      try {
        const passwordHash = await PasswordUtil.generatePasswordHashWithSalt(pass);
        // The account's credential: this character, its save, and its other character's save.
        await api.core.GameConstants.PLAYER_PERSISTENCE.changePassword(player, passwordHash);
        player.sendMessage(`Your password is now: ${pass}`);
      } catch (err) {
        console.error(err);
        player.sendMessage("An error occurred while changing your password.");
      }
      return true;
    }, undefined, "Change password");

    api.registerCommand("lockxp", ({ player }) => {
      const locked = player.getAttribute(XP_LOCKED_ATTRIBUTE) !== true;
      player.setAttribute(XP_LOCKED_ATTRIBUTE, locked);
      player.sendMessage(`Lock: ${locked}`);
      return true;
    }, undefined, "Toggle experience lock");

    api.registerCommand("thread", async ({ player, parts }) => {
      if (parts.length !== 2) {
        player.sendMessage("Please enter a valid command.");
        return true;
      }
      const id = parseIntArg(parts[1]);
      if (id === null) {
        player.sendMessage("Please enter a valid command.");
        return true;
      }
      try {
        const url = new URL(`https://www.deadlypkers.net/server_data/fetch_thread_link.php?ID=${id}`);
        const con = await fetch(url.toString());
        const data = await con.text();
        if (data) {
          player.getPacketSender().sendURL(data);
        }
      } catch (error) {
        console.error(error);
      }
      return true;
    }, undefined, "Open a forum thread");

    api.registerCommand("title", ({ player, parts }) => {
      if (parts.length < 2) {
        player.sendMessage("Usage: ::title text");
        return true;
      }
      const nextTitle = parts.slice(1).join(" ");
      if (INAPPROPRIATE_TITLES.some((bad) => nextTitle.toLowerCase().includes(bad))) {
        player.sendMessage("You're not allowed to have that in your title.");
        return true;
      }
      player.setAttribute(LOYALTY_TITLE_ATTRIBUTE, `@blu@${nextTitle}`);
      return true;
    }, undefined, "Set your title");

    api.registerCommand("skull", ({ player }) => {
      confirmSkull(
        api,
        player,
        SkullType.WHITE_SKULL,
        300,
        "Skulling yourself can make you lose every carried item. Are you sure?"
      );
      return true;
    }, undefined, "Apply a white skull");

    api.registerCommand("redskull", ({ player }) => {
      confirmSkull(
        api,
        player,
        SkullType.RED_SKULL,
        60 * 30,
        "A red skull makes you lose every carried item and disables Protect Item. Continue?"
      );
      return true;
    }, undefined, "Apply a red skull");

    // Stays inline: donator is a separate rights ladder, so no PlayerRights array covers it.
    api.registerCommand("yell", ({ player, raw }) => {
      if (!player.isStaff() && !player.isDonator()) {
        player.sendMessage("You do not have permission to use this command.");
        return true;
      }
      if (PlayerPunishment.muted(player.getUsername()) || PlayerPunishment.IPMuted(player.getHostAddress())) {
        player.sendMessage("You are muted and cannot yell.");
        return true;
      }
      const yellWaitMs = Number(player.getAttribute(YELL_UNTIL_ATTRIBUTE) ?? 0) - Date.now();
      if (yellWaitMs > 0) {
        player.sendMessage(`You must wait another ${Math.ceil(yellWaitMs / 1000)} seconds to do that.`);
        return true;
      }

      const yellMessage = raw.substring(4).trim();
      if (!yellMessage.length) {
        return true;
      }
      if (Misc.blockedWord(yellMessage)) {
        return true;
      }

      const sprite = (player.getChatIcons?.() ?? [])
        .map((icon) => `<img=${icon}>`)
        .join("");
      const prefix = yellPrefix(player);
      const yell = `<col=7f0000>${prefix} ${sprite} ${player.getUsername()}: ${yellMessage}</col>`.trim();
      World.getPlayers().forEach((p) => p?.sendMessage(yell));

      const delaySeconds = yellDelaySeconds(player);
      if (delaySeconds > 0) {
        player.setAttribute(YELL_UNTIL_ATTRIBUTE, Date.now() + delaySeconds * 1000);
      }
      return true;
    }, undefined, "Staff and donors only");

    // Legacy owner-only test command from the TS command package.
    api.registerCommand("ground", ({ player }) => {
      ItemOnGroundManager.registers(player, new Item(995, 10000));
      player.sendMessage("Spawned ground item..");
      return true;
    }, PlayerRights.OWNER, "Spawn ground coins");
  },
};
