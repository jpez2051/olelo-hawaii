import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve(new URL('../',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'));
const server=http.createServer(async(req,res)=>{
 try {const pathname=new URL(req.url,'http://localhost').pathname; const file=path.join(root,pathname==='/'?'index.html':pathname);let text=await fs.readFile(file,'utf8');
 if(pathname==='/js/app.js') text+='\nexport {startLesson, showNextActivity}; export function testState(){return {currentActivity,progress,activities,practiceQueue};}';
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':file.endsWith('.css')?'text/css':'text/html');res.end(text);
 }catch{res.statusCode=404;res.end('Not found');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
try{
const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(`http://127.0.0.1:${server.address().port}`);
await page.waitForFunction(()=>document.querySelector('#curriculum-status').textContent.includes('activities loaded'));
await page.evaluate(async()=>{window.testApp=await import('/js/app.js?v=7.3.0');});
const ids=await page.evaluate(()=>[...new Set(testApp.testState().activities.filter(a=>a.unitMode!=='immersion').map(a=>a.lessonId))]);let count=0;
for(const id of ids){
 await page.evaluate(id=>testApp.startLesson(id,true),id);
 while(await page.evaluate(()=>!!testApp.testState().currentActivity) || await page.locator('#round-continue-btn').isVisible()) {
  if(!await page.evaluate(()=>!!testApp.testState().currentActivity)) { await page.locator('#round-continue-btn').click(); }
  const a=await page.evaluate(()=>testApp.testState().currentActivity);
  if (['sentence-study','foundation-study'].includes(a.type)) {
   assert.equal(await page.locator('#sentence-language-note').isVisible(), !!a.languageNote?.trim(), a.id + ': note visibility');
   assert.equal(await page.locator('#sentence-parts').isVisible(), !!a.parts?.length, a.id + ': parts visibility');
  } else if(a.type !== 'study-hide-recall') assert(await page.locator('#word-meanings').isHidden(), a.id + ': dictionary must not reveal answers');
  await page.evaluate(a=>{
   const click=s=>document.querySelector(s).click();
   if(['sentence-study','foundation-study'].includes(a.type)) click('#sentence-continue-btn');
   else if(a.type==='guided-listening') click('#listening-skip-btn');
   else if(a.type==='sentence-choice') { [...document.querySelectorAll('.choice-option')].find(b=>b.dataset.answer===a.answer).click();click('#choice-check-btn'); }
   else {if(a.type==='study-hide-recall'){click('#hide-and-recall-btn');click('#skip-paper-btn');} document.querySelector('#answer-input').value=a.answer;click('#check-btn');}
  },a);
  if(!['sentence-study','foundation-study','guided-listening'].includes(a.type)){
   assert.match(await page.locator('#feedback').innerText(),/^Correct/,a.id);
   await page.evaluate(a=>document.querySelector(a.type==='sentence-choice'?'#choice-next-btn':'#next-btn').click(),a);
  }
  count++;
 }
}
assert(await page.locator('#round-actions').isVisible());
// Verify saved section progress survives reload.
await page.evaluate(()=>testApp.startLesson('pronunciation-01',true));
const firstId = await page.evaluate(()=>testApp.testState().currentActivity.id);
await page.locator('#sentence-continue-btn').click();
const nextId = await page.evaluate(()=>testApp.testState().currentActivity.id);
assert.notEqual(firstId,nextId);
await page.reload();
await page.waitForFunction(()=>document.querySelector('#curriculum-status').textContent.includes('activities loaded'));
await page.evaluate(async()=>{window.testApp=await import('/js/app.js?v=7.3.0');testApp.startLesson('pronunciation-01');});
assert.equal(await page.evaluate(()=>testApp.testState().currentActivity.id),nextId);
// Verify that the recall answer is not exposed through Sound guide.
await page.evaluate(()=>testApp.startLesson('orthography-01',true));
assert(await page.locator('#sound-guide').isHidden());
assert(await page.locator('#word-meanings').isHidden());
await page.evaluate(()=>{document.querySelector('#answer-input').value='wrong';document.querySelector('#check-btn').click();});
const before=await page.evaluate(()=>testApp.testState().progress.reviews[testApp.testState().currentActivity.id].dueAt);
await page.evaluate(()=>document.querySelector('#retry-btn').click());
await page.evaluate(()=>{document.querySelector('#answer-input').value=testApp.testState().currentActivity.answer;document.querySelector('#check-btn').click();});
assert.equal(await page.evaluate(()=>testApp.testState().progress.reviews[testApp.testState().currentActivity.id].dueAt),before);
assert.equal(await page.evaluate(()=>testApp.testState().progress.evidence[testApp.testState().currentActivity.id].successes.retry),1);
assert.match(await page.locator('#feedback').innerText(), /Recorded as correction practice/);
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
assert.equal(count,346);
await page.evaluate(()=>{testApp.startLesson('listening-01',true);});
assert(await page.locator('#listening-continue-btn').isDisabled());
await page.locator('#listening-panel details summary').click();
await page.locator('#listening-reflection').selectOption('uncertain');
assert.match(await page.locator('#listening-reflection-status').innerText(), /Replay a short passage/);
await page.locator('#listening-confirm').check();
const listeningId=await page.evaluate(()=>testApp.testState().currentActivity.id);
await page.locator('#listening-continue-btn').click();
assert.equal(await page.evaluate(id=>testApp.testState().progress.listening[id].reflection,listeningId),'uncertain');
await page.locator('.nav-btn[data-view="progress"]').click();
assert(await page.locator('#progress-next-btn').isVisible());
assert.deepEqual(errors,[]);
await page.screenshot({path:process.env.SCREENSHOT_PATH || 'browser-check.png',fullPage:true});
console.log(`PASS: traversed ${count} activities; mobile layout, answer concealment, retry scheduling, no runtime errors.`);
}finally{await browser.close();server.close();}

