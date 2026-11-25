import test from "node:test";
import assert from "node:assert/strict";
import { handle } from "../worker.mjs";
import { checkRoster, checkZip, defaultPolicy, emptyLedger, teacherReport } from "../course.mjs";
import { privateRepositoryStore, url64 } from "../github.mjs";

const env = {SESSION_KEY:"local-test-session-key-for-course-only",GH_CLIENT_ID:"local-client",GH_CLIENT_SECRET:"local-secret"};
const alpha = {id:"TEST001",name:"测试甲",college:"测试学院",topics:[8,14]};
const beta = {id:"TEST002",name:"测试乙",college:"测试学院",topics:[8]};
const now = () => crypto.randomUUID();

function zip(content) {
  const data = Buffer.from(content);
  const name = Buffer.from("course.txt");
  let crc = -1;
  for (const byte of data) {
    crc ^= byte;
    for (let bit=0; bit<8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  crc = (crc ^ -1) >>> 0;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20,4); local.writeUInt32LE(crc,14);
  local.writeUInt32LE(data.length,18); local.writeUInt32LE(data.length,22); local.writeUInt16LE(name.length,26);
  const directory = Buffer.alloc(46);
  directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20,4); directory.writeUInt16LE(20,6);
  directory.writeUInt32LE(crc,16); directory.writeUInt32LE(data.length,20); directory.writeUInt32LE(data.length,24); directory.writeUInt16LE(name.length,28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1,8); end.writeUInt16LE(1,10);
  end.writeUInt32LE(directory.length + name.length,12); end.writeUInt32LE(local.length + name.length + data.length,16);
  return Buffer.concat([local,name,data,directory,name,end]);
}

function fixture(roster=[]) {
  const db = {head:0, roster:structuredClone(roster),policy:{...defaultPolicy},ledger:emptyLedger()};
  const files = new Map();
  const store = {
    snapshot:async () => structuredClone(db), blob:async bytes => url64(bytes),
    async commit(snap, entries) {
      if (store.failure) throw Error("interrupted");
      if (db.head !== snap.head) return false;
      db.head++;
      db.ledger = snap.ledger;
      for (const file of entries) files.set(file.path,file.sha || file.content);
      return true;
    }
  };
  const request = async (path, {json, bytes, token, headers={}, identify} = {}) => {
    if (token) headers.Authorization = "Bearer " + token;
    const req = new Request("https://example.test/api/" + path, {method:json || bytes ? "POST":"GET",headers,body:bytes || (json && JSON.stringify(json))});
    const res = await handle(req, env, async()=>store, identify);
    return {status:res.status, data:await res.json()};
  };
  const login = async s => (await request("enter",{json:s})).data.token;
  const upload = (token, topic, bytes, {key=now(), filename="作业.zip", expected=0}={}) => request("topics/"+topic+"/upload",
    {bytes,token,headers:{"Idempotency-Key":key,"X-Filename":encodeURIComponent(filename),"X-Expected-Version":String(expected)}});
  return {db,store,files,request,login,upload};
}

test("self-reported entry exposes 23 topics without reserving a place or storing a visitor",async()=>{
  const f = fixture();
  const course = (await f.request("course")).data;
  assert.equal(course.published,true);
  assert.equal(course.topics.length,23);
  assert.ok(course.topics.every(t=>t.status==="open"));
  assert.equal((await f.request("enter",{json:{...alpha,id:"../01"}})).status,400);
  assert.equal((await f.request("enter",{json:{...alpha,college:" "}})).status,400);
  const a = await f.login(alpha);
  const view = await f.request("me",{token:a});
  assert.equal(view.data.id,alpha.id);
  assert.equal(view.data.topics[22].number,23);
  assert.equal((await f.request("roster",{json:beta})).status,200);
  assert.equal(f.db.head,0);
  assert.deepEqual(f.db.ledger.students,[]);
  assert.equal((await f.upload(a,24,zip("invalid topic"))).status,404);
  assert.equal((await f.upload(null,23,zip("unsigned"))).status,401);
});

test("one owner for a topic, explicit updates, retry receipts and private history",async()=>{
  const f=fixture(), a=await f.login(alpha), b=await f.login(beta), key=now();
  const first=await f.upload(a,23,zip("one"),{key});
  assert.equal(first.data.version,1);
  assert.deepEqual(await f.upload(a,23,zip("one"),{key}),first);
  assert.equal((await f.upload(a,23,zip("different"),{key})).status,409);
  assert.equal((await f.upload(a,23,zip("second first submission"))).status,409);
  const other=await f.upload(b,23,zip("other student"));
  assert.equal(other.status,409);
  assert.equal(other.data.code,"topic_taken");
  assert.equal((await f.upload(b,23,zip("other student update"),{expected:1})).status,409);
  const changed=await f.upload(await f.login(alpha),23,zip("two"),{expected:1});
  assert.equal(changed.data.version,2);
  assert.deepEqual(await f.upload(a,23,zip("one"),{key}),first);
  assert.equal(f.db.ledger.students.length,1);
  assert.equal(f.db.ledger.submissions.length,2);
  assert.equal(f.files.get("submissions/topic-23/TEST001/v1.zip"),url64(zip("one")));
  assert.equal(f.files.get("submissions/topic-23/TEST001/v2.zip"),url64(zip("two")));
  assert.deepEqual((await f.request("me",{token:a})).data.topics[22].versions.map(v=>v.version),[2,1]);
  const otherView=(await f.request("me",{token:b})).data.topics[22];
  assert.equal(otherView.status,"taken");
  assert.deepEqual(otherView.versions,[]);
  const listing=await f.request("course");
  assert.equal(listing.data.topics[22].status,"taken");
  assert.ok(!JSON.stringify(listing.data).includes(alpha.id));
  for (const s of f.db.ledger.submissions) assert.ok(f.files.get("README.md").includes(s.path));
  assert.equal((await f.request("enter",{json:{...alpha,name:"不同姓名"}})).status,403);
  assert.equal((await f.request("enter",{json:{...alpha,college:"不同学院"}})).status,403);
});

test("concurrent first submissions and stale updates each have exactly one winner",async()=>{
  const f=fixture(), a=await f.login(alpha), b=await f.login(beta);
  const firsts=await Promise.all([f.upload(a,1,zip("A")), f.upload(b,1,zip("B"))]);
  assert.deepEqual(firsts.map(r=>r.status).sort(),[200,409]);
  const winner=firsts[0].status===200?a:b;
  const updates=await Promise.all([f.upload(winner,1,zip("left"),{expected:1}), f.upload(winner,1,zip("right"),{expected:1})]);
  assert.deepEqual(updates.map(r=>r.status).sort(),[200,409]);
  assert.deepEqual(f.db.ledger.submissions.map(s=>s.version),[1,2]);
  assert.equal(new Set(f.db.ledger.submissions.map(s=>s.id)).size,1);
});

test("GitHub transient object failures retry, while an ambiguous ref response asks for reconciliation",async t=>{
  let treeCalls=0, refCalls=0;
  t.mock.method(globalThis,"fetch",async (url,init)=>{
    const path=new URL(url).pathname;
    if (init.method==="GET") return Response.json({private:true,default_branch:"main"});
    if (path.endsWith("/git/trees")) {
      treeCalls++;
      return treeCalls===1 ? new Response(null,{status:500}):Response.json({sha:"new-tree"});
    }
    if (path.endsWith("/git/commits")) return Response.json({sha:"new-commit"});
    if (path.endsWith("/git/refs/heads/main")) {refCalls++;return new Response(null,{status:500});}
    assert.fail("Unexpected GitHub request");
  });
  const store=await privateRepositoryStore("fixture-token");
  assert.equal(await store.commit({head:"current-head",tree:"current-tree"},[],"fixture"),false);
  assert.equal(treeCalls,2);
  assert.equal(refCalls,1);
});

test("an upload whose Git ref advanced but acknowledgement was lost still saves only v1",async()=>{
  const f=fixture(), a=await f.login(alpha);
  const commit=f.store.commit.bind(f.store);
  f.store.commit=async (...args)=>{assert.ok(await commit(...args));return false;};
  const saved=await f.upload(a,23,zip("one successful commit"));
  assert.equal(saved.status,200);
  assert.equal(saved.data.version,1);
  assert.equal(f.db.ledger.submissions.length,1);
});

test("all 23 catalog entries accept one first submission, reject the next student and allow an owner update",async()=>{
  for (let topic=1; topic<=23; topic++) {
    const f=fixture(), a=await f.login(alpha), b=await f.login(beta);
    assert.equal((await f.upload(a,topic,zip("first"))).data.version,1);
    assert.equal((await f.upload(b,topic,zip("another"))).status,409);
    assert.equal((await f.upload(a,topic,zip("update"),{expected:1})).data.version,2);
    assert.deepEqual(f.db.ledger.submissions.map(s=>s.id),[alpha.id,alpha.id]);
  }
});

test("an early unbound session with different personal details cannot update a later winner's work",async()=>{
  const f=fixture();
  const alternate=await f.login({...alpha,name:"另一位填报者"});
  const owner=await f.login(alpha);
  assert.equal((await f.upload(owner,2,zip("owner"))).status,200);
  assert.equal((await f.upload(alternate,2,zip("incorrect name"),{expected:1})).status,403);
  assert.equal((await f.request("me",{token:alternate})).status,403);
  assert.equal(f.db.ledger.submissions.length,1);
});

test("the personal three-topic limit survives a race; existing work can still be updated",async()=>{
  const f=fixture(), a=await f.login(alpha);
  await f.upload(a,1,zip("one"));
  await f.upload(a,2,zip("two"));
  const contenders=await Promise.all([f.upload(a,3,zip("three")),f.upload(a,4,zip("four"))]);
  assert.deepEqual(contenders.map(r=>r.status).sort(),[200,409]);
  assert.equal((await f.upload(a,1,zip("revised"),{expected:1})).data.version,2);
  const b=await f.login(beta);
  assert.equal((await f.upload(b,5,zip("separate"))).status,200);
});

test("deadline is exclusive, late policy and failed ZIPs preserve the current version",async t=>{
  const cutoff = new Date("2026-12-31T23:59:00+08:00").getTime();
  t.mock.timers.enable({apis:["Date"],now:cutoff-1});
  const f=fixture(), a=await f.login(alpha), bytes=zip("first");
  f.db.policy.deadline = "2026-12-31T23:59:00+08:00";
  assert.equal((await f.upload(a,8,bytes)).status,200);
  t.mock.timers.setTime(cutoff);
  assert.equal((await f.upload(a,8,bytes,{expected:1})).status,403);
  assert.equal((await f.upload(a,9,bytes)).status,403);
  f.db.policy.allowLate = true;
  assert.equal((await f.upload(a,8,bytes,{expected:1})).data.late,true);
  assert.equal((await f.upload(a,8,new Uint8Array([80,75,3,4]))).status,400);
  assert.equal((await f.upload(a,8,bytes,{filename:"../x.zip"})).status,400);
  f.db.policy.maxMiB=1;
  assert.equal((await f.upload(a,8,new Uint8Array(1024*1024+1))).status,413);
  f.store.failure=true;
  assert.equal((await f.upload(a,8,bytes,{expected:2})).status,503);
  assert.equal(f.db.ledger.submissions.length,2);
  assert.equal((await f.request("me",{token:a})).data.topics[7].versions[0].version,2);
});

test("optional GitHub identity binds once, requires the same browser and blocks older self-reported sessions",async()=>{
  const f=fixture(), a=await f.login(alpha), b=await f.login(beta);
  const verifier=url64(crypto.getRandomValues(new Uint8Array(32)));
  const challenge=url64(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(verifier))));
  const start=async(token,mode)=>(await f.request("github/start",{token,json:{mode,challenge}})).data;
  const user={githubId:"120",login:"test-account"};
  const finish=(token,state,v=verifier)=>f.request("github/finish",{token,json:{code:"test",state,verifier:v},identify:async()=>user});
  const flow=await start(a,"bind");
  assert.equal(new URL(flow.url).searchParams.get("code_challenge"),challenge);
  assert.equal((await finish(b,flow.state)).status,403);
  assert.equal((await finish(a,flow.state,"x".repeat(43))).status,403);
  const bound=await finish(a,flow.state);
  assert.equal(bound.data.student.github,user.login);
  assert.equal((await f.request("me",{token:a})).status,401);
  assert.equal((await f.upload(a,8,zip("old"))).status,401);
  assert.equal((await f.request("roster",{json:alpha})).status,403);
  assert.equal((await finish(b,(await start(b,"bind")).state)).status,409);
  const login=await finish(null,(await start(null,"login")).state);
  assert.equal(login.data.student.id,alpha.id);
  assert.equal((await f.upload(login.data.token,8,zip("verified account"))).status,200);
  assert.equal(f.db.ledger.submissions[0].githubId,user.githubId);
});

test("legacy roster import validation and malformed ZIP directory checks",()=>{
  assert.throws(()=>checkRoster([{...alpha,topics:[1,2,3,4]}]));
  assert.throws(()=>checkRoster([0,1,2,3].map(i=>({...alpha,id:"S"+i,topics:[8]}))));
  assert.throws(()=>checkRoster([{...alpha,topics:[8,8]}]));
  assert.throws(()=>checkRoster([{...alpha,topics:[24]}]));
  assert.doesNotThrow(()=>checkRoster([alpha,beta]));
  const corrupt=zip("data"); corrupt[corrupt.length-6]=255;
  assert.throws(()=>checkZip(corrupt));
  assert.match(teacherReport([],emptyLedger()),/尚无成功提交/);
});
