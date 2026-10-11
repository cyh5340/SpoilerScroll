import { validateUnderstanding, type ModelProvider } from './provider.js';
import type { Observation, Understanding } from './types.js';
/** Real local extractive baseline: exact repeats only, no semantic-model claim. */
export class LocalExtractiveProvider implements ModelProvider {
  readonly mode='local' as const;
  readonly name='local-extractive-exact-repeat';
  readonly revision='1';
  async understand(o:Observation):Promise<Understanding> {
    const quotes=o.visibleText.match(/[^.!?]+[.!?]*/g)?.map(q=>q.trim()).filter(Boolean)??[];
    const embedding=Array<number>(64).fill(0);
    for(const word of o.visibleText.toLowerCase().match(/[\p{L}\p{N}]+/gu)??[]) {
      let h=0;for(const char of word)h=(h*31+char.charCodeAt(0))>>>0;embedding[h%64]++;
    }
    if(!embedding.some(Boolean))embedding[0]=1;
    return validateUnderstanding({summary:(quotes[0]??o.visibleText).slice(0,2000),claims:quotes.map((quote,i)=>({id:String(i),quote})),embedding,complete:true},o.visibleText);
  }
}
