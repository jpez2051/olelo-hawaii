import assert from 'node:assert/strict';
import fs from 'node:fs';
import { gradeAnswer } from '../js/grading.js';
import { recordEvidence, evidenceTotals, mixedQueue, evidenceKind } from '../js/learning.js';
const root = new URL('../', import.meta.url);
const curriculum = JSON.parse(fs.readFileSync(new URL('data/curriculum.json',root)));
const lessons = curriculum.units.flatMap(u=>u.lessons).filter(l=>l.status==='active').map(l=>JSON.parse(fs.readFileSync(new URL(l.path,root))));
const activities=lessons.flatMap(l=>l.activities);
assert.equal(new Set(activities.map(a=>a.id)).size,activities.length);
assert(activities.length>340);
for(const l of lessons) for(const a of l.activities) {
  assert(a.sourceRefs?.length,`${a.id}: source required`);
  if(a.type==='sentence-choice') assert(a.options.includes(a.answer),a.id);
  if(!['sentence-study','foundation-study','guided-listening'].includes(a.type)) assert(a.answer,a.id);
  if(a.model && a.prompt?.includes('______')) assert.equal(a.prompt.replace('______',a.answer),a.model,a.id);
}
const p={type:'sentence-recall',answerLanguage:'haw',skill:'pronouns'};
let e=recordEvidence(null,p,'correct',{now:1000});
e=recordEvidence(e,p,'correct',{now:2000});assert.equal(e.delayed.production,undefined);
e=recordEvidence(e,p,'correct',{now:86402000});assert.equal(e.delayed.production,1);
e=recordEvidence(e,p,'correct',{now:172803000,helped:true});assert.equal(e.delayed.production,1);
e=recordEvidence(e,p,'correct',{now:259204000,retry:true});assert.equal(e.delayed.production,1);
assert.equal(evidenceTotals({e}).supported,1);assert.equal(evidenceTotals({e}).retry,1);
assert.equal(evidenceKind({type:'sentence-choice',transfer:true}),'recognition');
assert.equal(gradeAnswer('makou','mākou').status,'almost');
assert.equal(gradeAnswer("'oe",'ʻoe').status,'correct');
assert.equal(gradeAnswer('māua','kāua').status,'incorrect');
assert.deepEqual(mixedQueue([{id:1,skill:'a'},{id:2,skill:'a'},{id:3,skill:'b'}],3).map(a=>a.id),[1,3,2]);
console.log(`PASS: ${lessons.length} lessons, ${activities.length} activities; traceability, cloze forms, grading, evidence and mixed review.`);
