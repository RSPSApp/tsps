import { GameConstants } from "../../../GameConstants";
import { Sound } from "../../../Sound";
import { PrayerData, PrayerHandler } from "../../../content/PrayerHandler";
import { CombatFactory } from "../../../content/combat/CombatFactory";
import { CombatSpecial } from "../../../content/combat/CombatSpecial";
import { CombatType } from "../../../content/combat/CombatType";
import { FightType } from "../../../content/combat/FightType";
import { WeaponInterfaces } from "../../../content/combat/WeaponInterfaces";
import { WeaponInterfaceManager } from "../../../content/combat/WeaponInterfaceManager";
import { WeaponProfiles } from "../../../content/combat/WeaponProfile";
import { PendingHit } from "../../../content/combat/hit/PendingHit";
import { Autocasting } from "../../../content/combat/magic/Autocasting";
import { Presetable } from "../../../content/presets/Presetable";
import { SkillManager } from "../../../content/skill/SkillManager";
import { ItemDefinition } from "../../../definition/ItemDefinition";
import { Mobile } from "../Mobile";
import { NPC } from "../npc/NPC";
import { NpcAggression } from "../npc/NpcAggression";
import { Animation } from "../../../model/Animation";
import { Appearance } from "../../../model/Appearance";
import { ChatMessage } from "../../../model/ChatMessage";
import { EnteredAmountAction } from "../../../model/EnteredAmountAction";
import { EnteredSyntaxAction } from "../../../model/EnteredSyntaxAction";
import { Flag } from "../../../model/Flag";
import { ForceMovement } from "../../../model/ForceMovement";
import { Location } from "../../../model/Location";
import { PlayerInteractingOption, PlayerInteractingOptions } from "../../../model/PlayerInteractingOption";
import { PlayerRelations } from "../../../model/PlayerRelations";
import { PlayerStatus } from "../../../model/PlayerStatus";
import { SecondsTimer } from "../../../model/SecondsTimer";
import { Skill } from "../../../model/Skill";
import { AreaManager } from "../../../model/areas/AreaManager";
import { Bank } from "../../../model/container/impl/Bank";
import { Equipment } from "../../../model/container/impl/Equipment";
import { Inventory } from "../../../model/container/impl/Inventory";
import { DialogueManager } from "../../../model/dialogues/DialogueManager"
import { BonusManager } from "../../../model/equipment/BonusManager";
import { CreationMenu } from "../../../model/menu/CreationMenu"
import { MovementQueue } from "../../../model/movement/MovementQueue";
import { DonatorRights } from "../../../model/rights/DonatorRights"
import { PlayerRights } from "../../../model/rights/PlayerRights";
import { TaskManager } from "../../../task/TaskManager";
import { CombatPoisonEffect } from "../../../task/impl/CombatPoisonEffect";
import { PlayerDeathTask } from "../../../task/impl/PlayerDeath"
import { PlayerSession } from "../../../../net/PlayerSession"
import { PacketSender } from "../../../../net/packet/PacketSender"
import { FrameUpdater } from "../../../../util/FrameUpdater"
import { Misc } from "../../../../util/Misc";
import { NpcIdentifiers } from "../../../../util/NpcIdentifiers";
import { Stopwatch } from "../../../../util/Stopwatch";
import { TimerKey } from "../../../../util/timers/TimerKey";
import { Trading } from "../../../content/Trading";
import { Dueling } from "../../../content/Duelling";
import { QuickPrayers } from "../../../content/QuickPrayers";
import { MagicSpellbook } from "../../../model/MagicSpellbook";
import { SkullType } from "../../../model/SkullType";
import { EffectTimer } from "../../../model/EffectTimer";
import { Task } from "../../../task/Task";
import { World } from "../../../World";
import { PluginManager } from "../../../../plugins/PluginManager";
import { ServerPerf } from "../../../../util/ServerPerf";

const ATTR_SKIP_PERSISTENCE = "botSkipPersistence";
const DEFAULT_AUDIO_SETTINGS: Readonly<Record<number, number>> = {
    18: 0,
    168: 100,
    169: 100,
    872: 100,
    3796: 100,
};

export class Player extends Mobile {
    getSize(): number {
        return 1;
    }
    public increaseStats = new SecondsTimer();
    public decreaseStats = new SecondsTimer();
    private localPlayers: Player[] = [];
    private localNpcs: NPC[] = [];
    public packetSender = new PacketSender(this);
    public appearance = new Appearance(this);
    public skillManager = new SkillManager(this);
    public relations = new PlayerRelations(this);
    private frameUpdater = new FrameUpdater();
    private bonusManager = new BonusManager();
    public quickPrayers = new QuickPrayers(this);
    public inventory = new Inventory(this);
    public equipment = new Equipment(this);
    private clickDelay = new Stopwatch();
    private lastItemPickup = new Stopwatch();
    private yellDelay = new SecondsTimer();
    private aggressionTolerance = new SecondsTimer();
    // Delay for restoring special attack
    private specialAttackRestore = new SecondsTimer();
    /*
    * Fields
    */
    private vengeTimer: SecondsTimer = new SecondsTimer();
    public recentKills: string[] = []; // Contains ip addresses of recent kills
    private chatMessageQueue = new Array<ChatMessage>();
    public currentChatMessage: ChatMessage;
    // Logout
    public forcedLogoutTimer = new SecondsTimer();
    // Trading
    private trading = new Trading(this);
    private dueling = new Dueling(this);
    public dialogueManager = new DialogueManager(this);
    // Presets
    private currentPreset: Presetable;

    public username: string;
    private passwordHashWithSalt: string;
    private hostAddress: string;
    private isDiscordLogin: boolean = false;
    private cachedDiscordAccessToken: string = "";
    public longUsername: bigint = 0n;
    private session: PlayerSession;
    private playerInteractingOption: PlayerInteractingOption;
    public status: PlayerStatus = PlayerStatus.NONE;
    public currentClanChat: any;
    public clanChatName: string;
    // Legacy shop field kept for compile compatibility with deprecated core shop classes.
    public shop: any;
    public interfaceId: number = -1
    private walkableInterfaceId: number = -1
    private multiIcon: number;
    private isRunning = true;
    private playerBot = false;
    private botAreaProcessTick = 0;
    private runEnergy = 100;
    private lastRunRecovery = new Stopwatch();
    private isDying: boolean;
    public experienceLocked: boolean;
    public forceMovement: ForceMovement;
    private currentPet: NPC;
    private skillAnimation: number;
    private drainingPrayer = false;
    private prayerPointDrain = 0;
    /**
     * True when a prayer was newly activated this tick. OSRS applies the
     * prayer's effect immediately but skips that tick's drain, which is what
     * makes 1-tick "flicking" free. Consumed (read + reset) by
     * PrayerHandler.processDrain each tick.
     */
    private prayerActivatedThisTick = false;
    private spellbook: MagicSpellbook = MagicSpellbook.NORMAL;
    private destroyItem = -1;
    private updateInventory: boolean; // Updates inventory on next tick
    private newPlayer: boolean;
    private packetsBlocked = false;

    // Skilling
    private skill: any;
    private creationMenu: CreationMenu;
    // Entering data
    public enteredAmountAction: EnteredAmountAction;
    private enteredSyntaxAction: EnteredSyntaxAction;

    // Time the account was created
    private creationDate = new Date();
    // RC
    public pouches: any[] = [
        { pouch: { itemId: 5509, requiredLevel: 1, capacity: 3, decayChance: -1 }, runeEssenceAmt: 0, pureEssenceAmt: 0 },
        { pouch: { itemId: 5510, requiredLevel: 25, capacity: 6, decayChance: 45 }, runeEssenceAmt: 0, pureEssenceAmt: 0 },
        { pouch: { itemId: 5512, requiredLevel: 50, capacity: 9, decayChance: 29 }, runeEssenceAmt: 0, pureEssenceAmt: 0 },
        { pouch: { itemId: 5514, requiredLevel: 75, capacity: 12, decayChance: 10 }, runeEssenceAmt: 0, pureEssenceAmt: 0 },
    ];
    // Slayer
    private slayerTask: any;
    private slayerPoints: number;
    private consecutiveTasks: number;

    // Combat
    private static readonly PREFERRED_VIEW_DISTANCE = 15;
    private static readonly PREFERRED_LOCAL_PLAYERS = 250;
    private static readonly VIEW_DISTANCE_REGROW_CYCLES = 10;
    public skullType: SkullType;
    public combatSpecial: CombatSpecial;
    private recoilDamage: number;
    private vengeanceTimer = new SecondsTimer();
    private wildernessLevel: number;
    public skullTimer: number;
    public points: number;
    private amountDonated: number;
    private crystalBowShotsInStage = 0;
    private crystalBowTrackedStageItemId = -1;
    // Bounty hunter
    public totalKills: number;
    public killstreak: number;
    public highestKillstreak: number;
    public deaths: number;
    public pcPoints: number;
    private preserveUnlocked: boolean;
    private rigourUnlocked: boolean;
    private auguryUnlocked: boolean;
    private targetTeleportUnlocked: boolean;
    // Banking
    // Java primitive int defaults to 0; initialize explicitly in TS to avoid undefined tab routing.
    public currentBankTab = 0;
    public banks: Bank[] = Array(Bank.TOTAL_BANK_TABS).fill(null); // last index is for bank searches
    private noteWithdrawal = false;
    private insertMode = false;
    private bankQuantityMode = 0;
    private bankCustomQuantity = 0;
    private searchingBank = false;
    private searchSyntax = "";
    private placeholders = false;
    private infiniteHealth: boolean;
    private fightType = FightType.UNARMED_KICK;
    public weapon: WeaponInterfaces = WeaponInterfaces.UNARMED;
    private autoRetaliate = true;
    private audioSettings: Record<number, number> = { ...DEFAULT_AUDIO_SETTINGS };

    // Rights
    public rights = PlayerRights.NONE;
    private chatIcons: number[] = [];
    public donatorRights = DonatorRights.NONE;
    /**
     * The cached player update block for updating.
     */
    private cachedUpdateBlock: Buffer;
    private loyaltyTitle = "empty";
    private oldPosition: Location;
    public id: number;
    public name: string;

    /**
     * Creates this player with pre defined spawn location.
     *
     * @param playerIO
     */
    constructor(playerIO: PlayerSession, spawnLocation?: Location) {
        super(spawnLocation ?? GameConstants.DEFAULT_LOCATION.clone());
        this.session = playerIO;
        this.aggressionTolerance.start(NpcAggression.NPC_TOLERANCE_SECONDS);
    }


    public onAdd() {
        this.onLogin();
    }

    resetAttributes() {
        this.performAnimation(new Animation(65535));
        this.setSpecialActivated(false);
        CombatSpecial.updateBar(this);
        this.setHasVengeance(false);
        this.getCombat().getFireImmunityTimer().stop();
        this.getCombat().getPoisonImmunityTimer().stop();
        this.getCombat().getTeleblockTimer().stop();
        this.getTimers().cancel(TimerKey.FREEZE);
        this.getCombat().getPrayerBlockTimer().stop();
        this.setPoisonDamage(0);
        this.setVenomed(false);
        this.setWildernessLevel(0);
        this.setRecoilDamage(0);
        this.setSkullTimer(0);
        this.setSkullType(SkullType.WHITE_SKULL);
        WeaponInterfaceManager.assign(this);
        BonusManager.update(this);
        PrayerHandler.deactivatePrayers(this);
        this.getEquipment().refreshItems();
        this.getInventory().refreshItems();
        for (let skill of Skill.values())
            this.getSkillManager().setCurrentLevels(skill, this.getSkillManager().getMaxLevel(skill));
        this.setRunEnergy(100);
        this.getPacketSender().sendRunEnergy();
        this.getMovementQueue().setBlockMovement(false).reset();
        this.getPacketSender().sendEffectTimer(0, EffectTimer.ANTIFIRE).sendEffectTimer(0, EffectTimer.FREEZE)
            .sendEffectTimer(0, EffectTimer.VENGEANCE).sendEffectTimer(0, EffectTimer.TELE_BLOCK);
        this.getPacketSender().sendPoisonType(0);
        this.getPacketSender().sendSpecialAttackState(false);
        this.setUntargetable(false);
        this.isDying = false;

        this.getUpdateFlag().flag(Flag.APPEARANCE);
    }

    /**
     * Actions that should be done when this character is removed from the world.
     */
    public onRemove() {
        this.onLogout();
    }

    public appendDeath() {
        if (!this.isDying) {
            TaskManager.submit(new PlayerDeathTask(this));
            this.isDying = true;
        }
    }

    public getHitpoints(): number {
        return this.getSkillManager().getCurrentLevel(Skill.HITPOINTS);
    }


    public getAttackAnim(): number {
        const fightType = FightType.resolve(this.getFightType()) ?? FightType.UNARMED_KICK;
        return WeaponProfiles.attackAnimation(this, fightType.getAnimation());
    }

    public getAttackSound(): Sound {
        const fightType = FightType.resolve(this.getFightType()) ?? FightType.UNARMED_KICK;
        return WeaponProfiles.get(this)?.attackSound ?? fightType.getAttackSound();
    }

    public getBlockAnim(): number {
        let shield = this.getEquipment().getItems()[Equipment.SHIELD_SLOT];
        let weapon = this.getEquipment().getItems()[Equipment.WEAPON_SLOT];
        let definition: ItemDefinition = shield.getId() > 0 ? shield.getDefinition() : weapon.getDefinition();
        return definition.getBlockAnim();
    }

    public setHitpoints(hitpoints: number): Mobile {
        if (this.isDying) {
            return this;
        }

        if (this.infiniteHealth) {
            if (this.getSkillManager().getCurrentLevel(Skill.HITPOINTS) > hitpoints) {
                return this;
            }
        }

        this.getSkillManager().setCurrentLevels(Skill.HITPOINTS, hitpoints);
        this.getPacketSender().sendSkill(Skill.HITPOINTS);
        if (this.getHitpoints() <= 0 && !this.isDying)
            this.appendDeath();
        return this;
    }
    public heal(amount: number) {
        let level = this.getSkillManager().getMaxLevel(Skill.HITPOINTS);
        if ((this.getSkillManager().getCurrentLevel(Skill.HITPOINTS) + amount) >= level) {
            this.setHitpoints(level);
        } else {
            this.setHitpoints(this.getSkillManager().getCurrentLevel(Skill.HITPOINTS) + amount);
        }
    }


    public getBaseAttack(type: CombatType): number {
        if (type == CombatType.RANGED)
            return this.getSkillManager().getCurrentLevel(Skill.RANGED);
        else if (type == CombatType.MAGIC)
            return this.getSkillManager().getCurrentLevel(Skill.MAGIC);
        return this.getSkillManager().getCurrentLevel(Skill.ATTACK);
    }

    public getBaseDefence(type: CombatType): number {
        if (type == CombatType.MAGIC)
            return this.getSkillManager().getCurrentLevel(Skill.MAGIC);
        return this.getSkillManager().getCurrentLevel(Skill.DEFENCE);
    }

    public getBaseAttackSpeed(): number {

        // Gets attack speed for player's weapon
        // If player is using magic, attack speed is
        // Calculated in the MagicCombatMethod class.

        const weapon = this.getWeapon() ?? WeaponInterfaces.UNARMED;
        const baseSpeed = WeaponProfiles.attackSpeed(
            this,
            weapon && typeof weapon.getSpeed === "function" ? weapon.getSpeed() : 4
        );
        let speed = Math.max(baseSpeed, 1);
        const fightType = FightType.resolve(this.getFightType());

        if (fightType?.isRapid()) {
            speed = Math.max(speed - 1, 1);
        }

        return speed;
    }

    public isPlayer(): boolean {
        return true;
    }

    public equals(o: Object): boolean {
        if (!(o instanceof Player)) {
            return false;
        }
        let p = o as Player;
        return p.getUsername() == this.username;
    }

    public size(): number {
        return 1;
    }

    public process() {
        const isBot = this.isPlayerBot();
        const timed = <T>(phase: string, fn: () => T): T =>
            ServerPerf.measurePhase(`player.process.${phase}`, fn);

        // Queued impacts land before this player acts, matching LostCity's
        // processQueues-then-processInteraction order. A hit that kills them here
        // stops the rest of this turn via the isDying/hitpoints guards below.
        timed("combat_hits", () => this.getCombat().getHitQueue().process(World.getProcessCycle()));

        // Timers
        timed("timers", () => this.getTimers().process());

        const movement = this.getMovementQueue();
        const combat = this.getCombat();
        movement.beginCycle();
        const processCombat = combat.hasPendingWork();
        if (processCombat) {
            timed("combat_pre_movement", () => combat.preMovementProcess());
        }

        // Process walking queue only when movement/follow state exists.
        if (movement.hasPendingWork()) {
            timed("movement", () => movement.process());
        }
        if (movement.isMovings()) {
            this.updateFlag.flag(Flag.APPEARANCE);
        }

        if (processCombat) {
            timed("combat_post_movement", () => combat.postMovementProcess());
        }

        // Reach checks for walk-to interactions run here, after this cycle's steps,
        // so arriving at an object/npc/ground item resolves on the same cycle.
        timed("walk_to_interaction", () => TaskManager.processWalkTo(this.getIndex()));

        // Process aggression
        if (!isBot) {
            timed("npc_aggression", () => NpcAggression.process(this));
        }

        // Process areas..
        // Bots do not need full-frequency area processing while idle.
        // Run immediately when moving/forced movement, otherwise downsample.
        const shouldProcessArea =
            !isBot ||
            this.getMovementQueue().isMovings() ||
            this.getForceMovement() != null ||
            ((this.botAreaProcessTick = (this.botAreaProcessTick + 1) % 3) === 0);
        if (shouldProcessArea) {
            timed("area", () => AreaManager.process(this));
        }

        // Updates inventory if an update
        // has been requested
        if (this.isUpdateInventory()) {
            if (!isBot) {
                this.getInventory().refreshItems();
            }
            this.setUpdateInventory(false);
        }

        // Updates appearance if an update
        // has been requested
        // or if skull timer hits 0.
        if (this.isSkulled() && this.getAndDecrementSkullTimer() == 0 && !isBot) {
            this.getUpdateFlag().flag(Flag.APPEARANCE);
        }

        // Send queued chat messages
        if (this.getChatMessageQueue().length > 0) {
            if (!isBot) {
                this.setCurrentChatMessage(this.getChatMessageQueue().shift());
                this.getUpdateFlag().flag(Flag.CHAT);
            } else {
                this.getChatMessageQueue().shift();
                this.setCurrentChatMessage(null);
            }
        } else {
            this.setCurrentChatMessage(null);
        }

        // Increase run energy
        if (!isBot && this.runEnergy < 100 && (!this.getMovementQueue().isMovings() || !this.isRunning)) {
            if (this.lastRunRecovery.elapsedTime(MovementQueue.runEnergyRestoreDelay(this))) {
                this.runEnergy++;
                this.getPacketSender().sendRunEnergy();
                this.lastRunRecovery.reset();
            }
        }

        if (this.isDrainingPrayer()) {
            timed("prayer_drain", () => PrayerHandler.processDrain(this));
        }

        // PlayerBot-specific processing skipped in this runtime.
        // Decrease boosted stats Increase lowered stats
        if (this.getHitpoints() > 0) {
            if (this.increaseStats.finished() || this.decreaseStats.secondsElapsed() >= (PrayerHandler.isActivated(this, PrayerHandler.PRESERVE) ? 72 : 60)) {
                timed("stats", () => {
                    for (let skill of Skill.values()) {
                        let current = this.getSkillManager().getCurrentLevel(skill);
                        let max = this.getSkillManager().getMaxLevel(skill);

                        // Should lowered stats be increased?
                        if (current < max) {
                            if (this.increaseStats.finished()) {
                                let restoreRate = 1;

                                // Rapid restore effect - 2x restore rate for all stats except hp/prayer
                                // Rapid heal - 2x restore rate for hitpoints
                                if (skill != Skill.HITPOINTS && skill != Skill.PRAYER) {
                                    if (PrayerHandler.isActivated(this, PrayerHandler.RAPID_RESTORE)) {
                                        restoreRate = 2;
                                    }
                                } else if (skill == Skill.HITPOINTS) {
                                    if (PrayerHandler.isActivated(this, PrayerHandler.RAPID_HEAL)) {
                                        restoreRate = 2;
                                    }
                                }

                                this.getSkillManager().increaseCurrentLevel(skill, restoreRate, max);
                            }
                        } else if (current > max) {

                            // Should boosted stats be decreased?
                            if (this.decreaseStats.secondsElapsed() >= (PrayerHandler.isActivated(this, PrayerHandler.PRESERVE) ? 72 : 60)) {

                                // Never decrease Hitpoints / Prayer, and keep player-bot boosts static.
                                if (!isBot && skill != Skill.HITPOINTS && skill != Skill.PRAYER) {
                                    this.getSkillManager().decreaseCurrentLevel(skill, 1, 1);
                                }

                            }
                        }
                    }
                    // Reset timers
                    if (this.increaseStats.finished()) {
                        this.increaseStats.start(60);
                    }
                    if (this.decreaseStats
                        .secondsElapsed() >= (PrayerHandler.isActivated(this, PrayerHandler.PRESERVE) ? 72 : 60)) {
                        this.decreaseStats.start((PrayerHandler.isActivated(this, PrayerHandler.PRESERVE) ? 72 : 60));
                    }
                });
            }
        }
    }


    // Construction
    /*
     
    public loadingHouse: boolean; public portalSelected: number; public inBuildingMode: boolean; public toConsCoords: number[]; public buildFurnitureId: number; public buildFurnitureX: number; public buildFurnitureY: number; public houseRooms: Room[][][] = new Array(5).fill(new Array(13).fill(new Array(13).fill(new Room()))); public playerFurniture: PlayerFurniture[] = []; public portals: Portal[] = [];
    */
    /**
     
    Can the player logout?
    @returns Yes if they can logout, false otherwise.
    */
    canLogout(): boolean {
        if (CombatFactory.isBeingAttacked(this)) {
            this.getPacketSender().sendMessage("You must wait a few seconds after being out of combat before doing this.");
            return false;
        }
        if (this.busy()) {
            this.getPacketSender().sendMessage("You cannot log out at the moment.");
            return false;
        }
        return true;
    }
    /**
     
    Requests a logout by sending the logout packet to the client. This leads to
    the connection being closed, which then adds the player to the remove
    characters queue.
    */
    requestLogout() {
        if (!World.getRemovePlayerQueue().includes(this)) {
            World.getRemovePlayerQueue().push(this);
        }
        this.getPacketSender().sendLogout();
    }

    onLogout() {
        // Notify us
        if (!this.isPlayerBot()) {
            console.log("[World] Deregistering player - [username, host] : [" + this.getUsername() + ", " + this.getHostAddress() + "]");
        }

        this.getPacketSender().sendInterfaceRemoval();

        // Leave area
        if (this.getArea() != null) {
            this.getArea().leave(this, true);
        }

        // Do stuff...
        PluginManager.emitPlayerLogout({
            player: this,
            username: this.getUsername(),
        });
        this.getRelations().updateLists(false);
        TaskManager.cancelTasks(this);
        this.setHasVengeance(false);
        this.getVengeanceTimer().stop();
        if (this.getAttribute?.(ATTR_SKIP_PERSISTENCE) !== true) {
            GameConstants.PLAYER_PERSISTENCE.save(this);
        }

        const ch: any = this.getSession()?.getChannel();
        if (ch && ch.connected) {
            ch.disconnect();
        }
    }

    /**
     
    Called by the world's login queue!
    */
    public onLogin() {
        // Attempt to register the player..
        if (!this.isPlayerBot()) {
            console.log("[World] Registering player - [username, host] : [" + this.getUsername() + ", " + this.getHostAddress() + "]");
        }

        // Minimal bring-up until the opcode stream is fully aligned.
        this.setNeedsPlacement(true);
        this.getMovementQueue().reset();
        this.getUpdateFlag().flag(Flag.APPEARANCE);
        this.setResetMovementQueue(true);
        this.getCombat().reset();
        this.getSkillManager().ensureCombatBaseline();
        this.getSkillManager().updateSkill(Skill.PRAYER);
        // Equipment is restored from the save without going through the equip
        // packet path, so the weapon interface/fight-styles/attack animation
        // (all driven by player.weapon, set here) are never assigned on login.
        WeaponInterfaceManager.assign(this);
        CombatSpecial.ensureRestoreTask(this);
        const autocastSpell = this.getCombat().getAutocastSpell();
        if (autocastSpell != null && autocastSpell.getSpellbook?.() !== this.getSpellbook()) {
            Autocasting.setAutocast(this, null);
        } else if (autocastSpell == null || this.getEquipment().hasStaffEquipped()) {
            Autocasting.setAutocast(this, autocastSpell);
        }
        for (const [varpId, value] of Object.entries(this.audioSettings)) {
            this.getPacketSender().sendConfig(Number(varpId), value);
        }
    }

    closeInterruptibleInterfaces(): void {
        if (
            this.status !== PlayerStatus.TRADING &&
            this.status !== PlayerStatus.DUELING &&
            (this.status !== PlayerStatus.NONE || this.interfaceId >= 0 || this.dialogueManager.isActive() ||
                this.packetSender.hasInterruptibleInterface())
        ) {
            this.packetSender.closeInterruptibleInterfaces();
        }
    }

    busy(): boolean {
        if (this.interfaceId > 0) {
            return true;
        }
        if (this.getHitpoints() <= 0) {
            return true;
        }
        if (this.isNeedsPlacement() || this.isTeleportingReturn()) {
            return true;
        }
        if (this.status != PlayerStatus.NONE) {
            return true;
        }
        if (this.forceMovement != null) {
            return true;
        }
        return false;
    }

    isStaff(): boolean {
        return this.rights !== PlayerRights.NONE;
    }

    isDonator(): boolean {
        return (this.donatorRights != DonatorRights.NONE);
    }


    isPacketsBlocked(): boolean {
        return this.packetsBlocked;
    }

    setPacketsBlocked(blocked: boolean) {
        this.packetsBlocked = blocked;
    }
    /*
         * Getters/Setters
         */
    public static Data = new Date();

    public getCreationDate(): Date {
        return this.creationDate;
    }

    public getAudioSettings(): Readonly<Record<number, number>> {
        return this.audioSettings;
    }

    public setAudioSettings(settings?: Record<number, number>): void {
        this.audioSettings = { ...DEFAULT_AUDIO_SETTINGS };
        if (!settings || typeof settings !== "object") return;
        for (const varpId of Object.keys(DEFAULT_AUDIO_SETTINGS).map(Number)) {
            this.setAudioSetting(varpId, settings[varpId]);
        }
    }

    public setAudioSetting(varpId: number, value: number): boolean {
        if (!(varpId in DEFAULT_AUDIO_SETTINGS) || !Number.isFinite(value)) return false;
        const maximum = varpId === 18 ? 2 : 100;
        this.audioSettings[varpId] = Math.max(0, Math.min(maximum, Math.trunc(value)));
        return true;
    }

    public setCreationDate(timestamp: Date) {
        this.creationDate = timestamp;
    }

    public getSession(): PlayerSession {
        return this.session;
    }

    public getUsername(): string {
        return this.username;
    }

    public setUsername(username: string): Player {
        this.username = username;
        return this;
    }

    public getLongUsername(): bigint {
        return this.longUsername;
    }

    public setLongUsername(longUsername: bigint): Player {
        this.longUsername = longUsername;
        return this;
    }

    public castlewarsKills: number;
    castlewarsDeaths: number;
    castlewarsIdleTime: number;

    public resetCastlewarsIdleTime(): void {
		this.castlewarsIdleTime = 200;
	}

    public getPasswordHashWithSalt(): string {
        return this.passwordHashWithSalt || "";
    }

    public setPasswordHashWithSalt(passwordHashWithSalt: string): Player {
        this.passwordHashWithSalt = passwordHashWithSalt;
        return this;
    }
    public getHostAddress(): string {
        return this.hostAddress;
    }

    public setHostAddress(hostAddress: string): this {
        this.hostAddress = hostAddress;
        return this;
    }

    public getRights(): PlayerRights {
        return this.rights;
    }

    public setRights(rights: PlayerRights): this {
        this.rights = rights;
        return this;
    }

    public getChatIcons(): readonly number[] {
        return this.chatIcons;
    }

    public setChatIcons(chatIcons: readonly number[]): this {
        this.chatIcons = chatIcons
            .filter((icon) => Number.isInteger(icon) && icon >= 0 && icon <= 255)
            .slice(0, 255);
        return this;
    }

    public getPacketSender(): PacketSender {
        return this.packetSender;
    }

    public getSkillManager(): SkillManager {
        return this.skillManager;
    }

    public getAppearance(): Appearance {
        return this.appearance;
    }

    public getForcedLogoutTimer(): SecondsTimer {
        return this.forcedLogoutTimer;
    }

    public isDyingReturn(): boolean {
        return this.isDying;
    }

    /**
     * Per-player view radius for the local-player rebuild. Shrinks while the view is
     * saturated and creeps back when it is not, so per-player cost stays bounded in a
     * crowd instead of growing with density. Ported from upstream's BuildArea.resize.
     */
    private viewDistance = Player.PREFERRED_VIEW_DISTANCE;
    private viewDistanceQuietCycles = 0;

    public getViewDistance(): number {
        return this.viewDistance;
    }

    public resizeViewDistance(localPlayerCount: number): void {
        if (localPlayerCount >= Player.PREFERRED_LOCAL_PLAYERS) {
            if (this.viewDistance > 1) this.viewDistance--;
            this.viewDistanceQuietCycles = 0;
            return;
        }
        if (++this.viewDistanceQuietCycles < Player.VIEW_DISTANCE_REGROW_CYCLES) {
            return;
        }
        this.viewDistanceQuietCycles = 0;
        if (this.viewDistance < Player.PREFERRED_VIEW_DISTANCE) this.viewDistance++;
    }

    public getLocalPlayers(): Player[] {
        return this.localPlayers;
    }

    public getLocalNpcs(): NPC[] {
        return this.localNpcs;
    }
    public getInterfaceId(): number {
        return this.interfaceId;
    }

    public setInterfaceId(interfaceId: number): this {
        this.interfaceId = interfaceId;
        return this;
    }

    public experienceLockedReturn(): boolean {
        return this.experienceLocked;
    }

    public setExperienceLocked(experienceLocked: boolean) {
        this.experienceLocked = experienceLocked;
    }

    public getRelations(): PlayerRelations {
        return this.relations;
    }

    public getWalkableInterfaceId(): number {
        return this.walkableInterfaceId;
    }

    public setWalkableInterfaceId(interfaceId: number) {
        this.walkableInterfaceId = interfaceId;
    }

    public isRunningReturn(): boolean {
        return this.isRunning;
    }

    public setRunning(isRunning: boolean): this {
        this.isRunning = isRunning;
        return this;
    }

    public getPlayerInteractingOption(): PlayerInteractingOption {
        return this.playerInteractingOption;
    }

    public setPlayerInteractingOption(playerInteractingOption: PlayerInteractingOption): Player {
        this.playerInteractingOption = playerInteractingOption;
        return this;
    }

    public getFrameUpdater(): FrameUpdater {
        return this.frameUpdater;
    }

    public getBonusManager(): BonusManager {
        return this.bonusManager;
    }

    public getMultiIcon(): number {
        return this.multiIcon;
    }

    public setMultiIcon(multiIcon: number): Player {
        if (this.multiIcon === multiIcon) {
            return this;
        }
        this.multiIcon = multiIcon;
        this.getPacketSender().sendMultiIcon(multiIcon);
        return this;
    }

    public getInventory(): Inventory {
        return this.inventory;
    }

    public getEquipment(): Equipment {
        return this.equipment;
    }

    public getForceMovement(): ForceMovement {
        return this.forceMovement;
    }

    public setForceMovement(forceMovement: ForceMovement): Player {
        this.forceMovement = forceMovement;
        if (this.forceMovement != null) {
            this.getUpdateFlag().flag(Flag.FORCED_MOVEMENT);
        }
        return this;
    }

    public getSkillAnimation(): number {
        return this.skillAnimation;
    }

    public setSkillAnimation(animation: number): Player {
        this.skillAnimation = animation;
        return this;
    }

    public getRunEnergy(): number {
        return this.runEnergy;
    }

    public setRunEnergy(runEnergy: number) {
        this.runEnergy = Math.max(0, Math.min(100, Math.floor(runEnergy)));
    }

    public isDrainingPrayer(): boolean {
        return this.drainingPrayer;
    }

    public setDrainingPrayer(drainingPrayer: boolean) {
        this.drainingPrayer = drainingPrayer;
    }

    public getPrayerPointDrain(): number {
        return this.prayerPointDrain;
    }

    public setPrayerPointDrain(prayerPointDrain: number) {
        this.prayerPointDrain = prayerPointDrain;
    }

    public markPrayerActivatedThisTick(): void {
        this.prayerActivatedThisTick = true;
    }

    /** Reads and clears the flag in one step so it only ever applies to a single tick. */
    public consumePrayerActivatedThisTick(): boolean {
        const activated = this.prayerActivatedThisTick;
        this.prayerActivatedThisTick = false;
        return activated;
    }

    public getLastItemPickup(): Stopwatch {
        return this.lastItemPickup;
    }

    public getCombatSpecial(): CombatSpecial {
        return this.combatSpecial;
    }

    public setCombatSpecial(combatSpecial: CombatSpecial) {
        this.combatSpecial = combatSpecial;
    }

    public getRecoilDamage(): number {
        return this.recoilDamage;
    }

    public setRecoilDamage(recoilDamage: number) {
        this.recoilDamage = recoilDamage;
    }

    public getSpellbook() {
        return this.spellbook;
    }

    public setSpellbook(spellbook: MagicSpellbook) {
        this.spellbook = spellbook;
    }

    public getVengeanceTimer(): SecondsTimer {
        return this.vengeTimer;
    }

    public getWildernessLevel(): number {
        return this.wildernessLevel;
    }

    public setWildernessLevel(wildernessLevel: number) {
        this.wildernessLevel = wildernessLevel;
    }

    public getDestroyItem(): number {
        return this.destroyItem;
    }

    public setDestroyItem(destroyItem: number) {
        this.destroyItem = destroyItem;
    }

    public isSkulled(): boolean {
        return this.skullTimer > 0;
    }

    public getAndDecrementSkullTimer(): number {
        return this.skullTimer--;
    }

    public getSkullTimer(): number {
        return this.skullTimer;
    }

    public setSkullTimer(skullTimer: number): void {
        this.skullTimer = skullTimer;
    }

    public getPoints(): number {
        return this.points;
    }

    public setPoints(points: number): void {
        this.points = points;
    }

    public incrementPoints(points: number): void {
        this.points += points;
    }

    public isUpdateInventory(): boolean {
        return this.updateInventory;
    }

    public setUpdateInventory(updateInventory: boolean): void {
        this.updateInventory = updateInventory;
    }

    public getClickDelay(): Stopwatch {
        return this.clickDelay;
    }

    public getShop(): any {
        return this.shop;
    }

    public setShop(shop: any): Player {
        this.shop = shop;
        return this;
    }

    public getStatus(): PlayerStatus {
        return this.status;
    }

    public setStatus(status: PlayerStatus): Player {
        this.status = status;
        return this;
    }

    public getCurrentBankTab(): number {
        if (!Number.isInteger(this.currentBankTab) || this.currentBankTab < 0 || this.currentBankTab >= Bank.TOTAL_BANK_TABS) {
            this.currentBankTab = 0;
        }
        return this.currentBankTab;
    }

    public setCurrentBankTab(tab: number): Player {
        if (!Number.isInteger(tab) || tab < 0 || tab >= Bank.TOTAL_BANK_TABS) {
            this.currentBankTab = 0;
        } else {
            this.currentBankTab = tab;
        }
        return this;
    }

    public setNoteWithdrawal(noteWithdrawal: boolean): void {
        this.noteWithdrawal = noteWithdrawal;
    }

    public withdrawAsNote(): boolean {
        return this.noteWithdrawal;
    }

    public setInsertMode(insertMode: boolean): void {
        this.insertMode = insertMode;
    }

    public insertModeReturn(): boolean {
        return this.insertMode;
    }

    public setBankQuantityMode(mode: number): void {
        this.bankQuantityMode = Math.max(0, Math.min(4, Math.trunc(mode)));
    }

    public getBankQuantityMode(): number {
        return this.bankQuantityMode;
    }

    public setBankCustomQuantity(amount: number): void {
        this.bankCustomQuantity = Math.max(0, Math.trunc(amount));
    }

    public getBankCustomQuantity(): number {
        return this.bankCustomQuantity;
    }

    public getBanks(): Bank[] {
        return this.banks;
    }

    public getBank(index: number): Bank {
        if (!Number.isInteger(index) || index < 0 || index >= Bank.TOTAL_BANK_TABS) {
            index = 0;
        }
        if (this.banks[index] == null) {
            this.banks[index] = new Bank(this);
        }
        return this.banks[index];
    }

    public setBank(index: number, bank: Bank): Player {
        if (!Number.isInteger(index) || index < 0 || index >= Bank.TOTAL_BANK_TABS) {
            index = 0;
        }
        this.banks[index] = bank;
        return this;
    }

    public isNewPlayer(): boolean {
        return this.newPlayer;
    }

    public setNewPlayer(newPlayer: boolean): void {
        this.newPlayer = newPlayer;
    }

    public isSearchingBank(): boolean {
        return this.searchingBank;
    }

    public setSearchingBank(searchingBank: boolean): void {
        this.searchingBank = searchingBank;
    }

    public getSearchSyntax(): string {
        return this.searchSyntax;
    }

    public setSearchSyntax(searchSyntax: string): void {
        this.searchSyntax = searchSyntax;
    }

    public isPreserveUnlocked(): boolean {
        return this.preserveUnlocked;
    }

    public getPreserveUnlocked(): boolean {
        return this.preserveUnlocked;
    }

    public setPreserveUnlocked(preserveUnlocked: boolean): void {
        this.preserveUnlocked = preserveUnlocked;
    }

    public isRigourUnlocked(): boolean {
        return this.rigourUnlocked;
    }

    public getRigourUnlocked(): boolean {
        return this.rigourUnlocked;
    }

    public setRigourUnlocked(rigourUnlocked: boolean): void {
        this.rigourUnlocked = rigourUnlocked;
    }


    public getAuguryUnlocked(): boolean {
        return this.auguryUnlocked;
    }

    public setAuguryUnlocked(auguryUnlocked: boolean): void {
        this.auguryUnlocked = auguryUnlocked;
    }

    public getCurrentClanChat(): any {
        return this.currentClanChat;
    }

    public setCurrentClanChat(currentClanChat: any): void {
        this.currentClanChat = currentClanChat;
    }

    public getClanChatName(): string {
        return this.clanChatName;
    }

    public setClanChatName(clanChatName: string): void {
        this.clanChatName = clanChatName;
    }

    public getTrading(): Trading {
        return this.trading;
    }

    public getQuickPrayers(): QuickPrayers {
        return this.quickPrayers;
    }

    public isTargetTeleportUnlocked(): boolean {
        return this.targetTeleportUnlocked;
    }


    public getTargetTeleportUnlocked(): boolean {
        return this.targetTeleportUnlocked;
    }

    public setTargetTeleportUnlocked(targetTeleportUnlocked: boolean): void {
        this.targetTeleportUnlocked = targetTeleportUnlocked;
    }

    public getYellDelay(): SecondsTimer {
        return this.yellDelay;
    }

    public getAmountDonated(): number {
        return this.amountDonated;
    }

    public setAmountDonated(amountDonated: number): void {
        this.amountDonated = amountDonated;
    }

    public isPlayerBot(): boolean {
        return this.playerBot;
    }

    public setPlayerBot(playerBot: boolean): void {
        this.playerBot = playerBot;
    }

    public incrementAmountDonated(amountDonated: number): void {
        this.amountDonated += amountDonated;
    }

    public getTotalKills(): number {
        return this.totalKills;
    }

    public setTotalKills(totalKills: number): void {
        this.totalKills = totalKills;
    }

    public incrementTotalKills(): void {
        this.totalKills++;
    }

    public incrementDeaths(): void {
        this.deaths++;
    }

    public getDeaths(): number {
        return this.deaths;
    }

    public setDeaths(deaths: number): void {
        this.deaths = deaths;
    }

    public getHighestKillstreak(): number {
        return this.highestKillstreak;
    }

    public setHighestKillstreak(highestKillstreak: number): void {
        this.highestKillstreak = highestKillstreak;
    }

    public getKillstreak(): number {
        return this.killstreak;
    }

    public setKillstreak(killstreak: number): void {
        this.killstreak = killstreak;
    }

    public incrementKillstreak() {
        this.killstreak++;
    }

    public getKillDeathRatio(): string {
        const deaths = this.deaths || 0;
        const kills = this.totalKills || 0;
        const ratio = deaths === 0 ? kills : kills / deaths;
        return isFinite(ratio) ? Misc.FORMATTER.format(ratio) : "0";
    }

    public getRecentKills(): string[] {
        return this.recentKills;
    }

    public getSpecialAttackRestore(): SecondsTimer {
        return this.specialAttackRestore;
    }

    public getSkullType(): SkullType {
        return this.skullType;
    }

    public setSkullType(skullType: SkullType) {
        this.skullType = skullType;
    }

    public getEffectiveSkullIcon(): number {
        const inventory = this.getInventory?.()?.getItems?.();
        let keyCount = 0;
        if (inventory) {
            for (const item of inventory) {
                if (item && item.getId() >= 26651 && item.getId() <= 26655) {
                    keyCount++;
                }
            }
        }
        if (keyCount > 0) {
            return Math.min(12, 7 + keyCount);
        }
        return this.isSkulled() ? this.getSkullType().getIconId() : -1;
    }

    public getDueling(): Dueling {
        return this.dueling;
    }

    public getCrystalBowShotsInStage(): number {
        return this.crystalBowShotsInStage;
    }

    public setCrystalBowShotsInStage(crystalBowShotsInStage: number) {
        this.crystalBowShotsInStage = crystalBowShotsInStage;
    }

    public getCrystalBowTrackedStageItemId(): number {
        return this.crystalBowTrackedStageItemId;
    }

    public setCrystalBowTrackedStageItemId(crystalBowTrackedStageItemId: number) {
        this.crystalBowTrackedStageItemId = crystalBowTrackedStageItemId;
    }

    public getCurrentPet(): NPC {
        return this.currentPet;
    }

    public setCurrentPet(currentPet: NPC) {
        this.currentPet = currentPet;
    }

    public getAggressionTolerance(): SecondsTimer {
        return this.aggressionTolerance;
    }

    public getCachedUpdateBlock(): Buffer {
        return this.cachedUpdateBlock;
    }

    public setCachedUpdateBlock(cachedUpdateBlock: Buffer) {
        this.cachedUpdateBlock = cachedUpdateBlock;
    }

    public getSkill(): any {
        return this.skill;
    }

    public setSkill(skill: any) {
        this.skill = skill;
    }

    public getCreationMenu(): CreationMenu {
        return this.creationMenu;
    }

    public setCreationMenu(creationMenu: CreationMenu): void {
        this.creationMenu = creationMenu;
    }

    public getPouches(): any[] {
        return this.pouches;
    }

    public setPouches(pouches: any[]): void {
        this.pouches = pouches;
    }

    public getLoyaltyTitle(): string {
        return this.loyaltyTitle;
    }

    public setLoyaltyTitle(loyaltyTitle: string): void {
        this.loyaltyTitle = loyaltyTitle;
        this.getUpdateFlag().flag(Flag.APPEARANCE);
    }

    public hasInfiniteHealth(): boolean {
        return this.infiniteHealth;
    }

    public setInfiniteHealth(infiniteHealth: boolean): void {
        this.infiniteHealth = infiniteHealth;
    }

    public getDonatorRights(): DonatorRights {
        return this.donatorRights;
    }

    public setDonatorRights(donatorPrivilege: typeof DonatorRights.NONE): void {
        this.donatorRights = donatorPrivilege;
    }

    public isPlaceholders(): boolean {
        return this.placeholders;
    }

    public setPlaceholders(placeholders: boolean): void {
        this.placeholders = placeholders;
    }

    public getCurrentPreset(): Presetable {
        return this.currentPreset;
    }

    public setCurrentPreset(currentPreset: Presetable): void {
        this.currentPreset = currentPreset;
    }

    public getChatMessageQueue(): Array<ChatMessage> {
        return this.chatMessageQueue;
    }

    public getCurrentChatMessage(): ChatMessage {
        return this.currentChatMessage;
    }

    public setCurrentChatMessage(currentChatMessage: ChatMessage): void {
        this.currentChatMessage = currentChatMessage;
    }

    public sendChat(message: string, colour: number = 0, effect: number = 0) {
        if (!message) {
            return;
        }
        const packed = Misc.textPack(message);
        this.getChatMessageQueue().push(new ChatMessage(colour, effect, packed));
        this.getUpdateFlag().flag(Flag.CHAT);
    }

    public manipulateHit(hit: PendingHit): PendingHit {
        let attacker = hit.getAttacker();

        if (attacker.isNpc()) {
            let npc = attacker.getAsNpc();
            if (npc.getId() == NpcIdentifiers.TZTOK_JAD) {
                if (PrayerHandler.isActivated(this, PrayerHandler.getProtectingPrayer(hit.getCombatType()))) {
                    hit.setTotalDamage(0);
                }
            }
        }

        return hit;
    }

    public getOldPosition(): Location {
        return this.oldPosition;
    }

    public setOldPosition(oldPosition: Location): void {
        this.oldPosition = oldPosition;
    }

    public getEnteredAmountAction(): EnteredAmountAction {
        return this.enteredAmountAction;
    }

    public setEnteredAmountAction(enteredAmountAction: EnteredAmountAction): void {
        this.enteredAmountAction = enteredAmountAction;
    }

    public getEnteredSyntaxAction(): EnteredSyntaxAction {
        return this.enteredSyntaxAction;
    }

    public setEnteredSyntaxAction(enteredSyntaxAction: EnteredSyntaxAction): void {
        this.enteredSyntaxAction = enteredSyntaxAction;
    }

    public getSlayerTask(): any {
        return this.slayerTask;
    }

    public setSlayerTask(slayerTask: any): void {
        this.slayerTask = slayerTask;
    }

    public getConsecutiveTasks(): number {
        return this.consecutiveTasks;
    }

    public setConsecutiveTasks(consecutiveTasks: number): void {
        this.consecutiveTasks = consecutiveTasks;
    }

    public getSlayerPoints(): number {
        return this.slayerPoints;
    }

    public setSlayerPoints(slayerPoints: number): void {
        this.slayerPoints = slayerPoints;
    }

    public getDialogueManager(): DialogueManager {
        return this.dialogueManager;
    }

    public getWeapon(): WeaponInterfaces {
        return this.weapon;
    }

    public setWeapon(weapon: WeaponInterfaces): void {
        this.weapon = weapon;
    }

    public getFightType(): FightType {
        const resolvedFightType = FightType.resolve(this.fightType);
        if (resolvedFightType) {
            this.fightType = resolvedFightType;
            return resolvedFightType;
        }

        const equippedWeapon = this.getEquipment().getItems()[Equipment.WEAPON_SLOT];
        if (equippedWeapon && equippedWeapon.getId() > 0) {
            const weaponInterface = equippedWeapon.getDefinition()?.getWeaponInterface?.();
            if (weaponInterface) {
                const availableFightTypes = Object.values(weaponInterface.getFightType())
                    .filter((type): type is FightType => type instanceof FightType);
                if (availableFightTypes.length > 0) {
                    this.fightType = availableFightTypes[0];
                    return this.fightType;
                }
            }
        }

        this.fightType = FightType.UNARMED_KICK;
        return this.fightType;
    }

    public setFightType(fightType: FightType): void {
        const resolvedFightType = FightType.resolve(fightType);
        if (!resolvedFightType) {
            return;
        }
        this.fightType = resolvedFightType;
    }

    public autoRetaliateReturn(): boolean {
        return this.autoRetaliate;
    }

    public setAutoRetaliate(autoRetaliate: boolean): void {
        this.autoRetaliate = autoRetaliate;
    }

    public isDiscordLoginReturn(): boolean {
        return this.isDiscordLogin;
    }
    public setDiscordLogin(discordLogin: boolean) {
        this.isDiscordLogin = discordLogin;
    }

    public getCachedDiscordAccessToken(): string {
        return this.cachedDiscordAccessToken;
    }

    public setCachedDiscordAccessToken(cachedDiscordAccessToken: string) {
        this.cachedDiscordAccessToken = cachedDiscordAccessToken;
    }

    public climb(down: boolean, location: Location): void {
        this.performAnimation(new Animation(down ? 827 : 828));
        const task = new PlayerTask(1, this.getIndex(), true, () => {
            let ticks = 0;
            ticks++;
            if (ticks === 2) {
                this.moveTo(location);
                task.stop();
            }
        });
        TaskManager.submit(task);
    }
}

class PlayerTask extends Task{
    constructor(n1: number, n2: number, b: boolean, private readonly execFunc: Function){
        super(n1, n2, b)
    }
    execute(): void {
        this.execFunc();
    }
    
}
