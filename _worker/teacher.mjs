import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkRoster, clean, teacherReport } from "./course.mjs";
import { privateRepositoryStore } from "./github.mjs";

const [mode, ...args] = process.argv.slice(2);
const json = v => JSON.stringify(v, null, 2) + "\n";
// Node reads this switch at startup. Use the proxy already configured on the teacher's machine.
if (mode !== "check" && !process.env.NODE_USE_ENV_PROXY && (process.env.HTTPS_PROXY || process.env.HTTP_PROXY)) {
  const child = spawnSync(process.execPath, process.argv.slice(1), {
    stdio:"inherit", env:{...process.env,NODE_USE_ENV_PROXY:"1"}
  });
  process.exit(child.status ?? 1);
}

async function main() {
  if (!["check","import","set","unbind"].includes(mode)) throw Error("用法见 _worker/README.md 中的教师操作。");
  let imported, student;
  if (mode === "check" || mode === "import") {
    if (args.length !== 1) throw Error("请指定一个 .xlsx 或 .csv 文件。");
    imported = JSON.parse(execFileSync("python", ["-X","utf8",fileURLToPath(new URL("./read_sheet.py",import.meta.url)),args[0]],
      {encoding:"utf8",maxBuffer:8*1024*1024,stdio:["ignore","pipe","inherit"]}));
    checkRoster(imported);
    if (mode === "check") { console.log("检查通过，共 " + imported.length + " 名学生。"); return; }
  } else if (mode === "set") {
    if (args.length < 3) throw Error("请依次提供学号、姓名、学院以及零至三个主题编号。");
    student = {id:clean(args[0]),name:clean(args[1]),college:clean(args[2]),topics:args.slice(3).map(Number)};
    checkRoster([student]);
  } else if (args.length !== 1) throw Error("请提供需要解除绑定的学号。");

  const credential = execFileSync("git",["credential","fill"],{input:"protocol=https\nhost=github.com\n\n",encoding:"utf8",stdio:["pipe","pipe","inherit"]});
  const token = credential.match(/^password=(.+)$/m)?.[1].trim();
  if (!token) throw Error("请先用有权访问作业私库的 GitHub 账号登录 Git。");
  const store = await privateRepositoryStore(token);
  for (let attempt=0; attempt<7; attempt++) {
    const snap = await store.snapshot({includeRoster:true});
    const files = [];
    if (mode === "unbind") {
      if (!snap.ledger.bindings.some(b => b.id === args[0])) throw Error("这个学号没有 GitHub 绑定。");
      snap.ledger.bindings = snap.ledger.bindings.filter(b => b.id !== args[0]);
      files.push({path:"ledger.json",content:json(snap.ledger)});
    } else {
      const roster = mode === "import" ? imported : [...snap.roster.filter(s => s.id !== student.id), student];
      checkRoster(roster);
      files.push({path:"roster.json",content:json(roster)},{path:"README.md",content:teacherReport(roster,snap.ledger)});
    }
    if (await store.commit(snap, files, mode === "unbind" ? "教师解除 GitHub 绑定" : "教师更新课程分配表")) {
      console.log("已保存到私有作业仓库。");
      return;
    }
  }
  throw Error("仓库正在处理其他提交，请稍后重新运行。");
}
main().catch(error => { console.error(error.message); process.exitCode=1; });
