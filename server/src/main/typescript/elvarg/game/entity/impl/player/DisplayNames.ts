import * as fs from "fs";
import * as path from "path";
import { Misc } from "../../../../util/Misc";
import { LEAGUE_PROFILE, MAIN_PROFILE } from "./persistence/PlayerProfile";

/** A name an account gave up, kept for it until `until` so nobody else can take it straight away. */
export interface HeldDisplayName {
    name: string;
    until: number;
}

export interface DisplayNameEntry {
    /** The name other players see, capitals as the player typed them. */
    name: string;
    /** When it was last changed (ms). */
    changedAt: number;
    held: HeldDisplayName[];
}

/**
 * Display names: what other players see, apart from the login name that keys the account (its
 * save, friends lists, clans, punishments). An account without an entry shows its login name.
 *
 * Every account's login name is reserved for it, and an account's current and held names are
 * reserved for it, so a name always leads to one account. The file is written whole on every
 * change: names change rarely.
 */
export class DisplayNames {
    static readonly FILE_ENV = "TSPS_DISPLAY_NAMES_FILE";
    private static entries: Map<string, DisplayNameEntry> | null = null;
    /** Name key -> account key, for current and held names (held ones may have expired; check `until`). */
    private static owners = new Map<string, { account: string; until: number }>();

    /** The key two names share when they are the same name: case, underscores and extra spaces don't count. */
    public static key(name: string): string {
        return String(name ?? "").replace(/_/g, " ").trim().replace(/\s+/g, " ").toLowerCase();
    }

    private static file(): string {
        return process.env[DisplayNames.FILE_ENV] || path.join(process.cwd(), "data", "saves", "display-names.json");
    }

    private static load(): Map<string, DisplayNameEntry> {
        if (this.entries) return this.entries;
        const loaded = new Map<string, DisplayNameEntry>();
        let saved: any;
        try {
            saved = JSON.parse(fs.readFileSync(this.file(), "utf8"));
        } catch (error: any) {
            if (error?.code !== "ENOENT") throw error;
            saved = { accounts: {} };
        }
        for (const [account, entry] of Object.entries<any>(saved.accounts ?? {})) {
            loaded.set(account, {
                name: String(entry.name),
                changedAt: Number(entry.changedAt) || 0,
                held: Array.isArray(entry.held) ? entry.held.map((h: any) => ({ name: String(h.name), until: Number(h.until) || 0 })) : [],
            });
        }
        // Only once it has all been read: a file that can't be keeps throwing, so save() can't replace it.
        this.entries = loaded;
        this.reindex();
        return loaded;
    }

    private static reindex(): void {
        this.owners.clear();
        // Two accounts can both list a held name once one hold has run out: the later hold wins,
        // and a name someone shows now beats any hold.
        for (const [account, entry] of this.entries ?? []) {
            for (const held of entry.held) {
                const key = this.key(held.name);
                if ((this.owners.get(key)?.until ?? -Infinity) < held.until) this.owners.set(key, { account, until: held.until });
            }
        }
        for (const [account, entry] of this.entries ?? []) this.owners.set(this.key(entry.name), { account, until: Infinity });
    }

    private static save(): void {
        const target = this.file();
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const temporary = `${target}.tmp`;
        fs.writeFileSync(temporary, JSON.stringify({ accounts: Object.fromEntries(this.load()) }, null, 2));
        fs.renameSync(temporary, target);
    }

    public static entryOf(username: string): DisplayNameEntry | undefined {
        return this.load().get(this.key(username));
    }

    /** The name other players see for this account. */
    public static nameOf(username: string): string {
        return this.entryOf(username)?.name ?? Misc.formatDisplayName(String(username ?? ""));
    }

    /** The account's most recent name still held for it, for friends lists ("" when none). */
    public static previousNameOf(username: string, now = Date.now()): string {
        const held = (this.entryOf(username)?.held ?? []).filter((h) => h.until > now);
        return held.length ? held[held.length - 1].name : "";
    }

    /** The account key whose current or held display name this is, or undefined. Login names aren't included. */
    public static ownerOf(name: string, now = Date.now()): string | undefined {
        this.load();
        const owner = this.owners.get(this.key(name));
        return owner && owner.until > now ? owner.account : undefined;
    }

    /**
     * The account a typed name means: the one showing it (or holding it), otherwise the account
     * logged in with it. undefined for a login name whose account shows another name and no
     * longer holds it, which other players shouldn't be able to look up by.
     */
    public static resolve(name: string, now = Date.now()): string | undefined {
        const key = this.key(name);
        if (!key) return undefined;
        const owner = this.ownerOf(key, now);
        if (owner) return owner;
        const entry = this.load().get(key);
        return entry && this.key(entry.name) !== key ? undefined : key;
    }

    /**
     * Why `username` can't take `name` (a sentence for the player), or null when it can. Another
     * account's login name, current name or held name is taken, whether it is online or not.
     */
    public static refusal(username: string, name: string, now = Date.now()): string | null {
        const account = this.key(username);
        const key = this.key(name);
        if (key === account) return null;
        const owner = this.ownerOf(key, now);
        if (owner && owner !== account) return "That name is not available.";
        if (owner === account) return null;
        if (this.loginNameInUse(key)) return "That name is not available.";
        return null;
    }

    /** Whether any account logs in with this name: saved on either profile, online, or logging in now. */
    private static loginNameInUse(key: string): boolean {
        const { GameConstants } = require("../../../GameConstants") as typeof import("../../../GameConstants");
        const { World } = require("../../../World") as typeof import("../../../World");
        const { ClientConnection } = require("../../../../net/NetworkBuilder") as typeof import("../../../../net/NetworkBuilder");
        const persistence = GameConstants.PLAYER_PERSISTENCE;
        return !!World.getPlayerByName(key) ||
            ClientConnection.isLoginPending(key) ||
            persistence.exists(key, MAIN_PROFILE) ||
            persistence.exists(key, LEAGUE_PROFILE);
    }

    /**
     * Gives the account `name`. The name it had is held for it for `holdMs`, and a held name it
     * takes back stops being held. Throws, changing nothing, when the file can't be written.
     */
    public static set(username: string, name: string, now: number, holdMs: number): void {
        const entries = this.load();
        const account = this.key(username);
        const before = entries.get(account);
        const current = before?.name ?? Misc.formatDisplayName(String(username));
        const held = (before?.held ?? []).filter((h) => h.until > now && this.key(h.name) !== this.key(name));
        // The login name is held too (it is reserved anyway): friends lists show it as the previous
        // name, and others can still find the account by it until the hold runs out, as in OSRS.
        if (this.key(current) !== this.key(name)) {
            held.push({ name: current, until: now + holdMs });
        }
        entries.set(account, { name, changedAt: now, held });
        try {
            this.save();
        } catch (error) {
            if (before) entries.set(account, before);
            else entries.delete(account);
            throw error;
        }
        this.reindex();
    }

    /** Forgets what is in memory, so tests can read the file again as a restart would. */
    public static reset(): void {
        this.entries = null;
        this.owners.clear();
    }
}
