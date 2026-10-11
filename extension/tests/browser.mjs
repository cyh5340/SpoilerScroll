import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { resolve, join } from 'node:path';
const profile=await mkdtemp(join(tmpdir(),'spoilerscroll-browser-'));
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
  headless:true,...(executablePath?{executablePath}:{channel:'chromium'}),viewport:{width:1100,height:850},
  args:[`--disable-extensions-except=${resolve('dist')}`,`--load-extension=${resolve('dist')}`],
});
const errors=[];
try {
 const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
 const id=new URL(worker.url()).host;
 const popup=await context.newPage();popup.on('pageerror',e=>errors.push(e.message));
 await popup.goto(`chrome-extension://${id}/popup.html`);
 await popup.waitForFunction(()=>document.querySelector('#mode').textContent==='Paused');
 await popup.locator('#setup').evaluate(el=>el.open=true);
 await popup.locator('#enable').click();
 assert.match(await popup.locator('#status').innerText(),/accept remote processing/);
 await popup.locator('#setup').evaluate(el=>el.open=false);
 await popup.screenshot({path:'dist/popup-preview.png'});
 let network=0;context.on('request',request=>{if(request.url().startsWith('http'))network++;});
 const fixturePage=context.waitForEvent('page');
 await popup.locator('#demo').click();
 const page=await fixturePage;page.on('pageerror',e=>errors.push(e.message));
 await page.waitForLoadState();await page.bringToFront();
 await page.locator('#fixture-1').scrollIntoViewIfNeeded();
 await page.waitForTimeout(1000);
 assert.equal(await page.locator('[data-view-count]').innerText(),'0','short exposures are not qualified');
 for(const number of [1,2,3]) {
   await page.locator(`#fixture-${number}`).scrollIntoViewIfNeeded();
   await page.waitForTimeout(3700);
 }
 await page.waitForFunction(()=>document.querySelector('[data-view-count]').textContent==='3');
 await page.locator('#fixture-4').scrollIntoViewIfNeeded();
 await page.waitForSelector('#fixture-4 [data-spoilerscroll-ui="badge"]');
 await page.screenshot({path:'dist/demo-feed.png',fullPage:false});
 // Keyboard activation gets the same intervention as a normal click.
 await page.locator('a[data-story="fixture-4"]').focus();await page.keyboard.press('Enter');
 await page.getByRole('dialog').waitFor();
 assert.match(await page.getByRole('dialog').innerText(),/visible preview only/);
 await page.screenshot({path:'dist/demo-spoiler.png'});
 // Native modal focus remains in the dialog and Escape restores the link.
 await page.keyboard.press('Tab');
 assert.equal(await page.evaluate(()=>document.querySelector('[data-spoilerscroll-ui="overlay"]').shadowRoot.activeElement?.closest('dialog')!==null),true);
 await page.keyboard.press('Escape');
 assert.equal(await page.getByRole('dialog').count(),0);
 assert.equal(await page.locator('a[data-story="fixture-4"]').evaluate(el=>el===document.activeElement),true);
 // Reset local cooldown for independent behavior checks.
 const resetIntervention=()=>worker.evaluate(async()=>{const {spoilerscroll:s}=await chrome.storage.local.get('spoilerscroll');s.lastIntervention=0;s.intervened=[];await chrome.storage.local.set({spoilerscroll:s});});
 await resetIntervention();
 await page.locator('a[data-story="fixture-4"]').click();await page.getByRole('button',{name:'Skip this',exact:true}).click();
 assert.equal(new URL(page.url()).search,'');
 const stats=await worker.evaluate(async()=>(await chrome.storage.local.get('spoilerscroll')).spoilerscroll.stats);
 assert.equal(stats.skipped,1);
 await resetIntervention();
 await page.locator('a[data-story="fixture-4"]').click();await page.getByRole('button',{name:'Read anyway',exact:true}).click();
 await page.waitForURL('**?story=fixture-4');
 assert.equal(await page.getByRole('dialog').count(),0);
 await page.goto(`chrome-extension://${id}/fixture.html`);
 await page.locator('#fixture-5').scrollIntoViewIfNeeded();await page.waitForTimeout(500);
 assert.equal(await page.locator('#fixture-5 [data-spoilerscroll-ui="badge"]').count(),0);
 await page.locator('a[data-story="fixture-5"]').click();await page.waitForURL('**?story=fixture-5');
 // Pause closes a currently open dialog and removes cached badges.
 await page.goto(`chrome-extension://${id}/fixture.html`);await resetIntervention();
 await page.locator('#fixture-4').scrollIntoViewIfNeeded();await page.waitForSelector('#fixture-4 [data-spoilerscroll-ui="badge"]');
 await page.locator('a[data-story="fixture-4"]').click();await page.getByRole('button',{name:'Pause spoilers',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[data-fixture-state]').textContent==='Paused');
 assert.equal(await page.getByRole('dialog').count(),0);
 assert.equal(await page.locator('[data-spoilerscroll-ui="badge"]').count(),0);
 assert.equal(network,0,'fixtures must never send remote requests');
 assert.deepEqual(errors,[]);
 console.log('Browser checks passed: dwell, keyboard activation, Escape/focus, skip, read anyway, new evidence, pause, and fixture isolation.');
} finally {await context.close();await rm(profile,{recursive:true,force:true});}
