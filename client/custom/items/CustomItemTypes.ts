export type EquipmentType = string;
export type WeaponInterface = string;
export type ItemBonuses = number[];
export type ItemRequirements = number[];
import { ObjStackability } from "../../rs/config/objtype/ObjStackability";

/**
 * Cache-level properties (ObjType) for custom items.
 * These affect client-side rendering, menus, and appearance.
 */
export interface CustomObjTypeProps {
    // Core identification
    name: string;
    examine?: string;
    wearPos?: number;
    wearPos2?: number;
    wearPos3?: number;
    note?: number;
    noteTemplate?: number;
    unnotedId?: number;
    notedId?: number;
    placeholder?: number;
    placeholderTemplate?: number;

    // Inventory model & rendering
    model?: number;
    zoom2d?: number;
    xan2d?: number;
    yan2d?: number;
    zan2d?: number;
    offsetX2d?: number;
    offsetY2d?: number;

    // Equipment models (for wearables)
    maleModel?: number;
    maleModel1?: number;
    maleModel2?: number;
    femaleModel?: number;
    femaleModel1?: number;
    femaleModel2?: number;
    maleHeadModel?: number;
    maleHeadModel2?: number;
    femaleHeadModel?: number;
    femaleHeadModel2?: number;

    // Wear offsets
    manwearXOff?: number;
    manwearYOff?: number;
    manwearZOff?: number;
    womanwearXOff?: number;
    womanwearYOff?: number;
    womanwearZOff?: number;

    // Scale
    resizeX?: number;
    resizeY?: number;
    resizeZ?: number;

    // Recoloring/retexturing
    recolorFrom?: number[];
    recolorTo?: number[];
    retextureFrom?: number[];
    retextureTo?: number[];

    // Lighting
    ambient?: number;
    contrast?: number;

    // Actions
    groundActions?: (string | null)[];
    inventoryActions?: (string | null)[];
    shiftClickIndex?: number;

    // Stacking & trading
    stackability?: ObjStackability;
    isTradable?: boolean;
    isMembers?: boolean;

    // Economy
    price?: number;
    weight?: number;

    // Team cape
    team?: number;
}

/**
 * Server-level properties (ItemDefinition) for custom items.
 * These affect server-side game logic like combat, equipment, and trading.
 */
export interface CustomItemDefProps {
    // Equipment
    equipmentType?: EquipmentType;
    weaponInterface?: WeaponInterface;
    doubleHanded?: boolean;

    // Trading/dropping
    stackable?: boolean;
    tradeable?: boolean;
    dropable?: boolean;
    sellable?: boolean;

    // Economy
    value?: number;
    highAlch?: number;
    lowAlch?: number;
    dropValue?: number;
    bloodMoneyValue?: number;

    // Animations
    blockAnim?: number;
    standAnim?: number;
    walkAnim?: number;
    runAnim?: number;
    standTurnAnim?: number;
    turn180Anim?: number;
    turn90CWAnim?: number;
    turn90CCWAnim?: number;

    // Combat stats
    bonuses?: ItemBonuses;
    requirements?: ItemRequirements;
    /** Combat level needed to wear this; combat has no skill index of its own. */
    combatRequirement?: number;
}

/**
 * Complete custom item definition combining cache and server properties.
 */
export interface CustomItemDefinition {
    /** Unique item ID - should be 50000+ for new items */
    id: number;

    /** If specified, copy all properties from this cache item first */
    baseItemId?: number;

    /** Cache-level properties (affects client rendering/menus) */
    objType: CustomObjTypeProps;

    /** Server-level properties (affects combat/equipment/trading) */
    itemDef?: CustomItemDefProps;
}

/**
 * Registered custom item with metadata.
 */
export interface RegisteredCustomItem {
    definition: CustomItemDefinition;
    registeredAt: number;
    module?: string;
}
