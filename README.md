# 访谈音频校注 Web 应用

面向口述史 / 访谈录音的**转写片段校注**工具：导入带时间戳的转写稿，在时间轴上
拖选区间，为区间标注**说话人、主题、备注**，导出校注 JSON。支持两位校注者离线
各自编辑同一份基准稿后，进行**三方合并（three-way merge）**——互不重叠的改动
自动合并，重叠改动保留双方版本并要求逐项裁决，裁决结果可继续导出或写回项目。
也支持**规则批量标注**：按说话人、关键词 / 正则、最短持续时间批量命中片段，
在时间轴上预览拟生成区间，确认后批量写入；再次运行同一规则只更新其自身结果，
手工标注永不覆盖，每次应用均可一键撤销。项目内还提供**校注质检工作台**：在
指定时间区间上建立扫描线，检测校注越界、校注之间的时间重叠与说话人不一致，
按严重级别筛选、点击问题定位时间轴，可修复的越界项支持一键裁剪后保存，
质检结果可导出 JSON。

- 前端：React 18 + Vite（纯 CSS，无 UI 框架依赖）
- 后端：FastAPI（Python 3.11）
- 数据库：本地 SQLite（单文件，挂载于 `./data`）
- 部署：单镜像、单容器，Docker 一键启动

---

## 一键启动

### 方式一：Docker Compose（推荐）

```bash
docker compose up -d --build
```

启动后访问：

> **http://localhost:8000**

停止：

```bash
docker compose down
```

### 方式二：Docker 原生命令

```bash
docker build -t interview-annotator .
docker run -d --name interview-annotator \
  -p 8000:8000 \
  -v "$PWD/data:/data" \
  interview-annotator
```

访问 **http://localhost:8000**。

SQLite 数据库文件位于容器内 `/data/annotation.db`，通过宿主机 `./data`
目录持久化，删除容器不丢数据。更换端口可改 `-p` 映射（容器内固定监听 8000）。

健康检查：`GET http://localhost:8000/api/health`。

---

## 使用流程

### 1. 导入转写稿

在首页点击「导入转写稿新建…」，或在项目内点击「导入转写」（项目内导入会替换
片段但**保留已有校注**）。支持三种格式：

**带时间戳的纯文本**（`.txt` / `.srt` / `.vtt` 后缀，或内容无法解析为 JSON 时）：

```text
[00:00:00] 访谈者: 感谢您今天接受访谈
[00:00:19] 受访者: 我叫李明，在制造厂工作了二十多年
[00:00:34] --> [00:00:40] 受访者: 后来 2003 年改制
[01:09.5] 受访者: 最早全靠手摇车床
```

支持 `hh:mm:ss`、`mm:ss`、`mm:ss.mmm` 等时间格式；说话人通过行内的
`名字: 文本`（中英文冒号均可）识别；省略结束时间时，默认持续到下一片段开始
（最后一片段默认 1 秒）。

**JSON 片段数组**：

```json
[
  {"id": "seg-001", "start": 0.0, "end": 4.2,
   "speaker": "访谈者", "text": "感谢您今天接受访谈"}
]
```

未提供 `id` 时后端自动生成；也接受 `startTime/endTime/begin/stop/content`
等别名字段。

**此前导出的校注 JSON**（含 `segments` 与 `annotations`），直接还原整个项目。

示例文件见 [`examples/`](examples/)。

### 2. 时间轴校注

- 顶部时间轴显示片段（灰）与校注（彩色条）；
- **在时间轴上按住鼠标拖选区间**，弹窗中填写说话人、主题、备注；
- 点击已有校注条可再次编辑 / 删除；
- 片段的说话人与文本可直接在下方表格修改、新增或删除；
- 「保存」写入 SQLite；可随时「导出 JSON」下载完整校注文档。

### 3. 规则批量标注

在项目内点击「⚙️ 规则批量标注」（项目列表卡片上也有「规则标注」入口）进入
规则管理页。一条规则由**命中条件**和**生成内容**组成：

| 部分 | 字段 | 说明 |
| --- | --- | --- |
| 命中条件 | 说话人 | 与片段说话人**精确相等**；留空表示不限 |
| 命中条件 | 关键词 / 正则 | 片段文本包含关键词，或匹配 Python 正则；也可选「不限制文本」 |
| 命中条件 | 区分大小写 | 关键词与正则均可配置 |
| 命中条件 | 最短持续时间 | 片段 `end - start` 小于该秒数时不命中 |
| 生成内容 | 主题 | 写入校注的主题（支持模板占位符） |
| 生成内容 | 备注模板 | 写入校注的备注，支持 `{speaker}`、`{keyword}`、`{text}`、`{segments}` |

时间轴上**相邻（连续）的命中片段会合并成一个区间**，区间从首个命中片段的
开始时间延伸到最后一个命中片段的结束时间。

使用流程：

1. 「＋ 新建规则」填写条件后点击「🔍 预览命中」：下方迷你时间轴会叠加显示
   转写片段（灰）、手工校注（红）、其他规则生成的校注（灰蓝）以及本规则
   **拟生成 / 更新的区间（虚线高亮）**，并逐条列出命中的片段原文、区间和
   将生成的主题 / 备注；统计区显示新建、更新、失效移除、手工保留的数量。
2. 保存规则后，可在规则卡片上随时「预览」，确认无误后点击「应用到时间轴」
   或预览面板中的「确认批量写入」。
3. **再次运行同一规则**时，只替换该规则自己生成的校注（以内部
   `ruleId + ruleSlot` 标识归属）：
   - 手工新建的校注、其他规则的结果一律不动；
   - 手工**编辑过**的规则校注会自动解链为手工校注，重跑不会覆盖它（规则
     会为该位置另生成一条新区间）；
   - 手工**删除**的规则校注重跑时不会复活（撤销删除后再应用除外）。
4. 页面底部「应用记录」表可**撤销本次应用**：移除该次生成 / 更新的校注并
   恢复该规则此前的结果，手工标注不受影响；被更新的应用撤销后才会回到
   可撤销状态（新应用会取代旧记录）。
5. 删除规则只会删除规则本身，其已生成的校注会**转为普通手工校注**保留。

规则与应用记录均持久化在 SQLite 中；导出的校注 JSON 里，规则生成的校注带
`source: "rule"`、`ruleId`、`ruleSlot`、`ruleName` 溯源字段（不影响普通
JSON 消费方）。重新导入导出的 JSON 时，这些校注按普通校注处理。

### 4. 双人离线编辑与三方合并（核心）

1. 在基准项目中分别点击「导出 A 离线副本」「导出 B 离线副本」，得到两份 JSON；
   （也可以直接复制项目给两位校注者，只要改动基于同一份基准。）
2. 两人各自在**新建项目时导入自己的离线副本 JSON**，独立完成校注并保存；
   或直接编辑副本文件中的 `document`。
3. 打开顶部「**三方合并**」页：
   - 基准（Base）：下拉选择原始项目，或选择基准 JSON；
   - A、B：分别选择两人的离线副本文件；
   - 点击「开始三方合并」。
4. 页面展示：
   - **自动合并的互不重叠改动**（新增 / 修改 / 删除），按片段与校注分别统计；
   - **需要逐项裁决的冲突**，每张卡片并排显示基准、A、B 三个版本。
5. 裁决方式（可混合使用）：
   - 整条采用 A / 采用 B / 丢弃；
   - 区间重叠冲突还可「双方都保留」；
   - 「按字段逐项裁决」：仅对双方改得不一致的字段选 A 或 B，其余字段自动并入；
   - 「自定义合并值 ✏️」：手工编辑合并后的最终内容。
6. 全部裁决后：
   - 「导出裁决结果 JSON」下载合并文档；
   - 「另存为新项目」；
   - 若基准来自下拉选择的项目，可「写回基准项目」。

> 未裁决完的冲突条目不会进入合并文档（页面会明确提示），裁决可反复调整、
> 实时预览，且不会改动原始项目，直到选择写回 / 另存。

### 5. 校注质检

在项目编辑页点击「🧪 校注质检」进入质检工作台（路由
`/projects/{id}/quality`），也可在质检结果中随时返回编辑页处理。

**检测方式**：后端按项目文档（或指定的时间区间）的所有片段 / 校注端点
建立**扫描线**，逐段统计同一时刻活动的校注与转写片段，检测三类问题：

| 问题类型 | 判定 | 严重级别 |
| --- | --- | --- |
| 🔹 校注越界 `out_of_bounds` | 校注区间落在转写片段覆盖范围之外 | 越过转写首 / 尾边界：`error`；整体在转写之外（不可裁剪）：`error`；仅覆盖内部空隙：`info` |
| 🔸 时间重叠 `overlap` | 两条校注时间区间相交（端点相接不算） | 一条包含另一条，或重叠时长 ≥ 较短条的一半：`error`；其余：`warning` |
| 🎤 说话人不一致 `speaker_mismatch` | 校注说话人与其覆盖的转写片段说话人不同 | 覆盖片段**全部**不一致：`error`；区间横跨说话人切换（部分一致）：`warning` |
| ❔ 说话人缺失 `speaker_missing` | 校注未填写说话人，但其覆盖片段有说话人 | `info` |

每条问题都带：

- 稳定的 `issueId`（如 `qc:overlap:ann-1|ann-2`，只取决于校注 id，
  与扫描次数、时间窗口无关，便于跨次比对 / 归档）；
- `severity`（`error` / `warning` / `info`）、定位区间与相关校注 id；
- **证据片段**：越界的未覆盖区间 / 可保留区间 / 转写覆盖范围、重叠区间
  与重叠秒数、说话人冲突涉及的转写片段原文与被覆盖秒数；
- `fixable` 与 `fix`：首尾越界且仍有合法覆盖部分时给出裁剪建议
  `{start, end}`。

工作台操作：

1. 顶部可填写**时间区间**（秒，留空表示整条转写），点击「🔎 开始质检」；
2. 统计条展示各级别、各类型数量与扫描线数；
3. 用**级别 / 类型筛选条**过滤问题列表；
4. 点击问题卡片的「📍 在时间轴定位」（或直接点击时间轴上的校注条），
   相关校注红框高亮、问题区间红色虚线标出，页面滚动到时间轴；
5. 对可修复的越界项点击「✂️ 一键裁剪到 … 并保存」：按建议区间裁剪校注、
   保存项目（规则生成的校注裁剪后会与规则解链，等同手工编辑），并自动
   重新质检；
6. 「在编辑页处理 →」携带 `?ann=&focusStart=&focusEnd=` 深链回到编辑页，
   编辑页时间轴自动高亮并滚动到该区间；
7. 「⬇️ 导出质检 JSON」下载含项目元数据、扫描窗口、统计与全部问题
   （证据片段、`issueId`、`fix`）的报告文件。

**扫描历史与两次扫描对比**：每次点击「开始质检」（含一键裁剪后的自动复检）
都会把**时间窗口、扫描时间、统计与问题快照**写入 SQLite，工作台底部的
「🕘 扫描历史」表按时间倒序列出该项目的全部扫描（窗口、各级别数量、
可裁剪数），点「查看快照」可只读回看任意一次扫描当时的问题明细。

勾选**两次时间窗口完全相同（开始 / 结束一致）**的扫描后点「⚖️ 对比所选」，
按稳定 `issueId` 标出并统计：

| 分类 | 判定 |
| --- | --- |
| 🆕 新增 | 只在较新的一次扫描中出现的 `issueId` |
| ✅ 已解决 | 只在较早的一次扫描中出现、较新扫描中已消失的 `issueId` |
| ➡️ 仍存在 | 两次扫描都出现的 `issueId`（附较新扫描的问题明细） |

**时间窗口不同的两次扫描明确禁止比较**：历史表中与当前勾选窗口不同的
行会标灰并提示「窗口不同」，选了两行不同窗口时对比按钮禁用并给出红色
提示；绕过前端直接调 API 同样返回 400。对比时按扫描时间自动区分
基准（旧）/ 对比（新），与两个参数的传入顺序无关。删除项目时其全部
扫描历史随外键级联一并清除。

---

## 合并规则说明

合并以条目的稳定 `id`（片段 `seg-*`、校注 `ann-*`）在 **基准 / A / B**
三份文档中比对：

| 情形 | 结果 |
| --- | --- |
| 只有一方新增、修改、删除 | 自动采用 |
| 双方修改同一 id 且内容相同 | 自动采用 |
| 双方修改同一 id，但改动落在**不同字段** | 字段级自动合并 |
| 双方修改同一 id，且同一字段改成不同值 | **字段冲突**，逐项裁决 |
| 一方修改、另一方删除同一条 | **修改/删除冲突**，逐项裁决 |
| 双方各自新增校注，且时间区间互不重叠 | 自动并存（端点相接不算重叠） |
| 双方各自新增校注，且时间区间重叠 | **区间重叠冲突**（重叠链聚合成一个冲突组），逐项裁决 |
| 双方都删除同一条 | 自动删除 |

自定义合并值在服务端校验：时间必须为非负数字、`end >= start`、片段文本非空。

导出 / 合并的 JSON 结构：

```json
{
  "segments": [
    {"id": "seg-…", "start": 0.0, "end": 4.2,
     "speaker": "访谈者", "text": "…"}
  ],
  "annotations": [
    {"id": "ann-…", "start": 0.0, "end": 18.5,
     "speaker": "受访者", "topic": "个人背景", "note": "…"}
  ]
}
```

离线副本文件在文档之外附带 `baseProjectId / editor / exportedAt` 元数据，
合并页能直接识别其 `document`。

---

## API 概览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/projects` | 项目列表 |
| POST | `/api/projects` | 新建项目 |
| GET/PUT/DELETE | `/api/projects/{id}` | 读取 / 保存文档 / 删除 |
| GET | `/api/projects/{id}/export` | 下载校注 JSON |
| POST | `/api/projects/{id}/quality-check` | 校注质检（越界 / 重叠 / 说话人不一致），结果自动存入扫描历史，见下 |
| GET | `/api/projects/{id}/quality-scans` | 项目的扫描历史（时间倒序，含窗口 / 统计，不含问题明细） |
| GET | `/api/projects/{id}/quality-scans/{scanId}` | 读取某次扫描的完整问题快照 |
| POST | `/api/projects/{id}/quality-scans/compare` | 对比两次同窗口扫描，按 issueId 输出新增 / 已解决 / 仍存在 |
| POST | `/api/import` | 上传文件（multipart）或 JSON 文本解析转写稿 |
| POST | `/api/projects/{id}/import` | 导入到指定项目（保留校注） |
| POST | `/api/merge` | 三方合并，可携带 `resolutions` 裁决 |
| GET/POST | `/api/projects/{id}/rules` | 项目的规则列表 / 新建规则 |
| GET/PUT/DELETE | `/api/rules/{id}` | 读取 / 修改 / 删除规则（删除后其校注转为手工） |
| POST | `/api/projects/{id}/rules/preview` | 预览未保存的规则草稿 |
| POST | `/api/rules/{id}/preview` | 预览已保存规则（命中片段、拟生成区间、统计） |
| POST | `/api/rules/{id}/apply` | 应用 / 重跑规则，批量写入 annotations |
| GET | `/api/projects/{id}/rule-runs` | 项目的规则应用记录 |
| POST | `/api/rule-runs/{id}/undo` | 撤销某次规则应用 |
| GET | `/api/health` | 健康检查 |

`POST /api/merge` 请求体：

```json
{
  "base": { "segments": [], "annotations": [] },
  "a": { "…": "…" },
  "b": { "…": "…" },
  "resolutions": {
    "segments:seg-001:modify": {"choice": "fields", "fields": {"speaker": "a"}},
    "annotations:interval:0:ann-a": {"choice": "keep"}
  },
  "saveAsProject": "合并结果"
}
```

`choice` 取值：`a` / `b` / `custom`（附 `value`）/ `drop` / `keep`
（区间冲突）/ `fields`（附字段选择）。`base` 也可省略而改用
`projectId` 指定基准项目；全部冲突裁决完毕时结果自动写回该项目。

### `POST /api/projects/{id}/quality-check`

对**已保存**的项目文档做质检。请求体可省略（或为 `{}`），表示整条转写；
也可指定扫描时间窗口：

```json
{ "start": 60.0, "end": 300.0 }
```

窗口非法（`end <= start`）返回 400，`start` 为负返回 422。返回：

```json
{
  "projectId": "proj-…",
  "projectName": "访谈A",
  "window": { "start": 0.0, "end": 412.5 },
  "explicitWindow": false,
  "summary": {
    "total": 3, "error": 2, "warning": 0, "info": 1,
    "outOfBounds": 1, "overlap": 1,
    "speakerMismatch": 1, "speakerMissing": 0,
    "annotations": 8, "segments": 42,
    "scanLines": 37, "fixable": 1
  },
  "issues": [
    {
      "issueId": "qc:out_of_bounds:ann-1",
      "type": "out_of_bounds",
      "severity": "error",
      "start": 300.0, "end": 412.5,
      "message": "校注「企业改制」越出转写边界：…可裁剪到 300.0s–405.0s",
      "annotationId": "ann-1",
      "annotationIds": ["ann-1"],
      "annotations": [{ "id": "ann-1", "start": 300.0, "end": 412.5,
                       "speaker": "受访者", "topic": "企业改制" }],
      "evidence": {
        "uncoveredRanges": [{ "start": 405.0, "end": 412.5 }],
        "coveredRanges": [{ "start": 300.0, "end": 405.0 }],
        "transcriptCoverage": { "start": 0.0, "end": 405.0 }
      },
      "fixable": true,
      "fix": { "start": 300.0, "end": 405.0 }
    }
  ]
}
```

`type` 为 `overlap` 时 `evidence` 含 `overlapSeconds` 与重叠 `ranges`，
`annotationIds` 列出冲突双方；`speaker_mismatch` / `speaker_missing` 时
`evidence` 含 `annotationSpeaker`、`segmentSpeakers` 与逐个转写片段
（含 `coveredSeconds`）。问题按严重级别（error → warning → info）再按
开始时间排序。前端的「一键裁剪」即把 `fix` 写回对应校注后调用
`PUT /api/projects/{id}` 保存（不产生额外服务端状态）。每次质检都会在
`quality_scans` 表落一条记录，响应中额外带 `scanId` 与 `scannedAt`。

### 扫描历史与对比

`GET /api/projects/{id}/quality-scans` 按时间倒序返回扫描摘要
（列表项不含 `issues` 明细）：

```json
{
  "id": "scan-ab12cd34ef56",
  "projectId": "proj-…",
  "window": { "start": 0.0, "end": 412.5 },
  "explicitWindow": false,
  "summary": { "total": 3, "error": 2, "…": "…" },
  "createdAt": "2026-09-23T10:22:36.669112+00:00"
}
```

`GET /api/projects/{id}/quality-scans/{scanId}` 在此基础上额外返回完整
`issues` 数组（与质检响应中的问题结构一致，含证据 / `fix`）。

`POST /api/projects/{id}/quality-scans/compare`：

```json
{ "scanIdA": "scan-…", "scanIdB": "scan-…" }
```

服务端按 `createdAt` 自动把较早的扫描作为基准；两次扫描必须属于该项目
且**时间窗口完全相同**（`window.start/end` 一致，容差 1e-6），否则：

- 两次窗口不同 → **400**（`两次扫描的时间窗口不同，无法比较…`）；
- 两个 id 相同 → 400；任一扫描不存在 / 不属于该项目 → 404。

同窗口时返回（问题数组按基准 / 对比各自的原有排序）：

```json
{
  "window": { "start": 0.0, "end": 412.5 },
  "base":   { "id": "scan-…", "createdAt": "…", "summary": { "…": "…" } },
  "target": { "id": "scan-…", "createdAt": "…", "summary": { "…": "…" } },
  "counts": { "new": 1, "resolved": 2, "persistent": 3 },
  "newIssues":      [ { "issueId": "qc:overlap:ann-3|ann-9", "…": "…" } ],
  "resolvedIssues": [ { "issueId": "qc:out_of_bounds:ann-1", "…": "…" } ],
  "persistentIssues": [ { "issueId": "qc:speaker_mismatch:ann-2", "…": "…" } ]
}
```

交互式文档（Swagger）：http://localhost:8000/docs

---

## 本地开发（不用 Docker）

后端：

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
DATA_DIR=./dev-data STATIC_DIR=nonexistent \
  uvicorn app.main:app --reload --port 8000
```

前端（开发服务器，自动代理 `/api` 到 8000）：

```bash
cd frontend
npm install
npm run dev
```

访问 Vite 输出的地址（默认 **http://localhost:5173**）。

运行后端测试：

```bash
cd backend
python -m pytest test_merge.py test_rules_api.py test_quality.py \
  test_quality_api.py test_quality_scans_api.py -q
```

测试覆盖：互不重叠改动自动合并、同字段/不同字段冲突、字段级裁决、
修改/删除冲突、区间重叠与重叠链聚类、端点相接不冲突、自定义值校验、
增删混合与时间排序等 14 个合并用例；以及规则预览、批量应用、重跑只更新
本规则结果、手工编辑/删除保护、撤销（含 409）、删除规则解链、项目级联
删除等端到端 API 用例（`test_rules_api.py`，依赖 `httpx` 提供
TestClient）；**质检引擎**另有 16 个扫描线算法单测（越界首尾 / 内部空隙 /
完全在外、部分重叠与包含重叠、说话人全错与横跨切换、说话人缺失、时间窗口
过滤、稳定 issueId、非法条目跳过、严重级别排序）与端到端 API 用例
（默认扫描、窗口过滤、400/422、一键裁剪后复检消失、404）；
**扫描历史与对比**端到端用例（`test_quality_scans_api.py`）覆盖每次扫描
自动落库与返回 scanId、历史列表（按项目隔离 / 摘要不含明细）、快照详情、
同窗口按 issueId 输出新增 / 已解决 / 仍存在（参数顺序无关）、不同窗口
400、相同 id 400、不存在 404、删除项目级联清除历史。

---

## 目录结构

```
.
├── Dockerfile               # 多阶段构建：Vite 构建 → FastAPI 托管静态文件
├── docker-compose.yml       # 一键启动，端口 8000，数据卷 ./data
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI 路由
│   │   ├── merge.py         # 三方合并算法（analyze / build_merged）
│   │   ├── rules.py         # 规则匹配、区间合并、应用规划（plan_apply）
│   │   ├── quality.py       # 质检扫描线：越界 / 重叠 / 说话人不一致
│   │   ├── importer.py      # 转写稿解析（纯文本 / JSON）
│   │   ├── db.py            # SQLite 持久化（项目 / 规则 / 应用记录 / 质检扫描历史）
│   │   └── schemas.py       # Pydantic 模型
│   ├── test_merge.py        # 合并算法测试
│   ├── test_rules_api.py    # 规则模块端到端 API 测试
│   ├── test_quality.py      # 质检引擎扫描线单测
│   ├── test_quality_api.py  # 质检端到端 API 测试
│   ├── test_quality_scans_api.py  # 质检扫描历史与两次扫描对比 API 测试
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── pages/           # 项目列表 / 编辑器 / 三方合并 / 规则标注 / 质检
│   │   ├── components/      # 时间轴、标注弹窗、片段表、冲突裁决卡
│   │   ├── api.js  utils.js  styles.css
│   └── vite.config.js
└── examples/                # 示例转写稿
```
