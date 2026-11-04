import { ORBS, ORBS_NOMAP } from "@runelite/api/gameval/InterfaceID";
import type { OsrsClient } from "../OsrsClient";

/** A drawn widget's device rect on the UI canvas, and the device pixels per layout unit. */
export type WidgetBounds = { x: number; y: number; w: number; h: number; scaleX: number; scaleY: number };

/** InterfaceID.Orbs / InterfaceID.OrbsNomap components the orb plugins use, as child ids. */
export const OrbComponent = {
    ORB_HEALTH: { orbs: 7, nomap: 5 },
    RUNBUTTON: { orbs: 28, nomap: 26 },
    RUNENERGY_TEXT: { orbs: 29, nomap: 27 },
    ORB_SPECENERGY: { orbs: 34, nomap: 32 },
} as const;

export type OrbComponentId = (typeof OrbComponent)[keyof typeof OrbComponent];

/**
 * The widget's bounds, as RuneLite's overlays find an orb: the minimap orbs' component, else the
 * one of the orbs shown without the minimap; undefined while neither is drawn.
 */
export function widgetBounds(client: OsrsClient, uid: number): WidgetBounds | undefined {
    const manager = client.widgetManager;
    const widget: any = manager?.getWidgetByUid(uid);
    if (!widget || manager.isEffectivelyHidden(uid) || !(widget._absWidth > 0) || !(widget._absHeight > 0)) return undefined;
    return {
        x: widget._absX,
        y: widget._absY,
        w: widget._absWidth,
        h: widget._absHeight,
        scaleX: widget._absWidth / Math.max(1, widget.width),
        scaleY: widget._absHeight / Math.max(1, widget.height),
    };
}

export function orbBounds(client: OsrsClient, component: OrbComponentId): WidgetBounds | undefined {
    return widgetBounds(client, (ORBS << 16) | component.orbs) ?? widgetBounds(client, (ORBS_NOMAP << 16) | component.nomap);
}

/** The orb's widget, for setting its text (Run Energy's orb text). */
export function orbWidgets(client: OsrsClient, component: OrbComponentId): any[] {
    const manager = client.widgetManager;
    if (!manager) return [];
    return [(ORBS << 16) | component.orbs, (ORBS_NOMAP << 16) | component.nomap]
        .map((uid) => manager.getWidgetByUid(uid))
        .filter((widget) => widget);
}
