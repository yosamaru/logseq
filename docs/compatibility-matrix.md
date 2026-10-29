# Agent 兼容性矩阵

核对日期：2026-10-29。下列路径是建议值，写入目标必须通过内置目录选择器显式授权，或在退出应用后配置。CLI 版本检测仅运行用户配置的工具可执行文件 `--version`，不自动安装工具，不把 CLI 存在等同于 Skill 兼容。

## Pi Coding Agent

- [官方说明](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md)。个人目录 `~/.pi/agent/skills`，项目目录 `.pi/skills`。额外发现配置和资源包应交由 Pi 自身管理。
- 原生 Agent Skills，启动时发现，按需读取正文，可显式 `/skill:name`；安装后可能需要重载/重启。Skill Hub 不调用 Skill。

## Codex

- [官方说明](https://learn.chatgpt.com/docs/build-skills)。个人目录 `~/.agents/skills`，项目目录 `.agents/skills`，支持父目录发现与技能目录链接。不能仅假定 `~/.codex/skills` 是当前通用分发位置。
- 专有的 `agents/openai.yaml` 保留原样。禁用设置由用户管理，不自动编辑 config.toml。发现重名不代表合并。

## Claude Code

- [官方说明](https://code.claude.com/docs/en/skills)。个人目录 `~/.claude/skills`，项目目录 `.claude/skills`。
- 专有 frontmatter（如 context、agent、hooks、动态命令）不转换为其他 Agent 配置；存在此类字段时显示可移植性提醒。按当前文档保留名称 synced / anthropic-skills，安装拒绝这些名称。

## 通用约束

- [Agent Skills 规范](https://agentskills.io/specification)：name / description 必填，metadata 为字符串映射，目录名匹配 name。通用格式通过不代表所有专有字段可运行。
- metadata 中的 agents 仅代表作者声明；静态结果和具体 Agent 的识别、加载、执行分别记录，不伪造运行验证。
- 磁盘状态：未安装、已安装、源有更新、安装目录被修改、校验失败。
- 识别、加载和执行：未知，需 Agent 自己提供证据。
- 版本支持：依据上述文档设计，实际 Pi/Codex/Claude CLI 与 Logseq Desktop 版本需在目标环境手工验证；不声称已做发行版全矩阵测试。

## 已执行的 Pi 实测

2026-10-29，已安装 Pi **1.3.0**，使用现有默认模型 `openai-codex/gpt-6.1-sol`，通过原生 `.pi/skills` 项目目录发现 `verify-skill-inventory`。RPC `get_commands` 返回了正确来源路径，显式 `/skill:verify-skill-inventory` 调用加载正文，读取 references，并实际执行随目录分发的只读 Node 脚本。返回的 3 项库存计数、SHA-256 和参考文件标记均与独立运行结果一致。

实测数据为本次生成的虚构样本；模型调用前已取得用户对具体数据及目标服务的明确授权。可复现脚本为 `deps/skill-hub/scripts/pi-acceptance.mjs`，运行证据写入本地忽略的 `PI-ACCEPTANCE.json`。这证明该版本/模型/显式调用路径，不推广为所有 Pi 版本和模型的自动选择保证；Codex 和 Claude 仍未作实际调用验收。
