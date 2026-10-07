import type { Player } from "../Player";
import { PlayerSave } from "../persistence/PlayerSave";



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
    abstract load(username: string): PlayerSave;
    /** `reason` says why the save happened ("logout", "autosave", "shutdown", ...); a backend with a history records it. */
    abstract save(player: Player, reason?: string): void;
    abstract exists(username: string): boolean;

    public async flush(): Promise<void> {
        // Default persistence implementations are synchronous.
    }

    /** Whether this backend keeps a history of saves to roll back to. */
    public supportsHistory(): boolean {
        return false;
    }

    /** A player's snapshots, newest first. */
    public listSnapshots(_username: string, _limit?: number): PlayerSaveSnapshot[] {
        return [];
    }

    /**
     * Puts a snapshot back as the player's save; null when there is no such snapshot. With
     * `online`, the player's next save writes it instead (log them out), so their logout save
     * can't overwrite it.
     */
    public restoreSnapshot(_username: string, _id: number, _options?: { online?: boolean }): PlayerSaveRestore | null {
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
