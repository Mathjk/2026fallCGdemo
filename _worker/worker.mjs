import { CourseError, MiB, authorize, checkZip, clean, receipt, rememberStudent, requireThat, studentDetails, studentTopicLimit, studentView, teacherReport, topicList, topics } from "./course.mjs";
import { from64, githubStore, url64 } from "./github.mjs";

const site = "https://mathjk.github.io/2026fallCGdemo/work/";
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const digest = async bytes => url64(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
const bearer = req => (req.headers.get("Authorization") || "").replace(/^Bearer /, "");
const signedOut = "登录已过期，请重新进入。";

async function signed(env, purpose, data, minutes) {
  const key = await hmac(env);
  const payload = url64(encoder.encode(JSON.stringify({...data, purpose, until:Date.now() + minutes * 60000})));
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return payload + "." + url64(new Uint8Array(sig));
}

function hmac(env) {
  requireThat(env.SESSION_KEY?.length >= 32, 503, "课程服务正在配置。");
  return crypto.subtle.importKey("raw", encoder.encode(env.SESSION_KEY), {name:"HMAC",hash:"SHA-256"}, false, ["sign","verify"]);
}

async function readSigned(env, token, purpose) {
  const key = await hmac(env);
  try {
    const [data, sig, extra] = token.split(".");
    if (extra !== undefined || !data || !sig || token.length > 4096) throw Error();
    if (!(await crypto.subtle.verify("HMAC", key, from64(sig), encoder.encode(data)))) throw Error();
    const claims = JSON.parse(decoder.decode(from64(data)));
    if (claims.until <= Date.now() || claims.purpose !== purpose) throw Error();
    return claims;
  } catch { throw new CourseError(401, signedOut); }
}

async function readBytes(req, max) {
  const tooLarge = "文件或请求超过大小上限。";
  requireThat(Number(req.headers.get("Content-Length") || 0) <= max, 413, tooLarge);
  requireThat(req.body, 400, "请选择文件或填写资料。");
  const chunks = [];
  const reader = req.body.getReader();
  let total = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { await reader.cancel(); throw new CourseError(413, tooLarge); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

async function bodyJson(req) {
  const raw = await readBytes(req, 10000);
  try {
    const data = JSON.parse(decoder.decode(raw));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw Error();
    return data;
  } catch { throw new CourseError(400, "请求格式有误，请重试。"); }
}

async function transaction(store, change) {
  for (let n = 0; n < 7; n++) {
    const snap = await store.snapshot();
    const result = await change(snap);
    if (!result.files) return result.value;
    result.files.push({path:"ledger.json", content:JSON.stringify(snap.ledger, null, 2) + "\n"});
    if (await store.commit(snap, result.files, result.message)) return result.value;
    await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * (n+1) * 110));
  }
  throw new CourseError(409, "其他作业正在保存，请用同一文件重试。");
}

async function session(env, snap, claims) {
  const student = studentView(snap, claims);
  const details = {id:student.id, name:student.name, college:student.college, githubId:claims.githubId};
  return {token:await signed(env, "session", details, 480), student};
}

async function enter(req, env, store) {
  const student = studentDetails(await bodyJson(req));
  const snap = await store.snapshot();
  requireThat(!snap.ledger.bindings.some(b => b.id === student.id), 403, "该学号已绑定 GitHub，请使用绑定的账号进入。");
  return session(env, snap, {...student, githubId:null});
}

function checkTopic(snap, claims, topic) {
  const student = authorize(snap, claims);
  const submissions = snap.ledger.submissions;
  requireThat(!submissions.some(s => s.topic === topic && s.id !== student.id), 409,
    "这个主题已有其他同学提交，请选择其他主题。");
  const mine = new Set(submissions.filter(s => s.id === student.id).map(s => s.topic));
  requireThat(mine.has(topic) || mine.size < studentTopicLimit, 409,
    "已达到每人 " + studentTopicLimit + " 个主题的上限，可更新自己已提交的作业。");
  return student;
}

async function upload(req, store, topic, claims) {
  const first = await store.snapshot();
  checkTopic(first, claims, topic);
  const key = req.headers.get("Idempotency-Key") || "";
  requireThat(/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(key), 400, "本次上传缺少有效编号，请重新选择文件。");
  const expectedText = req.headers.get("X-Expected-Version") ?? "0";
  requireThat(/^(0|[1-9]\d{0,8})$/.test(expectedText), 400, "作业版本号无效，请刷新后重试。");
  const expected = Number(expectedText);
  let filename;
  try { filename = clean(decodeURIComponent(req.headers.get("X-Filename") || "")); } catch { filename = ""; }
  requireThat(filename.length <= 180 && /^[^/\\\x00-\x1f\x7f]+\.zip$/i.test(filename), 400, "请选择扩展名为 .zip 的压缩包。");
  const bytes = await readBytes(req, first.policy.maxMiB * MiB);
  checkZip(bytes);
  const hash = await digest(bytes);
  let blob;
  return transaction(store, async snap => {
    const student = checkTopic(snap, claims, topic);
    const versions = snap.ledger.submissions.filter(s => s.id === student.id && s.topic === topic);
    const existing = versions.find(s => s.key === key);
    if (existing) {
      requireThat(existing.hash === hash && existing.filename === filename, 409, "同一上传编号已用于其他文件，请重新选择。");
      return {value:receipt(existing)};
    }
    const current = versions.at(-1)?.version || 0;
    requireThat(expected === current, 409, "作业版本已变化，请刷新页面，在「我的作业」中查看最新版本后再更新。");
    requireThat(bytes.length <= snap.policy.maxMiB * MiB, 413, "文件超过课程大小上限。");
    const now = new Date();
    const late = snap.policy.deadline !== null && now.getTime() >= Date.parse(snap.policy.deadline);
    requireThat(!late || snap.policy.allowLate, 403, "已超过截止时间，当前不接受补交或更新。");
    const version = current + 1;
    const path = "submissions/topic-" + String(topic).padStart(2, "0") + "/" + student.id + "/v" + version + ".zip";
    blob ??= await store.blob(bytes);
    const record = {id:student.id, name:student.name, topic, version, filename, path, size:bytes.length, hash, key, time:now.toISOString(), late, githubId:claims.githubId, selfReported:true};
    rememberStudent(snap.ledger, student);
    snap.ledger.submissions.push(record);
    return {files:[{path, sha:blob},{path:"README.md",content:teacherReport(snap.roster, snap.ledger)}],
      message:"收取第 " + topic + " 题，版本 " + version, value:receipt(record)};
  });
}

async function oauthStart(req, env, store) {
  const {mode, challenge} = await bodyJson(req);
  requireThat(env.GH_CLIENT_ID && env.GH_CLIENT_SECRET, 503, "GitHub 登录尚未配置。");
  requireThat(["bind","login"].includes(mode) && /^[A-Za-z0-9_-]{43}$/.test(challenge), 400, "登录请求已失效。");
  let proof = null;
  if (mode === "bind") {
    const claims = await readSigned(env, bearer(req), "session");
    authorize(await store.snapshot(), claims);
    requireThat(claims.githubId === null, 409, "已经绑定 GitHub 账号。");
    proof = await digest(encoder.encode(bearer(req)));
  }
  const state = await signed(env, "oauth", {nonce:crypto.randomUUID(), challenge, proof}, 10);
  const url = new URL("https://github.com/login/oauth/authorize");
  url.search = new URLSearchParams({client_id:env.GH_CLIENT_ID, redirect_uri:site, state, code_challenge:challenge, code_challenge_method:"S256"}).toString();
  return {url:String(url), state};
}

async function githubIdentity(env, code, verifier) {
  const response = await fetch("https://github.com/login/oauth/access_token", {method:"POST",redirect:"manual",
    headers:{Accept:"application/json","Content-Type":"application/json","User-Agent":"Mathjk-CG-Coursework"},
    body:JSON.stringify({client_id:env.GH_CLIENT_ID, client_secret:env.GH_CLIENT_SECRET, code, code_verifier:verifier, redirect_uri:site})});
  const token = await response.json();
  requireThat(response.ok && token.access_token, 403, "GitHub 授权已失效，请重新登录。");
  const profile = await fetch("https://api.github.com/user", {redirect:"manual", headers:{Authorization:"Bearer " + token.access_token,
    Accept:"application/vnd.github+json","User-Agent":"Mathjk-CG-Coursework"}});
  const user = await profile.json();
  requireThat(profile.ok && Number.isSafeInteger(user.id) && typeof user.login === "string", 403, "GitHub 账号识别失败。");
  return {githubId:String(user.id), login:user.login};
}

async function oauthFinish(req, env, store, identify) {
  const {code, state, verifier} = await bodyJson(req);
  requireThat(typeof code === "string" && code.length <= 200 && /^[A-Za-z0-9_-]{43,128}$/.test(verifier), 400, "请重新发起 GitHub 登录。");
  const flow = await readSigned(env, state, "oauth");
  requireThat(flow.challenge === await digest(encoder.encode(verifier)), 403, "请在发起授权的浏览器中完成登录。");
  let claims;
  if (flow.proof) {
    requireThat(flow.proof === await digest(encoder.encode(bearer(req))), 403, "绑定会话已变更。");
    claims = await readSigned(env, bearer(req), "session");
  }
  const identity = await identify(env, code, verifier);
  if (!claims) {
    const snap = await store.snapshot();
    const binding = snap.ledger.bindings.find(b => b.githubId === identity.githubId);
    requireThat(binding, 403, "此 GitHub 账号尚未绑定，请先填写个人信息。");
    return session(env, snap, {id:binding.id, githubId:identity.githubId});
  }
  return transaction(store, async snap => {
    const student = authorize(snap, claims);
    requireThat(!snap.ledger.bindings.some(b => b.id === claims.id || b.githubId === identity.githubId), 409, "该学号或 GitHub 账号已有绑定，请联系老师。");
    rememberStudent(snap.ledger, student);
    snap.ledger.bindings.push({id:claims.id, ...identity, time:new Date().toISOString()});
    return {files:[], message:"绑定学生 GitHub 账号", value:await session(env, snap, {...student, githubId:identity.githubId})};
  });
}

export async function handle(req, env, openStore = githubStore, identify = githubIdentity) {
  const origin = new URL(site).origin;
  const headers = {"Cache-Control":"no-store", "Content-Type":"application/json; charset=utf-8", "X-Content-Type-Options":"nosniff",
    "Access-Control-Allow-Origin":origin, "Vary":"Origin", "Access-Control-Allow-Methods":"GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":"Authorization, Content-Type, X-Filename, Idempotency-Key, X-Expected-Version", "Access-Control-Max-Age":"600"};
  const respond = (value, status=200) => new Response(JSON.stringify(value), {status, headers});
  try {
    requireThat(!req.headers.has("Origin") || req.headers.get("Origin") === origin, 403, "请从课程网页发起请求。");
    if (req.method === "OPTIONS") return new Response(null, {status:204, headers});
    const path = new URL(req.url).pathname;
    if (req.method === "GET" && path === "/") return respond({service:"2026 秋计算几何课程作业", course:site});
    const key = req.method + " " + path;
    const match = /^POST \/api\/topics\/([1-9]\d*)\/upload$/.exec(key);
    if (match) requireThat(Number(match[1]) <= topics.length, 404, "未找到这个作业主题。");
    requireThat(match || ["GET /api/course","GET /api/me","POST /api/enter","POST /api/roster","POST /api/github/start","POST /api/github/finish"].includes(key), 404, "未找到此接口。");
    let claims;
    if (match || key === "GET /api/me") claims = await readSigned(env, bearer(req), "session");
    const store = await openStore(env);
    if (match) return respond(await upload(req, store, Number(match[1]), claims));
    if (key === "GET /api/course") {
      const {policy, ledger} = await store.snapshot();
      return respond({policy, topics:topicList(ledger), studentTopicLimit, published:true, githubAvailable:Boolean(env.GH_CLIENT_ID && env.GH_CLIENT_SECRET)});
    }
    if (key === "GET /api/me") return respond(studentView(await store.snapshot(), claims));
    if (key === "POST /api/enter" || key === "POST /api/roster") return respond(await enter(req, env, store));
    if (key === "POST /api/github/start") return respond(await oauthStart(req, env, store));
    return respond(await oauthFinish(req, env, store, identify));
  } catch (error) {
    if (!(error instanceof CourseError)) {
      // Log code locations only. Student data, credentials and request bodies stay out of diagnostics.
      const frames = String(error.stack || "").split("\n").slice(1,4).map(line => line.trim().split(" (")[0].slice(0,90));
      console.error("Course handler error", error.name, frames.join(" / "));
    }
    return respond({error:error instanceof CourseError ? error.message : "课程服务暂时未能完成请求，请稍后重试。"}, error instanceof CourseError ? error.status : 503);
  }
}

export default {fetch:(request, env) => handle(request, env)};
