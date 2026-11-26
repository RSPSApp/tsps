/**
 * The extra option data OSRS stores beside an entity's five options (locs, NPCs and ground
 * items share it): sub-options shown in a nested menu, and names that replace an option's
 * base name while a varp or varbit lies in a range.
 */
export type ConditionalOpName = {
    varpId: number;
    /** 65535 when the condition reads the varp directly. */
    varbitId: number;
    min: number;
    max: number;
    name: string;
};

export type EntitySubOp = {
    name?: string;
    conditional?: ConditionalOpName[];
};

export type OpVarReader = {
    getVarp(id: number): number;
    getVarbit(id: number): number;
};

const NO_VARBIT = 65535;

function firstMatch(conditional: ConditionalOpName[] | undefined, vars: OpVarReader | undefined): string | undefined {
    if (!conditional || !vars) return undefined;
    for (const condition of conditional) {
        const value = condition.varbitId !== NO_VARBIT ? vars.getVarbit(condition.varbitId) : vars.getVarp(condition.varpId);
        if (value >= condition.min && value <= condition.max) return condition.name;
    }
    return undefined;
}

export class EntityOps {
    /** op index -> conditional names, first match wins. */
    private conditional = new Map<number, ConditionalOpName[]>();
    /** op index -> sub-op index -> sub-op. */
    private subOps = new Map<number, Map<number, EntitySubOp>>();

    get isEmpty(): boolean {
        return this.conditional.size === 0 && this.subOps.size === 0;
    }

    addConditionalOp(op: number, condition: ConditionalOpName): void {
        const list = this.conditional.get(op);
        if (list) list.push(condition);
        else this.conditional.set(op, [condition]);
    }

    addSubOp(op: number, subOp: number, name: string): void {
        this.subOp(op, subOp).name = name;
    }

    addConditionalSubOp(op: number, subOp: number, condition: ConditionalOpName): void {
        const entry = this.subOp(op, subOp);
        (entry.conditional ??= []).push(condition);
    }

    private subOp(op: number, subOp: number): EntitySubOp {
        let subs = this.subOps.get(op);
        if (!subs) this.subOps.set(op, (subs = new Map()));
        let entry = subs.get(subOp);
        if (!entry) subs.set(subOp, (entry = {}));
        return entry;
    }

    /** The option's name as the menu shows it: a matching conditional name, else the base name. */
    opName(op: number, baseName: string | null | undefined, vars?: OpVarReader): string | null | undefined {
        // A condition only renames an option the entity has.
        if (baseName == null) return baseName;
        return firstMatch(this.conditional.get(op), vars) ?? baseName;
    }

    /** The option's sub-options in menu order (lowest index on top), with their names resolved. */
    subOpNames(op: number, vars?: OpVarReader): { subOp: number; name: string }[] {
        const subs = this.subOps.get(op);
        if (!subs) return [];
        const result: { subOp: number; name: string }[] = [];
        for (const subOp of [...subs.keys()].sort((a, b) => a - b)) {
            const entry = subs.get(subOp)!;
            const name = firstMatch(entry.conditional, vars) ?? entry.name;
            if (name) result.push({ subOp, name });
        }
        return result;
    }
}
