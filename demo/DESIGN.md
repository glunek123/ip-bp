# DESIGN.md — 品维·知产业务管理系统

> 版本 v1.5 · 派生自 v1.4（Linear 冷白画布 + 紫罗兰强调 + hairline 层级）
> 本轮新增：阶段三态色、Tab 阶段锚点、概览信息三层结构、空/加载/错误三态
> 本文件为 HTML / CSS / JS 的唯一设计约束，AI 代理改动页面前必须先读本文件

---

## 1. Visual Theme & Atmosphere

**设计哲学**：这是一套给律所运营/律师/客户三方协作使用的后台系统。信息密度高、链路长（线索 → 公证 → 诉讼 → 执行 → 归档 → 结算），因此视觉必须退到内容之后，用**极少的颜色、极细的边框、稳定的间距**让用户在长链路中不迷路。

**视觉基调**：冷静、克制、可预测的办公级专业感。不做渐变炫技、不做大色块、不做强投影。

**核心视觉特征关键词**
1. **Hairline 层级** — 用 1px 边框而非阴影划分层级，界面始终"平"而清晰
2. **冷白画布** — 画布 `#FCFCFD` 微冷，卡片纯白 `#FFFFFF`，靠明度差而非描边堆叠产生层次
3. **单一强调色** — 紫罗兰 `#5E6AD2` 只出现在主操作、当前阶段、可点击态，全站不出第二种强调色
4. **等宽数字** — 案号、金额、日期、编号一律 JetBrains Mono + `tnum`，纵向可比对
5. **状态即颜色** — 语义色只表达状态（成功/警告/危险/进行中），不参与装饰

**光影与质感**：纯扁平 + hairline 描边。阴影仅用于浮层（Modal / Dropdown / Tooltip / Toast），卡片与页面永不投影。

---

## 2. Color Palette & Roles

### Primary
| 角色 | 变量名 | 值 | 使用场景 |
|---|---|---|---|
| 主色 | `--color-primary` | `#5E6AD2` | 主按钮、当前阶段节点、聚焦环、激活 Tab 下划线 |
| 主色 Hover | `--color-primary-hover` | `#4C58C8` | 主按钮 hover |
| 主色 Active | `--color-primary-active` | `#414BB0` | 主按钮按下 |
| 主色 Focus | `--color-primary-focus` | `rgba(94,106,210,0.32)` | 输入框/按钮聚焦环 |
| 主色 Subtle | `--color-primary-subtle` | `rgba(94,106,210,0.10)` | 选中行底、CTA 卡片底、进度条轨道 |
| 主色上文字 | `--color-on-primary` | `#FFFFFF` | 主按钮文字 |

### Surface
| 角色 | 变量名 | 值 | 使用场景 |
|---|---|---|---|
| 画布 | `--color-canvas` | `#FCFCFD` | body、侧边栏、卡片底色 |
| 表面 1 | `--color-surface-1` | `#FFFFFF` | Tab 面板、表格、导航条 |
| 表面 2 | `--color-surface-2` | `#F4F4F6` | 表头、次要块、hover 底 |
| 表面 3 | `--color-surface-3` | `#E9E9EC` | 禁用态、占位块 |
| 内嵌面 | `--color-surface-inset` | `#FAFAFB` | 内嵌文本区、代码块 |

### Hairline
| 角色 | 变量名 | 值 |
|---|---|---|
| 常规分隔 | `--color-hairline` | `#E5E5E9` |
| 强调分隔 | `--color-hairline-strong` | `#D2D2D8` |
| 三级分隔 | `--color-hairline-tertiary` | `#BDBDC4` |

### Text
| 角色 | 变量名 | 值 | 使用场景 |
|---|---|---|---|
| 正文 | `--color-ink` | `#0F1011` | 标题、关键数值 |
| 次要 | `--color-ink-muted` | `#5C5E66` | 字段值、正文 |
| 弱化 | `--color-ink-subtle` | `#8A8C93` | 表头、section 标题 |
| 三级 | `--color-ink-tertiary` | `#A9ABB2` | 时间戳、辅助说明 |
| 反色 | `--color-inverse-ink` | `#FFFFFF` | 深色底上的文字 |

### Semantic
| 角色 | 变量名 | 值 |
|---|---|---|
| 成功 | `--color-success` | `#057A55` |
| 警告 | `--color-warning` | `#B45309` |
| 危险 | `--color-danger` | `#C4272B` |
| 信息 | `--color-info` | `#2563EB` |
| 进行中 | `--color-progress` | `#7C3AED` |

### 阶段三态（v1.5 新增）
用于时间轴、Stepper、Tab 锚点，三者必须同色同语义。

| 状态 | 变量名 | 值 | 语义 |
|---|---|---|---|
| 已完成 | `--stage-done` | `#057A55` | 节点已流转通过 |
| 进行中 | `--stage-active` | `#5E6AD2` | 当前所处环节 |
| 未开始 | `--stage-pending` | `#D2D2D8` | 尚未到达 |

```css
:root {
  --stage-done:   #057A55;
  --stage-active: #5E6AD2;
  --stage-pending:#D2D2D8;
}
```

### Shadow（仅浮层）
| 层级 | 变量名 | 值 |
|---|---|---|
| Modal | `--shadow-modal` | `0 0 0 1px rgba(15,16,17,0.05), 0 24px 64px rgba(15,16,17,0.14)` |
| Dropdown | `--shadow-dropdown` | `0 0 0 1px rgba(15,16,17,0.05), 0 8px 24px rgba(15,16,17,0.10)` |
| Tooltip | `--shadow-tooltip` | `0 0 0 1px rgba(15,16,17,0.05), 0 4px 12px rgba(15,16,17,0.10)` |

---

## 3. Typography Rules

**Font Family**

```css
--font-display: "Inter", "Inter Display", -apple-system, BlinkMacSystemFont,
                "SF Pro Display", "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif;
--font-text:    "Inter", -apple-system, BlinkMacSystemFont, "SF Pro Text",
                "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif;
--font-mono:    "JetBrains Mono", "Geist Mono", "SF Mono", "Menlo", monospace;
```

**Type Scale**

| 层级 | Size | Weight | Line Height | Letter Spacing | 用途 |
|---|---|---|---|---|---|
| Page Title | 20px | 600 | 1.30 | -0.2px | 页面主标题 |
| Section Title | 11px | 600 | 1.00 | +0.6px | 卡片内分区标题（全大写） |
| Card Title | 14px | 600 | 1.40 | 0 | `.item-title`、列表主行 |
| Body | 14px | 400 | 1.50 | 0 | 正文、字段值 |
| Body Strong | 14px | 500 | 1.50 | 0 | 强调的字段值、按钮 |
| Caption | 12px | 400 | 1.50 | 0 | 辅助说明、`.cta-desc` |
| Micro | 11px | 400 | 1.40 | 0 | 时间戳、`.tab-num` |
| Mono Num | 13px | 500 | 1.40 | 0 | 金额、案号、日期（`.mono` / `.num-mono`） |
| KPI Value | 26px | 600 | 1.15 | -0.4px | 统计卡数值 |

**设计哲学**
- 中文环境下字重上限 600，700 仅用于品牌标与 24px 以下的头像首字——700 中文在小字号会糊。
- Section 标题用 11px 大写 + 字距，是 Linear/Notion 的"分区标签"手法：弱到不构成视觉噪音，但足以分隔语义。
- 一切数字走 `font-feature-settings: "tnum" 1`，保证表格金额纵向对齐。

---

## 4. Component Stylings

### Buttons
高度统一 **32px**（小号 26px），圆角 6px，字号 13px/500，图标 gap 6px。

```css
.btn { display:inline-flex; align-items:center; justify-content:center; gap:6px;
       height:32px; padding:0 14px; border-radius:6px; font:500 13px/1 var(--font-text); }
.btn-primary   { background:var(--color-primary); color:var(--color-on-primary); border-color:var(--color-primary); }
.btn-primary:hover  { background:var(--color-primary-hover); border-color:var(--color-primary-hover); }
.btn-primary:active { background:var(--color-primary-active); }
.btn-secondary { background:var(--color-surface-1); color:var(--color-ink); border-color:var(--color-hairline); }
.btn-secondary:hover { background:var(--color-surface-2); border-color:var(--color-hairline-strong); }
.btn-ghost     { color:var(--color-ink-muted); }
.btn-ghost:hover     { background:var(--color-surface-2); color:var(--color-ink); }
.btn-danger    { background:var(--color-danger); color:#fff; border-color:var(--color-danger); }
.btn-sm        { height:26px; padding:0 10px; font-size:12px; }
.btn-icon      { width:32px; padding:0; }
```

**规则**：一个视图内 primary 按钮最多 1 个。它必须是"推进流程"这个动作，其余一律 secondary / ghost。

### Cards
```css
.card { background:var(--color-canvas); border:1px solid var(--color-hairline);
        border-radius:8px; padding:0; overflow:hidden; }
.card-pad { padding:20px; }
```
**无 box-shadow**。卡片与画布同为 `#FCFCFD`，仅靠 hairline 成型；置于白色 `.tab-panel` 内时靠明度差浮出。

### Inputs
```css
height:32px; border:1px solid var(--color-hairline-strong); border-radius:6px;
padding:0 10px; font:400 13px/1 var(--font-text);
:focus { border-color:var(--color-primary); box-shadow:0 0 0 3px var(--color-primary-focus); }
::placeholder { color:var(--color-ink-tertiary); }
```

### Navigation（侧边栏）
```css
.nav-item { height:32px; border-radius:6px; padding:0 10px; gap:10px; color:var(--color-ink-muted); }
.nav-item:hover  { background:var(--color-surface-2); color:var(--color-ink); }
.nav-item.active { background:var(--color-primary-subtle); color:var(--color-primary); font-weight:500; }
```

### Tabs（含 v1.5 阶段锚点）
```css
.tabs { display:flex; border-bottom:1px solid var(--color-hairline);
        background:var(--color-surface-1); border-radius:8px 8px 0 0; padding:0 8px; }
.tab  { flex-shrink:0; height:40px; padding:0 14px; gap:8px; color:var(--color-ink-subtle);
        border-bottom:2px solid transparent; }
.tab.active { color:var(--color-ink); border-bottom-color:var(--color-primary); }
```

阶段锚点（v1.5 新增）——6px 圆点，排在 Tab 文字左侧，表达"该环节在本案中的进度"：

```css
.tab-dot { width:6px; height:6px; border-radius:50%; flex:0 0 6px; }
.tab-dot.done   { background:var(--stage-done); }
.tab-dot.active { background:var(--stage-active); box-shadow:0 0 0 3px rgba(94,106,210,0.18); }
.tab-dot.pending{ background:var(--stage-pending); }
```

### Badges / Pills
```css
.pill { display:inline-flex; align-items:center; gap:6px; height:22px;
        padding:0 10px; border-radius:9999px; font:500 11px/1 var(--font-text); }
.pill-success { background:rgba(5,150,105,0.14);   color:#057A55; }
.pill-warning { background:rgba(217,119,6,0.12);   color:#B45309; }
.pill-danger  { background:rgba(220,38,38,0.14);   color:#C4272B; }
.pill-info    { background:rgba(37,99,235,0.14);   color:#2563EB; }
.pill-progress{ background:rgba(124,58,237,0.14);  color:#7C3AED; }
.pill-neutral { background:var(--color-surface-2); color:var(--color-ink-muted); }
```

### Modals / Dialogs
遮罩 `rgba(15,16,17,0.45)`；面板 `background:#FFFFFF; border-radius:10px`，阴影 `--shadow-modal`；入场 120ms `ease-out`，`translateY(4px) → 0` + `opacity 0 → 1`。

---

## 5. Layout Principles

**Spacing（4px 基准）**
```css
--s-1:4px; --s-2:8px; --s-3:12px; --s-4:16px; --s-5:20px;
--s-6:24px; --s-8:32px; --s-10:40px; --s-12:48px; --s-16:64px;
```
卡片内 padding 固定 20px；同层卡片间距 12px；区块间距 20px；页面级区块间距 24px。

**Grid**
```css
.grid-12 { display:grid; grid-template-columns:repeat(12,1fr); gap:16px; }
.col-12 { grid-column:span 12; } .col-8 { span 8; } .col-6 { span 6; } .col-4 { span 4; }
```
- 详情页主内容 / 侧栏：`col-8` + `col-4`
- 两个等权分区：`col-6` + `col-6`
- 三列字段组：`grid-3`

**Container**：侧边栏固定 **232px**，主区 `1fr`；内容区左右 padding 24px，上下 20px。

**留白哲学**：留白用于**分组**而非装饰。相邻卡片之间不额外加 margin，靠 grid gap 统一控制；同一卡片内的字段组用 11px 的 section 标题分隔，不用分隔线。

---

## 6. Depth & Elevation

**Surface Layers（由底到顶）**
`--color-canvas` → `--color-surface-1` → `--color-surface-2` → 浮层（Modal/Dropdown）

页面不用 z 轴表达层级，只靠**底色明度**与**hairline**。真正的 z 轴只有浮层。

**Z-index**
```css
--z-sticky:50; --z-dropdown:80; --z-tooltip:150; --z-modal:200; --z-toast:300;
```

**Backdrop**：仅 Modal 遮罩使用，不做毛玻璃。系统需长时间阅读密集表格，模糊背景会降低文字锐度。

---

## 7. Do's and Don'ts

**Do's**
1. 一个视图内 primary 按钮只留 1 个，且对应"推进流程"动作
2. 案号、金额、日期、编号一律用 `.mono` / `.num-mono`
3. 状态统一用 `.pill`，状态色只从语义色中取，不自造颜色
4. 长链路视图必须有阶段锚点（Tab dot / Stepper / Timeline 三选一，且三者同色）
5. 卡片只用 hairline 描边，不投影
6. 空状态必须给出"下一步该做什么"，不能只写"暂无数据"
7. 动态渲染优先：任何随案件切换变化的字段都由 JS 输出，禁止硬编码进 HTML
8. 每个可点击元素必须有 hover 态，哪怕是 ghost 按钮

**Don'ts**
1. 禁止给卡片、表格、页面主体加 box-shadow
2. 禁止在同一视图出现第二种强调色（如同时用紫罗兰和蓝做主色）
3. 禁止在正文使用 700 字重中文
4. 禁止用色块背景承载大段文字
5. 禁止 Tab 命名使用状态词（"待归档"→应为"归档"，状态由 dot 表达）
6. 禁止出现无 onclick 的装饰性按钮——演示系统里点了没反应比没有更糟
7. 禁止在表格里混用左对齐与居中对齐的数字列
8. 禁止用 `0 / 0`、`¥ 0.00 / ¥ 0.00` 这类空比值占位，应显示"—"或隐藏该项

---

## 8. Responsive Behavior

**Breakpoints**
| 名称 | 宽度 | 策略 |
|---|---|---|
| Mobile | < 768px | 侧边栏收为抽屉；`grid-12` 全部降级为单列；表格横向滚动 |
| Tablet | 768–1279px | 侧边栏保留；`col-8/col-4` 降级为 `col-12`；`col-6` 保留 |
| Desktop | 1280–1679px | 完整 12 栅格 |
| Wide | ≥ 1680px | 内容区 `max-width:1440px` 居中 |

**Touch Targets**：最小 32×32px，移动端按钮高度提升到 40px。

**折叠策略**：`col-6` 双栏在 Tablet 以下堆叠；KPI `.stat-grid` 从 5 列 → 3 列 → 2 列；Tab 条横向滚动（`overflow-x:auto`，隐藏滚动条）。

**Font Scaling**：桌面端根字号固定 14px，移动端不缩放——密集表格缩字会破坏对齐。

---

## 9. Agent Prompt Guide

**Quick Reference**

```
主色 #5E6AD2｜画布 #FCFCFD｜表面 #FFFFFF｜hairline #E5E5E9
正文 14px/400/1.50｜Section 标题 11px/600/大写/+0.6px｜等宽数字 JetBrains Mono
按钮 32px 高 / 6px 圆角｜卡片 8px 圆角 / hairline / 无阴影
间距 4 基准｜栅格 12 列 gap 16｜侧栏 232px
阶段三态 done #057A55 / active #5E6AD2 / pending #D2D2D8
```

**Component Prompts**

1. 案件摘要卡（动态）
   > 用 `.card` + `.card-pad` 生成"案件摘要"卡。字段顺序固定为：客户 → 主被告 → 当前阶段 → 下一动作 → 标的额 → 开庭日期 → 案件类型 → 立案法院。每个字段用 `.field-row` + `.field-label` + `.field-value`，值必须带 `data-ov` 以支持行内编辑，且由 JS 按当前案件渲染，禁止写死。

2. 带阶段锚点的 Tab 条
   > 生成横向 Tab 条，每个 Tab 内含 6px `.tab-dot`（done/active/pending 三态）+ 文字 + 数字角标。Tab 名称用中性名词（概览/线索/公证/被告/诉讼/执行/归档/结算），不用状态词。dot 状态由当前案件阶段计算。

3. 关键金额卡 + 回款进度
   > `.card` 内放 4 行 `.field-row`：标的额、已发生费用、实缴诉讼费、已回款。已回款行下方加 4px 高进度条，轨道 `--color-primary-subtle`，填充 `--color-primary`，百分比 = 已回款 / 标的额。数值用 `.num-mono`。

4. 团队 & 协作方三列
   > `.grid-3`，每列一个 24px 圆形头像 + 姓名 + 机构。头像底色由 `operatorStyle()` 派生，禁止硬编码渐变。

5. 空状态（带下一步）
   > `.empty` 内含 32px 线稿图标 + `.empty-title`（说明"为什么空"）+ `.empty-desc`（说明"什么时候会有"或"点哪里开始"）。禁止只写"暂无数据"。

6. 费用明细表
   > `.table`，3 列：费用类型 / 金额（`.num`，右对齐）/ 状态（`.pill`，可点击切换）。表尾追加合计行，底 `--color-surface-2`，金额用主色加粗。

**Iteration Guide**
1. 改任何页面前先读本文件第 2、4、5 章，确认色值/组件/间距。
2. 新增组件优先复用 `.card / .field-row / .pill / .btn`，不要新建平行的样式体系。
3. 遇到硬编码在 HTML 里、但会随数据变化的字段 → 改为 JS 渲染 + `data-ov`。
4. 遇到点了没反应的按钮 → 至少接 `toast()` 反馈，不要留死按钮。
5. 状态色只从 `--color-success/warning/danger/info/progress` 取，不自造。
6. Tab / Stepper / Timeline 三者的阶段色必须一致，改一处要同步三处。
7. 表格数字列：表头 `.num` 右对齐，`.num-mono` 等宽，禁用居中。
8. 空值一律显示 `—`，不显示 `0` / `0 / 0` / `¥ 0.00`。
9. 卡片不加阴影；需要强调时用 `--color-primary-subtle` 底色 + `rgba(94,106,210,0.18)` 边框。
10. 改完必须用 jsdom 跑一遍冒烟，确认无 JS 报错、视图切换正常。
