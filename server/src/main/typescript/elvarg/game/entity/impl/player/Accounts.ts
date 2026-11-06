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
 * Accounts: one login name owning several character names. The account is keyed by its primary
 * (login) name; every character name leads to one account. The file is written whole on every
 * change: characters change rarely.
 */
export class Accounts {
    static readonly FILE_ENV = "TSPS_ACCOUNTS_FILE";
    private static entries: Map<string, AccountEntry> | null = null;
    /** Character name key -> account key. */
    private static owners = new Map<string, string>();

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
        let saved: any;
        try {
            saved = JSON.parse(fs.readFileSync(this.file(), "utf8"));
        } catch (error: any) {
            if (error?.code !== "ENOENT") throw error;
            saved = { accounts: {} };
        }
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
        // Only once it has all been read: a file that can't be keeps throwing, so save() can't replace it.
        this.entries = loaded;
        this.reindex();
        return loaded;
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
        fs.writeFileSync(temporary, JSON.stringify({ accounts: Object.fromEntries(this.load()) }, null, 2));
        fs.renameSync(temporary, target);
    }

    /** The account key owning this character name (the primary included), or undefined. */
    public static accountOf(name: string): string | undefined {
        this.load();
        return this.owners.get(this.key(name));
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

    /** Adds a character to the account. Throws, changing nothing, when the name is owned or the file can't be written. */
    public static addCharacter(accountKey: string, name: string, now = Date.now()): AccountCharacter {
        const entry = this.entryOf(accountKey);
        if (!entry) throw new Error("No such account");
        if (this.accountOf(name)) throw new Error("That name is owned by an account");
        const character: AccountCharacter = { name, createdAt: now, lastPlayedAt: 0 };
        entry.characters.push(character);
        try {
            this.save();
        } catch (error) {
            entry.characters.pop();
            throw error;
        }
        this.reindex();
        return character;
    }

    /** Removes a character. False, changing nothing, for the primary or a name the account doesn't have. */
    public static removeCharacter(accountKey: string, name: string): boolean {
        const entry = this.entryOf(accountKey);
        if (!entry || this.isPrimary(accountKey, name)) return false;
        const index = entry.characters.findIndex((c) => this.key(c.name) === this.key(name));
        if (index < 0) return false;
        const [removed] = entry.characters.splice(index, 1);
        try {
            this.save();
        } catch (error) {
            entry.characters.splice(index, 0, removed);
            throw error;
        }
        this.reindex();
        return true;
    }

    public static touchLastPlayed(accountKey: string, name: string, now = Date.now()): void {
        const character = this.charactersOf(accountKey).find((c) => this.key(c.name) === this.key(name));
        if (!character) return;
        const before = character.lastPlayedAt;
        character.lastPlayedAt = now;
        try {
            this.save();
        } catch (error) {
            character.lastPlayedAt = before;
            throw error;
        }
    }

    /** Forgets what is in memory, so tests can read the file again as a restart would. */
    public static reset(): void {
        this.entries = null;
        this.owners.clear();
    }
}
