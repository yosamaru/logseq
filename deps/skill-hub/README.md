# Logseq Skill Hub — 内置核心模块

Skill Hub 通过 Logseq 侧栏直接进入。它随应用构建、由 Electron 主进程管理，不是插件，也不需要额外服务、端口或凭证。真实 Skill 目录始终是唯一正文来源。

## 开发与构建

要求主项目完整开发环境，以及 Node >=22.20.0。模块复用主项目已有版本的 Vite、marked、DOMPurify 和 YAML。

```powershell
# 在仓库根目录执行
pnpm install
pnpm skill-hub:build
pnpm electron-watch
```

Gulp 的标准 build/watch 也包含 Skill Hub：生成 `static/skill-hub/` 管理页面及 `static/js/skill-hub.cjs` 文件模块。生产打包会携带这些产物。新增 CLJS 接线需要正常重新编译，构建单个 JS 模块不能代替整个 Logseq 构建。

独立模块测试：

```powershell
pnpm --dir deps/skill-hub install --ignore-workspace
pnpm --dir deps/skill-hub test
```

测试先生成测试 UI 和 CJS，再用 Node 内置 runner、真实临时文件/Git 仓库和 Edge 浏览器运行。默认 Playwright channel 为 `msedge`；可用 `SKILL_HUB_BROWSER_CHANNEL` 指向已安装的其他 channel。Windows 沙箱可能禁止 junction/rename，应在允许的环境验证，不跳过这些检查。

## 使用

1. 打开侧栏 **Skill Hub**。首次打开创建应用 `userData/agent-skills` 可写根及 `skill-hub-state`，不修改现有图谱。
2. 点击“导入 Skill 目录”，在系统选择器中选择已有根/本地 Git 仓库。默认只读；仅明确勾选“允许编辑”后才授权写入。文件不会迁移。
3. 点击“添加 Agent 安装目标”，选择 Agent，再选择其实际 Skill 目录。可配置个人和项目级目标；目标需要已存在且不得与源或状态目录嵌套。选择只是授权目标，实际写入另需预览确认。
4. 搜索名称、描述、标签、来源、日期；按领域、作者声明的 Agent、版本及安装状态过滤；切换列表/卡片和排序。
5. 在详情编辑 SKILL.md，预览文本差异后确认保存。非法 YAML、元数据和断开引用会提供具体原因并阻止保存。关联文件仅只读浏览；Markdown 预览不允许活跃 HTML、图片或远程链接加载。
6. 选择目标，预览安装/更新、逐文件变化及静态提示，再确认。完整目录复制并验证，不修改 Agent 配置。安装结果只代表磁盘状态，识别/加载/执行始终为未知。
7. 更新保留旧快照，可回滚上一个安装版本；卸载也保留快照，可恢复已卸载内容。外部改动过的安装或备份拒绝覆盖。安装记录包含源、版本、时间、目标和快照。
8. Git 面板显示最近 30 条 SKILL.md 历史及当前 diff，可比较两个完整提交、恢复该文件、为已提交的整个 Skill 目录标记当前 HEAD。不会 reset/clean 其他文件。Git 提交由用户自行完成。
9. 关联到 Logseq 页面只插入源文件链接，不保存第二份正文。选择笔记块后进入 Skill Hub，可把内容显式导出为草稿；也可直接在草稿输入框粘贴内容。知识链接不成为运行依赖。
10. 点击源路径用系统文件管理器定位 SKILL.md。

配置持久化于 `userData/skill-hub-config.json`，状态位于 `userData/skill-hub-state`。高级用户可退出应用后编辑配置，配置结构由 `src/desktop.mjs` 定义。`executables` 可选配置三种 Agent 的绝对二进制路径，仅用于 `--version`；不支持任意 shell 命令和 `.cmd` 包装器。自定义/企业目录应明确选择，首版不自动解析所有 Agent 配置。

metadata 依规范使用字符串值，列表用逗号分隔，例如：

```markdown
---
name: code-review
description: Review source code when a change needs correctness checks.
metadata:
  version: "1.0.0"
  tags: "code, review"
  domain: "engineering"
  agents: "pi, codex, claude"
  source: "https://example.com/team/skills"
---

Read [the checklist](references/checklist.md).
```

目录名应匹配 name。兼容性是作者声明加静态提醒，专有字段原样保留；声明依赖目前只展示，不安装、不运行。

## 安全和恢复

所有写入使用五分钟有效、一次性预览计划；确认前复查指纹。拒绝越界路径、符号链接/junction、硬链接及特殊文件。单个目录限制 10,000 文件、32 MiB；源文/文本浏览限制 2 MiB，扫描深度 20。静态规则不执行任何脚本，也不能证明 Skill 无恶意。

`installations.json` 保存所有权，`backup-*` 保存快照，`transaction-*.json` 表示未完成事务。备份需与原内容同等保护，未自动清理。中断时停止应用，按 journal 中的准确 source/destination/stage/backup/previous 核对磁盘和记录，手工恢复或清理该 staging；确认一致后再移除对应 journal。不要删除整个状态目录，否则会丢失所有权记录。未恢复事务只阻止对应目标。

同用户恶意并发目录替换仍是路径检查边界，避免其他程序同时修改受管目录。首版没有自动崩溃恢复或权限配置移除 UI。

## 模块与接口

- `src/hub.mjs`：仓库索引、预览/确认、安装事务。
- `src/files.mjs`、`validate.mjs`、`git.mjs`、`adapters.mjs`：可独立测试的业务模块。
- `src/desktop.mjs`：Electron 生命周期、配置授权和多窗口串行队列。
- `src/ui/`：内置管理视图，接收核心翻译与限定宿主能力，不依赖插件 SDK。
- `src/main/frontend/components/skill_hub.cljs`：原生路由宿主。
- `src/electron/electron/skill_hub.cljs`：IPC 和系统目录选择器。

IPC 合约见 [ipc-contract.md](ipc-contract.md)，兼容性见 [compatibility-matrix.md](../../docs/compatibility-matrix.md)。测试报告与运行日志不提交到仓库。

## Windows Release

新版本成功发布且确认安装包、示例 Skill 和校验文件齐全后，自动删除旧的已发布 Release 及其附件，只保留发布时间最新的一版。Git 标签、提交历史和草稿不受影响；构建或发布失败时不清理旧版本。

GitHub Actions 中运行 `Build Windows Release`，或推送 `skill-hub-v*` 标签。工作流在 Linux 编译核心和 CLI，再由 Windows 构建无签名 x64 NSIS 安装包。只有构建和测试成功后才发布预发行 Release，包含 `.exe`、示例 Skill ZIP 和 `SHA256SUMS.txt`。手动运行自动生成独立 Release 标签，不覆盖已有版本。此流程使用仓库的 `GITHUB_TOKEN`，不需要官方签名服务凭证。

许可证：AGPL-3.0-only。YAML 2.8.4（ISC）、marked 17.0.6（MIT）、DOMPurify 3.4.2（Apache-2.0 OR MPL-2.0）；构建复制浏览器依赖许可证。Vite 8.0.10（MIT）及 Playwright 1.58.2（Apache-2.0）仅开发/测试使用。未升级主项目组件版本。
