import * as fs from "fs";
import { GameConstants } from "../../../GameConstants";
import {
  InterfaceLayoutDefinition,
  InterfaceLayoutRegistry,
  InterfaceSurface,
} from "../../InterfaceLayoutDefinition";
import { DefinitionLoader } from "../DefinitionLoader";

type RawInterfaceLayout = Omit<InterfaceLayoutDefinition, "key">;

export class InterfaceLayoutDefinitionLoader extends DefinitionLoader {
  public load(): void {
    const content = fs.readFileSync(this.file(), "utf8");
    const parsed: unknown = JSON.parse(content);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new Error("Interface layouts must be a JSON object keyed by name");
    }

    const definitions: InterfaceLayoutDefinition[] = [];
    const idsByKey = new Set<string>();
    for (const [key, raw] of Object.entries(
      parsed as Record<string, RawInterfaceLayout>
    )) {
      definitions.push(this.validate(key, raw, idsByKey));
    }
    InterfaceLayoutRegistry.replace(definitions);
    console.info(`[interfaces] Loaded ${definitions.length} interface layouts`);
  }

  public file(): string {
    return GameConstants.DEFINITIONS_DIRECTORY + "interface-layouts.json";
  }

  private validate(
    key: string,
    raw: RawInterfaceLayout,
    keys: Set<string>
  ): InterfaceLayoutDefinition {
    if (!key || keys.has(key)) {
      throw new Error(`Invalid or duplicate interface layout key: ${key}`);
    }
    keys.add(key);
    if (!raw || typeof raw !== "object") {
      throw new Error(`Interface layout ${key} must be an object`);
    }
    if (!Number.isInteger(raw.id) || raw.id < 0) {
      throw new Error(`Interface layout ${key} has an invalid id`);
    }
    if (typeof raw.name !== "string" || raw.name.trim().length === 0) {
      throw new Error(`Interface layout ${key} requires a name`);
    }

    const validSurfaces = new Set<string>(Object.values(InterfaceSurface));
    if (!validSurfaces.has(raw.surface)) {
      throw new Error(`Interface layout ${key} has an invalid surface`);
    }
    if (
      raw.surface === InterfaceSurface.SIDEBAR &&
      (!Number.isInteger(raw.tabId) || raw.tabId! < 0)
    ) {
      throw new Error(`Sidebar interface ${key} requires a tabId`);
    }
    if (
      raw.surface === InterfaceSurface.MAIN_WITH_SIDEBAR &&
      (!Number.isInteger(raw.sidebarInterfaceId) ||
        raw.sidebarInterfaceId! < 0)
    ) {
      throw new Error(
        `Main-with-sidebar interface ${key} requires sidebarInterfaceId`
      );
    }

    return {
      key,
      id: raw.id,
      name: raw.name.trim(),
      surface: raw.surface,
      ...(raw.tabId == null ? {} : { tabId: raw.tabId }),
      ...(raw.sidebarInterfaceId == null
        ? {}
        : { sidebarInterfaceId: raw.sidebarInterfaceId }),
    };
  }
}
