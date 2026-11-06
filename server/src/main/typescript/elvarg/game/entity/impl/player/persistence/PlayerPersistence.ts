import type { Player } from "../Player";
import { PlayerSave } from "../persistence/PlayerSave";
import { MAIN_PROFILE, profileStorageKey, siblingProfile, type PlayerProfile } from "./PlayerProfile";
import { LOGIN_TOKENS_ATTRIBUTE } from "../../../../../net/login/LoginTokens";
const SKIP_PERSISTENCE_ATTRIBUTE = "bot-skip-persistence";



/** A stored copy of a player's save, kept by a backend that keeps a save history. */
export interface PlayerSaveSnapshot {
    id: number;
    savedAt: string;
    reason: string;
    bytes: number;
}

/** The outcome of restoring a snapshot. */
export interface PlayerSaveRestore {
    snapshot: PlayerSaveSnapshot;
    /** True when the player was online: the snapshot is written by their logout save instead. */
    pending: boolean;
}

export abstract class PlayerPersistence {
    /** The profiles, for the backends in plugins/persistence (which reach core through this class). */
    public static readonly MAIN_PROFILE: PlayerProfile = MAIN_PROFILE;
    /** A backend's key for a profile's save: see PlayerProfile.profileStorageKey. */
    public static readonly profileStorageKey = profileStorageKey;

    private readonly requestedSaves = new Map<Player, Set<string>>();
    private readonly requestErrors = new Map<Player, Error>();

    /** The account's save for `profile` (its main character unless asked for another), or null. */
    abstract load(username: string, profile?: PlayerProfile): PlayerSave;
    /** `reason` says why the save happened ("logout", "autosave", "shutdown", ...); a backend with a history records it. The key is the player's name and profile. */
    abstract save(player: Player, reason?: string): void;
    abstract exists(username: string, profile?: PlayerProfile): boolean;

    /**
     * External stores must use this path instead of editing a live account's saved row. Both
     * profiles share the name, so an online account blocks offline edits to either save, unless
     * `evenIfOnline` says the profile edited is not the one online (the account's other character).
     */
    public async updateOffline(
        username: string,
        update: (save: PlayerSave) => void,
        reason = "offline-purchase",
        profile: PlayerProfile = MAIN_PROFILE,
        { evenIfOnline = false }: { evenIfOnline?: boolean } = {}
    ): Promise<boolean> {
        const { World } = require("../../../../World") as typeof import("../../../../World");
        const online = World.getPlayerByName(username);
        if (online && (!evenIfOnline || online.getProfile() === profile)) {
            throw new Error("Cannot update an online account through offline persistence");
        }
        const save = this.load(username, profile);
        if (!save) return false;
        update(save);
        this.saveOffline(username, save, reason, profile);
        await this.flush();
        return true;
    }

    /** Removes a profile's save; a backend that keeps a history re-keys it so a new character of that name starts clean. */
    public async delete(_username: string, _profile: PlayerProfile = MAIN_PROFILE): Promise<void> {
        throw new Error("This persistence backend does not support deleting saves");
    }

    protected saveOffline(_username: string, _save: PlayerSave, _reason: string, _profile: PlayerProfile = MAIN_PROFILE): void {
        throw new Error("This persistence backend does not support offline updates");
    }

    /**
     * A new password for the account: the live character takes it (and signs out its remembered
     * logins), its save is written, and the account's other character's save gets the same hash
     * with its remembered logins signed out too, so the old password opens neither character.
     */
    public async changePassword(player: Player, passwordHashWithSalt: string): Promise<void> {
        player.setPasswordHashWithSalt(passwordHashWithSalt);
        this.requestSave(player, "password-change");
        const other = siblingProfile(player.getProfile());
        if (!this.exists(player.getUsername(), other)) return;
        await this.updateOffline(player.getUsername(), (save) => {
            save.setPasswordHashWithSalt(passwordHashWithSalt);
            save.attributes = { ...(save.attributes ?? {}), [LOGIN_TOKENS_ATTRIBUTE]: [] };
        }, "password-change", other, { evenIfOnline: true });
    }

    /** Snapshot after the current operation finishes; overlapping triggers share one write. */
    public requestSave(player: Player, reason: string): void {
        if (!player || player.getAttribute?.(SKIP_PERSISTENCE_ATTRIBUTE) === true) return;
        if (this.requestedSaves.size === 0) queueMicrotask(() => this.saveRequested());
        const reasons = this.requestedSaves.get(player) ?? new Set<string>();
        reasons.add(reason);
        this.requestedSaves.set(player, reasons);
    }

    /** Logout and full-world saves already snapshot the final state themselves. */
    public cancelRequestedSave(player: Player): void {
        this.requestedSaves.delete(player);
        this.requestErrors.delete(player);
    }

    protected saveRequested(): void {
        const pending = [...this.requestedSaves];
        this.requestedSaves.clear();
        for (const [player, reasons] of pending) {
            try {
                this.save(player, [...reasons].join(","));
                this.requestErrors.delete(player);
            } catch (error) {
                this.requestErrors.set(player, error instanceof Error ? error : new Error(String(error)));
                console.error(`[persistence] Could not snapshot ${player.getUsername()}`, error);
            }
        }
    }

    public async flush(): Promise<void> {
        this.saveRequested();
        if (this.requestErrors.size > 0) throw this.requestErrors.values().next().value;
    }

    /** Whether this backend keeps a history of saves to roll back to. */
    public supportsHistory(): boolean {
        return false;
    }

    /** A player's snapshots, newest first. */
    public listSnapshots(_username: string, _limit?: number, _profile: PlayerProfile = MAIN_PROFILE): PlayerSaveSnapshot[] {
        return [];
    }

    /**
     * Puts a snapshot back as the player's save; null when there is no such snapshot. With
     * `online`, the player's next save writes it instead (log them out), so their logout save
     * can't overwrite it.
     */
    public restoreSnapshot(
        _username: string,
        _id: number,
        _options?: { online?: boolean },
        _profile: PlayerProfile = MAIN_PROFILE
    ): PlayerSaveRestore | null {
        return null;
    }

    public async encryptPassword(plainPassword: string): Promise<string> {
        const { PasswordUtil } = require(
            "../../../../../util/PasswordUtil"
        ) as typeof import("../../../../../util/PasswordUtil");
        const passwordEncrypt: string = await PasswordUtil.generatePasswordHashWithSalt(plainPassword);
        return passwordEncrypt;
    }

    public async checkPassword(password: string, playerSave: PlayerSave): Promise<boolean> {
        const { PasswordUtil } = require(
            "../../../../../util/PasswordUtil"
        ) as typeof import("../../../../../util/PasswordUtil");
        const passwordHashWithSalt = playerSave.getPasswordHashWithSalt();
        const isMatch: boolean = await PasswordUtil.passwordsMatch(password, passwordHashWithSalt);
        return isMatch;
    }
}
