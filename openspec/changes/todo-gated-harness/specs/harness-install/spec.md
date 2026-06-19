## ADDED Requirements

### Requirement: init 程序检测平台并注入对应配置
init 引导程序 SHALL 检测当前所在平台(Claude Code / Codex / Pi·Hana),并把预制的 hook 配置 merge 进对应平台的配置文件。

#### Scenario: 检测 Claude Code 并注入 settings.json
- **WHEN** init 检测到 Claude Code 环境(存在 .claude/ 或相关标志)
- **THEN** init SHALL 将 hooks 配置 merge 进 `.claude/settings.json` 的 `hooks` 字段,不覆盖用户已有配置

#### Scenario: 检测 Codex 并注入 config.toml
- **WHEN** init 检测到 Codex 环境
- **THEN** init SHALL 将 `[hooks]` 段配置 merge 进 `config.toml`

#### Scenario: 检测 Hana 并装 full-access 插件
- **WHEN** init 检测到 HanaAgent 环境
- **THEN** init SHALL 将 full-access 插件(含 extensions/)安装到 Hana 插件目录

### Requirement: init 放置核心脚本与 SKILL.md
init SHALL 将平台无关的核心脚本、各平台薄 hook 适配层入口、以及 TodoPro SKILL.md 放置到正确位置。

#### Scenario: 放置核心脚本
- **WHEN** init 执行
- **THEN** init SHALL 放置零依赖纯 Node 核心脚本到约定位置,供各平台 hook 入口调用

#### Scenario: 放置 SKILL.md
- **WHEN** init 执行
- **THEN** init SHALL 将 TodoPro SKILL.md 放置到平台技能目录,使模型可发现并自主调用

### Requirement: init 提示重载
init SHALL 在完成后提示用户重载平台以使钩子生效。

#### Scenario: 提示重载
- **WHEN** init 完成所有配置与文件放置
- **THEN** init SHALL 输出明确的重载提示(如"请重启 Claude Code / 重载配置以使钩子生效")

### Requirement: init 接受平台参数
init SHALL 接受一个平台参数,允许用户显式指定目标平台,而非仅靠自动检测。

#### Scenario: 显式指定平台
- **WHEN** 用户运行 init 时传入平台参数(如 `init --platform claude-code`)
- **THEN** init SHALL 跳过自动检测,直接为指定平台执行安装逻辑
