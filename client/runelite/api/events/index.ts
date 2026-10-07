import { BeforeRender } from "./BeforeRender";
import { ClientTick } from "./ClientTick";
import { CommandExecuted } from "./CommandExecuted";
import { ConfigChanged } from "./ConfigChanged";
import { FocusChanged } from "./FocusChanged";
import { GameStateChanged } from "./GameStateChanged";
import { GameTick } from "./GameTick";
import { PluginChanged } from "./PluginChanged";
import { PostClientTick } from "./PostClientTick";

export { BeforeRender } from "./BeforeRender";
export { ClientTick } from "./ClientTick";
export { CommandExecuted } from "./CommandExecuted";
export { ConfigChanged } from "./ConfigChanged";
export { FocusChanged } from "./FocusChanged";
export { GameStateChanged } from "./GameStateChanged";
export { GameTick } from "./GameTick";
export { PluginChanged } from "./PluginChanged";
export { PostClientTick } from "./PostClientTick";

export type EventInstance = object;
export type EventClass<E = EventInstance> = new (...args: never[]) => E;

/**
 * Every event class the bus can bind to, by simple name. Kept explicit so
 * minified class names cannot break `on<EventName>` binding.
 */
export const EVENT_CLASSES: Record<string, EventClass> = {
    GameTick,
    ClientTick,
    PostClientTick,
    BeforeRender,
    GameStateChanged,
    ConfigChanged,
    PluginChanged,
    CommandExecuted,
    FocusChanged,
};
