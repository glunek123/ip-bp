# AUTH-LOCAL-001 安全复审记录

日期：2026-09-18  
对象：`codex/local-account-auth` 相对基线 `461034b` 的本地账号认证第一切片  
结论：独立Q2首轮为`REJECTED`（Critical 0／Important 11／Minor 2）；对应修复和回归完成后，合并候选`44cca65`经隔离复审为`REJECTED`（Critical 0／Important 1／Minor 2），修复后候选`894b1de`复审为`ACCEPTED`（Critical 0／Important 0／Minor 2），再修复两项Minor后的候选`3ed0681`最终复查为`ACCEPTED`，Critical／Important／Minor均为0。

## 已核对边界

- 密码采用带版本的 Node `scrypt`、随机盐和恒定时间比较；v2参数提升至N=131072、r=8、p=1，v1和未知版本仍执行等成本校验，响应不枚举账号。
- 会话和 CSRF 使用高熵随机值；数据库只保存会话摘要，来源限流只保存服务端 HMAC，不保存明文 token 或来源地址。
- 会话Cookie为HttpOnly；独立CSRF Cookie可供刷新恢复后续写请求复用。两者均为SameSite=Lax、Path=/，生产环境增加Secure；Cookie写请求必须带CSRF，登录必须同源。
- 五次失败／十五分钟窗口的用户名和来源桶在事务内取得稳定顺序的PostgreSQL advisory lock并原子累计，六个并发失败只能有五个401和一个429。
- 每次请求重新校验账号、会籍、部门、授权修订和过期时间；退出撤销数据库会话并清除 Cookie。
- Bearer 合成身份只在 `NODE_ENV=test`启用；正式环境没有测试身份回退。
- 首位管理员初始化拒绝密码参数、交互输入不回显，要求显式匹配实际本机开发／测试数据库host、port和name，且账号、会籍、角色和Grant在同一事务创建；任何本地凭据、`local:`用户或系统管理员角色痕迹都会拒绝再次初始化。
- 迁移从九迁移旧schema升级并保留数据；脏显示名使迁移失败时事务回滚，不留下半成品表或列。

## 验证证据

- 认证聚焦和全仓测试：工具19项、后端142项、前端120项通过；认证真实数据库／浏览器4/4通过。
- 修复后的完整数据库型Playwright首轮为40/42，准确暴露旧Bearer浏览器会话fixture缺少新增`departments`字段；补齐同一正式会话契约后失败用例2/2及固定最终候选42/42通过。
- 固定最终候选`pnpm verify`通过上下文、Spec（53 REQ／55 AC／11 BQ／35 SD）、类型、ESLint、Prettier、上述全仓测试和双端生产构建。
- `git diff --check`通过；本地环境文件及秘密保持忽略，未进入Git差异。

## 独立首轮Finding与修复

首轮覆盖密码成本、ECMAScript空白约束、网络故障恢复、并发限速、多部门返回、反向代理信任、初始化目标与半初始化检测、安全事件、退出失败语义、跨标签页CSRF、重复退出和安全回归覆盖。11项Important与2项Minor均已落实代码或测试修复：新增前向迁移而不改历史迁移；显式代理跳数；稳定CSRF；幂等退出；结构化可用部门／重试秒数；禁用／过期／撤销／代理／初始化／事件测试；前端只把真实401视为匿名。

## 复审与流程门禁

主分支治理提交`8e02126`已纳入隔离分支：`README.md`、`docs/context-snapshot.json`、`docs/project-status.md`、`docs/spec/v0.1/VALIDATION.md`四处重叠逐项人工解决，`package.json`自动合并，上下文快照重录。本机`git`无法创建嵌套分支名，任务分支改用顶层名`codex-local-account-auth`承载同一提交。

合并后门禁：`pnpm check:fast`、完整`pnpm verify`（后端148项）、完整数据库型Playwright 42/42、迁移专项（用例2/2、临时空库11份迁移生成14表）全部通过。

复审过程：隔离复审对`44cca65`给出`REJECTED`（Critical 0／Important 1／Minor 2），首轮13项全部确认关闭；修复I-01（合并候选证据）、M-01（`CSRF_INVALID`自动刷新并至多重试一次）、M-02（生产Secure与安全事件断言）后，`894b1de`复查为`ACCEPTED`但新报两项Minor（刷新自身401未触发未授权通知、会话被换账号时写请求静默重放）；改为刷新401即转未授权、回填身份与已知会话身份不一致时拒绝重放并转登出后，`3ed0681`最终复查`ACCEPTED`，Critical／Important／Minor均为0。另修正登录失败文案不再提及"部门"（单部门用户会被误导）。

上述三轮复审均由同一模型家族的隔离审查主体执行，未使用`5.6 Sol`，独立性弱于跨模型主体；该限制已披露。生产迁移、部署或真实人员数据仍不在授权范围。
