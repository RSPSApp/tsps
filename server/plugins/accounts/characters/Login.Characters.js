const { maxCharactersPerAccount, characterDisplayName, characterListFor, defaultCharacterIndex } = require("./Picker.Characters");

class LoginSession {
  constructor(context) {
    this.context = context;
    this.api = context.api;
    this.send(this.api.core.encodePluginMessage("characters:slots", { maxPerAccount: maxCharactersPerAccount(this.api) }));
  }

  isBanned(name) { return this.api.getPlayerPunishment().banned(name); }
  isPrimaryBanned(account) {
    const primary = this.api.core.Accounts.primaryOf(account);
    return !!primary && this.isBanned(primary);
  }

  get pending() { return this.context.pending(); }
  send(packet) { this.context.send(packet); }

  authenticated(pending, { typedName, flags, credentials }) {
    const { Accounts, GameConstants } = this.api.core;
    const primaryName = pending.credentialName;
    const account = Accounts.accountOf(typedName) ?? Accounts.key(primaryName);
    const key = Accounts.key(typedName);
    const profile = pending.profile;
    const save = pending.save;
    // The default character enters at handshake unless the client selects another first.
    const wantsCharacterList = (flags & this.api.core.LOGIN_FLAG_CHARACTER_SELECT) !== 0;
    let characters;
    let defaultIndex;
    let username;
    let primaryDisplayName;
    let characterSave;
    let characterList = null;
    try {
      // An account record is written only for a name with a save; a name never entered stays in
      // memory until its handshake (enterWorld), so a login alone can't claim a name for good.
      if (credentials) Accounts.ensure(primaryName);
      characters = Accounts.entryOf(account)
        ? Accounts.charactersOf(account)
        : [{ name: primaryName, createdAt: Date.now(), lastPlayedAt: 0 }];
      // Clients without a picker must enter the name they typed.
      const enterTyped = !wantsCharacterList;
      defaultIndex = defaultCharacterIndex(this.api, characters, key, { enterTyped, banned: (name) => this.isBanned(name) });
      let chosen = characters[defaultIndex]?.name ?? primaryName;
      let isPrimary = Accounts.key(chosen) === Accounts.key(primaryName);
      characterSave = isPrimary ? save : null;
      if (!isPrimary) {
        try {
          characterSave = GameConstants.PLAYER_PERSISTENCE.load(chosen, profile) ?? null;
        } catch (error) {
          // One unreadable character doesn't lock the account: the primary enters instead.
          console.error(`[login] failed to load ${chosen}; defaulting to ${primaryName}`, error);
          defaultIndex = Math.max(0, characters.findIndex((c) => Accounts.key(c.name) === Accounts.key(primaryName)));
          chosen = primaryName;
          isPrimary = true;
          characterSave = save;
        }
      }
      // A character keeps the name it was first saved with (either profile's, for the primary);
      // the typed one only names a new account.
      const fallback = (name) => (Accounts.key(name) === Accounts.key(typedName) ? typedName : name);
      primaryDisplayName = characterDisplayName(this.api, primaryName, save ?? credentials, fallback(primaryName));
      username = isPrimary ? primaryDisplayName : characterDisplayName(this.api, chosen, characterSave, fallback(chosen));
      if (wantsCharacterList) characterList = characterListFor(this.api, characters, profile);
    } catch (error) {
      console.error(`[login] failed to read the characters of ${typedName}`, error);
      this.context.reject(8, "The login server is busy.");
    }

    if (defaultIndex < 0) this.context.reject(4, "Your account has been disabled.");
    Object.assign(pending, { account, characters, username, save: characterSave });
    this.list = characterList;
    this.defaultIndex = defaultIndex;
    return primaryDisplayName;
  }

  accepted() {
    if (this.list) this.send(this.api.core.encodeCharacterList(maxCharactersPerAccount(this.api), this.defaultIndex, this.list));
  }

  packet(packet) {
    switch (packet.type) {
      case "character_select": this.selectCharacter(packet.name); return true;
      case "character_create": this.createCharacter(packet.name); return true;
      case "character_delete": return this.deleteCharacter(packet.name, packet.confirmName).then(() => true);
      default: return false;
    }
  }

  entered(pending) {
    const { Accounts } = this.api.core;
    if (!Accounts.entryOf(pending.account)) Accounts.ensure(pending.characters[0]?.name ?? pending.username);
    Accounts.touchLastPlayed(pending.account, pending.username);
  }

  /** Between login and handshake: the character the handshake enters instead of the default. */
  selectCharacter(rawName) {
    const { Accounts, GameConstants, encodeCharacterResult } = this.api.core;
    const pending = this.pending;
    if (!pending || !this.context.isActive(pending)) {
      this.send(encodeCharacterResult(false, 4, "There is no character to choose right now."));
      return;
    }
    const character = pending.characters.find((c) => Accounts.key(c.name) === Accounts.key(String(rawName ?? "")));
    if (!character) {
      this.send(encodeCharacterResult(false, 4, "That character is not on this account."));
      return;
    }
    if (this.api.getPlayerPunishment().banned(character.name)) {
      this.send(encodeCharacterResult(false, 10, "That character has been disabled."));
      return;
    }
    // A ban on the primary landing while the account is on the picker covers every character.
    let primaryBanned;
    try {
      primaryBanned = this.isPrimaryBanned(pending.account);
    } catch (error) {
      console.error(`[login] failed to read the account of ${pending.account}`, error);
      this.send(encodeCharacterResult(false, 8, "The login server is busy."));
      return;
    }
    if (primaryBanned) {
      this.send(encodeCharacterResult(false, 10, "Your account has been disabled."));
      return;
    }
    if (this.context.isNameBusy(character.name)) {
      this.send(encodeCharacterResult(false, 7, "That character is already logged in."));
      return;
    }
    let save;
    try {
      save = GameConstants.PLAYER_PERSISTENCE.load(character.name, pending.profile) ?? null;
    } catch (error) {
      console.error(`[login] failed to load ${character.name}`, error);
      this.send(encodeCharacterResult(false, 8, "The login server is busy."));
      return;
    }
    this.context.reserveName(character.name);
    pending.username = characterDisplayName(this.api, character.name, save);
    pending.save = save;
    this.send(encodeCharacterResult(true, 0, ""));
  }

  /** The fresh character list after a create or delete, marking the character the handshake enters. */
  sendCharacterList(pending) {
    const { Accounts, encodeCharacterList } = this.api.core;
    const index = pending.characters.findIndex((c) => Accounts.key(c.name) === Accounts.key(pending.username));
    const defaultIndex = index >= 0 ? index : Math.max(0, defaultCharacterIndex(this.api, pending.characters, pending.username, { banned: (name) => this.isBanned(name) }));
    this.send(encodeCharacterList(maxCharactersPerAccount(this.api), defaultIndex, characterListFor(this.api, pending.characters, pending.profile)));
  }

  /** Between login and handshake: adds a character to the account. Creating writes no save. */
  createCharacter(rawName) {
    const { Accounts, DisplayNames, Misc, GameConstants, MAIN_PROFILE, LEAGUE_PROFILE, encodeCharacterResult } = this.api.core;
    const pending = this.pending;
    if (!pending || !this.context.isActive(pending)) {
      this.send(encodeCharacterResult(false, 4, "There is no account to add a character to right now."));
      return;
    }
    try {
      const primary = Accounts.primaryOf(pending.account);
      const persistence = GameConstants.PLAYER_PERSISTENCE;
      // A banned primary bans the account (login refuses it too); a ban landing mid-picker stops creation.
      if (this.isPrimaryBanned(pending.account)) {
        this.send(encodeCharacterResult(false, 10, "Your account has been disabled."));
        return;
      }
      if (!primary || !(persistence.exists(primary, MAIN_PROFILE) || persistence.exists(primary, LEAGUE_PROFILE))) {
        this.send(encodeCharacterResult(false, 9, "Enter the world once with your first character."));
        return;
      }
      const name = String(rawName ?? "").trim();
      const protocolName = Misc.formatNameForProtocol(name);
      if (protocolName.length < 1 || protocolName.length > 12 || !Misc.isValidName(name)) {
        this.send(encodeCharacterResult(false, 2, "Names are 1 to 12 letters, numbers and spaces."));
        return;
      }
      // Taken: another account's character, save, online or pending login, a name another account
      // deleted (kept reserved), or another account's current or held display name (the shared
      // namespace). A name this account deleted comes back to it.
      const nameKey = DisplayNames.key(name);
      if (Accounts.isDeleted(nameKey) && !Accounts.deletedBy(nameKey, pending.account)) {
        this.send(encodeCharacterResult(false, 1, "That name belonged to a deleted character and can't be used again."));
        return;
      }
      const owner = DisplayNames.ownerOf(nameKey);
      if ((owner !== undefined && owner !== nameKey) || DisplayNames.loginNameInUse(nameKey, pending.account)) {
        this.send(encodeCharacterResult(false, 1, "That name is not available."));
        return;
      }
      if (Accounts.charactersOf(pending.account).length >= maxCharactersPerAccount(this.api)) {
        this.send(encodeCharacterResult(false, 3, "You can't make more characters."));
        return;
      }
      Accounts.addCharacter(pending.account, Misc.formatDisplayName(name));
    } catch (error) {
      console.error(`[login] failed to create a character for ${pending.account}`, error);
      this.send(encodeCharacterResult(false, 8, "The login server is busy."));
      return;
    }
    // The character exists from here on: always answer ok, even if refreshing the list fails.
    this.send(encodeCharacterResult(true, 0, ""));
    try {
      pending.characters = Accounts.charactersOf(pending.account).slice();
      this.sendCharacterList(pending);
    } catch (error) {
      console.error(`[login] failed to refresh the character list of ${pending.account}`, error);
    }
  }

  /** Between login and handshake: deletes a non-primary character and its saves. */
  async deleteCharacter(rawName, rawConfirm) {
    const { Accounts, DisplayNames, GameConstants, MAIN_PROFILE, LEAGUE_PROFILE, encodeCharacterResult } = this.api.core;
    const pending = this.pending;
    if (!pending || !this.context.isActive(pending)) {
      this.send(encodeCharacterResult(false, 4, "There is no account to delete a character from right now."));
      return;
    }
    const character = pending.characters.find((c) => Accounts.key(c.name) === Accounts.key(String(rawName ?? "")));
    if (!character) {
      this.send(encodeCharacterResult(false, 4, "That character is not on this account."));
      return;
    }
    if (Accounts.isPrimary(pending.account, character.name)) {
      this.send(encodeCharacterResult(false, 5, "Your first character can't be deleted."));
      return;
    }
    if (this.context.isNameBusy(character.name)) {
      this.send(encodeCharacterResult(false, 7, "That character is logged in."));
      return;
    }
    if (DisplayNames.key(String(rawConfirm ?? "")) !== DisplayNames.key(character.name)) {
      this.send(encodeCharacterResult(false, 6, "The name you typed does not match."));
      return;
    }
    // Each delete reserves its name; an account can only hold so many. Refused before any save goes.
    let canDelete;
    try {
      canDelete = Accounts.canDelete(pending.account);
    } catch (error) {
      console.error(`[login] failed to read the deleted names of ${pending.account}`, error);
      this.send(encodeCharacterResult(false, 8, "The character could not be deleted."));
      return;
    }
    if (!canDelete) {
      this.send(encodeCharacterResult(false, 11, "You have deleted too many characters. Ask a member of staff to free a name."));
      return;
    }
    const persistence = GameConstants.PLAYER_PERSISTENCE;
    const removesPending = Accounts.key(pending.username) === Accounts.key(character.name);
    let fallback;
    try {
      // Everything that can fail before the account changes: the fallback's save, then the deletes.
      if (removesPending) {
        const remaining = pending.characters.filter((c) => Accounts.key(c.name) !== Accounts.key(character.name));
        const next = remaining[Math.max(0, defaultCharacterIndex(this.api, remaining, pending.account, { banned: (name) => this.isBanned(name) }))];
        fallback = { name: next.name, save: persistence.load(next.name, pending.profile) ?? null };
      }
      for (const profile of [MAIN_PROFILE, LEAGUE_PROFILE]) {
        try {
          await persistence.delete(character.name, profile);
        } catch (error) {
          // A backend that keeps no per-name saves has nothing to delete.
          if (!String(error?.message ?? error).includes("does not support")) throw error;
        }
      }
      if (!this.context.isActive(pending)) {
        // The saves are gone and the player confirmed: the account forgets the character too.
        Accounts.removeCharacter(pending.account, character.name);
        this.send(encodeCharacterResult(false, 4, "There is no account to delete a character from right now."));
        return;
      }
      Accounts.removeCharacter(pending.account, character.name);
    } catch (error) {
      console.error(`[login] failed to delete ${character.name}`, error);
      this.send(encodeCharacterResult(false, 8, "The character could not be deleted."));
      return;
    }
    // The character is gone from here on: update the pending login and always answer ok.
    pending.characters = Accounts.charactersOf(pending.account).slice();
    this.context.releaseName(character.name);
    if (fallback) {
      this.context.reserveName(fallback.name);
      pending.username = characterDisplayName(this.api, fallback.name, fallback.save);
      pending.save = fallback.save;
    }
    this.send(encodeCharacterResult(true, 0, ""));
    try {
      this.sendCharacterList(pending);
    } catch (error) {
      console.error(`[login] failed to refresh the character list of ${pending.account}`, error);
    }
  }

}

function createLoginExtension(context) {
  if (maxCharactersPerAccount(context.api) <= 1) return undefined;
  return new LoginSession(context);
}

module.exports = { createLoginExtension };
