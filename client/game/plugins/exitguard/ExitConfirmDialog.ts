import "./ExitConfirmDialog.css";

export type ExitConfirmDialogActions = { onStay(): void; onLeave(): void };

const TITLE = "Leave the game?";
const BODY = "Going back closes the game and disconnects you.";
const BLOCKED = "Your browser kept this page open. Close its tab to leave.";
const STAY = "Stay";
const LEAVE = "Leave";

/**
 * The confirmation itself, built with plain DOM and put on `document.body` rather than the
 * plugin HUD layer: that layer is hidden with the game's own UI, and on iOS it is turned with the
 * canvas, neither of which may hide the only way out of a hijacked back button.
 */
export class ExitConfirmDialog {
    private readonly doc: Document | undefined;
    private root: HTMLDivElement | undefined;
    private message: HTMLElement | undefined;
    private stayButton: HTMLButtonElement | undefined;

    constructor(
        private readonly actions: ExitConfirmDialogActions = { onStay: () => {}, onLeave: () => {} },
        doc?: Document,
    ) {
        this.doc = doc ?? (typeof document !== "undefined" ? document : undefined);
    }

    isOpen(): boolean {
        return !!this.root && !this.root.hasAttribute("hidden");
    }

    /** Whether `target` is one of this dialog's own controls, i.e. the browser's to handle. */
    holds(target: EventTarget | Node | null): boolean {
        return !!this.root && !!target && this.root.contains(target as Node);
    }

    show(blocked: boolean): void {
        const root = this.mount();
        if (!root) return;
        root.removeAttribute("hidden");
        if (this.message) this.message.textContent = blocked ? BLOCKED : BODY;
        // Focus the safe answer, so Enter keeps the player in the game.
        this.stayButton?.focus();
    }

    hide(): void {
        this.root?.setAttribute("hidden", "");
    }

    destroy(): void {
        this.root?.remove();
        this.root = undefined;
        this.message = undefined;
        this.stayButton = undefined;
    }

    private mount(): HTMLDivElement | undefined {
        const doc = this.doc;
        if (!doc) return undefined;
        if (this.root) return this.root;

        const root = doc.createElement("div");
        root.className = "exit-guard";
        root.setAttribute("role", "dialog");
        root.setAttribute("aria-modal", "true");
        root.setAttribute("aria-label", TITLE);
        root.setAttribute("hidden", "");
        // A click anywhere on the backdrop is the safe answer too: reaching the buttons on a
        // phone, with the game still running behind, should not be the only way to stay.
        root.addEventListener("click", (event) => {
            if (event.target === root) this.actions.onStay();
        });

        const panel = doc.createElement("div");
        panel.className = "exit-guard-panel";
        for (const type of ["mousedown", "click", "keydown", "keyup"] as const) {
            panel.addEventListener(type, (event) => event.stopPropagation());
        }

        const title = doc.createElement("div");
        title.className = "exit-guard-title";
        title.textContent = TITLE;

        const message = doc.createElement("div");
        message.className = "exit-guard-message";
        message.textContent = BODY;

        const buttons = doc.createElement("div");
        buttons.className = "exit-guard-actions";
        const stay = this.button(doc, STAY, "exit-guard-stay", () => this.actions.onStay());
        const leave = this.button(doc, LEAVE, "exit-guard-leave", () => this.actions.onLeave());
        buttons.append(stay, leave);

        panel.append(title, message, buttons);
        root.append(panel);
        doc.body.append(root);

        this.root = root;
        this.message = message;
        this.stayButton = stay;
        return root;
    }

    private button(
        doc: Document,
        label: string,
        className: string,
        onClick: () => void,
    ): HTMLButtonElement {
        const button = doc.createElement("button");
        button.type = "button";
        button.className = `exit-guard-button ${className}`;
        button.textContent = label;
        button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            onClick();
        });
        return button;
    }
}
