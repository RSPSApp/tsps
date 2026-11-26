import { EDITOR_TOP_BAR_CLEARANCE, EDITOR_TOP_BAR_HEIGHT } from "./EditorToolbar";

type Action = { label: string; run: () => void };
type Task = Action & { id: string; description: string; keywords?: string };
type Group = { label?: string; tasks: Task[] };
type Workspace = { label: string; icon: () => SVGElement; groups: Group[]; open?: () => void };

const STYLES = `
.ghost-editor-bar, .ghost-editor-tools, .ghost-editor-finder {
    color: #eef4ff;
    font: 13px/1.4 sans-serif;
}
.ghost-editor-bar[hidden], .ghost-editor-tools[hidden], .ghost-editor-finder[hidden] { display: none; }
.ghost-editor-bar {
    position: absolute;
    inset: 0 0 auto;
    height: ${EDITOR_TOP_BAR_HEIGHT}px;
    box-sizing: border-box;
    z-index: 10001;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: #121418;
    border-bottom: 1px solid #ffffff29;
}
.ghost-editor-tabs, .ghost-editor-actions { display: flex; align-items: center; gap: 4px; }
.ghost-editor-tabs { overflow-x: auto; scrollbar-width: thin; min-width: 0; }
.ghost-editor-actions { margin-left: auto; }
.ghost-editor-bar button, .ghost-editor-tools button, .ghost-editor-finder button {
    font: inherit;
    color: inherit;
    text-align: left;
    border: 1px solid transparent;
    border-radius: 4px;
    padding: 6px 8px;
    background: transparent;
    cursor: pointer;
}
.ghost-editor-bar button { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.ghost-editor-bar button:hover, .ghost-editor-tools button:hover, .ghost-editor-finder button:hover { background: #ffffff13; }
.ghost-editor-bar button[aria-pressed="true"], .ghost-editor-tools button[aria-current="true"],
.ghost-editor-finder button[data-highlighted="true"] { border-color: #5282b9; background: #274f88; }
.ghost-editor-bar .ghost-editor-help-button { border-color: #ffffff26; }
.ghost-editor-bar button[data-changed="true"] { color: #f7d88d; border-color: #8b7138; background: #3c321f; }
.ghost-editor-bar kbd { color: #b3c2d4; font-size: 11px; }
.ghost-editor-tools, .ghost-editor-dialog {
    border: 1px solid #ffffff26;
    border-radius: 6px;
    background: rgba(22,24,29,0.97);
    box-shadow: 0 8px 24px rgba(0,0,0,0.35);
}
.ghost-editor-tools {
    position: fixed;
    left: 12px;
    top: ${EDITOR_TOP_BAR_CLEARANCE};
    width: min(178px, 34vw);
    max-height: calc(100dvh - 114px);
    box-sizing: border-box;
    z-index: 10001;
    overflow: auto;
    padding: 5px;
}
.ghost-editor-tools section + section { margin-top: 9px; border-top: 1px solid #ffffff29; padding-top: 5px; }
.ghost-editor-tools h3 {
    margin: 2px 5px 4px;
    padding: 2px 4px 2px 7px;
    border-left: 2px solid #72839b;
    color: #b8c8dd;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.045em;
    text-transform: uppercase;
}
.ghost-editor-tools button { display: block; width: 100%; padding-left: 12px; }
[data-map-editor="ghost-help"] input {
    box-sizing: border-box; width: 100%; padding: 7px 9px;
    color: inherit; background: #111318; border: 1px solid #ffffff3b; border-radius: 4px; font: inherit;
}
.ghost-help-topics { margin-top: 8px; }
.ghost-help-topics details { border-top: 1px solid #ffffff26; }
.ghost-help-topics summary { padding: 8px 4px; font-weight: 600; cursor: pointer; }
.ghost-help-topics p { margin: 0 4px 11px; color: #cbd5e1; line-height: 1.55; }
.ghost-workspace-content:not(:empty) { border-top: 1px solid #ffffff26; margin: 5px 3px 0; padding: 4px 0; }
.ghost-workspace-content small { display: block; color: #a9b9ce; }
.ghost-editor-tools [aria-current="true"] { font-weight: 600; }
.ghost-editor-finder {
    position: fixed;
    inset: 0;
    z-index: 10020;
    display: grid;
    align-items: start;
    justify-items: center;
    background: rgba(8,10,14,0.65);
    padding: min(15vh, 100px) 12px 12px;
    box-sizing: border-box;
}
.ghost-editor-dialog { width: min(460px, 100%); padding: 10px; box-sizing: border-box; }
.ghost-editor-dialog header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.ghost-editor-dialog input {
    box-sizing: border-box;
    width: 100%;
    padding: 9px 10px;
    color: inherit;
    font: inherit;
    background: #111318;
    border: 1px solid #ffffff3b;
    border-radius: 4px;
}
.ghost-editor-results { margin-top: 6px; max-height: min(50vh, 430px); overflow: auto; }
.ghost-editor-results button { width: 100%; }
.ghost-editor-results small { display: block; color: #c5d3e6; }
.ghost-editor-results p { margin: 10px 8px; }
body.map-editor-ghost [data-ghost-classic-control] { display: none !important; }
body:not(.map-editor-ghost) [data-ghost-title] { display: none; }
body.map-editor-ghost [data-map-editor="settings"],
body.map-editor-ghost [data-map-editor="map-files"] {
    left: auto !important;
    right: 12px;
    top: ${EDITOR_TOP_BAR_CLEARANCE} !important;
    max-height: calc(100dvh - 117px);
    overflow-y: auto;
}
body.map-editor-ghost [data-map-editor="ghost-floor-controls"] :focus-visible {
    outline: 2px solid #60a5fa;
    outline-offset: 2px;
}
body.map-editor-ghost [data-map-editor="ghost-floor-controls"] button:is([aria-pressed="true"], [aria-expanded="true"]) {
    border-color: #5282b9 !important;
    background: #274f88 !important;
}
@media (max-width: 1120px) {
    body.map-editor-ghost [data-map-editor="tool-cue"] { bottom: 80px !important; }
}
@media (max-width: 900px) {
    .ghost-editor-tabs svg, .ghost-editor-bar kbd, .ghost-editor-actions .ghost-editor-history-text { display: none; }
}
@media (max-width: 630px) {
    .ghost-editor-bar { gap: 4px; padding-inline: 5px; }
    .ghost-editor-bar button { padding-inline: 5px; }
    .ghost-editor-actions .ghost-editor-action-text { display: none; }
}
@media (max-width: 380px) {
    body.map-editor-ghost [data-map-editor="tool-cue"] { bottom: 112px !important; }
}
`;

export class GhostEditorNavigation {
    private readonly style = document.createElement("style");
    private readonly bar = document.createElement("div");
    private readonly sidebar = document.createElement("nav");
    private readonly workspaceContent = document.createElement("div");
    private readonly finder = document.createElement("div");
    private readonly search = document.createElement("input");
    private readonly results = document.createElement("div");
    private readonly tabs: HTMLButtonElement[] = [];
    private readonly taskButtons = new Map<string, HTMLButtonElement>();
    private readonly actions: { workspace?: number; task: Task }[];
    private readonly reviewButton: HTMLButtonElement;
    private returnFocus?: HTMLElement;
    private workspace = 0;
    private activeId?: string;
    private highlighted = 0;
    private matches: typeof this.actions = [];
    private resultButtons: HTMLButtonElement[] = [];

    constructor(
        private readonly workspaces: Workspace[],
        undo: Action, redo: Action, settings: Action, review: Action, help: Action,
        icons: { undo: () => SVGElement; redo: () => SVGElement; settings: () => SVGElement;
            search: () => SVGElement; review: () => SVGElement },
        onWorkspaceChange: (label: string) => void,
        navigationTasks: Task[],
    ) {
        this.actions = [
            ...workspaces.flatMap(({ groups }, workspace) =>
                groups.flatMap(({ tasks }) => tasks.map((task) => ({ task, workspace })))),
            ...navigationTasks.map((task) => ({ task })),
        ];
        this.style.textContent = STYLES;
        this.bar.className = "ghost-editor-bar";
        this.bar.dataset.mapEditor = "ghost-top-bar";
        this.bar.setAttribute("role", "toolbar");
        this.bar.setAttribute("aria-label", "GhostUI workspaces");
        const tabs = document.createElement("div");
        tabs.className = "ghost-editor-tabs";
        workspaces.forEach(({ label, icon, open }, index) => {
            const button = this.button(label, () => {
                if (this.workspace !== index) {
                    this.showWorkspace(index);
                    onWorkspaceChange(label);
                }
                open?.();
            }, icon);
            this.tabs.push(button);
            tabs.append(button);
        });
        const right = document.createElement("div");
        right.className = "ghost-editor-actions";
        const find = this.button("Find a tool", () => this.openFinder(), icons.search, "ghost-editor-action-text");
        find.title = "Find a tool (Ctrl+K)";
        find.setAttribute("aria-keyshortcuts", "Control+K Meta+K");
        const shortcut = document.createElement("kbd");
        shortcut.textContent = "Ctrl+K";
        find.append(shortcut);
        const undoButton = this.button(undo.label, undo.run, icons.undo, "ghost-editor-history-text");
        undoButton.title = "Undo (Ctrl+Z)";
        const redoButton = this.button(redo.label, redo.run, icons.redo, "ghost-editor-history-text");
        redoButton.title = "Redo (Ctrl+Y)";
        this.reviewButton = this.button(review.label, review.run, icons.review, "ghost-editor-action-text");
        const settingsButton = this.button(settings.label, settings.run, icons.settings, "ghost-editor-action-text");
        const helpButton = this.button(help.label, help.run);
        helpButton.classList.add("ghost-editor-help-button");
        right.append(helpButton, find, undoButton, redoButton, this.reviewButton, settingsButton);
        this.bar.append(tabs, right);

        this.sidebar.className = "ghost-editor-tools";
        this.sidebar.dataset.mapEditor = "ghost-navigation";
        this.workspaceContent.className = "ghost-workspace-content";

        this.finder.className = "ghost-editor-finder";
        this.finder.dataset.mapEditor = "ghost-tool-finder";
        const dialog = document.createElement("section");
        dialog.className = "ghost-editor-dialog";
        dialog.setAttribute("role", "dialog");
        dialog.setAttribute("aria-modal", "true");
        dialog.setAttribute("aria-label", "Find a map tool");
        const header = document.createElement("header");
        const title = document.createElement("strong");
        title.textContent = "Find a tool";
        header.append(title, this.button("Close", () => this.closeFinder()));
        this.search.type = "search";
        this.search.setAttribute("aria-label", "Search map tools");
        this.search.placeholder = "Try flatten, trees, or jump";
        this.search.addEventListener("input", () => this.renderResults());
        this.results.className = "ghost-editor-results";
        dialog.append(header, this.search, this.results);
        this.finder.append(dialog);
        this.finder.addEventListener("click", (event) => { if (event.target === this.finder) this.closeFinder(); });
        this.finder.addEventListener("keydown", this.onFinderKey);
        for (const element of [this.bar, this.sidebar, this.finder]) {
            for (const type of ["mousedown", "keydown", "keyup", "click"]) {
                element.addEventListener(type, (event) => event.stopPropagation());
            }
        }

        this.setVisible(false);
        (document.querySelector(".game-viewport") ?? document.body).append(this.bar);
        document.body.append(this.style, this.sidebar, this.finder);
        window.addEventListener("keydown", this.onFinderShortcut, true);
        this.showWorkspace(0);
    }

    private button(label: string, run: () => void, icon?: () => SVGElement, labelClass = ""): HTMLButtonElement {
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("aria-label", label);
        button.title = label;
        const text = document.createElement("span");
        text.className = labelClass;
        text.textContent = label;
        if (icon) button.append(icon());
        button.append(text);
        button.onclick = run;
        return button;
    }

    private showWorkspace(index: number): void {
        this.workspace = index;
        this.tabs.forEach((tab, i) => tab.setAttribute("aria-pressed", String(index === i)));
        const { label, groups } = this.workspaces[index];
        this.sidebar.setAttribute("aria-label", `${label} tools`);
        this.sidebar.replaceChildren();
        this.taskButtons.clear();
        for (const [groupIndex, group] of groups.entries()) {
            if (!group.tasks.length) continue;
            const section = document.createElement("section");
            if (group.label) {
                const heading = document.createElement("h3");
                heading.textContent = group.label;
                heading.id = `ghost-tools-${index}-${groupIndex}`;
                section.setAttribute("aria-labelledby", heading.id);
                section.append(heading);
            }
            for (const task of group.tasks) {
                const button = this.button(task.label, task.run);
                button.title = task.description;
                this.taskButtons.set(task.id, button);
                section.append(button);
            }
            this.sidebar.append(section);
        }
        this.sidebar.append(this.workspaceContent);
        this.workspaceContent.replaceChildren();
        this.sidebar.scrollTop = 0;
        this.setActiveTask(this.activeId);
    }

    getWorkspace(): string {
        return this.workspaces[this.workspace].label;
    }

    revealTask(id: string): void {
        const entry = this.actions.find(({ task }) => task.id === id);
        if (entry?.workspace !== undefined && entry.workspace !== this.workspace) this.showWorkspace(entry.workspace);
    }

    setWorkspaceContent(content?: HTMLElement): void {
        this.workspaceContent.replaceChildren(...(content ? [content] : []));
    }

    setActiveTask(id?: string): void {
        this.activeId = id;
        for (const [task, button] of this.taskButtons) {
            button.setAttribute("aria-current", task === id ? "true" : "false");
        }
    }

    setChanged(changed: boolean): void {
        this.reviewButton.dataset.changed = String(changed);
        this.reviewButton.title = changed ? "Review unsaved changes" : "Review changes";
    }

    private openFinder(): void {
        this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
        this.finder.hidden = false;
        this.search.value = "";
        this.renderResults();
        this.search.focus();
    }

    private closeFinder(restoreFocus = true): void {
        if (this.finder.hidden) return;
        this.finder.hidden = true;
        if (restoreFocus) this.returnFocus?.focus({ preventScroll: true });
        this.returnFocus = undefined;
    }

    private runMatch(index: number): void {
        const match = this.matches[index];
        if (!match) return;
        this.closeFinder();
        if (match.workspace !== undefined && this.workspace !== match.workspace) this.showWorkspace(match.workspace);
        match.task.run();
    }

    private renderResults(): void {
        const terms = this.search.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
        this.matches = this.actions.filter(({ task, workspace }) => {
            const context = workspace === undefined ? "Navigation" : this.workspaces[workspace].label;
            const searchable = `${task.label} ${task.description} ${task.keywords ?? ""} ${context}`.toLowerCase();
            return terms.every((term) => searchable.includes(term));
        }).sort((a, b) => {
            const query = terms.join(" ");
            return Number(b.task.label.toLowerCase().startsWith(query)) - Number(a.task.label.toLowerCase().startsWith(query));
        });
        this.results.replaceChildren();
        this.resultButtons = this.matches.map(({ task, workspace }, index) => {
            const button = this.button(task.label, () => this.runMatch(index));
            const context = document.createElement("small");
            const workspaceLabel = workspace === undefined ? "Navigation" : this.workspaces[workspace].label;
            context.textContent = `${workspaceLabel} · ${task.description}`;
            button.append(context);
            this.results.append(button);
            return button;
        });
        if (!this.matches.length) {
            const empty = document.createElement("p");
            empty.textContent = "No matching tools.";
            this.results.append(empty);
        }
        this.highlight(0);
    }

    private highlight(index: number): void {
        this.highlighted = index;
        this.resultButtons.forEach((button, i) => { button.dataset.highlighted = String(i === index); });
    }

    private readonly onFinderKey = (event: KeyboardEvent): void => {
        if (event.key === "Escape") {
            event.preventDefault();
            this.closeFinder();
        } else if (event.target === this.search && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            const next = this.highlighted + (event.key === "ArrowDown" ? 1 : -1);
            this.highlight(Math.max(0, Math.min(this.matches.length - 1, next)));
            this.resultButtons[this.highlighted]?.scrollIntoView?.({ block: "nearest" });
        } else if (event.target === this.search && event.key === "Enter") {
            event.preventDefault();
            this.runMatch(this.highlighted);
        } else if (event.key === "Tab") {
            const focusable = [...this.finder.querySelectorAll<HTMLElement>("input, button")];
            const boundary = event.shiftKey ? focusable[0] : focusable.at(-1);
            if (event.target === boundary) {
                event.preventDefault();
                (event.shiftKey ? focusable.at(-1) : focusable[0])?.focus();
            }
        }
    };

    private readonly onFinderShortcut = (event: KeyboardEvent): void => {
        if (this.bar.hidden || event.defaultPrevented || !(event.ctrlKey || event.metaKey) ||
            event.altKey || event.key.toLowerCase() !== "k") return;
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        if (this.finder.hidden) this.openFinder();
        else this.closeFinder();
    };

    setVisible(visible: boolean): void {
        this.bar.hidden = !visible;
        this.sidebar.hidden = !visible;
        if (!visible) {
            this.closeFinder(false);
            this.finder.hidden = true;
        }
    }

    remove(): void {
        window.removeEventListener("keydown", this.onFinderShortcut, true);
        this.style.remove();
        this.bar.remove();
        this.sidebar.remove();
        this.finder.remove();
    }
}
