# 计算几何课程作业管理

学生从课程首页的「提交作业」进入，填写姓名、学号、学院，选择主题并上传 ZIP。老师可以在私库首页按学生或主题查看当前版本，在「全部成功提交」中打开旧版 ZIP、核对原文件名和时间。「自行填报」记录表示提交人当时填写的资料，绑定后的提交另记 GitHub 账号的固定 ID。[课程首页](https://mathjk.github.io/2026fallCGdemo/) · [私有作业仓库](https://github.com/Mathjk/2026fallCG-submissions)

## 选题与更新

23 个主题与课程讲义使用同一套编号。每题全班只有一个名额，第一次成功保存 ZIP 的学号取得该题。打开页面、选择题目、上传失败都不占名额。每个学号最多提交三个不同主题。老师无需预先分配或导入名单。

「我的作业」显示该学号已交的主题和版本。学生点击「更新 ZIP」会基于页面显示的版本保存下一版。两个窗口同时基于同一版本更新，只有一个能成功。断线重试已经保存的同一次上传，会返回原回执。

## 设置截止时间和文件上限

单份 ZIP 上限由私库的 maxMiB 控制，可设为 1 至 20 MiB。学生提交页会读取并显示当前上限。2026 年 12 月 31 日北京时间 23:59 起停止首次提交和更新。老师也可以在私库编辑 deadline（带时区的时间）和 allowLate（是否允许补交）。[私库收交设置](https://github.com/Mathjk/2026fallCG-submissions/blob/main/policy.json)

## 处理同一学号的多次提交

批改时以最近一次成功提交为准。未绑定时，学生使用首次提交时填写的学号、姓名和学院进入。绑定后，该学号通过所绑定的 GitHub 账号进入。需要纠正误绑定时，老师可在本目录使用有权访问私库的 Git 账号运行以下命令。

~~~sh
node teacher.mjs unbind "学号"
~~~

## 后台维护

云函数使用 GitHub App 向指定的私有仓库写入文件。GitHub App 安装权限限于该库的内容读写。GH_APP_ID、GH_APP_KEY（PKCS#8 DER 的单行 Base64）、GH_CLIENT_ID、GH_CLIENT_SECRET 和 SESSION_KEY 在云函数的密钥设置中管理。学生 GitHub 授权的回调地址为 https://mathjk.github.io/2026fallCGdemo/work/ 。浏览器只接收课程会话。后台只保存学生 GitHub 账号 ID 和显示用的用户名。

本目录是云函数源代码。执行 npm ci、npm test、npm run build 可以测试并生成 dist/server/index.js。部署目标支持 ES module Worker 的 fetch 接口。公开前端位于相邻的 work 目录。ZIP、版本记录和教师索引通过同一笔 Git 提交写入私库。并发更新会重新读取最新版本，同一次上传在断线重试时按请求编号去重。
