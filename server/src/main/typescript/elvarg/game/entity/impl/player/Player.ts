import { GameConstants } from "../../../GameConstants";
import { MAIN_PROFILE, type PlayerProfile } from "./persistence/PlayerProfile";
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
import { SkillManager } from "../../../content/skill/SkillManager";
import { ItemDefinition } from "../../../definition/ItemDefinition";
import { Mobile } from "../Mobile";
import { NPC } from "../npc/NPC";
import { NpcAggression } from "../npc/NpcAggression";
import { AggressionTolerance } from "../npc/AggressionTolerance";
import { Animation } from "../../../model/Animation";
import { Appearance } from "../../../model/Appearance";
import { EnteredAmountAction } from "../../../model/EnteredAmountAction";
import { EnteredSyntaxAction } from "../../../model/EnteredSyntaxAction";
import { Flag } from "../../../model/Flag";
import { ForceMovement } from "../../../model/ForceMovement";
import { Location } from "../../../model/Location";
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
import { TickStopwatch } from "../../../../util/TickStopwatch";
import { TimerKey } from "../../../../util/timers/TimerKey";
import { emptySailingState, type SailingState } from "../../../content/sailing/SailingState";
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
import { getSequencePriority } from "../../../cache/NpcAnimationScanner";
import { LOGIN_TOKENS_ATTRIBUTE } from "../../../../net/login/LoginTokens";

const ATTR_SKIP_PERSISTENCE = "bot-skip-persistence";
const DEFAULT_AUDIO_SETTINGS: Readonly<Record<number, number>> = {
    18: 0,
    168: 100,
    169: 100,
    872: 100,
    3796: 100,
    // The levels the mute buttons restore: varbits of options_save_sounds (music, sound effects,
    // area sounds, jingles) and options_save_sounds2 (master). Packed, so not clamped to 100.
    3109: 0,
    3797: 0,
};
const PACKED_AUDIO_VARPS = new Set([3109, 3797]);

export class Player extends Mobile {
    public static readonly INFINITE_HEALTH_ATTRIBUTE = "admin:infinite-health";
    public static readonly BANK_NOTE_WITHDRAWAL_ATTRIBUTE = "bank:note-withdrawal";
    public static readonly BANK_INSERT_MODE_ATTRIBUTE = "bank:insert-mode";
    public static readonly BANK_QUANTITY_MODE_ATTRIBUTE = "bank:quantity-mode";
    public static readonly BANK_CUSTOM_QUANTITY_ATTRIBUTE = "bank:custom-quantity";
    public static readonly BANK_PLACEHOLDERS_ATTRIBUTE = "bank:placeholders";

    getSize(): number {
        return 1;
    }
    /** Wiki (Temporary skill boost, Hitpoints): natural restoration runs on one-minute (100-tick) cycles. */
    public static readonly STAT_RESTORE_TICKS = 100;
    /** Wiki (Rapid Heal): Rapid Heal or a Hitpoints cape heal a point every 30 seconds. */
    public static readonly FAST_HITPOINTS_REGEN_TICKS = 50;
    /** Cycle the next drained-stat restore is due on (-1: not started). */
    private statRestoreDue = -1;
    /** Cycle Rapid Restore's own restore is due on; it starts when the prayer is switched on. */
    private rapidRestoreDue = -1;
    /** Cycle the Hitpoints countdown started on; switching Rapid Heal on or off restarts it. */
    private hitpointsTimerStart = -1;
    private rapidHealWasActive = false;
    private hitpointsRegen: { player: Player; fast: boolean; amount: number } | null = null;
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
    private clickDelay = new TickStopwatch();
    private lastItemPickup = new TickStopwatch();
    private aggressionTolerance = new AggressionTolerance(this);
    // Delay for restoring special attack
    private specialAttackRestore = new SecondsTimer();
    /*
    * Fields
    */
    private vengeTimer: SecondsTimer = new SecondsTimer();
    // Logout
    public forcedLogoutTimer = new SecondsTimer();
    /** Why the connection ended, for the disconnect hooks fired when the player leaves the world. */
    private disconnectSource: string | null = null;
    /** Cycle a removal in combat started waiting, -1 when not waiting. */
    private logoutHoldCycle = -1;
    // Trading
    private trading = new Trading(this);
    // Owned boats and where they are
    private sailing: SailingState = emptySailingState();
    private dueling = new Dueling(this);
    public dialogueManager = new DialogueManager(this);

    public username: string;
    private passwordHashWithSalt: string;
    private hostAddress: string;
    private isDiscordLogin: boolean = false;
    private cachedDiscordAccessToken: string = "";
    public longUsername: bigint = 0n;
    /** See getProfile. Bots and tests build players outside login, so it defaults to the main profile. */
    private profile: PlayerProfile = MAIN_PROFILE;
    private session: PlayerSession;
    public status: PlayerStatus = PlayerStatus.NONE;
    public interfaceId: number = -1
    /** The process cycle of the player's last click or key press (0 before any since login). */
    public lastInputCycle = 0;
    private multiIcon: number;
    private isRunning = true;
    private playerBot = false;
    private botAreaProcessTick = 0;
    private runEnergy = 100;
    private lastRunRecovery = new TickStopwatch();
    private isDying: boolean;
    public forceMovement: ForceMovement;
    private skillAnimation: number;
    private renderAnimations: number[] | null = null;
    /** Equipment slot -> item id shown in the appearance instead of the worn item (-1 shows the slot empty). */
    private displayedEquipment: Map<number, number> | null = null;
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

    // Skilling
    private skill: any;
    private creationMenu: CreationMenu;
    // Entering data
    public enteredAmountAction: EnteredAmountAction;
    private enteredSyntaxAction: EnteredSyntaxAction;

    // Time the account was created
    private creationDate = new Date();
    // Combat
    private static readonly PREFERRED_VIEW_DISTANCE = 15;
    private static readonly PREFERRED_LOCAL_PLAYERS = 250;
    private static readonly VIEW_DISTANCE_REGROW_CYCLES = 10;
    public skullType: SkullType;
    private skullIconOverride: number | null = null;
    /** The override shows even without a skull timer (risk skulls); otherwise only while skulled. */
    private skullIconOverrideAlways = false;
    public combatSpecial: CombatSpecial;
    private vengeanceTimer = new SecondsTimer();
    private wildernessLevel: number;
    public skullTimer: number;
    // Banking
    // Java primitive int defaults to 0; initialize explicitly in TS to avoid undefined tab routing.
    public currentBankTab = 0;
    public banks: Bank[] = Array(Bank.TOTAL_BANK_TABS).fill(null); // last index is for bank searches
    private searchingBank = false;
    private searchSyntax = "";
    private fightType = FightType.UNARMED_KICK;
    public weapon: WeaponInterfaces = WeaponInterfaces.UNARMED;
    private autoRetaliate = true;
    private audioSettings: Record<number, number> = { ...DEFAULT_AUDIO_SETTINGS };

    // Rights
    public rights = PlayerRights.NONE;
    private chatIcons: number[] = [];
    public donatorRights = DonatorRights.NONE;
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
        this.getCombat().getPoisonClock().resetPhase();
        this.getCombat().getTeleblockTimer().stop();
        this.getTimers().cancel(TimerKey.FREEZE);
        this.getTimers().cancel(TimerKey.FREEZE_IMMUNITY);
        this.getCombat().setCastSpell(null);
        this.getCombat().setPreviousCast(null);
        this.getCombat().getPrayerBlockTimer().stop();
        this.setPoisonDamage(0);
        this.setVenomed(false);
        this.setWildernessLevel(0);
        this.setAttribute(CombatFactory.RECOIL_DAMAGE_ATTRIBUTE, 0);
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
            const beforeDeath = { player: this, preventDeath: false, announce: true };
            if (PluginManager.emitPlayerBeforeDeath(beforeDeath)) {
                return;
            }
            // A respawn is the same Player object; drop rolls cached against the state it died in.
            CombatFactory.clearHitRollCache(this);
            TaskManager.submit(new PlayerDeathTask(this, beforeDeath.announce !== false));
            this.isDying = true;
        }
    }

    public getHitpoints(): number {
        return this.getSkillManager().getCurrentLevel(Skill.HITPOINTS);
    }

    public getAttackAnim(target?: Mobile): number {
        const fightType = FightType.resolve(this.getFightType()) ?? FightType.UNARMED_KICK;
        const againstNpc = target?.isNpc?.() === true;
        return WeaponProfiles.attackAnimation(this, fightType.getAnimationAgainst(againstNpc), againstNpc);
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

        if (this.getAttribute(Player.INFINITE_HEALTH_ATTRIBUTE) === true) {
            if (this.getSkillManager().getCurrentLevel(Skill.HITPOINTS) > hitpoints) {
                return this;
            }
        }

        const previous = this.getSkillManager().getCurrentLevel(Skill.HITPOINTS);
        if (hitpoints > previous) {
            // A heal, whatever its source: plugins may change `amount` (a league passive). A raised
            // heal reaches full hitpoints at most; an overheal (a brew) keeps its own target.
            const heal = { player: this, previous, amount: hitpoints - previous, hitpoints };
            PluginManager.emitCustomEvent("stats:heal", heal);
            const amount = Number.isFinite(heal.amount) ? Math.max(0, Math.floor(heal.amount)) : hitpoints - previous;
            hitpoints = Math.min(previous + amount, Math.max(hitpoints, this.getSkillManager().getMaxLevel(Skill.HITPOINTS)));
        }

        this.getSkillManager().setCurrentLevels(Skill.HITPOINTS, hitpoints);
        this.getPacketSender().sendSkill(Skill.HITPOINTS);
        if (this.getHitpoints() <= 0 && !this.isDying)
            this.appendDeath();
        return this;
    }
    public heal(amount: number) {
        const current = this.getSkillManager().getCurrentLevel(Skill.HITPOINTS);
        const cap = Math.max(current, this.getSkillManager().getMaxLevel(Skill.HITPOINTS));
        this.setHitpoints(Math.min(current + amount, cap));
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

    /** An arrival-step animation held for one cycle (see performAnimation). */
    private arrivalAnimation: Animation | null = null;

    /**
     * OSRS p_arrivedelay, applied globally: the client drops a priority-1 seq
     * (skilling loops) that lands in the same update as a step, so one started on
     * the tick the player stepped is held a tick. A further step drops it, as the
     * client would.
     */
    override performAnimation(animation: Animation) {
        if (animation != null && this.getMovementQueue().steppedThisWorldCycle() &&
            getSequencePriority(animation.getId()) === 1) {
            this.arrivalAnimation = animation;
            return;
        }
        this.arrivalAnimation = null;
        super.performAnimation(animation);
        // Wiki: Animation stall. A swing's animation is measured here, the one place every
        // source of one (styles, specials, spells) arrives. A seq turned away by priority was
        // never started, so it must not be measured.
        if (animation != null && this.getAnimation() === animation) {
            this.getCombat().onAnimationStarted(animation.getId());
        }
    }

    /** The hitpoints orb's poison state as last sent (varp 102); undefined sends it on the first tick. */
    private lastPoisonOrb: number | undefined = undefined;

    /** Sends the orb's poison/venom/immunity value when it changes (CombatPoisonEffect.orbValue). */
    private syncPoisonOrb(): void {
        const value = CombatPoisonEffect.orbValue(this);
        if (value === this.lastPoisonOrb) return;
        this.lastPoisonOrb = value;
        this.getPacketSender().sendConfig(CombatPoisonEffect.ORB_VARP, value);
    }

    public process() {
        const isBot = this.isPlayerBot();
        const timed = <T>(phase: string, fn: () => T): T =>
            ServerPerf.measurePhase(`player.process.${phase}`, fn);

        // Client input first: packets received since the last turn act now, on the tick.
        timed("client_input", () => this.getSession()?.processPackets());
        // Queued impacts land before this player acts, matching LostCity's
        // processQueues-then-processInteraction order. A hit that kills them here
        // stops the rest of this turn via the isDying/hitpoints guards below.
        timed("combat_hits", () => this.getCombat().getHitQueue().process(World.getProcessCycle()));

        // Timers
        timed("timers", () => this.getTimers().process());
        if (!isBot) this.syncPoisonOrb();

        const movement = this.getMovementQueue();
        const combat = this.getCombat();
        movement.beginCycle();
        const processCombat = combat.hasPendingWork();
        if (processCombat) {
            timed("combat_pre_movement", () => combat.preMovementProcess());
        }

        movement.processEntityPursuit();
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

        // Release last cycle's held arrival animation, unless this cycle stepped again.
        const held = this.arrivalAnimation;
        this.arrivalAnimation = null;
        if (held && !movement.didMoveThisCycle()) super.performAnimation(held);

        // Reach checks for walk-to interactions run here, after this cycle's steps,
        // so arriving at an object/npc/ground item resolves on the same cycle.
        timed("walk_to_interaction", () => TaskManager.processWalkTo(this.getIndex()));

        // Process aggression
        if (!isBot) {
            this.aggressionTolerance.update(this.getLocation());
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

        this.processSkullTimer();

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

        // Restore lowered stats and regenerate Hitpoints. Boosts other than Hitpoints decay on
        // the Potions plugin's continuous cycle.
        if (this.getHitpoints() > 0) {
            timed("stats", () => this.processStatRestoration(World.getProcessCycle()));
        }
    }

    /**
     * Natural restoration on cycle deadlines (bots take turns on a stride, so they catch up):
     * - lowered stats other than Hitpoints and Prayer gain a point every minute, and Rapid Restore
     *   adds a point every minute on its own timer from when it is switched on (Wiki: Rapid Restore);
     * - Hitpoints heal a point every minute, every 30 seconds with Rapid Heal or a Hitpoints cape
     *   ("stats:hitpoints-regen", which also lets a regen bracelet double the amount), and Hitpoints
     *   above base drop a point a minute; switching Rapid Heal on or off restarts that countdown
     *   (Wiki: Hitpoints, Rapid Heal). Player bots keep their boosts.
     */
    public processStatRestoration(cycle: number): void {
        const skills = this.getSkillManager();
        if (this.statRestoreDue < 0) this.statRestoreDue = cycle + Player.STAT_RESTORE_TICKS;
        const restoreDue = cycle >= this.statRestoreDue;
        if (restoreDue) this.statRestoreDue = cycle + Player.STAT_RESTORE_TICKS;

        const rapidRestore = PrayerHandler.isActivated(this, PrayerHandler.RAPID_RESTORE);
        if (!rapidRestore) this.rapidRestoreDue = -1;
        else if (this.rapidRestoreDue < 0) this.rapidRestoreDue = cycle + Player.STAT_RESTORE_TICKS;
        const rapidRestoreDue = rapidRestore && cycle >= this.rapidRestoreDue;
        if (rapidRestoreDue) this.rapidRestoreDue = cycle + Player.STAT_RESTORE_TICKS;

        if (restoreDue || rapidRestoreDue) {
            // An area can pause non-Hitpoints restoration (Rogues' Den holds a drained Agility/
            // Thieving level for the whole maze). Hitpoints still regenerate below.
            const request = { player: this, allowed: true };
            PluginManager.emitCustomEvent("stats:natural-restore", request);
            if (request.allowed) {
                const points = (restoreDue ? 1 : 0) + (rapidRestoreDue ? 1 : 0);
                for (const skill of Skill.values()) {
                    if (skill === Skill.HITPOINTS || skill === Skill.PRAYER) continue;
                    const max = skills.getMaxLevel(skill);
                    if (skills.getCurrentLevel(skill) < max) skills.increaseCurrentLevel(skill, points, max);
                }
            }
        }

        const rapidHeal = PrayerHandler.isActivated(this, PrayerHandler.RAPID_HEAL);
        if (this.hitpointsTimerStart < 0 || rapidHeal !== this.rapidHealWasActive) this.restartHitpointsTimer(cycle);
        this.rapidHealWasActive = rapidHeal;
        const elapsed = cycle - this.hitpointsTimerStart;
        if (elapsed < Player.FAST_HITPOINTS_REGEN_TICKS) return;
        const current = skills.getCurrentLevel(Skill.HITPOINTS);
        const max = skills.getMaxLevel(Skill.HITPOINTS);
        if (current < max) {
            // Gear answers once per countdown, again after an equipment change: { fast } halves it,
            // { amount } is what one regen heals.
            if (this.hitpointsRegen === null) {
                this.hitpointsRegen = { player: this, fast: rapidHeal, amount: 1 };
                PluginManager.emitCustomEvent("stats:hitpoints-regen", this.hitpointsRegen);
            }
            if (!this.hitpointsRegen.fast && elapsed < Player.STAT_RESTORE_TICKS) return;
            skills.increaseCurrentLevel(Skill.HITPOINTS, this.hitpointsRegen.amount, max);
        } else if (elapsed < Player.STAT_RESTORE_TICKS) {
            return;
        } else if (current > max && !this.isPlayerBot()) {
            skills.decreaseCurrentLevel(Skill.HITPOINTS, 1, max);
        }
        this.restartHitpointsTimer(cycle);
    }

    /** Worn items changed: the next Hitpoints regen asks gear again, keeping the countdown. */
    public onEquipmentChanged(): void {
        this.hitpointsRegen = null;
    }

    private restartHitpointsTimer(cycle: number): void {
        this.hitpointsTimerStart = cycle;
        this.hitpointsRegen = null;
    }

    /** Ticks after the last hit taken before the logout button works: "10 seconds" (rsprox captures). */
    public static readonly LOGOUT_COMBAT_TICKS = 16;
    /** Ticks a player removed in combat stays in the world before being forced out: 60 seconds (OSRS Wiki). */
    public static readonly LOGOUT_HOLD_TICKS = 100;

    /** Whether the player was hit in combat too recently to log out. */
    inLogoutCombat(): boolean {
        return this.getCombat().ticksSinceAttacked() < Player.LOGOUT_COMBAT_TICKS;
    }

    /** Why the logout button is refused right now, or null when it works. Plugins add their own refusals. */
    logoutRefusal(): string | null {
        return this.inLogoutCombat() ? "You can't log out until 10 seconds after the end of combat." : null;
    }

    /** Records why the connection ended; the first reason wins. */
    setDisconnectSource(source: string): void {
        if (this.disconnectSource === null) this.disconnectSource = source;
    }

    getDisconnectSource(): string | null {
        return this.disconnectSource;
    }

    /**
     * Whether a player queued for removal leaves the world this tick. Out of combat they
     * leave at once; a player hit in the last 16 ticks stays (and can still be attacked)
     * until combat ends or 60 seconds pass, as after a disconnect in live OSRS.
     */
    readyToLeaveWorld(): boolean {
        if (this.forcedLogoutTimer.isRunning() && this.forcedLogoutTimer.finished()) return true;
        if (!this.inLogoutCombat()) return true;
        const cycle = World.getProcessCycle();
        if (this.logoutHoldCycle < 0) this.logoutHoldCycle = cycle;
        return cycle - this.logoutHoldCycle >= Player.LOGOUT_HOLD_TICKS;
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

        // Return offered items to both players before this player is saved.
        this.getTrading().closeTrade();
        this.setFollowing(null);
        this.setMobileInteraction(null);
        this.setPositionToFace(null);
        // Record a boat at sea (and step ashore) before this player is saved.
        (require("../../../content/sailing/Sailing") as typeof import("../../../content/sailing/Sailing"))
            .Sailing.onLogout(this);
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
        CombatPoisonEffect.suspend(this);
        TaskManager.cancelTasks(this);
        this.setHasVengeance(false);
        this.getVengeanceTimer().stop();
        if (this.getAttribute?.(ATTR_SKIP_PERSISTENCE) !== true) {
            GameConstants.PLAYER_PERSISTENCE.cancelRequestedSave(this);
            GameConstants.PLAYER_PERSISTENCE.save(this, "logout");
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
        CombatPoisonEffect.resume(this);
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

    /**
     * OSRS hard interruption for item actions inside the inventory: clears the queued
     * interaction (combat target or walk-to callback) but leaves the walk queue intact,
     * so the player keeps walking to the clicked destination without completing the
     * action. osrs-docs: Entity Interactions - Interruptions.
     */
    clearPendingAction(): void {
        this.getCombat().clearInteraction();
        TaskManager.cancelWalkToTasks(this.getIndex());
    }

    isStaff(): boolean {
        return this.rights !== PlayerRights.NONE;
    }

    isDonator(): boolean {
        return (this.donatorRights != DonatorRights.NONE);
    }
    /*
         * Getters/Setters
         */
    public getCreationDate(): Date {
        return this.creationDate;
    }

    /** Restore account identity without accepting corrupt or future save dates. */
    public setCreationDate(timestamp: number): void {
        if (Number.isSafeInteger(timestamp) && timestamp > 0 && timestamp <= Date.now()) {
            this.creationDate = new Date(timestamp);
        }
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
        const maximum = varpId === 18 ? 2 : PACKED_AUDIO_VARPS.has(varpId) ? 0x7fffffff : 100;
        this.audioSettings[varpId] = Math.max(0, Math.min(maximum, Math.trunc(value)));
        return true;
    }

    /**
     * An audio varp the client transmitted. A change is announced as the "audio:setting-changed"
     * custom event ({ player, varpId, previous, value }) so plugins can answer it, as the Music
     * plugin does when the music volume rises from 0.
     */
    public applyAudioSettingFromClient(varpId: number, value: number): boolean {
        const previous = this.audioSettings[varpId];
        if (!this.setAudioSetting(varpId, value)) return false;
        const next = this.audioSettings[varpId];
        if (next !== previous) {
            PluginManager.emitCustomEvent("audio:setting-changed", { player: this, varpId, previous, value: next });
        }
        return true;
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

    /** Which of the account's characters this is: the main one unless login asked for another. Runtime only; the save never carries it. */
    public getProfile(): PlayerProfile {
        return this.profile;
    }

    public setProfile(profile: PlayerProfile): Player {
        this.profile = profile;
        return this;
    }

    public getLongUsername(): bigint {
        return this.longUsername;
    }

    public setLongUsername(longUsername: bigint): Player {
        this.longUsername = longUsername;
        return this;
    }

    public getPasswordHashWithSalt(): string {
        return this.passwordHashWithSalt || "";
    }

    public setPasswordHashWithSalt(passwordHashWithSalt: string): Player {
        // A new password signs out every remembered login.
        if (this.passwordHashWithSalt && this.passwordHashWithSalt !== passwordHashWithSalt) {
            this.setAttribute(LOGIN_TOKENS_ATTRIBUTE, []);
        }
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
        return this.fixedViewDistance ?? this.viewDistance;
    }

    /** A view distance kept regardless of the crowd (a spectator watching a room), or null. */
    private fixedViewDistance: number | null = null;

    /** Fixes how far other players are seen (up to 64), as for a spectator; null resizes again. */
    public setFixedViewDistance(distance: number | null): void {
        this.fixedViewDistance = distance == null ? null : Math.max(1, Math.min(64, Math.trunc(distance)));
    }

    /** How far away NPCs (and their projectiles) are seen; 15 unless an area widens it. */
    private npcViewDistance = Player.NPC_VIEW_DISTANCE;
    private static readonly NPC_VIEW_DISTANCE = 15;
    /** NPC positions are sent as signed 8-bit offsets from the player. */
    private static readonly MAX_NPC_VIEW_DISTANCE = 127;

    public getNpcViewDistance(): number {
        return this.npcViewDistance;
    }

    /**
     * Widens how far NPCs are seen, as OSRS does in some large arenas (the Doom of Mokhaiotl's
     * fight uses the large NPC update throughout). null puts it back to 15.
     */
    public setNpcViewDistance(distance: number | null): void {
        this.npcViewDistance = distance == null
            ? Player.NPC_VIEW_DISTANCE
            : Math.max(1, Math.min(Player.MAX_NPC_VIEW_DISTANCE, Math.trunc(distance)));
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
        const previousId = this.interfaceId;
        if (this.interfaceId >= 0 && interfaceId >= 0 && this.interfaceId !== interfaceId) {
            PluginManager.emitCustomEvent("interface:closed", { player: this, interfaceId: this.interfaceId });
        }
        this.interfaceId = interfaceId;
        if (previousId !== interfaceId) {
            PluginManager.emitCustomEvent("interface:changed", { player: this, previousId, interfaceId });
        }
        return this;
    }

    public getRelations(): PlayerRelations {
        return this.relations;
    }

    public isRunningReturn(): boolean {
        return this.isRunning;
    }

    public setRunning(isRunning: boolean): this {
        this.isRunning = isRunning;
        return this;
    }

    /** A transformed appearance carries no items, so the equipment tab gets the worn inventory. */
    public setNpcTransformationId(npcTransformationId: number): this {
        super.setNpcTransformationId(npcTransformationId);
        if (npcTransformationId >= 0) {
            this.getEquipment()?.sendWornInventory();
        }
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

    /** Stand/turn/walk/turn180/turn90cw/turn90ccw/run sequences that replace the weapon's set. */
    public getRenderAnimations(): number[] | null {
        return this.renderAnimations;
    }

    public setRenderAnimations(animations: number[] | null): Player {
        this.renderAnimations = animations;
        return this;
    }

    public getDisplayedEquipment(): ReadonlyMap<number, number> | null {
        return this.displayedEquipment;
    }

    /**
     * Shows other items in some equipment slots without touching the worn equipment, as live
     * shows a magic carpet in the weapon slot for a ride; null shows what is worn again.
     */
    public setDisplayedEquipment(overrides: Record<number, number> | null): Player {
        this.displayedEquipment = overrides
            ? new Map(Object.entries(overrides).map(([slot, itemId]) => [Number(slot), itemId]))
            : null;
        this.getUpdateFlag().flag(Flag.APPEARANCE);
        return this;
    }

    /** The item id each equipment slot shows in the appearance. */
    public getAppearanceEquipmentIds(): number[] {
        return this.getEquipment().getItems().map((item, slot) =>
            this.displayedEquipment?.get(slot) ?? item?.getId?.() ?? -1);
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

    public getLastItemPickup(): TickStopwatch {
        return this.lastItemPickup;
    }

    public getCombatSpecial(): CombatSpecial {
        return this.combatSpecial;
    }

    public setCombatSpecial(combatSpecial: CombatSpecial) {
        this.combatSpecial = combatSpecial;
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

    public isSkulled(): boolean {
        return this.skullTimer > 0;
    }

    /** Counts the skull down a tick; the appearance drops the skull icon on the tick it runs out. */
    public processSkullTimer(): void {
        if (!this.isSkulled()) {
            return;
        }
        if (--this.skullTimer === 0) {
            this.getUpdateFlag().flag(Flag.APPEARANCE);
        }
    }

    public getSkullTimer(): number {
        return this.skullTimer;
    }

    public setSkullTimer(skullTimer: number): void {
        this.skullTimer = skullTimer;
    }

    public getClickDelay(): TickStopwatch {
        return this.clickDelay;
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
        this.setAttribute(Player.BANK_NOTE_WITHDRAWAL_ATTRIBUTE, noteWithdrawal);
    }

    public withdrawAsNote(): boolean {
        return this.getAttribute(Player.BANK_NOTE_WITHDRAWAL_ATTRIBUTE) === true;
    }

    public setInsertMode(insertMode: boolean): void {
        this.setAttribute(Player.BANK_INSERT_MODE_ATTRIBUTE, insertMode);
    }

    public insertModeReturn(): boolean {
        return this.getAttribute(Player.BANK_INSERT_MODE_ATTRIBUTE) === true;
    }

    public setBankQuantityMode(mode: number): void {
        const quantityMode = Number.isFinite(mode) ? Math.trunc(mode) : 0;
        this.setAttribute(Player.BANK_QUANTITY_MODE_ATTRIBUTE, Math.max(0, Math.min(4, quantityMode)));
    }

    public getBankQuantityMode(): number {
        const mode = Number(this.getAttribute(Player.BANK_QUANTITY_MODE_ATTRIBUTE) ?? 0);
        return Number.isFinite(mode) ? Math.max(0, Math.min(4, Math.trunc(mode))) : 0;
    }

    public setBankCustomQuantity(amount: number): void {
        const quantity = Number.isFinite(amount) ? Math.trunc(amount) : 0;
        this.setAttribute(Player.BANK_CUSTOM_QUANTITY_ATTRIBUTE, Math.max(0, quantity));
    }

    public getBankCustomQuantity(): number {
        const quantity = Number(this.getAttribute(Player.BANK_CUSTOM_QUANTITY_ATTRIBUTE) ?? 0);
        return Number.isFinite(quantity) ? Math.max(0, Math.trunc(quantity)) : 0;
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

    public getTrading(): Trading {
        return this.trading;
    }

    public getSailing(): SailingState {
        return this.sailing;
    }

    public setSailing(sailing: SailingState): void {
        this.sailing = sailing;
    }

    public getQuickPrayers(): QuickPrayers {
        return this.quickPrayers;
    }

    public isPlayerBot(): boolean {
        return this.playerBot;
    }

    public setPlayerBot(playerBot: boolean): void {
        this.playerBot = playerBot;
    }

    public getSpecialAttackRestore(): SecondsTimer {
        return this.specialAttackRestore;
    }

    public getSkullType(): SkullType {
        return this.skullType;
    }

    public getSkullIconId(): number {
        return this.skullIconOverride ?? this.skullType.getIconId();
    }

    public setSkullIconOverride(iconId: number | null, always = false): void {
        const normalizedIconId = Number.isInteger(iconId) && iconId >= 0 ? iconId : null;
        const normalizedAlways = normalizedIconId !== null && always;
        if (this.skullIconOverride === normalizedIconId && this.skullIconOverrideAlways === normalizedAlways) {
            return;
        }

        this.skullIconOverride = normalizedIconId;
        this.skullIconOverrideAlways = normalizedAlways;
        this.getUpdateFlag().flag(Flag.APPEARANCE);
    }

    /** The skull drawn over the player's head, or -1 for none. */
    public getHeadSkullIcon(): number {
        if (this.skullIconOverrideAlways) {
            return this.skullIconOverride;
        }
        return this.isSkulled() ? this.getSkullIconId() : -1;
    }

    public setSkullType(skullType: SkullType) {
        this.skullType = skullType;
    }

    public getDueling(): Dueling {
        return this.dueling;
    }

    public getAggressionTolerance(): AggressionTolerance {
        return this.aggressionTolerance;
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

    public getDonatorRights(): DonatorRights {
        return this.donatorRights;
    }

    public setDonatorRights(donatorPrivilege: typeof DonatorRights.NONE): void {
        this.donatorRights = donatorPrivilege;
    }

    public isPlaceholders(): boolean {
        return this.getAttribute(Player.BANK_PLACEHOLDERS_ATTRIBUTE) === true;
    }

    public setPlaceholders(placeholders: boolean): void {
        this.setAttribute(Player.BANK_PLACEHOLDERS_ATTRIBUTE, placeholders);
    }

    public manipulateHit(hit: PendingHit): PendingHit {
        return PluginManager.emitPlayerHitModify(this, hit);
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
