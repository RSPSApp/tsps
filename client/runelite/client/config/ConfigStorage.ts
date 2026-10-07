export interface ConfigStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
    key(index: number): string | null;
    readonly length: number;
}

class MemoryConfigStorage implements ConfigStorage {
    private readonly values = new Map<string, string>();

    getItem(key: string): string | null {
        return this.values.has(key) ? (this.values.get(key) as string) : null;
    }

    setItem(key: string, value: string): void {
        this.values.set(key, value);
    }

    removeItem(key: string): void {
        this.values.delete(key);
    }

    key(index: number): string | null {
        return [...this.values.keys()][index] ?? null;
    }

    get length(): number {
        return this.values.size;
    }
}

export function defaultConfigStorage(): ConfigStorage {
    if (typeof window !== "undefined" && window.localStorage) {
        return window.localStorage;
    }
    return new MemoryConfigStorage();
}
