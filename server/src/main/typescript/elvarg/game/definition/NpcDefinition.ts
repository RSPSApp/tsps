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
    private demon: boolean = false;
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
    private combatLevel: number = 0;
    private stats: number[] = [...NpcDefinition.DEFAULT_STATS];
    private slayerLevel: number = 0;
    private combatFollowDistance: number = 7;
    private actions: string[] = [];
    private cacheHydrated: boolean = false;
    
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
        return this.attackable;
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

    public isDemon(): boolean {
        return this.demon;
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
}
