import { newSpecial, newPassive } from '../shared/effects.mjs';
import { newVisual } from '../shared/visuals.mjs';

const swing=(name,animation,graphic,patch={})=>({...newSpecial(),name,animation,graphic:-1,hitCount:1,hitDelayTicks:[0],visuals:[newVisual(graphic,{recipient:'player',phase:'launch'})],...patch});
const passive=(name,actions,graphic,patch={})=>({...newPassive(),name,actions,visuals:[newVisual(graphic)],...patch});
export const ATTACK_IDEAS = Object.freeze([
    {name:'Power strike',description:'150% damage, 125% accuracy, one hit.',make:()=>swing('Power strike',7644,1211,{damageMultiplier:1.5,accuracyMultiplier:1.25})},
    {name:'Double strike',description:'Two hits with independent accuracy rolls.',make:()=>swing('Twin strike',1062,1292,{hitCount:2,hitDelayTicks:[0,0]})},
    {name:'Life steal',description:'Restore 50% of damage dealt as health.',make:()=>swing('Healing strike',7640,1209,{actions:[{type:'heal',percent:50,minimum:0,basis:'dealt'}],visuals:[newVisual(1209,{recipient:'player',phase:'launch'}),newVisual(398)]})},
    {name:'Freeze',description:'Bind the target for 4.8 seconds.',make:()=>swing('Freezing strike',7638,1210,{actions:[{type:'freeze',ticks:8}],visuals:[newVisual(1210,{recipient:'player',phase:'launch'}),newVisual(369)]})},
    {name:'Area attack',description:'Native Powerstab targeting and hit behavior.',native:'dragon_2h_sword'},
    {name:'Strength boost',description:'Native Rampage stat boost and drains.',native:'dragon_battleaxe'}
]);
export const SET_IDEAS = Object.freeze([
    {name:'Life leech',description:'25% chance to heal for damage dealt.',make:()=>passive('Life leech',[{type:'heal',percent:100,minimum:0,basis:'dealt'}],398)},
    {name:'Prayer recovery',description:'25% chance to restore 50% of damage as prayer.',make:()=>passive('Prayer recovery',[{type:'prayer',percent:50,minimum:0,basis:'dealt'}],1209)},
    {name:'Defence drain',description:'25% chance to reduce Defence by 15%.',make:()=>passive('Defence breaker',[{type:'drain',percent:15}],1212)},
    {name:'Freeze',description:'25% chance to bind the target for 4.8 seconds.',make:()=>passive('Freezing touch',[{type:'freeze',ticks:8}],369)},
    {name:'Damage bonus',description:'25% chance to add 5 to a damage roll.',make:()=>passive('Extra power',[],1171,{trigger:'accurate',bonusDamage:5})},
    {name:'Visual only',description:'Play a visual on each successful hit.',make:()=>passive('My visual effect',[],398,{chance:100,trigger:'accurate'})}
]);
