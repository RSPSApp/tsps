import { WeaponInterfaces } from "../content/combat/WeaponInterfaces";
import { EquipmentType } from "../model/EquipmentType";
import { CacheDefinitions } from "../cache/CacheDefinitions";
import { ObjStackability } from "../cache/codec/rs/config/objtype/ObjStackability";
import { ItemIdentifiers } from "../../util/ItemIdentifiers";

const EQUIPMENT_SLOTS = new Set([0, 1, 2, 3, 4, 5, 7, 9, 10, 12, 13]);

export class ItemDefinition {
    public static definitions: Map<number, ItemDefinition> = new Map<number, ItemDefinition>();
    public static DEFAULT = new ItemDefinition();

    public static registerCustom(id: number, baseId: number, raw: Record<string, unknown> = {}): ItemDefinition {
        const base = baseId >= 0 ? this.forId(baseId) : this.DEFAULT;
        const definition = new ItemDefinition();
        Object.assign(definition, base);
        definition.id = id;
        definition.cacheHydrated = false;
        definition.hydrateFromCache(id);
        definition.bonuses = [...(base.bonuses ?? new Array(14).fill(0))];
        definition.requirements = [...(base.requirements ?? new Array(23).fill(0))];
        for (const key of ["equipmentType", "weaponInterface", "doubleHanded", "stackable",
            "tradeable", "dropable", "sellable", "value", "grandExchangeValue", "highAlch", "lowAlch", "dropValue",
            "bloodMoneyValue", "blockAnim", "standAnim", "walkAnim", "runAnim", "standTurnAnim",
            "turn180Anim", "turn90CWAnim", "turn90CCWAnim", "bonuses", "requirements"]) {
            const value = raw[key];
            if (value !== undefined) {
                (definition as any)[key] = Array.isArray(value) ? [...value] : value;
            }
        }
        this.definitions.set(id, definition);
        return definition;
    }

    private id: number;
    private name: string = "";
    private examine: string = "";
    private weaponInterface: any;
    private equipmentType: EquipmentType = EquipmentType.NONE;
    private doubleHanded: boolean;
    private stackable: boolean;
    private tradeable: boolean;
    private dropable: boolean;
    private sellable: boolean;
    private noted: boolean;
    private value: number;
    private grandExchangeValue: number;
    private bloodMoneyValue: number;
    private highAlch: number;
    private lowAlch: number;
    private dropValue: number;
    private noteId: number = -1;
    private placeholderId: number = -1;
    private blockAnim: number = 424;
    private standAnim: number = 808;
    private walkAnim: number = 819;
    private runAnim: number = 824;
    private standTurnAnim: number = 823;
    private turn180Anim: number = 820;
    private turn90CWAnim: number = 821;
    private turn90CCWAnim: number = 821;
    private weight: number;
    private bonuses: number[];
    private requirements: number[];
    private cacheHydrated: boolean = false;

    public static forId(item: number) {
        if (!Number.isInteger(item) || item < 0 || item >= CacheDefinitions.getCounts().items) {
            return this.definitions.get(item) || this.DEFAULT;
        }
        let definition = this.definitions.get(item);
        if (!definition) {
            definition = new ItemDefinition();
            this.definitions.set(item, definition);
        }
        definition.hydrateFromCache(item);
        return definition;
    }

    private hydrateFromCache(id: number): void {
        if (this.cacheHydrated) return;
        const cached = CacheDefinitions.getItem(id);
        this.id = id;
        this.name = cached.name;
        this.examine = cached.examine ?? this.examine;
        this.stackable = cached.stackability === ObjStackability.ALWAYS;
        this.tradeable = cached.isTradable || id === ItemIdentifiers.COINS;
        this.dropable = cached.inventoryActions[4]?.toLowerCase() === "drop";
        this.noted = cached.noteTemplate !== -1;
        this.noteId = cached.note;
        // Placeholders have their own cache entry; items without one (such as
        // charged variants) leave no placeholder.
        this.placeholderId = cached.placeholderTemplate === -1 ? cached.placeholder : -1;
        this.value = cached.price;
        this.weight = cached.weight;
        if (this.equipmentType.getSlot() === -1 && EQUIPMENT_SLOTS.has(cached.wearPos)) {
            this.equipmentType = new EquipmentType(cached.wearPos);
        }
        this.cacheHydrated = true;
    }

    public getId(): number {
        return this.id;
    }

    public getName(): string {
        return this.name;
    }

    public getExamine(): string {
        return this.examine;
    }

    public getValue(): number {
        return this.value;
    }

    /** OSRS Grand Exchange quote from data/definitions/item-prices.json; falls back to the store value. */
    public getGrandExchangeValue(): number {
        return this.grandExchangeValue > 0 ? this.grandExchangeValue : this.value;
    }

    public getBloodMoneyValue(): number {
        return this.bloodMoneyValue;
    }

    public getHighAlchValue(): number {
        return this.highAlch;
    }

    public getLowAlchValue(): number {
        return this.lowAlch;
    }

    public getDropValue(): number {
        return this.dropValue;
    }

    public isStackable(): boolean {
        return this.stackable;
    }

    public isTradeable(): boolean {
        return this.tradeable;
    }

    public isSellable(): boolean {
        return this.sellable;
    }

    public isDropable(): boolean {
        return this.dropable;
    }

    public isNoted(): boolean {
        return this.noted;
    }

    /** The faded bank placeholder for this item, or -1 if it has none. */
    public getPlaceholderId(): number {
        return this.placeholderId;
    }

    public getNoteId(): number {
        return this.noteId;
    }

    public isDoubleHanded(): boolean {
        return this.doubleHanded;
    }

    public getBlockAnim(): number {
        return this.blockAnim;
    }

    public getStandAnim(): number {
        return this.standAnim;
    }

    public getWalkAnim(): number {
        return this.walkAnim;
    }

    public getRunAnim(): number {
        return this.runAnim;
    }

    public getStandTurnAnim(): number {
        return this.standTurnAnim;
    }

    public getTurn180Anim(): number {
        return this.turn180Anim;
    }

    public getTurn90CWAnim(): number {
        return this.turn90CWAnim;
    }

    public getTurn90CCWAnim(): number {
        return this.turn90CCWAnim;
    }

    public getWeight(): number {
        return this.weight;
    }

    public getBonuses(): number[] {
        return this.bonuses;
    }

    public getRequirements(): number[] {
        return this.requirements;
    }

    public getWeaponInterface(): WeaponInterfaces {
        return this.weaponInterface;
    }

    public getEquipmentType(): EquipmentType {
        return this.equipmentType;
    }

    public unNote(): number {
        return this.noted && this.noteId >= 0 ? this.noteId : this.id;
    }
}
