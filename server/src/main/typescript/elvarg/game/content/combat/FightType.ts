import { FightStyle } from './FightStyle';
import { Sound } from '../../Sound';
import {
    CombatStyleAttackType,
    CombatStyleKind,
    loadCombatStyleDefinitions,
} from './CombatStyleDefinitions';

const ATTACK_STAB = 0;
const ATTACK_SLASH = 1;
const ATTACK_CRUSH = 2;
const ATTACK_MAGIC = 3;
const ATTACK_RANGE = 4;
const DEFENCE_STAB = 0;
const DEFENCE_SLASH = 1;
const DEFENCE_CRUSH = 2;
const DEFENCE_MAGIC = 3;
const DEFENCE_RANGE = 4;

/** Every style reports against varp 43 (com_mode). */
const COMBAT_STYLE_PARENT_ID = 43;

const ATTACK_TYPE_BY_NAME: Record<CombatStyleAttackType, number> = {
    STAB: ATTACK_STAB,
    SLASH: ATTACK_SLASH,
    CRUSH: ATTACK_CRUSH,
    MAGIC: ATTACK_MAGIC,
    RANGE: ATTACK_RANGE,
};

const STYLE_BY_NAME: Record<CombatStyleKind, FightStyle> = {
    ACCURATE: FightStyle.ACCURATE,
    AGGRESSIVE: FightStyle.AGGRESSIVE,
    DEFENSIVE: FightStyle.DEFENSIVE,
    CONTROLLED: FightStyle.CONTROLLED,
};

class FightTypeClass {

    private static readonly valuesList: FightTypeClass[] = [];

    private constructor(
        private readonly animation: number,
        private readonly parentId: number,
        private readonly childId: number,
        private readonly bonusType: number,
        private readonly style: FightStyle,
        private readonly attackSound: Sound,
        private readonly rapid: boolean,
    ) {}

    static {
        for (const [key, definition] of Object.entries(loadCombatStyleDefinitions().fightTypes)) {
            const fightType = new FightTypeClass(
                definition.animation,
                COMBAT_STYLE_PARENT_ID,
                definition.childId,
                ATTACK_TYPE_BY_NAME[definition.attackType] ?? ATTACK_CRUSH,
                STYLE_BY_NAME[definition.style] ?? FightStyle.ACCURATE,
                (Sound as any)[definition.sound] ?? Sound.WEAPON,
                definition.rapid === true,
            );
            (FightTypeClass as any)[key] = fightType;
            FightTypeClass.valuesList.push(fightType);
        }
    }

    public static values(): FightTypeClass[] {
        return FightTypeClass.valuesList;
    }

    public static resolve(value: unknown): FightTypeClass | null {
        if (value instanceof FightTypeClass) {
            return value;
        }

        if (!value || typeof value !== "object") {
            return null;
        }

        const raw = value as Record<string, unknown>;
        const animation = FightTypeClass.asFiniteInt(raw.animation);
        const parentId = FightTypeClass.asFiniteInt(raw.parentId);
        const childId = FightTypeClass.asFiniteInt(raw.childId);
        const bonusType = FightTypeClass.asFiniteInt(raw.bonusType);
        if (animation === null && parentId === null && childId === null && bonusType === null) {
            return null;
        }

        const candidates = FightTypeClass.values().filter((fightType) => {
            return (animation === null || fightType.animation === animation)
                && (parentId === null || fightType.parentId === parentId)
                && (childId === null || fightType.childId === childId)
                && (bonusType === null || fightType.bonusType === bonusType);
        });

        if (candidates.length === 0) {
            return null;
        }

        return candidates[0];
    }

    private static asFiniteInt(value: unknown): number | null {
        if (typeof value !== "number" || !Number.isFinite(value)) {
            return null;
        }
        return value | 0;
    }

    public getAnimation(): number {
        return this.animation;
    }

    /**
     * Gets the parent config      *
     * @return the parent      */
    public getParentId(): number {
        return this.parentId;
    }

    /**
     * Gets the child config      *
     * @return the child      */
    public getChildId(): number {
        return this.childId;
    }

    /**
     * Gets the bonus type.
     *
     * @return the bonus type.
     */
    public getBonusType(): number {
        return this.bonusType;

    }
    public getBonusTypes(): number {
        return this.bonusType;

    }

    /**
     * Gets the fighting style.
     *
     * @return the fighting style.
     */
    public getStyle(): FightStyle {
        return this.style;
    }

    public getCorrespondingBonus(): number {
        switch (this.bonusType) {
            case ATTACK_CRUSH:
                return DEFENCE_CRUSH;
            case ATTACK_MAGIC:
                return DEFENCE_MAGIC;
            case ATTACK_RANGE:
                return DEFENCE_RANGE;
            case ATTACK_SLASH:
                return DEFENCE_SLASH;
            case ATTACK_STAB:
                return DEFENCE_STAB;
            default:
                return DEFENCE_CRUSH;
        }
    }

    public getAttackSound(): Sound {
        return this.attackSound;
    }

    public isRapid(): boolean {
        return this.rapid;
    }

}

/**
 * Every fight type in data/definitions/item-combat-styles.json is a property of
 * this registry using its JSON key: FightType.UNARMED_KICK, FightType.STAFF_FOCUS,
 * FightType.SHORTBOW_LONGRANGE, ... Refresh the data with
 * `yarn dump:item-combat-styles`. The index signature types those lookups without
 * listing each style; a renamed or removed style resolves to undefined at runtime.
 */
export const FightType: typeof FightTypeClass & Record<string, FightTypeClass> =
    FightTypeClass as typeof FightTypeClass & Record<string, FightTypeClass>;

export type FightType = FightTypeClass;
