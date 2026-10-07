import type { Plugin } from "../../client/plugins/Plugin";

export class PluginChanged {
    constructor(
        private readonly plugin: Plugin,
        private readonly enabled: boolean,
    ) {}

    getPlugin(): Plugin {
        return this.plugin;
    }

    isEnabled(): boolean {
        return this.enabled;
    }
}
