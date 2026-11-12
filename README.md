# 时环 Timering

轻量 Windows 桌面应用：把每天记成一只 24 小时的环（bullet-journal 式时间块）。单击空白处填写时间，或沿环拖出一段弧、输入标签、回车，即完成记录。

## 使用

- 成品在 `dist/timering/`：双击 `timering-win_x64.exe`，或用 `launch.vbs`（推荐，支持单实例唤起）。
- 关闭窗口 = 隐藏到托盘，进程常驻；托盘菜单可呼出。
- Windows 托盘左键单击打开并聚焦窗口，右键显示菜单；选择“退出”彻底结束程序。
- 设置里可开启：开机自启、全局快捷键 `Ctrl+Alt+T`。
- 数据按天存为人类可读 JSON：`%APPDATA%\timering\days\YYYY-MM-DD.json`，可直接备份或编辑。
- 历史页可翻看任意一天的环。
- 沿环顺时针拖动创建时间段，默认吸附到15分钟；按住 Shift 开始拖动可精确到5分钟。精度在按下时固定，途中松开 Shift 不会改变起点。支持跨午夜，逆向微调不会误选近一整天。
- 单击日视图空白处即可新建事件，起止时间留空供填写；时间段可以重叠，重叠事件在环带内分层显示，也可从下方列表分别编辑。

## 开发

需要 Windows、Node.js / npm、WebView2，以及 Windows 自带的 .NET Framework 4.x 编译器（用于构建托盘辅助程序）。
仓库仅包含源码；首次使用时下载对应的 Neutralino 运行库，再启动开发环境：

```bash
npm ci
npx neu update # 下载配置中指定版本的 Neutralino 运行库
npm test       # 自动检查
npm run dev    # neu run，浏览器调试可用 http://localhost:5139/?browser
npm run build  # neu build --release
```

开发启动和发布构建都会先编译 Windows 托盘辅助程序；发布结果在 `dist/timering/`，压缩包为 `dist/timering-release.zip`。重建发布包前请从托盘退出正在运行的时环。

技术栈：Neutralino.js（系统 WebView2，单 exe ~2.5MB，常驻内存 ~30MB + webview）。
