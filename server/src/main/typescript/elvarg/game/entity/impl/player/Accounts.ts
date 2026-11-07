import * as fs from "fs";
import * as path from "path";
import { DisplayNames } from "./DisplayNames";

export interface AccountCharacter {
    /** The name as the player typed it. */
    name: string;
    createdAt: number;
    /** When it last logged in (ms), 0 for never. */
    lastPlayedAt: number;
}

export interface AccountEntry {
    createdAt: number;
    /** The first is the primary: the name the account logs in with. */
    characters: AccountCharacter[];
}

/**
 * A deleted character's name: claimable only by the account that deleted it, since display names,
 * clans and punishments are keyed by it. Staff can release it (`releaseDeleted`).
 */
export interface DeletedName {
    /** The name as the account had it. */
    name: string;
    /** The account that deleted it ("" for a tombstone written before this was recorded: nobody's). */
    account: string;
    deletedAt: number;
}

/**
 * Accounts: one login name owning several character names. The account is keyed by its primary
 * (login) name; every character name leads to one account. The file is written whole on every
 * structural change (characters change rarely). Last-played times change on every world entry,
 * so they are kept in memory and written at most once per `LAST_PLAYED_WRITE_DELAY_MS`, by the
 * next structural write, or by `flush()` at shutdown, whichever comes first.
 *
 * A deleted character's name is kept under `deleted` (a tombstone). Everything else keyed by a
 * login name (display names, clan ranks, bans and mutes) stays behind on delete, so the name must
 * never lead to another account: only the account that deleted it may create it again (which
 * removes the tombstone), and staff may release it. An account holds at most
 * MAX_TOMBSTONES_PER_ACCOUNT, so deleting can't reserve names without bound. A file from before
 * tombstones has no `deleted` and loads as none.
 */
export class Accounts {
    static readonly FILE_ENV = "TSPS_ACCOUNTS_FILE";
    private static entries: Map<string, AccountEntry> | null = null;
    /** Character name key -> account key. */
    private static owners = new Map<string, string>();
    /** Name key -> tombstone of a deleted character. */
    private static deleted = new Map<string, DeletedName>();
    /** The most deleted names one account may hold reserved; a delete beyond it is refused. */
    static readonly MAX_TOMBSTONES_PER_ACCOUNT = 6;
    /** The longest a last-played time waits in memory before it is written. */
    static readonly LAST_PLAYED_WRITE_DELAY_MS = 30_000;
    /** Last-played times changed since the file was last written. */
    private static dirty = false;
    private static writeTimer: ReturnType<typeof setTimeout> | null = null;

    /** The key two names share when they are the same name. */
    public static key(name: string): string {
        return DisplayNames.key(name);
    }

    private static file(): string {
        return process.env[Accounts.FILE_ENV] || path.join(process.cwd(), "data", "saves", "accounts.json");
    }

    private static load(): Map<string, AccountEntry> {
        if (this.entries) return this.entries;
        const loaded = new Map<string, AccountEntry>();
        const deleted = new Map<string, DeletedName>();
        let saved: any;
        try {
            saved = JSON.parse(fs.readFileSync(this.file(), "utf8"));
        } catch (error: any) {
            if (error?.code !== "ENOENT") throw Accounts.unreadable(this.file(), error);
            saved = { accounts: {} };
        }
        if (!saved || typeof saved !== "object") throw Accounts.unreadable(this.file(), new Error("not a JSON object"));
        for (const [account, entry] of Object.entries<any>(saved.accounts ?? {})) {
            loaded.set(account, {
                createdAt: Number(entry.createdAt) || 0,
                characters: Array.isArray(entry.characters)
                    ? entry.characters.map((c: any) => ({
                          name: String(c.name),
                          createdAt: Number(c.createdAt) || 0,
                          lastPlayedAt: Number(c.lastPlayedAt) || 0,
                      }))
                    : [],
            });
        }
        // A missing list is a file from before tombstones; a present one that isn't an object would otherwise load
        // as none (or as junk) and the next save() would release the reserved names.
        if ("deleted" in saved && (!saved.deleted || typeof saved.deleted !== "object" || Array.isArray(saved.deleted))) {
            throw Accounts.unreadable(this.file(), new Error("\"deleted\" is not an object"));
        }
        for (const [nameKey, tombstone] of Object.entries<any>(saved.deleted ?? {})) {
            deleted.set(this.key(nameKey), {
                name: String(tombstone?.name ?? nameKey),
                account: String(tombstone?.account ?? ""),
                deletedAt: Number(tombstone?.deletedAt) || 0,
            });
        }
        // Only once it has all been read: a file that can't be keeps throwing, so save() can't replace it.
        this.entries = loaded;
        this.deleted = deleted;
        this.reindex();
        return loaded;
    }

    /** The error for a file that exists but can't be read, naming it for the operator; every login is refused meanwhile. */
    private static unreadable(file: string, cause: any): Error {
        const error = new Error(
            `[accounts] ${file} could not be read (${cause?.message ?? cause}). It records which characters each ` +
                "account owns, the alts' passwords (through their primary) and deleted names. Every login is " +
                "refused until it is repaired or restored from the backup taken together with the saves database.",
        );
        (error as any).cause = cause;
        return error;
    }

    private static reindex(): void {
        this.owners.clear();
        for (const [account, entry] of this.entries ?? []) {
            for (const character of entry.characters) this.owners.set(this.key(character.name), account);
        }
    }

    private static save(): void {
        const target = this.file();
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const temporary = `${target}.tmp`;
        fs.writeFileSync(temporary, JSON.stringify({ accounts: Object.fromEntries(this.load()), deleted: Object.fromEntries(this.deleted) }, null, 2));
        fs.renameSync(temporary, target);
        // Every write is the whole file: pending last-played times went with it.
        this.dirty = false;
        this.clearWriteTimer();
    }

    private static clearWriteTimer(): void {
        if (this.writeTimer) clearTimeout(this.writeTimer);
        this.writeTimer = null;
    }

    /** Writes pending last-played times now (shutdown). Throws when the file can't be written; they stay pending. */
    public static flush(): void {
        if (!this.dirty || !this.entries) return;
        this.save();
    }

    private static scheduleWrite(): void {
        if (this.writeTimer) return;
        this.writeTimer = setTimeout(() => {
            this.writeTimer = null;
            try {
                this.flush();
            } catch (error) {
                console.error("[accounts] could not write last-played times; retrying later", error);
                this.scheduleWrite();
            }
        }, this.LAST_PLAYED_WRITE_DELAY_MS);
        // Never what keeps the process alive; shutdown flushes.
        (this.writeTimer as any)?.unref?.();
    }

    /** The account key owning this character name (the primary included), or undefined. */
    public static accountOf(name: string): string | undefined {
        this.load();
        return this.owners.get(this.key(name));
    }

    /** Whether this name belonged to a deleted character: it can never be a character or login name again. */
    public static isDeleted(name: string): boolean {
        this.load();
        return this.deleted.has(this.key(name));
    }

    public static deletedOf(name: string): DeletedName | undefined {
        this.load();
        return this.deleted.get(this.key(name));
    }

    /** How many deleted names this account holds reserved. */
    public static deletedCountOf(accountKey: string): number {
        this.load();
        const account = this.key(accountKey);
        let count = 0;
        for (const tombstone of this.deleted.values()) if (tombstone.account === account) count++;
        return count;
    }

    /** Whether the account may delete another character (it holds fewer than MAX_TOMBSTONES_PER_ACCOUNT). */
    public static canDelete(accountKey: string): boolean {
        return this.deletedCountOf(accountKey) < this.MAX_TOMBSTONES_PER_ACCOUNT;
    }

    /** Whether this deleted name was deleted by this account, which may create it again. */
    public static deletedBy(name: string, accountKey: string): boolean {
        const tombstone = this.deletedOf(name);
        return tombstone !== undefined && tombstone.account !== "" && tombstone.account === this.key(accountKey);
    }

    /**
     * Staff: frees a deleted name for anyone, returning its tombstone (undefined when the name has
     * none). What stayed keyed by the name (display names, clan rank, bans, mutes) goes with it to
     * whoever takes it next. Throws, changing nothing, when the file can't be written.
     */
    public static releaseDeleted(name: string): DeletedName | undefined {
        this.load();
        const nameKey = this.key(name);
        const tombstone = this.deleted.get(nameKey);
        if (!tombstone) return undefined;
        this.deleted.delete(nameKey);
        try {
            this.save();
        } catch (error) {
            this.deleted.set(nameKey, tombstone);
            throw error;
        }
        return tombstone;
    }

    public static entryOf(accountKey: string): AccountEntry | undefined {
        return this.load().get(this.key(accountKey));
    }

    public static charactersOf(accountKey: string): AccountCharacter[] {
        return this.entryOf(accountKey)?.characters ?? [];
    }

    public static primaryOf(accountKey: string): string | undefined {
        return this.charactersOf(accountKey)[0]?.name;
    }

    public static isPrimary(accountKey: string, name: string): boolean {
        const primary = this.primaryOf(accountKey);
        return primary !== undefined && this.key(primary) === this.key(name);
    }

    /** The account for this login name, created with the name as its first character when it has none. */
    public static ensure(primaryName: string, now = Date.now()): AccountEntry {
        const entries = this.load();
        const account = this.key(primaryName);
        const existing = entries.get(account);
        if (existing) return existing;
        if (this.deleted.has(account)) throw new Error("That name belonged to a deleted character");
        const entry: AccountEntry = { createdAt: now, characters: [{ name: primaryName, createdAt: now, lastPlayedAt: 0 }] };
        entries.set(account, entry);
        try {
            this.save();
        } catch (error) {
            entries.delete(account);
            throw error;
        }
        this.reindex();
        return entry;
    }

    /**
     * Adds a character to the account. A name this account deleted comes back, its tombstone removed
     * in the same write. Throws, changing nothing, when the name is owned, another account's deleted
     * name, or the file can't be written.
     */
    public static addCharacter(accountKey: string, name: string, now = Date.now()): AccountCharacter {
        const entry = this.entryOf(accountKey);
        if (!entry) throw new Error("No such account");
        if (this.accountOf(name)) throw new Error("That name is owned by an account");
        const nameKey = this.key(name);
        const tombstone = this.deleted.get(nameKey);
        if (tombstone && !this.deletedBy(name, accountKey)) throw new Error("That name belonged to a deleted character");
        const character: AccountCharacter = { name, createdAt: now, lastPlayedAt: 0 };
        entry.characters.push(character);
        if (tombstone) this.deleted.delete(nameKey);
        try {
            this.save();
        } catch (error) {
            entry.characters.pop();
            if (tombstone) this.deleted.set(nameKey, tombstone);
            throw error;
        }
        this.reindex();
        return character;
    }

    /**
     * Removes a character and keeps its name as a tombstone, in one write. False, changing nothing,
     * for the primary or a name the account doesn't have. Throws, changing nothing, when the
     * account already holds MAX_TOMBSTONES_PER_ACCOUNT (check canDelete first) or the file can't be written.
     */
    public static removeCharacter(accountKey: string, name: string, now = Date.now()): boolean {
        const entry = this.entryOf(accountKey);
        if (!entry || this.isPrimary(accountKey, name)) return false;
        const index = entry.characters.findIndex((c) => this.key(c.name) === this.key(name));
        if (index < 0) return false;
        if (!this.canDelete(accountKey)) throw new Error("That account has deleted too many characters");
        const [removed] = entry.characters.splice(index, 1);
        const nameKey = this.key(removed.name);
        const before = this.deleted.get(nameKey);
        this.deleted.set(nameKey, { name: removed.name, account: this.key(accountKey), deletedAt: now });
        try {
            this.save();
        } catch (error) {
            entry.characters.splice(index, 0, removed);
            if (before) this.deleted.set(nameKey, before);
            else this.deleted.delete(nameKey);
            throw error;
        }
        this.reindex();
        return true;
    }

    /** Records a world entry in memory now; the file gets it within LAST_PLAYED_WRITE_DELAY_MS (see the class doc). */
    public static touchLastPlayed(accountKey: string, name: string, now = Date.now()): void {
        const character = this.charactersOf(accountKey).find((c) => this.key(c.name) === this.key(name));
        if (!character) return;
        character.lastPlayedAt = now;
        this.dirty = true;
        this.scheduleWrite();
    }

    /** Forgets what is in memory, so tests can read the file again as a restart would. */
    public static reset(): void {
        this.clearWriteTimer();
        this.dirty = false;
        this.entries = null;
        this.owners.clear();
        this.deleted = new Map();
    }
}
