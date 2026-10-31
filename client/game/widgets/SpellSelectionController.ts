import type { Cs2Vm, ScriptEvent } from "../../rs/cs2/Cs2Vm";
import type { ObjTypeLoader } from "../../rs/config/objtype/ObjTypeLoader";
import type { WidgetManager } from "../../widgets/WidgetManager";
import { ClientState } from "../ClientState";
import type { SelectedSpellInfo, SpellSelectionState } from "./widgetActionHandlers";

const SPELL_BUTTON_PARAM_ID = 596;
const SPELLBOOK_GROUP_IDS = new Set([218, 219, 388, 389]);

export type SpellSelectionControllerDeps = {
    getWidgetManager: () => WidgetManager | undefined;
    getObjTypeLoader: () => ObjTypeLoader | undefined;
    getCs2Vm: () => Cs2Vm | undefined;
    executeScriptListener: (
        widget: any,
        listener: any[],
        eventContext?: Partial<ScriptEvent>,
    ) => void;
};

/**
 * The child slot a selected spell widget sits in: its index under a dynamic parent, -1 for a
 * static component, as the menu's target entry passes it. A component id is not a slot.
 */
export function spellWidgetChildSlot(widget: any): number {
    return typeof widget?.childIndex === "number" ? widget.childIndex | 0 : -1;
}

/** Spell targeting selection state and onTargetEnter/Leave dispatch. */
export class SpellSelectionController {
    constructor(private readonly deps: SpellSelectionControllerDeps) {}

    getWidgetTargetMask(widget: any): number {
        if (!widget) return 0;
        const widgetManager = this.deps.getWidgetManager();
        const flags =
            widgetManager?.getWidgetFlags?.(widget) ??
            (typeof widget.flags === "number" ? widget.flags | 0 : 0);
        return (flags >>> 11) & 0x3f;
    }

    resolveSpellSelectionFromWidget(
        widget: any | undefined,
        fallbackWidgetId: number,
        fallbackChildIndex: number,
        fallbackItemId: number,
    ): SpellSelectionState {
        const itemId =
            typeof widget?.itemId === "number" && (widget.itemId | 0) > 0
                ? widget.itemId | 0
                : (fallbackItemId | 0) > 0
                  ? fallbackItemId | 0
                  : (this.resolveWidgetItemId(fallbackWidgetId | 0, fallbackChildIndex | 0) ??
                    fallbackItemId | 0);
        const componentHash = this.resolveSpellButtonComponentFromObject(itemId);
        if (componentHash !== undefined) {
            return {
                widgetId: componentHash,
                childIndex: componentHash & 0xffff,
                itemId,
            };
        }
        return {
            widgetId: fallbackWidgetId | 0,
            childIndex: fallbackChildIndex | 0,
            itemId: fallbackItemId | 0,
        };
    }

    normalizeSelectedSpellState(): void {
        if (!ClientState.isSpellSelected || ClientState.selectedSpellWidget <= 0) return;
        const selection = this.resolveSpellSelectionFromWidget(
            undefined,
            ClientState.selectedSpellWidget,
            ClientState.selectedSpellChildIndex,
            ClientState.selectedSpellItemId,
        );
        ClientState.selectedSpellWidget = selection.widgetId;
        ClientState.selectedSpellChildIndex = selection.childIndex;
        ClientState.selectedSpellItemId = selection.itemId;
    }

    setSelectedSpell(spell: SelectedSpellInfo | null, sourceWidget?: any): void {
        console.log(
            `[setSelectedSpell] Called with spell=${spell?.spellName}, sourceWidget=${sourceWidget?.uid}`,
        );

        const widgetManager = this.deps.getWidgetManager();
        if (ClientState.selectedSpellSourceWidget) {
            this.fireOnTargetLeave(ClientState.selectedSpellSourceWidget);
            try {
                widgetManager?.invalidateWidgetRender(
                    ClientState.selectedSpellSourceWidget,
                    "spell-target-leave",
                );
            } catch {}
        }

        if (spell) {
            ClientState.isSpellSelected = true;
            ClientState.selectedSpellId = spell.spellId | 0;
            ClientState.selectedSpellName = spell.spellName;
            ClientState.selectedSpellLevel = spell.spellLevel ?? 0;
            ClientState.selectedSpellRunes =
                spell.runes?.map((r) => ({
                    itemId: r.itemId | 0,
                    quantity: r.quantity | 0,
                    name: r.name,
                })) ?? [];
            ClientState.selectedSpellSourceWidget = sourceWidget ?? spell.sourceWidget ?? null;
            if (ClientState.selectedSpellTargetMask === 0 && sourceWidget) {
                ClientState.selectedSpellTargetMask = this.getWidgetTargetMask(sourceWidget);
            }
        } else {
            ClientState.clearSpellSelection();
        }

        console.log(
            `[setSelectedSpell] After set: isSpellSelected=${ClientState.isSpellSelected}, sourceWidget=${ClientState.selectedSpellSourceWidget?.uid}`,
        );
        if (ClientState.selectedSpellSourceWidget) {
            this.fireOnTargetEnter(ClientState.selectedSpellSourceWidget);
            try {
                widgetManager?.invalidateWidgetRender(
                    ClientState.selectedSpellSourceWidget,
                    "spell-target-enter",
                );
            } catch {}
        } else {
            console.log(`[setSelectedSpell] No sourceWidget to fire onTargetEnter`);
        }
    }

    clearSelectedSpell(): void {
        const sourceWidget = ClientState.selectedSpellSourceWidget;
        const widgetManager = this.deps.getWidgetManager();
        if (sourceWidget) {
            this.fireOnTargetLeave(sourceWidget);
        }
        ClientState.clearSpellSelection();
        if (sourceWidget) {
            try {
                widgetManager?.invalidateWidgetRender(sourceWidget, "spell-target-leave");
            } catch {}
        }
    }

    private resolveSpellButtonComponentFromObject(itemId: number | undefined): number | undefined {
        if (typeof itemId !== "number" || (itemId | 0) <= 0) return undefined;
        try {
            const obj = this.deps.getObjTypeLoader()?.load?.(itemId | 0) as any;
            const componentHash = obj?.params?.get?.(SPELL_BUTTON_PARAM_ID);
            return typeof componentHash === "number" && (componentHash | 0) > 0
                ? componentHash | 0
                : undefined;
        } catch {
            return undefined;
        }
    }

    private resolveWidgetItemId(widgetId: number, childIndex: number): number | undefined {
        const widgetManager = this.deps.getWidgetManager();
        const direct = widgetManager?.getWidgetByUid?.(widgetId | 0) as any;
        if (typeof direct?.itemId === "number" && (direct.itemId | 0) > 0) {
            return direct.itemId | 0;
        }

        if (direct && Array.isArray(direct.children) && childIndex >= 0) {
            const child = direct.children[childIndex | 0];
            if (typeof child?.itemId === "number" && (child.itemId | 0) > 0) {
                return child.itemId | 0;
            }
        }

        const groupId = (widgetId >>> 16) & 0xffff;
        if (!SPELLBOOK_GROUP_IDS.has(groupId)) {
            return undefined;
        }
        const groupWidgets = widgetManager?.getWidgetsForGroup?.(groupId) ?? [];
        for (const parent of groupWidgets as any[]) {
            if (!Array.isArray(parent?.children) || childIndex < 0) continue;
            const child = parent.children[childIndex | 0];
            if (typeof child?.itemId === "number" && (child.itemId | 0) > 0) {
                return child.itemId | 0;
            }
        }

        return undefined;
    }

    private fireOnTargetEnter(widget: any): void {
        if (!widget) return;

        console.log(
            `[onTargetEnter] Widget uid=${widget.uid}, hasEventHandlers=${!!widget.eventHandlers
                ?.onTargetEnter}, hasOnTargetEnter=${
                Array.isArray(widget.onTargetEnter) && widget.onTargetEnter.length > 0
            }`,
        );

        const cs2Vm = this.deps.getCs2Vm();
        if (widget.eventHandlers?.onTargetEnter) {
            console.log(`[onTargetEnter] Invoking eventHandlers.onTargetEnter`);
            cs2Vm?.invokeEventHandler(widget, "onTargetEnter");
        } else if (Array.isArray(widget.onTargetEnter) && widget.onTargetEnter.length > 0) {
            console.log(`[onTargetEnter] Executing script listener`, widget.onTargetEnter);
            this.deps.executeScriptListener(widget, widget.onTargetEnter);
        } else {
            console.log(`[onTargetEnter] No handler found for widget`);
        }
    }

    private fireOnTargetLeave(widget: any): void {
        if (!widget) return;

        const cs2Vm = this.deps.getCs2Vm();
        if (widget.eventHandlers?.onTargetLeave) {
            cs2Vm?.invokeEventHandler(widget, "onTargetLeave");
        } else if (Array.isArray(widget.onTargetLeave) && widget.onTargetLeave.length > 0) {
            this.deps.executeScriptListener(widget, widget.onTargetLeave);
        }
    }
}
