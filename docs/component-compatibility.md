# CMP-01 组件类型兼容修复

日期：2026-09-15；修复基线：3d968a1。用户授权最小兼容修复、必要声明补丁及实际组件交互验证。当前状态见 [开发状态](project-status.md)。

## 根因与选择

原版本全量、select、table 入口严格类型失败。本轮将 ESM/CJS 全量入口和按需入口加入正式 typecheck 输入，修改前再次失败，确认四类错误：

| 错误                                       | 根因                                                                            | 最小处理                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| TS2304 蓝牙类型不存在                      | VueUse 声明使用 Web Bluetooth，全局 types 白名单未包含它                        | 前端显式声明既有间接类型包 @types/web-bluetooth 0.0.21，并加入 types           |
| TS2344 GlobalComponents / GlobalDirectives | 生成声明将可扩展接口直接用作要求组件/指令字典的泛型参数，接口缺少隐式索引兼容性 | 仅在出错声明内映射其现有键和值，保持具体组件和指令类型；不为全局接口加开放索引 |
| TS2503 JSX                                 | table-v2 用旧全局 JSX.IntrinsicAttributes 索引 class；模块级 JSX 也不含该属性   | 改用 Vue 原生 ClassValue，不引入 React 类型或全局兜底                          |
| TS2502 h                                   | transfer 的参数 h 遮蔽导入 h，typeof h 形成自引用                               | 导入改名 vueH，参数仍引用 Vue h 原有重载                                       |

官方 npm registry 本轮返回 Element Plus latest 为 2.14.5，与现有版本一致。保留 Vue 3.5.42、Element Plus 2.14.5、TypeScript 5.9.3，以声明补丁避免降级组件库或联动更换框架。新增直接 devDependency 仅为已经存在于锁文件的类型包，不引入运行服务或功能。

版本元数据来源：[Element Plus registry](https://registry.npmjs.org/element-plus)、[Web Bluetooth 类型 registry](https://registry.npmjs.org/@types%2fweb-bluetooth/0.0.21)。具体根因由本地安装包声明和编译器错误复现确定。

## 补丁与可复现安装

- 补丁为 [element-plus@2.14.5.patch](../patches/element-plus@2.14.5.patch)，通过 pnpm patch/patch-commit 生成，pnpm-workspace.yaml 注册 patchedDependencies，锁文件记录应用后的包身份。
- 16 个 .d.ts 文件，ESM/CJS 对称修复；没有改动运行时 JS/CSS。补丁中的原有 any 上下文未扩展，也不以 any、skipLibCheck 或开放全局索引签名解决错误。
- 补丁 SHA-256、类型包准确版本及说明保存在 [版本清单](environment-lock.json)。Git 对补丁强制 LF，防止 Windows 换行转换改变补丁字节。统一 diff 用单个空格表示未修改的空上下文行，因此仅对 .patch 的 blank-at-eol 检查设置格式例外；源代码空白检查不变。
- 文件同步脚本新增 .patch 跟踪，测试证明修改补丁会使 context:check 失败。修改补丁必须同步版本依据、状态和验收。
- 安装使用冻结锁文件，不能手改 node_modules。升级 Element Plus 时先在隔离环境不带补丁复测：若原错误消失，移除补丁注册和文件后重新冻结验证；若仍存在，生成与新准确版本匹配的补丁，禁止无依据沿用旧补丁。

## 持续回归与交互

- frontend/tests/compat/entrypoints.ts 编译包根、ESM 按需和 CJS 全量声明，始终纳入前端 typecheck/build。负向断言要求非法 select/table size、数字 class 和非法 Vue h 参数继续报错；GlobalComponents/GlobalDirectives 不允许退化为任意字符串键。
- frontend/tests/compat 的独立 HTML/SFC 测试入口安装完整插件、使用真实选择器和表格；不是正式路由，Vite 正式构建仍只使用根 index.html。
- 浏览器用例覆盖选择器切换与 v-model 回写、表格行选择、排序、取消选择及 pageerror 检查；使用技术示例 Alpha/Beta，不含业务字段或规则。
- 实际交互覆盖选择器/表格，不声称每一个 Element Plus 控件都做过交互测试。新业务控件仍按对应交互增加回归。

## 验证记录

- 修改前：正式前端 typecheck 退出 2，复现以上声明错误。
- .patch 快照回归：新增测试先因未识别补丁变化失败，增加跟踪扩展名后通过，并纳入最终 verify。
- pnpm patch-commit 已生成补丁；供应链元数据核验存在 registry 慢请求。离线冻结安装因本机缺少完整 registry 元数据失败，未放宽检查，改用在线冻结安装。
- 最终安装：`pnpm install --frozen-lockfile --network-concurrency=4` 退出 0，1002 个锁文件条目的供应链策略核验通过。仅降低当次请求并发，没有修改发布时龄、锁文件冻结或安装核验策略。
- 最终 `pnpm verify` 退出 0：严格 ESM/CJS 类型及负向断言、Lint、格式、13 项工具 + 24 项前端 + 23 项后端测试（共 60 项）、前后端构建通过。
- 最终 `pnpm test:e2e` 退出 0：3 项 Chromium 用例通过，包含真实选择器/表格交互、数据库健康及故障重试；浏览器脚本错误为空。构建未包含 tests 夹具，正式产物文件名与前次底座一致。
- 过程修正：测试最初点击内部隐藏/被覆盖输入而超时，改为真实可见控件并检查 checked 状态后通过，未用强制点击。Lint 发现单词组件名后改为 ComponentFixture，未关闭规则。
- 验证后仅同步结果与状态、Git 补丁格式属性，重新记录并检查快照/格式和暂存差异；代码、补丁、版本记录与文档一起保存至本地 Git。

独立只读初审及增量审查未发现阻断项；建议的 h 和 table 负向类型断言已补充。首轮编译进一步发现 GlobalDirectives 同类约束和模块 JSX 不含 class；已按实际声明修正为指令有限映射及 ClassValue，最终验证通过。**CMP-01 已验证关闭**；升级依赖时继续遵守上述补丁复验与移除要求。
