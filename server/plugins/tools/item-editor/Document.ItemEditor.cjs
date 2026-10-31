const { createHash } = require('node:crypto');
const revision = rows => createHash('sha256').update(JSON.stringify(rows)).digest('hex');
function integer(value, min, max, label) {
    if (!Number.isInteger(value) || value < min || value > max)
        throw Error(`Invalid ${label}`);
}
function object(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw Error(`Invalid ${label}`);
}
const objectNumbers = {
    model: [-1, 2147483647], zoom2d: [1, 10000], xan2d: [0, 2047], yan2d: [0, 2047], zan2d: [0, 2047],
    offsetX2d: [-2000, 2000], offsetY2d: [-2000, 2000], price: [0, 2147483647],
    maleModel: [-1, 2147483647], maleModel1: [-1, 2147483647], maleModel2: [-1, 2147483647],
    femaleModel: [-1, 2147483647], femaleModel1: [-1, 2147483647], femaleModel2: [-1, 2147483647],
    maleHeadModel: [-1, 2147483647], maleHeadModel2: [-1, 2147483647], femaleHeadModel: [-1, 2147483647], femaleHeadModel2: [-1, 2147483647],
    wearPos: [-1, 13], wearPos2: [-1, 13], wearPos3: [-1, 13], stackability: [0, 2], shiftClickIndex: [-2, 4],
    note: [-1, 65535], noteTemplate: [-1, 65535], unnotedId: [-1, 65535], notedId: [-1, 65535], placeholder: [-1, 65535], placeholderTemplate: [-1, 65535],
    resizeX: [1, 1024], resizeY: [1, 1024], resizeZ: [1, 1024], ambient: [-128, 127], contrast: [-640, 635], team: [0, 255],
    manwearXOff: [-1000, 1000], manwearYOff: [-1000, 1000], manwearZOff: [-1000, 1000], womanwearXOff: [-1000, 1000], womanwearYOff: [-1000, 1000], womanwearZOff: [-1000, 1000],
};
function validateItem(row) {
    object(row, 'item');
    if (Object.keys(row).some(k => !['id', 'baseItemId', 'objType', 'itemDef', 'models'].includes(k)))
        throw Error('Unknown item field');
    integer(row.id, 60000, 65022, 'custom ID');
    integer(row.baseItemId, 0, 59999, 'base item');
    object(row.objType, 'appearance');
    for (const [key, value] of Object.entries(row.objType)) {
        if (key === 'name' || key === 'examine') {
            if (typeof value !== 'string' || value.length > (key === 'name' ? 80 : 500) || (key === 'name' && !value.trim()))
                throw Error(`Invalid ${key}`);
        }
        else if (objectNumbers[key])
            integer(value, ...objectNumbers[key], key);
        else if (['isTradable', 'isMembers'].includes(key)) {
            if (typeof value !== 'boolean')
                throw Error(`Invalid ${key}`);
        }
        else if (key === 'weight') {
            if (!Number.isFinite(value) || Math.abs(value) > 100000)
                throw Error('Invalid weight');
        }
        else if (['recolorFrom', 'recolorTo', 'retextureFrom', 'retextureTo'].includes(key)) {
            if (!Array.isArray(value) || value.length > 4096)
                throw Error(`Invalid ${key}`);
            value.forEach(n => integer(n, 0, 65535, key));
        }
        else if (['inventoryActions', 'groundActions'].includes(key)) {
            if (!Array.isArray(value) || value.length !== 5 || value.some(v => v !== null && (typeof v !== 'string' || v.length > 40)))
                throw Error(`Invalid ${key}`);
        }
        else
            throw Error(`Unknown appearance field: ${key}`);
    }
    if (typeof row.objType.name !== 'string')
        throw Error('Item name is required');
    for (const kind of ['recolor', 'retexture'])
        if ((row.objType[`${kind}From`]?.length ?? 0) !== (row.objType[`${kind}To`]?.length ?? 0))
            throw Error(`Mismatched ${kind} pairs`);
    if (row.itemDef !== undefined) {
        object(row.itemDef, 'item rules');
        for (const [key, value] of Object.entries(row.itemDef)) {
            if (key === 'bonuses' || key === 'requirements') {
                if (!Array.isArray(value) || (key === 'bonuses' ? value.length !== 14 : ![23, 24].includes(value.length)))
                    throw Error(`Invalid ${key}`);
                value.forEach(n => integer(n, key === 'bonuses' ? -10000 : 0, key === 'bonuses' ? 10000 : 99, key));
            }
            else if (['doubleHanded', 'stackable', 'tradeable', 'dropable', 'sellable'].includes(key)) {
                if (typeof value !== 'boolean')
                    throw Error(`Invalid ${key}`);
            }
            else if (['equipmentType', 'weaponInterface'].includes(key)) {
                if (typeof value !== 'string' || !/^[A-Z_0-9]{1,60}$/.test(value))
                    throw Error(`Invalid ${key}`);
            }
            else if (/^(block|stand|walk|run|standTurn|turn180|turn90CW|turn90CCW)Anim$/.test(key))
                integer(value, -1, 65535, key);
            else if (['value', 'highAlch', 'lowAlch', 'dropValue', 'bloodMoneyValue'].includes(key))
                integer(value, 0, 2147483647, key);
            else
                throw Error(`Unknown item rule: ${key}`);
        }
    }
    // Model upload is a later feature. Existing manifests are retained by the service.
    if (row.models !== undefined) {
        object(row.models, 'model manifest');
        for (const [id, file] of Object.entries(row.models)) {
            integer(Number(id), 1000000, 2147483647, 'model ID');
            if (typeof file !== 'string' || !/^[a-zA-Z0-9._/-]+\.dat$/.test(file) || file.split('/').includes('..'))
                throw Error('Invalid model path');
        }
    }
    return row;
}
function upsert(rows, payload) {
    object(payload, 'save request');
    if (typeof payload.existing !== 'boolean' || Object.keys(payload).some(key => !['revision', 'existing', 'item'].includes(key)))
        throw Error('Invalid save request');
    if (payload?.revision !== revision(rows)) {
        const error = Error('Custom items changed on disk. Reload saved items before saving. Your draft is retained.');
        error.status = 409;
        throw error;
    }
    const item = validateItem(payload.item);
    const previous = rows.find(row => row.id === item.id);
    if (!!previous !== !!payload.existing) {
        const error = Error('This custom ID is already used or no longer exists. Reload saved items.');
        error.status = 409;
        throw error;
    }
    if (JSON.stringify(item.models) !== JSON.stringify(previous?.models))
        throw Error('Model uploads are not supported in this stage');
    // Preserve unrelated rows and ordering, including upstream custom definitions.
    return previous ? rows.map(row => row.id === item.id ? item : row) : [...rows, item];
}
module.exports = { revision, validateItem, upsert };
