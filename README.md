# JLPT Listening Studio — 学习端 V3

本地优先的 JLPT N1 听力学习软件。普通使用流程只有：选择已安装试卷、按题练习并作答、需要时进入逐句精听。学习端不显示音频上传、AI 转录、手动分句或题库编辑器。

项目不使用登录、云数据库或收费 API。题库、音频和作答记录保存在当前浏览器的 IndexedDB；PWA 应用壳可缓存供离线打开。真实真题音频不会自动提交到 Git 或任何公共服务。

## 当前版本启动

Windows PowerShell：

```powershell
Set-Location -LiteralPath 'F:\JLPT'
npm install
npm run dev
```

打开终端显示的本机地址，通常是 `http://127.0.0.1:5173`。这一个命令会同时启动学习端、本机资源服务，并扫描项目根目录的 `Listen` 文件夹；不需要再选择音频、点击上传或单独运行 AI。

整卷音频建议在系统 Edge 或 Chrome 中打开 `http://127.0.0.1:5173/`，不要长期放在 VS Code/Codex 内嵌预览中。首次打开某份整卷音频时需要从 IndexedDB 读取元数据；如果此时立即点击句子，播放器会记录该操作并在音频就绪后自动开始，不会再把尚未取得的时长 0 误报为区间越界。

首次安装依赖时还需要准备项目自带的 Python 虚拟环境：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r .\backend\requirements-dev.txt
```

`Listen` 中已有匹配的转录结果时会直接生成题库包；遇到新音频时会在本机用 `small + CPU int8` 自动转录，首次运行还会下载模型，因此可能需要较长时间。批处理会逐份写入检查点，某一份失败不会中断后续文件；重新运行会复用已经保存的转录和题库包。页面每 10 秒检查一次，每完成一份就会自动把题库结构和原始音频安装到当前浏览器的 IndexedDB，无需等待整批结束。

默认最多使用 4 个 CPU 线程并以单任务顺序转录，以便浏览器和编辑器保持响应。需要自行调整时，可先设置当前 PowerShell 会话的 `JLPT_WHISPER_CPU_THREADS`，再启动处理；同时启动多个命令会由文件锁阻止，避免重复推理：

```powershell
$env:JLPT_WHISPER_CPU_THREADS = '4'
npm run prepare:listen
```

生产检查与本机预览：

```powershell
npm test
npm run typecheck
npm run build
npm run preview
```

## 学习端功能

- 首页按年份、月份展示已安装试卷，并显示已答题数。
- 自由练习支持大题/题号跳转、上一题/下一题、完整 Passage 播放、暂停、拖动、前后 2 秒、答案本地保存和清空本卷记录。
- 题库可分别描述文字选项、图示选项、仅编号选项和由音频播报的选项；`correctAnswer` 未提供时不会显示正确选项或计算分数。
- 多个 Question 可以共享同一个 Passage。共享材料切题不会重新载入音频，不会自动回到开头，各题答案彼此独立。
- 逐句精听使用题库内已经校对的 `start` / `end`；点击句子播放 1、3、5 次或无限循环，支持 0.5、0.7、0.8、1.0、1.25、1.5 倍速、上一句/下一句、显示/隐藏原文以及播放整个 Passage。
- 电脑使用左侧题号导航；窄屏改为折叠导航和底部固定播放器。
- 首次运行自动安装一套明确标注为“演示数据 · 非真题”的题库。其 WAV 是本机生成的操作确认提示音，不冒充日语真题音频。

## 标准化题库数据

学习端使用独立的 `schemaVersion: 3` 模型，定义在 `src/library/types.ts`：

```text
Exam
└─ Section
   ├─ Passage ── AudioAsset
   │  └─ Segment[]
   └─ Question[] ── passageId
```

`Section`、`Passage`、`Question`、`Segment` 和 `AudioAsset` 均使用稳定字符串 ID。Question 通过 `passageId` 引用材料，因此多个题目可共享同一材料和音频。Passage 与 Segment 的时间戳一律相对于其 `audioAssetId` 的音频文件；不要把整卷绝对时间和切片文件局部时间混用。

## 安装真实题库包

日常开发时只需把 MP3、M4A、MP4、WAV、FLAC、OGG 或 WebM 放进项目的 `Listen` 文件夹，再运行 `npm run dev`。程序会自动完成扫描、复用或执行本地转录、生成标准题库包，并在页面打开时安装；下次打开会直接出现在试卷库。`Listen/`、模型、识别结果和生成包均已加入 `.gitignore`，真实音频不会进入 Git。

首页仍保留“手动安装其他 ZIP”，用于在手机等没有本机 Python 服务的设备上安装已经制作好的包，不是电脑端处理当前 `Listen` 音频的必需步骤。生成包位于 `backend\data\library_packages\<音频哈希>.jlpt.zip`；它包含原音频，也已被 Git 忽略。

ZIP 格式：

```text
manifest.json
exam.json
audio/<audioAssetId>.<扩展名>
```

`manifest.json` 的 `format` 必须是 `jlpt-listening-exam-package`、`version` 为 `1`，并用 `audioFiles` 把每个 AudioAsset ID 映射到 ZIP 中的文件。`exam.json` 使用 `ExamPackagePayload`。导入器会检查稳定 ID、所有关联、标准答案是否属于选项、Passage 边界和 Segment 是否位于所属 Passage 内；结构不确定时应留空，不得编造题目、选项或答案。

当前阶段没有把题库制作编辑器暴露给普通用户。自动识别结果明确标记为“自动识别 · 待校对”；规则无法确认的材料会保留为待确认入口，且不会编造选项、正确答案或评分。手机不运行 Python：需要把本机生成的 `.jlpt.zip` 传到手机后，在首页安装一次。现有 `src/persistence/examPackage.ts` 负责完整校验和读取。

## 本地存储和离线限制

- 音频 Blob 存在 IndexedDB，不依赖刷新后失效的 Object URL。
- 应用会请求持久存储，但浏览器可以拒绝；设备空间紧张、清除站点数据、无痕/私密浏览或卸载浏览器都可能删除题库。
- `localhost`、局域网地址和 GitHub Pages 是不同站点，各有独立存储；电脑和手机需分别安装题库包。
- ZIP 解压在浏览器内存中完成，低内存手机处理超大整卷可能失败；包和原始音频应另行备份。
- Service Worker 只在生产构建注册。首次联网打开后可缓存应用壳；题库音频仍由 IndexedDB 管理。

## GitHub Pages 与手机安装

仓库包含 `.github/workflows/deploy-pages.yml`。推送到 `main` 后，GitHub Actions 会运行前端测试、构建 `dist`，再通过 GitHub Pages 官方 Actions 发布 PWA。工作流只上传构建后的网页程序；`Listen/`、Whisper 模型、转录结果和 `.jlpt.zip` 题库包均被 `.gitignore` 排除，不会发布到公开网站。

部署完成后，在手机浏览器打开 Pages 地址：Android Chrome 可选择“安装应用”或“添加到主屏幕”；iPhone/iPad Safari 可选择“共享 → 添加到主屏幕”。随后把 `backend\data\library_packages\*.jlpt.zip` 私下传到手机，在应用首页选择“手动安装其他 ZIP”。题库和作答记录只保存在该手机浏览器中，不会上传到 GitHub，也不会与电脑自动同步。

## 当前测试

前端 26 项自动化测试覆盖原有 A–B 循环和句子操作，以及学习端的题目顺序、共享 Passage 不重载、独立答案、精听返回题号、缺少标准答案不评分、清除记录、题库包校验/读取、修正版题库升级和 Windows Chromium 大包下载回归。后端 18 项测试覆盖转录分类、自动题库生成、共用材料、未知材料占位、未分类句子保留、批处理中单文件失败隔离和本机接口限制。HTMLAudioElement 的系统音量和移动浏览器手势限制仍需用目标设备手动验证。

## 附录：历史 V2 制作端记录

以下内容记录仓库中保留的 faster-whisper、人工编辑和旧学习包实现。当前 `npm run dev` 会在后台复用其中的转录能力处理 `Listen`；旧编辑界面仍不暴露给普通学习用户。

## 已验证环境

- Windows 11 / PowerShell
- Node.js `v24.21.0`，npm `8.13.2`
- Python `3.13.12`
- faster-whisper `1.2.1`，CTranslate2 `4.8.3`，PyAV `18.1.0`
- 测试音频：`F:\JLPT\Listen\[P01]2025年12月N1听力视频.m4a`

上述媒体目录确实存在，测试文件是 46:16.92 的 AAC/M4A。JiJiDown 自带的 FFmpeg 位于 `F:\JiJiDown\OrderEXE\ffmpeg.exe`；它没有加入当前 PATH，但 V1 浏览器播放和 V2 faster-whisper 都不依赖系统 FFmpeg，因为后者通过 PyAV 解码。

> faster-whisper 1.2.1 在当前 Python 3.13 环境可安装。项目把 `av` 固定为 `<19`，避免 PyAV 19 与 faster-whisper 1.2.1 的参数兼容问题；通常不需要另外安装 Python 3.11。

如仍想让当前 PowerShell 会话识别 JiJiDown 的 FFmpeg，可选运行：

```powershell
$ffmpegFolder = 'F:\JiJiDown\OrderEXE'
$env:Path = "$env:Path;$ffmpegFolder"
ffmpeg -version
```

永久写入当前用户 PATH（执行后重启 VS Code）：

```powershell
$ffmpegFolder = 'F:\JiJiDown\OrderEXE'
$userPathBefore = [Environment]::GetEnvironmentVariable('Path', 'User')
if (($userPathBefore -split ';') -notcontains $ffmpegFolder) {
  [Environment]::SetEnvironmentVariable('Path', "$userPathBefore;$ffmpegFolder", 'User')
}
```

这只是命令行便利设置，不是本项目的运行前提；JiJiDown 附带的是较旧精简版，不建议替代日常使用的完整版新版 FFmpeg。

## 安装

在 PowerShell 中运行：

```powershell
Set-Location -LiteralPath 'F:\JLPT'
npm install
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r .\backend\requirements-dev.txt
```

如果 `python` 不是 3.13.12，请先用 `python --version` 确认实际解释器。依赖安装确实失败时，再并行安装 Python 3.11，并用其完整路径创建 `.venv`；不要覆盖系统 Python。

## 启动

正常使用只需一个终端：

```powershell
npm run dev
```

电脑打开 `http://127.0.0.1:5173`（以终端实际地址为准）。开发服务器通过同一地址读取已经生成的本机题库，不再依赖单独的 `8765` 端口；服务只绑定回环地址，音频包不会通过局域网接口提供。首次处理新音频时会下载 `small` 模型；下载完成后可离线推理。

## 第一份真实音频

1. 把原始音频放入 `F:\JLPT\Listen`。
2. 运行 `npm run dev` 并保持终端打开；无需在网页中上传。
3. 打开或刷新终端显示的 `http://127.0.0.1:5173`，等待首页显示“Listen 自动同步已连接”。
4. 处理完成后，自动生成的试卷会出现在首页，并写入 IndexedDB；之后即使本机资源服务关闭，已安装内容仍可播放。
5. 先验证完整材料播放、逐句播放、变速和循环。自动材料边界与转录仍须人工校对，未核实答案不会显示评分。

## 识别与分类规则

- faster-whisper 固定 `language="ja"`、`word_timestamps=True`，CPU 使用 `int8`。
- 原始 Whisper segment 不直接当成句子；后端结合逐词时间戳、日语句末标点、停顿和最大长度重新断句。词级时间戳及其原始 segment 索引会随工作区和 ZIP 一起保留。
- 分类器只根据音频转录中明确出现的 `問題1`、`1番`、`質問1`、提问语和讲解提示生成建议。
- 关联状态严格分为“确认成功”“推测关联”“无法判断”。音频没读出的题号、选项或答案不会被补写。
- 一个 Passage 可关联多个 Question，一个 Question 可引用同一 Passage 的多个 Segment。
- 重新分析会替换上一次未确认的 AI 结果，但尽量保留人工新建、人工修改及已确认的内容和稳定 ID。

自动分类是初步建议，不是答案识别。含背景音乐、重叠说话、长停顿、播音员省略题号或识别错字时，材料边界和题目关联可能无法判断；这不会阻止播放和手动编辑。

## ZIP 学习包与手机

“学习包”面板可导出一个 ZIP，包含：

- `manifest.json`：格式版本和文件清单
- `workspace.json`：试卷树、逐句转录、人工修改、练习进度和设置
- `audio/*`：用户已保存到 IndexedDB 的原始音频 Blob

把 ZIP 传到手机，在同一页面选择“导入学习包”即可恢复结构和音频。导入会覆盖当前浏览器工作区，因此应用会先提示确认；建议保留 ZIP 和原始音频备份。

限制：

- ZIP 的压缩和解压在浏览器内存中完成；接近 1–2 GB 的整卷或低内存手机可能失败。
- IndexedDB 配额由浏览器和设备决定，也可能被系统在空间紧张时回收。页面会请求持久化存储，但浏览器可以拒绝。
- Safari 私密浏览、清除站点数据或卸载浏览器会丢失本地学习包。
- `localhost`、局域网 IP 和 GitHub Pages 是不同站点，各有独立 IndexedDB；用 ZIP 在它们之间迁移。
- 手机上的静态 PWA 不能运行 faster-whisper；先在电脑完成转录并导出 ZIP。

## PWA 与 GitHub Pages

生产构建：

```powershell
npm run build
npm run preview
```

`dist` 使用相对资源路径，可部署在 GitHub Pages 的项目子目录。仓库包含 `.github/workflows/deploy-pages.yml`；把代码推送到 GitHub 后，在仓库 Settings → Pages 把 Source 设为 GitHub Actions，再推送 `main` 即可部署。

Service Worker 仅在生产构建注册。首次联网打开后会缓存应用壳；音频不进入 HTTP 缓存，而保存在 IndexedDB。浏览器只有在 HTTPS（或 localhost）下才允许安装和完整使用 Service Worker。新版本部署后通常需重新打开页面才会接管缓存。

## V1 操作

- 播放：正常播放/暂停、整卷播放、前后 2 秒、上一句/下一句、0.5–1.5 倍速。
- A–B：1、3、5 次或无限循环，可设置循环停顿；切换倍速不会重置次数。
- 句子：创建、删除、合并、拆分、修改边界和日语文本，点击句子即可循环。
- 结构：稳定 ID 的 Exam → Section → Passage → Question → Segment 关联，可手动创建和重绑。
- 保存：结构、文本、时间轴、进度、设置和所选音频 Blob 都写入 IndexedDB。

快捷键：空格播放/暂停，`A`/`B` 设置边界，`L` 开始或取消循环，左右方向键前后 2 秒，`[`/`]` 上一句/下一句，`M` 显示或隐藏原文，`Esc` 取消循环。输入框获得焦点时不会抢占按键。

## 测试

```powershell
npm run test
npm run typecheck
npm run build
npm run test:api
```

前端测试覆盖 A–B 次数/停顿状态机、句子创建拆分合并、V1→V2 数据迁移和重新分析时保留人工校正；后端测试覆盖逐词时间戳断句、保守分类以及上传任务 API。完整真实音频验收必须另外启动 API，通过页面上传实际 M4A 运行。

### 本次真实音频验收

2026-10-15 使用上面的 46:16.92 M4A 和 `small + CPU int8` 完成了端到端推理；从 API 接收文件到保存结果约 17 分 47 秒。结果位于 `backend/data/results/44cc56950b18420eb7837c1c4fe27e88.json`（该目录默认不提交 Git）：

- 检测语言 `ja`，概率 `1.0`
- 462 个重新断句区间，保留 6,547 个词级时间戳
- 5 个大题、26 个材料、17 个小题建议
- 24 个材料为“确认成功”，2 个因题号跳号降级为“推测关联”
- 综合理解材料成功保留“一材两题”
- 重复大题提示已合并；普通表达中的“一番”不会被当作题号
- 0 个非法时间区间、0 个重复句子 ID、0 个悬空材料/小题引用

`small` 仍会出现专有名词错字，并可能漏听题号。当前分类器不会补造漏掉的题号；检测到 `4番 → 6番` 之类跳号时，会把相邻材料边界标成“推测关联”，由用户拆分并确认。追求文本准确率时可改用 `medium`，代价是 CPU 推理更慢、内存和模型空间更大。

## 目录

```text
src/                    React 播放器、人工校正、ZIP/PWA
src/ai/                 FastAPI 客户端和转录结果类型
src/domain/             句子操作与 AI 结果导入/保留规则
src/persistence/        IndexedDB、迁移、学习包
backend/app/            FastAPI、任务管理、转录、断句、分类
backend/tests/          Python 自动化测试
backend/data/models/    本地模型缓存（Git 忽略）
backend/data/results/   已完成转录 JSON（Git 忽略）
public/                 PWA manifest、图标、Service Worker
```
