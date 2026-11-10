import { SceneLoc } from "../../rs/scene/SceneLoc";
import { LocEntity } from "../../rs/scene/entity/LocEntity";
import { ModelInfo } from "../buffer/SceneBuffer";

export type SceneLocEntity = {
    entity: LocEntity;
    sceneLoc: SceneLoc;
    lowDetail: boolean;
    preparedOrigin?: { tileX: number; tileY: number; shape: number };
} & ModelInfo;
