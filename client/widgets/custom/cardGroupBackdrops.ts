import type { CardPlacement, CardRow } from './cardLayout';
import { markWidgetInteractionDirty } from '../WidgetInteraction';

/** Native decoration pools declared by any tree of cards, below its row component ranges. */
export type CardGroupBackdropStyle = {
    backgroundStart: number;
    borderStart: number;
    slotCount: number;
    padding?: number;
    backgroundColors?: number[];
    borderColors?: number[];
};
export type CardGroupBackdrop = { id: number; depth: number; x: number; y: number; width: number; height: number };

/** Visible ancestors, outermost first. Ignore invalid ancestry rather than framing unrelated rows. */
export function cardGroupPaths(rows: CardRow[]): number[][] {
    const byId = new Map(rows.map(row => [row.id, row]));
    return rows.map(row => {
        const path: number[] = [], seen = new Set([row.id]);
        let parentId = row.parentId;
        while (parentId !== undefined) {
            const parent = byId.get(parentId);
            if (!parent?.expandable || parent.header || seen.has(parentId) || path.length >= 12) return [];
            seen.add(parentId);
            path.unshift(parentId);
            parentId = parent.parentId;
        }
        return path;
    });
}

/** Build once after filtering/layout, using the whole visible tree, never just the row pool. */
export function layoutCardGroupBackdrops(rows: CardRow[], placements: CardPlacement[], width: number,
    padding: number, paths = cardGroupPaths(rows)): CardGroupBackdrop[] {
    const groups = new Map<number, CardGroupBackdrop>();
    for (let index = 0; index < rows.length; index++) {
        const placement = placements[index];
        if (!placement) continue;
        for (const id of paths[index]) {
            const group = groups.get(id);
            if (group) group.height = Math.max(group.height, placement.y + placement.height - group.y);
        }
        if (rows[index].expandable && !rows[index].header) {
            const x = Math.max(0, placement.x - padding), y = Math.max(0, placement.y - padding);
            groups.set(rows[index].id, { id: rows[index].id, depth: paths[index].length,
                x, y, width: Math.max(1, width - x), height: placement.y + placement.height - y });
        }
    }
    const expanded = new Set(paths.flat());
    // Include nested padding in the outer frame, including when the final child is a folder.
    const result = [...groups.values()].filter(group => expanded.has(group.id));
    for (const group of [...result].reverse()) {
        group.height += padding;
        const path = paths[rows.findIndex(row => row.id === group.id)];
        const parent = groups.get(path[path.length - 1]);
        if (parent) parent.height = Math.max(parent.height, group.y + group.height - parent.y);
    }
    return result.sort((a, b) => a.depth - b.depth || a.y - b.y);
}

/** Reuse only intersecting native rectangles, including frames whose parent card is offscreen. */
export class CardGroupBackdropPool {
    private previous?: { spans: CardGroupBackdrop[]; style: CardGroupBackdropStyle; scrollY: number; height: number };

    reset(): void { this.previous = undefined; }

    sync(spans: CardGroupBackdrop[], style: CardGroupBackdropStyle, scrollY: number, height: number,
        widgetAt: (component: number) => any, invalidate: (widget: any) => void): void {
        const previous = this.previous;
        if (previous?.spans === spans && previous.style === style && previous.scrollY === scrollY && previous.height === height) return;
        this.previous = { spans, style, scrollY, height };
        const visible = height > 0 ? spans.filter(span => span.y < scrollY + height && span.y + span.height > scrollY) : [];
        for (let slot = 0; slot < style.slotCount; slot++) {
            const span = visible[slot];
            for (const [start, colors] of [[style.backgroundStart, style.backgroundColors], [style.borderStart, style.borderColors]] as const) {
                const widget = widgetAt(start + slot);
                if (!widget) continue;
                const values: Record<string, number | boolean> = { hidden: !span, isHidden: !span };
                if (span) {
                    Object.assign(values, { rawX: span.x, rawY: span.y, rawWidth: span.width, rawHeight: span.height,
                        widthMode: 0, heightMode: 0, xPositionMode: 0, yPositionMode: 0 });
                    if (colors?.length) values.color = colors[span.depth % colors.length];
                }
                if (Object.entries(values).every(([key, value]) => widget[key] === value)) continue;
                Object.assign(widget, values);
                markWidgetInteractionDirty(widget);
                invalidate(widget);
            }
        }
    }
}
