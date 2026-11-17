import type { WidgetActionClientPayload } from "../../network/ServerConnection";
import type { WidgetManager } from "../../widgets/WidgetManager";
import {
    getWidgetTargetLabel,
    sanitizeText,
} from "../../widgets/menu/utils";

export type WidgetActionEvent = {
    widget?: any;
    option?: string;
    target?: string;
    source?: "menu" | "primary" | "shortcut";
    cursorX?: number;
    cursorY?: number;
    slot?: number;
    itemId?: number;
    /** Explicit 1-based widget op index (identifier); 0 for targetVerb entries */
    opIndex?: number;
    /** 1-based submenu entry index when invoked from an op submenu */
    opSubIndex?: number;
};

export function isCombatSkillWidgetAction(payload: WidgetActionClientPayload): boolean {
    return (
        payload.groupId === 320 &&
        [1, 2, 3, 4, 5, 6, 9].includes(payload.childId)
    );
}

export function inferWidgetOpId(widget: any, option?: string): number | undefined {
    const normalized = sanitizeText(option)?.toLowerCase();
    if (!normalized) return undefined;
    const verb = sanitizeText(widget?.targetVerb)?.toLowerCase();
    if (verb && normalized === verb) return 0;
    const actions: Array<string | null | undefined> = Array.isArray(widget?.actions)
        ? widget.actions
        : [];
    for (let i = 0; i < actions.length; i++) {
        const act = sanitizeText(actions[i])?.toLowerCase();
        if (act && act === normalized) {
            return i + 1;
        }
    }
    return undefined;
}

export function resolveDynamicWidgetParentId(
    widgetManager: WidgetManager | undefined,
    widget: any,
): number | undefined {
    const validParentId = (value: unknown): number | undefined => {
        if (typeof value !== "number") return undefined;
        const id = value | 0;
        return id > 0 ? id : undefined;
    };

    const widgetUid = typeof widget?.uid === "number" ? widget.uid | 0 : undefined;
    const directParentUid = validParentId(widget?.parentUid);
    const directId = validParentId(widget?.id);
    const direct =
        directParentUid ??
        (directId !== undefined && directId !== widgetUid ? directId : undefined);
    if (direct !== undefined) return direct;

    const uid = validParentId(widget?.uid);
    const canonical =
        uid !== undefined ? widgetManager?.getWidgetByUid?.(uid | 0) : undefined;
    const canonicalParent =
        validParentId((canonical as any)?.parentUid) ?? validParentId((canonical as any)?.id);
    if (canonicalParent !== undefined) return canonicalParent;

    const childIndex =
        typeof widget?.childIndex === "number"
            ? widget.childIndex | 0
            : typeof (canonical as any)?.childIndex === "number"
              ? ((canonical as any).childIndex as number) | 0
              : -1;
    if (childIndex < 0) return undefined;

    const groupId =
        typeof widget?.groupId === "number"
            ? widget.groupId | 0
            : typeof (canonical as any)?.groupId === "number"
              ? ((canonical as any).groupId as number) | 0
              : uid !== undefined
                ? (uid >>> 16) & 0xffff
                : undefined;
    if (groupId === undefined) return undefined;

    const groupWidgets = widgetManager?.getWidgetsForGroup?.(groupId) ?? [];
    for (const parent of groupWidgets as any[]) {
        const child = Array.isArray(parent?.children) ? parent.children[childIndex] : undefined;
        if (!child) continue;
        if (
            child === widget ||
            child === canonical ||
            (uid !== undefined && typeof child.uid === "number" && (child.uid | 0) === uid)
        ) {
            return validParentId(parent.uid) ?? validParentId(parent.id);
        }
    }

    return undefined;
}

export function resolveWidgetIdentifiers(
    widgetManager: WidgetManager | undefined,
    widget: any,
): { widgetId: number; groupId: number; childId: number } | undefined {
    if (!widget) return undefined;
    if ((widget.fileId | 0) === -1) {
        const parentId = resolveDynamicWidgetParentId(widgetManager, widget);
        if (parentId === undefined) {
            // Fall through to UID-derived identifiers (best-effort)
        } else {
            const widgetId = parentId | 0;
            const groupId = (widgetId >>> 16) | 0;
            const childId = widgetId & 0xffff;
            return { widgetId, groupId, childId };
        }
    }
    const hasUid = typeof widget.uid === "number";
    const groupId =
        typeof widget.groupId === "number"
            ? widget.groupId | 0
            : hasUid
              ? (widget.uid >>> 16) | 0
              : undefined;
    if (groupId === undefined) return undefined;
    const childId =
        typeof widget.fileId === "number" && widget.fileId >= 0
            ? widget.fileId | 0
            : hasUid
              ? widget.uid & 0xffff
              : 0;
    const widgetId = ((groupId & 0xffff) << 16) | (childId & 0xffff);
    return { widgetId, groupId, childId };
}

export function resolveTransmitFlagWidget(
    widgetManager: WidgetManager | undefined,
    eventWidget: any,
    payload: WidgetActionClientPayload,
): any {
    const slot = typeof payload.slot === "number" ? payload.slot | 0 : -1;
    if (slot < 0) return eventWidget;

    const eventIsExactDynamicChild =
        (eventWidget?.fileId | 0) === -1 &&
        typeof eventWidget?.childIndex === "number" &&
        (eventWidget.childIndex | 0) === slot;
    if (eventIsExactDynamicChild) return eventWidget;

    const parentId = payload.widgetId | 0;
    const parent = widgetManager?.getWidgetByUid?.(parentId);
    if (parent && Array.isArray((parent as any).children)) {
        const child = (parent as any).children[slot];
        if (
            child &&
            (child.fileId | 0) === -1 &&
            typeof child.childIndex === "number" &&
            (child.childIndex | 0) === slot
        ) {
            return child;
        }
    }

    return { id: parentId, childIndex: slot, flags: 0 };
}

export function buildWidgetActionPayload(
    widgetManager: WidgetManager | undefined,
    event: WidgetActionEvent,
): WidgetActionClientPayload | undefined {
    const widget = event.widget;
    if (!widget) return undefined;
    const ids = resolveWidgetIdentifiers(widgetManager, widget);
    if (!ids) return undefined;
    const option = sanitizeText(event.option) ?? event.option?.trim() ?? "";
    const target = sanitizeText(event.target) ?? event.target?.trim() ?? "";
    const payload: WidgetActionClientPayload = {
        widgetId: ids.widgetId,
        groupId: ids.groupId,
        childId: ids.childId,
    };
    if (option.length) payload.option = option;
    if (target.length) payload.target = target;
    const opId = event.opIndex ?? inferWidgetOpId(widget, option.length ? option : undefined);
    if (typeof opId === "number") payload.opId = opId;
    if (typeof event.opSubIndex === "number" && event.opSubIndex >= 1) {
        payload.subOpId = event.opSubIndex | 0;
    }
    if (typeof event.cursorX === "number") payload.cursorX = event.cursorX;
    if (typeof event.cursorY === "number") payload.cursorY = event.cursorY;

    const explicitSlot = typeof event.slot === "number" ? event.slot | 0 : undefined;
    const dynamicSlot =
        (widget.fileId | 0) === -1 && typeof widget.childIndex === "number"
            ? widget.childIndex | 0
            : undefined;
    let slot =
        explicitSlot !== undefined && explicitSlot >= 0
            ? explicitSlot
            : dynamicSlot !== undefined && dynamicSlot >= 0
              ? dynamicSlot
              : undefined;

    const recoverSlotByOptionTarget = (parent: any): number | undefined => {
        if (!parent || !Array.isArray(parent.children) || option.length === 0) return undefined;
        const optionLower = option.toLowerCase();
        const targetLower = target.length > 0 ? target.toLowerCase() : undefined;
        for (const child of parent.children as any[]) {
            if (!child || (child.fileId | 0) !== -1) continue;
            if (typeof child.childIndex !== "number" || (child.childIndex | 0) < 0) continue;

            const childActions: Array<string | null | undefined> = Array.isArray(child.actions)
                ? child.actions
                : [];
            const childHasOption = childActions.some((action) => {
                const sanitized = sanitizeText(action)?.toLowerCase();
                return !!sanitized && sanitized === optionLower;
            });
            if (!childHasOption) continue;

            if (targetLower) {
                const childTarget = getWidgetTargetLabel(child).toLowerCase();
                if (!childTarget || childTarget !== targetLower) continue;
            }
            return child.childIndex | 0;
        }
        return undefined;
    };

    const recoverSlotByPosition = (parent: any, sourceWidget: any): number | undefined => {
        if (
            !parent ||
            !Array.isArray(parent.children) ||
            typeof event.cursorX !== "number" ||
            typeof event.cursorY !== "number"
        ) {
            return undefined;
        }

        let localX = event.cursorX | 0;
        let localY = event.cursorY | 0;

        const sourceAbsX =
            typeof sourceWidget?._absX === "number"
                ? (sourceWidget._absX as number) | 0
                : undefined;
        const sourceAbsY =
            typeof sourceWidget?._absY === "number"
                ? (sourceWidget._absY as number) | 0
                : undefined;
        const parentAbsX =
            typeof parent?._absX === "number" ? (parent._absX as number) | 0 : undefined;
        const parentAbsY =
            typeof parent?._absY === "number" ? (parent._absY as number) | 0 : undefined;

        if (
            parent !== sourceWidget &&
            sourceAbsX !== undefined &&
            sourceAbsY !== undefined &&
            parentAbsX !== undefined &&
            parentAbsY !== undefined
        ) {
            localX = localX + sourceAbsX - parentAbsX;
            localY = localY + sourceAbsY - parentAbsY;
        } else {
            const parentW =
                typeof parent.width === "number" ? Math.max(0, parent.width | 0) : 0;
            const parentH =
                typeof parent.height === "number" ? Math.max(0, parent.height | 0) : 0;
            const looksRelative =
                localX >= 0 &&
                localY >= 0 &&
                (parentW <= 0 || localX < parentW) &&
                (parentH <= 0 || localY < parentH);
            if (!looksRelative && parentAbsX !== undefined && parentAbsY !== undefined) {
                localX -= parentAbsX;
                localY -= parentAbsY;
            }
        }

        const scrollX = typeof parent.scrollX === "number" ? parent.scrollX | 0 : 0;
        const scrollY = typeof parent.scrollY === "number" ? parent.scrollY | 0 : 0;

        for (let i = parent.children.length - 1; i >= 0; i--) {
            const child = parent.children[i];
            if (!child || (child.fileId | 0) !== -1) continue;
            if (typeof child.childIndex !== "number" || (child.childIndex | 0) < 0) continue;
            if (child.hidden || child.hide) continue;

            const childX = (typeof child.x === "number" ? child.x | 0 : 0) - scrollX;
            const childY = (typeof child.y === "number" ? child.y | 0 : 0) - scrollY;
            const childW = Math.max(1, typeof child.width === "number" ? child.width | 0 : 0);
            const childH = Math.max(1, typeof child.height === "number" ? child.height | 0 : 0);
            if (
                localX < childX ||
                localY < childY ||
                localX >= childX + childW ||
                localY >= childY + childH
            ) {
                continue;
            }

            const childFlags =
                widgetManager?.getWidgetFlags?.(child) ??
                (typeof child.flags === "number" ? child.flags | 0 : 0);
            const hasTransmitOps = (childFlags & 0x7fe) !== 0;
            const childActions: Array<string | null | undefined> = Array.isArray(child.actions)
                ? child.actions
                : [];
            const hasAction = childActions.some((action) => !!sanitizeText(action));
            const hasOpHandler = !!(child.onOp || child.eventHandlers?.onOp);
            if (!hasTransmitOps && !hasAction && !hasOpHandler) continue;

            return child.childIndex | 0;
        }
        return undefined;
    };

    const candidateParents: any[] = [];
    if ((widget.fileId | 0) !== -1) {
        candidateParents.push(widget);
        const canonicalParent = widgetManager?.getWidgetByUid?.(ids.widgetId | 0);
        if (canonicalParent && canonicalParent !== widget) {
            candidateParents.push(canonicalParent);
        }
    }

    for (const parent of candidateParents) {
        if (slot === undefined) slot = recoverSlotByOptionTarget(parent);
        if (slot === undefined) slot = recoverSlotByPosition(parent, widget);
        if (typeof slot === "number" && slot >= 0) break;
    }

    if (typeof slot === "number" && slot >= 0) payload.slot = slot;
    if (typeof event.itemId === "number") payload.itemId = event.itemId;
    if (event.source) payload.isPrimary = event.source === "primary";
    return payload;
}
