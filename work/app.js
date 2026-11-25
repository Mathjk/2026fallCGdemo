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
    const error = Error(data.error || "操作未成功，请重试。");
    error.status = response.status;
    throw error;
  }
  return data;
}

function uploadInfo() {
  const number = Number($("topic").value);
  const topic = me && me.topics.find(t => t.number === number);
  const latest = topic && topic.versions[0];
  if ($("send").disabled && !busy) {
    $("previous").textContent = "当前没有可新交的主题。已提交的同学可从「我的作业」进入并更新。";
  } else {
    $("previous").textContent = latest ? "最近成功提交　" + fmt(latest) + "。更新后可查看历史版本。" : "";
  }
  $("send").textContent = busy ? "正在保存…" : latest ? "更新 ZIP" : "提交 ZIP";
}

function historyRows() {
  const list = $("records");
  list.textContent = "";
  const submitted = me.topics.filter(t => t.versions.length);
  if (!submitted.length) list.append(el("p", "你还没有提交作业。"));
  for (const topic of submitted) {
    const row = el("article", "");
    row.className = "record";
    const head = el("div", "");
    head.className = "record-head";
    const action = el("button", "更新 ZIP");
    action.type = "button";
    action.addEventListener("click", () => {
      $("topic").value = String(topic.number);
      $("archive").value = "";
      location.hash = "submit";
    });
    head.append(el("h3", "第 " + topic.number + " 题　" + topic.title), action);
    row.append(head, el("p", "最近成功提交　" + fmt(topic.versions[0])));
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

function selectTopics(list) {
  const select = $("topic");
  const previous = select.value;
  const atLimit = me && list.filter(t => t.status === "mine").length >= me.studentTopicLimit;
  select.options.length = 0;
  select.add(new Option("请选择主题", ""));
  let available = 0;
  for (const t of list) {
    const suffix = t.status === "mine" ? "（我的 v" + t.versions[0].version + "）" : t.status === "taken" ? "（已有提交）" : "";
    const option = new Option("第 " + t.number + " 题　" + t.title + suffix, t.number);
    option.disabled = t.status === "taken" || (atLimit && t.status !== "mine");
    select.add(option);
    if (!option.disabled) {
      available++;
      if (option.value === previous) select.value = previous;
    }
  }
  if (previous && !select.value) $("archive").value = "";
  return available;
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
  $("upload-panel").hidden = !course || viewing;
  $("history-panel").hidden = !me || !viewing;
  if (!course) return;
  const p = me ? me.policy : course.policy;
  const closed = p.deadline && Date.now() >= Date.parse(p.deadline) && !p.allowLate;
  $("policy").textContent = ["ZIP 上限 " + p.maxMiB + " MiB", p.deadline ? "截止 " + date(p.deadline) + "（北京时间）" : "截止时间待定",
    ...(p.deadline ? [p.allowLate ? "截止后可补交或更新" : "截止后停止提交和更新"] : [])].join("　·　");
  $("identity-fields").disabled = busy || Boolean(me);
  $("lookup").hidden = !viewing;
  $("lookup").disabled = busy;
  $("login-intro").textContent = viewing ? "使用首次提交时填写的信息或已绑定的 GitHub 账号查看记录。" : "请填写本人信息，提交成功后可在「我的作业」查看或更新。";
  $("github-option").hidden = !course.githubAvailable;
  $("github-login").disabled = busy;
  const available = selectTopics(me ? me.topics : course.topics);
  $("upload-fields").disabled = Boolean(closed) || busy || viewing;
  $("send").disabled = available === 0;
  uploadInfo();
  if (me) {
    $("student-name").textContent = me.name;
    $("student-meta").textContent = [me.id, me.college, me.github ? "GitHub @" + me.github : ""].filter(Boolean).join(" · ");
    $("bind").hidden = Boolean(me.github) || !course.githubAvailable;
    $("bind").disabled = $("logout").disabled = busy;
    if (viewing) {
      historyRows();
      for (const button of $("records").querySelectorAll("button")) button.disabled = Boolean(closed) || busy;
    }
  }
}

function accept(data) {
  save("session", data.token);
  for (const field of $("identity-fields").querySelectorAll("input")) field.value = "";
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

$("topic").addEventListener("change", () => { $("archive").value = ""; notice(); uploadInfo(); });
$("logout").addEventListener("click", () => {
  save("session", null); save("oauth", null); save("upload", null);
  me = null; $("work-form").reset(); notice("已退出。"); render();
  refresh().catch(error => notice(error.message, true));
});
async function refresh() {
  const token = saved("session");
  if (token) {
    const updated = await api("/api/me");
    if (token === saved("session")) me = updated;
  } else {
    course = await api("/api/course");
  }
  render();
}
window.addEventListener("hashchange", async () => {
  if (!busy) notice();
  render();
  if (busy || !course) return;
  try { await refresh(); } catch (error) { notice(error.message, true); }
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

$("work-form").addEventListener("submit", event => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const json = {name:data.get("name"), id:data.get("id"), college:data.get("college")};
  if (mine()) {
    if (!me) run(async () => accept(await api("/api/enter", {json})));
    return;
  }
  const file = $("archive").files[0];
  const topic = Number($("topic").value);
  if (!file || !topic) return;
  const selected = me && me.topics.find(t => t.number === topic);
  const latest = selected && selected.versions[0];
  const expected = latest ? latest.version : 0;
  run(async () => {
    if (!/\.zip$/i.test(file.name)) throw Error("请选择 ZIP 压缩包。");
    const limit = (me ? me.policy : course.policy).maxMiB;
    if (file.size > limit * 1024 * 1024) throw Error("文件超过 " + limit + " MiB。");
    if (!me) accept(await api("/api/enter", {json}));
    const bytes = await new Response(file).arrayBuffer();
    const fingerprint = JSON.stringify([me.id, topic, file.name, await sha(bytes)]);
    const pending = JSON.parse(saved("upload") || "null");
    const attempt = pending && pending.fingerprint === fingerprint && Number.isInteger(pending.expected)
      ? pending : {fingerprint, key:uploadId(), expected};
    save("upload", JSON.stringify(attempt));
    notice("正在保存 ZIP，请稍候…");
    let version;
    try {
      version = await api("/api/topics/" + topic + "/upload", {bytes, headers:{"Content-Type":"application/zip",
        "X-Filename":encodeURIComponent(file.name), "Idempotency-Key":attempt.key, "X-Expected-Version":String(attempt.expected)}});
    } catch (error) {
      if (error.status === 409) {
        save("upload", null);
        try { await refresh(); } catch { /* Keep the original submission error visible. */ }
      }
      throw error;
    }
    save("upload", null);
    $("archive").value = "";
    const entry = me.topics.find(t => t.number === topic);
    entry.status = "mine";
    entry.versions = [version, ...entry.versions.filter(v => v.version !== version.version)].sort((a,b) => b.version-a.version);
    course.topics.find(t => t.number === topic).status = "taken";
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
