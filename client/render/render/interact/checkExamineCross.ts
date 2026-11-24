/**
 * Examine only looks: no walk, no interaction highlight. OSRS still shows the red click cross
 * where the entry was chosen, as it does for every other option on an entity.
 */
export function wrapExamineWithClickCross(
    host: { toGLClickXY(evt?: MouseEvent): unknown; spawnClickCross(tile: any, xy: any, color: "red" | "yellow"): void },
    e: { onClick?: unknown },
    tileForMenu?: { tileX: number; tileY: number; plane?: number },
): void {
    const orig = e.onClick;
    e.onClick = (entry?: any, evt?: MouseEvent, ctx?: unknown) => {
        try {
            host.spawnClickCross(tileForMenu as any, host.toGLClickXY(evt), "red");
        } catch {}
        return (orig as any)?.(entry, evt, ctx);
    };
}

