# 计算几何课程作业管理

学生从[课程首页](https://mathjk.github.io/2026fallCGdemo/)进入。老师登录 GitHub 后打开[私有作业仓库](https://github.com/Mathjk/2026fallCG-submissions)，首页可以按学生、按题目查看最新版本，底部的「全部成功提交」逐次列出时间、原文件名、登录方式和 ZIP 链接。名单匹配记录表示当时填写的资料与名单一致；GitHub 记录另含该账号的固定 ID。

## 录入分配

在课程 Excel 模板的「学生名单与分配」表中填写，「主题目录」表可查编号。使用其他工作簿时，程序读取当前工作表，也可以直接导入 CSV。表头为「学号」「姓名」「学院」「主题编号」。学号一列用文本格式保留前导零。一行填写一个学号与一个编号，主题未分配时该格留空。同一学生可以有多行。导入会整体替换分配表，各次成功上传的文件和历史记录会保留。

在本目录运行下列命令。需要 Node.js 22 或更新版本、Python 3 以及已登录教师账号的 Git。读取 Excel 时需要 Python 的 openpyxl 包。先检查，确认后再导入。真实名单请保存在公开代码仓库以外。

~~~sh
node teacher.mjs check "/path/to/分配.xlsx"
node teacher.mjs import "/path/to/分配.xlsx"
~~~

单独调整一人时，依次提供学号、姓名、学院和调整后的全部主题编号。省略编号表示暂未分题。

~~~sh
node teacher.mjs set "学号" "姓名" "学院" 8 14
~~~

## 设置截止时间和文件上限

在[私库收交设置](https://github.com/Mathjk/2026fallCG-submissions/blob/main/policy.json)编辑 maxMiB、deadline 和 allowLate。初始上限为 10 MiB，可设 1 至 20。deadline 初始为 null，设置时填写带时区的时间，例如 2026-12-20T23:59:59+08:00。allowLate 初始为 false。设置截止后，false 表示停止首交和更新，true 表示继续接收并标记补交。学生页以北京时间显示。

## 处理同一学号的多次提交

批改时以最近一次成功提交为准，也可以从私库首页打开任何旧版本。未绑定时可再次凭名单资料进入。绑定后，该学号只能用所绑定的 GitHub 账号进入。需要纠正误绑定时，老师可以运行以下命令，历史记录会保留。

~~~sh
node teacher.mjs unbind "学号"
~~~

## 后台维护

云函数使用 GitHub App 向指定的私有仓库写入文件。GitHub App 安装权限限于该库的内容读写。GH_APP_ID、GH_APP_KEY（PKCS#8 DER 的单行 Base64）、GH_CLIENT_ID、GH_CLIENT_SECRET 和 SESSION_KEY 在云函数的密钥设置中管理。学生 GitHub 授权的回调地址为 https://mathjk.github.io/2026fallCGdemo/work/ 。浏览器只接收课程会话。后台只保存学生 GitHub 账号 ID 和显示用的用户名。

本目录是云函数源代码。执行 npm ci、npm test、npm run build 可以测试并生成 dist/server/index.js。部署目标支持 ES module Worker 的 fetch 接口。公开前端位于相邻的 work 目录。ZIP、版本记录和教师索引通过同一笔 Git 提交写入私库。并发更新会重新读取最新版本，同一次上传在断线重试时按请求编号去重。
