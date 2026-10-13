import type { PluginMessagePayload } from "../../../common/network/PluginMessage";

export class PluginMessage {
    constructor(readonly channel: string, readonly data: PluginMessagePayload["data"]) {}
}
