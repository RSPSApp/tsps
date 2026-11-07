import { Misc } from "./Misc";
import * as fs from "fs";
import * as path from "path";

export class PlayerPunishment {
    private static writes: Promise<void> = Promise.resolve();
    private static readonly writeErrors = new Map<string, Error>();

    public static async flush(): Promise<void> {
        await this.writes;
        if (this.writeErrors.size) throw this.writeErrors.values().next().value;
    }

    private static saveOnlineAccount(username: string): void {
        const { World } = require("../game/World") as typeof import("../game/World");
        const { GameConstants } = require("../game/GameConstants") as typeof import("../game/GameConstants");
        const player = World.getPlayerByName(username);
        if (player) GameConstants.PLAYER_PERSISTENCE.requestSave(player, "staff-punishment");
    }

    private static enqueue(file: string, write: () => Promise<unknown>): void {
        this.writes = this.writes.then(async () => {
            try {
                await fs.promises.mkdir(path.dirname(file), { recursive: true });
                await write();
                this.writeErrors.delete(file);
            } catch (error) {
                this.writeErrors.set(file, error instanceof Error ? error : new Error(String(error)));
                console.error(`[punishments] Failed to persist ${file}`, error);
            }
        });
    }
    private static readonly BAN_DIRECTORY = "./data/saves/";
    private static readonly MUTE_DIRECTORY = "./data/saves/";

    public static IPSBanned: string[] = [];
    public static IPSMuted: string[] = [];
    public static AccountsBanned: string[] = [];
    public static AccountsMuted: string[] = [];

    public static init() {
        // Ensure directories exist.
        fs.mkdirSync(path.dirname(PlayerPunishment.BAN_DIRECTORY + "placeholder"), { recursive: true });
        fs.mkdirSync(path.dirname(PlayerPunishment.MUTE_DIRECTORY + "placeholder"), { recursive: true });

        // In case we're reloading bans, reset lists first.
        PlayerPunishment.IPSBanned = [];
        PlayerPunishment.IPSMuted = [];
        PlayerPunishment.AccountsBanned = [];
        PlayerPunishment.AccountsMuted = [];

        PlayerPunishment.initializeList(PlayerPunishment.BAN_DIRECTORY, "IPBans", PlayerPunishment.IPSBanned);
        PlayerPunishment.initializeList(PlayerPunishment.BAN_DIRECTORY, "Bans", PlayerPunishment.AccountsBanned);
        PlayerPunishment.initializeList(PlayerPunishment.MUTE_DIRECTORY, "IPMutes", PlayerPunishment.IPSMuted);
        PlayerPunishment.initializeList(PlayerPunishment.MUTE_DIRECTORY, "Mutes", PlayerPunishment.AccountsMuted);
    }

    public static initializeList(directory: string, file: string, list: string[]) {
        try {
            const fullPath = `${directory}${file}.txt`;
            if (!fs.existsSync(fullPath)) {
                return;
            }
            const data = fs.readFileSync(fullPath, 'utf8');
            list.push(...data.split('\n'));
        } catch (e) {
            console.error(e);
        }
    }

    public static addBannedIP(IP: string) {
        if (!this.IPSBanned.includes(IP)) {
            this.addToFile(`${this.BAN_DIRECTORY}IPBans.txt`, IP);
            this.IPSBanned.push(IP);
        }
    }
    public static addMutedIP(IP: string) {
        if (!this.IPSMuted.includes(IP)) {
            this.addToFile(`${this.MUTE_DIRECTORY}IPMutes.txt`, IP);
            this.IPSMuted.push(IP);
        }
    }

    public static removeBannedIP(IP: string) {
        this.deleteFromFile(`${this.BAN_DIRECTORY}IPBans.txt`, IP);
        this.IPSBanned = this.IPSBanned.filter(address => address !== IP);
    }

    public static removeMutedIP(IP: string) {
        this.deleteFromFile(`${this.MUTE_DIRECTORY}IPMutes.txt`, IP);
        this.IPSMuted = this.IPSMuted.filter(address => address !== IP);
    }

    public static ban(p: string) {
        p = Misc.formatPlayerName(p.toLowerCase());
        if (!this.AccountsBanned.includes(p)) {
            this.addToFile(`${this.BAN_DIRECTORY}Bans.txt`, p);
        }
        this.AccountsBanned.push(p);
        this.saveOnlineAccount(p);
    }

    public static mute(p: string) {
        p = Misc.formatPlayerName(p.toLowerCase());
        if (!this.AccountsMuted.includes(p)) {
            this.addToFile(`${this.MUTE_DIRECTORY}Mutes.txt`, p);
        }
        this.AccountsMuted.push(p);
        this.saveOnlineAccount(p);
    }

    public static banned(player: string): boolean {
        player = Misc.formatPlayerName(player.toLowerCase());
        return this.AccountsBanned.includes(player);
    }

    /** Returns whether the player is banned after the change. */
    public static toggleBan(player: string): boolean {
        if (this.banned(player)) {
            this.unban(player);
            return false;
        }
        this.ban(player);
        return true;
    }

    public static muted(player: string): boolean {
        player = Misc.formatPlayerName(player.toLowerCase());
        return this.AccountsMuted.includes(player);
    }

    /** Returns whether the player is muted after the change. */
    public static toggleMute(player: string): boolean {
        if (this.muted(player)) {
            this.unmute(player);
            return false;
        }
        this.mute(player);
        return true;
    }

    public static IPBanned(IP: string): boolean {
        return IP.trim().length > 0 && this.IPSBanned.includes(IP);
    }

    public static IPMuted(IP: string): boolean {
        return IP.trim().length > 0 && this.IPSMuted.includes(IP);
    }

    public static unban(player: string) {
        player = Misc.formatPlayerName(player.toLowerCase());
        this.deleteFromFile(`${this.BAN_DIRECTORY}Bans.txt`, player);
        this.AccountsBanned = this.AccountsBanned.filter(p => p !== player);
        this.saveOnlineAccount(player);
    }

    public static unmute(player: string) {
        player = Misc.formatPlayerName(player.toLowerCase());
        this.deleteFromFile(`${this.MUTE_DIRECTORY}Mutes.txt`, player);
        this.AccountsMuted = this.AccountsMuted.filter(p => p !== player);
        this.saveOnlineAccount(player);
    }

    public static reloadIPBans() {
        this.IPSBanned = [];
        this.initializeList(this.BAN_DIRECTORY, "IPBans", this.IPSBanned);
    }

    public static reloadIPMutes() {
        this.IPSMuted = [];
        this.initializeList(this.MUTE_DIRECTORY, "IPMutes", this.IPSMuted);
    }

    public static deleteFromFile(file: string, player: string) {
        this.enqueue(file, async () => {
            const data = await fs.promises.readFile(file, 'utf8').catch((error) => {
                if (error.code === "ENOENT") return "";
                throw error;
            });
            await fs.promises.writeFile(file, data.split('\n').filter(p => p !== player).join('\n'));
        });
    }

    public static addToFile(file: string, player: string) {
        this.enqueue(file, () => fs.promises.appendFile(file, player + '\n'));
    }
}
