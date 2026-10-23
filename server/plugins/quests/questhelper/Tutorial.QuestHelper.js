"use strict";
const {steps}=require('../../areas/data/tutorial-island.json');
function tutorialResult(request,stage) {
 const step=[...steps].reverse().find(s=>s.value<=stage)||steps[0];
 const targets=[];const widgets=[];
 if(step.arrow?.npc!==undefined)targets.push({kind:'npc',id:step.arrow.npc});
 if(step.arrow?.tile)targets.push({kind:'tile',x:step.arrow.tile[0],y:step.arrow.tile[1],plane:0});
 for(const highlight of step.highlight||[])if(highlight.item!==undefined)targets.push({kind:'item',id:highlight.item});
 const text=(step.text||[]).filter(t=>typeof t==='string'&&t.trim());
 if(!text.length && step.arrow?.npc!==undefined)text.push('Speak to the highlighted instructor and follow their instructions.');
 if(!text.length)text.push(`Continue the Tutorial Island task: ${step.name.toLowerCase().replaceAll('_',' ')}.`);
 if(step.flashTab!==undefined)text.push(`Open the flashing side tab (${step.flashTab}).`);
 const complete=stage>=671;
 return {protocol:1,session:request.session,sequence:request.sequence,questKey:'learning_the_ropes',sourceCommit:'tsps-native-tutorial-v1',status:complete?'complete':'active',activeStep:complete?null:{id:`tutorial-${step.value}`,text,targets,requirements:[],dialogueChoices:[],widgets,overlays:[]},panels:[],diagnostics:[]};
}
module.exports={tutorialResult};
