export const topics = [
  "曲面参数化", "曲线曲面求交", "Bézier 方法求交（变差缩减性）", "B-B 曲面 C¹ 光滑",
  "割角磨光法、细分方法", "曲线光顺设计", "稀疏逼近方法", "最小二乘拟合", "多元样条",
  "Bézier 曲线与曲面", "B 样条曲面", "累加弦长样条曲线", "Coons 曲面", "Bézier 细分法求交",
  "有理曲线与曲面", "Shepard 方法、径向基函数法", "神经网络法", "曲面的微分几何基础",
  "Powell–Sabin 细分方法（曲面）", "Catmull–Clark 细分（曲面）"
];

export class CourseError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function requireThat(condition, status, message) {
  if (!condition) throw new CourseError(status, message);
}

export const clean = value => typeof value === "string" ? value.normalize("NFC").trim() : "";
export const MiB = 1024 * 1024;
export const defaultPolicy = { maxMiB: 10, deadline: null, allowLate: false };
export const emptyLedger = () => ({ bindings: [], submissions: [] });

export function checkRoster(students) {
  requireThat(Array.isArray(students), 422, "名单格式有误。");
  const ids = new Set();
  const counts = new Map();
  for (const student of students) {
    requireThat(student && /^[A-Za-z0-9_-]{1,48}$/.test(clean(student.id)) && student.id === clean(student.id), 422, "请检查学号格式。");
    requireThat(!ids.has(student.id), 422, "名单中有重复学号。");
    ids.add(student.id);
    requireThat([student.name, student.college].every(v => clean(v) && clean(v) === v && v.length <= 100 && !/[\x00-\x1f]/.test(v)), 422, "请检查姓名和学院。");
    const assigned = student.topics;
    requireThat(Array.isArray(assigned) && assigned.length <= 3 && new Set(assigned).size === assigned.length, 422, "每人最多分配三个不同主题。");
    for (const topic of assigned) {
      requireThat(Number.isInteger(topic) && topic >= 1 && topic <= topics.length, 422, "主题编号范围为 1 至 20。");
      counts.set(topic, (counts.get(topic) || 0) + 1);
      requireThat(counts.get(topic) <= 3, 422, "第 " + topic + " 题分配人数超过三人。");
    }
  }
  return students;
}

export function checkPolicy(policy) {
  requireThat(policy && Number.isInteger(policy.maxMiB) && policy.maxMiB >= 1 && policy.maxMiB <= 20 &&
    typeof policy.allowLate === "boolean" && (policy.deadline === null || (typeof policy.deadline === "string" &&
    /(Z|[+-]\d{2}:\d{2})$/.test(policy.deadline) && Number.isFinite(Date.parse(policy.deadline)))), 422, "请检查课程收交设置。");
  return policy;
}

export function authorize(snapshot, claims) {
  const student = snapshot.roster.find(s => s.id === claims.id);
  requireThat(student, 401, "名单已调整，请重新进入。");
  const binding = snapshot.ledger.bindings.find(b => b.id === student.id);
  requireThat((binding?.githubId ?? null) === claims.githubId, 401, "登录方式已变更，请重新进入。");
  return student;
}

export function studentView(snapshot, claims) {
  const student = authorize(snapshot, claims);
  const own = snapshot.ledger.submissions.filter(s => s.id === student.id);
  const binding = snapshot.ledger.bindings.find(b => b.id === student.id);
  return {
    name: student.name, id: student.id, college: student.college, github: binding?.login || null,
    topics: student.topics.map(number => ({
      number, title: topics[number - 1],
      versions: own.filter(s => s.topic === number).map(receipt).reverse()
    })),
    policy: snapshot.policy
  };
}

export function receipt(record) {
  const { version, filename, size, time, late } = record;
  return { version, filename, size, time, late };
}

// Inspect the directory and the local headers without expanding student files.
export function checkZip(bytes) {
  const invalid = () => { throw new CourseError(400, "压缩包不完整或不是有效的 ZIP，请重新打包。"); };
  if (bytes.length < 22) invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = offset => view.getUint16(offset, true);
  const u32 = offset => view.getUint32(offset, true);
  const floor = Math.max(0, bytes.length - 65557);
  let end = bytes.length - 22;
  while (end >= floor && !(u32(end) === 0x06054b50 && end + 22 + u16(end + 20) === bytes.length)) end--;
  if (end < floor || u16(end + 4) || u16(end + 6) || u16(end + 8) !== u16(end + 10)) invalid();
  const entries = u16(end + 10);
  const directory = u32(end + 16);
  if (!entries || directory + u32(end + 12) !== end) invalid();
  let cursor = directory;
  for (let n = 0; n < entries; n++) {
    if (cursor + 46 > end || u32(cursor) !== 0x02014b50 || u16(cursor + 34)) invalid();
    const local = u32(cursor + 42);
    if (local + 30 > directory || u32(local) !== 0x04034b50) invalid();
    const data = local + 30 + u16(local + 26) + u16(local + 28);
    if (data + u32(cursor + 20) > directory) invalid();
    cursor += 46 + u16(cursor + 28) + u16(cursor + 30) + u16(cursor + 32);
  }
  if (cursor !== end) invalid();
}

function cell(value) {
  return String(value).replace(/[&<>"'\\|[\]*_~\x60]/g, ch => "&#" + ch.charCodeAt(0) + ";").replace(/[\r\n]/g, " ");
}

export function teacherReport(roster, ledger) {
  const lines = ["# 2026 秋计算几何课程作业", "", "[名单、分配和截止设置](https://github.com/Mathjk/2026fallCGdemo/blob/main/_worker/README.md)", "", "## 按学生查看", "", "| 学号 | 姓名 | 学院 | 主题 | 最近成功版本 |", "|---|---|---|---|---|"];
  const latest = new Map(ledger.submissions.map(s => [s.id + "/" + s.topic, s]));
  const versionLink = s => s ? "[v" + s.version + "](" + s.path + ")" : "待提交";
  for (const s of roster) {
    if (!s.topics.length) lines.push("| " + [s.id, s.name, s.college, "待分配", "—"].map(cell).join(" | ") + " |");
    for (const t of s.topics) lines.push("| " + [s.id, s.name, s.college, t + " " + topics[t-1]].map(cell).join(" | ") + " | " + versionLink(latest.get(s.id + "/" + t)) + " |");
  }
  if (!roster.length) lines.push("", "尚未导入学生名单。");
  lines.push("", "## 按主题查看", "", "| 主题 | 已分配学生及当前版本 |", "|---|---|");
  topics.forEach((title, i) => {
    const t = i + 1;
    const users = roster.filter(s => s.topics.includes(t)).map(s => cell(s.name) + "（" + cell(s.id) + "）" + versionLink(latest.get(s.id + "/" + t)));
    lines.push("| " + t + " " + title + " | " + (users.join("、") || "待分配") + " |");
  });
  lines.push("", "## 全部成功提交", "", "| 北京时间 | 学号 | 姓名 | 主题 | 版本 | 原文件名 | 登录方式 |", "|---|---|---|---|---|---|---|");
  const clock = new Intl.DateTimeFormat("sv-SE", {timeZone:"Asia/Shanghai",dateStyle:"short",timeStyle:"medium"});
  for (const s of ledger.submissions.slice().reverse()) {
    lines.push("| " + [clock.format(new Date(s.time)) + (s.late ? "（补交）" : ""), s.id, s.name, s.topic].map(cell).join(" | ") + " | " +
      versionLink(s) + " | " + cell(s.filename) + " | " + (s.githubId ? "GitHub " + cell(s.githubId) : "名单匹配") + " |");
  }
  return lines.join("\n") + "\n";
}
