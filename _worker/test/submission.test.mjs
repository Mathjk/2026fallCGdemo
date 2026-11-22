import test from "node:test";
import assert from "node:assert/strict";
import { handle } from "../worker.mjs";
import { checkRoster, checkZip, defaultPolicy, emptyLedger, teacherReport } from "../course.mjs";
import { url64 } from "../github.mjs";

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

function fixture(roster=[alpha,beta]) {
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
  const login = async s => (await request("roster",{json:s})).data.token;
  const upload = (token, topic, bytes, key=now(), filename="作业.zip") => request("topics/"+topic+"/upload",
    {bytes,token,headers:{"Idempotency-Key":key,"X-Filename":encodeURIComponent(filename)}});
  return {db,store,files,request,login,upload};
}

test("empty roster, three-field lookup, only assigned topics and no-assignment state",async()=>{
  const empty = fixture([]);
  assert.equal((await empty.request("course")).data.published,false);
  assert.equal((await empty.request("roster",{json:alpha})).status,409);
  const f = fixture([alpha,{...beta,topics:[]}]);
  assert.equal((await f.request("roster",{json:{...alpha,college:"其他学院"}})).status,403);
  const a = await f.login(alpha);
  const view = await f.request("me",{token:a});
  assert.deepEqual(view.data.topics.map(t=>t.number),[8,14]);
  assert.deepEqual((await f.request("me",{token:await f.login(beta)})).data.topics,[]);
  assert.equal((await f.upload(a,3,zip("bad topic"))).status,403);
  assert.equal((await f.upload(null,8,zip("unclaimed"))).status,401);
  f.db.roster[0].topics = [];
  assert.equal((await f.upload(a,8,zip("revoked"))).status,403);
});

test("parallel students, parallel revisions and retry retain each ZIP exactly once",async()=>{
  const f=fixture(), a=await f.login(alpha), b=await f.login(beta), key=now();
  const first=await f.upload(a,8,zip("one"),key);
  assert.equal(first.data.version,1);
  assert.deepEqual(await f.upload(a,8,zip("one"),key),first);
  assert.equal((await f.upload(a,8,zip("other"),key)).status,409);
  const replies=await Promise.all([f.upload(a,8,zip("two")),f.upload(a,8,zip("three")),f.upload(b,8,zip("beta"))]);
  assert.deepEqual(replies.map(r=>r.status),[200,200,200]);
  assert.deepEqual(replies.slice(0,2).map(r=>r.data.version).sort(),[2,3]);
  assert.equal(replies[2].data.version,1);
  assert.equal(f.db.ledger.submissions.length,4);
  assert.equal(f.files.get("submissions/topic-08/TEST001/v1.zip"),url64(zip("one")));
  assert.equal(f.files.get("submissions/topic-08/TEST002/v1.zip"),url64(zip("beta")));
  const report=f.files.get("README.md");
  assert.match(report,/全部成功提交/);
  for (const s of f.db.ledger.submissions) assert.ok(report.includes(s.path));
  assert.deepEqual((await f.request("me",{token:b})).data.topics[0].versions.map(v=>v.version),[1]);
});

test("deadline, late policy, size and format, unsuccessful updates preserve the current version",async()=>{
  const f=fixture(), a=await f.login(alpha), bytes=zip("first");
  assert.equal((await f.upload(a,8,bytes)).status,200);
  f.db.policy.deadline = "2020-01-01T00:00:00+08:00";
  assert.equal((await f.upload(a,8,bytes)).status,403);
  f.db.policy.allowLate = true;
  assert.equal((await f.upload(a,8,bytes)).data.late,true);
  assert.equal((await f.upload(a,8,new Uint8Array([80,75,3,4]))).status,400);
  assert.equal((await f.upload(a,8,bytes,now(),"../x.zip")).status,400);
  f.db.policy.maxMiB=1;
  assert.equal((await f.upload(a,8,new Uint8Array(1024*1024+1))).status,413);
  f.store.failure=true;
  assert.equal((await f.upload(a,8,bytes)).status,503);
  assert.equal(f.db.ledger.submissions.length,2);
  assert.equal((await f.request("me",{token:a})).data.topics[0].versions[0].version,2);
});

test("optional GitHub identity binds once, requires the same browser and blocks older roster sessions",async()=>{
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

test("enforce both assignment limits and reject a malformed directory",()=>{
  assert.throws(()=>checkRoster([{...alpha,topics:[1,2,3,4]}]));
  assert.throws(()=>checkRoster([0,1,2,3].map(i=>({...alpha,id:"S"+i,topics:[8]}))));
  assert.throws(()=>checkRoster([{...alpha,topics:[8,8]}]));
  assert.throws(()=>checkRoster([{...alpha,topics:[21]}]));
  assert.doesNotThrow(()=>checkRoster([alpha,beta]));
  const corrupt=zip("data"); corrupt[corrupt.length-6]=255;
  assert.throws(()=>checkZip(corrupt));
  assert.match(teacherReport([],emptyLedger()),/尚未导入/);
});
