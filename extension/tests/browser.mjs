import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { resolve, join } from 'node:path';
const profile=await mkdtemp(join(tmpdir(),'spoilerscroll-browser-'));
// Optional-permission prompts cannot be clicked headlessly, so the test copy grants history and all sites up front.
const extension=await mkdtemp(join(tmpdir(),'spoilerscroll-extension-'));
await cp(resolve('dist'),extension,{recursive:true});
const manifest=JSON.parse(await readFile(join(extension,'manifest.json'),'utf8'));
manifest.permissions.push('history');manifest.host_permissions=manifest.optional_host_permissions;
await writeFile(join(extension,'manifest.json'),JSON.stringify(manifest));
// Prefer the current Playwright install, then an existing cached Chromium.
function findChromium() {
 if(process.env.CHROMIUM_PATH)return process.env.CHROMIUM_PATH;
 if(existsSync(chromium.executablePath()))return chromium.executablePath();
 const cache=process.platform==='darwin'?join(homedir(),'Library/Caches/ms-playwright'):join(homedir(),'.cache/ms-playwright');
 if(!existsSync(cache))return undefined;
 const versions=readdirSync(cache).filter(name=>/^chromium-\d+$/.test(name)).sort((a,b)=>Number(b.split('-')[1])-Number(a.split('-')[1]));
 for(const version of versions)for(const suffix of ['chrome-mac/Chromium.app/Contents/MacOS/Chromium','chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium','chrome-linux/chrome','chrome-linux64/chrome','chrome-win/chrome.exe']) {
   const path=join(cache,version,suffix);if(existsSync(path))return path;
 }
}
const executablePath=findChromium();
if(!executablePath)throw new Error('Chromium is missing. Run npx playwright install chromium in extension/, or set CHROMIUM_PATH.');
const context=await chromium.launchPersistentContext(profile,{
  headless:true,executablePath,viewport:{width:1100,height:850},
  args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],
});
const errors=[];
// Stand-ins for Reddit, a video site and a news site, served locally so real history entries exist without network access.
const page$=(title,body='')=>`<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;
const card=(id,title)=>`<div class="thing link"><a class="title" href="/r/technology/comments/${id}/slug/">${title}</a><p>Preview text</p></div>`;
const sites={
  'https://old.reddit.com/r/technology/comments/aaa111/slug/':page$('AI tools are automating routine programming tasks : technology'),
  'https://www.youtube.com/watch?v=demo':page$('Routine programming tasks automated by AI - YouTube'),
  'https://news.example.com/':page$('Example News','<nav><a href="https://news.example.com/topics/ai">Routine programming tasks automated by AI</a></nav>'+
    '<article><h2><a href="https://news.example.com/week">Five things to know about AI this week</a></h2><p>Routine programming tasks automated by AI is the big story.</p></article>'+
    '<aside><a href="https://news.example.com/week" target="_blank">More</a></aside>'+
    '<article><h2><a href="https://news.example.com/ocean">Scientists map the deepest ocean trench</a></h2><p>A survey of the Pacific floor.</p></article>'),
  'https://news.example.com/ocean':page$('Ocean trench story - Example News'),
  'https://old.reddit.com/r/technology/':page$('technology',card('bbb222','AI is automating routine programming tasks')+card('ccc333','Scientists map the deepest trench in the Pacific Ocean')+card('aaa111','A headline with nothing in common')+'<div style="height:2000px"></div>'),
};
await context.route(/^https:\/\/(old\.reddit\.com|www\.youtube\.com|news\.example\.com)\//,route=>{
  const body=sites[route.request().url()];
  return body?route.fulfill({contentType:'text/html',body}):route.fulfill({status:404,body:''});
});
try {
 const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
 const id=new URL(worker.url()).host;
 const stats=()=>worker.evaluate(async()=>(await chrome.storage.local.get('spoilerscroll-v2'))['spoilerscroll-v2']?.stats);
 const popup=await context.newPage();popup.on('pageerror',e=>errors.push(e.message));
 await popup.goto(`chrome-extension://${id}/popup.html`);
 await popup.waitForFunction(()=>document.querySelector('#mode').textContent==='Off');
 assert.equal(await popup.locator('#enable').isVisible(),true,'while off, turning it on is the main action');
 await popup.screenshot({path:'dist/popup-preview.png'});

 // Scripted demo page (not linked from the popup): no real history and no network.
 let network=0;const countNetwork=request=>{if(request.url().startsWith('http'))network++;};context.on('request',countNetwork);
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`chrome-extension://${id}/fixture.html`);
 await page.waitForSelector('#fixture-1 [data-spoilerscroll-ui="badge"]');
 await page.waitForSelector('#fixture-2 [data-spoilerscroll-ui="badge"]');
 assert.equal(await page.locator('#fixture-3 [data-spoilerscroll-ui="badge"]').count(),0,'unrelated title stays untouched');
 assert.match(await page.locator('[data-spoilerscroll-ui="notice"] span').innerText(),/2 of 3 links/);
 await page.locator('#fixture-1').scrollIntoViewIfNeeded();
 await page.screenshot({path:'dist/demo-feed.png'});
 // Keyboard activation gets the same notice as a normal click; it lists the matching history URLs.
 await page.locator('a[data-story="fixture-1"]').focus();await page.keyboard.press('Enter');
 const dialog=page.getByRole('dialog');await dialog.waitFor();
 assert.match(await dialog.innerText(),/You have opened 3 similar pages/);
 assert.match(await dialog.innerText(),/fixture\.html\?history=1/);
 assert.match(await dialog.innerText(),/shared: ai, automating, routine, programming, tasks, developers \(title\)/);
 await page.screenshot({path:'dist/demo-notice.png'});
 await page.keyboard.press('Escape');
 assert.equal(await dialog.count(),0);
 assert.equal(await page.locator('a[data-story="fixture-1"]').evaluate(el=>el===document.activeElement),true);
 await page.locator('a[data-story="fixture-1"]').click();await page.getByRole('button',{name:'Skip this',exact:true}).click();
 assert.equal(new URL(page.url()).search,'');
 assert.equal((await stats()).skipped,1);
 await page.locator('a[data-story="fixture-2"]').click();await page.getByRole('button',{name:'Read anyway',exact:true}).click();
 await page.waitForURL('**?story=fixture-2');
 assert.equal((await stats()).continued,1);
 await page.goto(`chrome-extension://${id}/fixture.html`);
 await page.waitForSelector('#fixture-1 [data-spoilerscroll-ui="badge"]');
 await page.locator('a[data-story="fixture-3"]').click();await page.waitForURL('**?story=fixture-3');
 // Raising the shared-word threshold drops the weaker match.
 await popup.locator('#words').selectOption('6');
 await page.goto(`chrome-extension://${id}/fixture.html`);
 await page.waitForSelector('#fixture-1 [data-spoilerscroll-ui="badge"]');
 assert.equal(await page.locator('#fixture-2 [data-spoilerscroll-ui="badge"]').count(),0);
 await popup.locator('#words').selectOption('3');
 // Pause from the notice closes it and removes badges.
 await page.goto(`chrome-extension://${id}/fixture.html`);
 await page.waitForSelector('#fixture-1 [data-spoilerscroll-ui="badge"]');
 await page.locator('a[data-story="fixture-1"]').click();await page.getByRole('button',{name:'Pause SpoilerScroll',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[data-fixture-state]').textContent==='Paused');
 assert.equal(await page.locator('[data-spoilerscroll-ui="badge"]').count(),0);
 assert.equal(network,0,'the demo must never send requests');
 context.off('request',countNetwork);
 await popup.waitForFunction(()=>document.querySelector('#pause').textContent==='Resume');
 await popup.locator('#pause').click();
 await popup.waitForFunction(()=>document.querySelector('#pause').textContent==='Pause');

 // Real chrome.history: visit two pages, then open a Reddit feed.
 const reddit=await context.newPage();reddit.on('pageerror',e=>errors.push(e.message));
 await reddit.goto('https://old.reddit.com/r/technology/comments/aaa111/slug/');
 await reddit.goto('https://www.youtube.com/watch?v=demo');
 await popup.evaluate(()=>chrome.runtime.sendMessage({type:'SETTINGS',patch:{enabled:true}}));
 await popup.waitForFunction(()=>document.querySelector('#mode').textContent==='On');
 assert.equal(await popup.locator('#enable').isVisible(),false);
 await reddit.goto('https://old.reddit.com/r/technology/');
 const badgeFor=postId=>reddit.locator(`.thing:has(a[href*="${postId}"]) [data-spoilerscroll-ui="badge"]`);
 await badgeFor('bbb222').waitFor({state:'attached'});
 await badgeFor('aaa111').waitFor({state:'attached'});
 assert.equal(await badgeFor('ccc333').count(),0);
 const status=await worker.evaluate(async()=>{
   const [tab]=(await chrome.tabs.query({url:'https://old.reddit.com/r/technology/'}));
   return chrome.tabs.sendMessage(tab.id,{type:'PAGE_STATUS'});
 });
 assert.equal(status.flagged,2);assert.equal(status.cards,3);
 // On Reddit the notice lives in a closed shadow root, so assert on its effects: navigation held, stat recorded.
 const shown=(await stats()).shown;
 await reddit.locator('a[href*="bbb222"]').click();
 await reddit.waitForSelector('[data-spoilerscroll-ui="overlay"]',{state:'attached'});
 assert.equal(new URL(reddit.url()).pathname,'/r/technology/');
 assert.equal((await stats()).shown,shown+1);
 assert.equal(await reddit.evaluate(()=>document.querySelector('[data-spoilerscroll-ui="overlay"]').shadowRoot),null,'page scripts cannot read history from the notice');
 await reddit.keyboard.press('Escape');
 await reddit.waitForSelector('[data-spoilerscroll-ui="overlay"]',{state:'detached'});
 // Any other site: every link counts; one title word plus preview words make the match.
 await reddit.goto('https://news.example.com/');
 const articleBadge=postPath=>reddit.locator(`article:has(a[href$="${postPath}"]) [data-spoilerscroll-ui="badge"]`);
 await articleBadge('/week').waitFor({state:'attached'});
 assert.equal(await articleBadge('/ocean').count(),0);
 assert.equal(await reddit.locator('nav [data-spoilerscroll-ui="badge"]').count(),0,'menu links are not checked');
 assert.equal(await reddit.locator('[data-spoilerscroll-ui="notice"]').count(),1);
 await reddit.locator('article a[href$="/week"]').click();
 await reddit.waitForSelector('[data-spoilerscroll-ui="overlay"]',{state:'attached'});
 assert.equal(new URL(reddit.url()).pathname,'/');
 await reddit.keyboard.press('Escape');
 // New-tab links and Ctrl/⌘-clicks are caught too; no tab opens until Read anyway.
 const pagesBefore=context.pages().length;
 for(const click of [()=>reddit.locator('aside a').click(),()=>reddit.locator('article a[href$="/week"]').click({modifiers:['ControlOrMeta']})]) {
   await click();
   await reddit.waitForSelector('[data-spoilerscroll-ui="overlay"]',{state:'attached'});
   await reddit.keyboard.press('Escape');
   await reddit.waitForSelector('[data-spoilerscroll-ui="overlay"]',{state:'detached'});
 }
 assert.equal(context.pages().length,pagesBefore);
 // Reported bug: open a post, go back, click the same post again right away. It is now in history, so it must be caught.
 await reddit.locator('a[href$="/ocean"]').click();
 await reddit.waitForURL('https://news.example.com/ocean');
 await reddit.goBack();
 await reddit.locator('a[href$="/ocean"]').click();
 await reddit.waitForSelector('[data-spoilerscroll-ui="overlay"]',{state:'attached',timeout:3000});
 assert.equal(new URL(reddit.url()).pathname,'/','the revisit is held for the notice');
 await reddit.keyboard.press('Escape');
 assert.deepEqual(errors,[]);
 console.log('Browser checks passed: demo matching and threshold, history URLs in the notice, keyboard/Escape, skip, read anyway, pause, no demo network, and real chrome.history matching on a Reddit feed and a generic news page, including new-tab and Ctrl/⌘ clicks.');
} finally {await context.close();await rm(profile,{recursive:true,force:true});await rm(extension,{recursive:true,force:true});}
