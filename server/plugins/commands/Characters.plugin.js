/**
 * ::characters <name> - the characters of the account that owns <name>, primary first, with when
 * each last played. Read-only; the account record lives in the core (Accounts).
 */

function lastPlayed(at) {
  return at > 0 ? `${new Date(at).toISOString().slice(0, 16).replace("T", " ")} UTC` : "never";
}

module.exports = {
  name: "Characters",
  register(api) {
    api.registerCommand(
      "characters",
      ({ player, raw }) => {
        // Everything after the command word, which may have come as "::characters" or "/characters".
        const name = raw.replace(/^\S+/, "").trim();
        if (!name) {
          player.sendMessage("Usage: ::characters <name>");
          return true;
        }
        const { Accounts } = api.core;
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
      },
      api.core.PlayerRights.DEVELOPER,
      "List an account's characters"
    );
  },
};
