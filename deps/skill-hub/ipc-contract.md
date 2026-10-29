# 内置 Skill Hub IPC 合约

生产环境没有 HTTP API、服务端口或凭证。下列接口通过现有 Electron `main` IPC channel 调用，只对本应用受信 renderer 暴露。

## 原生路由与嵌入视图

视图发送 `{channel: "logseq-skill-hub", id, operation, args}`。宿主校验精确 iframe source、相同 origin 和 channel，回复相同 id 的 `{result}` 或 `{error: {message}}`；视图也校验 parent/source/origin。请求超时 45 秒；不能将客户端超时理解为已取消磁盘操作。

允许 operation：startup（核心翻译和选中笔记）、rpc（业务请求）、directory（原生选择器）、reveal（已索引 Skill 文件定位）、editor（getCurrentBlock/getPage/createPage/insertBlock）、close（返回首页）。没有任意 fs、shell、脚本执行或远程导入接口。

## Electron 方法

- `:skill-hub/request operation args`：返回 `{result}` 或 `{error:{code,message,details?}}`。业务错误始终作为数据返回，避免既有通用 IPC 拒绝日志记录编辑正文。多个窗口在同一个 DesktopHub 队列串行执行。
- `:skill-hub/directory {kind,writable?,agent?}`：系统目录选择器授权，kind=root/target；取消返回 `{result:{cancelled:true}}`。root 默认只读；target 必须属于 Pi/Codex/Claude。目录重叠/无效/链接被拒绝，权限变更会使旧预览失效。
- `:skill-hub/reveal id`：仅定位索引中的 Skill，不接受任意路径。

## 业务操作

- config、scan、detect：无参数。scan 重建索引并返回 skills/errors/interrupted。
- detail：`{id}`；file：`{id,file}`，file 必须是已索引相对路径。
- history：`{id}`；diff：`{id,from?,to?}`，修订只能是完整提交哈希。
- preview：`{kind,...}`，返回五分钟一次性计划及 before/after 或逐文件 changes、警告和目标。
- confirm：`{plan,confirmed:true}`。拒绝过期/重放及确认后的源/目标变化。

preview kind：save（id,text,expected SHA256）；restore-file（id,revision,expected）；install/uninstall/rollback/restore-install（id,target ID）；tag（id,name）；draft（root ID,name,text）。客户端不能直接指定任意写入路径。

磁盘安装与 Agent 识别、加载、执行分开。后三项没有运行证据时均为 null/未知。中断事务持久化日志，并仅阻止对应安装位置。

## 验证范围

Node 测试验证真实磁盘、配置持久化、一次性确认和打包 CJS；浏览器测试验证实际 iframe 消息桥与业务模块。原生目录选择器、CLJS 接线和真实图谱方法仍需完整 Desktop 验收。
