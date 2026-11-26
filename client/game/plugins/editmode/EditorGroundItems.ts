import type { EditModePlugin } from "./EditModePlugin";

export type GroundItemPlacement = {
    id: number;
    location: { x: number; y: number; z: number };
    amt: number;
    respawn: number;
    members?: boolean;
};

type MakeButton = (text: string, title: string, onClick: () => void) => HTMLButtonElement;

export class EditorGroundItems {
    private items: GroundItemPlacement[] = [];
    private loaded = false;
    private saved = "[]";
    private loading?: Promise<void>;
    private body?: HTMLElement;
    private selection?: { id: number; name: string };
    private amount = 1;
    private timer = 0;
    private edited = false;

    constructor(
        private readonly plugin: EditModePlugin,
        private readonly button: MakeButton,
        private readonly style: Partial<CSSStyleDeclaration>,
        private readonly onChange: () => void,
        private readonly notify: (message: string) => void,
    ) {}

    get dirty(): boolean {
        return this.edited;
    }

    get changedTiles() {
        if (!this.edited) return [];
        const itemKey = (item: GroundItemPlacement) =>
            `${item.id}:${item.location.x}:${item.location.y}:${item.location.z}`;
        const previous = new Map((JSON.parse(this.saved) as GroundItemPlacement[]).map((item) => [itemKey(item), item]));
        const changed = this.items.filter((item) => {
            const key = itemKey(item);
            const before = previous.get(key);
            previous.delete(key);
            return JSON.stringify(before) !== JSON.stringify(item);
        });
        const tiles = new Map([...changed, ...previous.values()].map(({ location: { x, y, z } }) =>
            [`${x}:${y}:${z}`, { tileX: x, tileY: y, plane: z }]));
        return [...tiles.values()];
    }

    contents(): string {
        return JSON.stringify(this.items, null, 2) + "\n";
    }

    savedContents(): string {
        return this.saved;
    }

    markSaved(): void {
        this.edited = false;
        this.saved = this.contents();
    }

    attach(panel: HTMLElement, itemId?: number): void {
        this.body = document.createElement("div");
        Object.assign(this.body.style, { display: "grid", gap: "7px" });
        panel.append(this.body);
        if (itemId !== undefined) this.useItem(itemId);
        else this.render();
        void this.ensureLoaded();
    }

    refresh(): void {
        if (!this.loaded || this.edited) return;
        void this.ensureLoaded(true);
    }

    ensureLoaded(refresh = false): Promise<void> {
        if (this.loaded && !refresh) return Promise.resolve();
        this.loading ??= this.plugin.loadGroundItems().then((items) => {
            if (this.edited) return;
            if (!Array.isArray(items)) throw new Error("The server returned invalid ground items");
            this.items = items as GroundItemPlacement[];
            this.saved = this.contents();
            this.loaded = true;
            if (this.body?.isConnected) this.plugin.previewGroundItems(this.items);
            this.render();
        }).catch((error) => {
            this.notify(error instanceof Error ? error.message : String(error));
            this.render();
        }).finally(() => { this.loading = undefined; });
        return this.loading;
    }

    resumePreview(): void {
        if (this.loaded) this.plugin.previewGroundItems(this.items);
    }

    capture(minX: number, minY: number, width: number, height: number) {
        return this.items.flatMap(({ location, ...item }) => location.x >= minX && location.x < minX + width &&
            location.y >= minY && location.y < minY + height
            ? [{ ...item, x: location.x - minX, y: location.y - minY, plane: location.z }] : []);
    }

    stamp(items: readonly GroundItemPlacement[]): { undo: () => void; redo: () => void } {
        if (!this.loaded) throw new Error("Wait for the world’s ground-item file before stamping item spawns");
        const key = (item: GroundItemPlacement) => `${item.id}:${item.location.x}:${item.location.y}:${item.location.z}`;
        const changes = new Map(items.map((item) => [key(item), item]));
        const originals = this.items.filter((item) => changes.has(key(item)));
        const replace = (entries: readonly GroundItemPlacement[]) => {
            this.items = this.items.filter((item) => !changes.has(key(item))).concat(entries);
            this.changed();
        };
        return { undo: () => replace(originals), redo: () => replace([...changes.values()]) };
    }

    useItem(id: number): void {
        this.selection = { id, name: this.plugin.describeDefinition("item", id)?.name ?? `Item ${id}` };
        this.render();
    }

    private changed(): void {
        this.edited = true;
        this.plugin.previewGroundItems(this.items);
        this.onChange();
        this.render();
    }

    private render(): void {
        const body = this.body;
        if (!body?.isConnected) return;
        body.replaceChildren();
        if (!this.loaded) {
            body.append("Ground item placements load from the development world.");
            return;
        }
        const selection = this.selection;
        if (selection) {
            const field = (label: string, value: number, min: number, max: number, change: (value: number) => void) => {
                const row = document.createElement("label");
                const input = document.createElement("input");
                Object.assign(input.style, this.style);
                input.type = "number";
                input.min = String(min);
                input.max = String(max);
                input.value = String(value);
                input.onchange = () => {
                    const next = Math.max(min, Math.min(max, Math.trunc(Number(input.value) || 0)));
                    input.value = String(next);
                    change(next);
                };
                row.append(label, input);
                return row;
            };
            body.append(selection.name,
                field("Quantity", this.amount, 1, 2147483647, (amount) => { this.amount = amount; }),
                field("Respawn ticks (0 for one pickup)", this.timer, 0, 86400, (timer) => { this.timer = timer; }),
                this.button("Place on ground", "Choose a tile to place this item", () => {
                    this.plugin.pickTile((tile) => {
                        const location = { x: tile.tileX, y: tile.tileY, z: tile.plane };
                        const item = { id: selection.id, amt: this.amount, respawn: this.timer, location };
                        const existing = this.items.findIndex((candidate) => candidate.id === item.id &&
                            candidate.location.x === location.x && candidate.location.y === location.y && candidate.location.z === location.z);
                        if (existing >= 0) this.items[existing] = { ...this.items[existing], ...item };
                        else this.items.push(item);
                        this.changed();
                    }, "Click the ground to place the item");
                }),
            );
        } else {
            body.append("Choose an item in the Items search tab to place it.");
        }
        const nearby = this.plugin.getCameraTile();
        const distance = ({ location }: GroundItemPlacement) => nearby
            ? Math.hypot(location.x - nearby.tileX, location.y - nearby.tileY) : 0;
        const closest = [...this.items].sort((a, b) => distance(a) - distance(b)).slice(0, 12);
        if (closest.length) body.append("Nearby editor placements");
        for (const item of closest) {
            const tile = `${item.location.x}, ${item.location.y}, ${item.location.z}`;
            const name = this.plugin.describeDefinition("item", item.id)?.name ?? `Item ${item.id}`;
            const row = document.createElement("div");
            Object.assign(row.style, { display: "flex", flexWrap: "wrap", gap: "4px" });
            row.append(
                this.button(`${name} × ${item.amt}`, `Go to ${tile} and edit this item`, () => {
                    this.plugin.goToLocation(tile);
                    this.amount = item.amt;
                    this.timer = item.respawn;
                    this.useItem(item.id);
                }),
                this.button("Remove", `Remove ${name} at ${tile}`, () => {
                    this.items = this.items.filter((candidate) => candidate !== item);
                    this.changed();
                }),
            );
            body.append(row);
        }
    }
}
