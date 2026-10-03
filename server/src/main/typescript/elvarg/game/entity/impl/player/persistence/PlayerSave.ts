import { PrayerHandler, PrayerData } from "../../../../content/PrayerHandler";
import { normalizeSailingState, type SailingState } from "../../../../content/sailing/SailingState";
import { FightType } from "../../../../content/combat/FightType";
import { CombatSpells } from "../../../../content/combat/magic/CombatSpells";
import { SkillManager, Skills } from "../../../../content/skill/SkillManager";
import { Player } from "../Player";
import { Item } from "../../../../model/Item";
import { Location } from "../../../../model/Location";
import { MagicSpellbook } from "../../../../model/MagicSpellbook";
import { SkullType } from "../../../../model/SkullType";
import { Bank } from "../../../../model/container/impl/Bank";
import { DonatorRights } from "../../../../model/rights/DonatorRights";
import { PlayerRights } from "../../../../model/rights/PlayerRights";
import { ItemContainer } from "../../../../model/container/ItemContainer";
import { StackType } from "../../../../model/container/StackType";
import { Appearance } from "../../../../model/Appearance";

export class PlayerSave {
    /** Save fields that are player attributes now; an older save's value is read once on load. */
    private static readonly LEGACY_FIELD_ATTRIBUTES: Readonly<Record<string, string>> = {
        title: "loyalty:title",
        xpLocked: "skills:xp-locked",
        targetTeleportUnlocked: "bounty-hunter:target-teleport-unlocked",
        preserveUnlocked: "prayer:preserve-unlocked",
        rigourUnlocked: "prayer:rigour-unlocked",
        auguryUnlocked: "prayer:augury-unlocked",
        recoilDamage: "ring-of-recoil:damage",
        crystalBowShotsInStage: "crystal-bow:shots-in-stage",
        crystalBowTrackedStageItemId: "crystal-bow:tracked-item",
        totalKills: "killstreaks:total-kills",
        killstreak: "killstreaks:streak",
        highestKillstreak: "killstreaks:highest-streak",
        deaths: "killstreaks:deaths",
        recentKills: "killstreaks:recent-kills",
        points: "shop:points",
        pcPoints: "pest-control:points",
        pouches: "runecrafting:pouches",
    };
    private static readonly persistentAttributeKeys = new Set<string>(Object.values(PlayerSave.LEGACY_FIELD_ATTRIBUTES));

    public static persistAttribute(key: string): void {
        if (typeof key !== "string" || !key.trim() || key !== key.trim()) {
            throw new Error("Persistent attribute keys must be non-empty strings without surrounding whitespace");
        }
        PlayerSave.persistentAttributeKeys.add(key);
    }

    private static readonly CAMEL_CASE_ATTRIBUTE_KEY = /([a-z0-9])([A-Z])/g;
    /** Save migration: camelCase attribute keys were renamed to kebab-case. */
    private static migrateAttributeKey(key: string): string {
        if (PlayerSave.persistentAttributeKeys.has(key)) return key;
        const kebab = key.replace(PlayerSave.CAMEL_CASE_ATTRIBUTE_KEY, "$1-$2").toLowerCase();
        return PlayerSave.persistentAttributeKeys.has(kebab) ? kebab : key;
    }

    public attributes: Record<string, unknown> = {};
    private static cloneAttribute(key: string, value: unknown): unknown {
        return JSON.parse(JSON.stringify(value, (_name, entry) => {
            if (entry === null || typeof entry === "string" || typeof entry === "boolean"
                || (typeof entry === "number" && Number.isFinite(entry))
                || Array.isArray(entry)
                || (typeof entry === "object" && (Object.getPrototypeOf(entry) === Object.prototype
                    || Object.getPrototypeOf(entry) === null))) return entry;
            throw new Error(`Persistent attribute ${key} must contain only JSON-compatible values`);
        }));
    }

    private static readonly MAX_FRIENDS = 200;
    private static readonly MAX_IGNORES = 100;
    private static readonly DEFAULT_MALE_APPEARANCE = [0, 3, 18, 26, 34, 38, 42, 14, 2, 14, 5, 4, 0];
    private static readonly DEFAULT_FEMALE_APPEARANCE = [1, 48, 57, 65, 68, 77, 80, 57, 2, 14, 5, 4, 0];
    private static readonly MALE_LOOK_RANGES: Array<[number, number]> = [
        [0, 8],   // head
        [10, 17], // beard
        [18, 25], // chest
        [26, 31], // arms
        [33, 34], // hands
        [36, 40], // legs
        [42, 43], // feet
    ];
    private static readonly FEMALE_LOOK_RANGES: Array<[number, number]> = [
        [45, 54], // head
        [57, 57], // jaw/beard placeholder
        [56, 60], // chest
        [61, 65], // arms
        [67, 68], // hands
        [70, 77], // legs
        [79, 80], // feet
    ];
    private static readonly COLOR_RANGES: Array<[number, number]> = [
        [0, 11], // hair
        [0, 15], // torso
        [0, 15], // legs
        [0, 5],  // feet
        [0, 7],  // skin
    ];
    private passwordHashWithSalt: string;
    private isDiscordLogin: boolean;
    private cachedDiscordAccessToken: string;
    private rights;
    private donatorRights;
    private position: Location;
    private spellBook;
    private fightType;
    private autocastSpellId: number;
    private autoRetaliate: boolean;
    private audioSettings: Record<number, number>;
    private hasVengeance: boolean;
    private lastVengeanceTimer: number;
    private specPercentage: number;
    private poisonDamage: number;
    /** Whether poisonDamage represents an active venom (vs. ordinary poison) affliction. */
    private venomed: boolean;
    private poisonImmunityTimer: number;
    private fireImmunityTimer: number;
    private teleblockTimer: number;
    private specialAttackRestoreTimer: number;
    private skullTimer: number;
    private skullType;
    private running: boolean;
    private runEnergy: number;
    private inventory: Item[];
    private equipment: Item[];
    private appearance: number[];
    private skills: Skills;
    private quickPrayers: PrayerData[];
    private friends: string[];
    private ignores: string[];
    private friendRanks: Record<string, number>;
    private friendsChatChannelName: string;
    private friendsChatLastOwner: string;
    private friendsChatEntryRank: number;
    private friendsChatTalkRank: number;
    private friendsChatKickRank: number;
    private banks: Map<number, Item[]>;
    private flags: string[];
    public sailing?: SailingState;

    public getPasswordHashWithSalt(): string {
        return this.passwordHashWithSalt;
    }
    public setPasswordHashWithSalt(passwordHashWithSalt: string): void {
        this.passwordHashWithSalt = passwordHashWithSalt;
    }
    public getRights(): PlayerRights {
        return this.rights;
    }
    public setRights(rights: PlayerRights): void {
        this.rights = rights;
    }
    public getDonatorRights(): DonatorRights {
        return this.donatorRights;
    }
    public setDonatorRights(donatorRights: DonatorRights): void {
        this.donatorRights = donatorRights;
    }

    public getPosition(): Location {
        return this.position;
    }

    public setPosition(position: Location): void {
        this.position = position;
    }

    public getSpellBook(): MagicSpellbook {
        return this.spellBook;
    }

    public setSpellBook(spellBook: MagicSpellbook): void {
        this.spellBook = spellBook;
    }

    public getFightType(): FightType {
        return this.fightType;
    }

    public setFightType(fightType: FightType): void {
        this.fightType = fightType;
    }

    public isAutoRetaliate(): boolean {
        return this.autoRetaliate;
    }

    public setAutoRetaliate(autoRetaliate: boolean): void {
        this.autoRetaliate = autoRetaliate;
    }

    public isHasVengeance(): boolean {
        return this.hasVengeance;
    }

    public setHasVengeance(hasVengeance: boolean): void {
        this.hasVengeance = hasVengeance;
    }

    public getLastVengeanceTimer(): number {
        return this.lastVengeanceTimer;
    }

    public setLastVengeanceTimer(lastVengeanceTimer: number): void {
        this.lastVengeanceTimer = lastVengeanceTimer;
    }

    public getSpecPercentage(): number {
        return this.specPercentage;
    }

    public setSpecPercentage(specPercentage: number): void {
        this.specPercentage = specPercentage;
    }

    public getPoisonDamage(): number {
        return this.poisonDamage;
    }

    public setPoisonDamage(poisonDamage: number): void {
        this.poisonDamage = poisonDamage;
    }

    public isVenomed(): boolean {
        return this.venomed;
    }

    public setVenomed(venomed: boolean): void {
        this.venomed = venomed;
    }

    public getPoisonImmunityTimer(): number {
        return this.poisonImmunityTimer;
    }

    public setPoisonImmunityTimer(poisonImmunityTimer: number): void {
        this.poisonImmunityTimer = poisonImmunityTimer;
    }

    public getFireImmunityTimer(): number {
        return this.fireImmunityTimer;
    }

    public setFireImmunityTimer(fireImmunityTimer: number): void {
        this.fireImmunityTimer = fireImmunityTimer;
    }

    public getTeleblockTimer(): number {
        return this.teleblockTimer;
    }

    public setTeleblockTimer(teleblockTimer: number): void {
        this.teleblockTimer = teleblockTimer;
    }

    public getSpecialAttackRestoreTimer(): number {
        return this.specialAttackRestoreTimer;
    }

    public setSpecialAttackRestoreTimer(specialAttackRestoreTimer: number): void {
        this.specialAttackRestoreTimer = specialAttackRestoreTimer;
    }

    public getSkullTimer(): number {
        return this.skullTimer;
    }

    public setSkullTimer(skullTimer: number): void {
        this.skullTimer = skullTimer;
    }

    public getSkullType(): SkullType {
        return this.skullType;
    }

    public setSkullType(skullType: SkullType): void {
        this.skullType = skullType;
    }

    public isRunning(): boolean {
        return this.running;
    }

    public setRunning(running: boolean): void {
        this.running = running;
    }

    public getRunEnergy(): number {
        return this.runEnergy;
    }

    public setRunEnergy(runEnergy: number): void {
        this.runEnergy = runEnergy;
    }

    public getInventory(): Item[] {
        return this.inventory;
    }

    public setInventory(inventory: Item[]): void {
        this.inventory = inventory;
    }

    public getEquipment(): Item[] {
        return this.equipment;
    }

    public setEquipment(equipment: Item[]): void {
        this.equipment = equipment;
    }

    public getAppearance(): number[] {
        return this.appearance;
    }

    public setAppearance(appearance: number[]): void {
        this.appearance = appearance;
    }

    public getSkills(): Skills {
        return this.skills;
    }

    public setSkills(skills: Skills): void {
        this.skills = skills;
    }

    public getQuickPrayers(): PrayerData[] {
        return this.quickPrayers;
    }

    public setQuickPrayers(quickPrayers: PrayerData[]) {
        this.quickPrayers = quickPrayers;
    }

    public getFriends(): string[] {
        return this.friends;
    }

    public setFriends(friends: string[]) {
        this.friends = friends;
    }

    public getIgnores(): string[] {
        return this.ignores;
    }

    public setIgnores(ignores: string[]) {
        this.ignores = ignores;
    }

    public getFriendRanks(): Record<string, number> {
        return this.friendRanks ?? {};
    }

    public getFriendsChatChannelName(): string {
        return this.friendsChatChannelName ?? "";
    }

    public getFriendsChatEntryRank(): number {
        return Number.isFinite(this.friendsChatEntryRank) ? this.friendsChatEntryRank : -1;
    }

    public getFriendsChatTalkRank(): number {
        return Number.isFinite(this.friendsChatTalkRank) ? this.friendsChatTalkRank : -1;
    }

    public getFriendsChatKickRank(): number {
        return Number.isFinite(this.friendsChatKickRank) ? this.friendsChatKickRank : 2;
    }

    public getBanks(): Map<number, Item[]> {
        return this.banks;
    }

    setBanks(banks: Map<number, Item[]>) {
        this.banks = banks;
    }

    isDiscordLoginReturn(): boolean {
        return this.isDiscordLogin;
    }

    setDiscordLogin(discordLogin: boolean) {
        this.isDiscordLogin = discordLogin;
    }

    getCachedDiscordAccessToken(): string {
        return this.cachedDiscordAccessToken;
    }

    setCachedDiscordAccessToken(cachedDiscordAccessToken: string) {
        this.cachedDiscordAccessToken = cachedDiscordAccessToken;
    }

    getFlags(): string[] {
        return this.flags;
    }

    setFlags(flags: string[]) {
        this.flags = flags;
    }

    private static normalizeRelationListToBigInt(
        values: Array<number | string | bigint> | null | undefined,
        max: number
    ): bigint[] {
        if (!Array.isArray(values) || values.length === 0) {
            return [];
        }
        const out: bigint[] = [];
        const seen = new Set<bigint>();
        for (const value of values) {
            let normalized: bigint;
            try {
                normalized = typeof value === "bigint" ? value : BigInt(String(value));
            } catch {
                continue;
            }
            if (normalized <= 0n || seen.has(normalized)) {
                continue;
            }
            seen.add(normalized);
            out.push(normalized);
            if (out.length >= max) {
                break;
            }
        }
        return out;
    }

    private static normalizeRelationListToStrings(
        values: Array<number | string | bigint> | null | undefined,
        max: number
    ): string[] {
        return PlayerSave
            .normalizeRelationListToBigInt(values, max)
            .map((value) => value.toString());
    }

    private static normalizeFlags(values: unknown): string[] {
        if (!Array.isArray(values) || values.length === 0) {
            return [];
        }
        const out: string[] = [];
        const seen = new Set<string>();
        for (const raw of values) {
            if (typeof raw !== "string") {
                continue;
            }
            const normalized = raw.trim();
            if (normalized.length === 0 || seen.has(normalized)) {
                continue;
            }
            seen.add(normalized);
            out.push(normalized);
        }
        return out;
    }

    private static toFiniteInt(value: unknown, fallback: number): number {
        if (typeof value === "number" && Number.isFinite(value)) {
            return Math.trunc(value);
        }
        if (typeof value === "string" && value.trim().length > 0) {
            const parsed = Number(value);
            if (Number.isFinite(parsed)) {
                return Math.trunc(parsed);
            }
        }
        return fallback;
    }

    private static clamp(value: number, min: number, max: number): number {
        return Math.min(max, Math.max(min, value));
    }

    private static sanitizeAppearance(appearance: unknown): number[] {
        const raw = Array.isArray(appearance) ? appearance : [];
        const gender = PlayerSave.toFiniteInt(raw[Appearance.GENDER], 0) === 1 ? 1 : 0;
        const defaults = gender === 1
            ? PlayerSave.DEFAULT_FEMALE_APPEARANCE
            : PlayerSave.DEFAULT_MALE_APPEARANCE;
        const lookRanges = gender === 1
            ? PlayerSave.FEMALE_LOOK_RANGES
            : PlayerSave.MALE_LOOK_RANGES;
        const sanitized = [...defaults];

        const lookIndices = [
            Appearance.HEAD,
            Appearance.BEARD,
            Appearance.CHEST,
            Appearance.ARMS,
            Appearance.HANDS,
            Appearance.LEGS,
            Appearance.FEET,
        ];

        lookIndices.forEach((lookIndex, idx) => {
            const [min, max] = lookRanges[idx];
            const candidate = PlayerSave.toFiniteInt(raw[lookIndex], defaults[lookIndex]);
            sanitized[lookIndex] = PlayerSave.clamp(candidate, min, max);
        });

        const colorIndices = [
            Appearance.HAIR_COLOUR,
            Appearance.TORSO_COLOUR,
            Appearance.LEG_COLOUR,
            Appearance.FEET_COLOUR,
            Appearance.SKIN_COLOUR,
        ];

        colorIndices.forEach((colorIndex, idx) => {
            const [min, max] = PlayerSave.COLOR_RANGES[idx];
            const candidate = PlayerSave.toFiniteInt(raw[colorIndex], defaults[colorIndex]);
            sanitized[colorIndex] = PlayerSave.clamp(candidate, min, max);
        });

        sanitized[Appearance.GENDER] = gender;
        return sanitized;
    }

    applyToPlayer(player: Player) {
        player.setPasswordHashWithSalt(this.passwordHashWithSalt);
        player.setDiscordLogin(this.isDiscordLogin);
        player.setCachedDiscordAccessToken(this.cachedDiscordAccessToken);
        player.setRights(this.rights);
        player.setDonatorRights(this.donatorRights);
        player.setLocation(this.position);
        player.setSpellbook(this.spellBook);
        player.setFightType(this.fightType);
        player.getCombat().setAutocastSpell(
            Number.isInteger(this.autocastSpellId) && this.autocastSpellId > 0
                ? CombatSpells.getCombatSpell(this.autocastSpellId)
                : null
        );
        player.getCombat().setCastSpell(null);
        player.setAutoRetaliate(this.autoRetaliate);
        player.setAudioSettings(this.audioSettings);
        player.setHasVengeance(this.hasVengeance);
        player.getVengeanceTimer().start(this.lastVengeanceTimer);
        player.setRunning(this.running);
        player.setRunEnergy(this.runEnergy);
        player.setSpecialPercentage(this.specPercentage);
        player.setPoisonDamage(this.poisonDamage);
        player.setVenomed(this.venomed);

        player.getCombat().getPoisonImmunityTimer().start(this.poisonImmunityTimer);
        player.getCombat().getFireImmunityTimer().start(this.fireImmunityTimer);
        player.getCombat().getTeleblockTimer().start(this.teleblockTimer);
        player.getSpecialAttackRestore().start(this.specialAttackRestoreTimer);

        player.setSkullTimer(this.skullTimer);
        player.setSkullType(this.skullType);

        player.setPoisonDamage(this.poisonDamage);

        player.getInventory().setItems(this.inventory);
        player.getEquipment().setItems(this.equipment);
        const sanitizedAppearance = PlayerSave.sanitizeAppearance(this.appearance);
        player.getAppearance().setLookArray(sanitizedAppearance);
        this.appearance = sanitizedAppearance;
        player.getSkillManager().setSkills(this.skills);
        player.getQuickPrayers().setPrayers(this.quickPrayers);
        player.setFlags(PlayerSave.normalizeFlags(this.flags));
        player.setSailing(normalizeSailingState(this.sailing));
        if (this.attributes) {
            this.attributes = Object.fromEntries(
                Object.entries(this.attributes).map(([key, value]) => [PlayerSave.migrateAttributeKey(key), value])
            );
        }
        const legacyFields = this as unknown as Record<string, unknown>;
        for (const [field, key] of Object.entries(PlayerSave.LEGACY_FIELD_ATTRIBUTES)) {
            if (legacyFields[field] != null && !Object.prototype.hasOwnProperty.call(this.attributes ?? {}, key)) {
                player.setAttribute(key, PlayerSave.cloneAttribute(key, legacyFields[field]));
            }
        }
        for (const key of PlayerSave.persistentAttributeKeys) {
            if (Object.prototype.hasOwnProperty.call(this.attributes ?? {}, key)) {
                player.setAttribute(key, PlayerSave.cloneAttribute(key, this.attributes[key]));
            }
        }

        const friendList = player.getRelations().getFriendList();
        friendList.length = 0;
        friendList.push(
            ...PlayerSave.normalizeRelationListToBigInt(
                this.friends,
                PlayerSave.MAX_FRIENDS
            )
        );

        const ignoreList = player.getRelations().getIgnoreList();
        ignoreList.length = 0;
        ignoreList.push(
            ...PlayerSave.normalizeRelationListToBigInt(
                this.ignores,
                PlayerSave.MAX_IGNORES
            )
        );
        const relations = player.getRelations();
        relations.loadFriendRanks(this.friendRanks);
        relations.setFriendsChatChannelName(this.friendsChatChannelName ?? "");
        relations.setFriendsChatLastOwner(this.friendsChatLastOwner ?? "");
        relations.setFriendsChatRanks(
            this.getFriendsChatEntryRank(),
            this.getFriendsChatTalkRank(),
            this.getFriendsChatKickRank()
        );

        for (let i = 0; i < player.getBanks().length; i++) {
            if (i == Bank.BANK_SEARCH_TAB_INDEX) {
                continue;
            }
            let bankItems = this.banks.get(i);
            if (bankItems != null) {
                player.setBank(i, new Bank(player)).getBank(i).addItems(bankItems, false);
            }
        }
    }
    static fromPlayer(player: Player): PlayerSave {
        if (!player) {
            return new PlayerSave();
        }
        let playerSave = new PlayerSave();

        playerSave.passwordHashWithSalt = (player.getPasswordHashWithSalt() || "").trim();
        playerSave.isDiscordLogin = player.isDiscordLoginReturn();
        playerSave.cachedDiscordAccessToken = player.getCachedDiscordAccessToken();
        playerSave.rights = player.getRights();
        playerSave.donatorRights = player.getDonatorRights();
        playerSave.position = player.getLocation()?.clone?.() ?? new Location(3089, 3524, 0);
        playerSave.spellBook = player.getSpellbook();
        playerSave.fightType = player.getFightType();
        playerSave.autocastSpellId = player.getCombat().getAutocastSpell()?.spellId?.() ?? -1;
        playerSave.autoRetaliate = player.autoRetaliateReturn();
        playerSave.audioSettings = { ...player.getAudioSettings() };
        playerSave.hasVengeance = player.hasVengeanceReturn();
        playerSave.lastVengeanceTimer = player.getVengeanceTimer().secondsRemaining();
        playerSave.running = player.isRunningReturn();
        playerSave.runEnergy = player.getRunEnergy();
        playerSave.specPercentage = player.getSpecialPercentage();
        playerSave.poisonDamage = player.getPoisonDamage();
        playerSave.venomed = player.isVenomed();

        playerSave.poisonImmunityTimer = player.getCombat().getPoisonImmunityTimer().secondsRemaining();
        playerSave.fireImmunityTimer = player.getCombat().getFireImmunityTimer().secondsRemaining();

        playerSave.teleblockTimer = player.getCombat().getTeleblockTimer().secondsRemaining();
        playerSave.specialAttackRestoreTimer = player.getSpecialAttackRestore().secondsRemaining();

        playerSave.skullTimer = player.getSkullTimer();
        playerSave.skullType = player.getSkullType();

        playerSave.inventory = player.getInventory().getCopiedItems();
        playerSave.equipment = player.getEquipment().getCopiedItems();
        playerSave.appearance = PlayerSave.sanitizeAppearance(player.getAppearance().getLook());
        const liveSkills = player.getSkillManager().getSkills();
        const clonedSkills = new Skills();
        clonedSkills.level = [...(liveSkills?.level ?? clonedSkills.level)];
        clonedSkills.maxLevel = [...(liveSkills?.maxLevel ?? clonedSkills.maxLevel)];
        clonedSkills.experience = [...(liveSkills?.experience ?? clonedSkills.experience)];
        playerSave.skills = clonedSkills;
        playerSave.quickPrayers = [...(player.getQuickPrayers().getPrayers() ?? [])];
        playerSave.flags = PlayerSave.normalizeFlags(player.getFlags());
        playerSave.sailing = normalizeSailingState(player.getSailing());
        playerSave.attributes = Object.fromEntries(
            [...PlayerSave.persistentAttributeKeys]
                .filter((key) => player.getAttribute(key) !== undefined)
                .map((key) => [key, PlayerSave.cloneAttribute(key, player.getAttribute(key))])
        );

        playerSave.friends = PlayerSave.normalizeRelationListToStrings(
            player.getRelations().getFriendList(),
            PlayerSave.MAX_FRIENDS
        );
        playerSave.ignores = PlayerSave.normalizeRelationListToStrings(
            player.getRelations().getIgnoreList(),
            PlayerSave.MAX_IGNORES
        );
        const relations = player.getRelations();
        playerSave.friendRanks = relations.getFriendRanks();
        playerSave.friendsChatChannelName = relations.getFriendsChatChannelName();
        playerSave.friendsChatLastOwner = relations.getFriendsChatLastOwner();
        playerSave.friendsChatEntryRank = relations.getFriendsChatEntryRank();
        playerSave.friendsChatTalkRank = relations.getFriendsChatTalkRank();
        playerSave.friendsChatKickRank = relations.getFriendsChatKickRank();

        let banks = new Map<number, Item[]>();

        /** BANK **/
        for (let i = 0; i < player.banks.length; i++) {
            if (i === Bank.BANK_SEARCH_TAB_INDEX) {
                continue;
            }
            if (player.getBank(i) !== null) {
                banks.set(
                    i,
                    player
                        .getBank(i)
                        .getValidItems()
                        .map((item) => item?.clone?.() ?? new Item(item?.getId?.() ?? -1, item?.getAmount?.() ?? 0))
                );
            }
        }
        playerSave.banks = banks;

        return playerSave;
    }
}
