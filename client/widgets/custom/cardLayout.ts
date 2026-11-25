import { cardGroupPaths, layoutCardGroupBackdrops, type CardGroupBackdrop, type CardGroupBackdropStyle } from './cardGroupBackdrops';

export type CardStyle = { minWidth: number; maxColumns: number; gap: number; height: number; groups?: boolean;
    groupBackdrops?: CardGroupBackdropStyle };
export type CardPlacement = { x: number; y: number; width: number; height: number; card: boolean };
export type CardRow = { id: number; parentId?: number; header?: boolean; expandable?: boolean };

/** Pack sibling tiles together. Sections remain bands; an expanded group's children start a new row. */
export function layoutCards(rows: CardRow[], width: number, style: CardStyle, headerHeight: number,
    groupHeight: number, indentStep: number, maxIndent: number): { placements: CardPlacement[]; height: number; backdrops: CardGroupBackdrop[] } {
    const placements: CardPlacement[] = [];
    const paths = cardGroupPaths(rows), expanded = new Set(paths.flat());
    const padding = style.groupBackdrops ? Math.max(0, Math.min(16, style.groupBackdrops.padding ?? 4) | 0) : 0;
    const gap = Math.max(0, style.gap | 0), height = Math.max(1, style.height | 0);
    width = Math.max(1, width | 0);
    let y = 0, column = 0, parent: number | undefined;
    const open: number[] = [];
    function flush(): void {
        if (!column) return;
        y += height + gap;
        column = 0;
    }
    for (let index = 0; index < rows.length; index++) {
        const row = rows[index], path = paths[index];
        if (style.groupBackdrops) {
            let common = 0;
            while (common < open.length && open[common] === path[common]) common++;
            if (common < open.length) flush();
            while (open.length > common) { open.pop(); y += padding; }
            if (expanded.has(row.id)) { flush(); y += padding; }
        }
        const inset = style.groupBackdrops && (path.length || expanded.has(row.id)) ? padding : 0;
        const indent = row.header ? 0 : Math.min(Math.max(0, path.length * indentStep), Math.max(0, maxIndent), width - 1);
        const x = Math.min(indent + inset, width - 1);
        const available = Math.max(1, width - x - inset);
        if (row.header || (row.expandable && !style.groups)) {
            flush();
            const bandHeight = Math.max(1, row.header ? headerHeight : groupHeight);
            placements.push({ x, y, width: available, height: bandHeight, card: false });
            y += bandHeight + gap;
            if (style.groupBackdrops && expanded.has(row.id)) open.push(row.id);
            continue;
        }
        if (parent !== row.parentId) flush();
        parent = row.parentId;
        const columns = Math.max(1, Math.min(style.maxColumns | 0,
            Math.floor((available + gap) / (Math.max(1, style.minWidth) + gap))));
        if (column >= columns) flush();
        const cardWidth = Math.floor((available - (columns - 1) * gap) / columns);
        placements.push({ x: x + column * (cardWidth + gap), y, width: cardWidth, height, card: true });
        column++;
        if (style.groupBackdrops && expanded.has(row.id)) open.push(row.id);
    }
    flush();
    y += open.length * padding;
    return { placements, height: Math.max(0, y - gap),
        backdrops: style.groupBackdrops ? layoutCardGroupBackdrops(rows, placements, width, padding, paths) : [] };
}
