import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cleanPostUrl,clickIntent,supportedPage} from '../dist/policy.mjs';

test('any web page is supported; Reddit post URLs lose tracking',()=>{
 for(const url of ['https://www.reddit.com/message/inbox','https://news.ycombinator.com/','http://example.com/a?b=1'])assert.equal(supportedPage(url),true,url);
 for(const url of ['chrome://settings','file:///tmp/a.html','not a url'])assert.equal(supportedPage(url),false,url);
 assert.equal(cleanPostUrl('/r/test/comments/abc/title/?utm_source=x#thing','https://www.reddit.com/'),'https://www.reddit.com/r/test/comments/abc/title/');
 assert.equal(cleanPostUrl('https://evil.test/r/test/comments/abc/','https://www.reddit.com/'),null);
});
test('every way of opening a link is intercepted; Read anyway keeps same-tab vs new-tab intent',()=>{
 const e={button:0,ctrlKey:false,metaKey:false,shiftKey:false};
 assert.equal(clickIntent(e,{target:'',download:false}),'same');
 assert.equal(clickIntent(e,{target:'_self',download:false}),'same');
 assert.equal(clickIntent(e,{target:'_blank',download:false}),'new');
 for(const patch of [{button:1},{ctrlKey:true},{metaKey:true},{shiftKey:true}])assert.equal(clickIntent({...e,...patch},{target:'',download:false}),'new');
 assert.equal(clickIntent({...e,button:2},{target:'',download:false}),null);
 assert.equal(clickIntent(e,{target:'',download:true}),null);
});
