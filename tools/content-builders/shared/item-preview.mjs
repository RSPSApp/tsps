import { bounds } from './mesh.mjs';

/** Native item icon rotations, in the same Z, Y, X order as ItemIconRenderer. */
export function inventoryPreviewMesh(mesh, fields={}) {
    const angle=key=>((Number(fields[key])||0)&2047)*Math.PI/1024;
    const x=angle('xan2d'),y=angle('yan2d'),z=angle('zan2d'),sx=Math.sin(x),cx=Math.cos(x),sy=Math.sin(y),cy=Math.cos(y),sz=Math.sin(z),cz=Math.cos(z);
    return {...mesh,vertices:mesh.vertices.map(([vx,vy,vz])=>{
        [vx,vy]=[vy*sz+vx*cz,vy*cz-vx*sz];
        [vx,vz]=[vz*sy+vx*cy,vz*cy-vx*sy];
        return [vx,vy*cx-vz*sx,vy*sx+vz*cx];
    })};
}


/** Frame newly generated upright inventory geometry instead of a folded donor icon. */
export function uprightIconSettings(mesh) {
    const camera = {xan2d:128,yan2d:128,zan2d:0,offsetX2d:0,offsetY2d:0};
    const box = bounds(inventoryPreviewMesh(mesh, camera));
    const height = Math.max(0, -bounds(mesh).min[1]);
    const depthMargin = Math.max(Math.abs(box.min[2]), Math.abs(box.max[2])) + height / 2;
    camera.zoom2d = Math.max(1, Math.min(20000, Math.ceil(Math.max(
        (box.max[0]-box.min[0])*512/28, (box.max[1]-box.min[1])*512/26,
    ) + depthMargin + 20)));
    return camera;
}
