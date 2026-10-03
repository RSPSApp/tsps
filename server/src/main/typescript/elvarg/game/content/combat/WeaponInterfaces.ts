import { FightType } from "./FightType";
import { loadCombatStyleDefinitions } from "./CombatStyleDefinitions";

class WeaponInterfacesClass {

    private constructor(
        private readonly interfaceId: number,
        private readonly nameLineId: number,
        private readonly speed: number,
        private readonly fightType: FightType[],
        private readonly specialBar: number,
        private readonly specialMeter: number,
        private readonly category: number,
    ) {}

    static {
        for (const [key, definition] of Object.entries(
            loadCombatStyleDefinitions().weaponInterfaces,
        )) {
            const fightTypes = definition.fightTypes.map((name) => {
                const fightType = (FightType as any)[name] as FightType | undefined;
                if (!fightType) {
                    throw new Error(`Unknown fight type "${name}" for weapon interface ${key}`);
                }
                return fightType;
            });
            const weapon = new WeaponInterfacesClass(
                definition.interfaceId,
                definition.nameLineId,
                definition.speed,
                fightTypes,
                definition.specialBar ?? -1,
                definition.specialMeter ?? -1,
                definition.category,
            );
            (WeaponInterfacesClass as any)[key] = weapon;
        }
    }

    public getInterfaceId(): number {
        return this.interfaceId;
    }

    public getNameLineId(): number {
        return this.nameLineId;
    }

    public getSpeed(): number {
        return this.speed;
    }

    public getFightType(): FightType[] {
        return this.fightType;
    }

    public getCategory(): number {
        return this.category;
    }

    public getSpecialBar(): number {
        return this.specialBar;
    }

    public getSpecialMeter(): number {
        return this.specialMeter;
    }
}

/**
 * Every weapon interface in data/definitions/item-combat-styles.json is a
 * property of this registry using its JSON key: WeaponInterfaces.UNARMED,
 * WeaponInterfaces.STAFF, WeaponInterfaces.CROSSBOW, ... Refresh the data with
 * `yarn dump:item-combat-styles`. The index signature types those lookups without
 * listing each interface; a renamed or removed interface resolves to undefined
 * at runtime.
 */
export const WeaponInterfaces: typeof WeaponInterfacesClass & Record<string, WeaponInterfacesClass> =
    WeaponInterfacesClass as typeof WeaponInterfacesClass & Record<string, WeaponInterfacesClass>;

export type WeaponInterfaces = WeaponInterfacesClass;
