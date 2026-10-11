import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DwellTracker,allowedRedditPage,cleanPostUrl,normalNavigation} from '../dist/policy.mjs';

test('qualification requires continuous visible dwell in an active tab',()=>{
 const d=new DwellTracker();
 assert.equal(d.update('one',.5,true,0),false);
 assert.equal(d.update('one',.5,true,2999),false);
 assert.equal(d.update('one',.49,true,3000),false);
 assert.equal(d.update('one',1,true,4000),false);
 assert.equal(d.update('one',1,false,6999),false);
 assert.equal(d.update('one',1,true,7000),false);
 assert.equal(d.update('one',1,true,10000),true);
 assert.equal(d.update('one',1,true,15000),false);
 d.retry('one');assert.equal(d.update('one',1,true,16000),false);
 assert.equal(d.update('one',1,true,19000),true);
});
test('private routes and unapproved origins are excluded; tracking is removed',()=>{
 for(const url of ['https://www.reddit.com/','https://old.reddit.com/r/programming/new/','https://www.reddit.com/r/technology/','https://www.reddit.com/r/test/comments/abc/title/'])assert.equal(allowedRedditPage(url),true,url);
 for(const url of ['https://www.reddit.com/search/?q=rea&type=posts','https://www.reddit.com/r/programming/search/?q=rea'])assert.equal(allowedRedditPage(url),true,url);
 for(const path of ['/message/inbox','/settings','/user/me','/chat','/search/?type=comments','/r/test/submit'])assert.equal(allowedRedditPage('https://www.reddit.com'+path),false,path);
 assert.equal(allowedRedditPage('https://reddit.com.evil.test/'),false);
 assert.equal(cleanPostUrl('/r/test/comments/abc/title/?utm_source=x#thing','https://www.reddit.com/'),'https://www.reddit.com/r/test/comments/abc/title/');
 assert.equal(cleanPostUrl('https://evil.test/r/test/comments/abc/','https://www.reddit.com/'),null);
});
test('only plain same-tab link activation may be intercepted',()=>{
 const e={button:0,ctrlKey:false,metaKey:false,shiftKey:false,altKey:false,defaultPrevented:false};
 assert.equal(normalNavigation(e,{target:'',download:false}),true);
 for(const patch of [{button:1},{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{defaultPrevented:true}])assert.equal(normalNavigation({...e,...patch},{target:'',download:false}),false);
 assert.equal(normalNavigation(e,{target:'_blank',download:false}),false);
 assert.equal(normalNavigation(e,{target:'',download:true}),false);
});
