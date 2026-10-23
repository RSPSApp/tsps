import type {HelperQuest} from './QuestHelperProtocol';
export function recommendedQuests(catalog:readonly HelperQuest[],selected=''):HelperQuest[]{
    const available=catalog.filter((q,i)=>q.supported&&q.status!=='FINISHED'&&catalog.findIndex(other=>other.questKey===q.questKey)===i);
    const tutorial=available.find(q=>q.questKey==='learning_the_ropes'&&(q.status==='NOT_STARTED'||q.status==='IN_PROGRESS'));
    if(tutorial)return [tutorial];
    return available.filter(q=>q.questKey!==selected&&q.eligibility?.known&&q.eligibility.eligible)
        .sort((a,b)=>(a.status==='IN_PROGRESS'?0:1)-(b.status==='IN_PROGRESS'?0:1)
            ||a.eligibility!.recommendedMissing.length-b.eligibility!.recommendedMissing.length
            ||a.eligibility!.difficulty-b.eligibility!.difficulty||a.eligibility!.length-b.eligibility!.length||a.name.localeCompare(b.name)).slice(0,5);
}
