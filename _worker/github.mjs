import { CourseError, checkPolicy, checkRoster, requireThat } from "./course.mjs";

const repoName = "Mathjk/2026fallCG-submissions";
const api = "https://api.github.com";
const root = "/repos/" + repoName;
const enc = new TextEncoder();

export function base64(bytes) {
  const chunks = [];
  // Whole three-byte groups have no padding between chunks.
  for (let i = 0; i < bytes.length; i += 24576) chunks.push(btoa(String.fromCharCode(...bytes.subarray(i, i + 24576))));
  return chunks.join("");
}
export const url64 = bytes => base64(bytes).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
export const from64 = value => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));

async function applicationJwt(env) {
  const bytes = from64(env.GH_APP_KEY);
  const key = await crypto.subtle.importKey("pkcs8", bytes, {name:"RSASSA-PKCS1-v1_5", hash:"SHA-256"}, false, ["sign"]);
  const now = Math.floor(Date.now()/1000);
  const data = [{alg:"RS256",typ:"JWT"}, {iat:now-60, exp:now+480, iss:env.GH_APP_ID}]
    .map(v => url64(enc.encode(JSON.stringify(v)))).join(".");
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(data));
  return data + "." + url64(new Uint8Array(sig));
}

let tokenCache;
let snapshotCache;
async function send(path, token, options = {}) {
  const {method = "GET", body, raw = false} = options;
  return fetch(api + path, { method, redirect:"manual", headers:{
    Authorization:"Bearer " + token, "User-Agent":"Mathjk-CG-Coursework",
    Accept:raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
    "X-GitHub-Api-Version":"2022-11-28", "Content-Type":"application/json"
  }, body:body === undefined ? undefined : JSON.stringify(body) });
}

async function checked(response) {
  if (!response.ok) {
    console.error("GitHub repository request failed", response.status);
    await response.body?.cancel();
    throw new CourseError(503, "暂时无法访问私有作业仓库，请稍后重试。");
  }
  return response.json();
}

async function installationToken(env) {
  if (tokenCache && tokenCache.expires > Date.now() + 60000) return tokenCache.token;
  const jwt = await applicationJwt(env);
  const installation = await checked(await send(root + "/installation", jwt));
  const t = await checked(await send("/app/installations/" + installation.id + "/access_tokens", jwt, {
    method:"POST", body:{repositories:[repoName.split("/")[1]], permissions:{contents:"write"}}
  }));
  tokenCache = {token:t.token, expires:Date.parse(t.expires_at)};
  return t.token;
}

export async function githubStore(env) {
  const token = await installationToken(env);
  return privateRepositoryStore(token);
}

export async function privateRepositoryStore(token) {
  const request = (path, options) => send(root + path, token, options);
  const json = async (path, options) => checked(await request(path, options));
  // A teacher could change visibility after installation. Fail closed on each request.
  const repository = await json("");
  requireThat(repository.private === true, 503, "作业仓库需要设为私有。");
  const branch = encodeURIComponent(repository.default_branch);
  return {
    async snapshot({includeRoster = false} = {}) {
      const head = (await json("/git/ref/heads/" + branch)).object.sha;
      if (snapshotCache?.head === head && (!includeRoster || snapshotCache.rosterLoaded)) return structuredClone(snapshotCache);
      const file = name => json("/contents/" + name + "?ref=" + head, {raw:true});
      const [commit, policy, ledger] = await Promise.all([json("/git/commits/" + head), file("policy.json"), file("ledger.json")]);
      let roster = [];
      let rosterLoaded = false;
      try {
        checkPolicy(policy);
        ledger.students ??= [];
        requireThat([ledger.students, ledger.bindings, ledger.submissions].every(Array.isArray), 422, "记录格式有误。");
        const profiles = new Set(ledger.students.map(s => s.id));
        rosterLoaded = includeRoster || [...ledger.bindings, ...ledger.submissions].some(s => !profiles.has(s.id));
        if (rosterLoaded) roster = checkRoster(await file("roster.json"));
      } catch {
        throw new CourseError(503, "课程数据需要老师检查，请稍后再试。");
      }
      snapshotCache = {head, tree:commit.tree.sha, roster, rosterLoaded, policy, ledger};
      return structuredClone(snapshotCache);
    },
    async blob(bytes) {
      return (await json("/git/blobs", {method:"POST",body:{encoding:"base64",content:base64(bytes)}})).sha;
    },
    async commit(snapshot, files, message) {
      const tree = files.map(file => ({mode:"100644", type:"blob", ...file}));
      const nextTree = await json("/git/trees", {method:"POST",body:{base_tree:snapshot.tree, tree}});
      const next = await json("/git/commits", {method:"POST",body:{message, tree:nextTree.sha, parents:[snapshot.head]}});
      // Recheck topic ownership, identity and versions if another commit wins this race.
      const response = await request("/git/refs/heads/" + branch, {method:"PATCH",body:{sha:next.sha, force:false}});
      if ([409,422].includes(response.status)) { await response.body?.cancel(); return false; }
      await checked(response);
      return true;
    }
  };
}
