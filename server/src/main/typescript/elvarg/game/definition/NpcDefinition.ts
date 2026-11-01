import { CacheDefinitions } from "../cache/CacheDefinitions";
import { CombatType } from "../content/combat/CombatType";
import { Misc } from "../../util/Misc";

export class NpcDefinition {
    static definitions: Map<number, NpcDefinition> = new Map<number, NpcDefinition>();
    /**
     * Slot layout, populated by NpcDefinitionLoader from monsters-complete.json:
     *   0-4   combat levels: attack, strength, defence, ranged, magic
     *   5,7,9 accuracy bonuses: melee, magic, ranged
     *   10-14 defence bonuses, in BonusManager.DEFENCE_* order
     *         (stab, slash, crush, magic, ranged)
     * Slots 6, 8 and 15-17 are unused - damage comes from maxHit directly.
     */
    private static DEFAULT_STATS: number[] = [1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    private static DEFAULT: NpcDefinition = new NpcDefinition();
    
    private id: number = -1;
    private name: string = "null";
    private examine: string = "";
    private size: number = 1;
    private walkRadius: number = 0;
    private attackable: boolean = false;
    private retreats: boolean = false;
    private aggressive: boolean = false;
    private aggressiveTolerance: boolean = true;
    private poisonous: boolean = false;
    private venomous: boolean = false;
    private immunePoison: boolean = false;
    private immuneVenom: boolean = false;
    private demon: boolean = false;
    /** The Wiki's monster attributes: undead, demon, dragon, kalphite, ... */
    private attributes: readonly string[] = [];
    /** Wiki "members" flag from monsters-complete.json; false for NPCs not in the dump. */
    private members: boolean = false;
    /** Which default CombatMethod this NPC fights with; see NPC.getCombatMethod(). */
    private attackType: CombatType = CombatType.MELEE;
    /** Projectile graphic for ranged/magic attacks; -1 falls back to the generic one. */
    private projectileId: number = -1;
    private fightsBack: boolean = true;
    private respawn: number = 25;
    private maxHit: number = 1;
    private hitpoints: number = 10;
    private attackSpeed: number = 4;
    private attackAnim: number = 422;
    private defenceAnim: number = 424;
    private deathAnim: number = 836;
    private spawnAnim: number | null = null;
    private deathSound: number = -1;
    /** Ticks from the death animation to the death itself (drops, removal). */
    private deathTicks: number = 2;
    private combatLevel: number = 0;
    private stats: number[] = [...NpcDefinition.DEFAULT_STATS];
    private rangedDefenceBonuses: Partial<Record<"light" | "heavy", number>> = {};
    private elementalWeaknessType = 0;
    private elementalWeaknessPercent = 0;

    public getElementalWeakness(): { type: number; percent: number } | null {
        return this.elementalWeaknessType >= 1 && this.elementalWeaknessType <= 4 && this.elementalWeaknessPercent > 0
            ? { type: this.elementalWeaknessType, percent: this.elementalWeaknessPercent } : null;
    }

    public getRangedDefenceBonus(type: "light" | "standard" | "heavy"): number {
        return (type === "standard" ? undefined : this.rangedDefenceBonuses[type]) ?? this.stats[14] ?? 0;
    }
    private slayerLevel: number = 0;
    /** Retreat/leash max range; the Wiki's "almost always seven tiles". */
    private combatFollowDistance: number = 7;
    /** Where an aggressive NPC searches for a target, from its current south-west tile. */
    private huntRange: number = 7;
    private actions: string[] = [];
    private cacheHydrated: boolean = false;
    
    public static invalidateCache(id: number): void {
        this.definitions.delete(id);
    }

    public static forId(id: number): NpcDefinition {
        if (!Number.isInteger(id) || id < 0 || id >= CacheDefinitions.getCounts().npcs) {
            return this.definitions.get(id) || this.DEFAULT;
        }
        let definition = this.definitions.get(id);
        if (!definition) {
            definition = new NpcDefinition();
            this.definitions.set(id, definition);
        }
        definition.hydrateFromCache(id);
        return definition;
    }

    private hydrateFromCache(id: number): void {
        if (this.cacheHydrated) return;
        const cached = CacheDefinitions.getNpc(id);
        this.id = id;
        this.name = cached.name;
        this.examine = cached.desc ?? this.examine;
        this.size = cached.size;
        this.attackable = cached.actions.some((action) => action?.toLowerCase() === "attack");
        this.actions = [...cached.actions];
        if (cached.combatLevel >= 0) this.combatLevel = cached.combatLevel;
        if (cached.hitpoints > 0) this.hitpoints = cached.hitpoints;
        const stats = this.stats ? [...this.stats] : [...NpcDefinition.DEFAULT_STATS];
        for (const [index, value] of [
            [0, cached.attackLevel],
            [1, cached.strengthLevel],
            [2, cached.defenceLevel],
            [3, cached.rangedLevel],
            [4, cached.magicLevel],
        ]) {
            if (value >= 0) stats[index] = value;
        }
        this.stats = stats;
        this.cacheHydrated = true;
    }
    
    public getId(): number {
        return this.id;
    }
    
    public getName(): string {
        return this.name;
    }
    
    /**
     * OSRS keeps NPC examine text server-side, so the cache carries none of it -
     * the real text comes from monsters-complete.json via NpcDefinitionLoader.
     * Everything the dump does not cover gets a generic line rather than the
     * bare name the examine packet used to echo back.
     */
    public getExamine(): string {
        if (this.examine) return this.examine;
        if (!this.name || this.name === "null") return "It's nothing special.";
        return `It's ${Misc.anOrA(this.name)} ${this.name}.`;
    }
    
    public getSize(): number {
        return this.size;
    }
    
    public getWalkRadius(): number {
        return this.walkRadius;
    }
    
    public isAttackable(): boolean {
        return this.attackable || (this.actions ?? []).some((action) => NpcDefinition.isCombatOption(action));
    }

    /** Menu options that start a fight, as "Attack" does: ones plugins add, such as the Nightmare's totems' "Charge". */
    private static combatOptions = new Set<string>(["attack"]);

    public static addCombatOption(option: string): void {
        if (option) NpcDefinition.combatOptions.add(option.toLowerCase());
    }

    public static isCombatOption(option: string | null | undefined): boolean {
        return option != null && NpcDefinition.combatOptions.has(option.toLowerCase());
    }

    public getActions(): string[] {
        return this.actions;
    }
    
    public doesRetreat(): boolean {
        return this.retreats;
    }
    
    public isAggressive(): boolean {
        return this.aggressive;
    }

    public buildsAggressionTolerance(): boolean {
        return this.aggressiveTolerance;
    }
        
    public isPoisonous(): boolean {
        return this.poisonous;
    }
    
    public doesFightBack(): boolean {
        return this.fightsBack;
    }
    
    public getRespawn(): number {
        return this.respawn;
    }

    public setRespawn(respawn: number): void {
        this.respawn = Math.max(0, Math.trunc(respawn));
    }
    
    public getMaxHit(): number {
        return this.maxHit;
    }
    
    public getHitpoints(): number {
        return this.hitpoints;
    }

    public setMaxHitpoints(hitpoints: number):void {
        this.hitpoints = hitpoints;
    }
    
    public getAttackSpeed(): number {
        return this.attackSpeed;
    }
    
    public getAttackAnim(): number {
        return this.attackAnim;
    }
    
    public getDefenceAnim(): number {
        return this.defenceAnim;
    }
    
    public getDeathAnim(): number {
        return this.deathAnim;
    }

    public getSpawnAnim(): number | null {
        return this.spawnAnim;
    }

    public getDeathSound(): number {
        return this.deathSound;
    }

    public getDeathTicks(): number {
        return this.deathTicks;
    }

    public getCombatLevel(): number {
        return this.combatLevel;
    }
    
    public getStats(): number[] {
        if (!this.stats) {
            return NpcDefinition.DEFAULT_STATS;
        }
    
        return this.stats;
    }
    
    public isVenomous(): boolean {
        return this.venomous;
    }

    public isPoisonImmune(): boolean {
        return this.immunePoison;
    }

    public isVenomImmune(): boolean {
        return this.immuneVenom;
    }

    public isDemon(): boolean {
        return this.demon;
    }

    public isUndead(): boolean {
        return this.hasAttribute("undead");
    }

    public getAttributes(): readonly string[] {
        return this.attributes;
    }

    public hasAttribute(attribute: string): boolean {
        return this.attributes.includes(attribute);
    }

    public isMembers(): boolean {
        return this.members;
    }

    public getAttackType(): CombatType {
        return this.attackType;
    }

    public getProjectileId(): number {
        return this.projectileId;
    }

    public getSlayerLevel(): number {
        return this.slayerLevel;
    }
    
    public getCombatFollowDistance(): number {
        return this.combatFollowDistance;
    }

    public getHuntRange(): number {
        return this.huntRange;
    }

    public setHuntRange(range: number): void {
        this.huntRange = Math.max(1, Math.trunc(range));
    }
}
