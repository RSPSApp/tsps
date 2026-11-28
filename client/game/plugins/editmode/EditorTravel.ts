import type { EditModePlugin } from "./EditModePlugin";
import { parseEditorLocation } from "./EditorCoordinates";
import type { EditModeSelection, EditModeTile } from "./types";

type Coordinate = [number, number, number];
type WarpAddress = { id: number; op: number; from: Coordinate };
type WarpSource = WarpAddress & { actionLabel?: string };
type ObjectAddress = { id: number; at: Coordinate };
type Destination = { label: string; to: Coordinate; beside?: ObjectAddress };
type TravelStep = "action" | "destination" | "return" | "review";
type Warp = WarpSource & { destinations: Destination[]; returnLink?: WarpAddress };
type GameWarp = Warp & { name?: string; conditional?: boolean; mapDerived?: boolean };
type MakeButton = (text: string, title: string, onClick: () => void) => HTMLButtonElement;

const keyOf = ({ id, op, from }: WarpAddress) => `${id}:${op}:${from.join(",")}`;
const addressOf = ({ id, op, from }: WarpAddress) => ({ id, op, from });
const textOf = (position: Coordinate) => position.join(", ");
const toEditorTile = ([tileX, tileY, plane]: Coordinate) => ({ tileX, tileY, plane });
const coordinates = ({ tileX, tileY, plane }: EditModeTile): Coordinate => [tileX, tileY, plane];
const STEPS = [["action", "Action"], ["destination", "Destination"], ["return", "Return"], ["review", "Review"]] as const;
const ACTIONS = ["Enter", "Climb down", "Climb up", "Go through", "Open", "Leave", "Return"];
const isLabel = (text: string, max: number) => !!text.trim() && text.trim().length <= max && !/[<>\x00-\x1f]/.test(text);

export class EditorTravel {
    private overrides = new Map<string, Warp>();
    private vanilla: GameWarp[] = [];
    private body?: HTMLElement;
    private nearby?: HTMLElement;
    private nearbyResults?: HTMLElement;
    private nearbySearch = "";
    private browseAt?: EditModeTile;
    private source?: WarpSource;
    private returnTo?: WarpSource;
    private sourceObject?: EditModeSelection;
    private objectRoutes: GameWarp[] = [];
    private objectRequest = 0;
    private resolvingObject = false;
    private objectError = "";
    private step: TravelStep = "action";
    private actionLabel = "";
    private pending: Destination[] = [];
    private name = "";
    private loaded = false;
    private saved = "[]";
    private loading?: Promise<void>;
    private edited = false;

    constructor(
        private readonly plugin: EditModePlugin,
        private readonly button: MakeButton,
        private readonly inputStyle: Partial<CSSStyleDeclaration>,
        private readonly onChange: () => void,
        private readonly notify: (message: string) => void,
    ) {}

    get dirty(): boolean {
        return this.edited;
    }

    contents(): string {
        return JSON.stringify([...this.overrides.values()], null, 2) + "\n";
    }

    savedContents(): string {
        return this.saved;
    }

    markSaved(): void {
        this.edited = false;
        this.saved = this.contents();
    }

    detach(): void {
        this.objectRequest++;
        this.body = undefined;
        this.nearby = undefined;
        this.nearbyResults = undefined;
        this.plugin.showTravelMarkers([], []);
    }

    refresh(): void {
        if (!this.loaded || this.edited) return;
        void this.load(true);
    }

    load(refresh = false): Promise<void> {
        if (this.loaded && !refresh) return Promise.resolve();
        this.loading ??= Promise.all([this.plugin.loadTravel("map-warps"), this.plugin.loadTravel("game-warps")])
            .then(([custom, vanilla]) => {
                if (this.edited) return;
                if (!Array.isArray(custom) || !Array.isArray(vanilla)) throw new Error("The server returned invalid travel data");
                this.overrides = new Map((custom as Warp[]).map((warp) => [keyOf(warp), warp]));
                this.saved = this.contents();
                this.vanilla = vanilla as GameWarp[];
                this.loaded = true;
                if (this.sourceObject) this.useObject(this.sourceObject);
                else if (this.source) this.useSource(this.source);
                else this.render();
            }).catch((error) => {
                if (this.body?.isConnected) {
                    this.body.textContent = "Travel links could not load. Refresh to try again.";
                    this.notify(error instanceof Error ? error.message : String(error));
                }
            }).finally(() => { this.loading = undefined; });
        return this.loading;
    }

    hasObject(object: EditModeSelection): boolean {
        return this.sourcesFor(object).length > 0;
    }

    get changedSources(): readonly EditModeTile[] {
        if (!this.edited) return [];
        const previous = new Map((JSON.parse(this.saved) as Warp[]).map((warp) => [keyOf(warp), warp]));
        const changed = new Map<string, EditModeTile>();
        for (const [key, warp] of this.overrides) {
            if (JSON.stringify(warp) !== JSON.stringify(previous.get(key))) changed.set(key, toEditorTile(warp.from));
            previous.delete(key);
        }
        for (const [key, warp] of previous) changed.set(key, toEditorTile(warp.from));
        return [...new Map([...changed.values()].map((tile) => [`${tile.tileX}:${tile.tileY}:${tile.plane}`, tile])).values()];
    }

    attach(panel: HTMLElement, from?: EditModeSelection, nearby?: HTMLElement): void {
        this.body = document.createElement("div");
        this.browseAt = this.plugin.getCameraTile();
        this.nearby = nearby;
        this.nearbyResults = undefined;
        Object.assign(this.body.style, { display: "grid", gap: "7px" });
        panel.appendChild(this.body);
        this.source = undefined;
        this.sourceObject = undefined;
        if (from?.kind === "loc") this.useObject(from);
        else this.render();
        void this.load();
    }

    browse(): void {
        this.objectRequest++;
        this.sourceObject = undefined;
        this.source = undefined;
        this.browseAt = this.plugin.getCameraTile();
        this.nearbySearch = "";
        this.nearbyResults = undefined;
        this.render();
        void this.load();
    }

    pickSource(): void {
        this.plugin.pickTile((_tile, object) => {
            if (!object) return this.notify("Click the object model you want to use as the entrance.");
            this.browseAt = object;
            this.nearbySearch = "";
            this.nearbyResults = undefined;
            this.useObject(object);
        }, "Click any object to use it as the entrance", true);
    }

    private sourcesFor(object: EditModeSelection): GameWarp[] {
        const matches = ({ id, from }: WarpSource) => id === object.locId &&
            from[0] === object.tileX && from[1] === object.tileY && from[2] === object.plane;
        const original = [...this.vanilla, ...this.objectRoutes.filter(route => !this.vanilla.some(warp => keyOf(warp) === keyOf(route)))].filter(matches);
        return [
            ...[...this.overrides.values()].filter(matches),
            ...original.filter((warp) => !this.overrides.has(keyOf(warp))),
        ];
    }

    private originalSource(source: WarpAddress): GameWarp | undefined {
        const key = keyOf(source);
        return this.vanilla.find(warp => keyOf(warp) === key) ?? this.objectRoutes.find(warp => keyOf(warp) === key);
    }

    private optionName(source: WarpAddress): string | undefined {
        const custom = this.overrides.get(keyOf(source));
        const vanilla = this.originalSource(source);
        return custom?.actionLabel ?? this.plugin.getLocActions(source.id)[source.op - 1] ??
            (custom ? "Custom travel link" : vanilla ? "Game travel link" : undefined);
    }

    private freeOption(id: number, from: Coordinate): number | undefined {
        for (let op = 1; op <= 5; op++) {
            if (!this.optionName({ id, op, from })) return op;
        }
    }

    private objectName(id: number, hint?: string): string {
        const name = hint && hint !== "null" ? hint : this.plugin.getLocName(id);
        return name && name !== "null" ? name : `Scenery #${id}`;
    }

    useObject(object: EditModeSelection): void {
        this.source = undefined;
        this.sourceObject = object;
        this.objectRoutes = [];
        this.pending = [];
        this.name = this.objectName(object.locId, object.locName);
        this.resolvingObject = true;
        this.objectError = "";
        const request = ++this.objectRequest;
        this.render();
        void this.plugin.loadObjectTravel(object).then(routes => {
            if (request !== this.objectRequest) return;
            if (!Array.isArray(routes)) throw new Error("Invalid object travel data");
            this.objectRoutes = routes as GameWarp[];
        }).catch(() => {
            if (request === this.objectRequest) this.objectError = "Game destinations could not be loaded. You can still edit or add a travel action.";
        }).finally(() => {
            if (request !== this.objectRequest) return;
            this.resolvingObject = false;
            this.render();
        });
    }

    private renderObject(body: HTMLElement, object: EditModeSelection): void {
        const title = document.createElement("strong");
        title.textContent = this.name;
        body.append(title, this.help(textOf(coordinates(object))));
        const routes = this.sourcesFor(object);
        const actions = new Map<number, string>();
        this.plugin.getLocActions(object.locId).forEach((label, index) => { if (label) actions.set(index + 1, label); });
        routes.forEach(route => actions.set(route.op, route.actionLabel ?? this.optionName(route) ?? "Travel"));
        if (this.resolvingObject) body.append(this.help("Finding game destinations…"));
        if (this.objectError) body.append(this.help(this.objectError));
        for (const [op, label] of [...actions].sort(([a], [b]) => a - b)) {
            const row = document.createElement("section");
            Object.assign(row.style, { display: "grid", gap: "5px", borderTop: "1px solid #666", paddingTop: "8px" });
            const heading = document.createElement("strong");
            heading.textContent = label;
            row.append(heading);
            const route = routes.find(route => route.op === op);
            if (route?.destinations.length) {
                for (const destination of route.destinations) {
                    const output = document.createElement("output");
                    output.setAttribute("aria-label", `${label} destination`);
                    output.value = `${destination.label} · ${textOf(destination.to)}`;
                    row.append(output, this.button("Go to destination", `Go to ${label} destination at ${textOf(destination.to)}`, () => this.goTo(destination.to)));
                }
                if (route.mapDerived) row.append(this.help("Map-derived game destination; the landing tile can vary with the approach."));
                if (route.conditional) row.append(this.help("Game requirements and confirmation still apply."));
            } else row.append(this.help("No travel destination available for this action."));
            const change = this.button("Change destination", `Change destination for ${label}`, () => {
                this.useSource({ id: object.locId, op, from: coordinates(object) }, object);
                this.moveTo("destination");
            });
            change.disabled = this.resolvingObject;
            row.append(change);
            body.append(row);
        }
        if (!actions.size) body.append(this.help("This object has no menu actions."));
        const free = this.freeOption(object.locId, coordinates(object));
        const add = this.button("Add travel action", "Add a travel action to this object", () => {
            if (free !== undefined) this.useSource({ id: object.locId, op: free, from: coordinates(object) }, object);
        });
        add.disabled = free === undefined || this.resolvingObject;
        body.append(add);
        if (free === undefined) body.append(this.help("All five menu slots are in use. Choose an existing action to change its destination."));
        body.append(this.button("Browse nearby links", "Return to the travel link list", () => this.browse()));
    }

    private renderNearby(root: HTMLElement): void {
        if (!this.nearby || !this.nearbyResults) {
            root.replaceChildren();
            if (this.nearby) {
                const heading = document.createElement("h3");
                heading.textContent = "Travel links";
                const search = document.createElement("input");
                search.type = "search";
                search.placeholder = "Find a link";
                search.setAttribute("aria-label", "Find travel links");
                search.value = this.nearbySearch;
                Object.assign(search.style, this.inputStyle, { height: "28px", padding: "3px 6px" });
                search.oninput = () => {
                    this.nearbySearch = search.value;
                    this.renderNearby(root);
                };
                this.nearbyResults = document.createElement("div");
                root.append(heading, search, this.nearbyResults);
            }
        }
        const list = this.nearbyResults ?? root;
        list.replaceChildren();
        if (!this.loaded) {
            list.append("Loading travel links…");
            return;
        }
        const nearby = this.browseAt ?? this.plugin.getCameraTile();
        if (!nearby) return;
        const distance = ({ from }: WarpSource) => Math.hypot(from[0] - nearby.tileX, from[1] - nearby.tileY);
        const name = (warp: GameWarp) => {
            const label = this.plugin.getLocName(warp.id);
            if (label && label !== "null") return label;
            return warp.name?.replace(/^\d+_/, "").replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase()) ||
                `Object ${warp.id}`;
        };
        const shown: GameWarp[] = [...this.overrides.values(), ...this.vanilla.filter((warp) => !this.overrides.has(keyOf(warp)))];
        const query = this.nearbySearch.trim().toLowerCase();
        const closest = shown.filter((warp) => query
            ? `${name(warp)} ${warp.actionLabel ?? ""} ${warp.name?.replace(/_/g, " ") ?? ""} ${textOf(warp.from)} ${warp.destinations.map(({ label }) => label).join(" ")}`.toLowerCase().includes(query)
            : warp.from[2] === nearby.plane && distance(warp) <= 128)
            .sort((a, b) => distance(a) - distance(b)).slice(0, 12);
        if (!this.source) this.plugin.showTravelMarkers(closest.map(({ from }) => toEditorTile(from)), []);
        if (!closest.length) list.append(query ? "No matching links." : "No links within 128 tiles.");
        for (const warp of closest) {
            const label = name(warp);
            const row = this.button(label, `Go to ${label} at ${textOf(warp.from)}`, () => {
                this.plugin.goToLocation(textOf(warp.from));
                this.browseAt = toEditorTile(warp.from);
                this.name = label;
                this.useSource(warp);
            });
            const position = document.createElement("small");
            position.textContent = warp.actionLabel ? `${warp.actionLabel} · ${textOf(warp.from)}` : textOf(warp.from);
            Object.assign(row.style, { whiteSpace: "normal", overflowWrap: "anywhere", width: "100%", textAlign: "left" });
            position.style.display = "block";
            row.append(position);
            row.setAttribute("aria-current", String(!!this.source && keyOf(warp) === keyOf(this.source)));
            list.append(row);
        }
    }

    private pairedWarp(warp?: Warp): Warp | undefined {
        if (!warp?.returnLink) return;
        const other = this.overrides.get(keyOf(warp.returnLink));
        return other?.returnLink && keyOf(other.returnLink) === keyOf(warp) ? other : undefined;
    }

    private useSource(source: WarpAddress, object?: EditModeSelection): void {
        this.source = addressOf(source);
        this.sourceObject = object;
        const saved = this.overrides.get(keyOf(source));
        const original = this.originalSource(source);
        const paired = this.pairedWarp(saved);
        this.returnTo = paired && { ...addressOf(paired), actionLabel: paired.actionLabel ?? this.optionName(paired) ?? "Return" };
        this.pending = (saved ?? original)?.destinations.map((destination) => ({ ...destination })) ?? [];
        this.actionLabel = this.optionName(source) ?? "Enter";
        this.step = this.pending.length ? "review" : "action";
        this.render();
    }

    private field(label: string, control: HTMLInputElement | HTMLSelectElement): HTMLLabelElement {
        const field = document.createElement("label");
        Object.assign(field.style, { display: "grid", gap: "3px", minWidth: "0" });
        Object.assign(control.style, this.inputStyle, { minWidth: "0" });
        field.append(label, control);
        return field;
    }

    private help(text: string): HTMLElement {
        const help = document.createElement("div");
        help.textContent = text;
        help.style.color = "#b7c6d9";
        return help;
    }

    private row(...elements: HTMLElement[]): HTMLElement {
        const row = document.createElement("div");
        Object.assign(row.style, { display: "flex", flexWrap: "wrap", gap: "5px" });
        row.append(...elements);
        return row;
    }

    private moveTo(step: TravelStep): void {
        if (this.body?.querySelector('[aria-invalid="true"]')) return this.notify("Enter valid destination coordinates before continuing.");
        if (!isLabel(this.actionLabel, 40)) return this.notify("Enter a plain text menu action of up to 40 characters.");
        if ((step === "return" || step === "review") && (!this.pending.length || this.pending.some(({ label }) => !isLabel(label, 60)))) {
            return this.notify("Choose a tile or object and name each destination.");
        }
        this.step = step;
        this.render();
    }

    private render(): void {
        const body = this.body;
        if (!body?.isConnected) return;
        body.replaceChildren();
        if (this.nearby) {
            this.nearby.hidden = !!this.source || !!this.sourceObject;
            if (this.nearby.hidden) {
                this.nearby.replaceChildren();
                this.nearbyResults = undefined;
            } else this.renderNearby(this.nearby);
        } else if (!this.source && !this.sourceObject) body.append(this.button("Pick source object", "Click any object to use it as the entrance", () => this.pickSource()));
        const source = this.source;
        if (!this.loaded) {
            body.append(this.help("Loading travel links…"));
            return;
        }
        if (!source && this.sourceObject) {
            this.plugin.showTravelMarkers([this.sourceObject], this.sourcesFor(this.sourceObject).flatMap(route => route.destinations.map(destination => toEditorTile(destination.to))));
            this.renderObject(body, this.sourceObject);
            return;
        }
        if (!source) {
            if (this.nearby) body.append(this.help("Pick a source object to create a link, or choose an existing link on the left."));
            else {
                const list = document.createElement("div");
                Object.assign(list.style, { display: "grid", gap: "4px" });
                body.append(list);
                this.renderNearby(list);
            }
            return;
        }
        this.plugin.showTravelMarkers([toEditorTile(source.from)], this.pending.map(({ to }) => toEditorTile(to)));
        const title = document.createElement("strong");
        title.textContent = this.name;
        body.append(title, this.button(textOf(source.from), "Go to the source object", () => this.goTo(source.from)));
        const steps = this.row(...STEPS.map(([step, label], index) => {
            const button = this.button(`${index + 1}. ${label}`, label, () => this.moveTo(step));
            button.setAttribute("aria-current", step === this.step ? "step" : "false");
            button.disabled = (step === "review" || step === "return") && !this.pending.length;
            if (step === this.step) button.style.borderColor = "#60a5fa";
            return button;
        }));
        steps.setAttribute("role", "group");
        steps.setAttribute("aria-label", "Travel link steps");
        body.append(steps);
        if (this.step === "action") this.renderAction(body, source);
        else if (this.step === "destination") this.renderDestinations(body, source);
        else if (this.step === "return") this.renderReturn(body);
        else this.renderReview(body, source);
        if (this.sourceObject) body.append(this.button("Back to object actions", "Back to object actions", () => {
            this.source = undefined;
            this.render();
        }));
        body.append(this.button("Browse nearby links", "Return to the travel link list", () => this.browse()));
    }

    private goTo(at: Coordinate): void {
        this.plugin.goToLocation(textOf(at));
        this.browseAt = toEditorTile(at);
        this.nearbySearch = "";
        this.nearbyResults = undefined;
        this.render();
    }

    private optionField(source: WarpSource): HTMLSelectElement {
        const select = document.createElement("select");
        for (let op = 1; op <= 5; op++) {
            const current = this.optionName({ ...source, op });
            select.add(new window.Option(current ? `Option ${op}: ${current}` : `Option ${op}: empty`, String(op)));
        }
        select.value = String(source.op);
        return select;
    }

    private actionInput(value: string, update: (text: string) => void): HTMLInputElement {
        const input = document.createElement("input");
        input.value = value;
        input.maxLength = 40;
        input.placeholder = "e.g. Enter";
        input.oninput = () => update(input.value);
        return input;
    }

    private renderAction(body: HTMLElement, source: WarpSource): void {
        const name = this.actionInput(this.actionLabel, (text) => { this.actionLabel = text; });
        const select = this.optionField(source);
        select.setAttribute("aria-label", "Source object option");
        select.onchange = () => {
            const changed = { ...source, op: Number(select.value) };
            const saved = this.overrides.get(keyOf(changed)) ?? this.vanilla.find((warp) => keyOf(warp) === keyOf(changed));
            if (saved) this.useSource(saved, this.sourceObject);
            else {
                this.source = changed;
                this.render();
            }
        };
        const advanced = document.createElement("details");
        const title = document.createElement("summary");
        title.textContent = "Menu slot";
        advanced.append(title, this.field("Object menu option", select), this.help("An empty slot adds an action. An occupied slot replaces that action here."));
        const occupied = this.optionName(source);
        body.append(this.field("Menu action text", name), this.row(...ACTIONS.map((label) =>
            this.button(label, `Use action text ${label}`, () => { this.actionLabel = name.value = label; }))), advanced,
        this.help(occupied ? `This edits “${occupied}” on this object.` : "This adds a new menu action to this object."),
        this.button("Choose destination", "Continue to destination", () => this.moveTo("destination")));
    }

    private addDestination(source: WarpSource, tile: EditModeTile, object?: EditModeSelection): void {
        const arrival = coordinates(object ? this.plugin.arrivalBeside(object, tile) : tile);
        if (textOf(arrival) === textOf(source.from) || (object && object.locId === source.id && textOf(coordinates(object)) === textOf(source.from))) {
            this.notify("Choose a different arrival point.");
            return;
        }
        if (this.pending.length >= 4) return;
        const label = object ? this.objectName(object.locId, object.locName) : `Destination ${this.pending.length + 1}`;
        this.pending.push({ label, to: arrival, ...(object ? { beside: { id: object.locId, at: coordinates(object) } } : {}) });
        this.render();
    }

    private renderDestinations(body: HTMLElement, source: WarpSource): void {
        this.pending.forEach((destination, index) => {
            const name = document.createElement("input");
            name.value = destination.label;
            name.maxLength = 60;
            name.oninput = () => { destination.label = name.value; };
            const position = document.createElement("input");
            position.value = textOf(destination.to);
            position.oninput = () => {
                const at = parseEditorLocation(position.value);
                const valid = !!at && /[,\s]/.test(position.value.trim());
                position.setAttribute("aria-invalid", String(!valid));
                if (valid) { destination.to = [at.tileX, at.tileY, at.plane ?? source.from[2]]; delete destination.beside; }
            };
            body.append(this.field(`Destination ${index + 1} name`, name),
                this.field(`Destination ${index + 1} coordinates`, position), this.row(
                this.button("Go to arrival", "Move the camera to this arrival tile", () => this.goTo(destination.to)),
                this.button("Remove destination", "Remove this destination", () => {
                    this.pending.splice(index, 1);
                    this.render();
                }),
            ));
        });
        if (this.pending.length < 4) {
            const input = document.createElement("input");
            input.placeholder = "x, y, floor";
            const manual = document.createElement("details");
            const summary = document.createElement("summary");
            summary.textContent = "Enter coordinates";
            const add = () => {
                const parsed = /[,\s]/.test(input.value.trim()) ? parseEditorLocation(input.value) : undefined;
                if (!parsed) return this.notify("Enter x, y, and the floor number.");
                this.addDestination(source, { ...parsed, plane: parsed.plane ?? this.plugin.getConfig().heightLevel });
            };
            input.onkeydown = (event) => {
                if (event.key === "Enter") { event.preventDefault(); add(); }
            };
            manual.append(summary, this.field("Arrival coordinates", input), this.button("Add arrival", "Add these coordinates", add));
            body.append(this.row(
                this.button("Pick a tile", "Pick an arrival tile", () =>
                    this.plugin.pickTile((at) => this.addDestination(source, at), "Click where players should land")),
                this.button("Pick an object", "Pick an arrival object", () =>
                    this.plugin.pickTile((at, object) => {
                        if (object) this.addDestination(source, at, object);
                        else this.notify("Click a scenery object to land beside it.");
                    }, "Click the object players should land beside", true)),
                this.button("Open world map", "Move to the destination area", () => this.plugin.toggleWorldMap({ mode: "navigate" })),
            ), manual);
        }
        body.append(this.row(
            this.button("Back", "Back to action", () => this.moveTo("action")),
            this.button("Continue", "Continue to return link", () => this.moveTo("return")),
        ));
    }

    private chooseReturn(id: number, from: Coordinate): void {
        const source = this.source;
        if (!source || (id === source.id && textOf(from) === textOf(source.from))) {
            this.notify("Choose a different object for the return link.");
            return;
        }
        const op = this.freeOption(id, from) ?? 1;
        this.returnTo = { id, op, from, actionLabel: this.returnTo?.actionLabel ??
            (/^climb[- ]down$/i.test(this.actionLabel) ? "Climb up" : "Return") };
        this.render();
    }

    private renderReturn(body: HTMLElement): void {
        const back = this.returnTo;
        if (!back) {
            body.append(this.help("Make this two-way by choosing the object players will use to return."));
            const candidate = this.pending.length === 1 ? this.pending[0].beside : undefined;
            if (candidate) body.append(this.button(`Return from ${this.objectName(candidate.id)}`,
                "Use the arrival object as the way back", () => this.chooseReturn(candidate.id, candidate.at)));
        } else {
            body.append(this.help(`Return link starts at ${this.objectName(back.id)} · ${textOf(back.from)}`));
            const name = this.actionInput(back.actionLabel ?? "Return", (value) => { back.actionLabel = value; });
            const slots = this.optionField(back);
            slots.onchange = () => { back.op = Number(slots.value); this.render(); };
            const advanced = document.createElement("details");
            const title = document.createElement("summary");
            title.textContent = "Return menu slot";
            advanced.append(title, this.field("Return object menu option", slots));
            body.append(this.field("Return action text", name), advanced,
                this.button("Remove return link", "Make this route one-way", () => { this.returnTo = undefined; this.render(); }));
        }
        body.append(this.row(this.button(back ? "Change return object" : "Pick return object", "Pick an object for the way back", () =>
            this.plugin.pickTile((_at, object) => {
                if (object) this.chooseReturn(object.locId, coordinates(object));
                else this.notify("Click an object to use for the return link.");
            }, "Click the object players should use for the return trip", true)),
        this.button("Open world map", "Move to the return object’s area", () => this.plugin.toggleWorldMap({ mode: "navigate" }))));
        body.append(this.row(
            this.button("Back", "Back to destination", () => this.moveTo("destination")),
            this.button(back ? "Review link" : "Keep one-way", "Continue to review", () => this.moveTo("review")),
        ));
    }

    private renderReview(body: HTMLElement, source: WarpSource): void {
        const original = this.originalSource(source);
        const existing = this.overrides.get(keyOf(source));
        body.append(this.help(`${this.actionLabel} · ${this.returnTo ? "Two-way" : "One-way"}`));
        // Show destinations here so an existing link can be inspected or followed without walking through the wizard.
        this.pending.forEach((destination, index) => {
            const at = document.createElement("output");
            at.setAttribute("aria-label", `Destination ${index + 1} coordinates`);
            at.value = textOf(destination.to);
            body.append(this.help(destination.beside
                ? `${destination.label} · Beside ${this.objectName(destination.beside.id)}` : destination.label), at,
                this.button("Go to arrival", "Move the camera to this arrival tile", () => this.goTo(destination.to)));
        });
        const back = this.returnTo;
        if (back) {
            body.append(this.help(`“${back.actionLabel}” at ${this.objectName(back.id)} returns here.`),
                this.button(textOf(back.from), "Go to return object", () => this.goTo(back.from)));
        }
        const pair = this.pairedWarp(existing);
        const replace = this.optionName(source);
        if (!existing && replace && replace !== this.actionLabel.trim()) body.append(this.help(`This replaces “${replace}” at the entrance.`));
        const replaceReturn = back && (!pair || keyOf(pair) !== keyOf(back)) && this.optionName(back);
        if (replaceReturn) body.append(this.help(`This replaces “${replaceReturn}” at the return object.`));
        if (original?.conditional) body.append(this.help("This action keeps its game requirements and confirmation."));
        body.append(this.button("Stage travel link", "Include this link in the next map save", () => {
            const destinations = this.pending.map((destination) => ({ ...destination, label: destination.label.trim() }));
            const returnTo = this.returnTo;
            if (!isLabel(this.actionLabel, 40) || !destinations.length || destinations.some(({ label, to }) =>
                !isLabel(label, 60) || textOf(to) === textOf(source.from)) ||
                (returnTo && !isLabel(returnTo.actionLabel ?? "", 40))) {
                return this.notify("Check both action names and make sure the arrival tiles differ from the entrance.");
            }
            if (pair && (!returnTo || keyOf(returnTo) !== keyOf(pair))) this.overrides.delete(keyOf(pair));
            this.overrides.set(keyOf(source), { ...addressOf(source), actionLabel: this.actionLabel.trim(), destinations,
                ...(returnTo ? { returnLink: addressOf(returnTo) } : {}),
            });
            if (returnTo) {
                const entrance = { ...(this.sourceObject ?? toEditorTile(source.from)), locId: source.id, locName: this.name };
                const to = coordinates(this.plugin.arrivalBeside(entrance));
                const previous = this.pairedWarp(this.overrides.get(keyOf(returnTo)));
                if (previous && keyOf(previous) !== keyOf(source)) this.overrides.delete(keyOf(previous));
                this.overrides.set(keyOf(returnTo), { ...addressOf(returnTo), actionLabel: returnTo.actionLabel!.trim(),
                    destinations: pair && keyOf(pair) === keyOf(returnTo) ? pair.destinations
                        : [{ label: "Return", to, beside: { id: source.id, at: source.from } }],
                    returnLink: addressOf(source),
                });
            }
            this.edited = true;
            this.onChange();
            this.notify("Travel link staged. Save changes to keep it.");
            this.render();
        }));
        const free = this.freeOption(source.id, source.from);
        if ((existing || original) && free !== undefined) body.append(this.button("Add another action", "Add a travel action to an empty menu slot",
            () => this.useSource({ ...source, op: free }, this.sourceObject)));
        if (existing) body.append(this.button("Restore original action", "Remove the custom destination", () => {
            this.overrides.delete(keyOf(source));
            if (pair) this.overrides.delete(keyOf(pair));
            this.edited = true;
            this.onChange();
            this.useSource(source, this.sourceObject);
        }));
    }
}
