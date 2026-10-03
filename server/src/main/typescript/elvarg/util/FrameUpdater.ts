export class Frame126 {
    id: number;
    currentState: string;

    constructor(s: string, id: number) {
        this.currentState = s;
        this.id = id;
    }
}

export class FrameUpdater {
    public interfaceTextMap = new Map<number, Frame126>();
    shouldUpdate(text: string, id: number): boolean {
        if (!this.interfaceTextMap.has(id)) {
            this.interfaceTextMap.set(id, new Frame126(text, id));
        } else {
            let t = this.interfaceTextMap.get(id);
            if (text === t.currentState) {
                return false;
            }
            t.currentState = text;
        }
        return true;
    }

    /**
     * Forget cached text for a widget so the next write is always sent.
     * Needed when an interface is remounted (the client's side resets to blank
     * but this per-player cache still holds the last value).
     */
    clear(id: number): void {
        this.interfaceTextMap.delete(id);
    }

    /** Forget every cached text of an interface group (packed `group << 16 | child` ids). */
    clearGroup(groupId: number): void {
        for (const id of this.interfaceTextMap.keys()) {
            if (id >>> 16 === groupId) this.interfaceTextMap.delete(id);
        }
    }
}