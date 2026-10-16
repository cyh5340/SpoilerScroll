import {test} from 'node:test';
import assert from 'node:assert/strict';
import {canonicalUrl,findMatches,words} from '../dist/match.mjs';

const now=Date.now();
const entry=(url,title,hoursAgo=1)=>({url,title,lastVisitTime:now-hoursAgo*3_600_000});
const post={url:'https://www.reddit.com/r/technology/comments/abc123/ai_is_automating/',title:'AI is automating routine programming tasks'};

test('words are lowercase strings split on punctuation, without common words or single letters',()=>{
 assert.deepEqual([...words("AI is automating: routine Programming-tasks on Reddit! It's a")],['ai','automating','routine','programming','tasks']);
});
test('reported case: searching "Apple Welcome Home Event" then seeing related results',()=>{
 const history=[entry('https://www.apple.com/newsroom/welcome-home/','Apple announces its Welcome Home event'),entry('https://example.com/cooking','How to cook rice')];
 const result={url:'https://www.theverge.com/apple-welcome-home',title:'Apple Welcome Home event: everything announced',text:''};
 assert.deepEqual(findMatches(result,history,{minShared:3})[0].titleShared,['apple','welcome','home','event']);
 // Common words do not count: "how", "to" alone do not tie an unrelated title to the cooking page.
 assert.equal(findMatches({url:'https://x.test/a',title:'How to install the new iOS',text:''},history,{minShared:2}).length,0);
});
test('a history entry matches only when it shares at least minShared words; no fuzzy matching',()=>{
 const history=[
  entry('https://example.com/a','Routine programming tasks are automated by AI'), // ai, routine, programming, tasks
  entry('https://example.com/b','Programming tasks for beginners'),                // programming, tasks
  entry('https://example.com/c','Automated routines in programming'),              // programming only: no stemming
 ];
 assert.deepEqual(findMatches(post,history,{minShared:3}).map(m=>m.url),['https://example.com/a']);
 assert.deepEqual(findMatches(post,history,{minShared:2}).map(m=>m.url),['https://example.com/a','https://example.com/b']);
 assert.deepEqual(findMatches(post,history,{minShared:3})[0].titleShared,['routine','programming','tasks','ai']);
});
test('the same Reddit post always matches, across old/www and slugs, and is listed first',()=>{
 const history=[
  entry('https://example.com/a','Routine programming tasks are automated by AI',1),
  entry('https://old.reddit.com/r/technology/comments/ABC123/','Totally different title',5),
 ];
 const found=findMatches(post,history,{minShared:3});
 assert.equal(found[0].samePost,true);assert.equal(found.length,2);
});
test('the current page is excluded and duplicate URLs collapse; queries distinguish non-Reddit pages',()=>{
 const history=[
  entry('https://www.reddit.com/r/technology/comments/abc123/x/','AI routine programming tasks'),
  entry('https://www.youtube.com/watch?v=1','AI routine programming tasks explained'),
  entry('https://www.youtube.com/watch?v=2','AI routine programming tasks again'),
  entry('https://www.youtube.com/watch?v=2#t=10','AI routine programming tasks again'),
 ];
 const found=findMatches(post,history,{minShared:3,excludeUrl:'https://old.reddit.com/r/technology/comments/abc123/'});
 assert.deepEqual(found.map(m=>m.url).sort(),['https://www.youtube.com/watch?v=1','https://www.youtube.com/watch?v=2']);
 assert.equal(canonicalUrl('https://example.com/a/?q=1#x'),'https://example.com/a?q=1');
});
test('title words weigh 1 and text-only words weigh half',()=>{
 const history=[entry('https://example.com/a','Routine programming tasks handled by AI')];
 const vague={url:'https://example.com/post',title:'You will not believe this'};
 assert.equal(findMatches(vague,history,{minShared:3}).length,0);
 // Five text words score 2.5: below 3, enough for 2.
 const text='routine programming tasks handled AI';
 assert.equal(findMatches({...vague,text},history,{minShared:3}).length,0);
 const [match]=findMatches({...vague,text},history,{minShared:2});
 assert.deepEqual(match.textShared,['routine','programming','tasks','handled','ai']);assert.equal(match.score,2.5);
 // Two title words plus two text words score 3.
 const mixed=findMatches({url:'https://example.com/p',title:'AI handles routine work',text:'programming tasks'},history,{minShared:3})[0];
 assert.deepEqual(mixed.titleShared,['routine','ai']);assert.deepEqual(mixed.textShared,['programming','tasks']);assert.equal(mixed.score,3);
 // A word in both title and text counts once, as a title word.
 assert.deepEqual(findMatches({url:'https://example.com/q',title:'Routine programming tasks',text:'routine programming tasks'},history,{minShared:3})[0].textShared,[]);
});
test('untitled history pages still match by URL',()=>{
 assert.equal(findMatches({url:'https://example.com/a/',title:'Anything'},[entry('https://example.com/a','')],{minShared:3})[0].samePost,true);
});
test('ties sort by shared word count, then most recent visit',()=>{
 const history=[
  entry('https://example.com/old','AI routine programming tasks',48),
  entry('https://example.com/new','AI routine programming tasks',1),
  entry('https://example.com/most','AI automating routine programming tasks',72),
 ];
 assert.deepEqual(findMatches(post,history,{minShared:3}).map(m=>m.url),['https://example.com/most','https://example.com/new','https://example.com/old']);
});
