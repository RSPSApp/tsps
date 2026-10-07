import type { InputManager } from "../../InputManager";
import type { WidgetInputControllerDeps } from "./widgetInputTypes";
import type { WidgetInteractionController } from "../WidgetInteractionController";
import type { WidgetManager } from "../../../widgets/WidgetManager";
import { ClientState } from "../../ClientState";
import {
    chooseDefaultMenuEntry,
    getShiftClickActionIndex,
    type DefaultChoiceState,
} from "../../../ui/menu/MenuEngine";
import {
    deriveMenuEntriesForWidget,
    getWidgetTargetLabelForMenu,
    sanitizeText,
} from "../../../widgets/menu/utils";
import { resolveWidgetIdentifiers } from "../widgetActionPayload";

export type PrimaryWidgetAction = {
    option: string;
    target: string;
    slot?: number;
    itemId?: number;
    opIndex?: number;
};

export type PrimaryWidgetActionResolver = (w: any) => PrimaryWidgetAction;

export function createPrimaryWidgetActionResolver(
    deps: WidgetInputControllerDeps,
    input: InputManager,
    widgetManager: WidgetManager,
    widgetInteraction: WidgetInteractionController,
): PrimaryWidgetActionResolver {
    const getWidgetFlags = (w: any): number => widgetManager.getWidgetFlags(w);
    const getPrimaryWidgetAction = (
        w: any,
    ): { option: string; target: string; slot?: number; itemId?: number; opIndex?: number } => {
        const uid = typeof w?.uid === "number" ? w.uid | 0 : 0;
        const ids = resolveWidgetIdentifiers(widgetManager, w);
        const resolvedGroupId =
            (ids?.groupId ??
                (typeof w?.groupId === "number" ? w.groupId | 0 : (uid >>> 16) | 0)) | 0;
        // Prefer deriving options from the parent widget for dynamic children only when the parent
        // holds the ops (e.g., equipped item icons inside equipment slot components).
        // For dynamic children (fileId=-1), check if parent has menu ops.
        // Menu options show if transmit flag OR onOp handler.
        // Must check actions, targetVerb, AND onOp handler (not just actions/targetVerb).
        const menuWidget = (() => {
            const isDynamic = (w?.fileId | 0) === -1;
            const parentUid = (w as any)?.parentUid;
            if (isDynamic && typeof parentUid === "number" && parentUid !== -1) {
                const parent = widgetManager?.getWidgetByUid?.(parentUid);
                if (parent) {
                    const parentHasOps =
                        (Array.isArray((parent as any).actions) &&
                            (parent as any).actions.some((a: any) => !!sanitizeText(a))) ||
                        !!sanitizeText((parent as any).targetVerb) ||
                        (deps.getSpellSelection().getWidgetTargetMask(parent) > 0 &&
                            !!sanitizeText((parent as any).spellActionName)) ||
                        !!((parent as any).onOp || (parent as any).eventHandlers?.onOp);
                    const selfHasOps =
                        (Array.isArray((w as any).actions) &&
                            (w as any).actions.some((a: any) => !!sanitizeText(a))) ||
                        !!sanitizeText((w as any).targetVerb) ||
                        (deps.getSpellSelection().getWidgetTargetMask(w) > 0 &&
                            !!sanitizeText((w as any).spellActionName)) ||
                        !!((w as any).onOp || (w as any).eventHandlers?.onOp);
                    if (parentHasOps && !selfHasOps) return parent;
                }
            }
            return w;
        })();

        let entryOption: string | undefined;
        let entryTarget: string | undefined;
        let entryOpIndex: number | undefined;
        const getWidgetByUidLocal = (uid: number) => widgetManager?.getWidgetByUid(uid);
        try {
            const derived = deriveMenuEntriesForWidget(
                menuWidget,
                false,
                getWidgetFlags,
                getWidgetByUidLocal,
            ) as any[];

            // Fallback: pick the first actionable entry from the derived list (matches hover label).
            const fallback = Array.isArray(derived)
                ? derived.find((e) => {
                      const lower = String(e?.option || "").toLowerCase();
                      return (
                          lower &&
                          lower !== "cancel" &&
                          lower !== "examine" &&
                          lower !== "inspect" &&
                          lower !== "walk here"
                      );
                  })
                : undefined;
            if (fallback?.option) {
                entryOption = String(fallback.option);
                entryTarget = fallback.target;
                entryOpIndex =
                    typeof fallback.opIndex === "number" ? fallback.opIndex | 0 : undefined;
            }

            // Widget menu entries are already in OSRS display order (top-to-bottom).
            // normalizeMenuEntries expects OSRS insertion order and would reverse widget ops
            // (e.g., minimap orbs), breaking primary click selection.
            const normalized = derived as any[];
            const isShiftHeld = input.isShiftDown();
            const hasSelection =
                ClientState.isSpellSelected || ClientState.isItemSelected === 1;
            // shift-click uses the item's configured shiftClickIndex (opcode 42) when enabled.
            // Inventory shift-click drop only applies to the inventory interface (group 149).
            let shiftClickActionIndex: number | undefined;
            if (
                isShiftHeld &&
                deps.getSettings().shiftClickEnabled &&
                (resolvedGroupId | 0) === 149 &&
                typeof w?.itemId === "number" &&
                (w.itemId | 0) > 0
            ) {
                try {
                    const obj = deps.getObjTypeLoader()?.load?.(w.itemId | 0);
                    const idx = getShiftClickActionIndex(obj);
                    if (idx >= 0) shiftClickActionIndex = idx;
                } catch {}
            }
            const state: DefaultChoiceState = {
                hasSelectedSpell: ClientState.isSpellSelected,
                hasSelectedItem: ClientState.isItemSelected === 1,
                isShiftHeld,
                shiftClickActionIndex,
            };
            const chosen = chooseDefaultMenuEntry(normalized, state);
            const lower = String(chosen?.option || "").toLowerCase();
            const isNonAction =
                lower === "cancel" ||
                lower === "examine" ||
                lower === "inspect" ||
                lower === "walk here";
            if (chosen && !isNonAction) {
                entryOption = String(chosen.option);
                entryTarget = chosen.target;
                entryOpIndex =
                    typeof (chosen as any).opIndex === "number"
                        ? (chosen as any).opIndex | 0
                        : undefined;
            }

            // Shift-click drop overrides the inventory item's primary option only when
            // no spell/item selection is active.
            if (
                isShiftHeld &&
                deps.getSettings().shiftClickEnabled &&
                !hasSelection &&
                (resolvedGroupId | 0) === 149
            ) {
                const dropEntry = Array.isArray(normalized)
                    ? (normalized as any[]).find((e) => {
                          const l = String(e?.option || "").toLowerCase();
                          return l === "drop" || l === "destroy" || l === "release";
                      })
                    : undefined;
                if (dropEntry?.option) {
                    entryOption = String(dropEntry.option);
                    entryTarget = dropEntry.target;
                    entryOpIndex =
                        typeof dropEntry.opIndex === "number"
                            ? dropEntry.opIndex | 0
                            : undefined;
                }
            }
        } catch {}
        const fallbackActionFromWidgetActions = (): string | undefined => {
            const actions: Array<string | null | undefined> = Array.isArray(w?.actions)
                ? w.actions
                : [];
            for (const a of actions) {
                const p = sanitizeText(a);
                if (p) return p;
            }
            return undefined;
        };
        const option =
            sanitizeText(entryOption) ??
            fallbackActionFromWidgetActions() ??
            sanitizeText(w?.targetVerb) ??
            (deps.getSpellSelection().getWidgetTargetMask(w) > 0 ? sanitizeText(w?.spellActionName) : undefined) ??
            "Ok";
        const target =
            (sanitizeText(entryTarget) ? String(entryTarget).trim() : undefined) ??
            getWidgetTargetLabelForMenu(menuWidget) ??
            "";
        const slot = typeof w?.childIndex === "number" ? w.childIndex | 0 : undefined;
        const itemId = typeof w?.itemId === "number" && w.itemId > 0 ? w.itemId | 0 : undefined;
        return { option, target, slot, itemId, opIndex: entryOpIndex };
    };
    return getPrimaryWidgetAction;
}
