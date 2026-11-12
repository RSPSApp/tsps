import { getClientPreference, setClientPreference } from "../preferences/ClientPreferences";
import type { WasdCameraSetting } from "./WasdCamera";

/** WASD camera's switch, kept in the client preferences: off in a new browser. */
export class WasdCameraPreference implements WasdCameraSetting {
    private readonly listeners = new Set<() => void>();

    isEnabled(): boolean {
        return getClientPreference("wasdCamera");
    }

    setEnabled(enabled: boolean): void {
        if (enabled === this.isEnabled()) return;
        setClientPreference("wasdCamera", enabled);
        for (const listener of [...this.listeners]) listener();
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }
}
