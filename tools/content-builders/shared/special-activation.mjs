export const SPECIAL_ACTIVATIONS=Object.freeze({melee:'Melee attack',ranged:'Ranged attack',self:'Cast on self'});
const offensive=new Set(['projectile','follow-up','next-flames','burn','bleed','chain','knockback','drain-current','capped-drain','cross-stat-drain','highest-drain','bonus-drain']);
/** Migration reads intent from the recipe, rather than equating every omitted primary hit with a self-cast. */
export function specialActivation(rule){
 if(rule.activation!==undefined){if(!Object.hasOwn(SPECIAL_ACTIVATIONS,rule.activation))throw new Error('Choose an activation type.');return rule.activation;}
 const skip=rule.ruleFeatures?.findLast(row=>row.type==='skipAttack')?.value??rule.traits?.skipAttack??false;
 const targetsEnemy=rule.extraFeatures?.some(row=>offensive.has(row.type))||rule.recipe?.extras?.some(row=>offensive.has(row.type))||rule.nativeFeatures?.some(row=>!['skill-boost','recovery','missing-resource-bonus'].includes(row.mechanic));
 return skip&&!targetsEnemy?'self':rule.style==='melee'||!rule.style?'melee':'ranged';
}
