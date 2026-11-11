function supportsPlane(plane) {
    return plane >= 0 && plane < 4;
}

function canSeeAcrossPlanes(viewer, target) {
    return supportsPlane(viewer) && supportsPlane(target) && target < viewer;
}

function combatEnabled(api) {
    const configured = api.getPluginConfig("CrossFloor:combat");
    if (typeof configured === "boolean") return configured;
    return process.env.CROSS_FLOOR_COMBAT === undefined
        ? process.env.CROSS_FLOOR_VISIBILITY === undefined && process.env.CROSS_FLOOR_VISIBILITY_AND_COMBAT === "1"
        : process.env.CROSS_FLOOR_COMBAT === "1";
}

module.exports = {
    name: "CrossFloor",
    description: "See nearby players, NPCs, ground items and temporary objects on lower floors.",
    get enabled() {
        return (process.env.CROSS_FLOOR_VISIBILITY ?? process.env.CROSS_FLOOR_VISIBILITY_AND_COMBAT) === "1";
    },
    config: {
        "CrossFloor:combat": {
            type: "boolean",
            label: "Cross-floor combat",
            defaultText: "Off unless enabled by a legacy environment flag",
            help: "Allows ranged and magic attacks between floors while CrossFloor is enabled.",
        },
    },
    register(api) {
        api.core.CrossFloor.registerPolicy({ supportsPlane, canSeeAcrossPlanes, combatEnabled: combatEnabled.bind(null, api) });
    },
};
