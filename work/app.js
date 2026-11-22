const apiBase = "https://mathjk-cg2026-submissions.jkmathq.chatgpt.site";
const $ = id => document.getElementById(id);
const prefix = "mathjk.cg.2026.";
const saved = key => sessionStorage.getItem(prefix + key);
const save = (key, value) => value == null ? sessionStorage.removeItem(prefix + key) : sessionStorage.setItem(prefix + key, value);
const clock = new Intl.DateTimeFormat("zh-CN", {timeZone:"Asia/Shanghai",year:"numeric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false});
const date = iso => clock.format(new Date(iso));
const fmt = version => "v" + version.version + " · " + version.filename + " · " + date(version.time) + (version.late ? "（补交）" : "");
const el = (tag, text) => Object.assign(document.createElement(tag), {textContent:text});
let course, me, busy = false;
const mine = () => location.hash === "#mine";

function notice(message = "", error = false) {
  $("notice").textContent = message;
  $("notice").classList.toggle("error", error);
}

async function api(path, {json, bytes, headers = {}, ...options} = {}) {
  const token = saved("session");
  if (token) headers.Authorization = "Bearer " + token;
  if (json) headers["Content-Type"] = "application/json";
  let response;
  try {
    response = await fetch(apiBase + path, {...options, method:json || bytes ? "POST" : "GET", headers, body:json ? JSON.stringify(json) : bytes,
      credentials:"omit", referrerPolicy:"no-referrer", cache:"no-store"});
  } catch { throw Error("暂时连不上课程服务，请检查网络后重试。"); }
  let data;
  try { data = await response.json(); } catch { throw Error("收交服务暂时未能响应，请稍后重试。"); }
  if (!response.ok) {
    if (response.status === 401 && token === saved("session")) { save("session", null); me = null; render(); }
    throw Error(data.error || "操作未成功，请重试。");
  }
  return data;
}

function uploadInfo() {
  const number = Number($("topic").value);
  const topic = me && me.topics.find(t => t.number === number);
  if (!topic) return;
  $("one-topic").textContent = "第 " + number + " 题　" + topic.title;
  const latest = topic.versions[0];
  $("previous").textContent = latest ? "最近成功提交　" + fmt(latest) + "。更新后可在「我的作业」查看历史版本。" : "提交成功后可在「我的作业」查看回执。";
  $("send").textContent = busy ? "正在保存…" : latest ? "更新 ZIP" : "提交 ZIP";
}

function historyRows() {
  const list = $("records");
  list.textContent = "";
  for (const topic of me.topics) {
    const row = el("article", "");
    row.className = "record";
    const head = el("div", "");
    head.className = "record-head";
    const action = el("button", topic.versions.length ? "更新 ZIP" : "提交 ZIP");
    action.type = "button";
    action.addEventListener("click", () => {
      $("topic").value = String(topic.number);
      $("archive").value = "";
      location.hash = "submit";
    });
    head.append(el("h3", "第 " + topic.number + " 题　" + topic.title), action);
    row.append(head, el("p", topic.versions[0] ? "最近成功提交　" + fmt(topic.versions[0]) : "待提交"));
    if (topic.versions.length > 1) {
      const details = el("details", "");
      const versions = el("ol", "");
      topic.versions.forEach(v => versions.append(el("li", fmt(v))));
      details.append(el("summary", "查看全部 " + topic.versions.length + " 个版本"), versions);
      row.append(details);
    }
    list.append(row);
  }
}

function render() {
  const viewing = mine();
  $("title").textContent = viewing ? "我的作业" : "提交作业";
  document.title = $("title").textContent + " · 2026 秋计算几何";
  const current = viewing ? "nav-mine" : "nav-submit";
  for (const id of ["nav-submit", "nav-mine"]) {
    if (id === current) $(id).setAttribute("aria-current","page"); else $(id).removeAttribute("aria-current");
  }
  $("login").hidden = !course || Boolean(me);
  $("account").hidden = !me;
  const hasTopics = me && me.topics.length > 0;
  $("upload-panel").hidden = !hasTopics || viewing;
  $("history-panel").hidden = !hasTopics || !viewing;
  $("no-topics").hidden = !me || me.topics.length > 0;
  if (!course) return;
  const p = me ? me.policy : course.policy;
  const closed = p.deadline && Date.now() > Date.parse(p.deadline) && !p.allowLate;
  $("policy").textContent = ["ZIP 上限 " + p.maxMiB + " MiB", p.deadline ? "截止 " + date(p.deadline) + "（北京时间）" : "截止时间待定",
    ...(p.deadline ? [p.allowLate ? "截止后可补交或更新" : "截止后停止提交和更新"] : [])].join("　·　");
  $("identity-fields").disabled = busy || !course.published;
  $("login-intro").textContent = course.published ? "请按课程名单填写，再查看分配给你的主题。" : "老师尚未发布名单和主题分配，发布后即可在这里提交作业。";
  $("github-option").hidden = !course.githubAvailable || !course.published;
  $("github-login").disabled = busy;
  if (!me) return;
  $("student-name").textContent = me.name;
  $("student-meta").textContent = [me.id, me.college, me.github ? "GitHub @" + me.github : ""].filter(Boolean).join(" · ");
  $("bind").hidden = Boolean(me.github) || !course.githubAvailable;
  $("bind").disabled = $("logout").disabled = busy;
  const selected = Number($("topic").value);
  $("topic").options.length = 0;
  for (const t of me.topics) $("topic").add(new Option("第 " + t.number + " 题　" + t.title, t.number));
  if (me.topics.some(t => t.number === selected)) $("topic").value = String(selected);
  $("choose-label").hidden = me.topics.length < 2;
  $("one-topic").hidden = me.topics.length !== 1;
  $("upload-fields").disabled = Boolean(closed) || busy;
  uploadInfo();
  historyRows();
  for (const button of $("records").querySelectorAll("button")) button.disabled = Boolean(closed) || busy;
}

function accept(data) {
  save("session", data.token);
  $("roster-form").reset();
  me = data.student;
}

async function run(action) {
  if (busy) return;
  busy = true;
  notice();
  render();
  try { await action(); } catch (error) { notice(error.message, true); }
  finally { busy = false; render(); }
}

$("roster-form").addEventListener("submit", event => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const json = {name:data.get("name"), id:data.get("id"), college:data.get("college")};
  run(async () => accept(await api("/api/roster", {json})));
});
$("topic").addEventListener("change", () => { $("archive").value = ""; notice(); uploadInfo(); });
$("logout").addEventListener("click", () => {
  save("session", null); save("oauth", null); save("upload", null);
  me = null; $("archive").value = ""; notice("已退出。"); render();
});
window.addEventListener("hashchange", async () => {
  if (!busy) notice();
  render();
  if (!mine() || !me || busy) return;
  const token = saved("session");
  try {
    const updated = await api("/api/me");
    if (token === saved("session") && mine()) { me = updated; render(); }
  } catch (error) { if (mine()) notice(error.message, true); }
});

function url64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
const sha = async data => url64(await crypto.subtle.digest("SHA-256", data));

function uploadId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, value => ("0" + value.toString(16)).slice(-2)).join("");
  return [hex.slice(0,8), hex.slice(8,12), hex.slice(12,16), hex.slice(16,20), hex.slice(20)].join("-");
}

async function startGitHub(mode) {
  const verifier = url64(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = await sha(new TextEncoder().encode(verifier));
  const {url, state} = await api("/api/github/start", {json:{mode, challenge}});
  save("oauth", JSON.stringify({state, verifier, hash:mine() ? "#mine" : "#submit"}));
  location.assign(url);
}
$("github-login").addEventListener("click", () => run(() => startGitHub("login")));
$("bind").addEventListener("click", () => run(() => startGitHub("bind")));

$("upload-form").addEventListener("submit", event => {
  event.preventDefault();
  const file = $("archive").files[0];
  const topic = Number($("topic").value);
  if (!file || !me) return;
  run(async () => {
    if (!/\.zip$/i.test(file.name)) throw Error("请选择 ZIP 压缩包。");
    if (file.size > me.policy.maxMiB * 1024 * 1024) throw Error("文件超过 " + me.policy.maxMiB + " MiB。");
    const bytes = await new Response(file).arrayBuffer();
    const fingerprint = JSON.stringify([me.id, topic, file.name, await sha(bytes)]);
    const pending = JSON.parse(saved("upload") || "null");
    const key = pending && pending.fingerprint === fingerprint ? pending.key : uploadId();
    save("upload", JSON.stringify({fingerprint, key}));
    notice("正在保存 ZIP，请稍候…");
    const version = await api("/api/topics/" + topic + "/upload", {bytes,
      headers:{"Content-Type":"application/zip","X-Filename":encodeURIComponent(file.name),"Idempotency-Key":key}});
    save("upload", null);
    $("archive").value = "";
    const entry = me.topics.find(t => t.number === topic);
    entry.versions = [version, ...entry.versions.filter(v => v.version !== version.version)];
    notice("提交成功　" + fmt(version) + "（北京时间）");
  });
});

async function boot() {
  render();
  const query = new URLSearchParams(location.search);
  const callback = query.has("code") || query.has("error");
  const pending = callback && JSON.parse(saved("oauth") || "null");
  if (callback) {
    save("oauth", null);
    history.replaceState(null, "", location.pathname + (pending && pending.hash || "#mine"));
  }
  try {
    course = await api("/api/course");
    if (callback) {
      if (!pending || query.get("state") !== pending.state || query.has("error")) throw Error("GitHub 授权未完成，请重新进入。");
      accept(await api("/api/github/finish", {json:{code:query.get("code"), state:pending.state, verifier:pending.verifier}}));
      notice("已通过 GitHub 登录。");
    } else if (saved("session")) {
      me = await api("/api/me");
    }
  } catch (error) {
    notice(error.message, true);
    if (!course) {
      $("policy").textContent = "课程设置暂时无法读取。";
      const retry = el("button", "重新连接");
      retry.addEventListener("click", () => location.reload());
      $("notice").append(" ", retry);
    }
  }
  render();
}
boot();
