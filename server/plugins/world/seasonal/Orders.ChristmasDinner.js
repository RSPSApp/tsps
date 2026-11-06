"use strict";

const Progress=require('./Progress.ChristmasDinner');

// Candidate selection policy, not recovered OSRS RNG weights. Canonical menus
// establish these choices; retained videos establish variation. Customer-specific
// restrictions/weights still require evidence before claiming complete parity.
function pick(api,choices){return choices[api.core.Misc.randomInclusive(0,choices.length-1)];}
function drink(api){return pick(api,Progress.DRINKS);}
function food(api){
  const main=pick(api,Progress.MAINS),available=[...Progress.SIDES],sides=[];
  for(let count=0;count<3;count++)sides.push(available.splice(api.core.Misc.randomInclusive(0,available.length-1),1)[0]);
  return {main,sides};
}

module.exports={drink,food};
