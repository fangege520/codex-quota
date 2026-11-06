# 安装 Codex Quota

## 成品安装包

- [Windows x64 · 下载 `.exe`](https://github.com/fangege520/codex-quota/releases/download/v0.4.4/Codex-Quota-0.4.4-win-x64.exe)
- [Mac Apple 芯片 · 下载 `.dmg`](https://github.com/fangege520/codex-quota/releases/download/v0.4.4/Codex-Quota-0.4.4-mac-arm64.dmg)
- [Mac Intel · 下载 `.dmg`](https://github.com/fangege520/codex-quota/releases/download/v0.4.4/Codex-Quota-0.4.4-mac-x64.dmg)

安装前先退出正在运行的用量助手。Windows 运行下载的 `.exe`。Mac 打开 `.dmg` 后，将 **Codex Quota.app** 拖入「应用程序」，然后从 Finder 打开。安装后用已登录 ChatGPT 的 Codex 读取额度。

## 复制给 Codex 执行

```text
请读取 https://github.com/fangege520/codex-quota/blob/main/INSTALL.md，识别本机的系统和处理器架构，下载对应的 Codex Quota 成品安装包，安装并打开用量助手，验证 Windows 任务栏或 macOS 菜单栏能否显示额度。遇到系统确认、授权或登录时，请让我操作。
```

## 源码安装

需要 Node.js 22.12 或更新版本、npm，以及支持 `codex plugin` 的 Codex CLI。可以优先使用 Codex 自带的现代 Node 运行时。

1. 下载或克隆仓库。已安装的用户请先从托盘或菜单栏退出用量助手。
2. 在仓库根目录运行 `node install.cjs`。安装成功后会启动用量助手并检查额度。
3. 如果提示未登录，请运行 `codex login` 并登录自己的 ChatGPT 账户，然后再次运行安装命令。遇到系统授权提示时，由本人操作。

## 安装后使用

- **Windows**从开始菜单打开 **Codex Quota**。源码安装使用 **Codex（用量助手）** 快捷方式。在任务栏或托盘查看额度。
- **macOS**从 Finder 的「应用程序」打开 **Codex Quota.app**。源码安装在 `~/Applications` 中。在顶部菜单栏查看额度。

要显示 Codex 左栏，等当前任务完成并正常退出 Codex，再从用量助手设置点击 **启动 Codex（用量助手）**。可在设置中开启编辑框额度或桌面悬浮框。

Mac 上用量助手会自动查找支持 Codex 的 ChatGPT。若仍提示找不到应用，先从 Finder 打开 ChatGPT，确认左上角可以切换到 **Codex**，再在用量助手设置里点击 **选择 Codex 程序**，手动选中这个 `ChatGPT.app`。
