/** A tooltip's text: `<br>` or `</br>` breaks lines, `<col=rrggbb>` and `</col>` colour them. */
export type Tooltip = { text: string };

/** Asked every frame for the tooltip to show now, if any (RuneLite's per-frame `add`). */
export type TooltipSource = () => Tooltip | undefined;

/**
 * RuneLite's TooltipManager. RuneLite overlays add tooltips while they render and the manager is
 * cleared every frame; here an overlay registers a source once and TooltipOverlay asks every
 * source each frame, which gives the same per-frame list. `addFront` sources come first, the
 * latest added on top, as RuneLite's `addFront` inserts at the head of the list.
 */
export class TooltipManager {
    private readonly front: TooltipSource[] = [];
    private readonly back: TooltipSource[] = [];

    add(source: TooltipSource): void {
        this.remove(source);
        this.back.push(source);
    }

    addFront(source: TooltipSource): void {
        this.remove(source);
        this.front.unshift(source);
    }

    remove(source: TooltipSource): void {
        for (const list of [this.front, this.back]) {
            const index = list.indexOf(source);
            if (index >= 0) list.splice(index, 1);
        }
    }

    /** This frame's tooltips, in drawing order (top first). */
    getTooltips(): Tooltip[] {
        const tooltips: Tooltip[] = [];
        for (const source of [...this.front, ...this.back]) {
            try {
                const tooltip = source();
                if (tooltip && tooltip.text) tooltips.push(tooltip);
            } catch (error) {
                console.error("[tooltips] tooltip source failed", error);
            }
        }
        return tooltips;
    }
}

/** The client's one TooltipManager, bound in the plugin injector. */
export const tooltipManager = new TooltipManager();
