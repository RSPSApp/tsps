import {assemble} from './mesh.mjs';
// Native unarmed player defaults, used only when equipment supplies no movement.
export const PLAYER_PREVIEW={idle:808,walk:819,run:824,attack:422,block:424,death:836};
export function gearPreviewSequence(project,role,weapon){return project.animations?.[role]>=0?project.animations[role]:weapon?.animations?.[role]>=0?weapon.animations[role]:PLAYER_PREVIEW[role]??-1;}
/** Native joint pivots use the complete player, even when the body is hidden. Never export this mesh. */
export function gearPreviewMesh(project,variant,body,{parts=project.parts,visible=true,style='dummy'}={}){
    if(!['male','female'].includes(variant))throw new Error('Choose Male worn or Female worn to preview a player animation.');
    const opacity=visible?(style==='character'?1:.4):0,alpha=body.faces.map((_,i)=>Math.round(255-(255-(body.alpha?.[i]??0))*opacity));
    return assemble([...parts,{id:'preview-player-reference',variant,visible:true,mesh:{...body,alpha}}],variant);
}
