type Style = { color: number; width: number; alpha: number };
type Target = number | string;
type Slot = { style?: Style; targets: Map<Target, Set<number>> };

export class ModelHighlightSlots {
    private readonly slots = new Map<number, Slot>();
    revision = 0;

    private getSlot(slot: number): Slot {
        let entry = this.slots.get(slot);
        if (!entry) {
            entry = { targets: new Map() };
            this.slots.set(slot, entry);
        }
        return entry;
    }

    configure(slot: number, color: number, width: number, alphaPercent: number, flags: number): void {
        this.getSlot(slot).style = color >= 0 && flags !== 0
            ? { color: color & 0xffffff, width, alpha: Math.max(0, Math.min(100, alphaPercent)) / 100 }
            : undefined;
        this.revision++;
    }

    set(slot: number, key: Target, group: number, enabled: boolean): void {
        const targets = this.getSlot(slot).targets;
        const groups = targets.get(key);
        if (enabled) {
            if (groups?.has(group)) return;
            if (groups) groups.add(group);
            else targets.set(key, new Set([group]));
        } else {
            if (!groups?.delete(group)) return;
            if (!groups.size) targets.delete(key);
        }
        this.revision++;
    }

    has(slot: number, key: Target, group: number): boolean {
        return this.slots.get(slot)?.targets.get(key)?.has(group) ?? false;
    }

    clear(slot: number): void {
        this.slots.get(slot)?.targets.clear();
        this.revision++;
    }

    reset(): void {
        this.slots.clear();
        this.revision++;
    }

    get active(): boolean {
        for (const { style, targets } of this.slots.values()) {
            if (style && targets.size) return true;
        }
        return false;
    }

    styleFor(key: Target): Style | undefined {
        for (const { style, targets } of this.slots.values()) {
            if (style && targets.has(key)) return style;
        }
        return undefined;
    }
}

export function locHighlightKey(id: number, coord: number): string {
    return `${id}:${coord}`;
}

export class ModelHighlightManager {
    readonly loc = new ModelHighlightSlots();
    readonly locType = new ModelHighlightSlots();
    readonly npcType = new ModelHighlightSlots();

    reset(): void {
        this.loc.reset();
        this.locType.reset();
        this.npcType.reset();
    }
}
