import type { LocModelLoader } from "../../../rs/config/loctype/LocModelLoader";
import { LocModelType } from "../../../rs/config/loctype/LocModelType";
import type { LocTypeLoader } from "../../../rs/config/loctype/LocTypeLoader";
import { Model } from "../../../rs/model/Model";
import type { TextureLoader } from "../../../rs/texture/TextureLoader";

/** Widget model type 8 (cc_setmodel_loc): the widget's model id is a loc id. */
export const WIDGET_MODEL_TYPE_LOC = 8;

/** The model a loc shows in a widget: its centrepiece (shape 10), unrotated. */
export function widgetLocModel(
    locId: number,
    locTypeLoader: LocTypeLoader | undefined,
    locModelLoader: LocModelLoader | undefined,
    textureLoader: TextureLoader | undefined,
): Model | undefined {
    if (locId < 0 || !locTypeLoader || !locModelLoader || !textureLoader) return undefined;
    const locType = locTypeLoader.load(locId);
    if (!locType) return undefined;
    const model = locModelLoader.getModel(locType, LocModelType.NORMAL, 0);
    if (!model || model instanceof Model) return model;
    // Merged-normal locs come back unlit.
    return model.light(textureLoader, model.ambient, model.contrast, -50, -10, -50);
}
