import { ClientState } from "../../../game/ClientState";
import {
    deriveMenuEntriesForWidget as UI_deriveMenuEntriesForWidget,
    deriveRawMenuEntriesForWidget,
    transformWidgetMenuEntries,
} from "../../../widgets/menu/utils";
type WidgetMenuDeriveCacheEntry = {
    revision: number;
    flagsVersion: number;
    flags: number;
    itemId: number;
    targetVerb: string;
    spellActionName: string;
    opBase: string;
    dataText: string;
    name: string;
    text: string;
    actionsKey: string;
    hasOnOpArray: boolean;
    hasOnOpHandler: boolean;
    entries: Array<{ option: string; target?: string }>;
};

type WidgetInteractionSnapshot = {
    revision: number;
    flagsVersion: number;
    hasCs2Click: boolean;
    hasActions: boolean;
    hasActionSlots: boolean;
    hasTargetVerbCandidate: boolean;
    hasOriginalHandlers: boolean;
    isInventoryItem: boolean;
    hasButtonTypeInteraction: boolean;
    isPauseButtonWidget: boolean;
    buttonType: number;
    shouldDeriveEntries: boolean;
};

const widgetMenuDeriveCache = new Map<number, WidgetMenuDeriveCacheEntry>();
const WIDGET_MENU_DERIVE_CACHE_MAX = 8192;

export function getWidgetActionsKey(w: any): string {
    const actions = Array.isArray(w?.actions) ? (w.actions as any[]) : undefined;
    if (!actions || actions.length === 0) return "";
    let out = "";
    for (let i = 0; i < actions.length; i++) {
        if (i > 0) out += "\u0001";
        const a = actions[i];
        out += typeof a === "string" ? a : a == null ? "" : String(a);
    }
    return out;
}

export function getWidgetOnOpHandlerPresence(w: any): { hasOnOpArray: boolean; hasOnOpHandler: boolean } {
    const hasOnOpArray = Array.isArray(w?.onOp) && w.onOp.length > 0;
    const eh = w?.eventHandlers as any;
    let hasOnOpHandler = false;
    if (eh instanceof Map) {
        const mapped = eh.get("onOp");
        hasOnOpHandler = Array.isArray(mapped) ? mapped.length > 0 : !!mapped;
    } else if (eh && typeof eh === "object") {
        const mapped = eh.onOp;
        hasOnOpHandler = Array.isArray(mapped) ? mapped.length > 0 : !!mapped;
    }
    return { hasOnOpArray, hasOnOpHandler };
}

export function shouldProbeWidgetInteractionShallow(w: any): boolean {
    if (!w) return false;

    if (ClientState.isSpellSelected || ClientState.isItemSelected === 1) {
        return true;
    }

    if (
        w.hasListener ||
        w.eventHandlers ||
        w.onClick ||
        w.onOp ||
        w.onHold ||
        w.onRelease ||
        w.onMouseOver ||
        w.onMouseLeave ||
        w.__hasOriginalOnClick ||
        w.__hasOriginalOnOp ||
        w.__hasOriginalOnHold ||
        w.__hasOriginalOnRelease
    ) {
        return true;
    }

    const buttonType = (w.buttonType ?? 0) | 0;
    if (buttonType > 0) return true;

    const actions = w.actions as any[] | undefined;
    if (Array.isArray(actions) && actions.length > 0) return true;

    if (typeof w.itemId === "number" && w.itemId >= 0) return true;
    if (typeof w.targetVerb === "string" && w.targetVerb.length > 0) return true;
    if (typeof w.spellActionName === "string" && w.spellActionName.length > 0) return true;
    if (typeof w.buttonText === "string" && w.buttonText.length > 0) return true;
    if ((((w.flags ?? 0) as number) & 1) !== 0) return true;

    const text = w.text;
    if (
        typeof text === "string" &&
        text.length >= 8 &&
        text.toLowerCase().includes("continue") &&
        text.toLowerCase().includes("click")
    ) {
        return true;
    }

    return false;
}

export function shouldCheckWidgetHoverVisual(w: any, isIf3: boolean): boolean {
    if (!w) return false;
    const type = (w.type ?? 0) | 0;
    if (type === 3) {
        return typeof w.mouseOverColor === "number" || typeof w.mouseOverColor2 === "number";
    }
    if (type === 4 || type === 8) {
        return (
            typeof w.mouseOverColor === "number" ||
            typeof w.mouseOverColor2 === "number" ||
            (isIf3 && typeof w.text2 === "string" && w.text2.length > 0)
        );
    }
    return false;
}

export function getWidgetInteractionSnapshot(
    w: any,
    getWidgetFlags: (w: any) => number,
    flagsVersion: number,
): WidgetInteractionSnapshot {
    const revision = (((w?.__interactionRevision ?? 0) as number) | 0) as number;
    const cached = w?.__interactionSnapshot as WidgetInteractionSnapshot | undefined;
    if (cached && cached.revision === revision && cached.flagsVersion === (flagsVersion | 0)) {
        return cached;
    }

    const eh = w?.eventHandlers as any;
    const hasEventHandlerContainer = !!eh;
    const hasLegacyHandlerArrays =
        !!w?.onClick ||
        !!w?.onOp ||
        !!w?.onHold ||
        !!w?.onRelease ||
        !!w?.onMouseOver ||
        !!w?.onMouseLeave;

    let hasCs2Click = false;
    if (w?.hasListener || hasEventHandlerContainer || hasLegacyHandlerArrays) {
        hasCs2Click = !!(
            (eh instanceof Map
                ? eh.get("onClick") ||
                  eh.get("onOp") ||
                  eh.get("onHold") ||
                  eh.get("onRelease") ||
                  eh.get("onMouseOver") ||
                  eh.get("onMouseLeave")
                : eh?.onClick ||
                  eh?.onOp ||
                  eh?.onHold ||
                  eh?.onRelease ||
                  eh?.onMouseOver ||
                  eh?.onMouseLeave) ||
            (Array.isArray(w?.onClick) && w.onClick.length > 0) ||
            (Array.isArray(w?.onOp) && w.onOp.length > 0) ||
            (Array.isArray(w?.onHold) && w.onHold.length > 0) ||
            (Array.isArray(w?.onRelease) && w.onRelease.length > 0) ||
            (Array.isArray(w?.onMouseOver) && w.onMouseOver.length > 0) ||
            (Array.isArray(w?.onMouseLeave) && w.onMouseLeave.length > 0)
        );
    }

    const widgetActions = Array.isArray(w?.actions) ? (w.actions as any[]) : undefined;
    const hasActions = !!widgetActions?.some((a: any) => a && a !== "");
    const hasActionSlots = !!widgetActions?.length;
    const hasTargetVerbCandidate = !!w?.targetVerb || !!w?.spellActionName || !!w?.buttonText;
    const buttonType = (w?.buttonType ?? 0) | 0;
    const hasButtonTypeInteraction = buttonType > 0;
    const hasOriginalHandlers =
        !!w?.__hasOriginalOnClick ||
        !!w?.__hasOriginalOnOp ||
        !!w?.__hasOriginalOnHold ||
        !!w?.__hasOriginalOnRelease;

    const widgetItemId = w?.itemId;
    const widgetGroupId = (w?.groupId ?? (w?.uid != null ? w!.uid >>> 16 : 0)) | 0;
    const isInventoryItem = widgetGroupId === 149 && widgetItemId != null && widgetItemId >= 0;

    let isPauseButtonWidget = false;
    if (
        !hasCs2Click &&
        !hasActions &&
        !hasOriginalHandlers &&
        !isInventoryItem &&
        !hasTargetVerbCandidate &&
        !hasButtonTypeInteraction
    ) {
        if ((getWidgetFlags(w) & 1) !== 0) {
            isPauseButtonWidget = true;
        } else {
            const rawButtonText = w?.buttonText;
            if (typeof rawButtonText === "string" && rawButtonText.length > 0) {
                isPauseButtonWidget = rawButtonText.toLowerCase() === "continue";
            }
            if (!isPauseButtonWidget) {
                const rawWidgetText = w?.text;
                if (
                    typeof rawWidgetText === "string" &&
                    rawWidgetText.length >= 8 &&
                    rawWidgetText.toLowerCase().includes("continue")
                ) {
                    const lowerText = rawWidgetText.toLowerCase();
                    isPauseButtonWidget =
                        lowerText.includes("click") && lowerText.includes("continue");
                }
            }
        }
    }
    if (!isPauseButtonWidget && buttonType === 6) {
        isPauseButtonWidget = true;
    }

    const snapshot: WidgetInteractionSnapshot = {
        revision,
        flagsVersion: flagsVersion | 0,
        hasCs2Click,
        hasActions,
        hasActionSlots,
        hasTargetVerbCandidate,
        hasOriginalHandlers,
        isInventoryItem,
        hasButtonTypeInteraction,
        isPauseButtonWidget,
        buttonType,
        shouldDeriveEntries:
            hasActionSlots || hasTargetVerbCandidate || isInventoryItem || isPauseButtonWidget,
    };
    (w as any).__interactionSnapshot = snapshot;
    return snapshot;
}

export function deriveMenuEntriesForWidgetCached(
    w: any,
    getWidgetFlags?: (w: any) => number,
): Array<{ option: string; target?: string }> {
    const uid = typeof w?.uid === "number" ? w.uid | 0 : 0;
    if (uid === 0) {
        return UI_deriveMenuEntriesForWidget(w as any, false, getWidgetFlags) || [];
    }

    const flags = (getWidgetFlags ? getWidgetFlags(w) : ((w?.flags ?? 0) as number)) | 0;
    const revision = (((w?.__interactionRevision ?? 0) as number) | 0) as number;
    const flagsVersion =
        typeof w?.__widgetFlagsVersion === "number" ? (w.__widgetFlagsVersion as number) | 0 : 0;
    const itemId = (typeof w?.itemId === "number" ? w.itemId : -1) | 0;
    const targetVerb = String(w?.targetVerb ?? "");
    const spellActionName = String(w?.spellActionName ?? "");
    const opBase = String(w?.opBase ?? "");
    const dataText = String(w?.dataText ?? "");
    const name = String(w?.name ?? "");
    const text = String(w?.text ?? "");
    const actionsKey = getWidgetActionsKey(w);
    const { hasOnOpArray, hasOnOpHandler } = getWidgetOnOpHandlerPresence(w);

    const cached = widgetMenuDeriveCache.get(uid);
    if (
        cached &&
        cached.revision === revision &&
        cached.flagsVersion === flagsVersion &&
        cached.flags === flags &&
        cached.itemId === itemId &&
        cached.targetVerb === targetVerb &&
        cached.spellActionName === spellActionName &&
        cached.opBase === opBase &&
        cached.dataText === dataText &&
        cached.name === name &&
        cached.text === text &&
        cached.actionsKey === actionsKey &&
        cached.hasOnOpArray === hasOnOpArray &&
        cached.hasOnOpHandler === hasOnOpHandler
    ) {
        return transformWidgetMenuEntries(w, cached.entries);
    }

    // The cache keeps the menu as the widget defines it; plugins reorder it on every use.
    const entries = deriveRawMenuEntriesForWidget(w as any, false, getWidgetFlags) || [];
    const next: WidgetMenuDeriveCacheEntry = {
        revision,
        flagsVersion,
        flags,
        itemId,
        targetVerb,
        spellActionName,
        opBase,
        dataText,
        name,
        text,
        actionsKey,
        hasOnOpArray,
        hasOnOpHandler,
        entries,
    };
    if (widgetMenuDeriveCache.size >= WIDGET_MENU_DERIVE_CACHE_MAX) {
        const firstKey = widgetMenuDeriveCache.keys().next().value;
        if (firstKey !== undefined) widgetMenuDeriveCache.delete(firstKey);
    }
    widgetMenuDeriveCache.set(uid, next);
    return transformWidgetMenuEntries(w, entries);
}

