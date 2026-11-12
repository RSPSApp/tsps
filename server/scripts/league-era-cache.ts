// A past league's own cache, from the OpenRS2 Archive (docs/leagues.md, Tasks).
//
// The current cache only carries the current league's task list. Each earlier league's list is in
// the caches Jagex served while that league ran: enum 2670 gives the league's struct (by league
// type), its param 868 the task list enum (list position -> task struct), and each task struct its
// id (873, the Wiki's task id), name (874), description (875), category (1016, enum 3411) and area
// (1017, enum 3412). The tier is a param of its own per league (`EraCache.tierParam`); enum 2671
// holds the tier points of that time. A struct without a param reads the param's default (the
// params archive): Trailblazer Reloaded's "Equip a Full Angler's Outfit" has no area, so it is
// Global (0).
//
// Only the config reference table (archive 255, group 2) and the enum, param and struct groups (2/8,
// 2/11, 2/34) are fetched, from `/caches/runescape/<id>/archives/<archive>/groups/<group>.dat`, the
// same archive scripts/ensure-cache.ts downloads the current cache from (whole). They are kept in
// server/era-caches/<openrs2 id>/ (gitignored) and each config group is checked against the
// reference table's CRC, so a pinned id always reads the same bytes.
import fs = require("fs");
import path = require("path");
import { CacheDefinitions } from "../src/main/typescript/elvarg/game/cache/CacheDefinitions";
import { ApiType } from "../src/main/typescript/elvarg/game/cache/codec/rs/cache/ApiType";
import { CacheIndexDat2 } from "../src/main/typescript/elvarg/game/cache/codec/rs/cache/CacheIndex";
import { ConfigType } from "../src/main/typescript/elvarg/game/cache/codec/rs/cache/ConfigType";
import { IndexType } from "../src/main/typescript/elvarg/game/cache/codec/rs/cache/IndexType";
import { CacheStore } from "../src/main/typescript/elvarg/game/cache/codec/rs/cache/store/CacheStore";
import { ByteBuffer } from "../src/main/typescript/elvarg/game/cache/codec/rs/io/ByteBuffer";
import { crc32 } from "../src/main/typescript/elvarg/game/cache/codec/rs/util/Crc32";

/** The OpenRS2 Archive, as in scripts/ensure-cache.ts (which tests load on its own, so it imports nothing local). */
const OPENRS2_API = "https://archive.openrs2.org";
export const ERA_CACHE_DIR = path.resolve(__dirname, "../era-caches");
const META_INDEX = 255;
const CONFIG_GROUPS = [ConfigType.DAT2.enums, ConfigType.DAT2.params, ConfigType.OSRS.struct];

/** Enum 2670: league type -> the league's struct. */
const LEAGUE_ENUM = 2670;
/** The league struct's task list enum (list position -> task struct). */
const TASK_LIST_PARAM = 868;
const TASK_PARAMS = { id: 873, name: 874, description: 875, category: 1016, area: 1017 };
export const ERA_CATEGORY_ENUM = 3411;
export const ERA_AREA_ENUM = 3412;
export const ERA_POINTS_ENUM = 2671;

/** A league's era cache: an OpenRS2 cache id, its date (for the record) and the param its task structs keep the tier in. */
export interface EraCache { openrs2: number; date: string; tierParam: number }

export interface EraTask { position: number; struct: number; id: number; name: string; description: string; tier: number; category: number; area: number }

export interface EraLeague {
  /** The league's task list, in list order. */
  tasks: EraTask[];
  /** Enum 2671 then: tier -> points. */
  points: Record<number, number>;
  /** Enum 3411 then: category id -> name. */
  categories: ReadonlyMap<number, string>;
  /** Enum 3412 then: area id -> name. */
  areas: ReadonlyMap<number, string>;
}

/** Groups as fetched: `<dir>/<archive>/<group>.dat`, the JS5 container (OpenRS2 serves it without the version trailer). */
class GroupFileStore implements CacheStore<ApiType.SYNC> {
  constructor(private readonly directory: string) {}

  read(index: number, group: number): Int8Array {
    const file = groupFile(this.directory, index, group);
    if (!fs.existsSync(file)) throw new Error(`${file}: not fetched`);
    const bytes = fs.readFileSync(file);
    return new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
}

const groupFile = (directory: string, index: number, group: number) => path.join(directory, String(index), `${group}.dat`);

async function fetchGroup(cache: EraCache, directory: string, index: number, group: number, crc?: number): Promise<void> {
  const file = groupFile(directory, index, group);
  if (fs.existsSync(file) && (crc === undefined || crc32(fs.readFileSync(file)) === crc)) return;
  const url = `${OPENRS2_API}/caches/runescape/${cache.openrs2}/archives/${index}/groups/${group}.dat`;
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (crc !== undefined && crc32(bytes) !== crc) throw new Error(`${url}: CRC ${crc32(bytes)}, the reference table says ${crc}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const partial = `${file}.${process.pid}.part`;
  fs.writeFileSync(partial, bytes);
  fs.renameSync(partial, file);
}

/** The config index of the league's cache, fetching (once) the groups it needs. */
async function configIndex(cache: EraCache): Promise<CacheIndexDat2> {
  const directory = path.join(ERA_CACHE_DIR, String(cache.openrs2));
  await fetchGroup(cache, directory, META_INDEX, IndexType.DAT2.configs);
  const store = new GroupFileStore(directory);
  const index = CacheIndexDat2.fromStore(IndexType.DAT2.configs, store);
  for (const group of CONFIG_GROUPS) {
    const reference = index.getArchiveReference(group);
    if (!reference) throw new Error(`OpenRS2 cache ${cache.openrs2} has no config group ${group}`);
    await fetchGroup(cache, directory, IndexType.DAT2.configs, group, reference.crc >>> 0);
  }
  return index;
}

/** The params archive's defaults: what a struct without the param reads. */
function paramDefaults(index: CacheIndexDat2): Map<number, number | string> {
  const defaults = new Map<number, number | string>();
  const archive = index.getArchive(ConfigType.DAT2.params);
  for (const id of index.getFileIds(ConfigType.DAT2.params) ?? []) {
    const file = archive.getFile(id);
    if (!file) continue;
    const buffer = new ByteBuffer(new Int8Array(file.data));
    for (let opcode = buffer.readUnsignedByte(); opcode !== 0; opcode = buffer.readUnsignedByte()) {
      if (opcode === 1) buffer.readUnsignedByte(); // type
      else if (opcode === 2) defaults.set(id, buffer.readInt());
      else if (opcode === 4) continue; // not autodisabled
      else if (opcode === 5) defaults.set(id, buffer.readString());
      else break;
    }
  }
  return defaults;
}

/** League `type`'s task list as its era cache has it. */
export async function eraLeague(type: number, cache: EraCache): Promise<EraLeague> {
  const index = await configIndex(cache);
  const enums = index.getArchive(ConfigType.DAT2.enums);
  const structs = index.getArchive(ConfigType.OSRS.struct);
  const enumOf = (id: number) => {
    const file = enums.getFile(id);
    if (!file) throw new Error(`OpenRS2 cache ${cache.openrs2} has no enum ${id}`);
    return CacheDefinitions.decodeEnumValues(new Int8Array(file.data));
  };
  const structOf = (id: number) => {
    const file = structs.getFile(id);
    if (!file) throw new Error(`OpenRS2 cache ${cache.openrs2} has no struct ${id}`);
    return CacheDefinitions.decodeStructParams(new Int8Array(file.data));
  };
  const defaults = paramDefaults(index);
  const param = (params: ReadonlyMap<number, number | string>, id: number) => {
    const value = params.get(id) ?? defaults.get(id);
    if (value === undefined) throw new Error(`OpenRS2 cache ${cache.openrs2}: param ${id} is unset and has no default`);
    return value;
  };

  const leagueStruct = enumOf(LEAGUE_ENUM).get(type);
  if (typeof leagueStruct !== "number") throw new Error(`OpenRS2 cache ${cache.openrs2}: enum ${LEAGUE_ENUM} has no league ${type}`);
  const list = param(structOf(leagueStruct), TASK_LIST_PARAM);
  const tasks: EraTask[] = [];
  for (const [position, struct] of [...enumOf(Number(list)).entries()].sort(([a], [b]) => a - b)) {
    const params = structOf(Number(struct));
    const task: EraTask = {
      position, struct: Number(struct), id: Number(param(params, TASK_PARAMS.id)), name: String(param(params, TASK_PARAMS.name)),
      description: String(param(params, TASK_PARAMS.description)), tier: Number(param(params, cache.tierParam)),
      category: Number(param(params, TASK_PARAMS.category)), area: Number(param(params, TASK_PARAMS.area)),
    };
    if (!task.name || !task.description) throw new Error(`OpenRS2 cache ${cache.openrs2}: task struct ${struct} has no name or description`);
    tasks.push(task);
  }
  const points: Record<number, number> = {};
  for (const [tier, value] of [...enumOf(ERA_POINTS_ENUM).entries()].sort(([a], [b]) => a - b)) points[tier] = Number(value);
  const named = (id: number) => new Map([...enumOf(id).entries()].map(([key, value]) => [key, String(value)]));
  return { tasks, points, categories: named(ERA_CATEGORY_ENUM), areas: named(ERA_AREA_ENUM) };
}
