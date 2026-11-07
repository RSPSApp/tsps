/**
 * ::characters <name> - the characters of the account that owns <name>, primary first, with when
 * each last played. Read-only; the account record lives in the core (Accounts).
 * ::releasename <name> - frees a deleted character's name (its tombstone) for anyone to take.
 */

function lastPlayed(at) {
  return at > 0 ? `${new Date(at).toISOString().slice(0, 16).replace("T", " ")} UTC` : "never";
}

/** Everything after the command word, which may have come as "::name" or "/name". */
function argument(raw) {
  return raw.replace(/^\S+/, "").trim();
}

function releaseName(api, { player, raw }) {
  const core = api.core;
  const name = argument(raw);
  if (!name) {
    player.sendMessage("Usage: ::releasename <name>");
    return true;
  }
  const released = core.Accounts.releaseDeleted(name);
  if (!released) {
    player.sendMessage("No deleted character had that name.");
    return true;
  }
  const by = released.account ? ` (deleted by ${released.account})` : "";
  player.sendMessage(`Released ${released.name}${by}. The name can be used again.`);
  return true;
}

function listCharacters(api, { player, raw }) {
  const core = api.core;
  const name = argument(raw);
  if (!name) {
    player.sendMessage("Usage: ::characters <name>");
    return true;
  }
  const { Accounts } = core;
  const account = Accounts.accountOf(name);
  if (!account) {
    player.sendMessage("No account owns that name.");
    return true;
  }
  Accounts.charactersOf(account).forEach((character, index) => {
    const primary = index === 0 ? " (primary)" : "";
    player.sendMessage(`${character.name}${primary} · last played ${lastPlayed(character.lastPlayedAt)}`);
  });
  return true;
}

function registerCommands(api) {
  api.registerCommand("characters", listCharacters.bind(null, api), api.core.PlayerRights.DEVELOPER, "List an account's characters");
  api.registerCommand("releasename", releaseName.bind(null, api), api.core.PlayerRights.ADMINISTRATOR, "Free a deleted character's name");
}

module.exports = registerCommands;
