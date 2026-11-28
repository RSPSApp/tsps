import FileSaver from "file-saver";

export type ObjectSwatch = { id: number; type: number; name: string; turn: number };
const STORAGE_KEY = "map-editor:object-swatches";
const MAX_SWATCHES = 512;

/** RSPSi stores object swatches as a JSON array of id/type/name records. */
export function parseObjectSwatches(contents: string): ObjectSwatch[] {
    if (contents.length > 1_000_000) throw new Error("The swatch file is too large");
    const value: unknown = JSON.parse(contents);
    if (!Array.isArray(value) || value.length > MAX_SWATCHES) throw new Error("Expected an array of up to 512 object swatches");
    const result = new Map<string, ObjectSwatch>();
    for (const item of value) {
        if (!item || typeof item !== "object") throw new Error("Invalid object swatch");
        const { id, type, name, turn = 0 } = item;
        if (!Number.isInteger(id) || id < 0 || id > 0x7fffffff || !Number.isInteger(type) || type < 0 || type > 22 ||
            typeof name !== "string" || name.length > 200 || !Number.isInteger(turn) || turn < 0 || turn > 3) {
            throw new Error("Invalid object swatch: check its id, type, name and turn");
        }
        const entry = { id, type, name, turn };
        result.set(swatchKey(entry), entry);
    }
    return [...result.values()];
}

const swatchKey = ({ id, type, turn }: ObjectSwatch): string => `${id}:${type}:${turn}`;

export class EditorObjectSwatches {
    private entries: ObjectSwatch[] = [];
    private content?: HTMLElement;
    private selected?: string;
    private observer?: IntersectionObserver;
    private generation = 0;
    private readonly thumbnails = new Map<number, string>();
    private readonly pending = new Map<HTMLImageElement, ObjectSwatch>();
    private loading = false;

    constructor(private readonly options: {
        pick: (swatch: ObjectSwatch) => void;
        selected: () => ObjectSwatch | undefined;
        browse: () => void;
        thumbnail: (id: number) => Promise<string | undefined>;
        notify: (message: string) => void;
    }) {
        try { this.entries = parseObjectSwatches(window.localStorage.getItem(STORAGE_KEY) ?? "[]"); }
        catch { options.notify("Saved object swatches could not be read"); }
    }

    add(swatch: ObjectSwatch): void {
        try {
            const entries = parseObjectSwatches(JSON.stringify([...this.entries.filter(entry => swatchKey(entry) !== swatchKey(swatch)), swatch]));
            this.save(entries);
            this.selected = swatchKey(swatch);
            if (this.content?.isConnected) this.mount(this.content);
            this.options.notify(`Added ${swatch.name} to object swatches`);
        } catch (error) { this.report(error); }
    }

    mount(content: HTMLElement): void {
        this.unmount();
        this.content = content;
        content.replaceChildren();
        const header = document.createElement("div"); header.className = "rspsi-object-header";
        const title = document.createElement("h3"); title.textContent = "Objects";
        const file = document.createElement("input"); file.type = "file"; file.accept = ".json,.swatch,application/json"; file.hidden = true;
        file.setAttribute("aria-label", "Load object swatches file");
        const save = this.button("Save", "Save object swatches", () => {
            FileSaver.saveAs(new Blob([JSON.stringify(this.entries, null, 2) + "\n"], { type: "application/json" }), "objects.swatch");
        });
        save.disabled = this.entries.length === 0;
        header.append(title, save, this.button("Load", "Load object swatches", () => file.click()));
        file.onchange = () => {
            const selected = file.files?.[0]; file.value = "";
            if (!selected) return;
            if (selected.size > 1_000_000) { this.options.notify("The swatch file is too large"); return; }
            void selected.text().then(contents => {
                const entries = parseObjectSwatches(contents);
                // Import merges by object/type/rotation, preserving the current palette.
                const merged = new Map(this.entries.map(entry => [swatchKey(entry), entry]));
                for (const entry of entries) merged.set(swatchKey(entry), entry);
                this.save(parseObjectSwatches(JSON.stringify([...merged.values()])));
                if (this.content?.isConnected) this.mount(this.content);
                this.options.notify(`Loaded ${entries.length} object swatches`);
            }).catch(error => this.report(error));
        };
        const add = this.button("Add selected", "Add selected object to swatches", () => {
            const selected = this.options.selected();
            if (selected) this.add(selected);
        });
        add.disabled = !this.options.selected();
        const grid = document.createElement("div"); grid.className = "rspsi-object-swatches";
        grid.setAttribute("aria-label", "Saved object swatches");
        if (this.entries.length && typeof window.IntersectionObserver === "function") {
            this.observer = new window.IntersectionObserver(entries => {
                for (const entry of entries) {
                    const image = entry.target as HTMLImageElement;
                    if (entry.isIntersecting) {
                        const swatch = this.entries.find(swatch => swatchKey(swatch) === image.dataset.swatchKey);
                        if (swatch) this.pending.set(image, swatch);
                    } else this.pending.delete(image);
                }
                void this.loadThumbnails();
            }, { root: content, rootMargin: "64px" });
        }
        const remove = this.button("Remove", "Remove selected object swatch", () => {
            try {
                this.save(this.entries.filter(entry => swatchKey(entry) !== this.selected));
                this.selected = undefined; this.mount(content);
            } catch (error) { this.report(error); }
        });
        remove.disabled = !this.selected || !this.entries.some(entry => swatchKey(entry) === this.selected);
        const actions = document.createElement("div"); actions.className = "rspsi-object-actions"; actions.append(add, remove);
        for (const swatch of this.entries) {
            const button = this.button(`${swatch.id}`, `Place ${swatch.name} (${swatch.id}, type ${swatch.type}, rotation ${swatch.turn})`, () => {
                this.selected = swatchKey(swatch);
                for (const item of grid.querySelectorAll("button")) item.setAttribute("aria-pressed", String(item.dataset.swatchKey === this.selected));
                remove.disabled = false;
                this.options.pick(swatch);
            });
            button.dataset.swatchKey = swatchKey(swatch);
            button.setAttribute("aria-pressed", String(button.dataset.swatchKey === this.selected));
            const image = document.createElement("img"); image.alt = ""; image.dataset.swatchKey = swatchKey(swatch);
            const cached = this.thumbnails.get(swatch.id);
            if (cached) image.src = cached;
            button.prepend(image); grid.append(button);
            if (!cached) {
                if (this.observer) this.observer.observe(image);
                else if (this.pending.size < 8) this.pending.set(image, swatch);
            }
        }
        const empty = document.createElement("p");
        empty.className = "rspsi-object-empty";
        empty.textContent = "Add objects from Object View or select an object on the map and add it to swatches.";
        const browse = this.button("Show Object View", "Show object view", this.options.browse);
        content.append(header, file, actions, this.entries.length ? grid : empty, browse);
        void this.loadThumbnails();
    }

    unmount(): void {
        this.generation++;
        this.observer?.disconnect(); this.observer = undefined;
        this.pending.clear(); this.content = undefined;
    }

    private async loadThumbnails(): Promise<void> {
        if (this.loading) return;
        this.loading = true;
        try {
            while (this.pending.size) {
                const [image, swatch] = this.pending.entries().next().value!;
                this.pending.delete(image);
                if (!image.isConnected) continue;
                const generation = this.generation;
                try {
                    const source = this.thumbnails.get(swatch.id) ?? await this.options.thumbnail(swatch.id);
                    if (source) {
                        this.thumbnails.set(swatch.id, source);
                        if (generation === this.generation && image.isConnected) image.src = source;
                    }
                } catch { /* The swatch remains usable when a model preview is unavailable. */ }
            }
        } finally { this.loading = false; }
    }

    private save(entries: ObjectSwatch[]): void {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
        this.entries = entries;
    }
    private report(error: unknown): void { this.options.notify(error instanceof Error ? error.message : String(error)); }
    private button(text: string, label: string, run: () => void): HTMLButtonElement {
        const button = document.createElement("button"); button.type = "button"; button.textContent = text;
        button.title = label; button.setAttribute("aria-label", label); button.onclick = run; return button;
    }
}
