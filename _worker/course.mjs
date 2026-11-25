export const topics = [
  "曲面参数化（保角变换）", "曲面参数化（其他变换）", "曲线曲面求交", "Bézier 方法求交（变差缩减性）",
  "B-B 曲面 C¹ 光滑", "割角磨光法", "曲线光顺设计", "稀疏逼近方法", "最小二乘拟合",
  "多元样条（Morgan–Scott 剖分）", "Bézier 曲线与曲面", "B 样条曲线与曲面", "累加弦长样条曲线",
  "Coons 曲面", "Bézier 细分法求交", "有理曲线与曲面", "Shepard 方法", "径向基函数法",
  "卷积神经网络可视化", "U-Net 可视化", "PointNet 可视化", "曲面的微分几何基础",
  "Powell–Sabin 与 Catmull–Clark 细分"
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
export const studentTopicLimit = 3;
export const defaultPolicy = { maxMiB: 10, deadline: null, allowLate: false };
export const emptyLedger = () => ({ students: [], bindings: [], submissions: [] });

export function studentDetails(input) {
  const id = clean(input.id);
  const name = clean(input.name);
  const college = clean(input.college);
  requireThat(/^[A-Za-z0-9_-]{1,48}$/.test(id), 400, "请填写有效学号，可使用数字、字母、连字符或下划线。");
  requireThat([name, college].every(v => v && v.length <= 100 && !/[\x00-\x1f\x7f]/.test(v)), 400, "请填写姓名和学院。");
  return {id, name, college};
}

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
      requireThat(Number.isInteger(topic) && topic >= 1 && topic <= topics.length, 422, "主题编号范围为 1 至 " + topics.length + "。");
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
  const {ledger} = snapshot;
  const binding = ledger.bindings.find(b => b.id === claims.id);
  requireThat((binding?.githubId ?? null) === claims.githubId, 401, "登录方式已变更，请重新进入。");
  let known = ledger.students?.find(s => s.id === claims.id);
  // Pre-existing receipts and GitHub bindings used the separate roster for identity.
  if (!known && (binding || claims.name === undefined || ledger.submissions.some(s => s.id === claims.id))) {
    known = snapshot.roster.find(s => s.id === claims.id);
  }
  if (claims.name === undefined) {
    requireThat(known, 401, "请重新填写个人信息。");
    return studentDetails(known);
  }
  const profile = studentDetails(claims);
  requireThat(!known || (known.name === profile.name && known.college === profile.college), 403,
    "该学号已有记录，请按首次提交或绑定时填写的姓名和学院进入。");
  return profile;
}

export function rememberStudent(ledger, profile) {
  ledger.students ??= [];
  if (!ledger.students.some(s => s.id === profile.id)) ledger.students.push(profile);
}

export function topicList(ledger, studentId) {
  return topics.map((title, i) => {
    const number = i + 1;
    const entries = ledger.submissions.filter(s => s.topic === number);
    const topic = {number, title, status:entries.length ? "taken" : "open"};
    if (studentId !== undefined) {
      topic.versions = entries.filter(s => s.id === studentId).map(receipt).reverse();
      if (topic.versions.length) topic.status = "mine";
    }
    return topic;
  });
}

export function studentView(snapshot, claims) {
  const student = authorize(snapshot, claims);
  const binding = snapshot.ledger.bindings.find(b => b.id === student.id);
  return {
    name: student.name, id: student.id, college: student.college, github: binding?.login || null,
    topics:topicList(snapshot.ledger, student.id), policy:snapshot.policy, studentTopicLimit
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
  const lines = ["# 2026 秋计算几何课程作业", "", "[收交规则和截止设置](https://github.com/Mathjk/2026fallCGdemo/blob/main/_worker/README.md)", "", "## 按学生查看", "", "| 学号 | 姓名 | 学院 | 主题 | 最近成功版本 |", "|---|---|---|---|---|"];
  const latest = new Map(ledger.submissions.map(s => [s.id + "/" + s.topic, s]));
  const people = new Map([...roster, ...(ledger.students || [])].map(s => [s.id, s]));
  const versionLink = s => s ? "[v" + s.version + "](" + s.path + ")" : "待提交";
  const current = [...latest.values()].sort((a,b) => a.id.localeCompare(b.id) || a.topic-b.topic);
  for (const s of current) {
    lines.push("| " + [s.id,s.name,people.get(s.id)?.college || "—",s.topic + " " + topics[s.topic-1]].map(cell).join(" | ") + " | " + versionLink(s) + " |");
  }
  if (!current.length) lines.push("", "尚无成功提交。");
  lines.push("", "## 按主题查看", "", "| 主题 | 提交学生及当前版本 |", "|---|---|");
  topics.forEach((title, i) => {
    const t = i + 1;
    const owners = current.filter(s => s.topic === t).map(s => cell(s.name) + "（" + cell(s.id) + "）" + versionLink(s));
    lines.push("| " + t + " " + title + " | " + (owners.join("、") || "可提交") + " |");
  });
  lines.push("", "## 全部成功提交", "", "| 北京时间 | 学号 | 姓名 | 主题 | 版本 | 原文件名 | 登录方式 |", "|---|---|---|---|---|---|---|");
  const clock = new Intl.DateTimeFormat("sv-SE", {timeZone:"Asia/Shanghai",dateStyle:"short",timeStyle:"medium"});
  for (const s of ledger.submissions.slice().reverse()) {
    lines.push("| " + [clock.format(new Date(s.time)) + (s.late ? "（补交）" : ""), s.id, s.name, s.topic].map(cell).join(" | ") + " | " +
      versionLink(s) + " | " + cell(s.filename) + " | " + (s.githubId ? "GitHub " + cell(s.githubId) : s.selfReported ? "自行填报" : "名单匹配") + " |");
  }
  return lines.join("\n") + "\n";
}
