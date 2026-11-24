// View preferences only. These never become project geometry or exported settings.
export const PREVIEW_SCENES = [
    { id: 'studio', name: 'Studio dark', sky: '#343434', grid: '#505050', studio: true },
    { id: 'studio-light', name: 'Studio light', sky: '#b8b8b8', grid: '#969696', studio: true },
    { id: 'lumbridge', name: 'Lumbridge courtyard', sky: '#8eabae', x: 3222, y: 3218, plane: 0 },
    { id: 'desert', name: 'Al Kharid desert', sky: '#d7c7a1', x: 3316, y: 3120, plane: 0 },
    { id: 'varrock', name: 'Varrock castle rooftop', sky: '#9caebd', x: 3205, y: 3473, plane: 3 },
];
export const NEUTRAL_SKIN_HSL = 4550;

// Map tiles can cross the camera near plane. Clip them instead of dropping
// an entire tile, which leaves sky-coloured holes immediately beneath the model.
export function clipBackdropTriangle(vertices, uv, view) {
    const input = vertices.map((point,i)=>({point,uv:uv[i],depth:view.distance+view.project(point)[2]})), polygon=[];
    for (let i=0;i<input.length;i++) {
        const a=input[i],b=input[(i+1)%input.length],inside=a.depth>=10,nextInside=b.depth>=10;
        if(inside)polygon.push(a);
        if(inside!==nextInside){const t=(10-a.depth)/(b.depth-a.depth);polygon.push({
            point:a.point.map((n,axis)=>n+(b.point[axis]-n)*t),uv:a.uv.map((n,axis)=>n+(b.uv[axis]-n)*t)
        });}
    }
    return polygon.slice(1,-1).map((_,i)=>{const triangle=[polygon[0],polygon[i+1],polygon[i+2]];return {vertices:triangle.map(v=>v.point),uv:triangle.map(v=>v.uv)};});
}
