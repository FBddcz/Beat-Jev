import test from 'node:test';
import assert from 'node:assert/strict';
import { decideWithJev } from '../jev.mjs';
const state={role:'evader',history:[]};
const actions=async()=>{};
test('Jev request only exposes two choices and validates response',async()=>{let body;const result=await decideWithJev({key:'test-key',model:'jev-fixture'},state,{fetcher:async(url,init)=>{body=JSON.parse(init.body);return new Response(JSON.stringify({model:'jev-fixture',answers:{direction:{type:'choice',choice:'left',probabilities:{left:.8,right:.2}}}}));}});assert.equal(result.choice,'left');assert.equal(body.questions.direction.criteria.left.name,'Left');assert.deepEqual(Object.keys(body.questions.direction.criteria),['left','right']);assert.ok(!JSON.stringify(body).includes('test-key'));assert.ok(!JSON.stringify(body).includes('pending'));});
test('invalid, quota and malformed responses are errors',async()=>{await assert.rejects(decideWithJev({key:'x'},state,{fetcher:async()=>new Response(JSON.stringify({answers:{direction:{type:'choice',choice:'up'}}}))}),/有效/);await assert.rejects(decideWithJev({key:'x'},state,{fetcher:async()=>new Response('',{status:429})}),/额度/);await assert.rejects(decideWithJev({key:'x'},state,{fetcher:async()=>new Response('not json')}),/格式/);});
