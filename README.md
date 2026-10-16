# JLPT Listening Studio — V2

本地优先的 JLPT N1 日语精听播放器。V1 的真实音频播放、A–B 循环、逐句编辑、试卷树和 IndexedDB 保存保持可用；V2 增加本地 faster-whisper 转录、保守的试卷结构建议、人工校正流程、ZIP 学习包和离线 PWA。

项目不使用登录、云数据库或收费 AI API。Python 只在制作学习包的电脑上运行；手机导入 ZIP 后不需要 Python，也不需要连接电脑后端。

## 已验证环境

- Windows 11 / PowerShell
- Node.js `v24.21.0`，npm `8.13.2`
- Python `3.13.12`
- faster-whisper `1.2.1`，CTranslate2 `4.8.3`，PyAV `18.1.0`
- 测试音频：`F:\【日语N1听力】2010年7月-2025年12月日语能力考试N1历年真题听力高清音频（题目+原文+答案）_2026年自学N1视频课程jlpt教程_树先生日语\[P01]2025年12月N1听力视频.m4a`

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

打开两个 PowerShell 终端，都进入 `F:\JLPT`。

终端一启动本地 AI：

```powershell
npm run dev:api
```

默认不启用热重载，避免修改 Python 文件时中断几十分钟的整卷转录。只在开发后端且没有任务运行时使用 `npm run dev:api:reload`。

终端二启动前端：

```powershell
npm run dev
```

电脑打开 `http://localhost:5173`。本地 AI 默认地址是 `http://127.0.0.1:8765`，API 文档是 `http://127.0.0.1:8765/docs`。首次选择 `small` 或 `medium` 时会从 Hugging Face 下载对应模型；`small` 约数百 MB，下载完成后可离线推理。

## 第一份真实音频

1. 点击顶部“导入本地音频”，选择 MP3、M4A 或浏览器可解码的 MP4。
2. 完整试卷保持“用于：整份试卷”，并勾选“保存音频到本机”。应用把完整 Blob 写入 IndexedDB，不依赖刷新后失效的 Object URL。
3. 先确认正常播放、拖动和 A–B 循环。
4. 展开“本地 AI 日语转录”，点击“检查服务”，选择 `small`（CPU 推荐）或 `medium`，然后点击“开始真实转录”。
5. 上传和推理期间保持两个终端及页面打开。完成后，句子和结构建议会导入当前试卷。
6. 橙色“推测关联”和灰色“无法判断”必须人工检查。可修改大题/材料边界、拆分或合并材料、重绑小题、修改句子，再点“确认”。
7. 转录结束后可关闭 Python API；播放、编辑、保存、ZIP 导出及 PWA 离线使用不需要后端。

页面刷新不会自动恢复后端内存里的运行中任务，因此长音频转录时不要刷新。已完成结果同时保存为 `backend/data/results/<job-id>.json`，上传临时文件在任务完成或失败后删除。

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
