import type { WidgetManager } from "../../../widgets/WidgetManager";
import type { WidgetNode } from "../../../widgets/WidgetNode";
import type { WidgetInputControllerDeps, WidgetInputFrame } from "./widgetInputTypes";

/** Cache key pairs use internal key codes and Ctrl/Alt/Shift/no-modifier mask bits. */
function modifiersMatch(mask: number, input: WidgetInputFrame["input"]): boolean {
    const ctrl = input.isKeyHeld(82), alt = input.isKeyHeld(86), shift = input.isKeyHeld(81);
    return (!(mask & 8) || !(ctrl || alt || shift)) &&
        (!(mask & 1) || ctrl) && (!(mask & 2) || alt) && (!(mask & 4) || shift);
}

/** Bounds and mouse position do not gate shortcuts: e.g. worldmap:esckey is a zero-size layer. */
export function collectShortcutWidgets(frame: WidgetInputFrame, manager: WidgetManager): WidgetNode[] {
    const seen = new Set<WidgetNode>();
    const result: WidgetNode[] = [];
    const visit = (widget: WidgetNode) => {
        if (!widget || seen.has(widget)) return;
        seen.add(widget);
        if (widget.hidden || frame.visibleMap.get(widget.uid) === false) return;
        if (widget.hasKeyBindings) result.push(widget);
        for (const child of frame.getStaticChildren(widget.uid)) visit(child);
        for (const child of widget.children ?? []) if (child) visit(child);
        const parent = manager.interfaceParents.get(widget.uid);
        if (parent) for (const root of manager.getAllGroupRoots(parent.group)) visit(root);
    };
    for (const root of frame.allRoots) {
        if (!manager.isEffectivelyHidden(root.uid)) visit(root);
    }
    return result;
}

/**
 * Native updateInterface key scheduling (revision 241). State belongs to each widget, so an
 * unloaded/rebuilt widget cannot inherit a former instance's held-key repeat schedule.
 * Runs before onKey listeners: their queued native scripts cannot change this input's scope.
 */
export function processWidgetShortcutInput(
    deps: WidgetInputControllerDeps,
    frame: WidgetInputFrame,
    manager: WidgetManager,
): Set<number> {
    const input = frame.input;
    const vm = deps.getCs2Vm();
    const consumed = new Set<number>();
    const widgets = collectShortcutWidgets(frame, manager);
    if (!widgets.length) return consumed;
    const cycle = deps.getTransmitCycles().cycleCntr;
    for (const widget of widgets) {
        const group = widget.uid >>> 16;
        // A previous operation can close this group or replace this dynamic child.
        if (manager.getWidgetByUid(widget.uid) !== widget || manager.isEffectivelyHidden(widget.uid)) continue;
        if (group !== manager.rootInterface && ![...manager.interfaceParents.values()].some(p => p.group === group)) continue;
        // onOp runs synchronously and may change eligibility for the next widget.
        const mode = vm.widgetKeyInputMode;
        const target = vm.widgetKeyInputTarget;
        const component = widget.fileId === -1 ? widget.parentUid ?? widget.uid : widget.uid;
        if (mode === 1 || (mode === 2 && component >>> 16 !== target) || (mode === 3 && component !== target)) continue;
        for (let slot = 0; slot < (widget.opKeys?.length ?? 0); slot++) {
            const binding = widget.opKeys![slot];
            if (!binding) continue;
            let active = false;
            let matchedKey = -1;
            for (let alternative = 0; alternative < binding.keyChars.length; alternative++) {
                const key = binding.keyChars[alternative];
                if (!input.wasKeyPressed(key) && !(widget.keyTimers && input.isKeyHeld(key))) continue;
                active = true;
                if ((widget.keyTimers?.[slot] ?? 0) > cycle) {
                    // A held cache shortcut still owns its key while cooling down. In particular,
                    // Escape must not fall through to the generic modal-close fallback.
                    if (modifiersMatch(binding.keyCodes[alternative], input)) consumed.add(key);
                    break;
                }
                if (modifiersMatch(binding.keyCodes[alternative], input)) {
                    matchedKey = key;
                    break;
                }
            }
            if (matchedKey >= 0) {
                consumed.add(matchedKey);
                deps.handleWidgetAction({ widget, source: "shortcut", opIndex: slot === 10 ? 0 : slot + 1,
                    option: slot === 10 ? widget.targetVerb : widget.actions?.[slot] ?? undefined,
                    target: "", itemId: widget.itemId });
                // An onOp can rebuild its own tree. Never dispatch another binding on the old instance.
                if (manager.getWidgetByUid(widget.uid) !== widget) break;
                // Native scheduling observes callback changes to rates and ignore-held timers.
                const timers = widget.keyTimers ??= new Array(11).fill(0);
                const { rate = 0, delay = 0 } = widget.opKeyRates?.[slot] ?? {};
                timers[slot] = rate ? cycle + rate + (timers[slot] === 0 ? delay : 0) : 0x7fffffff;
            }
            if (!active && widget.keyTimers) widget.keyTimers[slot] = 0;
        }
    }
    return consumed;
}
