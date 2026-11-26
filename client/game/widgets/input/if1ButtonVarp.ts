/**
 * Legacy (IF1) toggle and select buttons change their own varp in the client when clicked, so
 * the button shows its new state at once: a toggle (button type 4) flips the varp between 0
 * and 1, a select (type 5) sets it to the button's comparison value. The varp is the one the
 * button's first cs1 instruction reads (instruction 5).
 */
type If1Button = {
    isIf3?: boolean;
    buttonType?: number;
    cs1Instructions?: ArrayLike<ArrayLike<number>>;
    cs1ComparisonValues?: ArrayLike<number>;
};
type Varps = { getVarp(id: number): number; setVarp(id: number, value: number): unknown };

const CS1_READ_VARP = 5;

/** Returns true when the click changed a varp. */
export function applyIf1ButtonVarp(widget: If1Button | null | undefined, varps: Varps): boolean {
    if (!widget || widget.isIf3 !== false) return false;
    const first = widget.cs1Instructions?.[0];
    if (!first || first[0] !== CS1_READ_VARP) return false;
    const varpId = first[1] | 0;
    if (widget.buttonType === 4) {
        varps.setVarp(varpId, 1 - varps.getVarp(varpId));
        return true;
    }
    if (widget.buttonType === 5) {
        const value = widget.cs1ComparisonValues?.[0];
        if (value === undefined || varps.getVarp(varpId) === value) return false;
        varps.setVarp(varpId, value);
        return true;
    }
    return false;
}
