import type { CustomItemDefinition, RegisteredCustomItem } from "./CustomItemTypes";
import { GearVisualRegistry } from "./GearVisualRegistry";

/**
 * Central registry for custom items.
 * Singleton that stores all registered custom item definitions.
 */
class CustomItemRegistryImpl {
    private readonly items = new Map<number, RegisteredCustomItem>();
    revision = 0;

    // ID range for custom items (outside cache range)
    private static readonly CUSTOM_ID_START = 50000;
    private nextCustomId = CustomItemRegistryImpl.CUSTOM_ID_START;

    /**
     * Register a custom item definition.
     * @param definition The custom item definition
     * @param module Optional module name for debugging
     */
    register(definition: CustomItemDefinition, module?: string): void {
        if (!Number.isInteger(definition.id) || definition.id < 50000 || definition.id > 65022 ||
            !definition.objType || typeof definition.objType.name !== "string") {
            throw new Error("Invalid custom item definition");
        }
        const retained = definition.retainWornModelForAnimations;
        if (retained !== undefined && (!Array.isArray(retained) || retained.length > 1024 ||
            retained.some(id => !Number.isInteger(id) || id < 0 || id > 65534))) {
            throw new Error("Invalid custom item animation policy");
        }
        GearVisualRegistry.register(definition.id,definition.visuals);
        if (this.items.has(definition.id)) {
            console.warn(
                `[CustomItemRegistry] Overwriting existing custom item ${definition.id} (${definition.objType.name})`,
            );
        }

        const registered: RegisteredCustomItem = {
            definition,
            registeredAt: Date.now(),
            module,
        };

        this.items.set(definition.id, registered);
        this.revision++;
    }

    /**
     * Allocate the next available custom item ID.
     */
    allocateId(): number {
        return this.nextCustomId++;
    }

    /** A complete dataset either installs together or leaves the previous world intact. */
    replaceAll(definitions:CustomItemDefinition[]):void {
        if(!Array.isArray(definitions)||new Set(definitions.map(row=>row?.id)).size!==definitions.length)throw new Error('Invalid custom item dataset');
        for(const definition of definitions){
            if(!definition||!Number.isInteger(definition.id)||definition.id<50000||definition.id>65022||typeof definition.objType?.name!=='string')throw new Error('Invalid custom item definition');
            const retained=definition.retainWornModelForAnimations;
            if(retained!==undefined&&(!Array.isArray(retained)||retained.length>1024||retained.some(id=>!Number.isInteger(id)||id<0||id>65534)))throw new Error('Invalid custom item animation policy');
        }
        GearVisualRegistry.validateBatch(definitions);
        this.clear();
        for(const definition of definitions)this.register(definition,definition.objType.name);
    }

    /**
     * Check if an ID has a custom item.
     */
    has(id: number): boolean {
        return this.items.has(id);
    }

    /**
     * Get a custom item definition by ID.
     */
    get(id: number): RegisteredCustomItem | undefined {
        return this.items.get(id);
    }

    /**
     * Get all registered custom items.
     */
    getAll(): IterableIterator<RegisteredCustomItem> {
        return this.items.values();
    }

    /**
     * Get all registered item IDs.
     */
    getAllIds(): IterableIterator<number> {
        return this.items.keys();
    }

    /**
     * Get total count of custom items.
     */
    getCount(): number {
        return this.items.size;
    }

    /**
     * Get the highest custom item ID in use.
     */
    getMaxCustomId(): number {
        let max = 0;
        for (const id of this.items.keys()) {
            if (id > max) max = id;
        }
        return max;
    }

    /**
     * Clear all registrations (for hot reload).
     */
    clear(): void {
        GearVisualRegistry.clear();
        this.items.clear();
        this.revision++;
        this.nextCustomId = CustomItemRegistryImpl.CUSTOM_ID_START;
    }
}

/**
 * Global custom item registry singleton.
 */
export const CustomItemRegistry = new CustomItemRegistryImpl();
