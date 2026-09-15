/* ============================================================
   知产案件管理系统 — 交互逻辑
   原生 JS，无依赖。所有函数为顶层声明，供 HTML 内联 onclick 调用。
   数据持久化：localStorage（key = ipcase_demo_v2）
   由 ip-case-system-fixed.html 拆分而来，内容与原始内联 <script> 完全一致
   ============================================================ */
// ============================================================
// 1. 案件数据
// ============================================================
// 案件类型枚举（统一在此维护：新建 / 编辑 / 筛选 / 列表颜色 全部引用它）
const CASE_TYPES = ['民事', '刑事', '行政', '调查', '公证', '代开庭'];
const CASE_TYPE_TAG = {
  '民事': 'tag-blue', '刑事': 'tag-red', '行政': 'tag-orange',
  '调查': 'tag-purple', '公证': 'tag-green', '代开庭': 'tag-cyan',
};

// 运营负责人配置（集中维护：头像首字 / 配色单一来源，新增运营只需加一项）
const OPERATORS = {
  '陈晓敏': { initial: '陈', color: 'linear-gradient(135deg,#5E6AD2,#7C3AED)' },
  '林伟':   { initial: '林', color: 'linear-gradient(135deg,#2563EB,#7C3AED)' },
  '王敏':   { initial: '王', color: 'linear-gradient(135deg,#057A55,#2563EB)' },
};
// 由运营姓名派生头像首字与配色，取代散落在各处的硬编码 opInitial / opColor
function operatorStyle(name) {
  const o = OPERATORS[name] || OPERATORS['陈晓敏'];
  return { opInitial: o.initial, opColor: o.color };
}

// 立案法院选项（下拉来源，统一在此维护；末尾的「—」是**空值占位**）
/* v150：原来写「—  待匹配」，用户口径 —— 下拉里也不要这种说明文字，改成纯横杠。
   ⚠️ 这个占位项**不能删**：没有它，浏览器会自动选中首个真实法院，
      用户不动它直接保存就会把「广州知识产权法院」静默写进数据。 */
const COURTS = [
  '广州知识产权法院', '北京知识产权法院', '上海知识产权法院',
  '深圳市中级人民法院', '东莞市中级人民法院', '佛山禅城区法院',
  '杭州互联网法院', '上海市徐汇区人民法院', '上海浦东法院',
  '—',
];

// v11.2 创建案件：平台下拉（独立字段，不再依赖 defendant 解析；兼容老数据仍以 defendant 兜底）
const PLATFORMS = ['淘宝', '拼多多', '京东', '天猫', '抖音', '小红书', '快手', '1688', '闲鱼', '美团', '大众点评', '地图', '其他'];
/* 线索侧平台清单（v117b）：新建线索 / 编辑线索共用这一份。
   线索侧比案件侧多一个「微信」—— 此前这两处各自手写了一份一模一样的数组，
   加平台时漏改过一处（2026-09-13），故收成单一来源，不要再另写副本。 */
const LEAD_PLATFORMS = ['淘宝', '天猫', '拼多多', '京东', '抖音', '1688', '小红书', '快手', '微信', '闲鱼', '美团', '大众点评', '地图', '其他'];
// v11.2 创建案件：案由下拉
// v95 侵权类型：单选 / 多选共用一套枚举（下拉勾选面板），落库为顿号分隔字符串，如「商标权、信息网络传播权」
const INFRINGE_TYPES = ['商标权', '软件著作权', '美术作品著作权', '视听作品著作权', '文字作品著作权',
  '发明专利权', '外观设计专利权', '实用新型专利权', '不正当竞争', '信息网络传播权', '肖像权', '其他'];
// v12 创建案件：线索来源下拉（线上/线下）
// 历史种子里的自由文本（如「运营巡查 / 客户投诉 / 公会举报」）仍允许存在；新建案件走枚举，旧值不强制迁移。
const SOURCES = ['线上', '线下'];

const CASES = [
  {
    id: 'IP-20260315-001',
    title: '杭州××科技 vs 淘宝"××优品" 商标侵权案',
    no: '（2026）粤0115民初12345号',
    client: '杭州××科技有限公司',
    type: '民事',
    typeTag: 'tag-blue',
    defendant: '淘宝"××优品"',
    amount: '¥ 120,000',
    court: '广州知识产权法院',
    operator: '陈晓敏',
    status: '待开庭',
    statusClass: 'pill-info',
    hearingAt: '2026-09-11',   // 仅兜底：运行时由 defaultState() 按「今天 +12 天」覆盖，避免写死日期过期后被自动流转
    hearingPlace: '广州知识产权法院 · 第七法庭',
    updated: '2 小时前',
  },
  {
    id: 'IP-20260402-003',
    title: '深圳××文化 vs 拼多多"创艺小屋" 著作权侵权',
    no: '（2026）粤03民初8901号',
    client: '深圳××文化传播有限公司',
    type: '民事',
    typeTag: 'tag-blue',
    defendant: '拼多多"创艺小屋"',
    amount: '¥ 85,000',
    court: '深圳市中级人民法院',
    operator: '林伟',
    status: '待提交立案',
    statusClass: 'pill-progress',
    updated: '5 小时前',
  },
  {
    id: 'IP-20260320-007',
    title: '北京××科技 vs 京东"数码优选" 不正当竞争',
    no: '（2026）京01民初5678号',
    client: '北京××科技股份有限公司',
    type: '民事',
    typeTag: 'tag-blue',
    defendant: '京东"数码优选"',
    amount: '¥ 350,000',
    court: '北京知识产权法院',
    operator: '王敏',
    status: '转正式立案',
    statusClass: 'pill-warning',
    updated: '1 天前',
  },
  {
    id: 'IP-20260218-002',
    title: '广州××食品 vs 天猫"××旗舰店" 商标侵权',
    no: '（2026）粤0115民初2345号',
    client: '广州××食品有限公司',
    type: '行政',
    typeTag: 'tag-orange',
    defendant: '天猫"××旗舰店"',
    amount: '¥ 60,000',
    court: '广州知识产权法院',
    operator: '陈晓敏',
    status: '强制执行中',
    statusClass: 'pill-primary',
    updated: '3 天前',
  },
  {
    id: 'IP-20260110-015',
    title: '上海××设计 vs 淘宝"潮流集合" 著作权纠纷',
    no: '（2026）沪0115民初3456号',
    client: '上海××设计工作室',
    type: '刑事',
    typeTag: 'tag-red',
    defendant: '淘宝"潮流集合"',
    amount: '¥ 45,000',
    court: '上海市徐汇区人民法院',
    operator: '林伟',
    status: '待归档',
    statusClass: 'pill-warning',
    updated: '5 天前',
  },
  {
    id: 'IP-20251220-088',
    title: '杭州××服饰 vs 抖音"××严选" 商标侵权',
    no: '（2025）粤0115民初9876号',
    client: '杭州××服饰集团',
    type: '公证',
    typeTag: 'tag-green',
    defendant: '抖音"××严选"',
    amount: '¥ 200,000',
    court: '广州知识产权法院',
    operator: '王敏',
    status: '已归档',
    statusClass: 'pill-success',
    updated: '2 周前',
  },
  {
    id: 'IP-20260305-005',
    title: '东莞××电子 vs 1688"电子王国" 专利侵权',
    no: '（2026）粤19民初1122号',
    client: '东莞××电子有限公司',
    type: '调查',
    typeTag: 'tag-purple',
    defendant: '1688"电子王国"',
    amount: '¥ 500,000',
    court: '东莞市中级人民法院',
    operator: '陈晓敏',
    status: '待写诉状',
    statusClass: 'pill-neutral',
    updated: '1 天前',
  },
  {
    id: 'IP-20260410-012',
    title: '厦门××贸易 vs 淘宝"进口好物" 商标侵权',
    no: '',
    client: '厦门××贸易有限公司',
    type: '代开庭',
    typeTag: 'tag-cyan',
    defendant: '淘宝"进口好物"',
    amount: '¥ 75,000',
    court: '',
    operator: '林伟',
    status: '案件待匹配',
    statusClass: 'pill-neutral',
    updated: '6 小时前',
  },
  // v132：补齐「案件进展」16 档的演示数据 —— 每个阶段都有硬编码案件（fillStageDemoCases 只需再补足到 5 条）；
  //       前两条同时修掉「证物挂着一个查无此案的 caseId」的历史缺口（证物列表的店铺名 / 案件进展两列长期是「—」）。
  {
    id: 'IP-20260418-022',
    title: '苏州××服饰 vs 抖音"潮流女装" 商标侵权案',
    no: '（2026）苏05民初6612号',
    client: '苏州××服饰有限公司',
    type: '民事',
    typeTag: 'tag-blue',
    defendant: '抖音"潮流女装"',
    amount: '¥ 68,000',
    court: '苏州市中级人民法院',
    operator: '林伟',
    status: '待判决',
    statusClass: 'pill-progress',
    updated: '2 天前',
  },
  {
    id: 'IP-20260812-031',
    title: '深圳××文化 vs 拼多多"×家电" 著作权侵权案',
    no: '（2026）粤03民初9042号',
    client: '深圳××文化传播有限公司',
    type: '民事',
    typeTag: 'tag-blue',
    defendant: '拼多多"×家电"',
    amount: '¥ 52,000',
    court: '深圳市中级人民法院',
    operator: '陈晓敏',
    status: '二审',
    statusClass: 'pill-warning',
    updated: '1 天前',
  },
  {
    id: 'IP-20260522-038',
    title: '杭州××科技 vs 天猫"优选家居" 专利侵权案',
    no: '（2026）浙0110民初7721号',
    client: '杭州××科技有限公司',
    type: '民事',
    typeTag: 'tag-blue',
    defendant: '天猫"优选家居"',
    amount: '¥ 96,000',
    court: '杭州互联网法院',
    operator: '陈晓敏',
    status: '诉状待确认',
    statusClass: 'pill-warning',
    updated: '3 小时前',
  },
  {
    id: 'IP-20260528-042',
    title: '广州××食品 vs 京东"食品专营" 不正当竞争案',
    no: '（2026）粤0115民初8821号',
    client: '广州××食品有限公司',
    type: '民事',
    typeTag: 'tag-blue',
    defendant: '京东"食品专营"',
    amount: '¥ 74,000',
    court: '广州知识产权法院',
    operator: '林伟',
    status: '诉状待盖章',
    statusClass: 'pill-progress',
    updated: '6 小时前',
  },
  {
    id: 'IP-20260630-061',
    title: '上海××设计 vs 1688"设计优选" 著作权侵权案',
    no: '（2026）沪0115民初5533号',
    client: '上海××设计工作室',
    type: '民事',
    typeTag: 'tag-blue',
    defendant: '1688"设计优选"',
    amount: '¥ 58,000',
    court: '上海市徐汇区人民法院',
    operator: '王敏',
    status: '待写执行材料',
    statusClass: 'pill-info',
    updated: '4 天前',
  },
  {
    id: 'IP-20260706-064',
    title: '厦门××贸易 vs 抖音"全球优选" 商标侵权案',
    no: '（2026）闽02民初3391号',
    client: '厦门××贸易有限公司',
    type: '民事',
    typeTag: 'tag-blue',
    defendant: '抖音"全球优选"',
    amount: '¥ 41,000',
    court: '厦门市中级人民法院',
    operator: '陈晓敏',
    status: '执行材料待确认',
    statusClass: 'pill-warning',
    updated: '3 天前',
  },
  {
    id: 'IP-20260714-068',
    title: '东莞××电子 vs 淘宝"元件商城" 专利侵权案',
    no: '（2026）粤19民初2277号',
    client: '东莞××电子有限公司',
    type: '民事',
    typeTag: 'tag-blue',
    defendant: '淘宝"元件商城"',
    amount: '¥ 130,000',
    court: '东莞市中级人民法院',
    operator: '林伟',
    status: '执行材料待盖章',
    statusClass: 'pill-progress',
    updated: '2 天前',
  },
  {
    id: 'IP-20260720-072',
    title: '苏州××服饰 vs 拼多多"服饰工厂店" 商标侵权案',
    no: '（2026）苏05民初7710号',
    client: '苏州××服饰有限公司',
    type: '民事',
    typeTag: 'tag-blue',
    defendant: '拼多多"服饰工厂店"',
    amount: '¥ 88,000',
    court: '苏州市中级人民法院',
    operator: '王敏',
    status: '待申请执行立案',
    statusClass: 'pill-info',
    updated: '1 天前',
  },
];

// ============================================================
// 1b. 客户数据
// ============================================================
const CUSTOMERS = [
  {
    id: 'C-2024-001', name: '杭州××科技有限公司', credit: '91330100MA2******X7',
    type: '品牌方', typeTag: 'tag-blue', category: '家居日用 · 保温杯', region: '华东',
    cases: 12, amount: '¥ 380.0 万', recovered: '¥ 156.0 万', rate: 41,
    settle: '月结 · 30 天', status: '合作中', statusClass: 'pill-success',
    manager: '陈晓敏', model: '全风险', settleFormula: '客户结算金额=结案金额*75%',
    updated: '2 小时前',
  },
  {
    id: 'C-2024-002', name: '深圳××文化传播有限公司', credit: '91440300MA5******Y2',
    type: '品牌方', typeTag: 'tag-blue', category: '文创 · 插画设计', region: '华南',
    cases: 8, amount: '¥ 210.0 万', recovered: '¥ 88.0 万', rate: 42,
    settle: '月结 · 30 天', status: '合作中', statusClass: 'pill-success',
    manager: '林伟', model: '半风险', settleFormula: '客户结算金额=结案金额*60%',
    updated: '5 小时前',
  },
  {
    id: 'C-2023-015', name: '北京××科技股份有限公司', credit: '91110108MA01******Q3',
    type: '品牌方', typeTag: 'tag-blue', category: '消费电子 · 智能硬件', region: '华北',
    cases: 15, amount: '¥ 620.0 万', recovered: '¥ 310.0 万', rate: 50,
    settle: '季结 · 45 天', status: '合作中', statusClass: 'pill-success',
    manager: '王敏', model: '固定费用', settleFormula: '客户结算金额=结案金额*100%',
    updated: '1 天前',
  },
  {
    id: 'C-2024-007', name: '广州××食品有限公司', credit: '91440101MA9******K8',
    type: '制造商', typeTag: 'tag-orange', category: '食品饮料 · 休闲零食', region: '华南',
    cases: 5, amount: '¥ 96.0 万', recovered: '¥ 42.0 万', rate: 44,
    settle: '月结 · 30 天', status: '合作中', statusClass: 'pill-success',
    manager: '陈晓敏', model: '半风险', settleFormula: '客户结算金额=结案金额*60%',
    updated: '3 天前',
  },
  {
    id: 'C-2025-003', name: '上海××设计工作室', credit: '91310104MA1******N5',
    type: '个人工作室', typeTag: 'tag-purple', category: '设计服务 · 视觉', region: '华东',
    cases: 3, amount: '¥ 45.0 万', recovered: '¥ 18.0 万', rate: 40,
    settle: '单案结清', status: '暂停', statusClass: 'pill-warning',
    manager: '林伟', model: '固定费用', settleFormula: '客户结算金额=结案金额*100%',
    updated: '1 周前',
  },
  {
    id: 'C-2024-011', name: '东莞××电子有限公司', credit: '91441900MA4******W1',
    type: '制造商', typeTag: 'tag-orange', category: '电子元件 · 连接器', region: '华南',
    cases: 7, amount: '¥ 180.0 万', recovered: '¥ 65.0 万', rate: 36,
    settle: '月结 · 60 天', status: '合作中', statusClass: 'pill-success',
    manager: '陈晓敏', model: '全风险', settleFormula: '客户结算金额=结案金额*75%',
    updated: '2 天前',
  },
  {
    id: 'C-2023-028', name: '厦门××贸易有限公司', credit: '91350200MA3******T6',
    type: '代理公司', typeTag: 'tag-green', category: '跨境电商 · 代运营', region: '华南',
    cases: 2, amount: '¥ 38.0 万', recovered: '¥ 0', rate: 0,
    settle: '单案结清', status: '已终止', statusClass: 'pill-danger',
    manager: '林伟', model: '固定费用', settleFormula: '客户结算金额=结案金额*100%',
    updated: '2 个月前',
  },
  {
    id: 'C-2024-019', name: '苏州××服饰集团', credit: '91320594MA1******M9',
    type: '品牌方', typeTag: 'tag-blue', category: '服装鞋帽 · 女装', region: '华东',
    cases: 9, amount: '¥ 275.0 万', recovered: '¥ 120.0 万', rate: 44,
    settle: '月结 · 30 天', status: '合作中', statusClass: 'pill-success',
    manager: '王敏', model: '半风险', settleFormula: '客户结算金额=结案金额*60%',
    updated: '4 天前',
  },
];

// 客户详情默认指向的客户（杭州××科技有限公司）
const CUSTOMER_DETAIL_CLIENT = '杭州××科技有限公司';

// ============================================================
// 3. 交互层：工具 / Toast / Modal / 持久化
// ============================================================
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
const setTxt = (sel, v) => { const el = $(sel); if (el) el.textContent = v; };   // 元素缺失不抛错，只跳过
const esc = s => String(s).replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
const uid = p => p + '-' + Date.now().toString(36).slice(-5).toUpperCase();
const pad = n => String(n).padStart(2, '0');
const today = () => new Date().toISOString().slice(0, 10);
const stamp = () => { const d = new Date(); return today() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const money = n => '¥ ' + Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numOf = s => Number(String(s).replace(/[^\d.]/g, '')) || 0;
const daysTo = d => { if (!d || d === '—') return null; return Math.ceil((new Date(d) - new Date(today())) / 86400000); };

/* 开庭演示种子（IP-20260315-001）的开庭日 = 今天 + 12 天。
   写死的日期会随日期推移变成过去时，被 autoFlowCases「开庭次日自动流转待判决」吞掉，
   「待开庭」就永远少 1 条，演示数据不再自洽 → 这里统一按今天相对计算。 */
const HEARING_SEED_ID = 'IP-20260315-001';
const HEARING_SEED_AT = plusDays(today(), 12);

/* ---------- Toast ---------- */
const TOAST_IC = { success: '✓', error: '!', info: 'i' };
function toast(msg, sub, type = 'success') {
  const root = $('#toast-root');
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.innerHTML = `<div class="toast-icon">${TOAST_IC[type]}</div>
    <div class="toast-text">${esc(msg)}${sub ? `<span class="toast-sub">${esc(sub)}</span>` : ''}</div>`;
  root.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 200);
  }, 2800);
}

/* ---------- Modal ---------- */
let MODAL_OK = null;
let MODAL_NO_ESCAPE = false;   // noEscape 弹窗：Escape / 点击遮罩不可关闭（取消按钮仍可用）
/* v96：标题栏右侧操作槽（懒建在关闭按钮左侧，仅建一次；每个弹窗打开时重置内容） */
function modalHeadSlot() {
  let slot = document.getElementById('modal-head-slot');
  if (slot) return slot;
  const hd = document.querySelector('.modal-header');
  const closeBtn = hd ? hd.querySelector('[data-modal-close]') : null;
  if (!hd || !closeBtn) return null;
  slot = document.createElement('div');
  slot.className = 'modal-head-slot';
  slot.id = 'modal-head-slot';
  hd.insertBefore(slot, closeBtn);
  return slot;
}
function openModal({ title, bodyHTML, okText = '保存', cancelText = '取消', cancelBtn = true, onOk, onSubmit, wide = false, xwide = false, okClass = 'btn-primary', extraBtn = null, extraBtns = null, headerBtns = null, noEscape = false }) {
  MODAL_NO_ESCAPE = !!noEscape;
  closeAllMsel();   // v95：换内容前先收掉上一个弹窗里展开着的多选面板
  $('#modal-title').textContent = title;
  // v96：标题栏右侧操作槽（如公证详情「编辑」），紧跟关闭按钮左侧
  const headSlot = modalHeadSlot();
  if (headSlot) {
    const hbs = Array.isArray(headerBtns) ? headerBtns : [];
    headSlot.innerHTML = hbs.map((b, i) =>
      `<button class="btn ${esc(b.cls || 'btn-secondary')} btn-sm" id="modal-head-${i}"${b.title ? ` title="${esc(b.title)}"` : ''}>${esc(b.label || '')}</button>`).join('');
    hbs.forEach((b, i) => {
      if (!b || !b.onClick) return;
      const hb = document.getElementById('modal-head-' + i);
      if (hb) hb.addEventListener('click', b.onClick);
    });
  }
  $('#modal-body').innerHTML = bodyHTML || '';
  $('#modal-box').className = 'modal' + (wide ? ' modal-wide' : '') + (xwide ? ' modal-xwide' : '');
  $('#modal-footer').innerHTML =
    (cancelBtn ? `<button class="btn btn-secondary" data-modal-close>${esc(cancelText)}</button>` : '') +
    (extraBtn ? `<button class="btn ${esc(extraBtn.cls || 'btn-secondary')}" id="modal-extra">${esc(extraBtn.label || '保存')}</button>` : '') +
    (Array.isArray(extraBtns) ? extraBtns.map((b, i) => `<button class="btn ${esc(b.cls || 'btn-secondary')}" id="modal-extra-${i}">${esc(b.label || '')}</button>`).join('') : '') +
    (okText ? `<button class="btn ${okClass}" id="modal-ok">${esc(okText)}</button>` : '');
  MODAL_OK = onOk || onSubmit || null;   // 兼容 onSubmit 写法：历史上有 12 处表单用它，此前会静默失效（点确定没反应）
  if (extraBtn && extraBtn.onClick) {
    const eb = document.getElementById('modal-extra');
    if (eb) eb.addEventListener('click', extraBtn.onClick);
  }
  (Array.isArray(extraBtns) ? extraBtns : []).forEach((b, i) => {
    if (!b || !b.onClick) return;
    const eb = document.getElementById('modal-extra-' + i);
    if (eb) eb.addEventListener('click', b.onClick);
  });
  $('#modal-root').classList.add('open');
  const first = $('#modal-body .form-input, #modal-body .form-select');
  if (first) setTimeout(() => first.focus(), 60);
}
function closeModal() {
  closeAllMsel();   // v95：顺手收起还展开着的多选面板（下一个弹窗不该继承上一个的展开态）
  $('#modal-root').classList.remove('open');
  MODAL_OK = null;
  MODAL_NO_ESCAPE = false;
}
function confirmModal({ title, message, okText = '确认', danger = false, onOk }) {
  openModal({
    title,
    bodyHTML: `<div style="font:400 14px/1.60 var(--font-text); color:var(--color-ink-muted);">${message}</div>`,
    okText,
    okClass: danger ? 'btn-danger' : 'btn-primary',
    // 与 formModal 对齐：onOk 返回 false = 校验没过 / 刻意不关窗；其余情况确认后自动关窗。
    // 历史上这里不关窗，而 7 个 confirmModal 调用者的 onOk 也都没自己关，
    // 导致「删除案件 / 删除客户 / 批量删除 / 重置演示数据」等点完确认后弹窗仍挂在屏幕上。
    onOk: () => { const r = onOk ? onOk() : undefined; if (r !== false) closeModal(); return r; },
  });
}

/* ---------- v95 多选下拉：可单选、可多选的勾选面板（侵权类型用） ---------- */
// 组件结构：隐藏 input（承载 data-k / data-fk，沿用既有取值与必填校验）+ 外观按钮 + 勾选面板。
// 面板在字段内就地展开（不做浮层）：弹窗内容区是滚动容器，浮层会被整块裁掉，就地展开最稳。
// 值形态：顿号分隔字符串（如「商标权、信息网络传播权」），列表页、CSV、检索均按字符串处理，无需改数据结构。
function infringeList(v) {
  if (Array.isArray(v)) return v.map(s => String(s).trim()).filter(Boolean);
  return String(v == null ? '' : v).split(/[、,，;；/|]+/).map(s => s.trim()).filter(Boolean);
}
/* ---------- v121 侵权类型历史值归并（枚举外的旧值不再冒充「第 13 项」） ---------- */
// v95 之前「侵权类型」是自由文本，老档案里会留下枚举外的值（旧种子就有「××品牌保温杯涉嫌商标侵权」）。
// multiSelectHTML 为了「打开老档案不丢值」会把这类值追加到面板末尾并勾选，看起来就像多出来一个可选项。
// 这里按关键词把它归并回 12 项枚举：能对上号的归到对应项，对不上号的丢弃，并去重。
// 规则只收「指向唯一权利类型」的关键词；「专利侵权」「著作权侵权」这类判不出子类型的旧值不猜，直接丢弃。
const REASON_LEGACY_RULES = [
  [/信息网络传播/, '信息网络传播权'],
  [/不正当竞争/, '不正当竞争'],
  [/软件/, '软件著作权'],
  [/美术/, '美术作品著作权'],
  [/视听|影视/, '视听作品著作权'],
  [/文字/, '文字作品著作权'],
  [/实用新型/, '实用新型专利权'],
  [/外观设计/, '外观设计专利权'],
  [/发明/, '发明专利权'],
  [/商标/, '商标权'],
  [/肖像/, '肖像权'],
];
function normalizeInfringe(v) {
  const out = [];
  infringeList(v).forEach(x => {
    let t = x;
    if (INFRINGE_TYPES.indexOf(t) < 0) {
      const hit = REASON_LEGACY_RULES.find(r => r[0].test(t));
      t = hit ? hit[1] : '';
    }
    if (t && out.indexOf(t) < 0) out.push(t);
  });
  return out.join('、');
}
function multiSelectHTML(key, value, options, opts) {
  const o = opts || {};
  const cur = infringeList(value);
  const list = (options || []).slice();
  // 历史自由文本值（不在枚举里）追加到面板末尾并默认勾选，打开表单后既有内容不会丢
  cur.forEach(v => { if (list.indexOf(v) < 0) list.push(v); });
  const ph = o.placeholder || '请选择（可多选）';
  const attr = o.fk ? `data-fk="${esc(key)}"` : `data-k="${esc(key)}"`;
  return `<div class="msel" data-msel="${esc(key)}">
    <input type="hidden" ${attr} value="${esc(cur.join('、'))}">
    <button type="button" class="msel-box" data-ph="${esc(ph)}" onclick="toggleMsel(this)">
      <span class="msel-text${cur.length ? '' : ' ph'}">${esc(cur.length ? cur.join('、') : ph)}</span>
      <span class="msel-caret">▾</span>
    </button>
    <div class="msel-panel" data-msel="${esc(key)}">${list.map(v =>
      `<label class="msel-opt"><input type="checkbox" value="${esc(v)}"${cur.indexOf(v) >= 0 ? ' checked' : ''} onchange="mselSync(this)"><span>${esc(v)}</span></label>`).join('')}</div>
  </div>`;
}
// 展示层：顿号串 → 多个标签
function infringeTags(v) {
  const a = infringeList(v);
  if (!a.length) return '<span class="tag tag-neutral">—</span>';
  return a.map(t => `<span class="tag tag-purple">${esc(t)}</span>`).join(' ');
}
function closeAllMsel() {
  document.querySelectorAll('.msel.open').forEach(w => {
    w.classList.remove('open');
    const p = w.querySelector('.msel-panel');
    if (p) { p.style.position = ''; p.style.left = ''; p.style.top = ''; p.style.width = ''; }
  });
}
function toggleMsel(box) {
  const wrap = box.closest('.msel'); if (!wrap) return;
  closeAllMsel();                                  // 只允许一个面板展开
  wrap.classList.toggle('open');
}
function mselSync(cb) {
  const wrap = cb.closest('.msel'); if (!wrap) return;
  const hidden = wrap.querySelector('input[type="hidden"]');
  const vals = Array.from(wrap.querySelectorAll('.msel-panel input[type="checkbox"]'))
    .filter(i => i.checked).map(i => i.value);
  if (hidden) { hidden.value = vals.join('、'); hidden.classList.remove('err'); }
  const boxEl = wrap.querySelector('.msel-box'), txt = wrap.querySelector('.msel-text');
  if (txt) {
    txt.textContent = vals.length ? vals.join('、') : ((boxEl && boxEl.dataset.ph) || '请选择（可多选）');
    txt.classList.toggle('ph', !vals.length);
  }
  const field = wrap.closest('.form-field'), err = field ? field.querySelector('.form-err') : null;
  if (err) err.classList.remove('show');
}

/* ---------- 表单 Modal ---------- */
// field = {key,label,type:'text|number|date|select|multi|textarea',value,options,required,span:2,placeholder,hint}
function formModal({ title, fields, submitText = '保存', onSubmit, wide = false, xwide = false, cols = 2, extraBtn = null }) {
  // 文件字段的识别回调注册表：inline onchange 只能调全局函数，这里按字段 key 挂回调
  MODAL_FILE_HOOKS = {};
  fields.forEach(f => { if (f && f.type === 'file' && typeof f.onPick === 'function') MODAL_FILE_HOOKS[f.key] = f.onPick; });
  // v138：cols 控制栅格列数（2 = 既有默认；3 = 紧凑版）。span 语义 = 跨列数，
  //   跨满整行时统一用 'full' class（.form-grid.cols-3 .form-field.full { grid-column: span 3; }）。
  const gridCls = 'form-grid' + (cols === 3 ? ' cols-3' : '');
  const html = '<div class="' + gridCls + '">' + fields.map(f => {
    if (f.type === 'section') return `<div class="form-section-title">${esc(f.label)}</div>`;
    const spanN = Number(f.span) || 1;
    const isFull = spanN >= cols;
    const cls = 'form-field' + (isFull ? ' full' : '');
    const spanAttr = (!isFull && spanN > 1) ? ` style="grid-column:span ${spanN};"` : '';
    let input;
    if (f.type === 'file') {
      // 只读框显示所选文件名 + 上传按钮 + 隐藏 file input（与阶段表单 stageUploadHTML 同款交互）
      // v143：f.multiple 支持多选，文件名以「、」拼接；上传按钮文案相应改为「添加」
      // v145：f.clear 提供「清除」按钮 —— 此前 file 字段只能整框替换，删除不了已上传的文件。
      const multi = f.multiple ? ' multiple' : '';
      const btnTxt = f.multiple ? '添加' : '上传';
      const clearBtn = f.clear
        ? `<button type="button" class="btn btn-ghost btn-sm" style="white-space:nowrap;" onclick="clearFileField('${f.key}')">清除</button>`
        : '';
      input = `<div style="display:flex;gap:8px;">
        <input class="form-input" data-k="${f.key}" value="${esc(f.value || '')}" readonly placeholder="点击「${btnTxt}」选择文件">
        <button type="button" class="btn btn-secondary btn-sm" style="white-space:nowrap;" onclick="document.getElementById('mff-${f.key}').click()">${btnTxt}</button>
        <input type="file" id="mff-${f.key}" style="display:none"${multi} onchange="formFilePicked(this,'${f.key}')">
        ${clearBtn}
      </div>`;
    } else if (f.type === 'select') {
      // v110：f.placeholder 存在时前置一个空值占位项（如「请选择快递公司」）。
      // 没有它，浏览器会自动选中首个真实选项 —— 用户不动它直接保存就会把该值静默写进数据。
      const ph = f.placeholder ? `<option value="">${esc(f.placeholder)}</option>` : '';
      input = `<select class="form-select" data-k="${f.key}">${ph}${f.options.map(o =>
        `<option value="${esc(o)}"${o === f.value ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    } else if (f.type === 'custom') {
      // v111：自定义区块 —— 承载「可增删多行」这类 formModal 原生字段装不下的控件。
      // f.html 渲染 HTML；f.read() 负责把值从 DOM 读回来（onOk 里对 custom 走 f.read()）。
      input = f.html || '';
    } else if (f.type === 'multi') {
      input = multiSelectHTML(f.key, f.value, f.options, { placeholder: f.placeholder });
    } else if (f.type === 'textarea') {
      input = `<textarea class="form-textarea" data-k="${f.key}" placeholder="${esc(f.placeholder || '')}">${esc(f.value || '')}</textarea>`;
    } else {
      // v96：支持 f.readonly（只读展示字段，如自动生成的案件单号）与 f.oninput（联动刷新）
      input = `<input class="form-input" type="${f.type || 'text'}" data-k="${f.key}"
        value="${esc(f.value || '')}" placeholder="${esc(f.placeholder || '')}"${f.readonly ? ' readonly' : ''}${f.oninput ? ` oninput="${f.oninput}"` : ''}>`;
    }
    return `<div class="${cls}"${spanAttr}>
      ${(f.label || f.required) ? `<label class="form-label">${esc(f.label)}${f.required ? '<span class="req">*</span>' : ''}</label>` : ''}
      ${input}
      ${f.hint ? `<div class="form-hint">${esc(f.hint)}</div>` : ''}
      <div class="form-err" data-err="${f.key}">此项为必填</div>
    </div>`;
  }).join('') + '</div>';

  openModal({
    // extraBtn：取消与确定之间的第三个按钮（如「清除筛选」），点击不触发 onOk
    title, wide, xwide, bodyHTML: html, okText: submitText, extraBtn,
    onOk: () => {
      const data = {};
      let bad = null;
      fields.forEach(f => {
        if (f.type === 'section') return;
        // v111：custom 区块没有 [data-k] 元素，改由 f.read() 取结构化值
        if (f.type === 'custom') { data[f.key] = (typeof f.read === 'function') ? f.read() : null; return; }
        const el = $(`#modal-body [data-k="${f.key}"]`);
        const v = el ? el.value.trim() : '';
        if (f.required && !v && !bad) {
          bad = f;
          el && el.classList.add('err');
          $(`#modal-body [data-err="${f.key}"]`) && $(`#modal-body [data-err="${f.key}"]`).classList.add('show');
        }
        data[f.key] = v;
      });
      if (bad) { toast('请填写必填项', bad.label, 'error'); return false; }
      const r = onSubmit(data);
      if (r !== false) closeModal();
      return r;
    },
  });
}

/* ---------- 表单文件字段：选中文件后回填文件名，并触发该字段注册的识别回调 ---------- */
let MODAL_FILE_HOOKS = {};
function formFilePicked(inp, key) {
  const files = Array.from((inp && inp.files) || []);
  const file = files[0] || {};
  const name = file.name || '';
  const target = document.querySelector('#modal-body [data-k="' + key + '"]');
  // v143：多选字段（f.multiple）把所选文件名以「、」拼接，追加到已有值之后（去重保序）
  if (target && name) {
    if (files.length > 1) {
      const cur = String(target.value || '').split('、').map(s => s.trim()).filter(Boolean);
      files.forEach(f => { if (f.name && cur.indexOf(f.name) < 0) cur.push(f.name); });
      target.value = cur.join('、');
    } else {
      target.value = name;
    }
  }
  const hook = MODAL_FILE_HOOKS[key];
  if (!hook || !name) return;
  const run = t => { try { hook(name, t || ''); } catch (e) {} };
  if (typeof file.text === 'function') file.text().then(run).catch(() => run(''));
  else run('');
}
// 登记权利弹窗：上传权属文件 → 识别并回填表单字段（可再手工调整）
function fillAssetFormFromDoc(name, text) {
  const body = document.getElementById('modal-body'); if (!body) return;
  const r = assetDocRecognize(name, text);
  const set = (k, v) => { const el = body.querySelector('[data-k="' + k + '"]'); if (el && v) el.value = v; };
  set('type', r.type); set('no', r.no); set('name', r.name); set('cat', r.cat);
  set('owner', r.owner); set('from', r.from); set('to', r.to);
  toast('权属文件已识别',
    r.hits.length ? ('已填充 ' + r.hits.join(' · ')) : '未提取到标准字段，已用示例值填充，请人工核对',
    r.hits.length ? 'success' : 'info');
}

/* ---------- 持久化 ---------- */
const SK = 'ipcase_demo_v2';
const SAVE_VER = 21;   // v21：v151 费用记录新增 dir/src/proof、状态枚举扩「未发起 / 退原告 / 退律所」、
                       //      案件 expenses 新增 feeId 关联键（费用明细与费用中心同源），老存档必须重播种
                       // v15：匹配律师表单接入律师库（检索选择 + 律所名称/律师地址自动带入），新增 case.lawyerFirm/lawyerAddr，需重播种
                      // v8：案件明细（被告/费用/链接/时间轴）改为按案件派生，旧存档是共用模板值，必须丢弃重播种
                      // v12：创建案件表单新增「客户」字段（旧 client 改为「权利人」），线索来源改为下拉（线上/线下），
                      //      案件详情重构为 3 tab + 折叠面板；为避免老数据字段错位，重新播种更稳

/* ---------- 列表派生字段：平台 / 店铺名 ---------- */
// defendant 形如：淘宝"××优品" → 平台 = 淘宝，店铺名 = ××优品
// 定义在 caseExtras 之前：案件明细派生时要用它拆店铺名
const DEF_SPLIT_RE = /^(.*?)[“"「『']\s*(.+?)\s*[”"」』']$/;
function splitDefendant(s) {
  const m = String(s || '').match(DEF_SPLIT_RE);
  if (!m) return { platform: '—', shop: String(s || '').trim() || '—' };
  return { platform: m[1].trim() || '—', shop: m[2].trim() || '—' };
}

/* v11.2、案件平台/店铺名兑底——新案件由表单写入 c.platform/c.shop；老种子用 defendant 解析 */
function platformOf(c) {
  if (c && c.platform) return c.platform;
  return splitDefendant(c && c.defendant).platform || '—';
}
function shopOf(c) {
  if (c && c.shop) return c.shop;
  return splitDefendant(c && c.defendant).shop || '—';
}

/* v83：案件列表新增列的取值（客户 / 店铺ID / 判决金额 / 结案金额） */
// 客户：建案写入的 c.cust（委托付费方）；老种子无该字段时回退权利主体（品牌方即委托方）
function custNameOf(c) { return (c && (c.cust || c.client)) || '—'; }
// 店铺ID：优先案件自身字段，其次关联公证条目（与线索信息卡口径一致）
function shopIdOf(c) {
  if (c && c.shopId && c.shopId !== '—') return c.shopId;
  const n = (typeof leadNotaryOf === 'function') ? leadNotaryOf(c) : null;
  return (n && n.shopId && n.shopId !== '—') ? n.shopId : '—';
}
function amtCell(v) { const n = numOf(v); return n ? '¥ ' + n.toLocaleString('zh-CN') : '—'; }
// 判决金额：判决更新写入 c.judgeAmt；兼容旧数据的 c.ov.judgeAmt
function judgeAmtOf(c) { return amtCell((c && (c.judgeAmt || (c.ov && c.ov.judgeAmt))) || ''); }
// 结案金额：归档写入 c.closeAmt（顶层），结案信息卡读 c.ov.closeAmt —— 两个口径都兼容
function closeAmtOf(c) { return amtCell((c && ((c.ov && c.ov.closeAmt) || c.closeAmt)) || ''); }
// 办案律师：优先阶段表单写入的 c.lawyer；否则与详情「协作演员表」一致取 castOf(c).lawyer（待匹配阶段尚无律师）
function lawyerOf(c) {
  if (!c) return '—';
  if (c.lawyer) return c.lawyer;
  if (String(c.status) === '案件待匹配') return '—';
  return castOf(c).lawyer;
}
// 承办法官：只读用户实际填写的 c.judge —— 没填就返回空（v136：用户要求「没填就空着」，
//   不再回落演员表里按案件号派生的假名字）。
function judgeOf(c) {
  if (!c) return '';
  const v = (c.judge === undefined || c.judge === null) ? '' : String(c.judge).trim();
  return (v && v !== '—') ? v : '';
}

// 确定性伪随机（mulberry32）：以案件 id 为种子
// 同一案件每次派生结果完全一致，不同案件互不相同 —— 刷新/导入不会漂移
function seedOf(str) {
  let h = 2166136261;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rngOf(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* 案件明细取值池 */
const SURNAMES = ['林', '陈', '黄', '张', '李', '王', '刘', '赵', '周', '吴', '徐', '孙', '郑', '何'];
const PERSON_ADDRS = [
  '广东省 揭阳市 普宁市', '广东省 汕头市 潮南区', '浙江省 金华市 义乌市',
  '福建省 泉州市 晋江市', '江苏省 徐州市 睢宁县', '山东省 临沂市 兰山区',
  '河南省 商丘市 睢县', '湖南省 邵阳市 邵东市',
];
const BIZ_CITY = [
  { city: '广州', code: '4401', area: '020',  dists: ['白云区', '天河区', '番禺区', '海珠区', '南沙区'] },
  { city: '深圳', code: '4403', area: '0755', dists: ['宝安区', '龙华区', '龙岗区', '南山区', '福田区'] },
  { city: '东莞', code: '4419', area: '0769', dists: ['长安镇', '虎门镇', '厚街镇', '南城街道'] },
  { city: '佛山', code: '4406', area: '0757', dists: ['禅城区', '南海区', '顺德区'] },
  { city: '杭州', code: '3301', area: '0571', dists: ['滨江区', '萧山区', '余杭区', '西湖区'] },
  { city: '义乌', code: '3307', area: '0579', dists: ['稠城街道', '北苑街道', '江东街道'] },
  { city: '上海', code: '3101', area: '021',  dists: ['徐汇区', '浦东新区', '闵行区', '松江区'] },
  { city: '北京', code: '1101', area: '010',  dists: ['海淀区', '朝阳区', '丰台区', '昌平区'] },
  { city: '苏州', code: '3205', area: '0512', dists: ['姑苏区', '吴中区', '相城区', '工业园区'] },
];
// 手机号段（第二位 3-9 但第三位受约束，不能随机拼，否则出现 142 / 154 这类不存在号段）
const MOBILE_PREFIX = ['138', '139', '137', '136', '135', '150', '151', '152', '157', '158',
                       '159', '186', '187', '188', '130', '131', '132', '156', '176', '177'];
const BIZ_TRADE = ['商贸', '电子商务', '网络科技', '日用品', '家居用品', '供应链管理'];
// 商品池：n = 商品名，p = [最低价, 最高价]（单价按真实品类给区间，避免 6 千元的连接器）
const PRODUCT_POOL = [
  { key: '家居|保温杯|水杯|日用', items: [
    { n: '316 不锈钢保温杯', p: [69, 199] }, { n: '便携折叠水杯', p: [29, 79] },
    { n: '大容量车载杯', p: [49, 129] }, { n: '真空焖烧壶', p: [89, 239] },
    { n: '智能测温杯', p: [99, 299] }, { n: '礼盒装对杯', p: [128, 398] }] },
  { key: '插画|文创|美术', items: [
    { n: '原创插画明信片套装', p: [19, 59] }, { n: '联名插画帆布袋', p: [39, 99] },
    { n: '手绘图案笔记本', p: [25, 68] }, { n: '限定插画贴纸包', p: [9, 29] },
    { n: '艺术微喷装饰画', p: [45, 168] }] },
  { key: '消费电子|智能硬件|数码', items: [
    { n: '无线蓝牙耳机', p: [79, 399] }, { n: '快充移动电源', p: [59, 199] },
    { n: '智能手环', p: [99, 299] }, { n: '便携投影仪', p: [299, 1299] },
    { n: '桌面无线充电器', p: [39, 129] }] },
  { key: '食品|零食|饮料', items: [
    { n: '每日坚果礼盒', p: [59, 199] }, { n: '手撕面包整箱', p: [19, 49] },
    { n: '冻干水果脆片', p: [25, 69] }, { n: '低脂鸡胸肉零食', p: [29, 79] },
    { n: '果味气泡水整箱', p: [35, 89] }] },
  { key: '设计|视觉|工作室', items: [
    { n: '品牌 VI 模板素材', p: [99, 499] }, { n: '商用字体授权包', p: [199, 999] },
    { n: '原创摄影图集', p: [59, 299] }, { n: '包装设计源文件', p: [129, 599] },
    { n: '海报设计素材包', p: [39, 199] }] },
  { key: '电子元件|连接器', items: [
    { n: 'Type-C 连接器', p: [3, 19] }, { n: '贴片排针排母', p: [2, 15] },
    { n: '防水航空插头', p: [8, 45] }, { n: 'FPC 柔性排线', p: [5, 29] },
    { n: '端子线束组件', p: [4, 25] }] },
  { key: '跨境|代运营', items: [
    { n: '海外仓直发收纳盒', p: [19, 59] }, { n: '跨境专供厨房秤', p: [25, 79] },
    { n: '多语种包装数据线', p: [9, 39] }, { n: '出口装折叠风扇', p: [29, 89] },
    { n: '跨境专供瑜伽垫', p: [39, 129] }] },
  { key: '服装|鞋帽|女装|服饰', items: [
    { n: '法式连衣裙', p: [99, 399] }, { n: '针织开衫外套', p: [129, 459] },
    { n: '高腰阔腿裤', p: [89, 299] }, { n: '真丝衬衫', p: [159, 599] },
    { n: '羊绒混纺大衣', p: [399, 1299] }] },
];
const GENERIC_PRODUCTS = [
  { n: '店铺主推款', p: [39, 199] }, { n: '组合套装', p: [59, 299] },
  { n: '限时促销款', p: [19, 99] }, { n: '同款热销商品 A', p: [29, 159] },
  { n: '同款热销商品 B', p: [29, 159] },
];

/* 侵权商品池：先按客户所属行业取；客户不在客户表里时（如「杭州××服饰集团」），
   再按客户名关键词兜底；都取不到才用通用池 */
function productPool(clientName) {
  const name = String(clientName || '');
  const cu = CUSTOMERS.find(x => x.name === name);
  const cat = (cu && cu.category) || '';
  const hit = PRODUCT_POOL.find(p => new RegExp(p.key).test(cat))
           || PRODUCT_POOL.find(p => new RegExp(p.key).test(name));
  return (hit && hit.items) || GENERIC_PRODUCTS;
}

/* 阶段 → 已完成的流程节点数（时间轴 done / active / pending 分界） */
const STAGE_DONE_N = {
  '案件待匹配': 3, '待写诉状': 5, '诉状待确认': 6, '诉状待盖章': 6,
  '待提交立案': 7, '转正式立案': 7, '待开庭': 8, '待判决': 9, '二审': 10,
  '待写执行材料': 10, '执行材料待确认': 10, '执行材料待盖章': 10,
  '强制执行中': 12, '待归档': 12, '已归档': 13,
};
// 立案前阶段：诉讼费未缴、被告未调档
const PRE_FILING = ['案件待匹配', '待写诉状', '诉状待确认', '诉状待盖章', '待提交立案'];

/* ---------- v150：占位说明文字归一 ----------
   用户口径（2026-09-14）：字段没值就显示一个纯横杠 `—`，不要塞
   「—  待匹配」「—  立案前」「（待立案分配）」「——待匹配」这类**解释性文字**占位。
   历史种子 / 老存档 / 旧播种代码里都写过这些值，统一在取值口归一成空串，显示层再兜 `—`。
   ⚠ 必须放在 caseLog / caseExtras **之前**：顶层 `let STATE = defaultState()` 会立刻走到
   caseExtras → caseLog → normBlank，若声明在后会抛 TDZ「Cannot access 'BLANK_WORDS' before initialization」。 */
const BLANK_WORDS = ['—', '-', '--', '——', '—  待匹配', '—  立案前', '——待匹配',
  '（待立案分配）', '（待匹配法院）', '待匹配', '立案前', '未上传', '法院待定'];
function normBlank(v) {
  const s = String(v == null ? '' : v).trim();
  return BLANK_WORDS.indexOf(s) >= 0 ? '' : s;
}

/* ---------- v150：结算数据里的 m 现在存「发起结算日期」（YYYY-MM-DD）----------
   凡是**按月份归集 / 筛选 / 去重**的地方一律走 sameMonth 前缀比较；
   不要再写 `x.m === '2026-09'` —— m 已是完整日期，整串比较永远不成立（静默失效、KPI 恒 0）。 */
const curMonth = () => today().slice(0, 7);
const sameMonth = (v, ym) => String(v || '').slice(0, 7) === String(ym || '').slice(0, 7);

/* 时间轴：按案件自身数据生成（案号 / 店铺 / 标的额 / 承办人不再写死成同一个案件） */
function caseLog(c) {
  const rnd = rngOf(seedOf((c.id || '') + '#log'));
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const platform = platformOf(c); const shop = shopOf(c);
  const m = String(c.id || '').match(/IP-(\d{4})(\d{2})(\d{2})/);
  const base = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date();
  const at = (day, h, mi) => {
    const d = new Date(base.getTime() + day * 86400000);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(h)}:${pad(mi)}`;
  };
  const op = c.operator || '运营';
  const { lawyer, firm, judge } = castOf(c);
  const amount = money(numOf(c.amount)).replace(/\.00$/, '');
  // v150：原来空值兜「（待立案分配）/（待匹配法院）」—— 用户口径不要这类说明，空就是横杠
  const no = normBlank(c.no) || '—';
  const court = normBlank(c.court) || '—';
  const hall = `第 ${int(1, 12)} 法庭`;

  // [偏移天数, 时, 分, 操作人, 标题, 描述]；null 日期 = 未发生
  const T = [
    [0,  14, 22, op,     '线索发现',      `${platform} 平台「${shop}」店铺涉嫌销售侵权商品，已锁定 ${int(2, 6)} 个 SKU。`],
    [0,  15, 40, op,     '创建案件',      `案件单号 ${caseNoOf(c)} · 标的额 ${amount}。`],
    [1,  10, 12, '系统',  '线索推送',      '自动推送至客户审核，附件含商品链接 + 销量截图。'],
    [3,  16, 30, '客户',  '客户审核·侵权', '经权利人比对确认侵权，运营确认推送公证处取证。'],
    [8,  11,  0, '公证处', '公证出证',      `公证书编号（${base.getFullYear()}）粤公证字第 ${int(10000, 99999)} 号。`],
    [26, 14,  0, lawyer, '匹配律师+调档', `${firm}·${lawyer}。被告调档完成。`],
    [56, 11, 30, lawyer, '上传诉状',      `标的额 ${amount} · 客户已盖章 · 已提交${court}。`],
    [86, 10,  0, '法院',  '正式立案',      `案号 ${no} · 受理法院 ${court}。`],
    [172, 9,  30, judge,  '开庭',          `${court} · ${hall} 开庭审理。`],
    [null, null, null, judge,  '判决',     '待开庭后出具判决书。'],
    [null, null, null, op,     '二审决策', '一审判决生效后启动。'],
    [null, null, null, lawyer, '执行',     '判决生效 + 客户确认后申请强制执行。'],
    [null, null, null, op,     '结案归档', '执行回款 + 结案文书归档。'],
    [null, null, null, '财务',  '结算',     '月底统一生成客户账单。'],
  ];
  const doneN = STAGE_DONE_N[c.status] !== undefined ? STAGE_DONE_N[c.status] : 3;
  return T.map((t, i) => {
    const st = i < doneN ? 'done' : (i === doneN ? 'active' : 'pending');
    // 未发生（pending）节点不显示日期，仅 done / active 节点带真实时间
    return { state: st, time: st === 'pending' ? '—' : at(t[0], t[1], t[2]), actor: t[3], title: t[4], desc: t[5] };
  });
}

/* 案件明细：按案件逐条派生，每个案件独立持有一份，改动互不影响
   被告 / 费用 / 侵权链接 / 时间轴都由案件自身字段（店铺、标的额、客户行业、阶段）推导 */
function caseExtras(c) {
  c = c || {};
  const rnd = rngOf(seedOf(c.id || c.title || 'IP'));
  const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const platform = platformOf(c); const shop = shopOf(c);
  const amt = numOf(c.amount);
  const pre = PRE_FILING.indexOf(c.status) >= 0;

  /* --- 被告 --- */
  // 案件待匹配阶段被告信息尚未入库：由「补充被告」动作录入，之后按钮才变成「匹配律师」
  const biz = pick(BIZ_CITY);
  const defendants = (c.status === '案件待匹配') ? [] : [{
    kind: '自然人',
    name: pick(SURNAMES) + '某某',
    idno: biz.code + '**********' + int(1000, 9999),
    phone: pick(MOBILE_PREFIX) + '****' + int(1000, 9999),
    addr: pick(PERSON_ADDRS),
    extra: `${platform} 平台「${shop}」店铺经营者`,
  }];
  // 约 1/3 的案件只有一个被告，其余追加店铺主体公司作为第二位被告
  if (defendants.length && rnd() > 0.34) {
    defendants.push({
      kind: '法人/个体',
      name: `${biz.city}××${pick(BIZ_TRADE)}有限公司`,
      idno: `91${biz.code}01MA${int(10, 99)}****${pick('XYK')}`,
      phone: '0' + int(20, 21) + '-****' + int(1000, 9999),
      addr: `${biz.city}市 ${pick(biz.dists)} ××路 ${int(1, 999)} 号`,
      extra: '经营者：' + pick(SURNAMES) + '某某',
    });
  }

  /* --- 费用：诉讼费按财产案件受理费阶梯计算，其余按案件浮动 --- */
  const a = amt;
  let litigation = 50;
  if (a > 10000 && a <= 100000) litigation = a * 0.025 - 200;
  else if (a > 100000 && a <= 200000) litigation = a * 0.02 + 300;
  else if (a > 200000 && a <= 500000) litigation = a * 0.015 + 1300;
  else if (a > 500000 && a <= 1000000) litigation = a * 0.01 + 3800;
  else if (a > 1000000) litigation = a * 0.009 + 4800;
  litigation = Math.max(50, Math.round(litigation / 50) * 50);
  const noticeFee = rnd() < 0.45 ? 0 : int(2, 6) * 100;
  const discloseFee = rnd() < 0.40 ? 0 : int(5, 12) * 100;
  // v82：费用状态为「存储字段」，由后续财务系统写入；种子默认置「未发起」，不随案件流程派生
  const mkExp = (name, amt, status = '未发起') => ({ name, amt, status, proof: '' });
  const expenses = [
    mkExp('诉讼费', litigation),
    mkExp('公告费', noticeFee),
    mkExp('披露费', discloseFee),
    mkExp('调查费', int(12, 48) * 100),
    mkExp('公证费', (c.type === '公证' ? int(18, 30) : int(8, 20)) * 100),
    mkExp('样品费', int(120, 890)),
  ];

  /* --- 侵权商品链接：销售总额围绕标的额浮动，商品名随客户行业变 --- */
  const pool = productPool(c.client);
  const n = Math.min(pool.length, int(2, 4));
  const target = Math.max(amt * (0.6 + rnd() * 2.4), n * 900);
  const w = []; let wsum = 0;
  for (let i = 0; i < n; i++) { const v = 0.4 + rnd(); w.push(v); wsum += v; }
  const used = [], links = [];
  for (let i = 0; i < n; i++) {
    let p = pick(pool);
    let guard = 0;
    while (used.indexOf(p.n) >= 0 && guard++ < 10) p = pick(pool);
    used.push(p.n);
    const alloc = target * w[i] / wsum;
    const price = Math.max(p.p[0], Math.round(p.p[0] + rnd() * (p.p[1] - p.p[0])));
    const qty = Math.max(1, Math.round(alloc / price));
    links.push({
      title: `${shop} ${p.n}`,
      url: `item.htm?id=${int(100000, 999999)}…`,
      qty, price,
      cmt: Math.round(qty * (0.02 + rnd() * 0.2)),
    });
  }

  return { defendants, expenses, links, log: caseLog(c), ov: {} };
}
/* 合作协议：客户详情「基本信息」里与客户经理同级的字段行，只存一份协议正文（上传入口写入），正文改由弹窗查看 */
const CONTRACT_SEED_TEXT = [
  '知识产权维权委托协议（2024-2027）',
  '',
  '甲方（委托方）：杭州××科技有限公司',
  '乙方（受托方）：××律师事务所',
  '',
  '一、委托事项：甲方就名下商标权、专利权被侵害事宜，委托乙方提供维权代理服务，涵盖侵权取证、公证、行政投诉与民事诉讼。',
  '二、代理权限：特别授权，含代为立案、调查取证、出庭应诉、和解调解、签收法律文书。',
  '三、合作期限：2024-06-01 起至 2027-05-31 止，期满前未提出异议的自动顺延一年。',
  '四、分成比例：判赔、和解或调解所得款项，扣除公证费、诉讼费等实际支出后，甲方 75% / 乙方 25%。',
  '五、费用承担：公证费、诉讼费、律师差旅费由乙方先行垫付，结案后从赔偿款中据实结算。',
  '',
  '补充协议 · 风险代理分成条款',
  '本案采取全风险代理，前期不收取基础代理费；结案后按上述比例分配实际到账款项。',
].join('\n');

/* 客户档案卡（基本信息卡）的缺省值：开票 / 合作期限。
   老存档里没有这些字段 → 展示时回退到这里，不留空白行。 */
const CUST_DEFAULT_INVOICE    = '增值税专用发票 6%';
const CUST_DEFAULT_BANK       = '招商银行杭州分行 5719********1234';
const CUST_DEFAULT_COOP_FROM  = '2024-06-01';
const CUST_DEFAULT_COOP_TO    = '2027-05-31';
const CUST_SETTLE_OPTIONS     = ['月结 · 30 天', '月结 · 60 天', '季结 · 45 天', '单案结清'];
const CUST_REGION_OPTIONS     = ['华东', '华南', '华北', '华中', '西南', '西北', '东北', '海外'];
const CUST_STATUS_CLASS       = { '合作中': 'pill-success', '暂停': 'pill-warning', '已终止': 'pill-danger' };

function customerExtras() {
  return {
    contacts: [
      { name: '林芳', phone: '139****3021', mail: 'lin***@××.com', duty: '案件审核 · 诉状盖章 · 二审决策', main: true, color: '#5E6AD2' },
      { name: '张伟', phone: '138****7755', mail: 'zhang***@××.com', duty: '线索提报 · 侵权比对 · 证据提供', main: false, color: '#2563EB' },
      { name: '李娜', phone: '0571-****8801', mail: 'li***@××.com', duty: '账单确认 · 开票信息 · 回款', main: false, color: '#057A55' },
    ],
    assets: [
      { type: '商标', tcls: 'tag-purple', no: '第 12345678 号', name: '××', cat: '第 21 类 · 保温杯', owner: '杭州××科技有限公司', from: '2020-03-14', to: '2030-03-13' },
      { type: '商标', tcls: 'tag-purple', no: '第 23456789 号', name: '×× HOME', cat: '第 21 类 · 水杯', owner: '杭州××科技有限公司', from: '2021-06-21', to: '2031-06-20' },
      { type: '商标', tcls: 'tag-purple', no: '第 34567890 号', name: '×× 图形', cat: '第 35 类 · 广告销售', owner: '杭州××科技有限公司', from: '2020-11-21', to: '2030-11-20' },
      { type: '专利', tcls: 'tag-blue', no: 'ZL2024301****.X', name: '一种防漏杯盖结构', cat: '实用新型', owner: '杭州××科技有限公司', from: '2024-08-09', to: '2034-08-08' },
      { type: '著作权', tcls: 'tag-orange', no: '国作登字-2024-F-0012****', name: '×× 品牌 LOGO 美术作品', cat: '美术作品', owner: '杭州××科技有限公司', from: '2024-02-28', to: '2074-12-31' },
    ],
    holders: [
      { name: '杭州××科技有限公司', credit: '91330100MA2******X7', address: '浙江省 杭州市 滨江区 ××路 88 号 A 座 12 层', legal: '周立', duty: '董事长' },
      { name: '杭州××品牌管理有限公司', credit: '91330108MA2******B3', address: '浙江省 杭州市 西湖区 ××大厦 6 层', legal: '周立', duty: '执行董事' },
    ],
    contractText: CONTRACT_SEED_TEXT,
    invoiceType: CUST_DEFAULT_INVOICE,
    bank: CUST_DEFAULT_BANK,
    coopFrom: CUST_DEFAULT_COOP_FROM,
    coopTo: CUST_DEFAULT_COOP_TO,
  };
}
/* 缺省权利主体 = 客户自身（新客户建档 / 老数据迁移时使用）
   法定代表人 / 职务是人工填写项，不从客户档案的任何联系人信息派生 */
function selfHolder(c) {
  return [{ name: c.name || '—', credit: c.credit || '—', address: '—', legal: '—', duty: '—' }];
}

function defaultState() {
  const cases = CASES.map(c => ({ ...c, ...caseExtras(c), ...operatorStyle(c.operator) }));
  // 开庭种子按今天相对计算开庭日（CASES 字面量在 today() 之前定义，不能直接写表达式）
  const hearingSeed = cases.find(c => c.id === HEARING_SEED_ID);
  if (hearingSeed) hearingSeed.hearingAt = HEARING_SEED_AT;
  return {
    cases,
    customers: CUSTOMERS.map(c => ({ ...c, ...customerExtras() })),
    fees: feeSeed(),
  };
}
let STATE = defaultState();
let currentCaseId = null;
let currentCustomerId = null;

// 持久化范围 = 案件/客户 + 公证/证物/公证书/日历/结算，保证「刷新不丢」
function save() {
  try {
    localStorage.setItem(SK, JSON.stringify({
      __v: SAVE_VER,
      state: STATE,
      leads: LEADS,
      notary: NOTARY_ITEMS,
      evidences: EVIDENCES,
      notaryDocs: NOTARY_DOCS,
      calEvents: CAL_EVENTS,
      custBills: CUST_BILLS,
      lawBills: LAW_BILLS,
      bills: BILLS,
      docTemplates: DOC_TEMPLATES,
    }));
  } catch (e) {}
}
function load() {
  try {
    const raw = localStorage.getItem(SK);
    if (!raw) return false;
    const s = JSON.parse(raw);
    // 兼容 v2 及更早：raw 直接就是 state 对象
    const data = (s && typeof s === 'object' && Array.isArray(s.cases)) ? { state: s } : s;
    // 版本不符（旧版/损坏数据）→ 直接丢弃并重新播种，杜绝历史脏数据污染各模块
    if (!data || data.__v !== SAVE_VER) { try { localStorage.removeItem(SK); } catch (e) {} return false; }
    if (!data.state || !Array.isArray(data.state.cases) || !data.state.cases.length) return false;
    // 完整性校验：任一扩展数组缺失/类型错误 → 视为损坏，丢弃并重新播种，避免部分模块错乱/丢失
    const EXTRA_KEYS = ['notary', 'evidences', 'notaryDocs', 'calEvents', 'custBills', 'lawBills', 'bills'];
    if (!EXTRA_KEYS.every(k => Array.isArray(data[k]))) { try { localStorage.removeItem(SK); } catch (e) {} return false; }
    // 线索：v6 新增；老数据/手动清空 → 退回演示初始值
    if (!Array.isArray(data.leads)) data.leads = JSON.parse(JSON.stringify(LEADS));
    // 健壮性：按 id 去重，清理早期版本可能写入的重复案件
    const seen = new Set();
    const clean = data.state.cases.filter(c => c && c.id && !seen.has(c.id) && (seen.add(c.id), true));
    if (!clean.length) return false;
    data.state.cases = clean;
    STATE = data.state;
    STATE.customers = (Array.isArray(STATE.customers) && STATE.customers.length) ? STATE.customers : defaultState().customers;
    // 费用中心：v16 新增；老档案无该数组 → 补演示种子
    if (!Array.isArray(STATE.fees)) STATE.fees = feeSeed();
    STATE.cases.forEach((c, i) => {
      if (!c.defendants) Object.assign(c, caseExtras(c));
      if (!c.ov) c.ov = {};
      if (!c.log) c.log = caseLog(c);
      // v89：律师结算条款（结算模式 / 基础费 / 分成比例）——老档案没这组字段 → 补演示种子
      if (!c.lawyerSettleMode) seedLawyerSettle(c, i);
      // v124：付款记录统一字段 —— 老档案缺「收款人」→ 用本案权利人补演示值（已填值不覆盖，判不出就留空）
      if (Array.isArray(c.payments)) c.payments.forEach(p => {
        if (p && !p.payee) { const h = holderName(c); if (h && h !== '—') p.payee = h; }
      });
    });
    STATE.customers.forEach(c => {
      if (!c.contacts) Object.assign(c, customerExtras());
      if (!Array.isArray(c.holders)) c.holders = selfHolder(c);
      if (typeof c.contractText !== 'string') c.contractText = customerExtras().contractText || '';
    });
    restoreExtras(data);
    // v146：结算明细补稳定行键（老档案没有 → 补上，勾选/发起账单才对得上行）
    ensureBillRowKeys();
    // v121：载入存档时收敛侵权类型旧值（枚举外的自由文本 → 12 项枚举），
    // 否则老档案会在「侵权类型」多选面板末尾多出一个看起来像选项的「第 13 项」。
    LEADS.forEach(l => { if (l) l.reason = normalizeInfringe(l.reason); });
    STATE.cases.forEach(c => { if (c) c.reason = normalizeInfringe(c.reason); });
    // 公证费用列：老档案缺 investFee（调查费）→ 按 id 补演示种子，新列才不会整列空白
    NOTARY_ITEMS.forEach(n => { if (n.investFee == null) n.investFee = NOTARY_INVEST_FEE[n.id] || 0; });
    return true;
  } catch (e) { return false; }
}
function resetDemo() {
  confirmModal({
    title: '重置演示数据',
    message: '将清除你在本机做的<b>全部改动</b>（新增案件、状态流转、编辑过的字段），恢复到初始演示数据（每个流程 5 条案件）。此操作不可撤销。',
    okText: '确认重置', danger: true,
    onOk: () => {
      // localStorage 可能不可用（Safari 的 file://、隐私模式、配额超限、被禁用）：
      // 不加守卫会在这里抛 SecurityError，整个处理器中断 → 「确认重置」点了没反应。
      // 与 load()/save() 保持一致：存储失败也不影响内存态重置。
      try { localStorage.removeItem(SK); } catch (e) {}
      STATE = defaultState();
      restoreExtras(DEMO_DEFAULTS);
      fillStageDemoCases(STATE.cases);
      save(); renderAll(); renderSettings();
      toast('已重置为初始演示数据', '每个流程 5 条演示案件', 'info');
    },
  });
}

/* ---------- 阶段机 ---------- */
/* ---------- 律师库（匹配律师时的检索数据源：选人后自动带入 电话/律所/地址） ---------- */
const LAWYER_BOOK = [
  { name: '李建国', firm: '广东知恒律所',         phone: '138****6621', addr: '广州市天河区珠江新城华夏路××号××大厦 21 层' },
  { name: '周雨桐', firm: '北京盈科（广州）律所', phone: '139****0715', addr: '广州市越秀区东风东路××号××中心 35 层' },
  { name: '吴晓峰', firm: '上海锦天城律所',       phone: '137****3348', addr: '上海市浦东新区银城中路××号××大厦 18 层' },
  { name: '沈慧敏', firm: '浙江天册律所',         phone: '136****9902', addr: '杭州市杭大路××号××大厦 9 层' },
  { name: '郑  毅', firm: '广东知恒律所',         phone: '135****4470', addr: '广州市天河区珠江新城华夏路××号××大厦 21 层' },
];
// 律师库检索菜单（供案件表单 / 批量匹配弹窗共用）
function lawyerMenu(inp) {
  const menu = inp.parentElement.querySelector('.lw-menu');
  if (!menu) return;
  const q = (inp.value || '').trim().toLowerCase();
  const list = LAWYER_BOOK.filter(l => !q || l.name.toLowerCase().includes(q) || (l.firm || '').toLowerCase().includes(q));
  menu.innerHTML = list.length
    ? list.map(l => `<div class="lw-item" data-name="${esc(l.name)}" onclick="pickLawyer(this)"><b>${esc(l.name)}</b><span>${esc(l.firm)} · ${esc(l.phone)}</span></div>`).join('')
    : '<div class="lw-item lw-empty">律师库中无匹配，可手动填写其余字段</div>';
  menu.style.display = 'block';
}
// 选中律师 → 自动带入 电话 / 律所 / 地址（就近查找同一 form-grid 内的字段）
function pickLawyer(el) {
  const l = LAWYER_BOOK.find(x => x.name === el.dataset.name);
  if (l) {
    const map = { lawyer: 'name', lawyerPhone: 'phone', lawyerFirm: 'firm', lawyerAddr: 'addr' };
    const box = el.closest('.form-grid') || document;
    Object.keys(map).forEach(k => {
      const input = box.querySelector('[data-fk="' + k + '"]');
      if (input) input.value = l[map[k]] || '';
    });
  }
  el.parentElement.style.display = 'none';
}
// 点击律师菜单以外区域时收起
document.addEventListener('mousedown', e => {
  if (!e.target.closest('.lw-picker')) {
    $$('.lw-menu').forEach(m => { m.style.display = 'none'; });
  }
});

/* ---------- 结算条款常量（STAGES 字面量会引用，必须声明在 STAGES 之前，否则 TDZ） ----------
   两套结算彼此独立：
   1) 客户结算条件 = 一条公式（例：客户结算金额=结案金额*70%），只决定客户结算金额；
   2) 律师结算条款 = 律师协议（结算模式 / 基础费 / 分成比例），只决定律师结算金额。 */
const DEFAULT_CUST_FORMULA = '客户结算金额=结案金额*70%';
const CUST_FORMULA_HINT = '填写计算公式，例：客户结算金额=结案金额*70%';
const LAW_SETTLE_MODES = ['全风险', '半风险', '固定费用'];
const PCT_OPTIONS = Array.from({ length: 101 }, (_, i) => i + '%');   // 分成比例 0% – 100%
const LAW_MODE_HINT = {
  '全风险':   '全风险：律师结算金额 = 结案金额 × 分成比例（基础费固定为 0）',
  '半风险':   '半风险：律师结算金额 = 基础费 + 结案金额 × 分成比例',
  '固定费用': '固定费用：律师结算金额 = 基础费（固定金额，与结案金额无关）',
};
const LAW_SETTLE_SEED = [
  { mode: '全风险',   split: '30%', base: 0 },
  { mode: '半风险',   split: '20%', base: 8000 },
  { mode: '固定费用', split: '20%', base: 12000 },
];
// 演示种子：按序轮换三种结算模式，保证下拉三种模式都有数据
function seedLawyerSettle(c, i) {
  const t = LAW_SETTLE_SEED[Math.abs(Number(i) || 0) % LAW_SETTLE_SEED.length];
  c.lawyerSettleMode = t.mode; c.lawyerSplit = t.split; c.lawyerBaseFee = t.base;
  return c;
}

// v65：侧栏折叠流程组——「待写诉状 / 诉状待确认 / 诉状待盖章」三环节在导航中合并为一个「准备起诉文书」，
//      案件数据里的 c.status 仍是三个原子阶段值，流转 / 字段 / 批量操作全部不变
//      （PREP_DOC_GROUP 会被下方 STAGES 字面量引用，必须声明在 STAGES 之前，否则 TDZ）
// v67：同理新增「准备执行文书」组（待写执行材料 / 执行材料待确认 / 执行材料待盖章）
const PREP_DOC_GROUP = '准备起诉文书';
const EXEC_DOC_GROUP = '准备执行文书';
const STAGES = [
  { key: '案件待匹配', cls: 'pill-neutral',  next: '待写诉状', cta: '匹配律师', role: '运营',
    fields: [
      { k: 'matchAt',    label: '匹配日期', type: 'date' },
      { k: 'lawyer',     label: '律师姓名（从律师库选择）', type: 'lawyer' },
      { k: 'lawyerPhone',label: '律师电话', type: 'text' },
      { k: 'lawyerFirm', label: '律所名称', type: 'text' },
      { k: 'lawyerAddr', label: '律师地址', type: 'text' },
      { k: 'lawyerSettleMode', label: '律师结算模式', type: 'select', options: LAW_SETTLE_MODES, dflt: '全风险', onchange: 'syncLawyerMode()' },
      { k: 'lawyerBaseFee',    label: '基础费（元）', type: 'number', dflt: '0', hint: '全风险 = 0；半风险 / 固定费用可录入金额' },
      { k: 'lawyerSplit',      label: '分成比例', type: 'select', options: PCT_OPTIONS, dflt: '30%', hint: '下拉选择 0% – 100%，风险模式按此比例分成' },
    ] },
  // v65：三个文书环节在侧栏折叠为一个「准备起诉文书」流程（group 标记），内部子阶段 / cta / 字段全部不变
  { key: '待写诉状', cls: 'pill-info', next: '诉状待确认', cta: '上传诉状', role: '运营 / 律师', group: PREP_DOC_GROUP,
    fields: [
      { k: 'draftAt',  label: '上传诉状日期', type: 'date' },
      { k: 'authDoc',  label: '授权委托书 / 起诉状', type: 'text' },
      { k: 'amount',   label: '标的额（元）', type: 'number' },
    ] },
  { key: '诉状待确认', cls: 'pill-warning', next: '诉状待盖章', cta: '确认诉状', role: '运营', group: PREP_DOC_GROUP,
    fields: [
      { k: 'amount',      label: '标的额（元，可修改）', type: 'number' },
      { k: 'draftNote',   label: '在线预览并修改', type: 'textarea', full: true },
    ] },
  { key: '诉状待盖章', cls: 'pill-progress', next: '待提交立案', cta: '邮寄', role: '客户', group: PREP_DOC_GROUP,
    fields: [
      // v149：用户口径 —— 这一步是客户把盖章后的诉状「寄出」，记的应是邮寄日期
      { k: 'sealRecvAt', label: '邮寄日期', type: 'date' },
    ] },
  { key: '待提交立案', cls: 'pill-info', next: '转正式立案', cta: '提交立案', role: '运营',
    fields: [
      { k: 'court',     label: '立案法院', type: 'select', options: COURTS, required: true },
      { k: 'submitAt',  label: '提交立案日期', type: 'date', required: true },
      { k: 'amount',    label: '标的额（元，同步可修改）', type: 'number' },
      { k: 'filingShot',label: '立案截图', type: 'image' },
      { k: 'mediateNo', label: '诉调号 / 立案编号', type: 'text' },
      { k: 'evidence',  label: '证据材料', type: 'file' },
    ] },
  { key: '转正式立案', cls: 'pill-warning', next: '待开庭', cta: '提交', role: '运营', navLabel: '待正式立案',
    fields: [
      { k: 'formalAt',    label: '正式立案日期', type: 'date' },
      { k: 'caseNo',      label: '案号', type: 'text' },
      // v150：用户口径 —— 缴费清单是**上传的文件**，不是手填文字（原来 type: 'text'）
      { k: 'payList',     label: '缴费清单', type: 'file' },
      { k: 'payDeadline', label: '截止缴费日期（自动生成日历提醒）', type: 'date' },
      { k: 'acceptNotice',label: '立案受理通知书', type: 'file' },
      { k: 'hearingAt',   label: '开庭日期', type: 'date' },
      { k: 'serviceDoc',  label: '送达文书', type: 'file' },
      { k: 'hearingPlace',label: '开庭地点', type: 'text' },
      { k: 'judge',       label: '承办法官', type: 'text' },
      // v136：披露数据 / 披露数据附件 —— 一审阶段字段，立案信息卡片里也提供录入入口
      // v137：披露数据附件改成上传文件（不是文字输入）
      { k: 'discloseInfo',label: '披露数据', type: 'text' },
      { k: 'disclose',    label: '披露数据附件', type: 'file' },
    ] },
  // 待开庭：无操作按钮；开庭日期（转正式立案填写）次日由 autoFlowCases 自动流转待判决
  { key: '待开庭', cls: 'pill-primary', next: '待判决', cta: '', role: '律师',
    fields: [] },
  { key: '待判决', cls: 'pill-progress', next: null, cta: '判决更新', role: '律师 / 运营',
    fields: [
      { k: 'judgeGotAt', label: '收到判决日期', type: 'date', required: true },
      { k: 'judgeAmt',   label: '判决金额（元）', type: 'number' },
      { k: 'paidFee',    label: '实缴诉讼费（元）', type: 'number' },
      { k: 'refunds',    label: '诉讼退费（可多笔）', type: 'refunds', full: true },
      { k: 'judgeDoc',   label: '判决书（上传自动识别金额）', type: 'file', full: true, required: true },
    ] },
  // 二审：cta=二审更新（外层按钮/详情/banner）；提交后弹窗选择 发回重审→待正式立案 / 维持原判→上传二审判决书→待写执行材料
  { key: '二审', cls: 'pill-warning', next: '待写执行材料', cta: '二审更新', role: '律师 / 运营',
    fields: [
      { k: 'secondDoc',          label: '二审文书', type: 'file' },
      { k: 'secondHearingAt',    label: '二审开庭日期', type: 'date' },
      { k: 'secondHearingPlace', label: '二审开庭地点', type: 'text' },
      { k: 'secondServiceDoc',   label: '二审送达文书', type: 'file' },
      { k: 'secondJudge',        label: '二审法官', type: 'text' },
    ] },
  // v67：三个执行文书环节在侧栏折叠为一个「准备执行文书」流程（group 标记），内部子阶段 / cta / 字段全部不变
  { key: '待写执行材料', cls: 'pill-info', next: '执行材料待确认', cta: '上传执行材料', role: '运营 / 律师', group: EXEC_DOC_GROUP,
    fields: [
      { k: 'execDraftAt', label: '上传执行材料日期', type: 'date' },
      { k: 'execDoc',     label: '执行申请材料', type: 'file' },
    ] },
  { key: '执行材料待确认', cls: 'pill-warning', next: '执行材料待盖章', cta: '确认执行材料', role: '运营', group: EXEC_DOC_GROUP,
    fields: [
      { k: 'execConfirmAt', label: '确认日期', type: 'date' },
      { k: 'execDoc',       label: '执行申请材料（预览/修改）', type: 'textarea', full: true },
    ] },
  { key: '执行材料待盖章', cls: 'pill-progress', next: '待申请执行立案', cta: '邮寄', role: '客户 / 运营', group: EXEC_DOC_GROUP,
    fields: [
      { k: 'execMailAt', label: '邮寄日期', type: 'date', required: true },
    ] },
  { key: '待申请执行立案', cls: 'pill-info', next: '强制执行中', cta: '提交立案', role: '运营 / 律师', navLabel: '待申请执行',
    fields: [
      { k: 'execSubmitAt',  label: '提交执行立案日期', type: 'date' },
      // v142：执行立案截图 是「上传文件」，不是文字输入
      { k: 'execFilingShot',label: '执行立案截图', type: 'file' },
    ] },
  { key: '强制执行中', cls: 'pill-primary', next: '待归档', cta: '执行更新', role: '律师',
    fields: [
      { k: 'execFormalAt', label: '执行正式立案日期', type: 'date' },
      { k: 'execCaseNo',   label: '执行案号', type: 'text' },
      // v142：执行文书 是「上传文件」，不是文字输入
      { k: 'execFormalDoc',label: '执行文书', type: 'file' },
    ] },
  { key: '待归档', cls: 'pill-warning', next: null, cta: '归档', role: '运营',
    fields: [
      { k: 'closeAt',   label: '结案日期', type: 'date' },
      { k: 'closeAmt',  label: '结案金额（元）', type: 'number' },
      { k: 'custSettleAmt', label: '客户结算金额（按结算条件自动计算）', type: 'settleCalc', side: 'cust' },
      { k: 'lawSettleAmt',  label: '律师结算金额（按律师协议自动计算）', type: 'settleCalc', side: 'law' },
      { k: 'payType',   label: '付款类型', type: 'select', options: ['一次性付款', '分期付款'], onchange: "syncPayRowLimit('stage', true)" },
      { k: 'closeDoc',  label: '结案文书', type: 'file' },
      { k: 'payments',  label: '付款记录（可多笔，自动汇总已付款）', type: 'payments', full: true },
      { k: 'refundsRo', label: '诉讼退费（已登记，仅状态可修改）', type: 'refunds-ro', full: true },
      { k: 'needSettle',label: '是否涉及结算', type: 'select', options: ['否', '是'] },
    ] },
  { key: '已归档', cls: 'pill-success', next: null, cta: null, role: '—', fields: [] },
];
// v65：侧栏折叠流程组——「待写诉状 / 诉状待确认 / 诉状待盖章」三环节在导航中合并为一个「准备起诉文书」，
//      案件数据里的 c.status 仍是三个原子阶段值，流转 / 字段 / 批量操作全部不变
// v67：组机制泛化——groupStageKeys(g) 返回组内原子阶段；组名本身可作为 FILTER.status 进入合并视图
const groupStageKeys = g => STAGES.filter(s => s.group === g).map(s => s.key);
const prepDocStageKeys = () => groupStageKeys(PREP_DOC_GROUP);
const isPrepDocFilter = () => FILTER.status === PREP_DOC_GROUP || prepDocStageKeys().includes(FILTER.status);

const stageOf = k => STAGES.find(s => s.key === k) || STAGES[0];
const STAGE_KEYS = STAGES.map(s => s.key);

/* ---------- 列表筛选状态 ---------- */
let FILTER = {
  q: '', status: '全部', sort: { key: null, dir: 1 },
  op: '所有运营', type: '所有案件类型',
  // v66：表头「案件进展 ▾」多选筛选（空数组 = 不启用，跟随 status；非空 = 命中任一勾选阶段）
  statusSet: [],
  // 高级筛选（案件列表「筛选」面板，行内展开）
  adv: { client: '', holder: '', shop: '', defendant: '', court: '', no: '', lawyer: '', hearingAt: '', closeAt: '' },
};
let SELECTED = new Set();
let CUST_FILTER = { q: '', status: '全部' };

// ============================================================
// 4. 渲染
// ============================================================
function filteredCases() {
  const q = FILTER.q.trim().toLowerCase();
  let list = STATE.cases.filter(c => {
    if (Array.isArray(FILTER.statusSet) && FILTER.statusSet.length) {
      // v66：表头「案件进展 ▾」多选——命中任一勾选阶段即保留
      if (!FILTER.statusSet.includes(c.status)) return false;
    } else if (FILTER.status !== '全部') {
      // v65/v67：「准备起诉文书」「准备执行文书」等合并视图——FILTER.status 为组名时命中组内任一阶段
      const gKeys = groupStageKeys(FILTER.status);
      if (gKeys.length) {
        if (!gKeys.includes(c.status)) return false;
      } else if (c.status !== FILTER.status) return false;
    }
    // 筛选栏下拉：运营 / 案件类型（真实过滤，非提示）
    if (FILTER.op && FILTER.op !== '所有运营' && c.operator !== FILTER.op) return false;
    if (FILTER.type && FILTER.type !== '所有案件类型' && c.type !== FILTER.type) return false;
    // 高级筛选（案件列表「筛选」面板，行内展开）
    const a = FILTER.adv || {};
    if (a.client && String(c.client || '').indexOf(a.client) === -1) return false;
    if (a.holder && String(holderName(c)).indexOf(a.holder) === -1) return false;
    if (a.shop && String(shopOf(c)).indexOf(a.shop) === -1) return false;
    if (a.defendant && String(defendantNames(c)).indexOf(a.defendant) === -1) return false;
    if (a.court && String(c.court || '').indexOf(a.court) === -1) return false;
    if (a.no && String(c.no || '').indexOf(a.no) === -1) return false;
    if (a.lawyer && String(c.lawyer || '').indexOf(a.lawyer) === -1) return false;
    if (a.hearingAt && String(c.hearingAt || '').slice(0, 10) !== a.hearingAt) return false;
    if (a.closeAt && String(c.closeAt || '').slice(0, 10) !== a.closeAt) return false;
    if (!q) return true;
    // 搜索范围跟随列表可见列：案件名称 / 案号 / 权利人 / 平台 / 店铺名 / 被告 / 标的额 / 立案法院 / 类型 / 运营
    return [c.title, c.no, holderName(c), platformOf(c), shopOf(c), defendantNames(c),
            c.amount, c.court, c.operator, c.type]
      .join(' ').toLowerCase().includes(q);
  });
  const { key, dir } = FILTER.sort;
  if (key) {
    list.sort((a, b) => {
      let x = a[key], y = b[key];
      if (key === 'amount') { x = numOf(a.amount); y = numOf(b.amount); }
      else x = String(x), y = String(y);
      return x > y ? dir : x < y ? -dir : 0;
    });
  }
  return list;
}

/* ---------- 案件列表筛选（「筛选」按钮 → 行内展开面板，不再弹窗） ---------- */
function advFilterActive() {
  const a = FILTER.adv || {};
  return Object.keys(a).some(k => String(a[k] || '').trim() !== '');
}
/* 筛选生效或面板展开时给按钮加高亮 */
function syncCaseFilterBtn() {
  const b = document.getElementById('case-filter-btn');
  const p = document.getElementById('case-filter-panel');
  if (b) b.classList.toggle('filter-on', advFilterActive() || !!(p && p.style.display !== 'none'));
}
/* 「筛选」按钮：展开 / 收起面板 */
function openCaseFilter() {
  const p = document.getElementById('case-filter-panel');
  if (!p) return;
  p.style.display = (p.style.display === 'none') ? '' : 'none';
  syncCaseFilterBtn();
}
function applyCaseFilterPanel() {
  const v = id => { const el = document.getElementById(id); return el ? String(el.value).trim() : ''; };
  FILTER.adv = {
    client: v('cf-client'), holder: v('cf-holder'), shop: v('cf-shop'),
    defendant: v('cf-defendant'), court: v('cf-court'), no: v('cf-no'),
    lawyer: v('cf-lawyer'), hearingAt: v('cf-hearingAt'), closeAt: v('cf-closeAt'),
  };
  renderCases(); syncCaseFilterBtn();
  const n = filteredCases().length;
  toast('筛选已应用', `命中 ${n} 个案件`, n ? 'success' : 'info');
}
function clearCaseFilter() {
  FILTER.adv = { client: '', holder: '', shop: '', defendant: '', court: '', no: '', lawyer: '', hearingAt: '', closeAt: '' };
  ['cf-client', 'cf-holder', 'cf-shop', 'cf-defendant', 'cf-court', 'cf-no', 'cf-lawyer', 'cf-hearingAt', 'cf-closeAt']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  FILTER.op = '所有运营'; FILTER.type = '所有案件类型';
  const op = document.getElementById('case-filter-op');
  const ty = document.getElementById('case-filter-type');
  if (op) op.value = FILTER.op;
  if (ty) ty.value = FILTER.type;
  renderCases(); syncCaseFilterBtn();
  toast('已清除全部筛选', `共 ${filteredCases().length} 个案件`, 'success');
}

/* v120：案件表格长文本列的「最多 2 行 + 省略号」。
   为什么套一层 span：td 的 max-width 在 table-layout:auto 下无效，限宽必须落在内层块级容器上。
   宽度按列在 styles.css 的 #view-cases 块里指定；title 让鼠标悬停仍能看全文。 */
function cut2(text, extraCls, noTitle) {
  const t = String(text == null ? '' : text);
  const cls = 'cut2' + (extraCls ? ' ' + extraCls : '');
  const tip = noTitle ? '' : ` title="${esc(t)}"`;
  return `<span class="${cls}"${tip}>${esc(t)}</span>`;
}
/* 被告 2 个以上时，被告列挂 data-tip-case 走项目自带的富文本气泡；此时不再加原生 title，免得两个气泡打架 */
const multiDef = c => (Array.isArray(c.defendants) ? c.defendants.filter(d => d && d.name).length : 0) > 1;

function renderCases() {
  const list = filteredCases();
  const tb = $('#cases-tbody');
  tb.innerHTML = list.map(c => `
    <tr data-id="${c.id}" onclick="openCase('${c.id}')">
      <td onclick="event.stopPropagation()" style="white-space:nowrap;">
        <span class="checkbox${SELECTED.has(c.id) ? ' checked' : ''}" data-sel="${c.id}" onclick="toggleSel('${c.id}')" title="勾选后可批量操作" style="vertical-align:middle;margin-right:8px;cursor:pointer;"></span>${caseActionBtns(c)}
      </td>
      <td><span class="pill ${stageOf(c.status).cls}">${esc(c.status)}</span></td>
      <td>${cut2(custNameOf(c))}</td>
      <td>${cut2(holderName(c))}</td>
      <td>${esc(platformOf(c))}</td>
      <td>${cut2(shopOf(c))}</td>
      <td class="mono">${esc(shopIdOf(c))}</td>
      <td${multiDef(c) ? ` data-tip-case="${esc(c.id)}"` : ` title="${esc(defendantNames(c))}"`}>${cut2(defendantNames(c), '', true)}</td>
      <td>${esc(normBlank(lawyerOf(c)) || '—')}</td>
      <td>${cut2(normBlank(c.court) || '—')}</td>
      <td>${cut2(normBlank(c.no) || '—', 'case-id')}</td>
      <td class="num">${esc(c.amount)}</td>
      <td class="num">${judgeAmtOf(c)}</td>
      <td class="num">${closeAmtOf(c)}</td>
    </tr>`).join('') || emptyRow(14, '没有匹配的案件', '换个关键词或清除筛选试试');

  // 表头同步排序态
  $$('#view-cases thead th.sortable').forEach(th => {
    const k = th.dataset.sort;
    th.classList.toggle('sorted', FILTER.sort.key === k);
    const a = th.querySelector('.arrow');
    if (a) a.textContent = FILTER.sort.key === k ? (FILTER.sort.dir === 1 ? '▲' : '▼') : '▲';
  });
  setTxt('#cases-count', list.length);   // 该元素在删 KPI 时已移除，用 setTxt 避免 null 崩溃
  updateBulk();
  syncCasesBatchBtn();
  const selAll = document.getElementById('cases-sel-all');
  if (selAll) selAll.classList.toggle('checked', !!list.length && list.every(c => SELECTED.has(c.id)));
  applyColPrefs();
}

/* ---------- 全选 / 取消全选（表头「操作」左侧勾选框） ---------- */
function toggleSelAll() {
  const list = filteredCases();
  if (!list.length) { toast('没有可勾选的案件', '', 'info'); return; }
  const all = list.every(c => SELECTED.has(c.id));
  list.forEach(c => all ? SELECTED.delete(c.id) : SELECTED.add(c.id));
  renderCases();
  toast(all ? '已取消全选' : '已全选', `${list.length} 件案件`, 'info');
}

/* ---------- 自定义展示列：操作/案件进展固定，其余列按流程独立记忆（localStorage） ---------- */
const CASE_COL_DEFS = [
  { key: 'cust', label: '客户' },
  { key: 'holder', label: '权利主体' },
  { key: 'platform', label: '平台' },
  { key: 'shop', label: '店铺名' },
  { key: 'shopId', label: '店铺ID' },
  { key: 'defendant', label: '被告' },
  { key: 'lawyer', label: '办案律师' },
  { key: 'court', label: '立案法院' },
  { key: 'no', label: '案号' },
  { key: 'amount', label: '标的额' },
  { key: 'judgeAmt', label: '判决金额' },
  { key: 'closeAmt', label: '结案金额' },
];
let COL_PREFS = {};
try { COL_PREFS = JSON.parse(localStorage.getItem('ip_col_prefs_v1') || '{}') || {}; } catch (e) { COL_PREFS = {}; }
function colPrefsOf(stage) {
  const base = {};
  CASE_COL_DEFS.forEach(d => { base[d.key] = true; });
  const saved = COL_PREFS[stage] || {};
  Object.keys(saved).forEach(k => { if (k in base) base[k] = !!saved[k]; });
  return base;
}
function applyColPrefs() {
  const prefs = colPrefsOf(FILTER.status);
  $$('#view-cases thead th[data-col]').forEach(th => {
    const show = prefs[th.dataset.col] !== false;
    th.style.display = show ? '' : 'none';
    $$('#cases-tbody tr').forEach(tr => {
      const td = tr.cells[th.cellIndex];
      if (td) td.style.display = show ? '' : 'none';
    });
  });
}
function openColPrefs() {
  const prefs = colPrefsOf(FILTER.status);
  const items = CASE_COL_DEFS.map(d => `
    <label style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;">
      <input type="checkbox" data-colk="${d.key}"${prefs[d.key] ? ' checked' : ''}> ${d.label}</label>`).join('');
  openModal({
    title: '自定义展示列 · ' + FILTER.status, okText: '保存', okClass: 'btn-primary',
    bodyHTML: `<div class="form-hint" style="margin-bottom:8px;">「操作」「案件进展」为固定列，不可取消；勾选只对当前流程（${esc(FILTER.status)}）生效，各流程独立记忆。</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;">${items}</div>`,
    onSubmit: () => {
      const saved = {};
      $$('#modal-body [data-colk]').forEach(el => { saved[el.dataset.colk] = el.checked; });
      COL_PREFS[FILTER.status] = saved;
      try { localStorage.setItem('ip_col_prefs_v1', JSON.stringify(COL_PREFS)); } catch (e) {}
      applyColPrefs();
      closeModal();
      toast('展示列已保存', `${FILTER.status} · 下次进入自动应用`, 'success');
    },
  });
}

/* ---------- 公证阶段：自定义展示列（选择框/操作/案件进展固定，其余列独立记忆） ---------- */
const NOTARY_COL_DEFS = [
  { key: 'holder',    label: '权利主体' },
  { key: 'platform',  label: '平台' },
  { key: 'shop',      label: '店铺名' },
  { key: 'shopId',    label: '店铺ID' },
  { key: 'pushTime',  label: '推送日期' },
  { key: 'buyTime',   label: '取证日期' },
  { key: 'photos',    label: '开箱照片' },
  { key: 'notaryNo',  label: '公证书编号' },
  { key: 'sender',    label: '发货人' },
  { key: 'senderPhone', label: '发货电话' },
  { key: 'senderAddr',  label: '发货地址' },
  { key: 'feeN',      label: '公证费' },
  { key: 'investFee', label: '调查费' },
  { key: 'feeP',      label: '样品费' },
];
let NOTARY_COL_PREFS = {};
try { NOTARY_COL_PREFS = JSON.parse(localStorage.getItem('ip_notary_col_prefs_v1') || '{}') || {}; } catch (e) { NOTARY_COL_PREFS = {}; }
function notaryColPrefsOf() {
  const base = {};
  NOTARY_COL_DEFS.forEach(d => { base[d.key] = true; });
  const saved = NOTARY_COL_PREFS['*'] || {};
  Object.keys(saved).forEach(k => { if (k in base) base[k] = !!saved[k]; });
  return base;
}
function applyNotaryColPrefs() {
  const prefs = notaryColPrefsOf();
  $$('#view-notary thead th[data-col]').forEach(th => {
    const show = prefs[th.dataset.col] !== false;
    th.style.display = show ? '' : 'none';
    $$('#notary-tbody tr').forEach(tr => {
      const td = tr.cells[th.cellIndex];
      if (td) td.style.display = show ? '' : 'none';
    });
  });
}
function openNotaryColPrefs() {
  const prefs = notaryColPrefsOf();
  const items = NOTARY_COL_DEFS.map(d => `
    <label style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;">
      <input type="checkbox" data-colk="${d.key}"${prefs[d.key] ? ' checked' : ''}> ${d.label}</label>`).join('');
  openModal({
    title: '自定义展示列 · 公证阶段', okText: '保存', okClass: 'btn-primary',
    bodyHTML: `<div class="form-hint" style="margin-bottom:8px;">「选择框」「操作」「案件进展」为固定列，不可取消；勾选后自动保存，下次进入公证阶段自动应用。</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;">${items}</div>`,
    onSubmit: () => {
      const saved = {};
      $$('#modal-body [data-colk]').forEach(el => { saved[el.dataset.colk] = el.checked; });
      NOTARY_COL_PREFS['*'] = saved;
      try { localStorage.setItem('ip_notary_col_prefs_v1', JSON.stringify(NOTARY_COL_PREFS)); } catch (e) {}
      applyNotaryColPrefs();
      closeModal();
      toast('展示列已保存', '公证阶段 · 下次进入自动应用', 'success');
    },
  });
}

function emptyRow(colspan, title, desc) {
  return `<tr><td colspan="${colspan}"><div class="empty" style="padding:40px 16px;">
    <div class="empty-title">${esc(title)}</div><div class="empty-desc">${esc(desc)}</div></div></td></tr>`;
}

function filteredCustomers() {
  const q = CUST_FILTER.q.trim().toLowerCase();
  return STATE.customers.filter(c => {
    if (CUST_FILTER.status !== '全部' && c.status !== CUST_FILTER.status) return false;
    if (!q) return true;
    return [c.name, c.credit, c.category].join(' ').toLowerCase().includes(q);
  });
}

function renderCustomers() {
  const list = filteredCustomers();
  // 累计结算金额：从 SETTLEMENTS 按客户名汇总 .amt，保持与结算中心 KPI 一致
  const settledOf = name => SETTLEMENTS.filter(s => s.cust === name).reduce((a, s) => a + s.amt, 0);
  $('#customers-tbody').innerHTML = list.map(c => `
    <tr data-id="${c.id}" onclick="openCustomer('${c.id}')">
      <td><div class="checkbox" style="cursor:pointer;"></div></td>
      <td><span class="case-name">${esc(c.name)}</span><span class="case-id">${esc(c.credit)}</span></td>
      <td data-page-node-id="cust-region-cell"><span class="tag tag-cyan">${esc(c.region || '—')}</span></td>
      <td>${esc(c.category)}</td>
      <td class="num">${c.cases}</td>
      <td class="num">${wan(settledOf(c.name))}</td>
      <td class="num">${esc(c.recovered)}</td>
      <td><div style="display:flex;align-items:center;gap:8px;">
        <div class="progress-track" style="width:56px;"><div class="progress-bar ${c.rate >= 45 ? 'success' : (c.rate > 0 ? 'warning' : '')}" style="width:${c.rate}%"></div></div>
        <span class="num-mono" style="font-size:12px;">${c.rate}%</span></div></td>
      <td>${esc(c.settle)}</td>
      <td><span class="pill ${c.statusClass}">${esc(c.status)}</span></td>
      <td style="color:var(--color-ink-tertiary);">${esc(c.updated)}</td>
    </tr>`).join('') || emptyRow(11, '没有匹配的客户', '换个关键词或清除筛选试试');
  const cc = $('#customers-count'); if (cc) cc.textContent = list.length;
}


function renderFilterCounts() {
  /* v149 修复：组流程（准备起诉文书 / 准备执行文书）的计数不能拿组名直接比 c.status ——
     组名不是真实状态值，`STATE.cases.filter(c => c.status === '准备起诉文书')` 恒为 0。
     本函数在 renderAll 里排在 renderCaseStageNav **之后**，会把那里算好的 15 覆盖成 0
     （用户 2026-09-14 截图里的「准备起诉文书 0 / 准备执行文书 0」就是这个）。
     统一走 countOf：组名 → 组内各原子阶段求和；其余 → 按状态直数。 */
  const countOf = k => {
    if (k === '全部') return STATE.cases.length;
    const g = groupStageKeys(k);
    if (g.length) return STATE.cases.filter(c => g.includes(c.status)).length;
    return STATE.cases.filter(c => c.status === k).length;
  };
  $$('#case-filters .count[data-c]').forEach(el => { el.textContent = countOf(el.dataset.c); });
  // 阶段计数：侧栏子目录 + 页内阶段条 联动
  $$('.nav-sub-item, .case-stage-tab').forEach(el => {
    const cnt = el.querySelector('.nav-sub-count, .case-stage-count');
    if (!cnt) return;
    const k = el.dataset.status;
    // 线索库 / 公证阶段的二级菜单没有 data-status，不属于案件阶段，别被误刷成 0
    if (k === undefined) return;
    cnt.textContent = countOf(k);
  });
  const m = s => STATE.customers.filter(c => c.status === s).length;
  $$('#cust-filters .filter-pill').forEach(p => {
    const el = p.querySelector('.count');
    if (!el) return;
    const k = p.dataset.status;
    el.textContent = k === '全部' ? STATE.customers.length : m(k);
  });
}

/* ---------- 阶段办理：按 STAGES 配置渲染表单，提交后流转 ---------- */
/* ---------- 补充被告（案件待匹配阶段前置动作，可一次录入多条） ---------- */
// 单条被告行：被告类型切换时联动显示「自然人：姓名+身份证号」/「法人/个体：单位名称+统一社会信用代码」
function defendantRowHTML(i) {
  return `
    <div class="df-row" style="border:1px solid var(--color-hairline);border-radius:8px;padding:12px;margin-bottom:12px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <div style="font-size:12px;font-weight:600;color:var(--color-ink-muted);">被告 <span class="df-idx">${i + 1}</span></div>
        <button type="button" class="btn btn-ghost btn-sm" onclick="removeDefendantRow(this)">删除</button>
      </div>
      <div class="form-grid">
        <div class="form-field">
          <label class="form-label">被告类型<span class="req">*</span></label>
          <select class="form-select" data-dk="kind" onchange="syncDefendantKind(this)">
            ${DEFENDANT_KINDS.map((k, idx) => `<option${idx === 0 ? ' selected' : ''}>${esc(k)}</option>`).join('')}
          </select>
        </div>
        <div class="form-field" data-for="自然人">
          <label class="form-label">姓名<span class="req">*</span></label>
          <input class="form-input" data-dk="name" placeholder="如：李某某">
        </div>
        <div class="form-field" data-for="法人/个体" style="display:none;">
          <label class="form-label">单位名称<span class="req">*</span></label>
          <input class="form-input" data-dk="org" placeholder="如：广州××百货商行">
        </div>
        <div class="form-field">
          <label class="form-label">联系电话<span class="req">*</span></label>
          <input class="form-input" data-dk="phone" placeholder="如：139****8888">
        </div>
        <div class="form-field" data-for="自然人">
          <label class="form-label">身份证号码<span class="req">*</span></label>
          <input class="form-input" data-dk="idcard" placeholder="如：4401**********1234">
        </div>
        <div class="form-field" data-for="法人/个体" style="display:none;">
          <label class="form-label">统一社会信用代码<span class="req">*</span></label>
          <input class="form-input" data-dk="credit" placeholder="如：91440101MA9******K8">
        </div>
        <div class="form-field full">
          <label class="form-label">住所地<span class="req">*</span></label>
          <input class="form-input" data-dk="addr" placeholder="如：广东省 广州市 白云区 ××路 168 号">
        </div>
      </div>
    </div>`;
}
function syncDefendantKind(sel) {
  const row = sel.closest('.df-row'); if (!row) return;
  const kind = sel.value;
  row.querySelectorAll('[data-for]').forEach(el => { el.style.display = el.dataset.for === kind ? '' : 'none'; });
}
function addDefendantRow() {
  const box = document.getElementById('df-rows'); if (!box) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = defendantRowHTML(box.querySelectorAll('.df-row').length);
  box.appendChild(wrap.firstElementChild);
  renumberDefendantRows();
}
function removeDefendantRow(btn) {
  const box = document.getElementById('df-rows'); if (!box) return;
  const row = btn.closest('.df-row'); if (!row) return;
  if (box.querySelectorAll('.df-row').length <= 1) { toast('至少保留一位被告', '', 'info'); return; }
  row.remove(); renumberDefendantRows();
}
function renumberDefendantRows() {
  const box = document.getElementById('df-rows'); if (!box) return;
  box.querySelectorAll('.df-row').forEach((r, i) => { const s = r.querySelector('.df-idx'); if (s) s.textContent = i + 1; });
}

function supplementDefendants(id) {
  const c = STATE.cases.find(x => x.id === id); if (!c) return;
  openModal({
    title: '补充被告', wide: true,
    okText: '提交', okClass: 'btn-primary',
    bodyHTML: `
      <div class="lead-detail-section">案件待匹配 · 被告信息是「匹配律师」的前置条件</div>
      <div id="df-rows">${defendantRowHTML(0)}</div>
      <button type="button" class="btn btn-secondary btn-sm" onclick="addDefendantRow()">+ 添加被告</button>
      <div class="form-hint">提交后，该案件的推进按钮会变成「匹配律师」。</div>`,
    onSubmit: () => submitSupplementDefendants(id),
  });
}

function submitSupplementDefendants(id) {
  const c = STATE.cases.find(x => x.id === id); if (!c) return false;
  const box = document.getElementById('df-rows'); if (!box) return false;
  const rows = Array.from(box.querySelectorAll('.df-row'));
  const list = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const g = k => { const el = r.querySelector('[data-dk="' + k + '"]'); return el ? String(el.value || '').trim() : ''; };
    const kind = g('kind') || DEFENDANT_KINDS[0];
    const isPerson = kind === DEFENDANT_KINDS[0];
    const name  = isPerson ? g('name') : g('org');
    const idno  = isPerson ? g('idcard') : g('credit');
    const phone = g('phone');
    const addr  = g('addr');
    if (!name)  { toast(`请填写第 ${i + 1} 位被告的${isPerson ? '姓名' : '单位名称'}`, '', 'error'); return false; }
    if (!phone) { toast(`请填写第 ${i + 1} 位被告的联系电话`, '', 'error'); return false; }
    if (!idno)  { toast(`请填写第 ${i + 1} 位被告的${isPerson ? '身份证号码' : '统一社会信用代码'}`, '', 'error'); return false; }
    if (!addr)  { toast(`请填写第 ${i + 1} 位被告的住所地`, '', 'error'); return false; }
    list.push({ kind, name, idno, phone, addr, extra: '' });
  }
  if (!list.length) { toast('请至少补充一位被告', '', 'error'); return false; }
  if (!Array.isArray(c.defendants)) c.defendants = [];
  list.forEach(d => c.defendants.push(d));
  c.updated = '刚刚';
  const names = list.map(d => d.name).join('、');
  pushLog(c, '补充被告', `${names}（共 ${list.length} 位）`);
  pushCaseTimeline(c, `补充被告 ${list.length} 位：${names}`);
  save(); renderCases(); renderCaseDetail(); renderCaseStageNav(); updateNavBadges();
  toast('被告信息已提交', '现在可以「匹配律师」了');
  closeModal();
  return true;
}

function caseStageForm(id) {
  const c = STATE.cases.find(x => x.id === id); if (!c) return;
  const st = STAGES.find(s => s.key === c.status); if (!st) return;
  if (!st.cta) { toast('该阶段无需操作', c.status, 'info'); return; }
  if (!st.fields.length) { advanceCaseStage(id); return; }
  CUR_STAGE_CASE_ID = id;

  const v = k => (c[k] === undefined || c[k] === null) ? '' : c[k];
  const fieldHTML = f => {
    const full = f.full ? ' full' : '';
    const req = f.required ? '<span class="req">*</span>' : '';
    // 执行材料待确认：确认日期默认今天；其余字段未填写时用 dflt 兜底（如律师结算模式 / 分成比例）
    const fv = (st.key === '执行材料待确认' && f.k === 'execConfirmAt' && !v(f.k)) ? today()
      : ((v(f.k) === '' && f.dflt != null) ? f.dflt : v(f.k));
    let input = '';
    if (f.type === 'textarea') input = `<textarea class="form-textarea" data-fk="${f.k}">${esc(fv)}</textarea>`;
    else if (f.type === 'lawyer') input = `<div class="lw-picker"><input class="form-input" data-fk="${f.k}" autocomplete="off" placeholder="输入姓名检索律师库，如：李建国" value="${esc(fv)}" oninput="lawyerMenu(this)" onfocus="lawyerMenu(this)"><div class="lw-menu"></div></div>`;
    else if (f.type === 'select') input = `<select class="form-select" data-fk="${f.k}"${f.onchange ? ` onchange="${f.onchange}"` : ''}>` +
      f.options.map(o => `<option value="${esc(o)}"${String(fv) === String(o) ? ' selected' : ''}>${esc(o)}</option>`).join('') + `</select>`;
    else if (f.type === 'payments') input = paymentsHTML(c);
    else if (f.type === 'refunds') input = refundsHTML(c);
    else if (f.type === 'refunds-ro') input = refundsReadonlyHTML(c);
    else if (f.type === 'image' || f.type === 'file') input = stageUploadHTML(f, fv);
    else if (f.type === 'settleCalc') input = settleCalcHTML(c, f.side || 'cust');
    else input = `<input class="form-input" type="${f.type}" data-fk="${f.k}" value="${esc(fv)}"${f.k === 'closeAmt' ? ' oninput="recalcCustSettle()"' : ''}>`;
    return `<div class="form-field${full}"><label class="form-label">${f.label}${req}</label>${input}`
      + `${f.hint ? `<div class="form-hint">${esc(f.hint)}</div>` : ''}</div>`;
  };

  const isFormal = st.key === '转正式立案';
  const isJudge = st.key === '待判决';   // 判决更新：弹窗按钮统一「提交」，无取消
  const isExecSubmit = st.key === '待申请执行立案';  // 提交执行立案：按钮「提交」，无取消
  const isExecUpdate = st.key === '强制执行中';        // 执行更新：外层按钮「执行更新」，弹窗删除「提交」，仅保留「保存」
  const isExecConfirm = st.key === '执行材料待确认';   // 执行材料确认：外层按钮保持「确认执行材料」，弹窗主按钮「提交」；Escape/遮罩不可关闭
  const isSecond = st.key === '二审';                  // 二审更新：外层按钮「二审更新」，弹窗主按钮「提交」，提交后弹窗选择发回重审/维持原判
  const isExecUp = st.key === '待写执行材料';          // 上传执行材料：外层按钮保持「上传执行材料」，弹窗主按钮「提交」
  const isArchive = st.key === '待归档';               // 归档：外层按钮「归档」，弹窗无主按钮（办理归档已删），仅「保存」落库不流转
  openModal({
    title: (isFormal ? '填写立案信息' : st.cta), wide: true,
    okText: (isArchive || isExecUpdate) ? '' : ((isJudge || isExecSubmit || isExecConfirm || isSecond || isExecUp) ? '提交' : st.cta), okClass: 'btn-primary',
    cancelBtn: !isFormal && !isJudge && !isExecSubmit,
    noEscape: isExecConfirm,
    extraBtns: isFormal ? [
      { label: '保存', onClick: () => { if (submitCaseStage(id, { saveOnly: true }) !== false) closeModal(); } },
      { label: '发起缴费', onClick: () => openPayFeeInit(id) },
    ] : (isExecUpdate || isArchive ? [
      { label: '保存', onClick: () => { if (submitCaseStage(id, { saveOnly: true }) !== false) closeModal(); } },
    ] : null),
    bodyHTML: `
      <div class="form-grid">${st.fields.map(fieldHTML).join('')}</div>
      ${st.key === '待归档' ? '<div class="form-hint">客户结算金额 = 按该客户「结算条件」公式自动计算；律师结算金额 = 按该案「律师协议」（结算模式 / 基础费 / 分成比例）自动计算。两个金额都可在右侧「修改」里调整，鼠标悬停金额可查看计算过程。点击「保存」保存结案 / 付款 / 退费状态信息；案件停留在待归档。</div>' : ''}
      ${st.key === '待判决' ? '<div class="form-hint">上传判决书后自动识别判决金额 / 实缴诉讼费 / 诉讼退费；提交前需二次确认，确认后案件停留「待判决」，可点「二审抉择」选择转执行或进入二审。</div>' : ''}
      ${isExecConfirm ? '<div class="form-hint">请核对并修改执行申请材料内容，确认无误后提交；本弹窗需显式点击「取消」或「提交」才会关闭。</div>' : ''}
      ${isSecond ? '<div class="form-hint">提交后请选择二审裁判结果：发回重审 或 维持原判。</div>' : ''}`,
    onSubmit: () => {
      const r = st.key === '待判决' ? judgeUpdateSubmit(id)
        : isSecond ? secondUpdateSubmit(id)
        : (isArchive || isExecUpdate) ? submitCaseStage(id, { saveOnly: true })
        : submitCaseStage(id);
      if (r !== false) closeModal(); return r;
    },
  });
  // 匹配律师：结算模式选「全风险」时基础费锁定为 0（初始渲染也要同步一次）
  if (st.key === '案件待匹配') syncLawyerMode();
}

/* ---------- 阶段表单：图片 / 文件上传控件（立案截图=图片，证据材料=文件） ---------- */
// 展示层：只读输入框显示已上传文件名 + 上传按钮 + 隐藏 file input；真实文件名写进 data-fk 输入框，随表单一并收集
function stageUploadHTML(f, val) {
  const acc = f.type === 'image' ? ' accept="image/*"' : '';
  return `<div style="display:flex;gap:8px;">
    <input class="form-input" data-fk="${f.k}" data-upload="1" value="${esc(val)}" readonly placeholder="点击「上传」选择${f.type === 'image' ? '图片' : '文件'}">
    <button type="button" class="btn btn-secondary btn-sm" style="white-space:nowrap;" onclick="document.getElementById('sup-${f.k}').click()">上传</button>
    <input type="file" id="sup-${f.k}" style="display:none"${acc} onchange="stageFilePicked(this,'${f.k}')">
  </div>`;
}
function stageFilePicked(inp, k) {
  const file = ((inp.files || [])[0]) || {};
  const name = file.name || '';
  const target = document.querySelector('#modal-body [data-fk="' + k + '"]');
  if (target && name) target.value = name;
  // 判决书：读文本自动识别三个金额字段（mock/不可读文件静默跳过）
  if (k === 'judgeDoc' && name && typeof file.text === 'function') {
    file.text().then(t => { try { judgeDocRecognize(t); } catch (e) {} }).catch(() => {});
  }
}

/* ---------- 待归档「客户 / 律师结算金额」----------
   客户侧按「客户结算条件」公式、律师侧按「律师协议」（结算模式 / 基础费 / 分成比例）各自独立计算。
   两行都带：悬停提示（计算过程）+「修改」按钮（行内展开面板，不套第二层弹窗，避免待归档表单被覆盖）。 */
let CUR_STAGE_CASE_ID = null;
function settleCalcHTML(c, side) {
  const f = settleFigures(c);
  const isCust = side === 'cust';
  const tip = isCust ? f.custTip : f.lawTip;
  return `<div class="settle-calc" data-side="${side}">
    <div style="display:flex;gap:8px;align-items:center;">
      <input class="form-input" data-fk="${isCust ? 'custSettleAmt' : 'lawSettleAmt'}" value="${esc(isCust ? f.custAmt : f.lawAmt)}" readonly title="${esc(tip)}" style="background:var(--color-surface-2);color:var(--color-ink-muted);">
      <button type="button" class="btn btn-secondary btn-sm" style="white-space:nowrap;" title="${esc(tip)}" onclick="toggleSettleEdit('${side}')">修改</button>
    </div>
    <div class="form-hint" data-settle-hint="${side}">${esc(settleCalcLine(f, side))}</div>
    <div class="settle-edit-slot" data-slot="${side}"></div>
  </div>`;
}
/* 结算行下方的计算说明（与 tooltip 同口径） */
function settleCalcLine(f, side) {
  if (side === 'cust') {
    return '= 结案金额 ' + money0(f.amt) + ' × ' + fmtPct(f.cPct) + '% = ' + money0(f.custAuto)
      + (f.custManual ? ' · 已手工调整为 ' + money0(f.custAmt) : '');
  }
  const m = f.law.mode;
  const body = m === '固定费用' ? '= 固定费用 ' + money0(f.law.base)
    : (m === '半风险' ? '= 基础费 ' + money0(f.law.base) + ' + 结案金额 ' + money0(f.amt) + ' × ' + fmtPct(f.law.split) + '%'
      : '= 结案金额 ' + money0(f.amt) + ' × ' + fmtPct(f.law.split) + '%');
  return m + '：' + body + ' = ' + money0(f.lawAuto) + (f.lawManual ? ' · 已手工调整为 ' + money0(f.lawAmt) : '');
}
/* 结案金额改动 → 两个结算金额实时重算（手工调整过的保留手工值） */
function recalcCustSettle() {
  const body = document.getElementById('modal-body'); if (!body) return;
  const c = (STATE.cases || []).find(x => x.id === CUR_STAGE_CASE_ID); if (!c) return;
  const amtEl = body.querySelector('[data-fk="closeAmt"]');
  const f = settleFigures(c, amtEl ? amtEl.value : '');
  ['cust', 'law'].forEach(side => { refreshSettleRow(side, c, f); });
}
/* 刷新待归档弹窗里的某一行结算金额（值 / tooltip / 计算说明） */
function refreshSettleRow(side, c, fig) {
  const row = document.querySelector('#modal-body .settle-calc[data-side="' + side + '"]');
  if (!row) return;
  const f = fig || settleFigures(c);
  const box = row.querySelector('[data-fk]');
  const tip = side === 'cust' ? f.custTip : f.lawTip;
  if (box) { box.value = String(side === 'cust' ? f.custAmt : f.lawAmt); box.title = tip; }
  const hint = row.querySelector('[data-settle-hint]');
  if (hint) hint.textContent = settleCalcLine(f, side);
}

/* ---------- 一审信息卡：调档文件 多文件上传 ---------- */
function uploadFilingDocs(caseId) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.multiple = true;
  inp.onchange = function() {
    const c = (STATE.cases || []).find(x => x.id === caseId);
    if (!c) return;
    c.filingDocs = Array.isArray(c.filingDocs) ? c.filingDocs : [];
    Array.from(inp.files || []).forEach(f => {
      if (f && f.name && !c.filingDocs.includes(f.name)) c.filingDocs.push(f.name);
    });
    if (typeof renderCaseDetail === 'function') renderCaseDetail();
  };
  inp.click();
}

/* ---------- 一审信息卡：起诉状（v145 起支持多文件） ---------- */
// 主存 c.authDocs（数组）；旧的单值 c.authDoc 自动兼容。返回去重后的文件名数组。
function authDocsOf(c) {
  c = c || {};
  const arr = Array.isArray(c.authDocs) ? c.authDocs.filter(Boolean) : [];
  if (arr.length) return arr;
  var s = String(c.authDoc || '').trim();
  return s ? s.split(/[、,，]/).map(x => x.trim()).filter(Boolean) : [];
}
// 字段「清除」按钮：清空同组 file 字段的只读框（保存时按空值回写 → 即删除）
function clearFileField(key) {
  const el = document.querySelector('#modal-body [data-k="' + key + '"]');
  if (el) el.value = '';
}

/* ---------- 待判决「判决更新」：诉讼退费多笔编辑（含退费状态） ---------- */
const REFUND_STATUSES = ['待退', '已提交', '已退未结算', '已结算', '已回款'];
function refundRowHTML(r) {
  r = r || {};
  const stOpts = REFUND_STATUSES.map(s => `<option${(r.status || '待退') === s ? ' selected' : ''}>${s}</option>`).join('');
  return `<div class="refund-row" style="display:grid;grid-template-columns:1fr 1.2fr 1fr auto;gap:6px;margin-bottom:6px;">
    <select class="form-select" data-rk="from">
      <option${r.from === '被告' ? ' selected' : ''}>被告</option>
      <option${r.from === '法院' ? ' selected' : ''}>法院</option>
    </select>
    <input class="form-input" placeholder="退费金额（元）" data-rk="amt" value="${r.amt || ''}" oninput="updateRefundTotal()">
    <select class="form-select" data-rk="status">${stOpts}</select>
    <button type="button" class="btn btn-ghost btn-sm" onclick="this.closest('.refund-row').remove();updateRefundTotal();">删除</button>
  </div>`;
}
function refundsHTML(c) {
  const list = Array.isArray(c.refunds) ? c.refunds : [];
  return `<div id="refund-rows">${list.map(r => refundRowHTML(r)).join('')}</div>
    <button type="button" class="btn btn-secondary btn-sm" onclick="addRefundRow()">+ 增加一笔退费</button>
    <div style="margin-top:8px;font-size:13px;">退费合计：<b id="refund-total">${money0(list.reduce((a, r) => a + (Number(r.amt) || 0), 0))}</b></div>`;
}
function addRefundRow(r) {
  const box = document.getElementById('refund-rows'); if (!box) return;
  box.insertAdjacentHTML('beforeend', refundRowHTML(r || {}));
}
function updateRefundTotal() {
  const box = document.getElementById('refund-rows'); if (!box) return;
  let t = 0;
  box.querySelectorAll('.refund-row').forEach(row => { t += Number((row.querySelector('[data-rk="amt"]') || {}).value || 0) || 0; });
  const el = document.getElementById('refund-total'); if (el) el.textContent = money0(t);
}
function collectRefunds(scope) {
  const box = (scope || document).querySelector('#refund-rows'); const rows = [];
  if (box) box.querySelectorAll('.refund-row').forEach(row => {
    const from = ((row.querySelector('[data-rk="from"]') || {}).value) || '法院';
    const amt = Number((row.querySelector('[data-rk="amt"]') || {}).value || 0) || 0;
    const status = ((row.querySelector('[data-rk="status"]') || {}).value) || '待退';
    if (amt > 0) rows.push({ from, amt, status });
  });
  return rows;
}

/* ---------- 待归档：诉讼退费只读展示（仅状态可修改） ---------- */
function refundsReadonlyHTML(c) {
  const list = Array.isArray(c.refunds) ? c.refunds : [];
  if (!list.length) return '<div style="color:var(--color-ink-muted);font-size:13px;">无退费记录（判决更新环节未登记诉讼退费）</div>';
  return '<div id="refund-ro-rows">' + list.map(r => `
    <div class="refund-ro-row" style="display:grid;grid-template-columns:1fr 1.2fr 1fr;gap:6px;margin-bottom:6px;">
      <input class="form-input" value="${esc(r.from || '法院')}" readonly title="退费方（只读）">
      <input class="form-input" value="${esc(String(r.amt || 0))}" readonly title="退费金额（只读）">
      <select class="form-select" data-rk="status" title="退费状态（可修改）">${REFUND_STATUSES.map(s => `<option${(r.status || '待退') === s ? ' selected' : ''}>${s}</option>`).join('')}</select>
    </div>`).join('') + '</div>';
}

/* ---------- 判决书上传：文本正则识别判决金额 / 实缴诉讼费 / 诉讼退费 ---------- */
function judgeDocRecognize(text) {
  const body = document.getElementById('modal-body'); if (!body || !text) return [];
  const grab = re => {
    const m = String(text).match(re); if (!m) return null;
    let n = Number(String(m[1]).replace(/[,，]/g, ''));
    if (m[2] === '万') n *= 10000;
    return n > 0 ? n : null;
  };
  const amt = grab(/(?:判决金额|判决赔偿|赔偿金额)[^0-9]{0,12}([\d,，]+(?:\.\d+)?)\s*(万?)元/);
  const fee = grab(/(?:实缴诉讼费|案件受理费|(?<!退)诉讼费用?)[^0-9]{0,12}([\d,，]+(?:\.\d+)?)\s*(万?)元/);
  const ref = grab(/(?:退还|退回|退费)(?:诉讼费)?[^0-9]{0,12}([\d,，]+(?:\.\d+)?)\s*(万?)元/);
  const hits = [];
  if (amt !== null) { const el = body.querySelector('[data-fk="judgeAmt"]'); if (el) el.value = amt; hits.push('判决金额 ' + money0(amt)); }
  if (fee !== null) { const el = body.querySelector('[data-fk="paidFee"]'); if (el) el.value = fee; hits.push('实缴诉讼费 ' + money0(fee)); }
  if (ref !== null) { addRefundRow({ from: '法院', amt: ref }); hits.push('诉讼退费 ' + money0(ref)); }
  if (hits.length) toast('判决书已识别', hits.join(' · '));
  else toast('未识别到金额', '判决书中未找到可识别金额，请人工核对填写', 'info');
  return hits;
}

/* ---------- 待判决「判决更新」提交：先收值，再二次确认 ---------- */
function judgeUpdateSubmit(id) {
  const c = STATE.cases.find(x => x.id === id); if (!c) return false;
  const body = document.getElementById('modal-body') || document;
  const g = k => { const el = body.querySelector('[data-fk="' + k + '"]'); return el ? String(el.value || '').trim() : ''; };
  if (!g('judgeGotAt')) { toast('请填写收到判决日期', '', 'error'); return false; }
  if (!g('judgeDoc')) { toast('请上传判决书', '判决书为必填项', 'error'); return false; }

  const val = {
    judgeGotAt: g('judgeGotAt'),
    judgeAmt: Number(g('judgeAmt')) || 0,
    paidFee: Number(g('paidFee')) || 0,
    judgeDoc: g('judgeDoc'),
    refunds: collectRefunds(body),
  };
  closeModal();

  openModal({
    title: '判决更新确认', okText: '确认提交', cancelText: '返回修改', cancelBtn: true, wide: true,
    bodyHTML: `
      <div class="lead-detail-section">请核对判决信息，确认后案件停留「待判决」，可点「二审抉择」选择转执行或进入二审</div>
      <div class="form-grid">
        <div class="form-field"><label class="form-label">收到判决日期</label><input class="form-input" value="${esc(val.judgeGotAt)}" readonly></div>
        <div class="form-field"><label class="form-label">判决金额</label><input class="form-input" value="${money0(val.judgeAmt)}" readonly></div>
        <div class="form-field"><label class="form-label">实缴诉讼费</label><input class="form-input" value="${money0(val.paidFee)}" readonly></div>
        <div class="form-field"><label class="form-label">判决书</label><input class="form-input" value="${esc(val.judgeDoc || '—')}" readonly></div>
        <div class="form-field full"><label class="form-label">诉讼退费（${val.refunds.length} 笔）</label>
          ${val.refunds.length ? val.refunds.map(r => `<div>退费方 ${esc(r.from)} · ${money0(r.amt)} · ${esc(r.status || '待退')}</div>`).join('') : '<div style="color:var(--color-ink-muted);">无退费</div>'}
        </div>
      </div>`,
    onSubmit: () => {
      Object.assign(c, val);
      c.refundTotal = val.refunds.reduce((a, r) => a + (Number(r.amt) || 0), 0);
      c.updated = '刚刚';
      pushCaseTimeline(c, `判决更新：判决金额 ${money0(val.judgeAmt)} · 实缴诉讼费 ${money0(val.paidFee)}` + (c.refundTotal ? ` · 退费 ${money0(c.refundTotal)}` : ''));
      c.judgeReady = true;   // 停留「待判决」，CTA 变为「二审抉择」
      renderCaseStageNav(); renderCases(); updateNavBadges(); save();
      closeModal();
      toast('判决已登记', '案件停留「待判决」，可点「二审抉择」选择后续路径');
    },
  });
  return false; // 本函数自管弹窗生命周期，外层不再 closeModal
}

/* ---------- 二审抉择（待判决 judgeReady 后）：转执行 / 进入二审 ---------- */
function openSecondInstanceChoice(id) {
  const c = STATE.cases.find(x => x.id === id); if (!c) return;
  openModal({
    title: '二审抉择', wide: true,
    okText: '', cancelBtn: true,
    bodyHTML: `
      <div class="lead-detail-section">判决已登记 · 请选择后续路径</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div style="border:1px solid var(--color-line);border-radius:10px;padding:16px;">
          <div style="font-weight:600;margin-bottom:6px;">转执行</div>
          <div style="color:var(--color-ink-muted);font-size:13px;line-height:1.6;">判决生效不提起上诉，直接流转「待写执行材料」，启动强制执行流程。</div>
          <button class="btn btn-primary" style="margin-top:12px;" onclick="secondInstanceToExec('${esc(c.id)}')">转执行</button>
        </div>
        <div style="border:1px solid var(--color-line);border-radius:10px;padding:16px;">
          <div style="font-weight:600;margin-bottom:6px;">进入二审</div>
          <div style="color:var(--color-ink-muted);font-size:13px;line-height:1.6;">一方提起上诉，选择「上诉人」后流转「二审」阶段。</div>
          <button class="btn btn-secondary" style="margin-top:12px;" onclick="secondInstanceEnterForm('${esc(c.id)}')">进入二审</button>
        </div>
      </div>`,
  });
}
// 转执行：待判决 → 待写执行材料
function secondInstanceToExec(id) {
  const c = STATE.cases.find(x => x.id === id); if (!c) return;
  c.status = '待写执行材料'; c.stageCls = 'pill-info'; c.judgeReady = false;
  c.updated = today();
  pushCaseTimeline(c, '二审抉择：转执行 → 待写执行材料');
  renderCaseStageNav(); renderCases(); updateNavBadges(); save();
  closeModal();
  toast('已转执行', '待判决 → 待写执行材料');
}
// v32 上诉人候选：原告为我方；被告取案件已录入的被告名单（可能多位，可单选/多选）
function appellantDefendantsOf(c) {
  const ds = (c && Array.isArray(c.defendants)) ? c.defendants.filter(d => d && d.name) : [];
  return ds.map(d => ({ name: String(d.name) }));
}
// 上诉人类型切换：选「被告」时展开被告勾选列表
function syncAppellantRole(sel) {
  const wrap = document.getElementById('si-def-wrap'); if (!wrap) return;
  wrap.style.display = sel && sel.value === '被告' ? '' : 'none';
}
// 进入二审：选择必填「上诉人」（原告 / 被告，被告可多选）→ 流转二审
function secondInstanceEnterForm(id) {
  const c = STATE.cases.find(x => x.id === id); if (!c) return;
  const defs = appellantDefendantsOf(c);
  const app = (c.secondInstanceAppellants && typeof c.secondInstanceAppellants === 'object') ? c.secondInstanceAppellants : {};
  const prevNames = Array.isArray(app.names) ? app.names.map(String) : [];
  const role0 = app.role === 'defendant' ? '被告' : '原告';
  const defItems = defs.length
    ? defs.map(d => `
        <label style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--color-hairline);border-radius:8px;cursor:pointer;">
          <input type="checkbox" class="si-def" value="${esc(d.name)}"${prevNames.indexOf(d.name) >= 0 ? ' checked' : ''}>
          <span>${esc(d.name)}</span>
        </label>`).join('')
    : '<div class="form-hint">该案件暂无被告信息，请先补充被告后再选择。</div>';
  openModal({
    title: '进入二审', wide: true, okText: '进入二审',
    bodyHTML: `
      <div class="lead-detail-section">选择上诉人后，案件流转「二审」</div>
      <div class="form-grid">
        <div class="form-field full">
          <label class="form-label">上诉人<span class="req">*</span></label>
          <select class="form-select" id="si-role" onchange="syncAppellantRole(this)">
            <option value="原告"${role0 === '原告' ? ' selected' : ''}>原告（我方）</option>
            <option value="被告"${role0 === '被告' ? ' selected' : ''}>被告</option>
          </select>
        </div>
        <div class="form-field full" id="si-def-wrap" style="display:${role0 === '被告' ? '' : 'none'};">
          <label class="form-label">选择被告<span class="req">*</span>（可多选）</label>
          <div id="si-def-list" style="display:grid;gap:8px;">${defItems}</div>
        </div>
      </div>`,
    onSubmit: () => {
      const roleEl = document.getElementById('si-role');
      const role = roleEl ? roleEl.value : '原告';
      let names = [];
      if (role === '被告') {
        names = $$('#si-def-list input.si-def').filter(el => el.checked).map(el => el.value);
        if (!names.length) { toast('请选择被告', '至少选择一位，可多选', 'error'); return false; }
      }
      const by = role === '被告' ? ('被告：' + names.join('、')) : '原告（我方）';
      c.secondInstanceBy = by;
      c.secondInstanceAppellants = { role: role === '被告' ? 'defendant' : 'plaintiff', names };
      c.status = '二审'; c.stageCls = 'pill-warning'; c.judgeReady = false;
      c.updated = today();
      pushCaseTimeline(c, `二审抉择：进入二审（上诉人：${by}）`);
      renderCaseStageNav(); renderCases(); updateNavBadges(); save();
      closeModal();
      toast('已进入二审', `上诉人：${by} · 待判决 → 二审`);
      return true;
    },
  });
}

/* ---------- 二审「二审更新」提交：先收值，再弹窗选择 发回重审 / 维持原判 ---------- */
let SECOND_UPDATE_PENDING = {};   // 案件id -> 二审更新表单收集值（选择分支时取用）
function secondUpdateSubmit(id) {
  const c = STATE.cases.find(x => x.id === id); if (!c) return false;
  const st = STAGES.find(s => s.key === c.status); if (!st) return false;
  const body = document.getElementById('modal-body') || document;
  const val = {};
  st.fields.forEach(f => {
    const el = body.querySelector('[data-fk="' + f.k + '"]');
    if (!el) return;
    let v = el.value;
    if (f.type === 'number') v = Number(v) || 0;
    val[f.k] = String(v ?? '').trim();
  });
  SECOND_UPDATE_PENDING[id] = val;
  closeModal();
  openSecondUpdateChoice(id);
  return false; // 本函数自管弹窗生命周期，外层不再 closeModal
}

function openSecondUpdateChoice(id) {
  const c = STATE.cases.find(x => x.id === id); if (!c) return;
  openModal({
    title: '二审更新', wide: true,
    okText: '', cancelBtn: true,
    bodyHTML: `
      <div class="lead-detail-section">二审信息已更新 · 请选择裁判结果</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div style="border:1px solid var(--color-line);border-radius:10px;padding:16px;">
          <div style="font-weight:600;margin-bottom:6px;">发回重审</div>
          <div style="color:var(--color-ink-muted);font-size:13px;line-height:1.6;">二审裁定发回重审，案件流转「待正式立案」，重新走立案流程。</div>
          <button class="btn btn-primary" style="margin-top:12px;" onclick="secondUpdateRetrial('${esc(c.id)}')">发回重审</button>
        </div>
        <div style="border:1px solid var(--color-line);border-radius:10px;padding:16px;">
          <div style="font-weight:600;margin-bottom:6px;">维持原判</div>
          <div style="color:var(--color-ink-muted);font-size:13px;line-height:1.6;">二审维持原判，上传二审判决书后流转「待写执行材料」。</div>
          <button class="btn btn-secondary" style="margin-top:12px;" onclick="secondUpdateAffirmForm('${esc(c.id)}')">维持原判</button>
        </div>
      </div>`,
  });
}

// 收集值落库 + 二审开庭日历同步（两条分支共用）
function secondApplyVals(c, val) {
  Object.keys(val || {}).forEach(k => { c[k] = val[k]; });
  if (String(c.secondHearingAt || '').slice(0, 10) && String(c.secondHearingAt).slice(0, 10) !== '—') syncSecondHearingCalendar(c);
}

// 发回重审：二审 → 待正式立案（转正式立案）
function secondUpdateRetrial(id) {
  const c = STATE.cases.find(x => x.id === id); if (!c) return;
  const val = SECOND_UPDATE_PENDING[id] || {}; delete SECOND_UPDATE_PENDING[id];
  secondApplyVals(c, val);
  c.status = '转正式立案'; c.stageCls = 'pill-warning';
  c.updated = today();
  pushCaseTimeline(c, '二审更新：发回重审 → 待正式立案（重新立案）');
  renderCaseStageNav(); renderCases(); updateNavBadges(); save();
  closeModal();
  toast('已发回重审', '二审 → 待正式立案');
}

// 维持原判：必填上传二审判决书 → 待写执行材料
function secondUpdateAffirmForm(id) {
  const c = STATE.cases.find(x => x.id === id); if (!c) return;
  openModal({
    title: '维持原判', wide: true, okText: '提交',
    bodyHTML: `
      <div class="lead-detail-section">上传二审判决书后，案件流转「待写执行材料」</div>
      <div class="form-grid">
        <div class="form-field full">
          <label class="form-label">二审判决书<span class="req">*</span></label>
          ${stageUploadHTML({ k: 'secondJudgeDoc', type: 'file' }, c.secondJudgeDoc || '')}
        </div>
      </div>`,
    onSubmit: () => {
      const body = document.getElementById('modal-body') || document;
      const doc = String(((body.querySelector('[data-fk="secondJudgeDoc"]') || {}).value) || '').trim();
      if (!doc) { toast('请上传二审判决书', '维持原判需上传二审判决书', 'error'); return false; }
      const val = SECOND_UPDATE_PENDING[id] || {}; delete SECOND_UPDATE_PENDING[id];
      secondApplyVals(c, val);
      c.secondJudgeDoc = doc;
      c.status = '待写执行材料'; c.stageCls = 'pill-info';
      c.updated = today();
      pushCaseTimeline(c, '二审更新：维持原判 → 待写执行材料（二审判决书已归档）');
      renderCaseStageNav(); renderCases(); updateNavBadges(); save();
      closeModal();
      toast('已维持原判', '二审 → 待写执行材料');
      return true;
    },
  });
}

// 收款截图：单入口控件 —— 未上传时只有一个「上传」按钮；已上传时按钮直接显示文件名，点击可重选
// v125：原来「空只读框（placeholder 未上传）+ 上传按钮」并排两个控件，未上传时空框纯占列宽，合并成一个按钮即可省出空间
// v124：列名由「付款凭证」统一为「收款截图」——数据键仍是 proof，老档案与文件管理清单不受影响
const payProofUploadHTML = p => {
  const name = String((p && p.proof) || '');
  return `
      <div class="pay-proof" data-pay-proof>
        <input type="hidden" data-pk="proof" value="${esc(name)}">
        <button type="button" class="btn btn-sm pay-proof-btn${name ? ' has-file' : ''}" data-pay-proof-btn
          title="${name ? esc(name + ' · 点击重新选择') : '上传收款截图'}"
          onclick="this.closest('.pay-row').querySelector('[data-proof-file]').click()">
          <span class="pay-proof-name">${name ? esc(name) : '上传'}</span>
        </button>
        <input type="file" data-proof-file style="display:none" onchange="payProofPicked(this)">
      </div>`;
};
/* 选完文件：文件名写进隐藏域（表单收集仍走 [data-pk="proof"]），按钮文案立刻切成文件名 */
function payProofPicked(input) {
  const row = input && input.closest ? input.closest('.pay-row') : null; if (!row) return;
  const f = (input.files || [])[0]; if (!f || !f.name) return;
  const hid = row.querySelector('[data-pay-proof] [data-pk="proof"]');
  if (hid) hid.value = f.name;
  syncPayProofUI(row);
  toast('收款截图已选择', f.name, 'success');
}
/* 按钮文案 / 提示词按「当前有没有文件」同步（只改这一格，不重渲染整表，免得打断用户正在填的其它格子） */
function syncPayProofUI(row) {
  if (!row || !row.querySelector) return;
  const wrap = row.querySelector('[data-pay-proof]'); if (!wrap) return;
  const hid = wrap.querySelector('[data-pk="proof"]');
  const name = hid ? String(hid.value || '') : '';
  const btn = wrap.querySelector('[data-pay-proof-btn]');
  const nm = wrap.querySelector('.pay-proof-name');
  if (nm) nm.textContent = name || '上传';
  if (btn) {
    btn.classList.toggle('has-file', !!name);
    btn.title = name ? (name + ' · 点击重新选择') : '上传收款截图';
  }
}
/* 「一次性付款」→ 付款记录只能填 1 条。两个入口共用同一套联动：
     待归档阶段表单：#pay-rows / #pay-add-btn / [data-fk="payType"]
     批量归档弹窗：#arch-pay-rows / #arch-add-pay-btn / #arch-payType
   初始渲染只按当前类型决定按钮是否可用、**不裁已有行**（否则老档案里已有多条会被静默丢掉）；
   用户主动把类型改成「一次性付款」时才裁掉多余行（保留第一条）。 */
const PAY_ONE_HINT = '付款类型为「一次性付款」时，付款记录只能填 1 条；如需多笔请改为「分期付款」';
function applyPayRowLimit(selEl, boxEl, btnEl, trim) {
  if (!boxEl) return;
  const one = !!selEl && selEl.value === '一次性付款';
  if (one && trim) {
    Array.from(boxEl.querySelectorAll('.pay-row')).slice(1).forEach(r => r.remove());
    renumberPayRows(boxEl);
    updatePayTotal();
  }
  if (btnEl) { btnEl.disabled = one; btnEl.title = one ? PAY_ONE_HINT : ''; }
}
function syncPayRowLimit(kind, trim) {
  const arch = kind === 'arch';
  applyPayRowLimit(
    arch ? document.getElementById('arch-payType') : document.querySelector('#modal-body [data-fk="payType"]'),
    document.getElementById(arch ? 'arch-pay-rows' : 'pay-rows'),
    document.getElementById(arch ? 'arch-add-pay-btn' : 'pay-add-btn'),
    trim
  );
}
/* ---------- v124：付款记录统一字段 ----------
   三处列序与列名完全一致：序号 / 付款日期 / 付款金额 / 付款人 / 收款人 / 收款截图
     ① 待归档阶段表单  #pay-rows      （本函数）
     ② 批量归档弹窗    #arch-pay-rows （archPayRowHTML 复用 payRowHTML）
     ③ 案件详情结案卡  renderClosePanel 的只读表（同列序，无操作列）
   「收款人」由原来的下拉（原告 / 律师 / 平台）改为手填输入。
   ⚠ 表头 .pay-head 刻意不带 .pay-row 类 —— 否则会被「一次性付款只允许 1 条」的行数统计当成一行。 */
function payHeadHTML() {
  return `<div class="pay-head pay-grid">
    <span>序号</span><span>付款日期</span><span>付款金额</span><span>付款人</span><span>收款人</span><span>收款截图</span><span></span></div>`;
}
function payRowHTML(p, idx) {
  p = p || {};
  return `<div class="pay-row pay-grid">
    <span class="pay-idx">${idx || ''}</span>
    <input class="form-input" type="date" title="付款日期" data-pk="date" value="${esc(p.date || '')}">
    <input class="form-input" title="付款金额（元）" data-pk="amt" value="${p.amt || ''}">
    <input class="form-input" title="付款人" data-pk="payer" value="${esc(p.payer || '')}">
    <input class="form-input" title="收款人（手填）" data-pk="payee" value="${esc(p.payee || '')}">
    ${payProofUploadHTML(p)}
    <button type="button" class="btn btn-ghost btn-sm btn-icon" onclick="removePayRow(this)" title="删除本行">×</button>
  </div>`;
}
// 序号列随增删实时重排（渲染时已按索引写入，这里负责增行 / 删行 / 裁行后的同步）
function renumberPayRows(box) {
  if (!box || !box.querySelectorAll) return;
  box.querySelectorAll('.pay-row').forEach((r, i) => {
    const el = r.querySelector('.pay-idx'); if (el) el.textContent = String(i + 1);
  });
}
function removePayRow(btn) {
  const row = btn && btn.closest ? btn.closest('.pay-row') : null; if (!row) return;
  const box = row.closest('#pay-rows, #arch-pay-rows');
  row.remove();
  if (box) renumberPayRows(box);
  if (box && box.id === 'pay-rows') updatePayTotal();
}
function paymentsHTML(c) {
  const list = Array.isArray(c.payments) ? c.payments : [];
  const rows = list.length ? list : [{}];
  return `<div id="pay-rows">` + payHeadHTML() + rows.map((p, i) => payRowHTML(p, i + 1)).join('') + `</div>
    <button type="button" class="btn btn-secondary btn-sm" id="pay-add-btn" onclick="addPayRow()"${String(c.payType || '一次性付款') === '一次性付款' ? ` disabled title="${PAY_ONE_HINT}"` : ''}>+ 增加一笔</button>
    <div style="margin-top:8px;font-size:13px;">已付款合计：<b id="pay-total">${money0(list.reduce((a, p) => a + (Number(p.amt) || 0), 0))}</b></div>`;
}
function addPayRow() {
  const box = document.getElementById('pay-rows'); if (!box) return;
  const sel = document.querySelector('#modal-body [data-fk="payType"]');
  if (sel && sel.value === '一次性付款') { toast('「一次性付款」只能填 1 条付款记录', PAY_ONE_HINT, 'info'); return; }
  box.insertAdjacentHTML('beforeend', payRowHTML({}));
  renumberPayRows(box);
}
function updatePayTotal() {
  const box = document.getElementById('pay-rows'); if (!box) return;
  let t = 0;
  box.querySelectorAll('.pay-row').forEach(r => { t += Number((r.querySelector('[data-pk="amt"]') || {}).value || 0); });
  const el = document.getElementById('pay-total'); if (el) el.textContent = money0(t);
}

function submitCaseStage(id, opts = {}) {
  const c = STATE.cases.find(x => x.id === id); if (!c) return false;
  const st = STAGES.find(s => s.key === c.status); if (!st) return false;
  const body = document.getElementById('modal-body') || document;

  // 必填校验（上传类字段 value = 文件名，同样走该检查）
  for (const f of st.fields) {
    if (!f.required || f.type === 'payments' || f.type === 'refunds' || f.type === 'refunds-ro') continue;
    const el = body.querySelector('[data-fk="' + f.k + '"]');
    if (!el || !String(el.value || '').trim()) { toast('请填写' + f.label.replace(/（.*?）/g, ''), '', 'error'); return false; }
  }

  // 收集字段
  st.fields.forEach(f => {
    if (f.type === 'payments') {
      const box = body.querySelector('#pay-rows');
      const rows = [];
      if (box) box.querySelectorAll('.pay-row').forEach(r => {
        const g = k => { const el = r.querySelector('[data-pk="' + k + '"]'); return el ? el.value.trim() : ''; };
        // v124：收款人由下拉改手填 → 与日期 / 付款人一起参与「是否算一笔」的判定，避免只填收款人被静默丢弃
        if (g('amt') || g('date') || g('payer') || g('payee') || g('proof')) rows.push({ amt: Number(g('amt')) || 0, date: g('date'), payer: g('payer'), payee: g('payee'), proof: g('proof') });
      });
      c.payments = rows;
      c.paidTotal = rows.reduce((a, p) => a + (Number(p.amt) || 0), 0);
      return;
    }
    if (f.type === 'refunds') {
      c.refunds = collectRefunds(body);
      c.refundTotal = c.refunds.reduce((a, r) => a + (Number(r.amt) || 0), 0);
      return;
    }
    if (f.type === 'refunds-ro') {
      // 待归档：诉讼退费只读展示，仅把修改后的状态写回 c.refunds
      const box = body.querySelector('#refund-ro-rows');
      if (box && Array.isArray(c.refunds)) {
        box.querySelectorAll('.refund-ro-row').forEach((row, i) => {
          const stEl = row.querySelector('[data-rk="status"]');
          if (stEl && c.refunds[i]) c.refunds[i].status = stEl.value;
        });
      }
      return;
    }
    // 客户结算金额：不接受 DOM 里的只读值，统一在字段收集完后按结算条件重算（见下方）
    if (f.type === 'settleCalc') return;
    const el = body.querySelector('[data-fk="' + f.k + '"]');
    if (!el) return;
    let val = el.value;
    if (f.type === 'number') val = Number(val) || 0;
    c[f.k] = val;
  });

  // 待归档：客户结算金额（客户公式）/ 律师结算金额（律师协议）各自派生落库，手工调整过的保留手工值
  if (st.fields.some(f => f.type === 'settleCalc')) {
    const fig = settleFigures(c);
    c.custSettleAmt = fig.custAmt; c.custSettleManual = fig.custManual;
    c.lawSettleAmt  = fig.lawAmt;  c.lawSettleManual  = fig.lawManual;
  }

  // 开庭日期填写后：同步日历「开庭」事件 + 设定次日自动流转待判决
  if (String(c.hearingAt || '').slice(0, 10) && String(c.hearingAt).slice(0, 10) !== '—') syncHearingCalendar(c);
  // 二审开庭日期填写后：同步日历「二审开庭」事件
  if (String(c.secondHearingAt || '').slice(0, 10) && String(c.secondHearingAt).slice(0, 10) !== '—') syncSecondHearingCalendar(c);

  // 「保存」：只落库不流转（转正式立案 / 强制执行中 / 待归档阶段）
  if (opts.saveOnly) {
    c.updated = '刚刚';
    const svMsg = st.key === '强制执行中' ? '执行更新已保存（未提交，案件仍在强制执行中）'
      : st.key === '待归档' ? '归档信息已保存（案件仍在待归档）'
      : '立案信息已保存（未提交，案件仍在转正式立案）';
    pushCaseTimeline(c, svMsg);
    renderCaseStageNav(); renderCases(); updateNavBadges(); save();
    toast('已保存', st.key === '强制执行中' ? '执行更新已记录，可继续编辑或「执行更新」'
      : st.key === '待归档' ? '归档信息已记录，案件停留在待归档'
      : '立案信息已记录，可继续编辑或「发起缴费」');
    return true;
  }

  // 分支逻辑
  if (st.key === '待判决') {
    pushCaseTimeline(c, `判决更新：判决金额 ${money0(c.judgeAmt || 0)} · 实缴诉讼费 ${money0(c.paidFee || 0)}` + (c.refundTotal ? ` · 退费 ${money0(c.refundTotal)}` : ''));
    c.judgeReady = true;   // 停留「待判决」，CTA 变为「二审抉择」
    renderCaseStageNav(); renderCases(); updateNavBadges(); save();
    toast('判决已登记', '案件停留「待判决」，可点「二审抉择」选择后续路径');
    return true;
  }

  if (st.key === '待归档') {
    if (c.needSettle === '是') {
      c.status = '已归档'; c.stageCls = 'pill-success';
      c.archiveAt = today(); c.archiveReason = '结案并完成结算';
      pushCaseTimeline(c, `结案结算：结案金额 ${money0(c.closeAmt)} · 已付款 ${money0(c.paidTotal)}`);
      renderCaseStageNav(); renderCases(); updateNavBadges(); save();
      toast('已流转到结算中心', `已付款合计 ${money0(c.paidTotal)}`);
      if (typeof showView === 'function') showView('settlement');
      return true;
    }
    // 否 → 发起归档动作（该弹窗复用同一 #modal-root，返回 false 让上层不执行 closeModal）
    openCaseArchive(id);
    return false;
  }

  advanceCaseStage(id);
  return true;
}

// 开庭日期同步：写日历「开庭」事件（autoCourt 标记，可反复修改覆盖）+ 次日自动流转待判决
function syncHearingCalendar(c) {
  const d = String(c.hearingAt || '').slice(0, 10);
  if (!d || d === '—') return;
  // 先移除本案件旧的自动开庭事件，再写入最新的（开庭日期可改，改完日历跟着走）
  for (let i = CAL_EVENTS.length - 1; i >= 0; i--) {
    if (CAL_EVENTS[i].autoCourt && CAL_EVENTS[i].caseId === c.id) CAL_EVENTS.splice(i, 1);
  }
  CAL_EVENTS.push({
    date: d, type: 'court', autoCourt: true, caseId: c.id,
    title: '开庭 · ' + (normBlank(c.court) || c.hearingPlace || '—'),
    sub: c.title || c.id, time: '', place: c.hearingPlace || '', judge: c.judge || '',
  });
  c.autoToJudgeAt = plusDays(d, 1);
  c.updated = today();
  renderCalendar();
  updateNavBadges();
}

// 二审开庭日期同步：写日历「二审开庭」事件（autoSecondCourt 标记，可反复修改覆盖）
function syncSecondHearingCalendar(c) {
  const d = String(c.secondHearingAt || '').slice(0, 10);
  if (!d || d === '—') return;
  // 先移除本案件旧的自动二审开庭事件，再写入最新的
  for (let i = CAL_EVENTS.length - 1; i >= 0; i--) {
    if (CAL_EVENTS[i].autoSecondCourt && CAL_EVENTS[i].caseId === c.id) CAL_EVENTS.splice(i, 1);
  }
  CAL_EVENTS.push({
    date: d, type: 'court', autoSecondCourt: true, caseId: c.id,
    title: '二审开庭 · ' + (normBlank(c.court) || c.secondHearingPlace || '—'),
    sub: c.title || c.id, time: '', place: c.secondHearingPlace || '', judge: c.secondJudge || '',
  });
  c.updated = today();
  renderCalendar();
  updateNavBadges();
}

// 案件行操作：按阶段显示办理按钮
/* ---------- 列表派生字段：被告 / 权利人 ---------- */
// 被告：取名单第一位，多人时补「等 N 人」（v129 起不再区分主/共同被告）
function defendantNames(c) {
  const ds = Array.isArray(c.defendants) ? c.defendants.filter(d => d && d.name) : [];
  if (!ds.length) return '—';
  const main = ds[0];
  return ds.length > 1 ? `${main.name} 等 ${ds.length} 人` : main.name;
}
// 多被告时悬浮显示完整被告名单（复用 .cal-tip 浮层样式 + showTip 全局委托）
// 只在被告 ≥ 2 时返回内容：单个被告时单元格已显示全名，无需提示
function defendantTipHTML(c) {
  const ds = Array.isArray(c.defendants) ? c.defendants.filter(d => d && d.name) : [];
  if (ds.length < 2) return '';
  const ord = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  const row = (label, val, mono) => `<div class="cal-tip-row">
      <div class="cal-tip-label">${label}</div>
      <div class="cal-tip-val${mono ? ' mono' : ''}">${val ? val : '<span class="text-muted">\u2014</span>'}</div>
    </div>`;
  const rows = ds.map((d, i) => {
    const no = ord[i] || String(i + 1);
    const isCorp = d.kind === '法人/个体';
    const kindTxt = isCorp ? '法人/个体' : '自然人';
    return row(`被告${no}`, esc(d.name) + ` <span class="text-muted">· ${esc(kindTxt)}</span>`) +
           row(isCorp ? '信用代码' : '身份证号', esc(d.idno || ''), true) +
           row('联系电话', esc(d.phone || ''), true) +
           row('住所地', esc(d.addr || ''));
  }).join('');
  return `<div class="cal-tip-head">共 ${ds.length} 名被告</div>${rows}`;
}
// 权利人：案件显式指定 c.holder 时用它，否则取客户（品牌方即权利人）
function holderName(c) {
  return c.holder || c.client || '—';
}

/* ---------- 推进按钮：案件待匹配阶段必须先「补充被告」 ---------- */
// 被告类型：自然人 / 法人-个体（后者合并了法人与个体工商户）
const DEFENDANT_KINDS = ['自然人', '法人/个体'];

// 是否已补充被告信息（至少 1 条带名称的被告记录）
function hasDefendantInfo(c) {
  return Array.isArray(c.defendants) && c.defendants.some(d => d && String(d.name || '').trim());
}
// 推进按钮文案：案件待匹配且未补充被告 → 「补充被告」，提交后自动回到该阶段原本的 CTA「匹配律师」
// 注意：以 st.cta 为准（而非 st.next）——待判决/待归档 next 为 null 但仍有 CTA（判决更新/办理归档）
function caseCta(c) {
  const st = stageOf(c.status);
  if (!st || !st.cta) return '';
  if (c.status === '案件待匹配' && !hasDefendantInfo(c)) return '补充被告';
  if (c.status === '待判决' && c.judgeReady) return '二审抉择';
  return st.cta;
}
// 按钮动作：未补充被告走专用弹窗，二审抉择走选择弹窗，其余走阶段表单
function runCaseCta(id) {
  const c = STATE.cases.find(x => x.id === id); if (!c) return;
  if (caseCta(c) === '补充被告') supplementDefendants(id);
  else if (caseCta(c) === '二审抉择') openSecondInstanceChoice(id);
  else caseStageForm(id);
}

function caseActionBtns(c) {
  // 「详情」按钮已删（与行点击 openCase 功能重复），点案件行任意处即可进详情
  const t = caseCta(c);
  if (!t) return '';
  return `<button class="btn btn-primary btn-sm" onclick="runCaseCta('${c.id}')">${esc(t)}</button>`;
}

/* ---------- 阶段批量操作 ---------- */
// 诉状模板：按案件生成诉状初稿（正文文字）
function draftTextOf(c) {
  return `原告：${c.client || '—'}；被告：${c.defendant || '—'}；` +
         `案由：${c.type || '—'}纠纷；诉讼请求：判令被告停止侵权并赔偿经济损失及合理开支共计 ${money0(c.amount || 0)} 元。`;
}

/* ---------- 批量导出诉状初稿（文书模版库模版填充 → 按权利主体分文件夹打包 ZIP） ---------- */
// 被告信息块：姓名（类型）+ 证件号 + 住所地，供 {{被告信息}} 替换
function defendantBlockOf(c) {
  const ds = (Array.isArray(c.defendants) && c.defendants.length) ? c.defendants : [];
  if (!ds.length) return (c.defendant || '—') + '（被告信息待补充）';
  return ds.map((d, i) => {
    const head = `被告${['一','二','三','四','五'][i] || (i + 1)}：${d.name || '—'}（${d.kind || '自然人'}）`;
    const idline = d.idno ? `，${d.kind === '法人/个体' ? '统一社会信用代码' : '身份证号'}：${d.idno}` : '';
    const addline = d.addr ? `，住所地：${d.addr}` : '';
    return head + idline + addline + '。';
  }).join('\n');
}
// 模版占位符填充
function fillDraftTemplate(tpl, c) {
  const defName = draftDefName(c);
  return String(tpl || '')
    .replace(/\{\{原告\}\}/g, c.client || '—')
    .replace(/\{\{被告\}\}/g, defName)
    .replace(/\{\{被告信息\}\}/g, defendantBlockOf(c))
    .replace(/\{\{案由\}\}/g, (c.type || '侵权') + '纠纷')
    .replace(/\{\{标的额\}\}/g, money0(c.amount || 0))
    .replace(/\{\{法院\}\}/g, c.court && c.court !== '—' ? c.court : '××人民法院')
    .replace(/\{\{案件名称\}\}/g, c.title || c.id)
    .replace(/\{\{日期\}\}/g, today());
}
// 文件命名规则的「被告」：取名单第一位名称
function draftDefName(c) {
  const d = (Array.isArray(c.defendants) && c.defendants[0]) || null;
  return (d && d.name) || c.defendant || '未知被告';
}
// 文本 → Word 可打开的 .doc（HTML 包装）
function draftDocHTML(text) {
  return '<html xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>诉状初稿</title></head><body style="font-family:SimSun,serif;font-size:14pt;line-height:1.8;white-space:pre-wrap;">'
    + esc(text).replace(/\n/g, '<br>') + '</body></html>';
}

/* ---------- 极简 ZIP 打包（store 不压缩，支持中文文件夹路径，解压即得权利主体分文件夹） ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let v = n;
    for (let k = 0; k < 8; k++) v = (v & 1) ? (0xEDB88320 ^ (v >>> 1)) : (v >>> 1);
    t[n] = v >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
// files: [{ path: '权利主体/起诉状-被告.doc', data: Uint8Array }]
function makeZip(files) {
  const enc = new TextEncoder();
  const chunks = [], central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xFFFF;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;
  const u16 = v => [v & 0xFF, (v >> 8) & 0xFF];
  const u32 = v => [v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF, (v >>> 24) & 0xFF];
  files.forEach(f => {
    const nameB = enc.encode(f.path);
    const crc = crc32(f.data);
    const local = new Uint8Array([
      ...u32(0x04034B50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(dosTime), ...u16(dosDate),
      ...u32(crc), ...u32(f.data.length), ...u32(f.data.length), ...u16(nameB.length), ...u16(0),
    ]);
    chunks.push(local, nameB, f.data);
    central.push(new Uint8Array([
      ...u32(0x02014B50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(dosTime), ...u16(dosDate),
      ...u32(crc), ...u32(f.data.length), ...u32(f.data.length), ...u16(nameB.length), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), ...u32(0), ...u32(offset),
    ]), nameB);
    offset += local.length + nameB.length + f.data.length;
  });
  let centralSize = 0;
  central.forEach(x => { centralSize += x.length; });
  const eocd = new Uint8Array([
    ...u32(0x06054B50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length),
    ...u32(centralSize), ...u32(offset), ...u16(0),
  ]);
  const total = offset + centralSize + eocd.length;
  const out = new Uint8Array(total);
  let pos = 0;
  chunks.concat(central, [eocd]).forEach(x => { out.set(x, pos); pos += x.length; });
  return out;
}
function downloadBytes(filename, bytes, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: mime || 'application/octet-stream' }));
  a.download = filename;
  a.click();
  if (URL.revokeObjectURL) setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// 待写诉状：批量导出诉状初稿（勾选了案件则只导所选，否则导全部待写诉状；取文书模版库的起诉状模版填充）
function exportDraftsBatch() {
  const list = SELECTED.size
    ? STATE.cases.filter(c => SELECTED.has(c.id) && c.status === '待写诉状')
    : STATE.cases.filter(c => c.status === '待写诉状');
  if (!list.length) { toast('没有待写诉状的案件', '请切换到「待写诉状」阶段或勾选案件', 'info'); return; }
  const tpl = DOC_TEMPLATES.find(t => t.type === '起诉状');
  if (!tpl) { openDraftTemplatePrompt(list); return; }
  runExportDrafts(list, tpl);
}
// 模版库没有起诉状模版时：弹窗引导上传或使用内置演示模版
function openDraftTemplatePrompt(list) {
  openModal({
    title: '批量导出诉状初稿', wide: true,
    okText: '使用内置模版导出', cancelText: '取消',
    bodyHTML: `
      <div class="lead-detail-section">文书模版库里还没有<b>诉状模版</b>。可先上传（.txt 文本模版，支持 {{原告}}/{{被告}}/{{被告信息}}/{{案由}}/{{标的额}}/{{法院}} 占位符），或直接用内置演示模版。</div>
      <div class="form-field">
        <label class="form-label">上传诉状模版（.txt）</label>
        <input type="file" id="draft-tpl-file" accept=".txt,.md,text/plain" style="display:none" onchange="onDocTemplateFile(event, true)">
        <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('draft-tpl-file').click()">选择文件</button>
        <span class="form-hint" style="margin-left:8px;" id="draft-tpl-name">未选择</span>
      </div>`,
    onSubmit: () => {
      // 上传了就用上传的（onDocTemplateFile 已入库取最新一条），否则用内置
      const uploaded = DOC_TEMPLATES.find(t => t.type === '起诉状' && t.id !== 'T-001');
      runExportDrafts(list, uploaded || { type: '起诉状', name: '内置演示模版', content: BUILTIN_DRAFT_TEMPLATE });
      return true;
    },
  });
}
function runExportDrafts(list, tpl) {
  const enc = new TextEncoder();
  const byHolder = {};
  list.forEach(c => {
    const holder = c.client || '未分组';
    (byHolder[holder] = byHolder[holder] || []).push(c);
  });
  const files = [], used = new Set();
  Object.keys(byHolder).sort().forEach(holder => {
    byHolder[holder].forEach(c => {
      let fname = `起诉状-${draftDefName(c)}.doc`;
      const key = holder + '/' + fname;
      if (used.has(key)) fname = `起诉状-${draftDefName(c)}_${c.id}.doc`;
      used.add(holder + '/' + fname);
      files.push({ path: `${holder}/${fname}`, data: enc.encode(draftDocHTML(fillDraftTemplate(tpl.content, c))) });
    });
  });
  try {
    downloadBytes(`诉状初稿_${today()}.zip`, makeZip(files), 'application/zip');
    toast('诉状初稿已批量导出', `${list.length} 件 · 按权利主体分 ${Object.keys(byHolder).length} 个文件夹 · 模版：${tpl.name || '—'}`);
  } catch (e) {
    toast('导出失败', String(e && e.message || e), 'error');
  }
}

/* ---------- 批量上传诉状：ZIP 解包 → 文件名匹配案件 → 回填诉状/授权书 + 识别标的额 ---------- */
// 极简 ZIP 解包：读中央目录；store(0) 直接取字节，deflate(8) 走浏览器 DecompressionStream('deflate-raw')
function unzipList(buf) {
  const u = new Uint8Array(buf);
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = u.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 ZIP 压缩包');
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const entries = [];
  for (let k = 0; k < count; k++) {
    if (off + 46 > u.length || dv.getUint32(off, true) !== 0x02014b50) break;
    const method = dv.getUint16(off + 10, true);
    const csize = dv.getUint32(off + 20, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extLen = dv.getUint16(off + 30, true);
    const cmtLen = dv.getUint16(off + 32, true);
    const lho = dv.getUint32(off + 42, true);
    const name = new TextDecoder('utf-8').decode(u.subarray(off + 46, off + 46 + nameLen));
    if (lho + 30 <= u.length && name.slice(-1) !== '/') {
      const lnLen = dv.getUint16(lho + 26, true);
      const leLen = dv.getUint16(lho + 28, true);
      entries.push({ name, method, csize, dataStart: lho + 30 + lnLen + leLen });
    }
    off += 46 + nameLen + extLen + cmtLen;
  }
  return entries;
}
async function unzipRead(buf) {
  const u = new Uint8Array(buf);
  const out = [];
  for (const e of unzipList(buf)) {
    const raw = u.subarray(e.dataStart, e.dataStart + e.csize);
    if (e.method === 0) { out.push({ name: e.name, data: raw }); continue; }
    if (e.method === 8 && typeof DecompressionStream !== 'undefined') {
      try {
        const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        out.push({ name: e.name, data: new Uint8Array(await new Response(stream).arrayBuffer()) });
        continue;
      } catch (err) { /* 解压失败按跳过处理 */ }
    }
    out.push({ name: e.name, skipped: true });
  }
  return out;
}
// 从诉状正文识别标的额：取文内最大金额（默认单位元，兼容「xx万元」）
function draftAmountFromBytes(data) {
  let txt = '';
  try { txt = new TextDecoder('utf-8').decode(data); } catch (e) { return 0; }
  if (!txt) return 0;
  let max = 0, m;
  const re = /([0-9][0-9,，\s]{0,15}(?:\.[0-9]+)?)\s*(万元|元)/g;
  while ((m = re.exec(txt))) {
    const v0 = parseFloat(m[1].replace(/[，,\s]/g, ''));
    if (!isFinite(v0)) continue;
    const v = m[2] === '万元' ? v0 * 10000 : v0;
    if (v > max) max = v;
  }
  return Math.round(max);
}
// 文件名匹配案件：优先「待写诉状」阶段，先按案件单号、再按第一位被告名
function matchCaseForDraftName(name) {
  const base = String(name || '').split('/').pop();
  const pools = [
    STATE.cases.filter(c => c.status === '待写诉状'),
    STATE.cases,
  ];
  for (const pool of pools) {
    let hit = pool.find(c => base.includes(c.id));
    if (hit) return hit;
    hit = pool.find(c => { const d = draftDefName(c); return d && d !== '未知被告' && base.includes(d); });
    if (hit) return hit;
  }
  return null;
}
// 入口：待写诉状右上角「批量上传诉状」
function uploadDraftsBatch() {
  openModal({
    title: '批量上传诉状',
    okText: '开始识别',
    bodyHTML: `
      <div class="lead-detail-section">选择包含诉状文件的压缩包（.zip）。系统将自动识别压缩包内的诉状，按文件名匹配案件并回填「诉状/授权书」，同时识别诉状正文中的标的额写入标的额字段。</div>
      <div class="form-field">
        <label class="form-label">诉状压缩包（.zip）<span class="req">*</span></label>
        <input type="file" id="draft-zip-file" accept=".zip,application/zip,application/x-zip-compressed" style="display:none" onchange="document.getElementById('draft-zip-name').textContent = ((this.files || [])[0] || {}).name || '未选择'">
        <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('draft-zip-file').click()">选择文件</button>
        <span class="form-hint" style="margin-left:8px;" id="draft-zip-name">未选择</span>
      </div>
      <div class="form-hint">识别规则：文件名包含案件单号或被告名（如 起诉状-临沂市××家居用品厂.doc）；标的额取诉状正文中「赔偿 / 共计 / 标的额 … 元」的最大金额。</div>`,
    onSubmit: () => {
      const inp = document.getElementById('draft-zip-file');
      const f = inp && inp.files && inp.files[0];
      if (!f) { toast('请先选择诉状压缩包', '', 'error'); return false; }
      readDraftZip(f);
      return false; // 保持弹窗，由识别结果弹窗接管
    },
  });
}
function readDraftZip(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    let entries;
    try { entries = await unzipRead(reader.result); }
    catch (e) { toast('压缩包解析失败', String(e && e.message || e), 'error'); return; }
    if (!entries.length) { toast('压缩包里没有可识别的文件', '', 'error'); return; }
    const rows = [];
    let hitCount = 0, amtCount = 0;
    for (const en of entries) {
      if (en.skipped) { rows.push({ name: en.name, case: '—', note: '该压缩方式暂不支持，已跳过', ok: false }); continue; }
      const c = matchCaseForDraftName(en.name);
      if (!c) { rows.push({ name: en.name, case: '—', note: '未匹配到案件（文件名需含案件单号或被告名）', ok: false }); continue; }
      const fname = en.name.split('/').pop();
      const amt = draftAmountFromBytes(en.data);
      const oldAmt = numOf(c.amount);
      c.authDoc = fname;
      // v145：单值 c.authDoc 与数组 c.authDocs 保持同步（面板/弹窗读 authDocs，导出等旧逻辑读 authDoc）
      c.authDocs = [fname];
      c.draftAt = today();
      if (amt > 0) {
        c.amount = money0(amt);
        if (amt !== oldAmt) amtCount++;
      }
      pushCaseTimeline(c, '批量上传诉状：' + fname + (amt > 0 ? ' · 识别标的额 ' + money0(amt) + ' 元' : ''));
      hitCount++;
      rows.push({ name: fname, case: c.id, note: '已回填诉状/授权书' + (amt > 0 ? ' · 识别标的额 ' + money0(amt) + ' 元' : ' · 未识别到标的额'), ok: true });
    }
    renderCases(); renderCaseStageNav(); updateNavBadges(); save();
    openDraftUploadResult(rows, hitCount, amtCount);
  };
  reader.onerror = () => toast('读取文件失败', '', 'error');
  reader.readAsArrayBuffer(file);
}
function openDraftUploadResult(rows, hitCount, amtCount) {
  const trs = rows.map(r => `
    <tr>
      <td style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(r.name)}">${esc(r.name)}</td>
      <td class="mono">${esc(r.case)}</td>
      <td>${r.ok ? '<span class="pill pill-success">已回填</span>' : '<span class="pill pill-warning">未处理</span>'} <span class="text-muted" style="font-size:11px;">${esc(r.note)}</span></td>
    </tr>`).join('');
  openModal({
    title: '诉状识别结果', wide: true, okText: '完成',
    bodyHTML: `
      <div class="lead-detail-section">共识别 <b>${rows.length}</b> 个文件：匹配案件 <b>${hitCount}</b> 个，识别并更新标的额 <b>${amtCount}</b> 个。</div>
      <table class="table"><thead><tr><th>文件</th><th>案件</th><th>结果</th></tr></thead><tbody>${trs}</tbody></table>`,
    onSubmit: () => true,
  });
}

/* ---------- 诉状待确认：批量确认（是否披露下载诉状/授权书）→ 流转诉状待盖章 ---------- */
function bulkConfirmDrafts() {
  const list = SELECTED.size
    ? STATE.cases.filter(c => SELECTED.has(c.id) && c.status === '诉状待确认')
    : [];
  if (!list.length) { toast('请先勾选需要确认的案件', '在列表左侧勾选框中多选「诉状待确认」的案件', 'info'); return; }
  openModal({
    title: '批量确认 · ' + list.length + ' 件',
    okText: '确认',
    bodyHTML: `
      <div class="form-field">
        <label class="form-label">是否需要披露下载诉状/授权书<span class="req">*</span></label>
        <select class="form-select" id="bc-disclose">
          <option value="">请选择</option>
          <option value="是">是（打包下载所选案件的诉状/授权书，按品牌分文件夹）</option>
          <option value="否">否（仅确认，不下载）</option>
        </select>
      </div>`,
    onSubmit: () => {
      const v = ((document.getElementById('bc-disclose') || {}).value || '').trim();
      if (!v) { toast('请选择是否需要披露下载诉状/授权书', '', 'error'); return false; }
      if (v === '是') downloadSealDocsZip(list, '诉状授权书');
      list.forEach(c => {
        c.confirmDisclose = v;
        c.status = '诉状待盖章';
        pushCaseTimeline(c, '批量确认（披露下载：' + v + '），流转诉状待盖章');
      });
      SELECTED.clear();
      renderCases(); renderCaseStageNav(); updateNavBadges(); save(); syncCasesBatchBtn();
      closeModal();
      toast(v === '是' ? '已打包下载并批量确认' : '已批量确认',
        list.length + ' 件 · 诉状待确认 → 诉状待盖章' + (v === '是' ? ' · 按品牌分文件夹' : ''));
      return true;
    },
  });
}

/* ---------- 执行材料待确认：批量下载执行文书（勾选案件，按品牌分文件夹 ZIP） ---------- */
function execDocContent(c) {
  return '执行申请书\n\n申请执行人：' + holderName(c) + '\n'
    + '被执行人：' + draftDefName(c) + '\n'
    + '执行依据：' + (c.no || c.id) + '（' + (c.title || '') + '）\n'
    + '立案法院：' + (c.court || '—') + '\n'
    + '执行标的：' + (c.amount || '—') + '\n\n'
    + '请求事项：请求强制执行已生效判决，责令被执行人履行生效法律文书确定的义务。\n\n'
    + '此致\n' + (c.court || '人民法院');
}
function bulkDownloadExecDocs() {
  const list = SELECTED.size
    ? STATE.cases.filter(c => SELECTED.has(c.id) && c.status === '执行材料待确认')
    : [];
  if (!list.length) { toast('请先勾选需要下载执行文书的案件', '在列表左侧勾选框中多选「执行材料待确认」的案件', 'info'); return; }
  const enc = new TextEncoder();
  const byHolder = {};
  list.forEach(c => { const h = holderName(c) || '未分组'; (byHolder[h] = byHolder[h] || []).push(c); });
  const files = [], used = new Set();
  Object.keys(byHolder).sort().forEach(h => {
    byHolder[h].forEach(c => {
      let fname = c.execDoc || ('执行申请书-' + draftDefName(c) + '.doc');
      if (!/\.(docx?|txt)$/i.test(fname)) fname += '.doc';
      if (used.has(h + '/' + fname)) fname = fname.replace(/\.(docx?|txt)$/i, '') + '_' + c.id + '.doc';
      used.add(h + '/' + fname);
      files.push({ path: h + '/' + fname, data: enc.encode(draftDocHTML(execDocContent(c))) });
    });
  });
  downloadBytes('执行文书_' + today() + '.zip', makeZip(files), 'application/zip');
  SELECTED.clear();
  renderCases(); save();
  toast('已批量下载执行文书', list.length + ' 件 · 按品牌分 ' + Object.keys(byHolder).length + ' 个文件夹');
}

/* ---------- 诉状/授权书打包：按权利主体（品牌）分文件夹 ZIP（批量确认下载与盖章批量下载共用） ---------- */
function downloadSealDocsZip(list, tag) {
  const enc = new TextEncoder();
  const tpl = DOC_TEMPLATES.find(t => t.type === '起诉状');
  const tplContent = tpl ? tpl.content : BUILTIN_DRAFT_TEMPLATE;
  const byHolder = {};
  list.forEach(c => { const h = holderName(c) || '未分组'; (byHolder[h] = byHolder[h] || []).push(c); });
  const files = [], used = new Set();
  Object.keys(byHolder).sort().forEach(h => {
    byHolder[h].forEach(c => {
      let fname = c.authDoc || ('起诉状-' + draftDefName(c) + '.doc');
      if (!/\.(docx?|txt)$/i.test(fname)) fname += '.doc';
      if (used.has(h + '/' + fname)) fname = fname.replace(/\.(docx?|txt)$/i, '') + '_' + c.id + '.doc';
      used.add(h + '/' + fname);
      files.push({ path: h + '/' + fname, data: enc.encode(draftDocHTML(fillDraftTemplate(tplContent, c))) });
    });
  });
  downloadBytes(tag + '_' + today() + '.zip', makeZip(files), 'application/zip');
}

/* ---------- 诉状待盖章：批量下载诉状（按权利主体分文件夹 ZIP） ---------- */
function batchSealDocsZip() {
  const list = SELECTED.size
    ? STATE.cases.filter(c => SELECTED.has(c.id) && c.status === '诉状待盖章')
    : STATE.cases.filter(c => c.status === '诉状待盖章');
  if (!list.length) { toast('没有诉状待盖章的案件', '请切换到「诉状待盖章」或勾选案件', 'info'); return; }
  downloadSealDocsZip(list, '诉状盖章');
  const holders = {};
  list.forEach(c => { holders[holderName(c) || '未分组'] = 1; });
  toast('已批量下载诉状', list.length + ' 件 · 按权利主体分 ' + Object.keys(holders).length + ' 个文件夹');
}

/* ---------- 诉状待盖章：邮寄（填邮寄日期）→ 流转待提交立案 ---------- */
function mailDraftsBatch() {
  const list = SELECTED.size
    ? STATE.cases.filter(c => SELECTED.has(c.id) && c.status === '诉状待盖章')
    : [];
  if (!list.length) { toast('请先勾选需要邮寄的案件', '在列表左侧勾选框中多选「诉状待盖章」的案件', 'info'); return; }
  openModal({
    title: '邮寄 · ' + list.length + ' 件',
    okText: '确认邮寄',
    bodyHTML: `
      <div class="form-field">
        <label class="form-label">邮寄日期<span class="req">*</span></label>
        <input class="form-input" type="date" id="bm-mail-at" value="${today()}">
      </div>`,
    onSubmit: () => {
      const at = ((document.getElementById('bm-mail-at') || {}).value || '').trim();
      if (!at) { toast('请填写邮寄日期', '', 'error'); return false; }
      list.forEach(c => {
        c.mailAt = at;
        c.status = '待提交立案';
        pushCaseTimeline(c, '诉状邮寄（' + at + '），流转待提交立案');
      });
      SELECTED.clear();
      renderCases(); renderCaseStageNav(); updateNavBadges(); save(); syncCasesBatchBtn();
      closeModal();
      toast('已批量邮寄', list.length + ' 件 · 诉状待盖章 → 待提交立案');
      return true;
    },
  });
}

/* ---------- 执行材料待盖章：邮寄（填邮寄日期）→ 流转待申请执行（单个 / 批量） ---------- */
function bulkMailExecBatch() {
  const list = SELECTED.size
    ? STATE.cases.filter(c => SELECTED.has(c.id) && c.status === '执行材料待盖章')
    : STATE.cases.filter(c => c.status === '执行材料待盖章');
  if (!list.length) { toast('没有执行材料待盖章的案件', '请切换到「执行材料待盖章」或勾选案件', 'info'); return; }
  openModal({
    title: '批量邮寄 · ' + list.length + ' 件',
    okText: '确认邮寄',
    bodyHTML: `
      <div class="form-field">
        <label class="form-label">邮寄日期<span class="req">*</span></label>
        <input class="form-input" type="date" id="bem-mail-at" value="${today()}">
      </div>`,
    onSubmit: () => {
      const at = ((document.getElementById('bem-mail-at') || {}).value || '').trim();
      if (!at) { toast('请填写邮寄日期', '', 'error'); return false; }
      list.forEach(c => {
        c.execMailAt = at;
        c.status = '待申请执行立案';
        pushCaseTimeline(c, '执行材料邮寄（' + at + '），流转待申请执行');
      });
      SELECTED.clear();
      renderCases(); renderCaseStageNav(); updateNavBadges(); save(); syncCasesBatchBtn();
      closeModal();
      toast('已批量邮寄', list.length + ' 件 · 执行材料待盖章 → 待申请执行');
      return true;
    },
  });
}

/* ---------- 待写执行材料：批量上传执行文书（单文件或 .zip，按案号匹配回填执行申请材料） ---------- */
// 从文书正文提取案号：（2026）粤01民初1234号 / (2025)沪73民终45号 …（全角/半角括号均支持）
function execCaseNoFromText(text) {
  const m = String(text || '').match(/（\d{4}）.*?号|[（(]\d{4}[）)].*?号/i);
  return m ? m[0] : '';
}
// 文本 + 文件名 → 案件：案号（c.no）/ 案件单号（c.id）直接命中，未命中按标题/关键词兜底
function matchCaseForExecText(text, name) {
  const no = execCaseNoFromText(text);
  const s = String(text || '');
  const base = String(name || '').split('/').pop();
  const pools = [
    STATE.cases.filter(c => c.status === '待写执行材料'),
    STATE.cases,
  ];
  if (no) {
    for (const pool of pools) {
      let hit = pool.find(c => c.no && c.no === no) || pool.find(c => c.no && c.no.includes(no));
      if (hit) return { c: hit, no };
    }
  }
  // 兜底：文件名 / 正文含案件单号，或文件名含案件标题关键词
  for (const pool of pools) {
    let hit = pool.find(c => base.includes(c.id) || s.includes(c.id));
    if (hit) return { c: hit, no };
    hit = pool.find(c => c.title && c.title.length >= 6 && base.includes(c.title.slice(0, 6)));
    if (hit) return { c: hit, no };
  }
  return null;
}
// 匹配成功：回填执行申请材料 + 时间轴
function applyExecDoc(c, fname, text) {
  const t = String(text || '').trim();
  c.execDoc = t.slice(0, 2000) || ('执行申请书_' + fname);
  c.execDraftAt = today();
  pushCaseTimeline(c, '批量上传执行文书：' + fname);
}
// 入口：待写执行材料右上角「批量上传执行文书」
function uploadExecDocsBatch() {
  openModal({
    title: '批量上传执行文书',
    okText: '开始识别',
    bodyHTML: `
      <div class="lead-detail-section">选择执行文书（单个文件）或包含执行文书的压缩包（.zip）。系统将读取文书正文中的案号，按案号 / 案件单号匹配案件并回填「执行申请材料」。</div>
      <div class="form-field">
        <label class="form-label">执行文书（单文件或 .zip）<span class="req">*</span></label>
        <input type="file" id="exec-doc-file" style="display:none" onchange="document.getElementById('exec-doc-name').textContent = ((this.files || [])[0] || {}).name || '未选择'">
        <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('exec-doc-file').click()">选择文件</button>
        <span class="form-hint" style="margin-left:8px;" id="exec-doc-name">未选择</span>
      </div>
      <div class="form-hint">识别规则：从文书正文提取案号（如（2026）粤01民初1234号），按 c.no / c.id 匹配案件；未直接命中时按文件名中的案件单号或案件标题关键词兜底。</div>`,
    onSubmit: () => {
      const inp = document.getElementById('exec-doc-file');
      const f = inp && inp.files && inp.files[0];
      if (!f) { toast('请先选择执行文书或压缩包', '', 'error'); return false; }
      if (/\.zip$/i.test(f.name)) readExecZip(f);
      else readExecSingleFile(f);
      return false; // 保持弹窗，由识别结果弹窗接管
    },
  });
}
function readExecZip(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    let entries;
    try { entries = await unzipRead(reader.result); }
    catch (e) { toast('压缩包解析失败', String(e && e.message || e), 'error'); return; }
    if (!entries.length) { toast('压缩包里没有可识别的文件', '', 'error'); return; }
    const rows = [];
    let hitCount = 0;
    const dec = new TextDecoder('utf-8', { fatal: false });
    for (const en of entries) {
      if (en.skipped) { rows.push({ name: en.name, case: '—', note: '该压缩方式暂不支持，已跳过', ok: false }); continue; }
      const text = dec.decode(en.data || new Uint8Array());
      const m = matchCaseForExecText(text, en.name);
      const fname = en.name.split('/').pop();
      if (!m) { rows.push({ name: fname, case: '—', note: '未匹配到案件（正文无案号且文件名无单号/标题关键词）', ok: false }); continue; }
      applyExecDoc(m.c, fname, text);
      hitCount++;
      rows.push({ name: fname, case: m.c.id, note: '已回填执行申请材料' + (m.no ? ' · 案号 ' + m.no : ''), ok: true });
    }
    renderCases(); renderCaseStageNav(); updateNavBadges(); save();
    openExecUploadResult(rows, hitCount);
  };
  reader.onerror = () => toast('读取文件失败', '', 'error');
  reader.readAsArrayBuffer(file);
}
function readExecSingleFile(file) {
  const finish = text => {
    const m = matchCaseForExecText(text, file.name);
    if (!m) {
      openExecUploadResult([{ name: file.name, case: '—', note: '未匹配到案件（正文无案号且文件名无单号/标题关键词）', ok: false }], 0);
      return;
    }
    applyExecDoc(m.c, file.name, text);
    renderCases(); renderCaseStageNav(); updateNavBadges(); save();
    openExecUploadResult([{ name: file.name, case: m.c.id, note: '已回填执行申请材料' + (m.no ? ' · 案号 ' + m.no : ''), ok: true }], 1);
  };
  if (typeof file.text === 'function') file.text().then(finish).catch(() => finish(''));
  else finish('');
}
function openExecUploadResult(rows, hitCount) {
  const trs = rows.map(r => `
    <tr>
      <td style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(r.name)}">${esc(r.name)}</td>
      <td class="mono">${esc(r.case)}</td>
      <td>${r.ok ? '<span class="pill pill-success">已回填</span>' : '<span class="pill pill-warning">未处理</span>'} <span class="text-muted" style="font-size:11px;">${esc(r.note)}</span></td>
    </tr>`).join('');
  openModal({
    title: '执行文书识别结果', wide: true, okText: '完成',
    bodyHTML: `
      <div class="lead-detail-section">共识别 <b>${rows.length}</b> 个文件：匹配案件 <b>${hitCount}</b> 个。</div>
      <table class="table"><thead><tr><th>文件</th><th>案件</th><th>结果</th></tr></thead><tbody>${trs}</tbody></table>`,
    onSubmit: () => true,
  });
}

// 盖章类阶段：批量下载 + 批量确认收到
function batchSealDownload() {
  const keys = ['诉状待盖章', '执行材料待盖章'];
  const list = STATE.cases.filter(c => keys.includes(c.status));
  if (!list.length) { toast('没有待盖章的案件', '请切换到「诉状待盖章」或「执行材料待盖章」', 'info'); return; }
  const isExec = list[0].status === '执行材料待盖章';
  const head = ['案件单号', '案件名称', '客户', '文件类型', '文件名称'];
  const rows = list.map(c => [c.id, c.title, c.client,
    isExec ? '执行申请材料' : '起诉状',
    (isExec ? '执行申请书_' : '起诉状_') + c.title.slice(0, 12) + '.docx']);
  downloadCSV(`${isExec ? '执行申请文件' : '诉状盖章文件'}_${today()}.csv`, head, rows);
  toast('已批量下载', `${list.length} 份${isExec ? '执行申请文件' : '诉状文件'}`);
}
/* ---------- 待提交立案：批量立案（被告 + 可批量填充的立案法院/日期 + 逐案字段 → 流转转正式立案） ---------- */
function bulkUploadHTML(caseId, k, val, type, i) {
  const iid = 'bf-' + k + '-' + i;
  const acc = type === 'image' ? ' accept="image/*"' : '';
  return `<div style="display:flex;gap:8px;">
    <input class="form-input" data-bfk="${k}" value="${esc(val || '')}" readonly placeholder="点击「上传」选择${type === 'image' ? '图片' : '文件'}">
    <button type="button" class="btn btn-secondary btn-sm" style="white-space:nowrap;" onclick="document.getElementById('${iid}').click()">上传</button>
    <input type="file" id="${iid}" style="display:none"${acc} onchange="bulkFilePicked(this,'${esc(caseId)}','${k}')">
  </div>`;
}
function bulkFilePicked(inp, caseId, k) {
  const name = ((inp.files || [])[0] || {}).name || '';
  const sel = '.form-grid[data-bcase="' + caseId + '"]';
  const wrap = (inp.closest && inp.closest(sel)) || document.querySelector('#modal-body ' + sel);
  const target = wrap && wrap.querySelector('[data-bfk="' + k + '"]');
  if (target && name) target.value = name;
}
function bulkFilingCaseRow(c, i) {
  const courtOpts = COURTS.map(o => `<option${c.court === o ? ' selected' : ''}>${o}</option>`).join('');
  return `<div class="lead-detail-section">案件 ${i + 1} · ${esc(c.title)}</div>
  <div class="form-grid" data-bcase="${esc(c.id)}">
    <div class="form-field"><label class="form-label">被告</label><input class="form-input" value="${esc(defendantNames(c))}" readonly></div>
    <div class="form-field"><label class="form-label">立案法院<span class="req">*</span></label><select class="form-select" data-bfk="court">${courtOpts}</select></div>
    <div class="form-field"><label class="form-label">提交立案日期<span class="req">*</span></label><input class="form-input" type="date" data-bfk="submitAt" value="${esc(c.submitAt || '')}"></div>
    <div class="form-field"><label class="form-label">标的额（元，可修改）</label><input class="form-input" data-bfk="amount" value="${esc(c.amount || '')}"></div>
    <div class="form-field"><label class="form-label">立案截图</label>${bulkUploadHTML(c.id, 'filingShot', c.filingShot, 'image', i)}</div>
    <div class="form-field"><label class="form-label">诉调号 / 立案编号</label><input class="form-input" data-bfk="mediateNo" value="${esc(c.mediateNo || '')}"></div>
    <div class="form-field full"><label class="form-label">证据材料</label>${bulkUploadHTML(c.id, 'evidence', c.evidence, 'file', i)}</div>
  </div>`;
}
function bulkFilingFillAll() {
  const court = ((document.getElementById('bf-court') || {}).value || '').trim();
  const date = ((document.getElementById('bf-date') || {}).value || '').trim();
  if (!court && !date) { toast('请先选择立案法院或提交立案日期', '', 'error'); return; }
  document.querySelectorAll('#modal-body .form-grid[data-bcase]').forEach(grid => {
    if (court) { const el = grid.querySelector('[data-bfk="court"]'); if (el) el.value = court; }
    if (date) { const el = grid.querySelector('[data-bfk="submitAt"]'); if (el) el.value = date; }
  });
  toast('已批量填充', [court ? '立案法院' : '', date ? '提交立案日期' : ''].filter(Boolean).join(' · '));
}
function bulkFilingBatch() {
  const list = SELECTED.size
    ? STATE.cases.filter(c => SELECTED.has(c.id) && c.status === '待提交立案')
    : STATE.cases.filter(c => c.status === '待提交立案');
  if (!list.length) { toast('没有待提交立案的案件', '请切换到「待提交立案」或勾选案件', 'info'); return; }
  openModal({
    title: '批量立案 · ' + list.length + ' 件', wide: true,
    okText: '批量立案',
    bodyHTML: `
      <div class="lead-detail-section">批量填充（可选：填充后仍可单个修改）</div>
      <div style="display:flex;gap:8px;margin-bottom:6px;">
        <select class="form-select" id="bf-court" style="flex:1.4"><option value="">— 选择法院 —</option>${COURTS.map(o => `<option>${o}</option>`).join('')}</select>
        <input class="form-input" type="date" id="bf-date" style="flex:1">
        <button type="button" class="btn btn-secondary" onclick="bulkFilingFillAll()">填充到全部案件</button>
      </div>
      ${list.map((c, i) => bulkFilingCaseRow(c, i)).join('')}`,
    onSubmit: () => {
      const fails = [], done = [];
      list.forEach(c => {
        const grid = document.querySelector('#modal-body .form-grid[data-bcase="' + c.id + '"]');
        if (!grid) return;
        const g = k => { const el = grid.querySelector('[data-bfk="' + k + '"]'); return el ? el.value.trim() : ''; };
        const court = g('court'), submitAt = g('submitAt'), amount = g('amount'),
              filingShot = g('filingShot'), mediateNo = g('mediateNo'), evidence = g('evidence');
        if (!normBlank(court)) { fails.push(defendantNames(c) + '：未选立案法院'); return; }
        if (!submitAt) { fails.push(defendantNames(c) + '：未填提交立案日期'); return; }
        c.court = court; c.submitAt = submitAt;
        if (amount) c.amount = amount;
        c.filingShot = filingShot; c.mediateNo = mediateNo; c.evidence = evidence;
        c.status = '转正式立案'; c.stageCls = 'pill-warning'; c.updated = '刚刚';
        pushCaseTimeline(c, `批量立案：${court} · 提交日期 ${submitAt}${evidence ? ' · 证据材料 ' + evidence : ''}，流转待正式立案`);
        done.push(c.id);
      });
      if (!done.length) { toast('批量立案失败', fails.join('；'), 'error'); return false; }
      SELECTED.clear();
      renderCaseStageNav(); renderCases(); renderCaseDetail(); updateNavBadges(); save();
      toast(`已批量立案 ${done.length} 件`, '待提交立案 → 待正式立案' + (fails.length ? ' · 未通过 ' + fails.length + ' 件：' + fails.join('；') : ''));
      return true;
    },
  });
}

// 右上「批量」按钮：按阶段切换动作（案件待匹配=批量匹配律师；待写诉状=批量导出诉状初稿；
// 诉状待确认=批量确认（披露下载→流转）；待提交立案=批量立案；诉状待盖章=批量下载诉状；其余沿用按阶段批量导出）
function casesBatchAction() {
  if (FILTER.status === '案件待匹配') { bulkMatchLawyer(); return; }
  if (FILTER.status === '诉状待确认') { bulkConfirmDrafts(); return; }
  if (FILTER.status === '待提交立案') { bulkFilingBatch(); return; }
  if (FILTER.status === '诉状待盖章') { batchSealDocsZip(); return; }
  if (FILTER.status === '待写执行材料') { uploadExecDocsBatch(); return; }
  if (FILTER.status === '执行材料待确认') { bulkDownloadExecDocs(); return; }
  if (FILTER.status === '执行材料待盖章') { bulkMailExecBatch(); return; }
  batchStageAction();
}
// 按钮文案跟随阶段
function syncCasesBatchBtn() {
  const btn = document.getElementById('cases-batch-btn');
  const label = document.getElementById('cases-batch-label');
  if (!btn || !label) return;
  // 待开庭 / 待判决 / 二审 / 待申请执行 / 强制执行中：无批量操作，隐藏右上批量按钮
  // v66/v67：合并组视图（准备起诉文书 / 准备执行文书）同样隐藏——各阶段批量按钮直接横排在列表上方
  // v125：「全部」流程下它只是重复「导出」的动作（都是导当前清单），一并隐藏以精简工具栏
  btn.style.display = (FILTER.status === '全部' || FILTER.status === '待开庭' || FILTER.status === '待判决' || FILTER.status === '二审' || FILTER.status === '待申请执行立案' || FILTER.status === '强制执行中' || FILTER.status === PREP_DOC_GROUP || FILTER.status === EXEC_DOC_GROUP) ? 'none' : '';
  let txt = '批量', tip = '按案件进展批量导出';
  if (FILTER.status === '案件待匹配') { txt = '批量匹配律师'; tip = '勾选多个案件后统一匹配律师（可多选）'; }
  else if (FILTER.status === '待写诉状') { txt = '批量导出诉状初稿'; tip = '按文书模版库模版填充原被告/案由，按权利主体分文件夹打包导出'; }
  else if (FILTER.status === '诉状待确认') { txt = '批量确认'; tip = '勾选案件后统一确认是否披露下载诉状/授权书，确认后流转诉状待盖章'; }
  else if (FILTER.status === '待提交立案') { txt = '批量立案'; tip = '弹窗展示所选案件，批量/单个填写立案信息后统一流转待正式立案'; }
  else if (FILTER.status === '诉状待盖章') { txt = '批量下载诉状'; tip = '将所选案件的诉状/授权书按权利主体分文件夹打包下载'; }
  else if (FILTER.status === '待写执行材料') { txt = '批量上传执行文书'; tip = '选择单个执行文书或 .zip 压缩包，按案号自动匹配案件并回填执行申请材料'; }
  else if (FILTER.status === '执行材料待确认') { txt = '批量下载执行文书'; tip = '勾选案件后将其执行申请材料按品牌（权利主体）分文件夹打包下载'; }
  else if (FILTER.status === '执行材料待盖章') { txt = '批量邮寄'; tip = '填写邮寄日期后，所选或全部执行材料待盖章案件流转待申请执行'; }
  label.textContent = txt;
  btn.title = tip;
  /* v150：已归档流程右上角的「归档」按钮删除（已归档没有"再归档"的语义）。
     待归档流程**保留** —— 它的语义已改为「终结归档」（待归档 → 已归档），见 openBulkFinalizeArchive。 */
  const archBtn = document.getElementById('cases-archive-btn');
  if (archBtn) archBtn.style.display = (FILTER.status === '已归档') ? 'none' : '';
  // 创建案件：仅「案件待匹配」流程显示，其它流程隐藏
  const createBtn = document.getElementById('case-create-btn');
  if (createBtn) createBtn.style.display = (FILTER.status === '案件待匹配') ? '' : 'none';
  // v146：合并起诉 —— 与「创建案件」同一处判断、同一显示条件
  const mergeBtn = document.getElementById('case-merge-btn');
  if (mergeBtn) mergeBtn.style.display = (FILTER.status === '案件待匹配') ? '' : 'none';
  // 待写诉状阶段旁显示「批量上传诉状」，其它阶段隐藏
  const up = document.getElementById('cases-upload-btn');
  if (up) up.style.display = (FILTER.status === '待写诉状') ? '' : 'none';
  // 诉状待盖章阶段旁显示「邮寄」，其它阶段隐藏
  const mail = document.getElementById('cases-mail-btn');
  if (mail) mail.style.display = (FILTER.status === '诉状待盖章') ? '' : 'none';
  syncCasesExportTip();
  syncCaseSubstageBar();
}

/* v125：导出按钮的提示词跟着「勾选 / 筛选」口径走（工具栏上就能看出会导出多少条） */
function syncCasesExportTip() {
  const btn = document.getElementById('cases-export-btn'); if (!btn) return;
  // ⚠ 提示词必须与 exportScope() 同源：勾选项若被筛选排除，实际导出的是筛选结果，
  //    此时按 SELECTED.size 说「导出勾选的 N 条」就是错话（CDP 验收时抓到过）
  const s = exportScope();
  btn.title = s.scope === 'selected' ? `导出勾选的 ${s.list.length} 条案件`
    : (s.scope === 'filtered' ? `导出当前筛选命中的 ${s.list.length} 条案件` : `导出全部 ${s.list.length} 条案件`);
}

/* ---------- v66/v67：合并组视图 → 折叠前的批量按钮直接横排 ----------
   组视图在列表上方显示该组各阶段的原批量按钮，各自作用于自己子阶段的案件，
   行为与折叠前完全一致（勾选了对应子阶段的案件则只处理所选，否则按各函数原规则处理）。
   非组视图整条隐藏。 */
const PREP_DOC_ACTIONS = [
  ['批量导出诉状初稿', 'exportDraftsBatch()',  '按文书模版库模版填充原被告/案由，按权利主体分文件夹打包导出（作用于「待写诉状」案件，勾选则只导所选）'],
  ['批量上传诉状',     'uploadDraftsBatch()',  '上传诉状压缩包，自动识别并回填诉状/授权书与标的额（回填到「待写诉状」案件）'],
  ['批量确认',         'bulkConfirmDrafts()',  '勾选「诉状待确认」案件后统一确认是否披露下载诉状/授权书，确认后流转诉状待盖章'],
  ['批量下载诉状',     'batchSealDocsZip()',   '将「诉状待盖章」案件的诉状/授权书按权利主体分文件夹打包下载（未勾选导全部）'],
  ['邮寄',             'mailDraftsBatch()',    '填写邮寄日期后，勾选的「诉状待盖章」案件流转到待提交立案'],
];
const EXEC_DOC_ACTIONS = [
  ['批量上传执行文书', 'uploadExecDocsBatch()',  '选择单个执行文书或 .zip 压缩包，按案号自动匹配「待写执行材料」案件并回填执行申请材料'],
  ['批量下载执行文书', 'bulkDownloadExecDocs()', '勾选「执行材料待确认」案件后，将其执行申请材料按品牌（权利主体）分文件夹打包下载'],
  ['批量邮寄',         'bulkMailExecBatch()',    '填写邮寄日期后，勾选的「执行材料待盖章」案件流转待申请执行'],
];
const groupActionsOf = status =>
  status === PREP_DOC_GROUP ? PREP_DOC_ACTIONS :
  status === EXEC_DOC_GROUP ? EXEC_DOC_ACTIONS : null;
function syncCaseSubstageBar() {
  const bar = document.getElementById('case-substage-bar');
  if (!bar) return;
  const actions = groupActionsOf(FILTER.status);
  if (!actions) { bar.style.display = 'none'; bar.innerHTML = ''; }
  else {
    bar.innerHTML = '<span class="case-substage-title">' + esc(FILTER.status) + ' · 批量操作</span>' +
      actions.map(([t, fn, tip]) =>
        `<button class="btn btn-secondary btn-sm" onclick="${fn}" title="${tip}">${t}</button>`).join('');
    bar.style.display = '';
  }
  syncStageFilterUI();
}

/* ---------- v66：表头「案件进展 ▾」倒三角筛选（单选 / 多选） ---------- */
/* v149（用户 2026-09-14 口径）：表头「案件进展 ▾」只对 3 个流程开放 ——
     ①「全部」        → 16 档全集（维持原样）
     ②「准备起诉文书」→ 只能筛 待写诉状 / 诉状待确认 / 诉状待盖章
     ③「准备执行文书」→ 只能筛 待写执行材料 / 执行材料待确认 / 执行材料待盖章
   其余流程内部只有一个原子阶段，筛选没有意义 → 倒三角隐藏、浮层一并收起。
   返回 null = 该流程不提供筛选；返回数组 = 该流程的可选阶段白名单。 */
function stageFilterScope() {
  if (FILTER.status === '全部') return STAGE_KEYS.slice();
  const g = groupStageKeys(FILTER.status);
  return g.length ? g : null;
}
function syncCasesStageCaret() {
  const caret = document.getElementById('cases-stage-caret');
  const scope = stageFilterScope();
  if (caret) caret.style.display = scope ? '' : 'none';
  if (!scope) closeStageFilter();
  return !!scope;
}
function toggleStageFilter(ev) {
  if (ev) { ev.stopPropagation(); }
  if (!stageFilterScope()) { syncCasesStageCaret(); return; }   // v149：非组流程不给筛
  const panel = document.getElementById('stage-filter-panel');
  if (!panel) return;
  if (panel.style.display === 'none' || !panel.style.display) {
    closeEvStageFilter();   // v131：与证物台账的倒三角互斥，避免两个浮层同时挂着
    renderStageFilterPanel();
    panel.style.display = 'block';
    const caret = document.getElementById('cases-stage-caret');
    if (caret && caret.getBoundingClientRect) {
      const r = caret.getBoundingClientRect();
      panel.style.top = (r.bottom + 6) + 'px';
      panel.style.left = Math.max(12, r.left - 8) + 'px';
    }
  } else {
    panel.style.display = 'none';
  }
}
function closeStageFilter() {
  const panel = document.getElementById('stage-filter-panel');
  if (panel) panel.style.display = 'none';
}
function renderStageFilterPanel() {
  const panel = document.getElementById('stage-filter-panel');
  if (!panel) return;
  const scope = stageFilterScope();
  if (!scope) { panel.innerHTML = ''; return; }   // v149：非组流程没有可选项
  const set = Array.isArray(FILTER.statusSet) ? FILTER.statusSet : [];
  const n = k => STATE.cases.filter(c => c.status === k).length;
  // v149：候选项收窄到本流程白名单 —— 组流程只列组内 3 档，「全部」列 16 档
  const rows = scope.map(k => {
    const s = stageOf(k);
    const checked = set.includes(k);
    return `<label class="sfp-item"><input type="checkbox" ${checked ? 'checked' : ''} onchange="toggleStageFilterKey('${esc(k)}')"><span class="sfp-name">${esc(s.navLabel || s.key)}</span><span class="sfp-count">${n(k)}</span></label>`;
  }).join('');
  panel.innerHTML =
    `<div class="sfp-head"><span>筛选案件进展（可多选）</span><button class="btn btn-ghost btn-sm" onclick="clearStageFilter()">清除</button></div>` +
    `<label class="sfp-item sfp-all"><input type="checkbox" ${set.length === 0 ? 'checked' : ''} onchange="clearStageFilter()"><span class="sfp-name">全部</span><span class="sfp-count">${STATE.cases.length}</span></label>` +
    rows;
}
function toggleStageFilterKey(k) {
  if (!Array.isArray(FILTER.statusSet)) FILTER.statusSet = [];
  const i = FILTER.statusSet.indexOf(k);
  if (i >= 0) FILTER.statusSet.splice(i, 1); else FILTER.statusSet.push(k);
  renderCases();
}
function clearStageFilter() {
  FILTER.statusSet = [];
  renderCases();
}
// 倒三角激活态 + 面板计数实时刷新（renderCases → syncCasesBatchBtn → 此处）
function syncStageFilterUI() {
  const caret = document.getElementById('cases-stage-caret');
  const has = syncCasesStageCaret();   // v149：只有「全部 / 准备起诉文书 / 准备执行文书」显示倒三角
  if (caret) caret.classList.toggle('active', has && Array.isArray(FILTER.statusSet) && FILTER.statusSet.length > 0);
  const panel = document.getElementById('stage-filter-panel');
  if (panel && panel.style.display === 'block') renderStageFilterPanel();
}
// 点击面板与倒三角之外的区域自动收起
document.addEventListener('click', e => {
  const panel = document.getElementById('stage-filter-panel');
  if (!panel || panel.style.display !== 'block') return;
  if (e.target.closest('#stage-filter-panel') || e.target.closest('#cases-stage-caret')) return;
  closeStageFilter();
});

/* ---------- v131：证物管理「案件进展 ▾」倒三角筛选（与「我的案件」同款：多选 + 计数 + 清除） ----------
   v132：计数口径与「我的案件」对齐 —— 数**案件**（按 caseId 去重），不再数证物件数；
   统计范围仍是证物台账（随「证物状态」pill 联动）。16 个阶段每档都至少有 1 条证物，
   所以面板上不会再出现 0，点任何一档也必然有数据。 */
// 唯一取值口：caseId → 案件进展。列表「案件进展」列 / 表头筛选 / 面板计数三处共用同一个函数
// （v130 它是 renderEvidence 里的局部函数，v131 提到模块级，浮层才用得上）。
// 老种子若缺 caseId/status 用「—」兜底：既不会被任何阶段命中，也不会被过滤掉
function stageOfCase(id) {
  const c = STATE.cases.find(x => x.id === id);
  return c ? c.status : '—';
}
/* ---------- v148：证物列表 —— 状态/进展/时间 三个维度的唯一判定口 ----------
   三个谓词都提到模块级：列表过滤、KPI pill 计数、进展浮层计数、全选、导出四处共用同一套，
   杜绝「同一条件两处写法」（v130 的教训：取值口一分叉，列里的值和筛选命中的行就对不上）。 */
function evOkStatus(e) { return EV_FILTER.status === '全部' || (e && e.status) === EV_FILTER.status; }
function evOkStage(e) { return !(EV_FILTER.stageSet || []).length || EV_FILTER.stageSet.includes(stageOfCase(e && e.caseId)); }
/* 开庭时间 / 结案时间都取自**关联案件**（证物自身没有这两个日期）：
   开庭 = 一审开庭日期（缺则回落二审开庭日期）；结案 = 结案日期。
   区间用 ISO 字符串直接比大小（yyyy-MM-dd 天然可按字典序比），两端都空 = 不限；
   设了区间但案件没有该日期 → 不算命中（与「案件进展」对「—」的处理一致）。 */
function evDateOf(v) { const s = String(v == null ? '' : v).split(' ')[0]; return (s && s !== '—') ? s : ''; }
function evHearAt(e) { const c = evCaseOfKey(e && e.caseId); return c ? evDateOf(c.hearingAt || c.secondHearingAt) : ''; }
function evCloseAt(e) { const c = evCaseOfKey(e && e.caseId); return c ? evDateOf(c.closeAt) : ''; }
function evDateInRange(v, from, to) {
  const d = String(v || '').slice(0, 10);
  const a = String(from || '').slice(0, 10), b = String(to || '').slice(0, 10);
  if (!a && !b) return true;                       // 两端都空 = 该维度不筛
  if (!d) return false;
  if (a && d < a) return false;
  if (b && d > b) return false;
  return true;
}
function evOkDate(e) {
  return evDateInRange(evHearAt(e), EV_FILTER.hearFrom, EV_FILTER.hearTo) &&
         evDateInRange(evCloseAt(e), EV_FILTER.closeFrom, EV_FILTER.closeTo);
}
/* 当前筛选命中的证物行（列表渲染 / 全选 / 导出所选三处共用） */
function filteredEvList() { return EVIDENCES.filter(e => evOkStatus(e) && evOkStage(e) && evOkDate(e)); }
/* 勾选键：caseId|证物编号 —— 证物编号只在同一案件下唯一，拼上 caseId 才能一行一键 */
function evSelKey(e) { return ((e && e.caseId) || '') + '|' + ((e && e.id) || ''); }
// 办案律师：同样按 caseId 反查案件（与「案件进展」列同一份数据源）
function evLawyerOf(e) { const c = evCaseOfKey(e && e.caseId); return c ? lawyerOf(c) : '—'; }
// 面板里每个阶段的数字 = 当前「证物状态」筛选下、该阶段的**案件数**（按 caseId 去重）。
// v132 由「数证物」改为「数案件」：同一案件挂多件证物时数字仍是 1 ——
// 业务上看的是「有多少个案子走到这个阶段」，而不是「这个阶段堆了几件证物」。
function evStageCountOf(k) {
  const ids = new Set();
  EVIDENCES.forEach(e => {
    if (EV_FILTER.status !== '全部' && e.status !== EV_FILTER.status) return;
    if (!evOkDate(e)) return;                       // v148：与「开庭/结案时间」区间联动
    if (stageOfCase(e.caseId) === k) ids.add(e.caseId);
  });
  return ids.size;
}
// 「全部」项 = 当前「证物状态」筛选下、台账涉及的案件数（去重；与各阶段之和相等，不受已选阶段影响）
function evStageCountOfAll() {
  const ids = new Set();
  EVIDENCES.forEach(e => {
    if (EV_FILTER.status === '全部' || e.status === EV_FILTER.status) {
      if (evOkDate(e)) ids.add(e.caseId);          // v148：同上
    }
  });
  return ids.size;
}
function toggleEvStageFilter(ev) {
  if (ev && ev.stopPropagation) ev.stopPropagation();
  const panel = document.getElementById('ev-stage-panel');
  if (!panel) return;
  if (panel.style.display === 'none' || !panel.style.display) {
    closeStageFilter();   // 反向互斥：从证物这边点开时收起「我的案件」的浮层
    renderEvStageFilterPanel();
    panel.style.display = 'block';
    const caret = document.getElementById('ev-stage-caret');
    if (caret && caret.getBoundingClientRect) {
      const r = caret.getBoundingClientRect();
      panel.style.top = (r.bottom + 6) + 'px';
      // 面板宽 240px，贴右边界时向左收，避免出屏
      panel.style.left = Math.max(12, Math.min(r.left - 8, (window.innerWidth || 1280) - 252)) + 'px';
    }
  } else {
    panel.style.display = 'none';
  }
}
function closeEvStageFilter() {
  const panel = document.getElementById('ev-stage-panel');
  if (panel) panel.style.display = 'none';
}
function renderEvStageFilterPanel() {
  const panel = document.getElementById('ev-stage-panel');
  if (!panel) return;
  const set = Array.isArray(EV_FILTER.stageSet) ? EV_FILTER.stageSet : [];
  // 直接遍历 STAGES，不再手抄一份 option：阶段增删自动跟随
  // （旧的原生下拉就是手抄的，漏了「二审」这一档）
  const rows = STAGES.map(st => {
    const checked = set.includes(st.key);
    return `<label class="sfp-item"><input type="checkbox" ${checked ? 'checked' : ''} onchange="toggleEvStageFilterKey('${esc(st.key)}')"><span class="sfp-name">${esc(st.navLabel || st.key)}</span><span class="sfp-count">${evStageCountOf(st.key)}</span></label>`;
  }).join('');
  panel.innerHTML =
    `<div class="sfp-head"><span>筛选案件进展（可多选）</span><button class="btn btn-ghost btn-sm" onclick="clearEvStageFilter()">清除</button></div>` +
    `<label class="sfp-item sfp-all"><input type="checkbox" ${set.length === 0 ? 'checked' : ''} onchange="clearEvStageFilter()"><span class="sfp-name">全部</span><span class="sfp-count">${evStageCountOfAll()}</span></label>` +
    rows;
}
function toggleEvStageFilterKey(k) {
  if (!Array.isArray(EV_FILTER.stageSet)) EV_FILTER.stageSet = [];
  const i = EV_FILTER.stageSet.indexOf(k);
  if (i >= 0) EV_FILTER.stageSet.splice(i, 1); else EV_FILTER.stageSet.push(k);
  renderEvidence();
}
function clearEvStageFilter() {
  EV_FILTER.stageSet = [];
  renderEvidence();
}
// 倒三角激活态 + 面板计数实时刷新（renderEvidence 末尾调用，与「我的案件」的 syncStageFilterUI 同构）
function syncEvStageFilterUI() {
  const caret = document.getElementById('ev-stage-caret');
  const set = Array.isArray(EV_FILTER.stageSet) ? EV_FILTER.stageSet : [];
  if (caret) {
    caret.classList.toggle('active', set.length > 0);
    // 原生下拉撤掉后，当前生效的筛选项只能靠 title 交代清楚
    caret.title = set.length ? '已筛选案件进展：' + set.join(' / ') + '（点击修改）' : '筛选案件进展（可单选/多选）';
  }
  const panel = document.getElementById('ev-stage-panel');
  if (panel && panel.style.display === 'block') renderEvStageFilterPanel();
}
// 点击面板与倒三角之外的区域自动收起
document.addEventListener('click', e => {
  const panel = document.getElementById('ev-stage-panel');
  if (!panel || panel.style.display !== 'block') return;
  if (e.target.closest('#ev-stage-panel') || e.target.closest('#ev-stage-caret')) return;
  closeEvStageFilter();
});

/* ---------- 归档（导出旁醒目按钮）：勾选案件 → 填写结案信息 → 流转待归档 ---------- */
// v124：与待归档阶段表单共用同一行渲染（列序 / 列名 / 收款人手填 完全一致），差异只在容器与行数上限
function archPayRowHTML(p, idx) {
  return payRowHTML(p, idx);
}
function addArchPayRow() {
  const box = document.getElementById('arch-pay-rows');
  const sel = document.getElementById('arch-payType');
  if (sel && sel.value === '一次性付款' && box && box.querySelectorAll('.pay-row').length >= 1) {
    toast('「一次性付款」只能填 1 条付款记录', PAY_ONE_HINT, 'info'); return;
  }
  if (box) { box.insertAdjacentHTML('beforeend', archPayRowHTML({})); renumberPayRows(box); }
}
/* v150：归档类型（用户 2026-09-14 口径）—— 就这 6 种，不要自行加值 */
const ARCHIVE_TYPES = ['案件作废', '和解结案', '调解结案', '判决履行', '执行到款', '执行终本'];

/* v150：待归档 → 已归档（批量终结归档）。
   用户口径：这个按钮在「待归档」流程里点开，弹窗只收 归档日期 / 归档类型 / 归档原因，
   确认后勾选的案件直接变成「已归档」。原来它在这里是「填结案信息 → 流转到待归档」，
   在待归档流程里等于原地打转，等于点不动。 */
function openBulkFinalizeArchive(list) {
  openModal({
    title: `归档 · ${list.length} 件案件`, wide: true, okText: '确认归档', okClass: 'btn-primary',
    bodyHTML: `
      <div class="form-grid">
        <div class="form-field"><label class="form-label">归档日期<span class="req">*</span></label>
          <input class="form-input" type="date" id="fin-arch-at" value="${today()}"></div>
        <div class="form-field"><label class="form-label">归档类型<span class="req">*</span></label>
          <select class="form-select" id="fin-arch-type">${ARCHIVE_TYPES.map(t => `<option>${esc(t)}</option>`).join('')}</select></div>
      </div>
      <div class="form-field"><label class="form-label">归档原因<span class="req">*</span></label>
        <textarea class="form-textarea" id="fin-arch-reason" placeholder="如：判决已履行完毕 / 双方达成和解并已履行"></textarea></div>
      <div class="form-hint">本次归档 ${list.length} 件：${list.map(c => esc(caseNoOf(c))).join('、')}。确认后案件流转为「已归档」。</div>`,
    onSubmit: () => {
      const at = (document.getElementById('fin-arch-at') || {}).value || today();
      const ty = (document.getElementById('fin-arch-type') || {}).value || ARCHIVE_TYPES[0];
      const rs = ((document.getElementById('fin-arch-reason') || {}).value || '').trim();
      if (!rs) { toast('请填写归档原因', '', 'error'); return; }   // 校验失败不关窗
      list.forEach(c => {
        const from = c.status;
        c.archiveAt = at; c.archiveType = ty; c.archiveReason = rs;
        c.status = '已归档'; c.stageCls = 'pill-success'; c.updated = '刚刚';
        pushCaseTimeline(c, `归档（${ty}）：${rs} · ${from} → 已归档`);
        SELECTED.delete(c.id);
      });
      save(); renderCaseStageNav(); renderCases(); updateNavBadges();
      closeModal();   // ⚠ MODAL_OK 存在时外层不自动关窗（6719 行），必须自己关
      toast('案件已归档', `${list.length} 件 → 已归档 · ${ty}`, 'success');
    },
  });
}

function openBulkArchive() {
  const list = STATE.cases.filter(c => SELECTED.has(c.id));
  if (!list.length) { toast('请先勾选案件', '勾选需要归档的案件后再点「归档」', 'info'); return; }
  // v150：「待归档」流程 → 终结归档（待归档 → 已归档）；其余流程维持原「填结案信息 → 待归档」
  if (FILTER.status === '待归档') { openBulkFinalizeArchive(list); return; }
  openModal({
    title: `归档 · ${list.length} 件案件`, wide: true, okText: '提交', okClass: 'btn-primary',
    bodyHTML: `
      <div class="form-grid">
        <div class="form-field"><label class="form-label">案件进展</label>
          <input class="form-input" value="待归档" disabled title="自动流转为待归档，不可更改" style="background:#F4F4F6;color:#A1A1AA;"></div>
        <div class="form-field"><label class="form-label">结案日期</label><input class="form-input" type="date" id="arch-closeAt"></div>
        <div class="form-field"><label class="form-label">结案金额（元）</label><input class="form-input" type="number" id="arch-closeAmt" placeholder="如 80000"></div>
        <div class="form-field"><label class="form-label">结案文书</label>${stageUploadHTML({ k: 'closeDoc', type: 'file' }, '')}</div>
        <div class="form-field"><label class="form-label">付款类型</label>
          <select class="form-select" id="arch-payType" onchange="syncPayRowLimit('arch', true)"><option>一次性付款</option><option>分期付款</option></select></div>
      </div>
      <div class="form-section-title">付款记录（可创建多条）</div>
      <div id="arch-pay-rows">${payHeadHTML()}${archPayRowHTML({}, 1)}</div>
      <button type="button" class="btn btn-secondary btn-sm" id="arch-add-pay-btn" onclick="addArchPayRow()" disabled title="${PAY_ONE_HINT}">+ 增加一笔</button>`,
    onSubmit: () => {
      const g = id => { const el = document.getElementById(id); return el ? String(el.value).trim() : ''; };
      const closeDocEl = document.querySelector('#modal-body [data-fk="closeDoc"]');
      const rows = [];
      $$('#modal-body .pay-row').forEach(row => {
        const g2 = k => { const el = row.querySelector('[data-pk="' + k + '"]'); return el ? String(el.value).trim() : ''; };
        // v124：手填收款人 → 参与「是否算一笔」的判定；不再回落默认「原告」（手填空就是空，由详情显示「—」）
        if (g2('amt') || g2('date') || g2('payer') || g2('payee') || g2('proof')) rows.push({ amt: g2('amt'), date: g2('date'), payer: g2('payer'), payee: g2('payee'), proof: g2('proof') });
      });
      const closeAt = g('arch-closeAt'), closeAmt = g('arch-closeAmt'), payType = g('arch-payType');
      list.forEach(c => {
        c.closeAt = closeAt; c.closeAmt = closeAmt; c.closeDoc = closeDocEl ? closeDocEl.value.trim() : '';
        c.payType = payType;
        if (rows.length) c.payments = rows;
        const from = c.status;
        c.status = '待归档'; c.updated = '刚刚';
        pushCaseTimeline(c, `归档操作：填写结案信息，${from} → 待归档`);
        SELECTED.delete(c.id);
      });
      save(); renderCases(); renderCaseStageNav(); updateNavBadges();
      closeModal();
      toast('已提交归档', `${list.length} 件案件 → 待归档`, 'success');
    },
  });
}

// 统一入口：按当前阶段执行批量操作
function batchStageAction() {
  const st = FILTER.status;
  if (st === '待写诉状') { exportDraftsBatch(); return; }
  if (st === '待写执行材料') { uploadExecDocsBatch(); return; }
  if (st === '执行材料待盖章') { bulkMailExecBatch(); return; }
  if (st === '诉状待盖章') { batchSealDownload(); return; }
  // 其它阶段：批量导出当前阶段清单
  const list = filteredCases();
  if (!list.length) { toast('没有可导出的案件', '', 'info'); return; }
  // 与列表 9 列对齐（另保留案件单号 / 案件名称便于回查）
  const head = ['案件单号', '案件名称', '案件进展', '权利人', '平台', '店铺名', '被告', '标的额', '立案法院', '案号'];
  const rows = list.map(c => {
    return [caseNoOf(c), c.title, c.status, holderName(c), platformOf(c), shopOf(c), defendantNames(c), c.amount, c.court, c.no];
  });
  downloadCSV(`案件_${st}_${today()}.csv`, head, rows);
  toast('已批量导出', `${list.length} 件 · ${st}`);
}

function pushCaseTimeline(c, text) {
  if (!Array.isArray(c.timeline)) c.timeline = [];
  c.timeline.unshift({ t: today(), d: text });
}

function openCaseArchive(id) {
  const c = STATE.cases.find(x => x.id === id); if (!c) return;
  openModal({
    title: '案件归档',
    okText: '确认归档',
    bodyHTML: `
      <div class="form-grid">
        <div class="form-field">
          <label class="form-label">归档日期<span class="req">*</span></label>
          <input class="form-input" type="date" id="cs-archive-at" value="${today()}">
        </div>
        <div class="form-field">
          <label class="form-label">归档类型<span class="req">*</span></label>
          <select class="form-select" id="cs-archive-type">${ARCHIVE_TYPES.map(t => `<option>${esc(t)}</option>`).join('')}</select>
        </div>
      </div>
      <div class="form-field">
        <label class="form-label">归档原因<span class="req">*</span></label>
        <textarea class="form-textarea" id="cs-archive-reason" placeholder="如：结案未结算 / 客户终止"></textarea>
      </div>`,
    onSubmit: () => {
      const at = (document.getElementById('cs-archive-at') || {}).value || today();
      const ty = (document.getElementById('cs-archive-type') || {}).value || ARCHIVE_TYPES[0];
      const rs = ((document.getElementById('cs-archive-reason') || {}).value || '').trim();
      if (!rs) { toast('请填写归档原因', '', 'error'); return; }
      c.archiveAt = at; c.archiveType = ty; c.archiveReason = rs;
      c.status = '已归档'; c.stageCls = 'pill-success';
      pushCaseTimeline(c, `归档（${ty}）：${rs}`);
      renderCaseStageNav(); renderCases(); updateNavBadges(); save();
      closeModal();   // v150：原代码没关窗（MODAL_OK 存在时外层不会自动关）—— 顺手补上
      toast('案件已归档', `${ty} · ${at}`);
    },
  });
}

function advanceCaseStage(id) {
  const c = STATE.cases.find(x => x.id === id); if (!c) return;
  const st = STAGES.find(s => s.key === c.status);
  if (!st || !st.next) { toast('已是最后阶段', c.status, 'info'); return; }
  const from = c.status;
  c.status = st.next;
  const nx = STAGES.find(s => s.key === st.next);
  c.stageCls = nx ? nx.cls : 'pill-neutral';
  c.updated = today();
  pushCaseTimeline(c, `阶段推进：${from} → ${c.status}`);
  renderCaseStageNav(); renderCases(); updateNavBadges(); save();
  toast('阶段已推进', `${from} → ${c.status}`);
}

// 每日检查：开庭日期次日自动流转待判决（autoToJudgeAt 缺失时由开庭日期推导）
function autoFlowCases() {
  const t = today();
  let n = 0;
  STATE.cases.forEach(c => {
    if (c.status !== '待开庭') return;
    const h = String(c.hearingAt || '').slice(0, 10);
    if (h && h !== '—' && !c.autoToJudgeAt) c.autoToJudgeAt = plusDays(h, 1);
    if (c.autoToJudgeAt && c.autoToJudgeAt <= t) {
      c.status = '待判决'; c.stageCls = 'pill-progress';
      pushCaseTimeline(c, `开庭日期 ${h || c.hearingAt} 次日自动流转至待判决`);
      n++;
    }
  });
  if (n) { renderCaseStageNav(); renderCases(); updateNavBadges(); save(); }
}

/* ---------- 每个流程补足 5 条演示案件（只增不减，id 前缀 IP-DEMO-） ----------
   init 时调用：统计每个阶段的现有案件，不足 5 条按需生成，兼容老本地档案（无需重置）。 */
/* v64：文件管理 Tab 的可勾选文件全靠案件上的文书字段，而演示播种只填了流程推进必需的那几个，
   导致 14 格里 10 格常年全灰。这里按「走到这一步本该有什么文书」补种子——
   只补该阶段及之前应产生的，绝不给早期阶段凭空造判决书。 */
const STAGE_DOC_RANK = {
  '案件待匹配': 0, '待写诉状': 0, '诉状待确认': 0, '诉状待盖章': 0, '待提交立案': 0, '转正式立案': 0,
  '待开庭': 1, '待判决': 2, '二审': 3,
  '待写执行材料': 4, '执行材料待确认': 5, '执行材料待盖章': 6,
  '待申请执行立案': 7, '强制执行中': 8, '待归档': 9, '已归档': 10
};
function seedStageDocs(c, stageKey, i) {
  const r = STAGE_DOC_RANK[stageKey] || 0;
  const tag = c.id;
  // 律师协议（结算模式 / 基础费 / 分成比例）：只要已匹配律师就补演示值（案件待匹配阶段还没律师，留空）
  if (stageKey !== '案件待匹配') seedLawyerSettle(c, i + r);
  if (r >= 1) {   // 已立案：受理通知书 + 送达文书 + 披露文件
    c.acceptNotice = '受理通知书_' + tag + '.pdf';
    c.serviceDoc = '送达回证_' + tag + '.pdf';
    c.disclosures = [{ name: '披露-被申请人经营信息.pdf', ext: 'PDF', size: (1.8 + (i % 4) * 0.3).toFixed(1) + ' MB', status: 'OCR 已识别' }];
    // v87：立案后诉讼费必然已缴 → 给费用明细补「已支付 + 缴费凭证」。
    //      v64 播种漏了这格，导致文件管理「缴费凭证」全库 0 个可勾（那格永远灰）。
    if (Array.isArray(c.expenses)) {
      c.expenses.slice(0, 1 + (i % 2)).forEach((e, k) => {
        e.status = '已支付';
        if (!e.proof) e.proof = '缴费凭证_' + tag + '_' + (k + 1) + '.pdf';
      });
    }
  }
  if (r >= 2) {   // 已判决：判决书 + 诉讼退费
    c.judgeDoc = '判决书_' + tag + '.pdf';
    const ra = 800 + (i % 4) * 400;
    c.refunds = (i % 2)
      ? [{ from: '法院', amt: ra, status: '已退' }, { from: '法院', amt: Math.round(ra / 2), status: '待退' }]
      : [{ from: '法院', amt: ra, status: '已退' }];
    c.refundTotal = c.refunds.reduce((a, x) => a + x.amt, 0);
  }
  if (r >= 3) {   // 已二审：二审文书（上诉材料）+ 二审送达文书 + 二审判决书
    c.secondDoc = '二审上诉状_' + tag + '.pdf';
    c.secondServiceDoc = '二审送达回证_' + tag + '.pdf';
    c.secondJudgeDoc = '二审判决书_' + tag + '.pdf';
  }
  if (r >= 4 && !c.execDoc) c.execDoc = '执行申请书_' + tag + '.doc';
  if (r >= 7) c.execFilingShot = '执行立案截图_' + tag + '.png';
  if (r >= 8) c.execFormalDoc = '执行裁定书_' + tag + '.pdf';
  if (r >= 9) {   // 待归档 / 已归档：结案文书 + 付款凭证
    c.closeDoc = '结案文书_' + tag + '.pdf';
    const pa = Number(String(c.amount || '').replace(/[^\d]/g, '')) || 50000;
    const payer = String(c.defendant || '被告').slice(0, 10);
    // v124：付款记录统一字段 —— 补「收款人」（原告方 = 本案权利人），文件名字段 proof 保持不变
    const payee = holderName(c);
    c.payments = [
      { amt: Math.round(pa * 0.6), date: plusDays(today(), -(20 - (i % 5))), payer, payee, proof: '收款截图_' + tag + '_1.pdf' },
      { amt: Math.round(pa * 0.4), date: plusDays(today(), -(8 - (i % 5))), payer, payee, proof: '收款截图_' + tag + '_2.pdf' }
    ];
    c.paidTotal = c.payments.reduce((a, p) => a + p.amt, 0);
    // v93：种子给的是两笔付款 → 付款类型必须与之一致，否则「一次性付款 + 两条记录」自相矛盾
    if (!c.payType) c.payType = '分期付款';
  }
}

/* v32 二审演示数据：上诉人 + 未来几天的二审开庭日期（写入日历「二审开庭」事件）。
   v132：新建的演示案件与本阶段「已有」的案件共用这一份播种逻辑 ——
   后者此前只补文书，界面上就少一场二审开庭（新加的硬编码二审案件正是这种情况）。 */
function seedSecondInstanceDemo(c, i, court) {
  const sd = plusDays(today(), 5 + i);
  const ct = court || c.court || '—';
  c.secondInstanceBy = i % 2 ? '被告' : '原告（我方）';
  c.secondHearingAt = sd;
  c.secondHearingPlace = ct + ' · 第' + (i + 2) + '法庭';
  c.secondJudge = '二审法官' + (i + 1);
  for (let k = CAL_EVENTS.length - 1; k >= 0; k--) {
    if (CAL_EVENTS[k].autoSecondCourt && CAL_EVENTS[k].caseId === c.id) CAL_EVENTS.splice(k, 1);
  }
  CAL_EVENTS.push({ date: sd, type: 'court', autoSecondCourt: true, caseId: c.id, title: '二审开庭 · ' + ct, sub: c.title, time: '', place: c.secondHearingPlace, judge: c.secondJudge });
}

function fillStageDemoCases(list) {
  if (!Array.isArray(list)) return 0;
  const CLIENTS = ['杭州××科技有限公司', '深圳××文化传播有限公司', '广州××食品有限公司', '北京××科技股份有限公司', '上海××设计工作室'];
  const DEFENDS = ['黄某某', '周某某', '吴某某', '郑某某', '冯某某'];
  const PLATFORMS = ['淘宝', '拼多多', '京东', '抖音', '1688'];
  const SHOPS = ['优品专售', '家居旗舰', '日用百货', '工厂直销', '潮流集合', '好物严选', '特价商城', '进口优选'];
  const CAUSES = ['商标侵权', '著作权纠纷', '专利侵权', '不正当竞争'];
  const COURT_POOL = ['广州知识产权法院', '杭州互联网法院', '北京知识产权法院', '上海浦东法院', '深圳中级人民法院'];
  const NO_POOL = ['粤0115', '浙0110', '京0105', '沪0115', '粤0304'];
  const OPERATORS = ['陈晓敏', '林伟', '王敏'];
  const AMTS = [35000, 42000, 58000, 66000, 88000, 95000, 120000, 150000];
  const UPD = ['1 天前', '2 天前', '3 天前', '4 天前', '5 天前'];
  const used = new Set(list.map(c => c.id));
  let added = 0, seq = 1;
  STAGES.forEach((st, si) => {
    // v64：先给本阶段「已有」的案件（硬编码种子）补文书，再补足到 5 个 ——
    //      否则只有新建的 IP-DEMO-* 是满的，硬编码种子案件的文件清单仍然全灰。
    // v132：顺带把「二审」的演示特性也补给已有案件 ——
    //      否则新加进来的硬编码二审案件只补文书，界面上会少一场二审开庭。
    list.filter(c => c.status === st.key).forEach((c, k) => {
      seedStageDocs(c, st.key, k);
      if (st.key === '二审' && !c.secondHearingAt) seedSecondInstanceDemo(c, k, c.court);
    });
    const have = list.filter(c => c.status === st.key).length;
    for (let i = have; i < 5; i++) {
      let id = 'IP-DEMO-' + String(si + 1).padStart(2, '0') + '-' + (i + 1);
      while (used.has(id)) id += 'x';
      used.add(id);
      const client = CLIENTS[(si + i) % CLIENTS.length];
      const pf = PLATFORMS[(si * 3 + i) % PLATFORMS.length];
      const shop = SHOPS[(si * 5 + i * 3) % SHOPS.length];
      const cause = CAUSES[(si + i) % CAUSES.length];
      const pre = PRE_FILING.indexOf(st.key) >= 0;
      // v150：立案前（案件待匹配 / 待写诉状 / 诉状待确认 / 诉状待盖章 / 待提交立案）尚无法院与案号 → 留空，显示层兜「—」
      const court = pre ? '' : COURT_POOL[(si + i) % COURT_POOL.length];
      const c = {
        id,
        title: client.replace('有限公司', '') + ' vs ' + pf + '"' + shop + '" ' + cause + '案',
        no: pre ? '' : `（2026）${NO_POOL[(si + i) % NO_POOL.length]}民初${String(50000 + seq * 37).slice(-5)}号`,
        client, type: '民事', typeTag: 'tag-blue',
        defendant: DEFENDS[(si * 2 + i) % DEFENDS.length] + '经营的"' + shop + '"店铺',
        amount: '¥ ' + AMTS[(si * 3 + i) % AMTS.length].toLocaleString('en-US'),
        court, operator: OPERATORS[(si + i) % OPERATORS.length],
        status: st.key, statusClass: st.cls,
        updated: UPD[i % UPD.length],
      };
      Object.assign(c, caseExtras(c), operatorStyle(c.operator));
      if (st.key === '待开庭') {
        // 开庭日期设在未来几天：避免加载时被 autoFlowCases 立即流转；同时写入日历开庭事件
        const hd = plusDays(today(), 3 + i);
        c.hearingAt = hd;
        c.hearingPlace = court + ' · 第' + (i + 1) + '法庭';
        for (let k = CAL_EVENTS.length - 1; k >= 0; k--) {
          if (CAL_EVENTS[k].autoCourt && CAL_EVENTS[k].caseId === c.id) CAL_EVENTS.splice(k, 1);
        }
        CAL_EVENTS.push({ date: hd, type: 'court', autoCourt: true, caseId: c.id, title: '开庭 · ' + court, sub: c.title, time: '', place: c.hearingPlace, judge: '' });
      } else if (st.key === '二审') {
        seedSecondInstanceDemo(c, i, court);
      } else if (st.key === '诉状待确认' || st.key === '诉状待盖章') {
        const dn = (Array.isArray(c.defendants) && c.defendants[0]) ? c.defendants[0].name : (c.defendant || '被告');
        c.authDoc = '起诉状-' + dn + '.doc';
        c.authDocs = [c.authDoc];   // v145：与数组字段同步
        c.draftAt = plusDays(today(), -(5 - i));
      }
      seedStageDocs(c, st.key, i);
      list.push(c); added++; seq++;
    }
  });
  return added;
}

function renderCaseStageNav() {
  // 根据完整阶段机（STAGES，9 个阶段）动态生成「我的案件」侧栏子目录 + 页内阶段条，
  // 并补一个「全部」入口，保证每个阶段的数据都能在导航中串联、可点选筛选。
  // v65：带 group 标记的连续阶段（待写诉状/诉状待确认/诉状待盖章）折叠为一个「准备起诉文书」入口，
  //      计数 = 组内各阶段之和；点组名进入合并视图，组内子阶段用页内 chip 条切换。
  const total = STATE.cases.length;
  const n = k => STATE.cases.filter(c => c.status === k).length;
  // 折叠后的导航条目：[{ label, status, count }]，group 成员连续折叠
  const navEntries = [];
  STAGES.forEach(s => {
    if (s.group) {
      const prev = navEntries[navEntries.length - 1];
      if (prev && prev.group === s.group) { prev.count += n(s.key); return; }
      navEntries.push({ label: s.group, status: s.group, count: n(s.key), group: s.group });
    } else {
      navEntries.push({ label: s.navLabel || s.key, status: s.key, count: n(s.key) });
    }
  });
  const sub = document.getElementById('cases-sub');
  if (sub) {
    sub.innerHTML =
      `<button class="nav-sub-item" data-status="全部" onclick="gotoCaseStage('全部')">全部 <span class="nav-sub-count" data-c="全部">${total}</span></button>` +
      navEntries.map(e => `<button class="nav-sub-item" data-status="${esc(e.status)}" onclick="gotoCaseStage('${esc(e.status)}')">${esc(e.label)} <span class="nav-sub-count" data-c="${esc(e.status)}">${e.count}</span></button>`).join('');
  }
  const tabs = document.getElementById('case-stage-tabs');
  if (tabs) {
    tabs.innerHTML =
      `<button class="case-stage-tab" data-status="全部" onclick="gotoCaseStage('全部')">全部 <span class="case-stage-count">${total}</span></button>` +
      navEntries.map(e => `<button class="case-stage-tab" data-status="${esc(e.status)}" onclick="gotoCaseStage('${esc(e.status)}')">${esc(e.label)} <span class="case-stage-count">${e.count}</span></button>`).join('');
  }
  syncCasesNav();
}

/* ============================================================
   费用中心（v16）：管理案件支出 / 收入，每条费用清晰可查
   字段：费用类型（枚举见 FEE_TYPES）· 金额 · 状态（发起 / 已支付）
   ============================================================ */
/* v151（用户 2026-09-14）四处口径变更，都记在这里，改数据形状必须同步 bump SAVE_VER：
   ① 「费用中心」不再独占侧边栏 —— 它成为「结算中心」的第三个 tab（客户结算 / 律师结算 / 费用中心）；
   ② 方向（dir）由「按费用类型推导」升级为**存储字段**，与列表「方向」列是同一个字段，可以手工选支出 / 收入；
   ③ 费用类型 = 诉讼退费 → 状态选项收敛为「退原告 / 退律所」（不是 未发起/发起/已支付）；
   ④ 状态多出「未发起」：调查费 / 披露费 / 公证费 / 样品费 在其它入口提交后自动落成「未发起」，
      再经「批量发起」推送到财务系统才变「发起」。 */
const FEE_TYPES = ['诉讼费', '公告费', '调档费', '调查费', '公证费', '披露费', '样品费', '律师费', '诉讼退费', '其他'];
const FEE_INCOME_TYPES = ['诉讼退费'];   // 收入类，其余均为支出
const FEE_DIRS = ['支出', '收入'];       // 方向下拉（与列表「方向」列同一个字段）
const FEE_STATUS = ['未发起', '发起', '已支付'];
// 诉讼退费 = 退款给谁，状态语义与普通费用不同（用户口径）
const FEE_REFUND_STATUS = ['退原告', '退律所'];
function feeStatusOptions(type) {
  return type === '诉讼退费' ? FEE_REFUND_STATUS.slice() : FEE_STATUS.slice();
}
function feeDirection(t) { return FEE_INCOME_TYPES.includes(t) ? '收入' : '支出'; }
// 方向是存储字段：老存档没有 dir 时回落到按类型推导（诉讼退费=收入，其余=支出）
function feeDirOf(f) {
  const o = f || {};
  return (o.dir === '收入' || o.dir === '支出') ? o.dir : feeDirection(o.type);
}
/* 费用中心 ↔ 案件「费用明细」状态对照表（两处状态枚举不同，必须有唯一映射口） */
const FEE_TO_EXP_STATUS = { '未发起': '未发起', '发起': '已发起', '已支付': '已支付' };
function expStatusOfFee(s) { return FEE_TO_EXP_STATUS[s] || '未发起'; }
const EXP_TO_FEE_STATUS = { '未发起': '未发起', '已发起': '发起', '待开票': '发起', '已开票': '发起', '已支付': '已支付' };
function feeStatusOfExp(s) { return EXP_TO_FEE_STATUS[s] || '未发起'; }

/* ---------- v151：费用明细 / 费用中心的**唯一同步写入点** ----------
   用户口径「统一一下费用明细里面的数据来源」：调查费 / 披露费 / 公证费 / 样品费 在别的入口
   （待取证 / 待出证 / 公证台账编辑…）填写并提交后，费用明细自动生成一条，并且同一条**同步出现在费用中心**。
   两侧用同一 id 关联（费用明细侧的 feeId），状态两边各自映射，改任意一侧都会同步另一侧。
   幂等：同一案件 + 同一费用类型 + 自动来源 → 原地更新金额，重复提交不会堆出多条。 */
function pushFeeFromSource(caseId, type, amount, opts) {
  const o = opts || {};
  const amt = Number(amount) || 0;
  const c = STATE.cases.find(x => x && (x.id === caseId || x.notaryId === caseId)) || null;
  if (!c || !(amt > 0)) return null;
  if (!Array.isArray(STATE.fees)) STATE.fees = [];
  if (!Array.isArray(c.expenses)) c.expenses = [];
  let f = STATE.fees.find(x => x && x.caseId === c.id && x.type === type && x.src === 'auto');
  if (!f) {
    f = { id: feeId(), caseId: c.id, type: type, amount: amt, dir: feeDirection(type),
          status: '未发起', date: o.date || today(), src: 'auto', note: o.note || '' };
    STATE.fees.unshift(f);
  } else {
    f.amount = amt;
    if (o.date) f.date = o.date;
  }
  syncExpenseFromFee(f);
  return f;
}
/* 公证侧入口的便捷封装：公证条目 → 它流转出来的案件（出证时写入 case.notaryId）。
   公证阶段早期（未出证）还没有案件，此时不生成费用中心记录 —— 出证那一刻会一次性补齐。 */
function pushFeeForNotary(n, type, amount, date) {
  if (!n) return null;
  const c = STATE.cases.find(x => x && (x.notaryId === n.id || (n.caseId && x.id === n.caseId))) || null;
  return c ? pushFeeFromSource(c.id, type, amount, { date: date }) : null;
}
/* 状态同步：费用中心 → 费用明细（费用导出的状态以费用中心为准） */
function syncExpFromFee(feeId, status) {
  if (!feeId) return;
  STATE.cases.forEach(c => (c.expenses || []).forEach(e => {
    if (e && e.feeId === feeId) { e.status = expStatusOfFee(status); }
  }));
}
/* 状态同步：费用明细 → 费用中心 */
function syncFeeFromExp(feeId, expStatus) {
  if (!feeId) return;
  const f = (STATE.fees || []).find(x => x && x.id === feeId);
  if (f) f.status = feeStatusOfExp(expStatus);
}
function feeSeed() {
  /* v149：① 原来 3 条里有 2 条的 caseId 指向**不存在的案件**（IP-20260520-027 / IP-20260405-014），
            列表「关联案件」只能显示裸单号 → 改挂真实案件；
          ② 3 条太薄，补到 7 条，覆盖诉讼费 / 公证费 / 公告费 / 调查费 / 调档费 / 披露费 / 退费。
     v151：① 每条补上存储字段 dir（方向），与列表「方向」列同源；
          ② 诉讼退费的状态按新口径改成「退原告 / 退律所」（不再是 发起）；
          ③ 补 2 条覆盖「未发起」（批量发起的对象）+「样品费」+「退律所」三种新情形。 */
  return [
    { id: 'FEE-SEED-1', caseId: 'IP-20260315-001', type: '诉讼费',   amount: 6500,  dir: '支出', status: '已支付', date: '2026-04-02' },
    { id: 'FEE-SEED-2', caseId: 'IP-20260508-021', type: '公证费',   amount: 1200,  dir: '支出', status: '发起',   date: '2026-09-01' },
    { id: 'FEE-SEED-3', caseId: 'IP-20260418-022', type: '诉讼退费', amount: 3200,  dir: '收入', status: '退原告', date: '2026-09-08' },
    { id: 'FEE-SEED-4', caseId: 'IP-20260320-007', type: '公告费',   amount: 800,   dir: '支出', status: '已支付', date: '2026-06-12' },
    { id: 'FEE-SEED-5', caseId: 'IP-20260218-002', type: '调查费',   amount: 2600,  dir: '支出', status: '已支付', date: '2026-05-20' },
    { id: 'FEE-SEED-6', caseId: 'IP-20260110-015', type: '调档费',   amount: 600,   dir: '支出', status: '发起',   date: '2026-09-10' },
    { id: 'FEE-SEED-7', caseId: 'IP-20260305-005', type: '披露费',   amount: 1800,  dir: '支出', status: '已支付', date: '2026-07-03' },
    { id: 'FEE-SEED-8', caseId: 'IP-20260315-001', type: '样品费',   amount: 445,   dir: '支出', status: '未发起', date: '2026-09-12' },
    { id: 'FEE-SEED-9', caseId: 'IP-20260508-021', type: '诉讼退费', amount: 1500,  dir: '收入', status: '退律所', date: '2026-09-11' },
  ];
}
/* v151：feeCaseTitle 随「关联案件」列一起删除（列已拆成 平台 / 店铺名 / 被告 / 案号 4 列） */
/* ---------- v151：费用中心 筛选 / 勾选 / 列设置（与案件列表、公证阶段同一套做法） ---------- */
const FEE_FILTER = { type: '所有费用类型', status: '所有状态', dir: '所有方向', from: '', to: '' };
let FEE_SELECTED = new Set();       // 勾选键 = fee.id（跨筛选保留，切筛选不清勾选）
const FEE_COL_DEFS = [
  { key: 'type',      label: '费用类型' },
  { key: 'dir',       label: '方向' },
  { key: 'amount',    label: '金额' },
  { key: 'status',    label: '状态' },
  { key: 'date',      label: '日期' },
  { key: 'platform',  label: '平台' },
  { key: 'shop',      label: '店铺名' },
  { key: 'defendant', label: '被告' },
  { key: 'no',        label: '案号' },
];
let FEE_COL_PREFS = {};
try { FEE_COL_PREFS = JSON.parse(localStorage.getItem('ip_fee_col_prefs_v1') || '{}') || {}; } catch (e) { FEE_COL_PREFS = {}; }
function feeColPrefsOf() {
  const base = {};
  FEE_COL_DEFS.forEach(d => { base[d.key] = true; });
  const saved = FEE_COL_PREFS['*'] || {};
  Object.keys(saved).forEach(k => { if (k in base) base[k] = !!saved[k]; });
  return base;
}
function applyFeeColPrefs() {
  if (!document.getElementById('fee-table')) return;
  const prefs = feeColPrefsOf();
  $$('#fee-table thead th[data-col]').forEach(th => {
    const show = prefs[th.dataset.col] !== false;
    th.style.display = show ? '' : 'none';
    $$('#fee-table tbody tr').forEach(tr => {
      const td = tr.cells[th.cellIndex];
      if (td) td.style.display = show ? '' : 'none';
    });
  });
}
function openFeeColPrefs() {
  const prefs = feeColPrefsOf();
  const items = FEE_COL_DEFS.map(d => `
    <label style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;">
      <input type="checkbox" data-colk="${d.key}"${prefs[d.key] ? ' checked' : ''}> ${d.label}</label>`).join('');
  openModal({
    title: '自定义展示列 · 费用中心', okText: '保存', okClass: 'btn-primary',
    bodyHTML: `<div class="form-hint" style="margin-bottom:8px;">「选择框」为固定列，不可取消；勾选后自动保存，下次进入费用中心自动应用。</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;">${items}</div>`,
    onSubmit: () => {
      const saved = {};
      $$('#modal-body [data-colk]').forEach(el => { saved[el.dataset.colk] = el.checked; });
      FEE_COL_PREFS['*'] = saved;
      try { localStorage.setItem('ip_fee_col_prefs_v1', JSON.stringify(FEE_COL_PREFS)); } catch (e) {}
      applyFeeColPrefs();
      closeModal();
      toast('展示列已保存', '费用中心 · 下次进入自动应用', 'success');
    },
  });
}
function feeFiltered() {
  return (Array.isArray(STATE.fees) ? STATE.fees : []).filter(f => {
    if (!f) return false;
    if (FEE_FILTER.type !== '所有费用类型' && f.type !== FEE_FILTER.type) return false;
    if (FEE_FILTER.status !== '所有状态' && f.status !== FEE_FILTER.status) return false;
    if (FEE_FILTER.dir !== '所有方向' && feeDirOf(f) !== FEE_FILTER.dir) return false;
    const d = String(f.date || '');
    if (FEE_FILTER.from || FEE_FILTER.to) {
      if (!d) return false;                                   // 没日期的费用在区间筛选下不出现（而不是静默通过）
      if (FEE_FILTER.from && d < FEE_FILTER.from) return false;
      if (FEE_FILTER.to && d > FEE_FILTER.to) return false;
    }
    return true;
  });
}
function applyFeeFilter() {
  const g = id => { const el = document.getElementById(id); return el ? el.value : ''; };
  FEE_FILTER.type = g('fee-f-type') || '所有费用类型';
  FEE_FILTER.status = g('fee-f-status') || '所有状态';
  FEE_FILTER.dir = g('fee-f-dir') || '所有方向';
  FEE_FILTER.from = g('fee-f-from');
  FEE_FILTER.to = g('fee-f-to');
  renderFees();
}
function clearFeeFilter() {
  ['fee-f-type', 'fee-f-status', 'fee-f-dir'].forEach(id => { const el = document.getElementById(id); if (el) el.selectedIndex = 0; });
  ['fee-f-from', 'fee-f-to'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  FEE_FILTER.type = '所有费用类型'; FEE_FILTER.status = '所有状态'; FEE_FILTER.dir = '所有方向';
  FEE_FILTER.from = ''; FEE_FILTER.to = '';
  renderFees();
  toast('筛选已清除', '费用中心 · 显示全部费用', 'info');
}
function toggleFeeSel(id) {
  if (!id) return;
  if (FEE_SELECTED.has(id)) FEE_SELECTED.delete(id); else FEE_SELECTED.add(id);
  renderFees();
}
function toggleAllFeeSel() {
  const rows = feeFiltered();
  const on = rows.length > 0 && rows.every(f => FEE_SELECTED.has(f.id));
  FEE_SELECTED.clear();
  if (!on) rows.forEach(f => FEE_SELECTED.add(f.id));
  renderFees();
}
function selectedFees() {
  const all = Array.isArray(STATE.fees) ? STATE.fees : [];
  return all.filter(f => f && FEE_SELECTED.has(f.id));
}
function updateFeeSelUI(rows) {
  const sel = (rows || []).filter(f => FEE_SELECTED.has(f.id));
  const unl = sel.filter(f => f.status === '未发起');
  const info = document.getElementById('fee-sel-info');
  if (info) info.textContent = sel.length
    ? `已勾选 ${sel.length} 条 · 其中「未发起」${unl.length} 条，可点「批量发起」推送财务系统`
    : `勾选状态为「未发起」的费用后点「批量发起」推送到财务系统（当前 ${rows ? rows.length : 0} 条，表头方框 = 全选本页）`;
  const lb = document.getElementById('fee-bulk-launch');
  if (lb) lb.disabled = unl.length === 0;
  const db = document.getElementById('fee-bulk-del');
  if (db) db.disabled = sel.length === 0;
}
/* 关联案件：平台 / 店铺名 / 被告 / 案号 一律从案件本身取，不在费用记录里存副本 */
function feeCaseOf(f) { return STATE.cases.find(x => x && x.id === (f && f.caseId)) || null; }
function feeCaseCells(f) {
  const c = feeCaseOf(f);
  if (!c) return { platform: '', shop: '', defendant: '', no: '' };
  const def = defendantNames(c);
  return {
    platform: platformOf(c) || '',
    shop: shopOf(c) || '',
    defendant: (def && def !== '—') ? def : '',
    no: normBlank(c.no) || '',
  };
}
function feeStatusCell(f) {
  const opts = feeStatusOptions(f.type);
  // 老数据的存量状态（如诉讼退费曾是「发起」）不在新选项里 → 前置成第一个选项回显，避免打开就静默改值
  if (f.status && opts.indexOf(f.status) < 0) opts.unshift(f.status);
  return `<select class="exp-status-sel" onchange="setFeeStatus('${esc(f.id)}', this.value)">` +
    opts.map(s => `<option value="${esc(s)}"${f.status === s ? ' selected' : ''}>${esc(s)}</option>`).join('') + '</select>';
}
function setFeeStatus(id, val) {
  const f = (STATE.fees || []).find(x => x && x.id === id); if (!f) return;
  f.status = val;
  syncExpFromFee(f.id, val);
  save(); renderFees(); renderExpenses();
  toast('费用状态已更新', `${f.type} · ${val}`, 'info');
}

function renderFees() {
  const all = Array.isArray(STATE.fees) ? STATE.fees : [];
  const fees = feeFiltered();
  const out = all.reduce((a, f) => {
    const amt = Number(f.amount) || 0;
    if (feeDirOf(f) === '收入') a.income += amt;
    else { a.expense += amt; if (f.status === '发起') a.pending += amt; }
    a.pendingCnt += (f.status === '发起' && feeDirOf(f) === '支出') ? 1 : 0;
    return a;
  }, { expense: 0, income: 0, pending: 0, pendingCnt: 0 });
  const kpi = document.getElementById('fee-kpi');
  if (kpi) kpi.innerHTML = `
    <div class="stat"><div class="stat-label">支出合计</div><div class="stat-value">${money0(out.expense)}</div><div class="stat-sub">${all.length} 条记录</div></div>
    <div class="stat"><div class="stat-label">收入合计（诉讼退费）</div><div class="stat-value">${money0(out.income)}</div><div class="stat-sub">—</div></div>
    <div class="stat"><div class="stat-label">待支付</div><div class="stat-value">${money0(out.pending)}</div><div class="stat-sub">${out.pendingCnt} 笔待支付</div></div>`;
  // 筛选下拉的选项固定按枚举渲染（枚举变了就重建，避免「枚举加了新状态但下拉里没有」这种静默缺口）
  const sel = (id, cur, opts) => {
    const el = document.getElementById(id); if (!el) return;
    const same = el.options.length === opts.length &&
      Array.prototype.every.call(el.options, (o, i) => o.value === opts[i]);
    if (!same) el.innerHTML = opts.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
    el.value = opts.indexOf(cur) >= 0 ? cur : opts[0];
  };
  sel('fee-f-type', FEE_FILTER.type, ['所有费用类型'].concat(FEE_TYPES));
  sel('fee-f-status', FEE_FILTER.status, ['所有状态'].concat(FEE_STATUS, FEE_REFUND_STATUS));
  sel('fee-f-dir', FEE_FILTER.dir, ['所有方向'].concat(FEE_DIRS));
  const box = document.getElementById('fee-table');
  if (!box) return;
  if (!fees.length) {
    box.innerHTML = '<div class="empty">' + (all.length ? '当前筛选条件下没有费用记录。' : '暂无费用记录，点击「+ 新增费用」创建。') + '</div>';
    updateFeeSelUI([]);
    return;
  }
  const prefs = feeColPrefsOf();
  const th = (key, label, cls) => `<th data-col="${key}"${cls ? ` class="${cls}"` : ''}${prefs[key] === false ? ' style="display:none;"' : ''}>${label}</th>`;
  const allOn = fees.every(f => FEE_SELECTED.has(f.id));
  box.innerHTML = `<table class="table"><thead><tr>
      <th style="width:34px;"><div class="checkbox${allOn ? ' checked' : ''}" onclick="toggleAllFeeSel()" title="全选 / 取消全选（当前筛选结果）"></div></th>
      ${th('type', '费用类型')}${th('dir', '方向')}${th('amount', '金额', 'num')}${th('status', '状态')}${th('date', '日期')}
      ${th('platform', '平台')}${th('shop', '店铺名')}${th('defendant', '被告')}${th('no', '案号')}
    </tr></thead><tbody>` +
    fees.map(f => {
      const cc = feeCaseCells(f);
      return `<tr>
      <td><div class="checkbox${FEE_SELECTED.has(f.id) ? ' checked' : ''}" onclick="toggleFeeSel('${esc(f.id)}')"></div></td>
      <td>${esc(f.type)}</td>
      <td><span class="pill ${feeDirOf(f) === '收入' ? 'pill-success' : 'pill-neutral'}">${feeDirOf(f)}</span></td>
      <td class="num mono">${money0(f.amount)}</td>
      <td>${feeStatusCell(f)}</td>
      <td class="mono">${esc(f.date || '—')}</td>
      <td>${esc(cc.platform || '—')}</td>
      <td>${esc(cc.shop || '—')}</td>
      <td>${esc(cc.defendant || '—')}</td>
      <td class="mono">${esc(cc.no || '—')}</td>
    </tr>`; }).join('') + '</tbody></table>';
  applyFeeColPrefs();
  updateFeeSelUI(fees);
}
function feeId() { return 'FEE-' + Date.now().toString(36).toUpperCase(); }
/* ---------- v151：关联案件 —— 可筛选选择器（店铺名 / 权利主体 / 被告 / 案号） ----------
   原先是原生 select（几百个案件只能滚动找），用户 2026-09-14 要求改成筛选框。
   交互与「匹配律师」的 lw-picker 同款：输入即筛选，点选后写进隐藏域。 */
function casePickKeys(c) {
  const def = defendantNames(c);
  return [shopOf(c), c.client, (def === '—' ? '' : def), normBlank(c.no), c.title, caseNoOf(c)]
    .map(s => String(s || '').toLowerCase()).filter(Boolean);
}
function casePickLabel(c) { return caseNoOf(c) + ' | ' + (c.title || ''); }
function casePickerHTML(boxId, curId) {
  const cur = STATE.cases.find(c => c && c.id === curId);
  return `<div class="lw-picker">
    <input class="form-input" id="${boxId}-q" autocomplete="off"
      placeholder="输入 店铺名 / 权利主体 / 被告 / 案号 筛选" value="${cur ? esc(casePickLabel(cur)) : ''}"
      oninput="casePickMenu(this)" onfocus="casePickMenu(this)">
    <input type="hidden" id="${boxId}-v" value="${cur ? esc(cur.id) : ''}">
    <div class="lw-menu" style="display:none;"></div>
  </div>`;
}
function casePickMenu(inp) {
  const box = inp.parentElement;
  const menu = box.querySelector('.lw-menu');
  if (!menu) return;
  const curId = (box.querySelector('input[type=hidden]') || {}).value || '';
  const cur = STATE.cases.find(c => c && c.id === curId);
  // 已选中的标签文本本身会命中关键词，一点开就只剩 1 条 → 未改动时不参与筛选
  const raw = String(inp.value || '').trim();
  const kw = (cur && raw === casePickLabel(cur)) ? '' : raw.toLowerCase();
  const list = STATE.cases.filter(c => !kw || casePickKeys(c).some(k => k.indexOf(kw) >= 0)).slice(0, 40);
  menu.innerHTML = list.length
    ? list.map(c => `<div class="lw-item" data-id="${esc(c.id)}" onclick="casePickChoose(this)"><b>${esc(caseNoOf(c))}</b><span>${esc(c.title || '')} · ${esc(shopOf(c) || '—')} · ${esc(defendantNames(c))}</span></div>`).join('')
    : '<div class="lw-item lw-empty">没有匹配的案件</div>';
  menu.style.display = 'block';
}
function casePickChoose(el) {
  const box = el.closest('.lw-picker');
  if (!box) return;
  const id = el.dataset.id || '';
  const c = STATE.cases.find(x => x && x.id === id);
  const q = box.querySelector('input.form-input');
  const v = box.querySelector('input[type=hidden]');
  if (v) v.value = id;
  if (q) q.value = c ? casePickLabel(c) : '';
  const menu = box.querySelector('.lw-menu');
  if (menu) menu.style.display = 'none';
}
function casePickRead(boxId) {
  const v = document.getElementById(boxId + '-v');
  return v ? v.value : '';
}
/* 费用类型 → 状态下拉联动：诉讼退费的选项是（退原告 / 退律所），其余是（未发起 / 发起 / 已支付） */
function syncFeeStatusOptions(boxId) {
  const id = boxId || 'fee-pick';
  const t = document.getElementById(id + '-type');
  const s = document.getElementById(id + '-status');
  if (!t || !s) return;
  const keep = s.value;
  const opts = feeStatusOptions(t.value);
  s.innerHTML = opts.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
  s.value = opts.indexOf(keep) >= 0 ? keep : opts[0];
}
/* 费用中心新增的费用 → 同步生成案件「费用明细」一条（统一数据来源的另一半） */
function syncExpenseFromFee(f) {
  const c = STATE.cases.find(x => x && x.id === (f && f.caseId));
  if (!c || !f) return;
  if (!Array.isArray(c.expenses)) c.expenses = [];
  let e = c.expenses.find(x => x && x.feeId === f.id);
  if (!e) { e = { feeId: f.id, name: f.type, amt: 0, status: '未发起', proof: '' }; c.expenses.push(e); }
  e.name = f.type; e.amt = Number(f.amount) || 0; e.status = expStatusOfFee(f.status);
  c.updated = '刚刚';
}

function addFee(prefill) {
  const p = prefill || {};
  const pid = 'fee-pick';
  const curType = p.type || '诉讼费';
  const stOpts = feeStatusOptions(curType);
  formModal({
    title: '新增费用', wide: true, submitText: '创建',
    fields: [
      { type: 'custom', key: 'caseId', span: 2, label: '关联案件',
        read: () => casePickRead(pid),
        html: casePickerHTML(pid, p.caseId || '') + '<div class="form-hint">支持按 店铺名 / 权利主体 / 被告 / 案号 筛选</div>' },
      { type: 'custom', key: 'type', label: '费用类型', read: () => { const el = document.getElementById(pid + '-type'); return el ? el.value : ''; },
        html: `<select class="form-select" id="${pid}-type" onchange="syncFeeStatusOptions('${pid}')">${FEE_TYPES.map(t => `<option value="${esc(t)}"${t === curType ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>` },
      { type: 'custom', key: 'dir', label: '方向', read: () => { const el = document.getElementById(pid + '-dir'); return el ? el.value : ''; },
        html: `<select class="form-select" id="${pid}-dir">${FEE_DIRS.map(d => `<option value="${d}"${d === (p.dir || feeDirection(curType)) ? ' selected' : ''}>${d}</option>`).join('')}</select>` },
      { key: 'amount', label: '金额（元）', type: 'number', value: p.amount != null ? p.amount : '', placeholder: '如：6500' },
      { type: 'custom', key: 'status', label: '状态', read: () => { const el = document.getElementById(pid + '-status'); return el ? el.value : ''; },
        html: `<select class="form-select" id="${pid}-status">${stOpts.map(s => `<option value="${esc(s)}"${s === p.status ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select>` },
      { key: 'date', label: '日期', type: 'date', value: p.date || today() },
    ],
    onSubmit: (vals) => {
      const caseId = String(vals.caseId || '');
      if (!STATE.cases.some(c => c && c.id === caseId)) {
        toast('请选择关联案件', '可按 店铺名 / 权利主体 / 被告 / 案号 筛选后再点选', 'error'); return false;
      }
      const amt = Number(vals.amount);
      if (!(amt > 0)) { toast('请填写金额', '金额需大于 0', 'error'); return false; }
      const f = {
        id: feeId(), caseId: caseId, type: vals.type, amount: amt,
        dir: vals.dir === '收入' ? '收入' : '支出',
        status: vals.status || feeStatusOptions(vals.type)[0],
        date: vals.date || today(), src: 'manual', proof: '',
      };
      STATE.fees.unshift(f);
      syncExpenseFromFee(f);
      save(); renderFees(); renderExpenses(); updateNavBadges();
      toast('费用已创建', `${f.type} · ${money0(amt)} · ${f.status}（已同步案件费用明细）`, 'success');
      return true;
    },
  });
}
/* ---------- v151：批量发起 —— 只处理「未发起」的费用，推送到财务系统后置为「发起」 ---------- */
function bulkLaunchFee() {
  const sel = selectedFees();
  if (!sel.length) { toast('请先勾选费用', '勾选状态为「未发起」的费用后可批量发起', 'info'); return; }
  const ready = sel.filter(f => f.status === '未发起');
  if (!ready.length) { toast('没有可发起的费用', '所选费用的状态都不是「未发起」', 'info'); return; }
  const total = ready.reduce((a, f) => a + (Number(f.amount) || 0), 0);
  confirmModal({
    title: '批量发起',
    message: `将 <b>${ready.length}</b> 条「未发起」费用推送至财务系统，合计 <b>${money0(total)}</b>。`
      + `<br>推送后状态变更为「发起」：<br><b>${ready.map(f => esc(f.type) + ' ' + money0(f.amount)).join(' · ')}</b>`,
    okText: '确认发起',
    onOk: () => {
      ready.forEach(f => { f.status = '发起'; f.launchedAt = today(); syncExpFromFee(f.id, f.status); });
      FEE_SELECTED.clear();
      save(); renderFees(); renderExpenses(); updateNavBadges();
      toast('已推送财务系统', `${ready.length} 条费用 · 状态：未发起 → 发起`, 'success');
    },
  });
}
/* ---------- v151：批量删除（用户口径：行内「操作」列的动作按钮去掉，改为工具条上一个删除按钮） ---------- */
function bulkDelFee() {
  const sel = selectedFees();
  if (!sel.length) { toast('请先勾选费用', '支持多选后批量删除', 'info'); return; }
  confirmModal({
    title: '删除费用',
    message: `确认删除选中的 <b>${sel.length}</b> 条费用？<br><b>${sel.map(f => esc(f.type) + ' ' + money0(f.amount)).join(' · ')}</b>`
      + '<br><span style="color:var(--color-ink-muted);">关联案件「费用明细」里的对应记录会同步移除。</span>',
    okText: '确认删除', danger: true,
    onOk: () => {
      const ids = sel.map(f => f.id);
      STATE.fees = (STATE.fees || []).filter(f => ids.indexOf(f.id) < 0);
      STATE.cases.forEach(c => {
        if (Array.isArray(c.expenses)) c.expenses = c.expenses.filter(e => !e || ids.indexOf(e.feeId) < 0);
      });
      FEE_SELECTED.clear();
      save(); renderFees(); renderExpenses(); updateNavBadges();
      toast('已删除', `${ids.length} 条费用`, 'info');
    },
  });
}

/* ---------- 转正式立案：发起缴费（诉讼费）→ 自动保存 → 跳转费用中心并创建「发起」记录 ---------- */
function openPayFeeInit(id) {
  const c = STATE.cases.find(x => x.id === id); if (!c) return;
  // 打开缴费弹窗会替换 #modal-body，先趁立案表单还在收集保存已填内容（不流转）
  const st = STAGES.find(s => s.key === c.status);
  if (st) {
    const body = document.getElementById('modal-body') || document;
    let touched = false;
    st.fields.forEach(f => {
      if (f.type === 'payments') return;
      const el = body.querySelector('[data-fk="' + f.k + '"]');
      if (el) { c[f.k] = (f.type === 'number') ? (Number(el.value) || 0) : el.value; touched = true; }
    });
    if (touched) pushCaseTimeline(c, '立案信息已保存（发起缴费时自动保存）');
  }
  openModal({
    title: '发起缴费',
    okText: '确认发起',
    bodyHTML: `
      <div class="form-field">
        <label class="form-label">费用类型</label>
        <input class="form-input" value="诉讼费" readonly>
      </div>
      <div class="form-field">
        <label class="form-label">金额（元）<span class="req">*</span></label>
        <input class="form-input" type="number" id="pay-fee-amt" min="0" placeholder="如：6500">
      </div>
      <div class="form-hint">确认后将在「费用中心」创建一条状态为<b>发起</b>的缴费记录。</div>`,
    onSubmit: () => {
      const amtRaw = ((document.getElementById('pay-fee-amt') || {}).value || '').trim();
      const amt = Number(amtRaw);
      if (!amtRaw || !(amt > 0)) { toast('请填写金额', '金额需大于 0', 'error'); return false; }
      const f = { id: feeId(), caseId: c.id, type: '诉讼费', amount: amt, dir: '支出',
                  status: '发起', date: today(), src: 'manual', proof: '' };
      STATE.fees.unshift(f);
      syncExpenseFromFee(f);   // v151：费用明细与费用中心同源，发起缴费同时落两边
      c.updated = '刚刚';
      pushCaseTimeline(c, '发起缴费：诉讼费 ' + money0(amt) + '（状态：发起）');
      save(); renderCaseStageNav(); renderCases(); updateNavBadges(); renderFees();
      closeModal();
      goFees();
      toast('缴费已发起', '已在费用中心创建「诉讼费 · ' + money0(amt) + ' · 发起」');
      return true;
    },
  });
}

function renderKPI() {
  const cs = STATE.cases;
  const n = k => cs.filter(c => c.status === k).length;
  const done = n('已归档');
  // 诉前 = 案件待匹配 / 待写诉状 / 诉状待确认 / 诉状待盖章 / 待提交立案 5 流程总和
  // 诉中 = 转正式立案 / 待开庭 / 待判决 3 流程总和
  const preFiling = n('案件待匹配') + n('待写诉状') + n('诉状待确认') + n('诉状待盖章') + n('待提交立案');
  const inTrial = n('转正式立案') + n('待开庭') + n('待判决');
  const kpi = [
    ['诉前', preFiling, `立案前 ${n('待提交立案')} 件`],
    ['诉中', inTrial, `开庭 ${n('待开庭')} 件 · 判决 ${n('待判决')} 件`],
    ['强制执行中', n('强制执行中'), `待归档 ${n('待归档')} 件`],
    ['已归档', done, '本月累计'],
  ];
  const box = $('#kpi-row');
  if (!box) return;
  box.innerHTML = kpi.map(([l, v, t]) => `
    <div class="stat">
      <div class="stat-label">${l}</div>
      <div class="stat-value">${v} <span class="unit">件</span></div>
      <div class="stat-trend flat">${esc(t)}</div>
    </div>`).join('');
}

function renderAll() {
  // 逐模块容错：任一模块渲染抛错都不会中断后续模块，杜绝「一个模块出错导致后面模块数据全空」
  const safe = (fn, label) => { try { fn(); } catch (e) { if (window.console) console.error('[render fail]', label, e); } };
  safe(renderCaseStageNav, 'stageNav');
  safe(renderKPI, 'kpi');
  safe(renderFilterCounts, 'filterCounts');
  safe(renderLeads, 'leads');
  safe(renderNotary, 'notary');
  safe(renderEvidence, 'evidence');
  safe(renderCalendar, 'calendar');
  safe(renderSettlementSplit, 'settlement');
  safe(renderFees, 'fees');
  safe(renderCases, 'cases');
  safe(renderCustomers, 'customers');
  safe(renderReports, 'reports');
  safe(renderSettings, 'settings');
  safe(updateNavBadges, 'navBadges');
  safe(renderCustomers, 'customers2');
  if (currentCaseId) safe(() => renderCaseDetail(), 'caseDetail');
  // 客户详情默认指向第一个客户（与 HTML 静态默认内容一致），
  // 否则结算记录会一直停留在 HTML 里写死的示例行上
  if (!currentCustomerId && STATE.customers.length) currentCustomerId = STATE.customers[0].id;
  if (currentCustomerId) safe(() => renderCustomerDetail(), 'customerDetail');
}

// ============================================================
// 5. 案件详情
// ============================================================
function curCase() { return STATE.cases.find(c => c.id === currentCaseId); }

function openCase(id) {
  currentCaseId = id;
  renderCaseDetail();
  showView('detail');
  // v12：详情页 tab 收敛为 3 个（案件详情 / 文件管理 / 费用管理），默认进「案件详情」
  switchTab('t-detail');
}

function renderCaseDetail() {
  const c = curCase();
  if (!c) return;
  const st = stageOf(c.status);

  $('#detail-title').textContent = c.title;
  // v150：案号为空时显示纯横杠（原来会渲染出「案号： · 客户：…」这种断头文案）
  $('#detail-sub').textContent = `案号：${normBlank(c.no) || '—'} · 客户：${c.cust || c.client} · 案件进展：${c.status}`;
  $('#crumb-current').textContent = c.title.length > 18 ? c.title.slice(0, 18) + '…' : c.title;

  // 头部状态 + 推进按钮（案件待匹配未补充被告时 → 「补充被告」）
  const badge = `<span class="pill ${st.cls}" style="align-self:center;">${esc(c.status)}</span>`;
  const head = $('#detail-head-actions');
  const cta = caseCta(c);
  const ctaFn = cta === '补充被告' ? `supplementDefendants('${c.id}')` : `caseStageForm('${c.id}')`;
  head.innerHTML = badge + `<button class="btn btn-danger" onclick="deleteCase('${c.id}')" title="删除案件">删除</button>` + (cta
    ? `
       <button class="btn btn-primary" onclick="${ctaFn}">
         <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8h10m0 0L9 4m4 4l-4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
         ${esc(cta)}
       </button>`
    : `<button class="btn btn-secondary" onclick="reopenCase()">重新开启</button>`);

  // v151：详情页顶部「案件进展 · 标的额」CTA 横幅（#detail-cta）已按用户要求整体删除，
  //       推进入口只保留右上角 page-actions 里的按钮 —— 不要再往回写这个容器。

  // v12：3 个 tab 的内容渲染（每个 tab-panel 内有自己的容器 id）
  // t-detail：4 折叠面板（动态）+ 流程时间轴
  safeRender(() => renderCollapsePanels(c));
  renderTimelineOf(c);
  // t-files：案件全流程文书字段清单
  renderCaseFilesTab(c);
  // t-costs：关键金额 / 费用明细 / 客户结算 / 律师结算
  renderOverview(c);
  renderExpenses();
  renderSettleTab(c);
  // 头部 tab 阶段锚点（files / costs 2 个 dot）
  renderTabDots(c);
  applyOverrides(c);
  initInlineEdit();
}

function renderTimelineOf(c) {
  const log = c.log || [];
  const box = $('#overview-timeline');
  if (!box) return;
  box.innerHTML = log.map(t => `
    <div class="timeline-item ${t.state}">
      <div class="timeline-time">${esc(t.time)}${t.actor && t.actor !== '—' ? `<span class="actor">${esc(t.actor)}</span>` : ''}</div>
      <div class="timeline-title">${esc(t.title)}</div>
      <div class="timeline-desc">${esc(t.desc)}</div>
    </div>`).join('');
  // v33：流程时间轴与上方折叠卡片行为对齐——每次打开案件回到「收起」态，避免长列表把页面撑满
  const card = document.getElementById('detail-timeline-card');
  if (card) {
    card.classList.remove('open');
    const caret = card.querySelector('.caret'); if (caret) caret.textContent = '▸';
    const stat  = card.querySelector('.status'); if (stat) stat.textContent = '展开';
  }
}

/* ---------- v82：费用状态 = 存储字段（5 态），由后续财务系统写入，不随案件流程派生 ----------
   派生逻辑已移除：状态不再根据案件阶段/凭证/付款记录自动计算，仅读取费用对象上存储的 status。
   财务系统接入前，可在费用明细表格内手动下拉维护（占位），接入后由系统覆盖并建议锁定 UI。 */
const EXP_STATUS = ['未发起', '已发起', '待开票', '已开票', '已支付'];
const EXP_STATUS_CLS = { '未发起': 'pill-neutral', '已发起': 'pill-info', '待开票': 'pill-warning', '已开票': 'pill-progress', '已支付': 'pill-success' };
// 仅读取存储值，不做任何流程派生
function expStatusOf(c, e) {
  e = e || {};
  return e.status || '未发起';
}

/* 费用明细表；srcIdx >= 0 = 「合并后案件」里第 srcIdx 个源店铺的数据
   （动作改走 mergedExpense* 系列，写回 case.mergedFrom[srcIdx].expenses，不污染合并壳） */
function expenseRowsHTML(c, srcIdx) {
  const list = c.expenses || [];
  const si = (typeof srcIdx === 'number' && srcIdx >= 0) ? srcIdx : -1;
  const aStatus = i => si < 0 ? `setExpenseStatus(${i}, this.value)` : `mergedExpenseStatus(${si}, ${i}, this.value)`;
  const aProof  = i => si < 0 ? `pickExpenseProof(${i})` : `mergedExpenseProof(${si}, ${i})`;
  const aClear  = i => si < 0 ? `clearExpenseProof(${i})` : `mergedExpenseClearProof(${si}, ${i})`;
  const aDel    = i => si < 0 ? `removeExpense(${i})` : `mergedExpenseRemove(${si}, ${i})`;
  const total = list.reduce((s, e) => s + Number(e.amt || 0), 0);
  return list.map((e, i) => `
    <tr>
      <td>${esc(e.name)}</td>
      <td class="num">${money(e.amt)}</td>
      <td><select class="exp-status-sel" onchange="${aStatus(i)}">${EXP_STATUS.map(s => `<option value="${s}" ${expStatusOf(c, e) === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
      <td>${e.proof
        ? `<span class="link-mono" title="${esc(e.proof)}">${esc(e.proof)}</span>
           <button class="btn btn-ghost btn-sm btn-icon" onclick="${aClear(i)}" title="移除凭证">×</button>`
        : `<button class="btn btn-ghost btn-sm" onclick="${aProof(i)}">上传</button>`}</td>
      <td style="width:32px;"><button class="btn btn-ghost btn-sm btn-icon" onclick="${aDel(i)}">×</button></td>
    </tr>`).join('') +
    `<tr style="background:var(--color-surface-2);">
      <td style="color:var(--color-ink);font-weight:500;">合计</td>
      <td class="num" style="color:var(--color-primary);font-weight:600;">${money(total)}</td>
      <td><span class="tag">${list.length} 笔</span></td>
      <td><span class="tag">${list.filter(e => e.proof).length} 份凭证</span></td>
      <td></td>
    </tr>`;
}
function expenseTotalOf(c) { return (c.expenses || []).reduce((s, e) => s + Number(e.amt || 0), 0); }
/* 案件的全部费用：合并案件 = 各源店铺费用之和（合并壳自己不持有费用） */
function allExpensesOf(c) {
  const srcs = mergedSourcesOf(c);
  return srcs ? srcs.reduce((a, s) => a.concat(s.expenses || []), []) : ((c && c.expenses) || []);
}

/* 合并后案件：源店铺费用动作 —— 写回 case.mergedFrom[si] */
function mergedExpenseItem(si, i) {
  const c = curCase();
  const s = (c && mergedSourcesOf(c)) ? c.mergedFrom[si] : null;
  if (!s || !Array.isArray(s.expenses) || !s.expenses[i]) return null;
  return { c, s, e: s.expenses[i] };
}
function mergedExpenseStatus(si, i, val) {
  const o = mergedExpenseItem(si, i); if (!o) return;
  o.e.status = val; save(); renderExpenses();
  toast('费用状态已更新', (shopOf(o.s) || '—') + ' · ' + o.e.name + ' · ' + val, 'info');
}
function mergedExpenseProof(si, i) {
  const o = mergedExpenseItem(si, i); if (!o) { toast('请先选中一笔费用', '', 'info'); return; }
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.onchange = () => {
    const f = (inp.files || [])[0];
    if (!f || !f.name) return;
    const o2 = mergedExpenseItem(si, i); if (!o2) return;
    o2.e.proof = f.name; save(); renderExpenses();
    toast('缴费凭证已上传', o2.e.name + ' · ' + f.name);
  };
  inp.click();
}
function mergedExpenseClearProof(si, i) {
  const o = mergedExpenseItem(si, i); if (!o) return;
  o.e.proof = ''; save(); renderExpenses();
  toast('已移除缴费凭证', o.e.name, 'info');
}
function mergedExpenseRemove(si, i) {
  const o = mergedExpenseItem(si, i); if (!o) return;
  const nm = o.e.name;
  o.s.expenses.splice(i, 1); save(); renderExpenses();
  toast('已删除费用', nm, 'info');
}

function renderExpenses() {
  const c = curCase(); if (!c) return;
  const srcs = mergedSourcesOf(c);
  const cards = $('#expense-shop-cards');
  const mainTable = $('#expense-main-table');
  // v146 合并起诉：按店铺分组，每个源店铺一张小卡片（整块原样搬，动作写回各自源店铺）
  if (srcs) {
    if (cards) cards.innerHTML = srcs.map((s, i) => `
      <div class="merge-shop-card">
        <div class="merge-shop-card-head">
          <span class="tag tag-blue">${esc(mergeShopLabel(i))}</span>
          <span>${esc(shopOf(s) || '（无店铺名）')}</span>
          <span class="src">来源案件 ${esc(caseNoOf(s))} · 费用合计 ${money0(expenseTotalOf(s))}</span>
        </div>
        <table class="table" style="background:transparent;"><thead><tr>
          <th>费用类型</th><th class="num">金额</th><th>状态</th><th>凭证/发票</th><th style="width:32px;"></th>
        </tr></thead><tbody>${expenseRowsHTML(s, i)}</tbody></table>
      </div>`).join('');
    if (mainTable) mainTable.style.display = 'none';
    // 合并案件没有「自己的」费用明细：+ 添加费用 写的是合并壳，隐藏以免点了没反应
    const addBtn = $('#expense-add-btn');
    if (addBtn) addBtn.style.display = 'none';
    return;
  }
  if (cards) cards.innerHTML = '';
  if (mainTable) mainTable.style.display = '';
  const addBtn0 = $('#expense-add-btn');
  if (addBtn0) addBtn0.style.display = '';
  $('#expense-tbody').innerHTML = expenseRowsHTML(c, -1);
}

/* ---------- v64：费用明细「凭证/发票」上传（每笔费用一个入口）
   v151：字段名由「缴费凭证」改为「凭证/发票」（用户口径）；上传 / 移除同步写回费用中心同一条记录 ---------- */
function pickExpenseProof(i) {
  const c = curCase();
  if (!c || !c.expenses || !c.expenses[i]) { toast('请先选中一笔费用', '', 'info'); return; }
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.onchange = () => {
    const f = (inp.files || [])[0];
    if (!f || !f.name) return;
    const cur = curCase();
    if (!cur || !cur.expenses || !cur.expenses[i]) return;
    cur.expenses[i].proof = f.name;
    syncFeeProof(cur.expenses[i]);
    save(); renderExpenses(); renderFees();
    toast('凭证/发票已上传', cur.expenses[i].name + ' · ' + f.name);
  };
  inp.click();
}
function clearExpenseProof(i) {
  const c = curCase();
  if (!c || !c.expenses || !c.expenses[i]) return;
  const nm = c.expenses[i].name;
  c.expenses[i].proof = '';
  syncFeeProof(c.expenses[i]);
  save(); renderExpenses(); renderFees();
  toast('已移除凭证/发票', nm, 'info');
}
/* 费用明细的凭证 → 费用中心同一条记录（统一数据来源：两侧不各存一份） */
function syncFeeProof(e) {
  if (!e || !e.feeId) return;
  const f = (STATE.fees || []).find(x => x && x.id === e.feeId);
  if (f) f.proof = e.proof || '';
}

function setExpenseStatus(i, val) {
  const c = curCase(); if (!c || !c.expenses || !c.expenses[i]) return;
  c.expenses[i].status = val;
  syncFeeFromExp(c.expenses[i].feeId, val);   // v151：状态双向同步到费用中心
  save(); renderExpenses(); renderFees();
  toast('费用状态已更新', c.expenses[i].name + ' · ' + val, 'info');
}

function renderLinks() {
  const c = curCase(); if (!c) return;
  const list = c.links || [];
  const tq = list.reduce((s, l) => s + Number(l.qty || 0), 0);
  const ts = list.reduce((s, l) => s + Number(l.qty || 0) * Number(l.price || 0), 0);
  const tc = list.reduce((s, l) => s + Number(l.cmt || 0), 0);
  $('#link-tbody').innerHTML = list.map((l, i) => `
    <tr>
      <td>
        <div style="color:var(--color-ink);font-weight:500;">${esc(l.title)}</div>
        <div style="font:400 11px/1.40 var(--font-mono);color:var(--color-ink-tertiary);margin-top:2px;">${esc(l.url)}</div>
      </td>
      <td class="num">${Number(l.qty).toLocaleString()}</td>
      <td class="num">${money(l.price)}</td>
      <td class="num">${money(l.qty * l.price)}</td>
      <td>${l.cmt}</td>
      <td style="width:32px;"><button class="btn btn-ghost btn-sm btn-icon" onclick="removeLink(${i})">×</button></td>
    </tr>`).join('') +
    `<tr style="background:var(--color-surface-2);">
      <td style="color:var(--color-ink-subtle);font-weight:500;">销售总额（自动计算）</td>
      <td class="num" style="color:var(--color-ink-subtle);">${tq.toLocaleString()}</td>
      <td class="num" style="color:var(--color-ink-subtle);">—</td>
      <td class="num" style="color:var(--color-primary);font-weight:600;">${money(ts)}</td>
      <td style="color:var(--color-ink-subtle);">${tc}</td><td></td>
    </tr>`;
}

// 字段覆盖层（inline 编辑结果）
function applyOverrides(c) {
  $$('#view-detail [data-ov]').forEach(el => {
    const k = el.dataset.ov;
    if (c.ov && c.ov[k] !== undefined) el.textContent = c.ov[k];
  });
}
function initInlineEdit() {
  const roots = ['#view-detail', '#view-customer-detail'];
  roots.forEach(sel => {
    $$(sel + ' .field-value').forEach(el => {
      if (el.dataset.ov === undefined) return;
      if (el.querySelector('.pill,.tag,input,button,.progress-track')) return;
      if (!el.classList.contains('editable')) {
        el.classList.add('editable');
        el.setAttribute('contenteditable', 'true');
        el.setAttribute('spellcheck', 'false');
      }
    });
  });
}

// ============================================================
// 6. 客户详情
// ============================================================
function openCustomer(id) {
  currentCustomerId = id;
  renderCustomerDetail();
  showView('customer-detail');
  switchTab('c-info');
}
function curCustomer() { return STATE.customers.find(c => c.id === currentCustomerId); }

/* ---------- 客户详情：结算记录（按客户动态渲染） ----------
   数据源与「累计结算 / 回款率」KPI 一致，都取 SETTLEMENTS 按客户名筛选，
   避免切换客户后表格仍是写死的同一份 6 个月数据。 */
function custSettlements(c) {
  const rows = SETTLEMENTS.filter(s => s.cust === c.name).slice();
  // 结算中心新建的账单落在 CUST_BILLS（会持久化），按「客户 + 月份」去重合并，客户详情里也能看到
  // v150：m 改成完整日期后，去重不能再整串比 —— 走 sameMonth 前缀比较
  CUST_BILLS.filter(x => x.cust === c.name).forEach(x => {
    if (!rows.some(s => sameMonth(s.m, x.m))) rows.push(x);
  });
  return rows.sort((a, b) => String(b.m).localeCompare(String(a.m)));
}
// 账单：优先取结算单上传 / 粘贴的文本（CUST_BILLS 持久化），没有则返回空串
function settleBillText(custName, m) {
  const b = CUST_BILLS.find(x => x.cust === custName && sameMonth(x.m, m));
  return (b && b.text) ? String(b.text) : '';
}
function renderCustSettlements() {
  const c = curCustomer();
  const tb = document.getElementById('c-settle-tbody');
  if (!c || !tb) return;
  const rows = custSettlements(c);
  if (!rows.length) {
    tb.innerHTML = emptyRow(7, '该客户还没有结算记录', '在「结算中心 → + 发起结算」创建后，这里会自动显示');
    return;
  }
  // v84：账单列不再放「预览 / 查看」按钮，直接展示结算阶段上传 / 录入的账单
  tb.innerHTML = rows.map(s => {
    const text = settleBillText(c.name, s.m);
    const short = text.length > 26 ? (text.slice(0, 25) + '…') : text;
    return `
    <tr>
      <td class="mono">${esc(s.m)}</td>
      <td class="num">${money0(s.amt)}</td>
      <td class="num">${s.inv ? money0(s.inv) : '—'}</td>
      <td class="num"${s.rec ? ' style="color:var(--color-success);"' : ''}>${s.rec ? money0(s.rec) : '—'}</td>
      <td><span class="pill ${s.cls}">${esc(s.prog)}</span></td>
      <td class="mono">${esc(s.date)}</td>
      <td class="bill-text" title="${esc(text)}">${text
        ? esc(short)
        : '—'}</td>
    </tr>`;
  }).join('');
}

/* 「导出对账单」→ 当前客户账单导出 CSV（传 m 则只导该月） */
function exportCustStatement(m) {
  const c = curCustomer(); if (!c) return;
  const all = custSettlements(c);
  const rows = m ? all.filter(x => sameMonth(x.m, m)) : all;
  if (!rows.length) { toast('没有可导出的账单', c.name, 'info'); return; }
  downloadCSV(
    `对账单-${c.name}-${m || '全部'}.csv`,
    ['发起结算日期', '客户', '客户结算金额', '已开票', '已回款', '结算进度', '回款日期'],
    rows.map(s => [s.m, s.cust, s.amt, s.inv, s.rec, s.prog, s.date]));
  toast('对账单已导出', `${c.name} · ${rows.length} 条`, 'success');
}

/* 客户详情「合作协议」唯一入口：上传协议文件，读取正文写入客户 */
function uploadCustContract() {
  const c = curCustomer();
  if (!c) { toast('请先打开一个客户', '从客户管理进入客户详情后再上传', 'info'); return; }
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.txt,.md,.csv,.json,.log,.pdf,.doc,.docx';
  inp.onchange = () => {
    const f = inp.files && inp.files[0];
    inp.remove();
    if (!f) return;
    if (f.text) f.text().then(t => setCustContractText(f.name, t)).catch(() => setCustContractText(f.name, ''));
    else setCustContractText(f.name, '');
  };
  inp.style.display = 'none';
  document.body.appendChild(inp);
  inp.click();
}

/* 协议文件落库（上传回调 / 冒烟直调）：读到文本就存正文，读不到按文件名给一段可读说明，不留空白 */
function setCustContractText(name, text) {
  const c = curCustomer();
  if (!c) return;
  const nm = String(name || '协议文件');
  const t = String(text || '').trim();
  c.contractName = nm;
  c.contractText = t || ('合作协议：' + nm + '\n（未能读取文本内容，请手工补充协议正文）');
  save(); renderCustContracts();
  toast('合作协议已上传', t ? nm + ' · 正文已写入' : nm + ' · 未读到文本，已按文件名写入说明', t ? 'success' : 'info');
}

/* 合作协议字段（客户档案卡整行）：文件名本身即预览入口 —— 点一下看正文，
   不再挂「查看 / 更换」两个按钮；未上传时只留一个上传入口，更换文件走卡片「编辑」 */
function renderCustContracts() {
  const c = curCustomer(); if (!c) return;
  const box = document.getElementById('cust-contract-text');
  if (!box) return;
  const nm = String(c.contractName || '').trim();
  const t = String(c.contractText || '').trim();
  if (!nm && !t) {
    box.innerHTML = '<button type="button" class="btn btn-ghost btn-sm" onclick="uploadCustContract()">+ 上传协议文件</button>';
    return;
  }
  const label = nm || '已上传协议文本';
  const ico = /\.pdf$/i.test(label) ? 'PDF' : (/\.(docx?|wps)$/i.test(label) ? 'DOC' : 'TXT');
  box.innerHTML = `<button type="button" class="file-link" onclick="viewCustContract()" title="点击预览协议正文">`
    + `<span class="file-link-ico">${ico}</span>`
    + `<span class="mono file-link-name">${esc(label)}</span></button>`;
}

/* 合作协议正文预览：正文放进弹窗，不占详情页版面 */
function viewCustContract() {
  const c = curCustomer(); if (!c) return;
  const t = String(c.contractText || '').trim();
  if (!t) { toast('暂无可预览的协议正文', c.name, 'info'); return; }
  openModal({
    title: '合作协议 · ' + (c.contractName || c.name),
    bodyHTML: `<div class="contract-text">${esc(t)}</div>`,
    okText: '关闭', cancelBtn: false,
  });
}

/* ---------- 客户经理（下拉，与运营 / 案件侧同一份枚举） ---------- */
function custManagerOptions() { return Object.keys(OPERATORS); }
function setCustManager(name) {
  const c = curCustomer(); if (!c) return;
  const nm = String(name || '').trim();
  if (!nm || nm === c.manager) return;
  const st = operatorStyle(nm);
  c.manager = nm; c.opInitial = st.opInitial; c.opColor = st.opColor;
  c.updated = '刚刚';
  save(); renderCustomerDetail(); renderCustomers();
  toast('客户经理已更新', c.name + ' · ' + nm);
}
/* v151：客户「运营」（用户 2026-09-14 要求在客户经理后面补这一栏）——
   选项与客户经理 / 案件侧同源（OPERATORS），存 c.operator。 */
function custOperatorOptions() { return Object.keys(OPERATORS); }
function setCustOperator(name) {
  const c = curCustomer(); if (!c) return;
  const nm = String(name || '').trim();
  if (!nm || nm === c.operator) return;
  c.operator = nm;
  c.updated = '刚刚';
  save(); renderCustomerDetail(); renderCustomers();
  toast('运营已更新', c.name + ' · ' + nm);
}

/* ---------- 结算条件（客户）：录入的是一条公式 ----------
   例：客户结算金额=结案金额*70% —— 只决定「客户结算金额」，与律师结算完全无关。
   老数据兼容：没有公式时，从历史的 share 文本（"客户 75% / 律所 25%"）里迁移出客户比例。 */
function fmtPct(v) { const n = Number(v); return String(Number.isInteger(n) ? n : Math.round(n * 10) / 10); }
function clampPct(v, dft) { const n = Number(v); return (isFinite(n) && n >= 0 && n <= 100) ? n : dft; }
function custFormula(cust) {
  cust = cust || {};
  const f = String(cust.settleFormula || '').trim();
  if (f) return f;
  const m = String(cust.share || '').match(/客户\s*(\d+(?:\.\d+)?)\s*%/);
  return '客户结算金额=结案金额*' + fmtPct(clampPct(m && m[1], 70)) + '%';
}
/* 从公式里取客户比例：优先「结案金额 × N%」，其次公式内任意 N%；取不到返回 NaN */
function pctFromFormula(f) {
  const s = String(f || '');
  const m = s.match(/结案金额[^\d%]{0,8}(\d+(?:\.\d+)?)\s*%/) || s.match(/(\d+(?:\.\d+)?)\s*%/);
  return m ? clampPct(m[1], NaN) : NaN;
}
function custPctOf(cust) { const p = pctFromFormula(custFormula(cust)); return isNaN(p) ? 70 : p; }

/* ---------- 客户档案卡：字段取值（老存档缺字段时回退到缺省值，不出现空白行） ---------- */
function custCoopFrom(c)  { return String((c || {}).coopFrom || CUST_DEFAULT_COOP_FROM).trim(); }
function custCoopTo(c)    { return String((c || {}).coopTo || CUST_DEFAULT_COOP_TO).trim(); }
function custInvoiceType(c) { return String((c || {}).invoiceType || CUST_DEFAULT_INVOICE).trim(); }
function custInvoiceSubject(c) { return String((c || {}).invoiceSubject || (c || {}).name || '').trim(); }
function custTaxNo(c)     { return String((c || {}).taxNo || (c || {}).credit || '').trim(); }
function custBank(c)      { return String((c || {}).bank || CUST_DEFAULT_BANK).trim(); }
/* 结算方式展示：沿用「月结 · 30 天账期」的原有文案（数据里存「月结 · 30 天」） */
function settleTextOf(c) {
  const s = String((c || {}).settle || '').trim();
  if (!s) return '—';
  return /天$/.test(s) ? s + '账期' : s;
}
/* 合同到期日 → 剩余月数文案（不足 1 个月 / 已到期返回空串） */
function monthsLeftText(toStr) {
  const s = String(toStr || '').slice(0, 10);
  const d = new Date(s + 'T00:00:00');
  if (isNaN(d.getTime())) return '';
  const t = new Date(today() + 'T00:00:00');
  const m = (d.getFullYear() - t.getFullYear()) * 12 + (d.getMonth() - t.getMonth());
  return m > 0 ? `剩余 ${m} 个月` : '';
}

/* ---------- 律师结算条款（律师协议）：匹配律师时录入，只决定「律师结算金额」 ----------
   全风险：律师结算金额 = 结案金额 × 分成比例
   半风险：律师结算金额 = 基础费 + 结案金额 × 分成比例
   固定费用：律师结算金额 = 基础费（固定金额） */
function lawModeOf(c) { return LAW_SETTLE_MODES.indexOf(String((c || {}).lawyerSettleMode || '')) >= 0 ? c.lawyerSettleMode : '全风险'; }
function lawSplitOf(c) {
  const n = parseFloat(String((c || {}).lawyerSplit == null ? '' : c.lawyerSplit).replace(/[^\d.]/g, ''));
  return isFinite(n) ? clampPct(n, 30) : 30;
}
function lawAgreementOf(c) {
  const mode = lawModeOf(c);
  return { mode, base: mode === '全风险' ? 0 : numOf(c && c.lawyerBaseFee), split: lawSplitOf(c) };
}
function lawAmountOf(mode, base, split, amt) {
  const b = Number(base) || 0;
  if (mode === '固定费用') return Math.round(b);
  if (mode === '半风险')   return Math.round(b + (Number(amt) || 0) * (Number(split) || 0) / 100);
  return Math.round((Number(amt) || 0) * (Number(split) || 0) / 100);
}
/* 律师结算条款的文字摘要（详情页 / 结算 Tab 展示用） */
function lawCondText(c) {
  const a = lawAgreementOf(c);
  if (a.mode === '固定费用') return '固定费用 ' + money0(a.base);
  if (a.mode === '半风险')   return '半风险 · 基础费 ' + money0(a.base) + ' + ' + fmtPct(a.split) + '%';
  return '全风险 · ' + fmtPct(a.split) + '%';
}

/* 案件 → 客户：按 c.client 匹配；关联案件列表里的历史种子没有 client 字段，回退默认客户 */
function custOfCase(c) {
  const list = STATE.customers || [];
  const byName = list.find(x => c && x.client && x.name === c.client);
  if (byName) return byName;
  return list.find(x => x.name === CUSTOMER_DETAIL_CLIENT) || list[0] || null;
}
/* 本次结算的完整口径：结案基数 + 客户侧（客户公式）+ 律师侧（律师协议）
   —— 两侧各自独立计算，手工调整过的保留手工值（custSettleManual / lawSettleManual） */
function settleFigures(c, baseOverride) {
  c = c || {};
  const amt = numOf(baseOverride) || numOf(c.ov && c.ov.closeAmt) || numOf(c.closeAmt) || numOf(c.amount);
  const cust = custOfCase(c);
  const cFormula = custFormula(cust);
  const cPct = custPctOf(cust);
  const custAuto = Math.round(amt * cPct / 100);
  const law = lawAgreementOf(c);
  const lawAuto = lawAmountOf(law.mode, law.base, law.split, amt);
  const custManual = c.custSettleManual === true && c.custSettleAmt != null && c.custSettleAmt !== '';
  const lawManual = c.lawSettleManual === true && c.lawSettleAmt != null && c.lawSettleAmt !== '';
  const f = {
    amt, custName: cust ? cust.name : '—', cFormula, cPct, custAuto,
    custAmt: custManual ? Math.round(Number(c.custSettleAmt) || 0) : custAuto, custManual,
    law, lawAuto, lawAmt: lawManual ? Math.round(Number(c.lawSettleAmt) || 0) : lawAuto, lawManual,
  };
  f.custTip = custSettleTip(f);
  f.lawTip = lawSettleTip(f);
  return f;
}
/* 悬停提示：这个数字是怎么算出来的 */
function custSettleTip(f) {
  return '客户结算条件：' + f.cFormula
    + '\n计算：结案金额 ' + money0(f.amt) + ' × ' + fmtPct(f.cPct) + '% = ' + money0(f.custAuto)
    + (f.custManual ? '\n当前为手工调整值：' + money0(f.custAmt) : '');
}
function lawSettleTip(f) {
  const m = f.law.mode;
  const c = m === '固定费用' ? '固定费用 ' + money0(f.law.base) + ' = ' + money0(f.lawAuto)
    : (m === '半风险' ? '基础费 ' + money0(f.law.base) + ' + 结案金额 ' + money0(f.amt) + ' × ' + fmtPct(f.law.split) + '% = ' + money0(f.lawAuto)
      : '结案金额 ' + money0(f.amt) + ' × ' + fmtPct(f.law.split) + '% = ' + money0(f.lawAuto));
  return '律师结算模式：' + m + '\n计算：' + c
    + (f.lawManual ? '\n当前为手工调整值：' + money0(f.lawAmt) : '');
}

/* ---------- 结算金额「修改」：行内面板 ---------- */
function activeSettleCase() {
  return (STATE.cases || []).find(x => x.id === CUR_STAGE_CASE_ID) || (typeof curCase === 'function' ? curCase() : null);
}
/* 待归档弹窗里刚改过「结案金额」但还没保存时，编辑器要按屏幕上这个基数算，避免与行内显示打架 */
function settleBaseOverride() {
  const body = document.getElementById('modal-body'); if (!body) return '';
  const el = body.querySelector('[data-fk="closeAmt"]');
  return el ? el.value : '';
}
function settlePanelEl(side) { return document.getElementById('settle-edit-' + side); }
/* 结算模式的联动：全风险 → 基础费锁定为 0，且比例不能为 0 */
function syncLawyerMode() {
  const body = document.getElementById('modal-body'); if (!body) return;
  const modeEl  = body.querySelector('[data-fk="lawyerSettleMode"]');
  const baseEl  = body.querySelector('[data-fk="lawyerBaseFee"]');
  const splitEl = body.querySelector('[data-fk="lawyerSplit"]');
  if (!modeEl || !baseEl) return;
  const allRisk = modeEl.value === '全风险';
  baseEl.readOnly = allRisk;
  baseEl.style.background = allRisk ? 'var(--color-surface-2)' : '';
  baseEl.style.color = allRisk ? 'var(--color-ink-muted)' : '';
  if (allRisk) {
    baseEl.value = '0';
    if (splitEl && parseFloat(String(splitEl.value).replace(/[^\d.]/g, '')) === 0) splitEl.value = '30%';
  }
}
/* 行内面板 / 弹窗共用的编辑器（inline = 在待归档弹窗内展开，带「应用 / 收起」） */
function settleEditorHTML(c, side, inline) {
  const f = settleFigures(c, settleBaseOverride());
  const foot = inline ? `<div style="display:flex;gap:8px;">
      <button type="button" class="btn btn-primary btn-sm" onclick="applySettleEdit('${side}')">应用</button>
      <button type="button" class="btn btn-ghost btn-sm" onclick="closeSettleEdit('${side}')">收起</button>
    </div>` : '';
  const head = inline ? `<div class="form-hint" style="margin-bottom:6px;">改完点「应用」保存，不会关闭当前弹窗</div>` : '';
  if (side === 'cust') {
    return `<div class="settle-edit-panel" id="settle-edit-cust">${head}
      <div class="form-grid">
        <div class="form-field full">
          <label class="form-label">客户结算条件（公式）</label>
          <input class="form-input" data-se="formula" value="${esc(f.cFormula)}" oninput="recalcSettleEdit('cust')">
          <div class="form-hint">${esc(CUST_FORMULA_HINT)}；公式只决定客户结算金额，与律师结算无关</div>
        </div>
        <div class="form-field full">
          <label class="form-label">客户结算金额（元）</label>
          <input class="form-input" data-se="amount" type="number" value="${f.custAmt}" oninput="onSettleAmountInput('cust')">
          <div class="form-hint" data-se="calcline">${esc(settleCalcLine(f, 'cust'))}</div>
        </div>
      </div>${foot}</div>`;
  }
  const modeOpts = LAW_SETTLE_MODES.map(m => `<option value="${esc(m)}"${m === f.law.mode ? ' selected' : ''}>${esc(m)}</option>`).join('');
  const splitOpts = PCT_OPTIONS.map(o => `<option value="${esc(o)}"${o === f.law.split + '%' ? ' selected' : ''}>${esc(o)}</option>`).join('');
  const allRisk = f.law.mode === '全风险';
  return `<div class="settle-edit-panel" id="settle-edit-law">${head}
    <div class="form-grid">
      <div class="form-field">
        <label class="form-label">律师结算模式</label>
        <select class="form-select" data-se="mode" onchange="recalcSettleEdit('law')">${modeOpts}</select>
        <div class="form-hint">${esc(LAW_MODE_HINT[f.law.mode])}</div>
      </div>
      <div class="form-field">
        <label class="form-label">基础费（元）</label>
        <input class="form-input" data-se="base" type="number" value="${allRisk ? 0 : f.law.base}"${allRisk ? ' readonly style="background:var(--color-surface-2);color:var(--color-ink-muted);"' : ''} oninput="recalcSettleEdit('law')">
        <div class="form-hint">全风险 = 0；半风险 / 固定费用可录入金额</div>
      </div>
      <div class="form-field">
        <label class="form-label">分成比例</label>
        <select class="form-select" data-se="split" onchange="recalcSettleEdit('law')">${splitOpts}</select>
        <div class="form-hint">下拉选择 0% – 100%，仅风险模式参与计算</div>
      </div>
      <div class="form-field full">
        <label class="form-label">律师结算金额（元）</label>
        <input class="form-input" data-se="amount" type="number" value="${f.lawAmt}" oninput="onSettleAmountInput('law')">
        <div class="form-hint" data-se="calcline">${esc(settleCalcLine(f, 'law'))}</div>
      </div>
    </div>${foot}</div>`;
}
/* 面板里按当前录入值试算（不改数据）：返回 { amt, auto, line } */
function settleEditFigures(side, panel, c) {
  const f = settleFigures(c, settleBaseOverride());
  const val = sel => { const el = panel.querySelector(sel); return el ? String(el.value) : ''; };
  if (side === 'cust') {
    const formula = val('[data-se="formula"]').trim() || f.cFormula;
    const p = pctFromFormula(formula);
    const pct = isNaN(p) ? f.cPct : p;
    const auto = Math.round(f.amt * pct / 100);
    return { amt: f.amt, auto, pct, line: '按公式：结案金额 ' + money0(f.amt) + ' × ' + fmtPct(pct) + '% = ' + money0(auto) };
  }
  const mode = val('[data-se="mode"]') || f.law.mode;
  const base = mode === '全风险' ? 0 : numOf(val('[data-se="base"]'));
  const raw = parseFloat(val('[data-se="split"]').replace(/[^\d.]/g, ''));
  const split = isFinite(raw) ? clampPct(raw, f.law.split) : f.law.split;
  const auto = lawAmountOf(mode, base, split, f.amt);
  const body = mode === '固定费用' ? '固定费用 ' + money0(base)
    : (mode === '半风险' ? '基础费 ' + money0(base) + ' + 结案金额 ' + money0(f.amt) + ' × ' + fmtPct(split) + '%'
      : '结案金额 ' + money0(f.amt) + ' × ' + fmtPct(split) + '%');
  return { amt: f.amt, auto, mode, base, split, line: mode + '：' + body + ' = ' + money0(auto) };
}
/* 参数变化 → 重算并回写金额框（此时视为「按条款自动计算」） */
function recalcSettleEdit(side) {
  const p = settlePanelEl(side); if (!p) return;
  const c = activeSettleCase(); if (!c) return;
  if (side === 'law') {
    const modeEl = p.querySelector('[data-se="mode"]');
    const baseEl = p.querySelector('[data-se="base"]');
    const splitEl = p.querySelector('[data-se="split"]');
    if (modeEl && baseEl) {
      const allRisk = modeEl.value === '全风险';
      baseEl.readOnly = allRisk;
      baseEl.style.background = allRisk ? 'var(--color-surface-2)' : '';
      baseEl.style.color = allRisk ? 'var(--color-ink-muted)' : '';
      if (allRisk) {
        baseEl.value = '0';
        if (splitEl && parseFloat(String(splitEl.value).replace(/[^\d.]/g, '')) === 0) splitEl.value = '30%';
      }
    }
  }
  const fig = settleEditFigures(side, p, c);
  const box = p.querySelector('[data-se="amount"]');
  if (box) box.value = String(fig.auto);
  updateSettleEditLine(side, fig, p);
}
/* 金额框手动输入：只更新提示（是否记为手工调整） */
function onSettleAmountInput(side) {
  const p = settlePanelEl(side); if (!p) return;
  const c = activeSettleCase(); if (!c) return;
  updateSettleEditLine(side, settleEditFigures(side, p, c), p);
}
function updateSettleEditLine(side, fig, panel) {
  const el = panel.querySelector('[data-se="calcline"]');
  if (!el) return;
  const box = panel.querySelector('[data-se="amount"]');
  const cur = Math.round(Number(box && box.value) || 0);
  el.textContent = fig.line + (cur === fig.auto ? '' : ' · 将按手工调整值 ' + money0(cur) + ' 保存');
}
function toggleSettleEdit(side) {
  const c = activeSettleCase(); if (!c) return;
  const row = document.querySelector('#modal-body .settle-calc[data-side="' + side + '"]');
  const slot = row && row.querySelector('.settle-edit-slot');
  if (!slot) return;
  slot.innerHTML = slot.innerHTML.trim() ? '' : settleEditorHTML(c, side, true);
}
function closeSettleEdit(side) {
  const row = document.querySelector('#modal-body .settle-calc[data-side="' + side + '"]');
  const slot = row && row.querySelector('.settle-edit-slot');
  if (slot) slot.innerHTML = '';
}
/* 详情页 / 结算 Tab 的「修改」：独立弹窗 */
function openSettleEditor(caseId, side) {
  const c = (STATE.cases || []).find(x => x.id === caseId); if (!c) return;
  CUR_STAGE_CASE_ID = caseId;
  openModal({
    title: (side === 'cust' ? '修改客户结算金额' : '修改律师结算金额') + ' · ' + c.id,
    wide: true, okText: '保存', okClass: 'btn-primary',
    bodyHTML: settleEditorHTML(c, side, false),
    // openModal 不自动关窗（只有 formModal / confirmModal 会），这里必须显式关
    onOk: () => { if (applySettleEdit(side, caseId) !== false) closeModal(); },
  });
}
/* 应用：写回案件（公式 / 律师条款 / 手工金额） */
function applySettleEdit(side, caseId) {
  const c = (STATE.cases || []).find(x => x.id === (caseId || CUR_STAGE_CASE_ID)) || activeSettleCase();
  const p = settlePanelEl(side);
  if (!c || !p) return false;
  const fig = settleEditFigures(side, p, c);
  const box = p.querySelector('[data-se="amount"]');
  const cur = Math.round(Number(box && box.value) || 0);
  if (side === 'cust') {
    const formula = String((p.querySelector('[data-se="formula"]') || {}).value || '').trim();
    if (isNaN(pctFromFormula(formula))) { toast('公式无法解析', '请按「客户结算金额=结案金额*70%」的格式填写', 'error'); return false; }
    const cust = custOfCase(c);
    if (cust) { cust.settleFormula = formula; cust.updated = '刚刚'; }
    if (cur !== fig.auto) { c.custSettleAmt = cur; c.custSettleManual = true; }
    else { c.custSettleAmt = fig.auto; c.custSettleManual = false; }
  } else {
    const mode = String((p.querySelector('[data-se="mode"]') || {}).value || '全风险');
    const baseRaw = numOf((p.querySelector('[data-se="base"]') || {}).value);
    const splitRaw = String((p.querySelector('[data-se="split"]') || {}).value || '30%');
    c.lawyerSettleMode = mode;
    c.lawyerBaseFee = mode === '全风险' ? 0 : baseRaw;
    c.lawyerSplit = splitRaw;
    if (cur !== fig.auto) { c.lawSettleAmt = cur; c.lawSettleManual = true; }
    else { c.lawSettleAmt = fig.auto; c.lawSettleManual = false; }
  }
  c.updated = '刚刚';
  save();
  closeSettleEdit(side);
  const after = settleFigures(c);
  refreshSettleRow(side, c, after);
  safeRender(() => renderCustomerDetail(), 'settleCust');
  safeRender(() => renderCaseDetail(), 'settleCaseDetail');
  safeRender(() => renderCases(), 'settleCasesList');
  safeRender(() => renderSettleTab(c), 'settleTab');
  toast(side === 'cust' ? '客户结算金额已更新' : '律师结算金额已更新',
    side === 'cust'
      ? '结算条件：' + custFormula(custOfCase(c)) + ' · ' + money0(after.custAmt)
      : '结算模式：' + lawCondText(c) + ' · ' + money0(after.lawAmt));
  return true;
}
/* ---------- v146：案件结算台账（「发起结算」的单一真源） ----------
   c.settleLog = [{ at, side:'cust'|'law', nth, amt, m, note }]
   累计已结算金额一律由它派生，不另存数字键 —— 避免「双写两份、迟早不同步」。
   结算中心的两张明细表（CUST_BILLS / LAW_BILLS）由 pushSettleRecord 统一写入，
   案件详情是它们唯一的生成入口（用户 2026-09-14 明确）。 */
function settleLogOf(c, side) {
  const log = (c && Array.isArray(c.settleLog)) ? c.settleLog : [];
  return side ? log.filter(x => x && x.side === side) : log;
}
function settledOf(c, side) {
  return settleLogOf(c, side).reduce((a, x) => a + (Number(x.amt) || 0), 0);
}
function settleTotalOf(c, side) {
  const f = settleFigures(c);
  return (side === 'cust' ? f.custAmt : f.lawAmt) || 0;
}
function settleRemainOf(c, side) {
  return Math.max(0, settleTotalOf(c, side) - settledOf(c, side));
}
function settleNextNth(c, side) { return settleLogOf(c, side).length + 1; }
// 两个方向都能结算的按钮（客户 / 律师共用），标注第几次结算
function settleLaunchBtn(c, side) {
  if (c.status !== '待归档') return '';
  const done = settledOf(c, side), remain = settleRemainOf(c, side);
  const isCust = side === 'cust';
  if (settleTotalOf(c, side) <= 0) return '';
  if (remain <= 0) {
    return `<button type="button" class="btn btn-ghost btn-sm" style="margin-left:6px;" disabled title="已按${isCust ? '客户' : '律师'}结算金额结算完毕">已结算</button>`;
  }
  const nth = settleNextNth(c, side);
  return `<button type="button" class="btn btn-secondary btn-sm" style="margin-left:6px;" onclick="openSettleLaunch('${esc(c.id)}','${side}')"`
    + ` title="${done > 0 ? `已结算 ${money0(done)}，本次最多可结算 ${money0(remain)}` : `按当前${isCust ? '客户' : '律师'}结算金额生成一条结算数据`}">`
    + `${done > 0 ? '发起二次结算' : '发起结算'}</button>`;
}

/* 详情页 / 结算 Tab 里的金额单元格：悬停显示计算过程 + 「修改」+「发起结算」（仅待归档可改） */
function settleAmtCell(c, side) {
  const f = settleFigures(c);
  const isCust = side === 'cust';
  const tip = isCust ? f.custTip : f.lawTip;
  const amt = isCust ? f.custAmt : f.lawAmt;
  const manual = isCust ? f.custManual : f.lawManual;
  const done = settledOf(c, side);
  return `<span class="num-mono settle-amt" title="${esc(tip)}">${money0(amt)}</span>`
    + (manual ? '<span class="text-muted" style="font-size:11px;"> · 已手工调整</span>' : '')
    + (done > 0 ? `<span class="text-muted" style="font-size:11px;"> · 已结算 ${money0(done)}</span>` : '')
    + (c.status === '待归档'
      ? `<button type="button" class="btn btn-ghost btn-sm" style="margin-left:6px;" onclick="openSettleEditor('${esc(c.id)}','${side}')">修改</button>`
      : '')
    + settleLaunchBtn(c, side);
}

/* ---------- v146：发起结算 / 发起二次结算（案件详情 → 结算中心明细的唯一生成入口） ---------- */
function openSettleLaunch(caseId, side) {
  const c = STATE.cases.find(x => x && x.id === caseId);
  if (!c) return;
  const isCust = side === 'cust';
  const total = settleTotalOf(c, side);
  const done = settledOf(c, side);
  const remain = settleRemainOf(c, side);
  const sideTxt = isCust ? '客户结算' : '律师结算';
  if (total <= 0) { toast('暂无可结算金额', `该案件还没有${sideTxt}金额`, 'info'); return; }
  if (remain <= 0) { toast('已结算完毕', `${sideTxt}金额 ${money0(total)} 已全部发起过结算`, 'info'); return; }
  const nth = settleNextNth(c, side);
  // v150：用户口径 —— 「结算月份」改成「发起结算日期」，记的是**发起结算那一天**。
  //   原来取的是月份（YYYY-MM），现在直接取当天；数据键仍是 m（全站引用太多，不冒险改名）。
  const todayStr = today();
  const ro = (k, v) => `<div><span class="k">${k}</span><span class="v">${v}</span></div>`;
  formModal({
    title: (nth > 1 ? '发起二次结算' : '发起结算') + ' · ' + sideTxt,
    wide: true,
    submitText: nth > 1 ? '确认发起二次结算' : '确认发起结算',
    fields: [
      { type: 'custom', key: '__ro', span: 2, read: () => undefined, html:
        '<div class="lead-detail-grid cols-3" style="margin-bottom:4px;">'
        + ro('案件单号', `<span class="mono">${esc(caseNoOf(c))}</span>`)
        + ro(isCust ? '客户' : '办案律师', esc(isCust ? (c.cust || c.client || '—') : (lawyerOf(c) || '—')))
        + ro(isCust ? '客户结算金额' : '律师结算金额', `<span class="num-mono">${money0(total)}</span>`)
        + ro('已结算', `<span class="num-mono">${money0(done)}</span>`)
        + ro('本次可结算', `<span class="num-mono">${money0(remain)}</span>`)
        + ro('本次是第几次', `第 ${nth} 次`) + '</div>' },
      { key: 'amt', label: '本次结算金额（元）', type: 'number', value: String(remain), required: true, span: 2,
        hint: nth > 1
          ? `已自动扣掉前 ${nth - 1} 次已结算的 ${money0(done)}，只结算余额 ${money0(remain)}；如需少结可手工改小。`
          : `默认取该案件的${isCust ? '客户结算金额' : '律师结算金额'}，可手工调整。` },
      { key: 'm', label: '发起结算日期', type: 'date', value: todayStr, span: 2 },
      { key: 'note', label: '备注', span: 2, placeholder: nth > 1 ? '如：二审追加结算' : '如：一审结案结算' },
    ],
    onSubmit: d => {
      const amt = Number(d.amt) || 0;
      if (!(amt > 0)) { toast('本次结算金额需大于 0', '', 'error'); return false; }
      if (amt > remain + 0.001) { toast('超出可结算金额', `本次最多可结算 ${money0(remain)}`, 'error'); return false; }
      pushSettleRecord(c, side, amt, d.m || todayStr, d.note || '', nth);
      toast(nth > 1 ? '二次结算已发起' : '结算已发起',
        `${sideTxt}数据 ${money0(amt)} 已生成 · 去「结算中心」勾选后可发起账单`, 'success');
    },
  });
}

/* 结算落库的唯一写入点：① 案件台账 ② 结算中心明细（新明细默认「未入账单」） */
function pushSettleRecord(c, side, amt, m, note, nth) {
  c.settleLog = Array.isArray(c.settleLog) ? c.settleLog : [];
  c.settleLog.push({ at: today(), side, nth, amt, m, note });
  const isCust = side === 'cust';
  /* v150：用户口径 —— 回款 / 打款日期只能由**财务系统回填**，原型自己不该造。
     原来这里写 `'预计 ' + 30 天后`（如「预计 10-14」），是典型的「乱加说明」：
     刚发起的结算还没到账，就该留空（列表显示 —）。真实到账后由财务侧写入日期。 */
  if (isCust) {
    CUST_BILLS.unshift({
      m, cust: c.cust || c.client || '—', amt, inv: 0, rec: 0,
      prog: '待发账单', cls: 'pill-warning', date: '',
      text: '', caseId: caseNoOf(c), nth, billNo: '', src: note || '',
    });
  } else {
    const cast = castOf(c) || {};
    LAW_BILLS.unshift({
      m, lawyer: lawyerOf(c) || '—', firm: cast.firm || '—', cases: 1, amt,
      prog: '待提交', cls: 'pill-warning', date: '',
      caseId: caseNoOf(c), nth, billNo: '', src: note || '',
    });
  }
  save(); renderAll(); renderSettlementSplit(); renderSettings();
}

/* CTA 横幅：最近一笔已回款 + 最近一笔待回款，随客户刷新 */
function renderCustCta(c) {
  const rows = custSettlements(c);
  const t = document.getElementById('cust-cta-title');
  const d = document.getElementById('cust-cta-desc');
  const paid = rows.filter(x => x.prog === '已回款');
  const pend = rows.filter(x => x.prog !== '已回款');
  if (t) {
    if (paid.length || pend.length) {
      /* v150：m 是「发起结算日期」、date 是「财务系统回填的回款日期」——
         未回款时 date 本就是空的，文案不能再写「预计 xx」。 */
      t.textContent = (paid[0] ? `${paid[0].m} 发起结算 ${money0(paid[0].amt)}，已于 ${paid[0].date} 回款` : '暂无已回款账单')
        + ' · ' + (pend[0] ? `${pend[0].m} 发起结算 ${money0(pend[0].amt)}，待回款` : '暂无待回款账单');
    } else {
      t.textContent = '该客户暂无结算记录';
    }
  }
  if (d) {
    const pendSum = pend.reduce((a, x) => a + (Number(x.amt) || 0), 0);
    d.textContent = pend.length
      ? `月结 · 30 天账期 · 当前应收 ${money0(pendSum)}（${pend.length} 张账单待回款）`
      : '完成首次结算后，这里会展示最近账单与回款进度';
  }
}

/* 子模块容错：客户详情由多个子渲染拼成，任一个抛错都不能中断后续子渲染。
   此前 renderContacts 因容器缺失抛错，导致 renderAssets/renderHolders/结算记录全部不执行、
   页面停在 HTML 静态内容上，且 openCustomer 在 showView 之前就被打断（点了客户行不跳转）。 */
function safeRender(fn, label) {
  try { fn(); } catch (e) { if (window.console) console.error('[render fail]', label, e); }
}

function renderCustomerDetail() {
  const c = curCustomer(); if (!c) return;
  $('#cust-name').textContent = c.name;
  $('#cust-sub').textContent = `客户编号 ${c.id} · ${c.region || '—'} · ${c.credit} · 主营 ${c.category}`;
  $('#cust-avatar').textContent = c.name.replace(/[^\u4e00-\u9fa5]/g, '').charAt(1) || '客';
  safeRender(() => renderCustKpi(c), 'custKpi');
  safeRender(renderContacts, 'custContacts');
  safeRender(renderAssets, 'custAssets');
  safeRender(renderHolders, 'custHolders');
  safeRender(renderCustContracts, 'custContracts');
  safeRender(renderCustSettlements, 'custSettlements');
  safeRender(() => renderCustCta(c), 'custCta');
  // 基本信息卡：整卡字段全部由客户数据渲染（改字段走卡片右上角「编辑」→ editCustomerCard）
  const setCustField = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = (v == null || v === '') ? '—' : String(v); };
  setCustField('cust-f-name', c.name);
  setCustField('cust-f-credit', c.credit);   // 与「新建客户」的统一社会信用代码同源
  setCustField('cust-f-category', c.category);
  setCustField('cust-f-region', c.region);
  setCustField('cust-model', c.model);
  setCustField('cust-f-coopfrom', custCoopFrom(c));
  setCustField('cust-f-settle', settleTextOf(c));
  setCustField('cust-f-invoice', custInvoiceType(c));
  setCustField('cust-f-invsubject', custInvoiceSubject(c));
  setCustField('cust-f-taxno', custTaxNo(c));
  setCustField('cust-f-bank', custBank(c));
  // 合同到期日 = 日期 + 剩余月数标签
  const toEl = document.getElementById('cust-f-coopto');
  if (toEl) {
    const to = custCoopTo(c), left = monthsLeftText(to);
    toEl.innerHTML = esc(to) + (left ? `<span class="tag" style="margin-left:6px;">${left}</span>` : '');
  }
  // 合作状态：pill 颜色随状态走
  const stEl = document.getElementById('cust-f-status');
  if (stEl) stEl.innerHTML = `<span class="pill ${CUST_STATUS_CLASS[c.status] || c.statusClass || 'pill-neutral'}">${esc(c.status || '—')}</span>`;
  // 结算条件：只读公式（只决定客户结算金额，与律师结算无关）
  const condEl = document.getElementById('cust-settle-cond');
  if (condEl) condEl.innerHTML = `<span class="num-mono">${esc(custFormula(c))}</span>`;
  // 客户经理：下拉（选项与运营 / 案件侧同源，选中当前客户经理）
  const mgrSel = document.getElementById('cust-manager');
  if (mgrSel) {
    const opts = custManagerOptions();
    const cur = opts.indexOf(c.manager) >= 0 ? c.manager : (opts[0] || '');
    mgrSel.innerHTML = opts.map(o => `<option${o === cur ? ' selected' : ''}>${esc(o)}</option>`).join('');
    if (cur) mgrSel.value = cur;
  }
  // v151：运营 —— 与客户经理同款下拉（用户要求放在客户经理后面；老客户没有该字段时默认第一位）
  const opSel = document.getElementById('cust-operator');
  if (opSel) {
    const opts = custOperatorOptions();
    const cur = opts.indexOf(c.operator) >= 0 ? c.operator : (opts[0] || '');
    opSel.innerHTML = opts.map(o => `<option${o === cur ? ' selected' : ''}>${esc(o)}</option>`).join('');
    if (cur) opSel.value = cur;
  }
}

/* 客户详情页头部 4 张小卡片
  - 累计结算金额：按客户名汇总 SETTLEMENTS.amt（与客户表 / 结算中心 KPI 一致）
  - 累计回款 / 回款率：取自 c.recovered / c.rate
  - 待回款：累计结算金额 − 已回款部分（已开账单中 inv - rec 之和），派生得出 */
function renderCustKpi(c) {
  const wrap = $('#cust-kpi-row'); if (!wrap) return;
  const settled = SETTLEMENTS.filter(s => s.cust === c.name).reduce((a, s) => a + s.amt, 0);
  const invoiced = SETTLEMENTS.filter(s => s.cust === c.name).reduce((a, s) => a + s.inv, 0);
  const received = SETTLEMENTS.filter(s => s.cust === c.name).reduce((a, s) => a + s.rec, 0);
  // 待回款 = 已开票尚未回款（inv - rec 之和）；若无 SETTLEMENTS 数据则取 settledOf - 客户表 recovered 对应数字
  const pending = Math.max(0, invoiced - received);
  // 累计回款优先采用 SETTLEMENTS 求和（与结算中心一致），回退 c.recovered
  const recoveredNum = received || wanToNum(c.recovered);
  const rate = c.rate || 0;
  wrap.innerHTML = `
    <div class="cust-kpi">
      <div class="k">累计结算金额</div>
      <div class="v">¥ ${settled.toLocaleString('zh-CN')}</div>
    </div>
    <div class="cust-kpi good">
      <div class="k">累计回款</div>
      <div class="v">¥ ${recoveredNum.toLocaleString('zh-CN')}</div>
    </div>
    <div class="cust-kpi warn">
      <div class="k">待回款</div>
      <div class="v">¥ ${pending.toLocaleString('zh-CN')}</div>
    </div>
    <div class="cust-kpi">
      <div class="k">回款率</div>
      <div class="v-row">
        <div class="progress-track"><div class="progress-bar ${rate >= 45 ? 'success' : (rate > 0 ? 'warning' : '')}" style="width:${rate}%"></div></div>
        <span class="num-mono">${rate}%</span>
      </div>
    </div>`;
}

// 把 "¥ 156.0 万" 这类字面量转为纯数字（无 SETTLEMENTS 数据时兜底）
function wanToNum(s) {
  if (!s) return 0;
  const m = String(s).match(/([\d.]+)\s*万/);
  if (m) return Math.round(parseFloat(m[1]) * 10000);
  const n = parseFloat(String(s).replace(/[^\d.]/g, ''));
  return isNaN(n) ? 0 : n;
}

function renderContacts() {
  const c = curCustomer(); if (!c) return;
  const list = c.contacts || [];
  // v152：区块标题「联系人 · 共 N 位」的小标签已按用户口径删除（#contact-count 节点一并移除）
  const box = document.getElementById('contact-list');
  // 容器缺失时静默返回，不能抛错——否则会中断整个客户详情的渲染链
  if (!box) return;
  box.innerHTML = list.map((p, i) => `
    <div class="item-card">
      <div class="item-icon person" style="background:${p.color}1A; color:${p.color};">${esc(p.name.charAt(0))}</div>
      <div class="item-main">
        <div class="item-title">${esc(p.name)}
          ${p.main ? '<span class="tag tag-green" style="margin-left:4px;">主要联系人</span>' : ''}</div>
        <div class="item-meta">
          <span>手机 <span class="mono">${esc(p.phone)}</span></span>
          <span>邮箱 <span class="mono">${esc(p.mail)}</span></span>
          <span>负责：${esc(p.duty)}</span>
        </div>
      </div>
      <div class="item-actions">
        <button class="btn btn-ghost btn-sm" onclick="editContact(${i})">编辑</button>
        <button class="btn btn-ghost btn-sm btn-icon" onclick="removeContact(${i})">×</button>
      </div>
    </div>`).join('') || '<div class="empty" style="padding:32px;"><div class="empty-title">还没有联系人</div><div class="empty-desc">点击上方「+ 添加联系人」录入。</div></div>';
}

/* ---------- 权利资产：类型 / 权属文件识别 ----------
   类型在原有 商标 / 专利 / 著作权 基础上新增：知名度证据 / 授权书 / 其他
   权属文件列可上传文件，识别文件内容后填充：类型 · 注册号/申请号 · 名称 · 类别 · 权利人 · 注册日期 · 有效期至 · 状态 */
const ASSET_TYPES = ['商标', '专利', '著作权', '知名度证据', '授权书', '其他'];
const ASSET_TCLS = { '商标': 'tag-purple', '专利': 'tag-blue', '著作权': 'tag-orange',
  '知名度证据': 'tag-green', '授权书': 'tag-blue', '其他': '' };
function assetTcls(t) { return ASSET_TCLS[t] || ''; }
// 状态由「有效期至」派生：已过有效期 → 已过期，否则 有效
function assetStatusOf(a) {
  const to = a && a.to;
  const expired = to && /^\d{4}-\d{2}-\d{2}$/.test(String(to)) && String(to) < today();
  return expired ? { text: '已过期', cls: 'pill-warning' } : { text: '有效', cls: 'pill-success' };
}
function fileHash(s) { let h = 0; const t = String(s || ''); for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0; return h; }
function normDate(s) {
  const m = String(s || '').match(/(\d{4})\s*[-年/.]\s*(\d{1,2})\s*[-月/.]\s*(\d{1,2})/);
  if (!m) return '';
  return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
}
function guessAssetType(s) {
  const t = String(s || '');
  if (/授权书|授权委托|授权文件/.test(t)) return '授权书';
  if (/知名度|驰名|荣誉|奖项|宣传证据|影响力/.test(t)) return '知名度证据';
  if (/商标|注册证|商标局/.test(t)) return '商标';
  if (/专利|实用新型|外观设计|发明/.test(t)) return '专利';
  if (/著作权|版权|作品登记|美术作品/.test(t)) return '著作权';
  return '其他';
}
// 权属文件识别：优先从文本里解析标准字段；图片 / 不可读文件（PDF 等）无文本时按文件名生成确定性示例值，保证演示可用
function assetDocRecognize(filename, text) {
  const fn = String(filename || '');
  const src = String(text || '');
  const line = re => {
    const m = src.match(re);
    return m ? String(m[1]).replace(/[ \t　]+/g, ' ').replace(/[，,。；;、:：]+$/, '').trim() : '';
  };
  const byFn = guessAssetType(fn);
  const type = byFn !== '其他' ? byFn : guessAssetType(src);
  const rNo = line(/(?:商标注册号|注册号|申请号|专利号|证书号|登记号)\s*[：:]?\s*([^\n\r，,。；;]{3,40})/);
  const rName = line(/(?:商标名称|作品名称|专利名称|证书名称|名称)\s*[：:]?\s*([^\n\r，,。；;]{2,30})/);
  const rCat = line(/(第\s*\d{1,2}\s*类[^\n\r，,。；;]{0,20})/)
    || line(/(实用新型|外观设计|发明专利|发明|美术作品|文字作品|摄影作品|计算机软件)/);
  const rOwner = line(/(?:权利人|申请人|注册人|著作权人|商标权人)\s*[：:]?\s*([^\n\r，,。；;]{2,40})/);
  const rFrom = normDate(line(/(?:注册日期|申请日期|登记日期|核准日期|授权公告日|注册公告日)\s*[：:]?\s*([^\n\r，,。；;]{4,20})/));
  const rTo = normDate(line(/(?:有效期至|有效期截止|专用权期限至|专用期限至|保护期至)\s*[：:]?\s*([^\n\r，,。；;]{4,20})/));
  const h = fileHash(fn + '|' + type);
  const FB = {
    '商标':       { no: '第 ' + (10000000 + h % 89999999) + ' 号', name: '×× ' + ['图形', '文字', '图文组合', '字母'][h % 4], cat: '第 ' + (1 + h % 45) + ' 类' },
    '专利':       { no: 'ZL' + (2020 + h % 6) + (100000 + h % 899999) + '.' + (h % 9), name: '一种××' + ['杯盖结构', '连接件', '包装结构'][h % 3], cat: ['实用新型', '外观设计', '发明专利'][h % 3] },
    '著作权':     { no: '国作登字-' + (2020 + h % 6) + '-F-' + (10000 + h % 89999), name: '×× ' + ['LOGO', '包装', '插画'][h % 3] + '美术作品', cat: '美术作品' },
    '知名度证据': { no: '证据-' + (2024 + h % 3) + '-' + (100 + h % 899), name: '×× ' + ['品牌知名度', '销量数据', '广告投放'][h % 3] + '材料', cat: '知名度材料' },
    '授权书':     { no: '授权书-' + (2024 + h % 3) + '-' + (100 + h % 899), name: '×× 商标授权书', cat: '授权文件' },
    '其他':       { no: '权属文件-' + (2024 + h % 3) + '-' + (100 + h % 899), name: fn.replace(/\.[^.]+$/, '') || '权属文件', cat: '其他' },
  };
  const fb = FB[type] || FB['其他'];
  const cust = (typeof curCustomer === 'function' && curCustomer()) ? curCustomer().name : '';
  const hits = [];
  if (rNo) hits.push('注册号 / 申请号');
  if (rName) hits.push('名称');
  if (rCat) hits.push('类别');
  if (rOwner) hits.push('权利人');
  if (rFrom) hits.push('注册日期');
  if (rTo) hits.push('有效期至');
  const out = {
    type, doc: fn,
    no: rNo || fb.no,
    name: rName || fb.name,
    cat: rCat || fb.cat,
    owner: rOwner || cust || '—',
    from: rFrom || today(),
    to: rTo || ((new Date().getFullYear() + 10) + today().slice(4)),
    hits,
  };
  out.status = assetStatusOf(out).text;   // 状态取自「有效期至」，识别后一并填充
  return out;
}

function renderAssets() {
  const c = curCustomer(); if (!c) return;
  const list = c.assets || [];
  const cnt = document.getElementById('asset-count');
  if (cnt) cnt.textContent = list.length;
  const body = document.getElementById('asset-tbody');
  // 容器缺失时静默返回，不能抛错——否则会中断整个客户详情的渲染链
  if (!body) return;
  body.innerHTML = list.map((a, i) => `
    <tr>
      <td><span class="tag ${assetTcls(a.type)}">${esc(a.type)}</span></td>
      <td>${a.doc
        ? `<div style="display:flex;align-items:center;gap:6px;">
             <span class="mono" style="font-size:12px;max-width:132px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(a.doc)}">${esc(a.doc)}</span>
             <button class="btn btn-ghost btn-sm asset-doc-btn" onclick="uploadAssetDoc(${i})" title="重新上传权属文件并识别填充">重传</button>
           </div>`
        : `<button class="btn btn-secondary btn-sm asset-doc-btn" onclick="uploadAssetDoc(${i})" title="上传权属文件并识别填充">上传</button>`}</td>
      <td class="mono">${a.no ? esc(a.no) : '—'}</td>
      <td style="color:var(--color-ink);font-weight:500;">${a.name ? esc(a.name) : '—'}</td>
      <td>${esc(a.cat)}</td>
      <td>${esc(a.owner)}</td>
      <td class="mono">${esc(a.from)}</td>
      <td class="mono">${esc(a.to)}</td>
      <td><span class="pill ${assetStatusOf(a).cls}">${esc(assetStatusOf(a).text)}</span></td>
      <td><div style="display:flex;align-items:center;gap:4px;">
        <button class="btn btn-ghost btn-sm" onclick="editAsset(${i})" title="编辑该行权利资产信息">编辑</button>
        <button class="btn btn-ghost btn-sm btn-icon" onclick="removeAsset(${i})" title="删除该行权利资产">×</button>
      </div></td>
    </tr>`).join('') || emptyRow(10, '还没有登记权利资产', '点「+ 登记权利」逐条录入，或「批量上传权属」上传权属文件自动识别建档');
}

// ============================================================
// 7. 操作
// ============================================================
/* ---------- 视图切换 ---------- */
const VIEW_LABEL = { cases: '我的案件', customers: '客户管理', leads: '线索库',
  notary: '公证阶段', evidence: '证物管理', calendar: '日历', settlement: '结算中心', reports: '数据报表', settings: '设置' };
const NAV_OF = { detail: 'cases', 'customer-detail': 'customers' };

/* 侧栏二级目录：视图 → 子目录容器 / 父项按钮（与 index.html 中的 id 对应） */
const SUBNAV_OF = {
  leads:  { sub: 'leads-subnav',  parent: 'leads-parent' },
  notary: { sub: 'notary-subnav', parent: 'notary-parent' },
  cases:  { sub: 'cases-sub',     parent: 'cases-parent' },
};
/* 展开/收起某个二级目录 */
function toggleSubNav(view) {
  const cfg = SUBNAV_OF[view]; if (!cfg) return;
  const sub = document.getElementById(cfg.sub);
  const parent = document.getElementById(cfg.parent);
  if (!sub) return;
  const willOpen = !sub.classList.contains('open');
  sub.classList.toggle('open', willOpen);
  if (parent) parent.classList.toggle('expanded', willOpen);
  if (willOpen) showView(view);
}
/* 切换视图时：展开当前视图的二级目录，收起其它（保持侧栏整洁） */
function syncSubNav(name) {
  Object.keys(SUBNAV_OF).forEach(v => {
    const cfg = SUBNAV_OF[v];
    const sub = document.getElementById(cfg.sub);
    const parent = document.getElementById(cfg.parent);
    if (!sub) return;
    const on = (v === name);
    sub.classList.toggle('open', on);
    if (parent) parent.classList.toggle('expanded', on);
  });
}
/* 面包屑：支持「工作台 / 公证阶段 / 待出证」三级 */
function setCrumb(main, sub) {
  const c = document.getElementById('crumb-current');
  const s = document.getElementById('crumb-sub');
  const sep = document.getElementById('crumb-sub-sep');
  if (c) { c.textContent = main || ''; c.classList.toggle('current', !sub); }
  if (s) { s.textContent = sub || ''; s.style.display = sub ? '' : 'none'; }
  if (sep) sep.style.display = sub ? '' : 'none';
}

function showView(name) {
  if (name === 'settings') renderSettings();
  /* v151：费用中心已并入结算中心（第三个 tab），不再是独立视图 ——
     兼容所有老调用点，统一重定向到「结算中心 · 费用中心」。 */
  if (name === 'fees') { showView('settlement'); switchSettleTab('fee'); renderFees(); return; }
  $$('.view').forEach(v => v.classList.remove('active'));
  $$('.nav-item').forEach(n => n.classList.remove('active'));
  const t = document.getElementById('view-' + name);
  if (!t) { toast('该模块正在建设中', name, 'info'); return; }
  t.classList.add('active');
  const navKey = NAV_OF[name] || name;
  const b = document.querySelector('.nav-item[data-view="' + navKey + '"]');
  if (b) b.classList.add('active');
  const c = document.getElementById('crumb-current');
  if (c) c.textContent = VIEW_LABEL[navKey] || '';
  setCrumb(VIEW_LABEL[navKey] || '', subCrumbOf(navKey));
  window.scrollTo(0, 0);
  syncSubNav(navKey);
  if (name === 'cases') syncCasesNav();
  if (name === 'notary') applyNotaryColPrefs();
}
/* v151：跳转到「结算中心 · 费用中心」tab —— 侧边栏不再有独立入口，
   凡是「去费用中心看看」的调用点（发起缴费、费用详情…）统一走这里。 */
function goFees() {
  showView('settlement');
  switchSettleTab('fee');
  renderFees();
}
/* 当前视图的二级阶段面包屑文案 */
function subCrumbOf(navKey) {
  if (navKey === 'notary') return NOTARY_FILTER && NOTARY_FILTER.status !== '全部' ? NOTARY_FILTER.status : '';
  if (navKey === 'leads') return LEAD_FILTER && LEAD_FILTER.status !== '全部' ? LEAD_FILTER.status : '';
  if (navKey === 'cases') return FILTER && FILTER.status !== '全部' ? FILTER.status : '';
  return '';
}

/* 我的案件 → 阶段子目录 */
function toggleCasesSub() {
  const sub = document.getElementById('cases-sub');
  const parent = document.getElementById('cases-parent');
  if (!sub) return;
  if (sub.classList.contains('open')) {
    sub.classList.remove('open'); parent.classList.remove('expanded');
  } else {
    sub.classList.add('open'); parent.classList.add('expanded');
    if (!document.getElementById('view-cases').classList.contains('active')) showView('cases');
  }
}
function gotoCaseStage(stage) {
  FILTER.status = stage;
  FILTER.statusSet = [];   // v66：侧栏切换为单选语义，清空表头多选
  renderCases();
  showView('cases'); // 内部调用 syncCasesNav
}
function syncCasesNav() {
  const sub = document.getElementById('cases-sub');
  const parent = document.getElementById('cases-parent');
  if (sub) sub.classList.add('open');
  if (parent) parent.classList.add('expanded');
  // 只操作「我的案件」自己的子项：早期版本用全局 '.nav-sub-item' 选择器，会把线索库 / 公证阶段二级目录的 active 一并清掉
  // v65/v67：组按钮在 FILTER.status 为组名或组内任一子阶段时高亮；表头多选全部落在同一组内时该组按钮也高亮
  const setKeys = Array.isArray(FILTER.statusSet) ? FILTER.statusSet : [];
  $$('#cases-sub .nav-sub-item').forEach(el => {
    const gKeys = groupStageKeys(el.dataset.status);
    const setAllInGroup = setKeys.length > 0 && gKeys.length > 0 && setKeys.every(k => gKeys.includes(k));
    el.classList.toggle('active',
      (setKeys.length === 0 && (el.dataset.status === FILTER.status || gKeys.includes(FILTER.status))) ||
      setAllInGroup);
  });
  $$('.case-stage-tab').forEach(el => el.classList.toggle('active', el.dataset.status === FILTER.status));
}
function switchTab(panelId) {
  const btn = document.querySelector(`.tab[data-tab="${panelId}"]`);
  if (btn) btn.click();
}

/* ---------- 案件 CRUD ---------- */
/* v96：创建案件弹窗里「客户」一变 → 同步刷新只读的「案件单号」预览（客户序号取建档顺序） */
function recalcCaseNo() {
  const body = document.getElementById('modal-body'); if (!body) return;
  const custEl = body.querySelector('[data-k="cust"]');
  const outEl = body.querySelector('[data-k="caseNo"]');
  if (!outEl) return;
  outEl.value = nextCaseNo(custEl ? String(custEl.value || '').trim() : '');
}

function newCase(prefillClient) {
  formModal({
    title: '创建案件',
    wide: true,
    submitText: '创建',
    fields: [
      // v12：去掉「基础信息 / 案件信息」分组标题，整张表单统一字段顺序。
      //      「客户」字段排在「权利人」之前；线索来源由 placeholder 改为下拉（线上/线下）。
      // v96：「案件单号」改为只读自动生成（客户一改就联动刷新），不再手填；案号仍在立案阶段补登
      { key: 'caseNo', label: '案件单号', span: 2, readonly: true, value: nextCaseNo(prefillClient || ''),
        hint: '自动生成：客户创建序号(3位) + 年月日(8位) + 当日该客户线索序号(3位)，如 00920260902001' },
      { key: 'cust', label: '客户', required: true, value: prefillClient || '',
        placeholder: '如：杭州××品牌管理公司', span: 2, oninput: 'recalcCaseNo()',
        hint: '客户即委托方，与「权利人」可不同：客户是签约付费方，权利人是商标/著作权等知识产权的所有人' },
      { key: 'client', label: '权利主体', required: true,
        placeholder: '如：杭州××科技有限公司', span: 2 },
      { key: 'reason', label: '侵权类型', type: 'multi', value: '商标权', options: INFRINGE_TYPES,
        placeholder: '请选择侵权类型（可多选）' },
      { key: 'shop', label: '店铺名', placeholder: '如：××优品官方店' },
      { key: 'source', label: '线索来源', type: 'select', value: '线上', options: SOURCES },
      { key: 'platform', label: '平台', type: 'select', value: '淘宝', options: PLATFORMS },
      { key: 'defendant', label: '被告', placeholder: '如：杭州××贸易有限公司 / 淘宝"××优品"经营方' },
      { key: 'type', label: '案件类型', type: 'select', value: '民事', options: CASE_TYPES },
      { key: 'operator', label: '运营', type: 'select', value: '陈晓敏', options: Object.keys(OPERATORS) },
      { key: 'status', label: '初始阶段', type: 'select', value: '案件待匹配', options: STAGE_KEYS },
    ],
    onSubmit: d => {
      // v96：案件主键 = 案件单号（按客户序号 + 年月日 + 当日序号自动生成）
      const id = nextCaseNo(d.cust);
      const opStyle = operatorStyle(d.operator);
      const tagMap = CASE_TYPE_TAG;
      // 案件名称自动派生：`权利人 vs 店铺名 + 案由`；如缺则回落通用兜底
      const party = d.client ? `${d.client} vs ${d.shop || '—'} ${d.reason}纠纷` : `${d.shop || ''} ${d.reason}案`;
      // v150：立案法院 / 案号在创建时都还没有（v11 已从表单移除立案法院字段，由流转阶段补登）→ 留空
      const nc = {
        id, title: party,
        no: '',   // v96：案号由立案阶段补登；案件单号已独立生成（见 id）
        caseNo: id,
        // v12：cust（客户）与 client（权利人）并存，老存档无 cust 时兜底为 client
        cust: d.cust || d.client,
        client: d.client,
        type: d.type, typeTag: tagMap[d.type] || 'tag-blue',
        defendant: d.defendant || '—',
        platform: d.platform, shop: d.shop || '',
        source: d.source || '线上', reason: d.reason,
        amount: '¥ 0',         // v11：标的额由诉讼阶段补登，不在创建时强求
        court: '',
        operator: d.operator,
        opInitial: opStyle.opInitial, opColor: opStyle.opColor,
        status: d.status, updated: '刚刚',
      };
      Object.assign(nc, caseExtras(nc));
      STATE.cases.unshift(nc);
      save(); renderAll();
      toast('案件创建成功', `${id} · ${party.slice(0, 16)}…`);
      openCase(id);
    },
  });
}

/* ---------- v146：合并起诉 ----------
   业务口径（用户 2026-09-14 明确定下，四条）：
   ① 只有「客户 + 权利主体」都一致的案件才能合并，且至少勾选 2 件；
   ② 源案件的数据复制一份进新案件；源案件本体移出「我的案件」，
      并在「公证阶段 → 已归档」各补一条归档记录（归档日期=今天、归档原因=合并起诉）；
   ③ 新案件在「案件待匹配」阶段生成，案件单号自动生成；
   ④ 新案件「案件信息」除案件单号外逐字段查重：各案取值不一致 → 弹窗逐字段二次判断
      （列出各案的取值单选 + 支持自定义手填）；
   ⑤ 文件管理 / 费用管理 / 线索信息 把合并前各店铺的信息按「线索N · 店铺名」分组展示。 */

/* 查重字段清单 = 案件信息面板的字段全集（+ 建案期就存在、会影响新案件的几个字段）
   案件单号 / 案件进展 不参与：前者自动生成，后者恒为「案件待匹配」。
   merge:true → 不做一致性判断，而是「按店铺并列合并」（店铺名）；
   sum:true   → 不做一致性判断，而是金额相加（标的额）。 */
const MERGE_FIELDS = [
  { k: 'cust',   label: '客户',     get: c => String(c.cust || c.client || '') },
  { k: 'client', label: '权利主体', get: c => String(c.client || '') },
  { k: 'defendant', label: '被告',  get: c => (Array.isArray(c.defendants) && c.defendants.length)
      ? c.defendants.map(d => (d && d.name) || '').filter(Boolean).join('、')
      : String((c.defendant && c.defendant !== '—') ? c.defendant : '') },
  { k: 'reason', label: '侵权类型', get: c => Array.isArray(c.reason) ? c.reason.join('、') : String(c.reason || '') },
  { k: 'type',   label: '案件类型', get: c => String(c.type || '') },
  { k: 'operator', label: '运营',   get: c => String(c.operator || '') },
  { k: 'archiveAt', label: '归档日期', get: c => String(c.archiveAt || '').slice(0, 10) },
  { k: 'archiveReason', label: '归档原因', get: c => String(c.archiveReason || '') },
  { k: 'shop',   label: '店铺名',   merge: true, get: c => String(c.shop || '') },
  { k: 'platform', label: '平台',   get: c => String(c.platform || '') },
  { k: 'source', label: '线索来源', get: c => String(c.source || '') },
  { k: 'amount', label: '标的额',   sum: true,   get: c => String(c.amount || '') },
  { k: 'court',  label: '立案法院', get: c => String(c.court || '') },
];
const mergeFieldOf = k => MERGE_FIELDS.find(f => f.k === k) || null;
// 合并后的案件：按店铺分组展示的原始数据源（各源案件的快照）
function mergedSourcesOf(c) { return (c && Array.isArray(c.mergedFrom) && c.mergedFrom.length) ? c.mergedFrom : null; }
// 店铺序号标签：线索1 / 线索2 …
function mergeShopLabel(i) { return '线索' + (i + 1); }
// 公证阶段「已归档」记录的编号（与既有 N-xxxx-xxx 不冲突）
function nextMergeNotaryId() {
  let i = 1;
  while (NOTARY_ITEMS.some(n => n && n.id === 'N-MERGE-' + String(i).padStart(3, '0'))) i++;
  return 'N-MERGE-' + String(i).padStart(3, '0');
}

function mergeCases() {
  const picked = Array.from(SELECTED);
  const src = STATE.cases.filter(c => c && picked.indexOf(c.id) >= 0 && c.status === '案件待匹配');
  if (src.length < 2) {
    toast('请先勾选至少 2 件「案件待匹配」的案件',
      `已勾选 ${picked.length} 件，其中处于「案件待匹配」的只有 ${src.length} 件`, 'info');
    return;
  }
  // 一致性校验：客户 + 权利主体（两者都要一致）
  const keyOf = c => String(c.cust || c.client || '') + '\u0001' + String(c.client || '');
  const bad = src.filter(c => keyOf(c) !== keyOf(src[0]));
  if (bad.length) {
    toast('不能合并：客户或权利主体不一致',
      `${bad.map(c => caseNoOf(c)).join('、')} 与 ${caseNoOf(src[0])} 的客户 / 权利主体不同；只有两者都一致的案件才能合并起诉`, 'error');
    return;
  }
  // 字段查重（店铺名并列合并、标的额相加 → 不参与）
  const conflicts = [];
  MERGE_FIELDS.forEach(f => {
    if (f.merge || f.sum) return;
    const vals = [];
    src.forEach(c => { const v = f.get(c); if (vals.indexOf(v) < 0) vals.push(v); });
    if (vals.length > 1) conflicts.push({ f, vals });
  });
  openModal({
    title: '合并起诉确认',
    xwide: true,
    okText: '确认合并起诉',
    bodyHTML: mergeConfirmHTML(src, conflicts),
    // 注意：openModal 的确定按钮不认 onOk 的返回值（点完不会自动关窗，与 formModal 不同），
    // 所以校验通过后必须自己 closeModal()，否则合并完这个弹窗会一直挂在屏幕上。
    onOk: () => {
      const picks = readMergePicks(conflicts);
      if (picks === false) return false;      // 自定义项留空：不关窗，让用户改完再提交
      closeModal();
      doMergeCases(src, picks);
      return true;
    },
  });
}

function mergeConfirmHTML(src, conflicts) {
  const rows = src.map((c, i) => `<tr>
      <td class="num">${i + 1}</td>
      <td class="mono">${esc(caseNoOf(c))}</td>
      <td>${esc(shopOf(c) || '—')}</td>
      <td><span class="pill ${stageOf(c.status).cls}">${esc(c.status)}</span></td>
    </tr>`).join('');
  const ccRows = conflicts.length ? conflicts.map(cf => `
      <div class="merge-cc" data-mc="${esc(cf.f.k)}">
        <div class="merge-cc-src">「${esc(cf.f.label)}」在各案取值不一致 —— 请选择合并后保留哪一个，或自定义填写</div>
        <div class="merge-cc-opts">
          ${cf.vals.map((v, i) => `<label><input type="radio" name="mc-${esc(cf.f.k)}" value="${esc(v)}"${i === 0 ? ' checked' : ''}>${v === '' ? '<span class="text-muted">（空）</span>' : esc(v)}</label>`).join('')}
          <span class="merge-cc-cust"><input type="radio" name="mc-${esc(cf.f.k)}" value="__custom">自定义
            <input class="form-input" data-mc-in="${esc(cf.f.k)}" placeholder="手工填写"
              oninput="var r=this.parentNode.querySelector('input[value=__custom]'); if(r) r.checked=true;"></span>
        </div>
      </div>`).join('')
    : '<div class="form-hint">各案字段取值完全一致，无需二次判断，直接确认即可。</div>';
  return `
    <div class="lead-detail-section">将被合并的案件（${src.length}）</div>
    <div class="table-wrap" style="margin-bottom:12px;"><table class="table">
      <thead><tr><th class="num">#</th><th>案件单号</th><th>店铺名</th><th>案件进展</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="lead-detail-section">合并后会发生什么</div>
    <div class="form-hint" style="margin-bottom:12px;">
      ① 生成一件新的「案件待匹配」案件（<b>案件单号自动生成</b>；店铺名并列、标的额相加）；<br>
      ② 上述源案件<b>移出「我的案件」</b>，并在「公证阶段 → 已归档」各留一条归档记录
        （归档日期 <b>${esc(today())}</b>、归档原因 <b>合并起诉</b>）；<br>
      ③ 源案件的文件 / 费用 / 线索信息会按店铺分组保留在新案件里（线索1 / 线索2 …）。
    </div>
    <div class="lead-detail-section">字段二次判断（${conflicts.length} 项冲突）</div>
    <div class="merge-cc-list">${ccRows}</div>`;
}

// 读回二次判断结果；自定义项留空 → 提示并阻止提交（返回 false）
function readMergePicks(conflicts) {
  const body = document.getElementById('modal-body');
  const out = {};
  let missingKey = null, missingEl = null;
  conflicts.forEach(cf => {
    const k = cf.f.k;
    const box = body ? body.querySelector(`.merge-cc[data-mc="${k}"]`) : null;
    if (!box) { out[k] = cf.vals[0]; return; }
    const checked = box.querySelector('input[type="radio"]:checked');
    const val = checked ? checked.value : cf.vals[0];
    if (val === '__custom') {
      const inp = box.querySelector(`[data-mc-in="${k}"]`);
      const t = inp ? String(inp.value || '').trim() : '';
      if (!t && !missingKey) { missingKey = k; missingEl = inp; }
      out[k] = t;
    } else {
      out[k] = val;
    }
  });
  if (missingKey) {
    const f = mergeFieldOf(missingKey);
    toast('「' + ((f && f.label) || missingKey) + '」选了自定义但没填写', '请填写内容，或改选其它取值', 'error');
    if (missingEl) missingEl.classList.add('err');
    return false;
  }
  return out;
}

function doMergeCases(src, picks) {
  const at = today();
  const cust = String(src[0].cust || src[0].client || '');
  // ① 单号在「源案件仍留在 STATE.cases」时计算 —— nextCaseNo 会把它们的序号一并计入，天然不撞号
  const id = nextCaseNo(cust);
  const pickOf = k => (picks && Object.prototype.hasOwnProperty.call(picks, k)) ? picks[k] : null;
  const valOf = k => { const p = pickOf(k); const f = mergeFieldOf(k); return (p != null && p !== '') ? p : ((f && f.get) ? f.get(src[0]) : ''); };

  // 店铺名并列 + 标的额相加 + 被告合并去重
  const shops = [];
  src.forEach(c => { const s = String(c.shop || '').trim(); if (s && shops.indexOf(s) < 0) shops.push(s); });
  const amtSum = src.reduce((a, c) => a + numOf(c.amount), 0);
  const defObjs = [];
  src.forEach(c => (Array.isArray(c.defendants) ? c.defendants : []).forEach(d => {
    if (d && d.name && !defObjs.some(x => x.name === d.name)) defObjs.push(Object.assign({}, d));
  }));
  const defText = defObjs.length ? defObjs.map(d => d.name).join('；') : valOf('defendant');

  const type = valOf('type') || src[0].type;
  const opStyle = operatorStyle(valOf('operator') || src[0].operator);
  const reasonTxt = Array.isArray(src[0].reason) ? src[0].reason.join('/') : String(src[0].reason || '侵权');
  const nc = {
    id, caseNo: id,
    title: `${valOf('client')} vs ${shops.join('、') || '待补充店铺'} ${reasonTxt}纠纷（合并起诉）`,
    // v150：原来写死「—  立案前」当占位 —— 用户口径「空就是横杠」，落库留空、显示层兜 —
    no: '',
    cust: valOf('cust') || src[0].cust,
    client: valOf('client') || src[0].client,
    type, typeTag: CASE_TYPE_TAG[type] || 'tag-blue',
    defendant: defText || '—',
    defendants: defObjs,
    platform: valOf('platform') || src[0].platform,
    shop: shops.join('、'),
    source: valOf('source') || src[0].source,
    reason: Array.isArray(src[0].reason) ? src[0].reason.slice() : src[0].reason,
    amount: amtSum > 0 ? '¥ ' + amtSum.toLocaleString() : '¥ 0',
    court: normBlank(valOf('court')) || normBlank(src[0].court) || '',
    operator: valOf('operator') || src[0].operator,
    opInitial: opStyle.opInitial, opColor: opStyle.opColor,
    status: '案件待匹配', updated: '刚刚',
    archiveAt: valOf('archiveAt') || '',
    archiveReason: valOf('archiveReason') || '',
    mergedFrom: src.map(c => JSON.parse(JSON.stringify(c))),      // 各店铺的原始数据（三处分组展示用）
    mergedCaseNos: src.map(c => caseNoOf(c)),
    timeline: [{ t: at, d: `合并起诉：由 ${src.map(c => caseNoOf(c)).join('、')} 合并而来` }],
  };
  Object.assign(nc, caseExtras(nc));
  // 合并壳是「聚合视图」：被告必须保留合并后的结构化数据（caseExtras 对「案件待匹配」返回空数组，
  // 直接 assign 会把刚合并出来的被告清空）；费用 / 侵权商品链接一律由源店铺承载，
  // 合并壳自身不留 caseExtras 生成的演示填充，否则「概览」金额会与「费用管理」的店铺卡片对不上。
  nc.defendants = defObjs;
  nc.expenses = [];
  nc.links = [];

  // ② 源案件 → 公证阶段「已归档」各补一条归档记录
  src.forEach(c => {
    NOTARY_ITEMS.push({
      id: nextMergeNotaryId(),
      case: c.title || ((c.client || '') + ' 侵权案'),
      caseId: c.id, caseNo: caseNoOf(c),
      shop: c.shop || '—', platform: c.platform || '—', shopId: c.shopId || '—',
      party: c.client || '—', cust: c.cust || c.client || '—',
      stage: '已归档', stageCls: NOTARY_STAGE_CLS['已归档'],
      archiveAt: at, archiveReason: '合并起诉',
      push: '—', buyAt: '—', recv: '—', recvAddr: '—', recvName: '—', recvPhone: '—',
      expressNo: '', logistics: [], openAuditResult: '', openAuditAt: '',
      openConfirmResult: '', openConfirmAt: '', discloseInfo: '', needReturn: '',
      refundAmt: 0, refundFreight: 0, photos: 0, ocr: false,
      docNo: '—', docDate: '—', feeN: 0, investFee: 0, feeP: 0, feeD: 0, disclose: '—',
      audit: '待审核', auditCls: 'pill-warning', office: '—',
      mergedInto: id,
    });
  });

  // ③ 源案件移出案件列表；新案件入列（并清掉勾选，避免下标残留）
  STATE.cases = STATE.cases.filter(c => src.indexOf(c) < 0);
  STATE.cases.unshift(nc);
  src.forEach(c => SELECTED.delete(c.id));

  save();
  renderAll();
  renderNotary();
  renderNotaryStageNav();
  updateNavBadges();
  currentCaseId = id;
  openCase(id);
  toast('合并起诉完成', `${src.length} 件 → ${id}；源案件已归档至「公证阶段 → 已归档」`, 'success');
}

/* ---------- 案件信息弹窗：被告多行编辑器（v144） ----------
   与「补充被告」的 df-row 结构一致，但用于「案件信息」编辑弹窗，因此：
   ① 行容器 id 用 cdf-rows（不与补充被告的 df-rows 冲突）；
   ② 既有多行被告带入已存值（只回填已有字段，kind 已存则按 kind 显示）；
   ③ 取值走 readCaseDefendants()，作为 'case-info' 分支 custom 字段的 read()。
   被告展示口径与面板一致（只显示姓名），这里保留完整字段以便编辑。 */
function caseDefRowHTML(d, i) {
  d = d || {};
  const kind = DEFENDANT_KINDS.indexOf(d.kind) >= 0 ? d.kind : DEFENDANT_KINDS[0];
  const isPerson = kind === DEFENDANT_KINDS[0];
  // 兼容历史数据：自然人存 name，法人存 name / org 都可能
  const personName = d.name || '';
  const orgName = d.org || (!isPerson ? (d.name || '') : '');
  return `
    <div class="df-row" style="border:1px solid var(--color-hairline);border-radius:8px;padding:12px;margin-bottom:12px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <div style="font-size:12px;font-weight:600;color:var(--color-ink-muted);">被告 <span class="df-idx">${i + 1}</span></div>
        <button type="button" class="btn btn-ghost btn-sm" onclick="removeCaseDefRow(this)">删除</button>
      </div>
      <div class="form-grid">
        <div class="form-field">
          <label class="form-label">被告类型</label>
          <select class="form-select" data-dk="kind" onchange="syncDefendantKind(this)">
            ${DEFENDANT_KINDS.map(k => `<option${k === kind ? ' selected' : ''}>${esc(k)}</option>`).join('')}
          </select>
        </div>
        <div class="form-field" data-for="自然人"${isPerson ? '' : ' style="display:none;"'}>
          <label class="form-label">姓名</label>
          <input class="form-input" data-dk="name" placeholder="如：李某某" value="${esc(personName)}">
        </div>
        <div class="form-field" data-for="法人/个体"${isPerson ? ' style="display:none;"' : ''}>
          <label class="form-label">单位名称</label>
          <input class="form-input" data-dk="org" placeholder="如：广州××百货商行" value="${esc(orgName)}">
        </div>
        <div class="form-field">
          <label class="form-label">联系电话</label>
          <input class="form-input" data-dk="phone" placeholder="如：139****8888" value="${esc(d.phone || '')}">
        </div>
        <div class="form-field" data-for="自然人"${isPerson ? '' : ' style="display:none;"'}>
          <label class="form-label">身份证号码</label>
          <input class="form-input" data-dk="idcard" placeholder="如：4401**********1234" value="${esc(d.idno || d.idcard || '')}">
        </div>
        <div class="form-field" data-for="法人/个体"${isPerson ? ' style="display:none;"' : ''}>
          <label class="form-label">统一社会信用代码</label>
          <input class="form-input" data-dk="credit" placeholder="如：91440101MA9******K8" value="${esc(d.idno || d.credit || '')}">
        </div>
        <div class="form-field full">
          <label class="form-label">住所地</label>
          <input class="form-input" data-dk="addr" placeholder="如：广东省 广州市 白云区 ××路 168 号" value="${esc(d.addr || '')}">
        </div>
      </div>
    </div>`;
}
function addCaseDefRow() {
  const box = document.getElementById('cdf-rows'); if (!box) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = caseDefRowHTML({}, box.querySelectorAll('.df-row').length);
  box.appendChild(wrap.firstElementChild);
  renumberCaseDefRows();
}
function removeCaseDefRow(btn) {
  const box = document.getElementById('cdf-rows'); if (!box) return;
  const row = btn && btn.closest ? btn.closest('.df-row') : null; if (!row) return;
  if (box.querySelectorAll('.df-row').length <= 1) { toast('至少保留一位被告，如需清空请取消后单独处理', '', 'info'); return; }
  row.remove(); renumberCaseDefRows();
}
function renumberCaseDefRows() {
  const box = document.getElementById('cdf-rows'); if (!box) return;
  box.querySelectorAll('.df-row').forEach((r, i) => { const s = r.querySelector('.df-idx'); if (s) s.textContent = i + 1; });
}
/* 读回案件信息弹窗里的被告（custom 字段的 read()）。空行（无姓名/单位名）跳过，不算一笔。 */
function readCaseDefendants() {
  const box = document.getElementById('cdf-rows'); if (!box) return [];
  const out = [];
  box.querySelectorAll('.df-row').forEach(r => {
    const g = k => { const el = r.querySelector('[data-dk="' + k + '"]'); return el ? String(el.value || '').trim() : ''; };
    const kind = g('kind') || DEFENDANT_KINDS[0];
    const isPerson = kind === DEFENDANT_KINDS[0];
    const name = isPerson ? g('name') : g('org');
    if (!name) return;                                     // 空行丢弃
    out.push({
      kind, name,
      idno: isPerson ? g('idcard') : g('credit'),
      phone: g('phone'), addr: g('addr'),
      // v145：不再写 tag（v129 已退役「主被告 / 共同被告」标签体系，该字段无人读取）。
      extra: '',
    });
  });
  return out;
}

/* ---------- 卡片级编辑：案件详情各折叠面板的「编辑」入口（编辑该卡片自身字段） ----------
   卡片 key 与 renderCollapsePanels 的 panels 一一对应：case-info / lead-info / first / judgment / second / exec
   合计 6 张卡片；结案信息（close）为只读展示，不提供编辑入口。 */
function editCard(caseId, card) {
  const c = STATE.cases.find(x => x.id === caseId); if (!c) return;
  const n = (typeof leadNotaryOf === 'function') ? leadNotaryOf(c) : null;
  const dateOnly = v => { const s = String(v == null ? '' : v).split(' ')[0]; return (s && s !== '—') ? s : ''; };
  const amtVal  = v => (v === undefined || v === null || v === '' || v === '—') ? '' : String(numOf(v));
  const amtStore = v => (v === '' || v === undefined || v === null) ? '' : '¥ ' + numOf(v).toLocaleString();

  const CFG = {
    'case-info': {
      title: '编辑案件信息',
      // v144：「案件信息」编辑弹窗 = 该面板实际展示的字段全集。此前只有 5 项（客户/权利主体/侵权类型/
      //   案件类型/运营），而面板还展示 被告 / 案件单号 / 案件进展 / 归档日期 / 归档原因 → 点「编辑」改不到。
      //   其中 案件单号（caseNoOf 派生）、案件进展（流程状态派生）是派生值 → 只读展示，不提供修改。
      fields: () => {
        // 只读信息块：被告按面板口径（每行一个姓名）+ 案件单号 / 案件进展
        const ds = (Array.isArray(c.defendants) ? c.defendants : []).filter(d => d && d.name);
        const defRO = ds.length ? ds.map(d => esc(d.name)).join('<br>') : '—';
        const roBlock = `<div class="field-list cols-3" style="margin-bottom:16px;">
            ${fieldRow('被告', defRO)}
            ${fieldRow('案件单号', `<span class="mono">${esc(caseNoOf(c))}</span>`)}
            ${fieldRow('案件进展', esc(c.status || '—'))}
          </div>`;
        const defRows = ds.length ? ds : [{}];
        return [
          { type: 'custom', key: '__ro', span: 2, html: roBlock, read: () => undefined },
          { key: 'cust',     label: '客户',     span: 2, value: c.cust || c.client || '' },
          { key: 'client',   label: '权利主体', span: 2, value: c.client || '' },
          { key: 'reason',   label: '侵权类型', type: 'multi', value: normalizeInfringe(c.reason), options: INFRINGE_TYPES,
            placeholder: '请选择侵权类型（可多选）' },
          { key: 'type',     label: '案件类型', type: 'select', value: c.type, options: CASE_TYPES },
          { key: 'operator', label: '运营',     type: 'select', value: c.operator, options: Object.keys(OPERATORS) },
          // v144：被告多行编辑（整行宽）
          { type: 'custom', key: 'defendants', span: 2,
            html: `<div id="cdf-rows">${defRows.map((d, i) => caseDefRowHTML(d, i)).join('')}</div>
              <button type="button" class="btn btn-secondary btn-sm" onclick="addCaseDefRow()">+ 添加被告</button>
              <div class="form-hint">被告按行编辑；留空姓名的行保存时会被丢弃。第一行即主要被告。</div>`,
            read: () => readCaseDefendants() },
          // v144：归档日期 / 归档原因（面板已展示，此前弹窗缺失）
          { key: 'archiveAt',     label: '归档日期', type: 'date', value: dateOnly(c.archiveAt || '') },
          { key: 'archiveReason', label: '归档原因', value: c.archiveReason || '' },
        ];
      },
      apply: d => {
        c.cust = d.cust; c.client = d.client; c.reason = d.reason;
        if (d.type !== c.type) { c.type = d.type; c.typeTag = CASE_TYPE_TAG[d.type] || 'tag-blue'; }
        c.operator = d.operator;
        // v144：被告（custom read() 返回数组；有内容才覆盖，避免弹窗异常时清空既有被告）
        if (Array.isArray(d.defendants) && d.defendants.length) c.defendants = d.defendants;
        // v144：归档日期 / 归档原因
        c.archiveAt = d.archiveAt || '';
        c.archiveReason = d.archiveReason || '';
      },
    },
    'lead-info': {
      title: '编辑线索信息',
      guard: () => !!n,
      fields: () => {
        // v143：「线索信息」编辑弹窗 = 该面板实际展示的字段全集（此前只有 4 项，面板显示 7 项，
        //   点「编辑」改不到公证书 / 披露文件）。字段顺序与面板左右两列一致。
        //   公证书来源是公证书台账（NOTARY_DOCS），不是案件自身字段 → 只读展示，不提供修改。
        const leadDoc = NOTARY_DOCS.find(d => (c.notaryId && d.caseId === c.notaryId) || d.caseId === c.id || (n && d.caseId === n.id)) || null;
        const certRO = leadDoc
          ? (leadDoc.file && leadDoc.file !== '—'
              ? `${esc(leadDoc.file)} <span class="pill ${leadDoc.statusCls || 'pill-neutral'}" style="margin-left:6px;">${esc(leadDoc.status || '')}</span>`
              : `<span class="pill ${leadDoc.statusCls || 'pill-warning'}">${esc(leadDoc.status || '未出纸质证')}</span>`)
          : '—';
        const roBlock = `<div class="field-list cols-3" style="margin-bottom:16px;">
            ${fieldRow('开箱照片', openPhotoText(n))}
            ${fieldRow('公证书', certRO)}
            ${fieldRow('披露文件', (Array.isArray(c.disclosures) && c.disclosures.length)
              ? c.disclosures.map(f => esc(f.name || '未命名文件')).join('<br>') : '—')}
          </div>`;
        return [
          { type: 'custom', key: '__ro', span: 2, html: roBlock, read: () => undefined },
          { key: 'platform', label: '平台', type: 'select', value: (n.platform && n.platform !== '—') ? n.platform : '淘宝', options: PLATFORMS },
          { key: 'shop',     label: '店铺名', value: (n.shop && n.shop !== '—') ? n.shop : '' },
          { key: 'shopId',   label: '店铺ID', value: (n.shopId && n.shopId !== '—') ? n.shopId : '' },
          { key: 'docNo',    label: '公证书编号', value: (n.docNo && n.docNo !== '—') ? n.docNo : '' },
          // v143：披露文件是上传入口（可多选），文件名逗号分隔存储
          { key: 'discloseFiles', label: '披露文件', type: 'file', span: 2, multiple: true,
            value: (Array.isArray(c.disclosures) ? c.disclosures.map(f => f.name).filter(Boolean).join('、') : '') },
        ];
      },
      apply: d => {
        n.platform = d.platform; n.shop = d.shop || '—'; n.shopId = d.shopId || '—';
        n.docNo = d.docNo || '—';
        // v143：披露文件回写案件级 c.disclosures（留空则清空，与「没填就是空」口径一致）
        const names = String(d.discloseFiles || '').split('、').map(s => s.trim()).filter(Boolean);
        c.disclosures = names.map(nm => ({ name: nm, ext: (nm.split('.').pop() || '').toUpperCase(), size: '—', status: '已上传' }));
        if (names.length) c.disclosures[0].status = '待确认';
      },
    },
    'first': {
      // v135：「一审信息」编辑弹窗 = 该面板实际展示的字段全集（此前只有 9 项，面板显示 18 项，
      //   点「编辑」看不到大部分字段的信息）。字段顺序与面板左右两列一致。
      title: '编辑一审信息',
      fields: () => [
        // 左列
        { key: 'court',        label: '立案法院', type: 'select', span: 2, options: COURTS, value: normBlank(c.court) || '—' },
        // v139：立案截图 / 送达文书 / 起诉状 都是「上传文件」，不是文字输入
        { key: 'filingShot',   label: '立案截图', type: 'file', span: 2, value: c.filingShot || '' },
        { key: 'mediateNo',    label: '诉调号 / 立案编号', value: c.mediateNo || '' },
        { key: 'submitAt',     label: '提交立案日期', type: 'date', value: dateOnly(c.submitAt || logTime(c, '上传诉状')) },
        { key: 'formalAt',     label: '正式立案日期', type: 'date', value: dateOnly(c.formalAt || logTime(c, '正式立案')) },
        { key: 'hearingAt',    label: '开庭日期', type: 'date', value: dateOnly(c.hearingAt || logTime(c, '开庭')) },
        { key: 'hearingPlace', label: '开庭地点', value: c.hearingPlace || '' },
        { key: 'serviceDoc',   label: '送达文书', type: 'file', span: 2, value: c.serviceDoc || '' },
        // 右列
        { key: 'caseNo',       label: '案号', value: c.caseNo || '' },
        // v137：立案受理通知书 / 调档文件 / 披露数据附件 都是「上传文件」，不是文字输入
        { key: 'acceptNotice', label: '立案受理通知书', type: 'file', span: 2, value: c.acceptNotice || '' },
        { key: 'amount',       label: '标的额（元）', type: 'number', value: amtVal(c.amount) },
        { key: 'judge',        label: '承办法官', value: c.judge || '' },
        // v136：披露数据 / 披露数据附件 = 一审阶段的案件级字段（c.discloseInfo / c.disclose）
        { key: 'discloseInfo', label: '披露数据', value: c.discloseInfo || '' },
        { key: 'disclose',     label: '披露数据附件', type: 'file', span: 2, value: c.disclose || '' },
        // v145：起诉状 ——
        //   ① 此前排在弹窗最后一位，弹窗很长不滚到底看不见 → 上移到「调档文件」前（同属一审文书组）；
        //   ② 改为多文件（multiple），文件名以「、」拼接，与披露文件同款交互（按钮文案「添加」）；
        //   ③ 新增「清除」入口：删除此前上传的起诉状（此前只能整框替换，删不掉）；
        //   ④ hint 说明「可多选 + 清除」的用法，避免再次误判成「没有这个字段」。
        { key: 'authDocs',     label: '起诉状', type: 'file', span: 2, multiple: true,
          value: authDocsOf(c).join('、'),
          clear: true,
          hint: '可一次选多个文件（文件名以「、」分隔）；点「清除」删除已上传的起诉状后重新上传。' },
        { key: 'filingDocs',   label: '调档文件', type: 'file', span: 2, value: (Array.isArray(c.filingDocs) ? c.filingDocs.join('、') : (c.filingDocs || '')) },
      ],
      apply: d => {
        c.court = d.court; c.caseNo = d.caseNo; c.mediateNo = d.mediateNo;
        if (d.amount !== '') c.amount = amtStore(d.amount);
        c.filingShot = d.filingShot; c.acceptNotice = d.acceptNotice;
        c.serviceDoc = d.serviceDoc; c.hearingPlace = d.hearingPlace; c.judge = d.judge;
        // v136：披露数据 / 披露数据附件（一审阶段案件级字段）
        c.discloseInfo = d.discloseInfo; c.disclose = d.disclose;
        // v144：起诉状改为正常回写（此前「留空不覆盖」的守卫会让用户换文件名 / 清空时保存不生效，
        //   表现为「点了编辑还是改不了起诉状」）。与同卡片其它 file 字段（立案截图/送达文书/调档文件）口径一致。
        // v145：支持多文件 → 主存 c.authDocs（数组）；c.authDoc 同步为「第一个文件」以兼容
        //   仍按单值读取的旧逻辑（导出诉状默认文件名、阶段表单等）。清空时两者一起清掉。
        const ads = String(d.authDocs || '').split(/[、,，]/).map(s => s.trim()).filter(Boolean);
        c.authDocs = ads;
        c.authDoc = ads.length ? ads[0] : '';
        // 日期字段：写顶层键（面板优先读顶层，其次回落到时间轴节点）
        c.submitAt = d.submitAt; c.formalAt = d.formalAt; c.hearingAt = d.hearingAt;
        // 调档文件：字符串 ↔ 数组互转（面板按数组渲染）
        const fd = String(d.filingDocs || '').trim();
        c.filingDocs = fd ? fd.split(/[、,，]/).map(s => s.trim()).filter(Boolean) : [];
      },
    },
    'judgment': {
      title: '编辑判决信息',
      // v144：补齐「诉讼退费」（与判决更新环节同一份数据 c.refunds，复用 refundsHTML / collectRefunds，
      //   含退费方 / 金额 / 状态与「退费合计」实时联动）；判决书由纯文本改为「上传文件」并去掉 label 里的「（文件名）」。
      fields: () => [
        { key: 'judgeGotAt', label: '收到判决日期', type: 'date', value: dateOnly(c.judgeGotAt || logTime(c, '判决')) },
        { key: 'judgeAmt',   label: '判决金额（元）', type: 'number', value: amtVal(c.judgeAmt || (c.ov && c.ov.judgeAmt)) },
        { key: 'paidFee',    label: '实缴诉讼费（元）', type: 'number', value: amtVal(c.paidFee) },
        { key: 'judgeDoc',   label: '判决书', type: 'file', span: 2, value: c.judgeDoc || '' },
        { type: 'custom', key: 'refunds', label: '诉讼退费（可多笔）', span: 2,
          html: refundsHTML(c) + '<div class="form-hint">与「判决更新」环节登记的是同一份数据：金额为 0 的行不记账。</div>',
          read: () => collectRefunds(document.getElementById('modal-body') || document) },
      ],
      apply: d => {
        c.judgeGotAt = d.judgeGotAt; c.judgeDoc = d.judgeDoc;
        if (d.judgeAmt !== '') c.judgeAmt = amtStore(d.judgeAmt);
        if (d.paidFee !== '') c.paidFee = amtStore(d.paidFee);
        // v144：诉讼退费回写（custom read() 返回 { from, amt, status }[]）+ 同步合计
        const list = Array.isArray(d.refunds) ? d.refunds : [];
        c.refunds = list;
        c.refundTotal = list.reduce((a, r) => a + (Number(r.amt) || 0), 0);
      },
    },
    'second': {
      title: '编辑二审信息',
      fields: () => [
        // v142：二审文书 / 二审送达文书 都是「上传文件」，不是文字输入
        { key: 'secondDoc',          label: '二审文书', type: 'file', span: 2, value: c.secondDoc || '' },
        { key: 'secondHearingAt',    label: '二审开庭日期', type: 'date', value: dateOnly(c.secondHearingAt) },
        { key: 'secondHearingPlace', label: '二审开庭地点', value: c.secondHearingPlace || '' },
        { key: 'secondServiceDoc',   label: '二审送达文书', type: 'file', span: 2, value: c.secondServiceDoc || '' },
        { key: 'secondJudge',        label: '二审法官', value: c.secondJudge || '' },
      ],
      apply: d => {
        c.secondDoc = d.secondDoc; c.secondHearingAt = d.secondHearingAt;
        c.secondHearingPlace = d.secondHearingPlace; c.secondServiceDoc = d.secondServiceDoc;
        c.secondJudge = d.secondJudge;
      },
    },
    'exec': {
      title: '编辑执行信息',
      fields: () => [
        // v142：执行立案截图 / 执行文书 都是「上传文件」，不是文字输入；label 去掉「（文件名）」
        { key: 'execFilingShot', label: '执行立案截图', type: 'file', span: 2, value: (c.execFilingShot || c.execShot || '') },
        { key: 'execFormalAt',   label: '执行正式立案日期', type: 'date', value: dateOnly(c.execFormalAt) },
        { key: 'execCaseNo',     label: '执行案号', value: c.execCaseNo || (c.ov && c.ov.execCaseNo) || '' },
        { key: 'execFormalDoc',  label: '执行文书', type: 'file', span: 2, value: c.execFormalDoc || '' },
      ],
      apply: d => {
        c.execFilingShot = d.execFilingShot; c.execFormalAt = d.execFormalAt;
        c.execCaseNo = d.execCaseNo; c.execFormalDoc = d.execFormalDoc;
      },
    },
  };

  const cfg = CFG[card]; if (!cfg) return;
  if (cfg.guard && !cfg.guard()) { toast('暂无可编辑信息', '该案件未关联到对应的公证 / 线索记录', 'info'); return; }
  formModal({
    title: cfg.title, wide: true, submitText: '保存',
    fields: cfg.fields(),
    onSubmit: d => {
      cfg.apply(d);
      c.updated = '刚刚';
      save();
      renderCaseDetail();
      // 保持被编辑的卡片展开（renderCollapsePanels 默认收起）
      const el = document.querySelector(`[data-collapse-key="${card}"]`);
      if (el) {
        el.classList.add('open');
        const ca = el.querySelector('.caret'); if (ca) ca.textContent = '▾';
        const stt = el.querySelector('.status'); if (stt) stt.textContent = '收起';
      }
      toast('已保存', cfg.title.replace(/^编辑/, ''));
    },
  });
}

function deleteCase(id) {
  const c = STATE.cases.find(x => x.id === id); if (!c) return;
  confirmModal({
    title: '删除案件', danger: true, okText: '删除',
    message: `确定删除案件 <b>${esc(c.title)}</b>（${esc(c.id)}）？<br>该案件的全部被告、费用、线索记录将一并删除，不可恢复。`,
    onOk: () => {
      STATE.cases = STATE.cases.filter(x => x.id !== id);
      SELECTED.delete(id);
      save(); renderAll(); showView('cases');
      toast('案件已删除', c.id, 'info');
    },
  });
}

function pushLog(c, title, desc, state = 'done', actor = '陈晓敏') {
  c.log = c.log || [];
  c.log.push({ state, time: stamp(), actor, title, desc });
  // 把之前的 active 标为 done
  c.log.forEach(t => { if (t.state === 'active') t.state = 'done'; });
  const last = c.log[c.log.length - 1];
  last.state = state === 'pending' ? 'pending' : 'active';
}

function advanceStage() {
  const c = curCase(); if (!c) return;
  const st = stageOf(c.status);
  if (!st.next) { toast('已是终态', '案件已结案归档', 'info'); return; }
  const from = c.status;
  c.status = st.next;
  c.updated = '刚刚';
  pushLog(c, `阶段推进：${st.next}`, `${from} → ${st.next}（由 陈晓敏 操作）`);
  save(); renderAll();
  toast(`已推进至「${st.next}」`, `${c.id} · ${c.title.slice(0, 14)}…`);
}

function reopenCase() {
  const c = curCase(); if (!c) return;
  c.status = '强制执行中'; c.updated = '刚刚';
  pushLog(c, '重新开启案件', '已结案 → 执行中');
  save(); renderAll();
  toast('案件已重新开启', '状态回到「执行中」', 'info');
}

/* ---------- 明细：被告 / 费用 / 链接 ---------- */

/* ---------- v151：添加费用 —— 支持一次添加多笔（用户口径），并同步生成费用中心记录 ---------- */
const EXP_FEE_TYPE_OPTIONS = ['诉讼费', '公告费', '披露费', '调查费', '公证费', '样品费', '律师费', '其他'];
function expenseRowHTML(e) {
  const d = e || {};
  return `<div class="exp-add-row" style="display:grid;grid-template-columns:1.15fr 1fr 1fr 34px;gap:8px;align-items:center;margin-bottom:6px;">
      <select class="form-select" data-ef="name">${EXP_FEE_TYPE_OPTIONS.map(o => `<option value="${esc(o)}"${(d.name || '诉讼费') === o ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>
      <input class="form-input" type="number" data-ef="amt" placeholder="金额（元）" value="${d.amt ? esc(d.amt) : ''}">
      <select class="form-select" data-ef="status">${EXP_STATUS.map(s => `<option value="${esc(s)}"${(d.status || '未发起') === s ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select>
      <button type="button" class="btn btn-ghost btn-sm" title="删除这一笔" onclick="this.closest('.exp-add-row').remove()">✕</button>
    </div>`;
}
function addExpenseRow(boxId) {
  const box = document.getElementById(boxId || 'exp-add-rows'); if (!box) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = expenseRowHTML(null);
  box.appendChild(tmp.firstElementChild);
}
function readExpenseRows(boxId) {
  const box = document.getElementById(boxId); if (!box) return [];
  return Array.from(box.querySelectorAll('.exp-add-row')).map(r => {
    const g = k => { const el = r.querySelector('[data-ef="' + k + '"]'); return el ? el.value : ''; };
    return { name: g('name'), amt: numOf(g('amt')), status: g('status') || '未发起' };
  }).filter(r => r.amt > 0);   // 金额为 0 / 空的行不落库（空行是常态，不该生成 0 元费用）
}
function addExpense() {
  const c = curCase(); if (!c) return;
  const boxId = 'exp-add-rows';
  formModal({
    title: '添加费用', wide: true, submitText: '保存',
    fields: [
      { type: 'custom', key: 'rows', span: 2, read: () => readExpenseRows(boxId),
        html: `<div class="form-hint" style="margin-bottom:8px;">可一次添加多笔（点「+ 再添加一笔」）；保存后每一笔都会同步生成「费用中心」记录，状态默认「未发起」。</div>
          <div style="display:grid;grid-template-columns:1.15fr 1fr 1fr 34px;gap:8px;font-size:12px;color:var(--color-ink-muted);margin-bottom:6px;">
            <span>费用类型</span><span>金额（元）</span><span>状态</span><span></span></div>
          <div id="${boxId}">${expenseRowHTML(null)}</div>
          <button type="button" class="btn btn-secondary btn-sm" style="margin-top:8px;" onclick="addExpenseRow('${boxId}')">+ 再添加一笔</button>` },
    ],
    onSubmit: d => {
      const cur = curCase(); if (!cur) return false;
      const rows = Array.isArray(d.rows) ? d.rows : [];
      if (!rows.length) { toast('请填写金额', '金额需大于 0', 'error'); return false; }
      const names = [];
      rows.forEach(r => {
        const f = { id: feeId(), caseId: cur.id, type: r.name, amount: r.amt, dir: feeDirection(r.name),
                    status: feeStatusOfExp(r.status), date: today(), src: 'manual', proof: '' };
        STATE.fees.unshift(f);
        cur.expenses.push({ feeId: f.id, name: r.name, amt: r.amt, status: r.status, proof: '' });
        names.push(r.name + ' ' + money(r.amt));
      });
      cur.updated = '刚刚';
      save(); renderFees(); renderCaseDetail();
      toast('费用已添加', names.join(' · ') + '（已同步费用中心）', 'success');
      return true;
    },
  });
}
function removeExpense(i) {
  const c = curCase(); if (!c || !c.expenses || !c.expenses[i]) return;
  const e = c.expenses[i];
  c.expenses.splice(i, 1);
  // v151：同一条费用在费用中心也要一起消失（统一数据来源，不留半条）
  if (e.feeId) STATE.fees = (STATE.fees || []).filter(x => !x || x.id !== e.feeId);
  save(); renderCaseDetail(); renderFees();
  toast('费用已删除', e.name, 'info');
}
// v82：费用状态为存储字段（见 setExpenseStatus），不随流程派生；表格内可下拉维护，待财务系统接入后由系统写入

function removeLink(i) {
  const c = curCase(); const l = c.links[i];
  c.links.splice(i, 1);
  save(); renderLinks(); toast('链接已删除', l.title.slice(0, 18), 'info');
}

/* ---------- 客户 CRUD ---------- */
function newCustomer() {
  formModal({
    title: '新建客户', wide: true,
    fields: [
      { type: 'section', label: '主体信息' },
      { key: 'name', label: '客户名称', required: true, span: 2 },
      { key: 'credit', label: '统一社会信用代码', span: 2, placeholder: '91330100MA2******X7' },
      { key: 'category', label: '主营类目', placeholder: '如：家居日用 · 保温杯' },
      { key: 'region', label: '区域', type: 'select', value: '华东', options: CUST_REGION_OPTIONS },
      { key: 'settle', label: '结算方式', type: 'select', value: '月结 · 30 天', options: ['月结 · 30 天', '月结 · 60 天', '季结 · 45 天', '单案结清'] },
      { key: 'manager', label: '客户经理', type: 'select', value: '陈晓敏', options: Object.keys(OPERATORS) },
      // v151：客户经理后面补「运营」（用户 2026-09-14 口径）
      { key: 'operator', label: '运营', type: 'select', value: '陈晓敏', options: custOperatorOptions() },
      { key: 'model', label: '合作模式', type: 'select', value: '全风险', options: ['全风险', '半风险', '固定费用'] },
      { key: 'settleFormula', label: '结算条件（公式）', span: 2, value: DEFAULT_CUST_FORMULA,
        placeholder: DEFAULT_CUST_FORMULA, hint: CUST_FORMULA_HINT + '；只决定客户结算金额' },
    ],
    onSubmit: d => {
      const formula = String(d.settleFormula || '').trim();
      if (isNaN(pctFromFormula(formula))) { toast('结算条件公式无法解析', '例：客户结算金额=结案金额*70%', 'error'); return false; }
      const id = 'C-' + today().slice(0, 4) + '-' + String(STATE.customers.length + 1).padStart(3, '0');
      const opStyle = operatorStyle(d.manager);
      STATE.customers.unshift({
        id, name: d.name, credit: d.credit || '—', category: d.category || '—', region: d.region,
        cases: 0, amount: '¥ 0', recovered: '¥ 0', rate: 0, settle: d.settle,
        status: '合作中', statusClass: 'pill-success',         manager: d.manager,
        operator: d.operator || d.manager,   // v151：客户侧新增「运营」字段
        model: d.model, settleFormula: formula,
        opInitial: opStyle.opInitial, opColor: opStyle.opColor, updated: '刚刚',
        ...customerExtras(),
        holders: selfHolder(d),   // 默认以客户自身作为第一个权利主体，可在详情里改 / 加 / 删
      });
      save(); renderAll();
      toast('客户创建成功', `${id} · ${d.name}`);
      openCustomer(id);
    },
  });
}

/* 客户档案卡「编辑」：一张表单改完卡片里的全部字段（含合作协议文件）。
   合作协议文件是「本次选了才覆盖」——点开弹窗又取消，不会动原来的协议。 */
function editCustomerCard() {
  const c = curCustomer(); if (!c) return;
  let picked = null;
  formModal({
    title: '编辑客户档案 · ' + c.name, wide: true, submitText: '保存',
    fields: [
      { key: 'name', label: '客户名称', required: true, value: c.name },
      { key: 'credit', label: '统一社会信用代码', value: c.credit || '', placeholder: '91330100MA2******X7' },
      { key: 'category', label: '主营类目', value: c.category },
      { key: 'region', label: '区域', type: 'select', value: c.region || '华东', options: CUST_REGION_OPTIONS },
      { key: 'manager', label: '客户经理', type: 'select', value: c.manager, options: custManagerOptions() },
      { key: 'operator', label: '运营', type: 'select', value: c.operator || c.manager, options: custOperatorOptions() },
      { key: 'model', label: '合作模式', type: 'select', value: c.model || '全风险', options: ['全风险', '半风险', '固定费用'] },
      { key: 'status', label: '合作状态', type: 'select', value: c.status, options: ['合作中', '暂停', '已终止'] },
      { key: 'coopFrom', label: '合作起始日', type: 'date', value: custCoopFrom(c) },
      { key: 'coopTo', label: '合同到期日', type: 'date', value: custCoopTo(c) },
      { key: 'settleFormula', label: '结算条件（公式）', span: 2, value: custFormula(c),
        placeholder: DEFAULT_CUST_FORMULA, hint: CUST_FORMULA_HINT + '；只决定客户结算金额，与律师结算无关' },
      { key: 'settle', label: '结算方式', type: 'select', value: c.settle, options: CUST_SETTLE_OPTIONS },
      { key: 'invoiceType', label: '开票类型', value: custInvoiceType(c) },
      { key: 'invoiceSubject', label: '开票主体', value: custInvoiceSubject(c) },
      { key: 'taxNo', label: '纳税人识别号', value: custTaxNo(c) },
      { key: 'bank', label: '开户行', value: custBank(c) },
      { key: 'contract', label: '合作协议（文件）', type: 'file', span: 2, value: c.contractName || '',
        hint: '选择文件后正文写入客户档案；详情页点文件名即可预览',
        onPick: (name, text) => { picked = { name: name, text: text || '' }; } },
    ],
    onSubmit: d => {
      const f = String(d.settleFormula || '').trim();
      if (f === '' || isNaN(pctFromFormula(f))) {
        toast('结算条件公式无法解析', '例：客户结算金额=结案金额*70%', 'error');
        return false;
      }
      const oldMgr = c.manager;
      Object.assign(c, {
        name: d.name, credit: d.credit, category: d.category, region: d.region,
        manager: d.manager, operator: d.operator || c.operator || d.manager, model: d.model, status: d.status,
        statusClass: CUST_STATUS_CLASS[d.status] || 'pill-neutral',
        coopFrom: d.coopFrom, coopTo: d.coopTo,
        settleFormula: f, settle: d.settle,
        invoiceType: d.invoiceType, invoiceSubject: d.invoiceSubject,
        taxNo: d.taxNo, bank: d.bank,
        updated: '刚刚',
      });
      if (d.manager !== oldMgr) { const st = operatorStyle(d.manager); c.opInitial = st.opInitial; c.opColor = st.opColor; }
      if (picked) {
        c.contractName = picked.name;
        c.contractText = picked.text.trim() || ('合作协议：' + picked.name + '\n（未能读取文本内容，请手工补充协议正文）');
      }
      save(); renderAll();
      toast('客户档案已更新', c.name);
    },
  });
}


function deleteCustomer(id) {
  const c = STATE.customers.find(x => x.id === id); if (!c) return;
  confirmModal({
    title: '删除客户', danger: true, okText: '删除',
    message: `确定删除客户 <b>${esc(c.name)}</b>？<br>该客户名下的联系人与权利资产将一并删除。`,
    onOk: () => {
      STATE.customers = STATE.customers.filter(x => x.id !== id);
      save(); renderAll(); showView('customers');
      toast('客户已删除', c.name, 'info');
    },
  });
}

function addContact() {
  formModal({
    title: '添加联系人', wide: true,
    fields: [
      { key: 'name', label: '姓名', required: true },
      { key: 'phone', label: '手机', required: true, placeholder: '139****3021' },
      { key: 'mail', label: '邮箱', placeholder: 'name@××.com' },
      { key: 'duty', label: '负责事项', span: 2, placeholder: '如：案件审核 · 诉状盖章 · 二审决策' },
      { key: 'main', label: '是否主要联系人', type: 'select', value: '否', options: ['否', '是'] },
    ],
    onSubmit: d => {
      const c = curCustomer(); if (!c) return;
      const palette = ['#5E6AD2', '#2563EB', '#057A55', '#7C3AED', '#B45309'];
      c.contacts.push({
        name: d.name, phone: d.phone, mail: d.mail || '—',
        duty: d.duty || '—', main: d.main === '是',
        color: palette[c.contacts.length % palette.length],
      });
      save(); renderCustomerDetail();
      toast('联系人已添加', `${d.name}`);
    },
  });
}
function editContact(i) {
  const c = curCustomer(); const p = c.contacts[i];
  formModal({
    title: '编辑联系人', wide: true,
    fields: [
      { key: 'name', label: '姓名', required: true, value: p.name },
      { key: 'phone', label: '手机', required: true, value: p.phone },
      { key: 'mail', label: '邮箱', value: p.mail },
      { key: 'duty', label: '负责事项', span: 2, value: p.duty },
      { key: 'main', label: '是否主要联系人', type: 'select', value: p.main ? '是' : '否', options: ['否', '是'] },
    ],
    onSubmit: v => {
      Object.assign(p, v, { main: v.main === '是' });
      save(); renderCustomerDetail(); toast('联系人已更新', p.name);
    },
  });
}
function removeContact(i) {
  const c = curCustomer(); const p = c.contacts[i];
  c.contacts.splice(i, 1);
  save(); renderCustomerDetail(); toast('联系人已删除', p.name, 'info');
}

function addAsset() {
  formModal({
    title: '登记权利资产', wide: true,
    fields: [
      { key: 'doc', label: '权属文件', type: 'file', span: 2, onPick: fillAssetFormFromDoc,
        hint: '上传权属文件（注册证 / 证书 / 授权书 等）后自动识别并填充下方字段，可再手工调整' },
      { key: 'type', label: '权利类型', type: 'select', value: '商标', options: ASSET_TYPES },
      { key: 'cat', label: '类别', placeholder: '如：第 21 类 · 保温杯 / 实用新型 / 美术作品' },
      // v84：注册号 / 申请号 与 名称 改为非必填（授权书 / 知名度证据等常常没有注册号）
      { key: 'no', label: '注册号 / 申请号', span: 2, placeholder: '如：第 12345678 号' },
      { key: 'name', label: '名称', span: 2, placeholder: '如：×× / 一种防漏杯盖结构' },
      { key: 'owner', label: '权利人', span: 2, value: curCustomer() ? curCustomer().name : '' },
      { key: 'from', label: '注册日期', type: 'date', value: today() },
      { key: 'to', label: '有效期至', type: 'date', value: (new Date().getFullYear() + 10) + today().slice(4) },
    ],
    onSubmit: d => {
      const c = curCustomer(); if (!c) return;
      c.assets = Array.isArray(c.assets) ? c.assets : [];
      c.assets.push({ type: d.type, tcls: assetTcls(d.type), no: d.no, name: d.name, cat: d.cat || '—',
        owner: d.owner, from: d.from, to: d.to, doc: d.doc || '' });
      save(); renderCustomerDetail();
      // v84：注册号 / 名称 非必填 —— 提示优先显示注册号，缺失时回退名称 / 类型，避免出现「商标 · 」这种半截文案
      toast('权利资产已登记', `${d.type} · ${d.no || d.name || '已录入'}`);
    },
  });
}
/* 编辑单行权利资产：弹窗预填该行全部字段（含权属文件）。
   重传权属文件会重新识别并覆盖下方字段（与「登记权利」同款交互，弹窗内有提示）；不动文件则只保存手工改动。 */
function editAsset(i) {
  const c = curCustomer();
  if (!c || !Array.isArray(c.assets) || !c.assets[i]) return;
  const a = c.assets[i];
  formModal({
    title: '编辑权利资产', wide: true, submitText: '保存',
    fields: [
      { key: 'doc', label: '权属文件', type: 'file', span: 2, value: a.doc || '', onPick: fillAssetFormFromDoc,
        hint: '重传权属文件会重新识别并覆盖下方字段；不改文件则只保存下面改动的内容' },
      { key: 'type', label: '权利类型', type: 'select', value: a.type || '商标', options: ASSET_TYPES },
      { key: 'cat', label: '类别', value: (a.cat && a.cat !== '—') ? a.cat : '', placeholder: '如：第 21 类 · 保温杯 / 实用新型 / 美术作品' },
      { key: 'no', label: '注册号 / 申请号', span: 2, value: a.no || '', placeholder: '如：第 12345678 号' },
      { key: 'name', label: '名称', span: 2, value: a.name || '', placeholder: '如：×× / 一种防漏杯盖结构' },
      { key: 'owner', label: '权利人', span: 2, value: a.owner || c.name },
      { key: 'from', label: '注册日期', type: 'date', value: a.from || today() },
      { key: 'to', label: '有效期至', type: 'date', value: a.to || '' },
    ],
    onSubmit: d => {
      const cc = curCustomer(); const t = cc && Array.isArray(cc.assets) && cc.assets[i];
      if (!t) return false;
      Object.assign(t, {
        doc: d.doc || '', type: d.type, tcls: assetTcls(d.type),
        no: d.no, name: d.name, cat: d.cat || '—',
        owner: d.owner, from: d.from, to: d.to,
      });
      save(); renderAssets();
      toast('权利资产已更新', `${d.type} · ${d.no || d.name || '已录入'}`);
    },
  });
}
function removeAsset(i) {
  const c = curCustomer(); const a = c.assets[i];
  c.assets.splice(i, 1);
  save(); renderCustomerDetail(); toast('权利资产已删除', a.no, 'info');
}

/* ---------- 权利资产 · 权属文件：单行上传 / 批量上传（上传后识别文件内容建档） ---------- */
// 单行：上传权属文件 → 识别 → 回填该行 类型/注册号/名称/类别/权利人/日期/状态
function uploadAssetDoc(i) {
  const c = curCustomer(); if (!c || !Array.isArray(c.assets) || !c.assets[i]) return;
  const old = document.getElementById('asset-doc-file'); if (old) old.remove();
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.id = 'asset-doc-file';
  inp.style.display = 'none';
  document.body.appendChild(inp);   // 挂到 body：真实浏览器更稳，也让点击可被副作用观测
  inp.onchange = function () {
    const f = (inp.files || [])[0];
    inp.remove();
    if (!f || !f.name) return;
    const apply = text => {
      const r = assetDocRecognize(f.name, text || '');
      const cc = curCustomer(); const a = cc && cc.assets && cc.assets[i];
      if (!a) return;
      a.doc = f.name; a.type = r.type; a.tcls = assetTcls(r.type);
      a.no = r.no; a.name = r.name; a.cat = r.cat; a.owner = r.owner; a.from = r.from; a.to = r.to;
      save(); renderAssets();
      toast('权属文件已识别',
        r.hits.length ? ('已填充 ' + r.hits.join(' · ')) : '未提取到标准字段，已用示例值填充，请人工核对',
        r.hits.length ? 'success' : 'info');
    };
    if (typeof f.text === 'function') f.text().then(t => apply(t)).catch(() => apply(''));
    else apply('');
  };
  inp.click();
}

// 批量：一次选多个权属文件 → 逐份识别 → 预览 → 确认后批量创建权利资产
let BATCH_ASSET_ROWS = [];
function batchUploadAssets() {
  const c = curCustomer(); if (!c) return;
  BATCH_ASSET_ROWS = [];
  openModal({
    title: '批量上传权属文件', wide: true,
    bodyHTML: `
      <div class="form-hint" style="margin-bottom:10px;">一次可选择多个文件（商标注册证 / 专利证书 / 著作权登记证书 / 授权书 等）。系统识别文件内容后自动填写：类型 · 注册号 / 申请号 · 名称 · 类别 · 权利人 · 注册日期 · 有效期至 · 状态。</div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
        <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('batch-asset-file').click()">选择权属文件</button>
        <span id="batch-asset-hint" style="font-size:12px;color:var(--color-ink-muted);">未选择文件</span>
        <input type="file" id="batch-asset-file" multiple style="display:none" onchange="batchAssetPicked(this)">
        <span style="flex:1;"></span>
        <button type="button" class="btn btn-primary btn-sm" id="batch-asset-commit" onclick="batchAssetCommit()">确认创建</button>
      </div>
      <div id="batch-asset-list"><div class="empty" style="padding:24px;">
        <div class="empty-title">还没有选择文件</div>
        <div class="empty-desc">点击「选择权属文件」多选上传，识别结果会先显示在这里供核对。</div>
      </div></div>`,
    cancelText: '关闭', okText: null,
  });
}
function batchAssetPicked(inp) {
  const files = Array.from((inp && inp.files) || []);
  const hint = document.getElementById('batch-asset-hint');
  if (!files.length) { if (hint) hint.textContent = '未选择文件'; return; }
  BATCH_ASSET_ROWS = [];
  if (hint) hint.textContent = '正在识别 ' + files.length + ' 个文件…';
  let pending = files.length;
  const one = r => {
    BATCH_ASSET_ROWS.push(r);
    if (--pending > 0) return;
    BATCH_ASSET_ROWS.sort((a, b) => String(a.doc).localeCompare(String(b.doc)));
    if (hint) hint.textContent = '已识别 ' + BATCH_ASSET_ROWS.length + ' 份权属文件';
    renderBatchAssetPreview();
    toast('已识别 ' + BATCH_ASSET_ROWS.length + ' 份权属文件', '核对后点「确认创建」写入权利资产台账');
  };
  files.forEach(f => {
    const run = text => { try { one(assetDocRecognize(f.name, text || '')); } catch (e) { one(assetDocRecognize(f.name, '')); } };
    if (f && typeof f.text === 'function') f.text().then(run).catch(() => run(''));
    else run('');
  });
}
function renderBatchAssetPreview() {
  const box = document.getElementById('batch-asset-list'); if (!box) return;
  box.innerHTML = `<div class="table-wrap"><table class="table">
    <thead><tr><th>类型</th><th>权属文件</th><th>注册号 / 申请号</th><th>名称</th><th>类别</th><th>权利人</th><th>注册日期</th><th>有效期至</th><th>状态</th></tr></thead>
    <tbody>${BATCH_ASSET_ROWS.map(r => `<tr>
      <td><span class="tag ${assetTcls(r.type)}">${esc(r.type)}</span></td>
      <td class="mono" style="font-size:12px;">${esc(r.doc)}</td>
      <td class="mono">${esc(r.no)}</td>
      <td style="color:var(--color-ink);font-weight:500;">${esc(r.name)}</td>
      <td>${esc(r.cat)}</td>
      <td>${esc(r.owner)}</td>
      <td class="mono">${esc(r.from)}</td>
      <td class="mono">${esc(r.to)}</td>
      <td><span class="pill ${assetStatusOf(r).cls}">${esc(assetStatusOf(r).text)}</span></td>
    </tr>`).join('')}</tbody></table></div>`;
}
function batchAssetCommit() {
  const c = curCustomer(); if (!c) return;
  if (!BATCH_ASSET_ROWS.length) { toast('请先选择权属文件', '至少识别 1 份文件后才能创建', 'error'); return; }
  c.assets = Array.isArray(c.assets) ? c.assets : [];
  BATCH_ASSET_ROWS.forEach(r => c.assets.push({ type: r.type, tcls: assetTcls(r.type), no: r.no, name: r.name,
    cat: r.cat, owner: r.owner, from: r.from, to: r.to, doc: r.doc }));
  const n = BATCH_ASSET_ROWS.length;
  BATCH_ASSET_ROWS = [];
  save(); renderCustomerDetail(); closeModal();
  toast('已按权属文件创建 ' + n + ' 项权利资产', '识别字段已自动填充，可在表格中核对');
}

/* ---------- 权利主体（一个客户可挂多个） ---------- */
function renderHolders() {
  const c = curCustomer(); if (!c) return;
  if (!Array.isArray(c.holders)) c.holders = selfHolder(c);
  const list = c.holders;
  // v91：权利主体 / 联系人 并入「基本信息」；v152：标题上的「· 共 N 个 · 立案 / 提线索时按客户带出」
  // 小标签已按用户口径删除（#holder-total 节点一并移除），计数不再写回 DOM
  const tb = document.getElementById('holder-tbody');
  if (!tb) return;
  tb.innerHTML = list.map((h, i) => `
    <tr>
      <td style="color:var(--color-ink);font-weight:500;">${esc(h.name)}${i === 0 ? '<span class="tag tag-green" style="margin-left:6px;">默认</span>' : ''}</td>
      <td class="mono">${esc(h.credit)}</td>
      <td style="max-width:280px;">${esc(h.address)}</td>
      <td>${esc(h.legal)}</td>
      <td><span class="tag">${esc(h.duty)}</span></td>
      <td>
        <button class="btn btn-ghost btn-sm" onclick="editHolder(${i})">编辑</button>
        <button class="btn btn-ghost btn-sm btn-icon" onclick="removeHolder(${i})">×</button>
      </td>
    </tr>`).join('') || emptyRow(6, '该客户下还没有权利主体', '点击右上角「+ 新增权利主体」录入，立案 / 提线索时可按客户带出');
}
function addHolder() {
  const c = curCustomer(); if (!c) return;
  formModal({
    title: '新增权利主体', wide: true, submitText: '保存',
    fields: [
      { key: 'name', label: '权利主体', required: true, span: 2, placeholder: '如：杭州××科技有限公司' },
      { key: 'credit', label: '统一社会信用代码', required: true, span: 2, placeholder: '如：91330100MA2******X7' },
      { key: 'address', label: '住所地', required: true, span: 2, placeholder: '如：浙江省 杭州市 滨江区 ××路 88 号 A 座 12 层' },
      { key: 'legal', label: '法定代表人', required: true, placeholder: '如：周立' },
      // v116：职务由下拉改手填（不同公司法定代表人职务各异，预填具体值没有业务依据）
      { key: 'duty', label: '职务', placeholder: '如：董事长' },
    ],
    onSubmit: d => {
      if (!Array.isArray(c.holders)) c.holders = [];
      // v116：手填后职务可能留空 → 归一为「—」（与 selfHolder 口径一致，避免空白 tag）
      c.holders.push({ name: d.name, credit: d.credit, address: d.address, legal: d.legal, duty: d.duty || '—' });
      save(); renderCustomerDetail();
      toast('权利主体已新增', `${d.name} · ${d.legal}`);
    },
  });
}
function editHolder(i) {
  const c = curCustomer(); if (!c) return;
  const h = c.holders[i]; if (!h) return;
  formModal({
    title: '编辑权利主体', wide: true, submitText: '保存',
    fields: [
      { key: 'name', label: '权利主体', required: true, span: 2, value: h.name },
      { key: 'credit', label: '统一社会信用代码', required: true, span: 2, value: h.credit },
      { key: 'address', label: '住所地', required: true, span: 2, value: h.address },
      { key: 'legal', label: '法定代表人', required: true, value: h.legal },
      { key: 'duty', label: '职务', value: h.duty, placeholder: '如：董事长' },
    ],
    onSubmit: d => {
      Object.assign(h, d, { duty: d.duty || '—' });   // v116：清空职务 → 归一为「—」，不落空串
      save(); renderCustomerDetail();
      toast('权利主体已更新', h.name);
    },
  });
}
function removeHolder(i) {
  const c = curCustomer(); if (!c) return;
  const h = c.holders[i]; if (!h) return;
  confirmModal({
    title: '删除权利主体',
    message: `确认删除权利主体「<b>${esc(h.name)}</b>」？该客户的立案 / 提线索将不再能选中它。`,
    okText: '确认删除', danger: true,
    onOk: () => {
      c.holders.splice(i, 1);
      save(); renderCustomerDetail();
      toast('权利主体已删除', h.name, 'info');
    },
  });
}

/* ---------- 选择 / 批量 ---------- */
function toggleSel(id) {
  SELECTED.has(id) ? SELECTED.delete(id) : SELECTED.add(id);
  renderCases();
}
function updateBulk() {
  // 底部批量栏已被移除（勾选多选后直接用筛选栏右上角「批量匹配律师」），全部空守卫
  const bar = $('#bulk-bar');
  const n = SELECTED.size;
  if (bar) bar.classList.toggle('show', n > 0);
  const bn = $('#bulk-n'); if (bn) bn.textContent = n;
  const ba = $('#bulk-actions');
  if (ba) ba.innerHTML = n > 0 ? `
    <button class="btn btn-secondary btn-sm" onclick="bulkExport()">导出所选</button>
    <button class="btn btn-danger btn-sm" onclick="bulkDelete()">删除</button>` : '';
}

/* ---------- 批量匹配律师（多选；必须已补充被告，否则拦截） ---------- */
function bulkMatchLawyer() {
  const ids = [...SELECTED];
  if (!ids.length) { toast('请先勾选案件', '在列表左侧勾选框中多选需要匹配律师的案件', 'info'); return; }
  const targets = STATE.cases.filter(c => ids.includes(c.id) && c.status === '案件待匹配');
  if (!targets.length) { toast('所选案件不在「案件待匹配」阶段', '无法批量匹配律师', 'info'); return; }
  const missing = targets.filter(c => !hasDefendantInfo(c));
  if (missing.length) {
    openModal({
      title: '匹配失败',
      cancelBtn: false, okText: '确定', okClass: 'btn-primary',
      bodyHTML: `<div style="font:400 14px/1.60 var(--font-text);color:var(--color-ink-muted);">
        <div style="font-size:15px;font-weight:600;color:var(--color-ink);margin-bottom:6px;">请先补充被告信息</div>
        <div>以下 <b>${missing.length}</b> 件尚未补充被告：${esc(missing.map(c => c.title).join('、'))}</div>
        <div style="margin-top:8px;">回到列表点击该案件的「补充被告」，完成后再批量匹配律师。</div>
      </div>`,
    });
    return;
  }
  openMatchLawyerForm(targets);
}

// 批量匹配表单：律师信息统一写入所选案件，完成后流转到「待写诉状」
function openMatchLawyerForm(list) {
  const first = list[0];
  openModal({
    title: `批量匹配律师 · ${list.length} 件案件`, wide: true,
    okText: '确认匹配', okClass: 'btn-primary',
    bodyHTML: `
      <div class="lead-detail-section">以下案件的律师信息将被统一写入：${esc(list.map(c => c.title).join('、'))}</div>
      <div class="form-grid">
        <div class="form-field">
          <label class="form-label">匹配日期</label>
          <input class="form-input" type="date" id="bm-at" value="${today()}">
        </div>
        <div class="form-field">
          <label class="form-label">律师姓名<span class="req">*</span></label>
          <div class="lw-picker"><input class="form-input" id="bm-lawyer" data-fk="lawyer" autocomplete="off" placeholder="输入姓名检索律师库，如：李建国" value="${esc(first.lawyer || '')}" oninput="lawyerMenu(this)" onfocus="lawyerMenu(this)"><div class="lw-menu"></div></div>
        </div>
        <div class="form-field">
          <label class="form-label">律师电话</label>
          <input class="form-input" id="bm-phone" data-fk="lawyerPhone" placeholder="选择律师后自动带入" value="${esc(first.lawyerPhone || '')}">
        </div>
        <div class="form-field">
          <label class="form-label">律所名称</label>
          <input class="form-input" id="bm-firm" data-fk="lawyerFirm" placeholder="选择律师后自动带入" value="${esc(first.lawyerFirm || '')}">
        </div>
        <div class="form-field full">
          <label class="form-label">律师地址</label>
          <input class="form-input" id="bm-addr" data-fk="lawyerAddr" placeholder="选择律师后自动带入" value="${esc(first.lawyerAddr || '')}">
        </div>
        <div class="form-field">
          <label class="form-label">律师结算模式</label>
          <select class="form-select" id="bm-settle-mode" data-fk="lawyerSettleMode" onchange="syncLawyerMode()">${LAW_SETTLE_MODES.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('')}</select>
          <div class="form-hint">全风险 / 半风险 / 固定费用</div>
        </div>
        <div class="form-field">
          <label class="form-label">基础费（元）</label>
          <input class="form-input" id="bm-base" data-fk="lawyerBaseFee" type="number" value="0">
          <div class="form-hint">全风险 = 0；半风险 / 固定费用可录入金额</div>
        </div>
        <div class="form-field">
          <label class="form-label">分成比例</label>
          <select class="form-select" id="bm-split" data-fk="lawyerSplit">${PCT_OPTIONS.map(o => `<option value="${esc(o)}"${o === '30%' ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>
          <div class="form-hint">下拉选择 0% – 100%</div>
        </div>
      </div>`,
    onSubmit: () => {
      const lawyer = ((document.getElementById('bm-lawyer') || {}).value || '').trim();
      if (!lawyer) { toast('请填写律师姓名', '', 'error'); return false; }
      const at    = (document.getElementById('bm-at') || {}).value || today();
      const phone = ((document.getElementById('bm-phone') || {}).value || '').trim();
      const firm  = ((document.getElementById('bm-firm') || {}).value || '').trim();
      const addr  = ((document.getElementById('bm-addr') || {}).value || '').trim();
      const mode  = (document.getElementById('bm-settle-mode') || {}).value || '全风险';
      const split = (document.getElementById('bm-split') || {}).value || '30%';
      const base  = mode === '全风险' ? 0 : numOf((document.getElementById('bm-base') || {}).value);
      list.forEach(c => {
        c.matchAt = at; c.lawyer = lawyer; c.lawyerPhone = phone; c.lawyerFirm = firm; c.lawyerAddr = addr;
        c.lawyerSettleMode = mode; c.lawyerSplit = split; c.lawyerBaseFee = base;
        c.status = '待写诉状'; c.stageCls = 'pill-info'; c.updated = '刚刚';
        pushLog(c, '批量匹配律师', `${lawyer}（电话 ${phone || '—'}）`);
        pushCaseTimeline(c, `批量匹配律师 ${lawyer}，案件待匹配 → 待写诉状`);
      });
      const n = list.length;
      SELECTED.clear(); save(); renderAll(); updateNavBadges();
      toast(`已批量匹配 ${n} 件案件`, `律师：${lawyer} · 流转至「待写诉状」`);
      closeModal();
      return true;
    },
  });
}

function bulkExport() {
  exportCSV(STATE.cases.filter(c => SELECTED.has(c.id)));
  toast('已导出所选案件', `${SELECTED.size} 条 CSV`, 'success');
}
function bulkDelete() {
  const n = SELECTED.size;
  confirmModal({
    title: '批量删除', danger: true, okText: `删除 ${n} 个`,
    message: `确定删除选中的 <b>${n}</b> 个案件？此操作不可恢复。`,
    onOk: () => {
      STATE.cases = STATE.cases.filter(c => !SELECTED.has(c.id));
      SELECTED.clear(); save(); renderAll();
      toast(`已删除 ${n} 个案件`, '', 'info');
    },
  });
}

/* ---------- v125：右上「导出」= 所见即所得 ----------
   勾选了行 → 只导所选；否则导当前筛选结果（搜索 / 运营 / 案件类型 / 侧栏流程 / 高级筛选全部生效）；
   两者都没有才导全部。此前无条件导出全部 82 条，用户筛完再点导出会拿到一份跟眼前列表不一样的文件。 */
function hasActiveFilter() {
  return !!String(FILTER.q || '').trim()
    || (Array.isArray(FILTER.statusSet) && FILTER.statusSet.length > 0)
    || (FILTER.status && FILTER.status !== '全部')
    || (FILTER.op && FILTER.op !== '所有运营')
    || (FILTER.type && FILTER.type !== '所有案件类型')
    || advFilterActive();
}
/* 导出范围（纯计算，不落地文件）：scope = selected / filtered / all */
function exportScope() {
  const base = filteredCases();
  if (SELECTED.size) {
    const picked = base.filter(c => SELECTED.has(c.id));
    if (picked.length) return { scope: 'selected', list: picked, note: '已勾选 ' + picked.length + ' 条' };
  }
  const filtered = hasActiveFilter();
  return { scope: filtered ? 'filtered' : 'all', list: base, note: filtered ? '按当前筛选条件' : '全部案件' };
}
function exportCases() {
  const s = exportScope();
  if (!s.list.length) { toast('没有可导出的案件', '当前筛选没有命中任何案件', 'info'); return 0; }
  return exportCSV(s.list, s.note);
}

/* ---------- 导出 CSV ---------- */
function exportCSV(list, note) {
  const rows = list || filteredCases();
  // 与列表 9 列对齐（操作列不适合导出，改用案件单号作主键）
  const head = ['案件单号', '案件进展', '权利人', '平台', '店铺名', '被告', '标的额', '立案法院', '案号'];
  const body = rows.map(c => {
    const d = splitDefendant(c.defendant);
    return [caseNoOf(c), c.status, holderName(c), d.platform, d.shop, defendantNames(c), c.amount, c.court, c.no];
  });
  const csv = '\uFEFF' + [head, ...body].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `案件列表_${today()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('CSV 已导出', `${rows.length} 条记录` + (note ? ' · ' + note : ''));
}

/* ---------- 通用 CSV 下载 ---------- */
function downloadCSV(filename, head, rows) {
  const cell = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const csv = '\uFEFF' + [head, ...rows].map(r => r.map(cell).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = filename;
  a.click();
  if (URL.revokeObjectURL) setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function exportReportsCSV() {
  const byStage = {}, byType = {};
  STATE.cases.forEach(c => {
    byStage[c.status] = (byStage[c.status] || 0) + 1;
    byType[c.type] = (byType[c.type] || 0) + 1;
  });
  const rows = [];
  Object.keys(byStage).forEach(k => rows.push(['阶段分布', k, byStage[k]]));
  Object.keys(byType).forEach(k => rows.push(['类型分布', k, byType[k]]));
  rows.push(['汇总', '案件总数', STATE.cases.length]);
  rows.push(['汇总', '客户总数', STATE.customers.length]);
  rows.push(['汇总', '累计标的额', STATE.cases.reduce((a, c) => a + (c.amount || 0), 0)]);
  rows.push(['汇总', '公证在办', NOTARY_ITEMS.filter(n => n.stage !== '已归档').length]);
  downloadCSV(`案件报表_${today()}.csv`, ['维度', '项目', '数值'], rows);
  toast('报表已导出', `${STATE.cases.length} 个案件 · CSV 已下载`, 'success');
}

/* v150：原 exportEvidenceCSV()（页头「导出清单」= 导出全部证物）已删除 ——
   用户口径：页头那个按钮去掉，导出入口只保留列表上方「导出清单」（导出勾选项）。
   函数留着就是严格孤儿（孤儿扫描会报），故连实现一起清掉。 */

/* 取证表列定义：顶部「导出取证表」与筛选栏「批量导出」共用 */
// v111：取证表里那个「公司+单号」的合并列头已拆成两个独立列（原先一个列头塞两件事，导出后没法按列处理）
const NOTARY_EXPORT_HEAD = ['公证编号', '权利主体', '平台', '店铺名', '店铺ID', '案件进展', '推送日期', '取证日期', '发货人', '发货电话', '发货地址',
  '公证费', '调查费', '样品费', '披露费', '快递公司', '快递单号', '公证处', '公证书编号', '出证日期'];
const notaryExportRows = list => list.map(n =>
  [n.id, n.party || '—', n.platform || '—', n.shop, n.shopId || '—', n.stage, n.push, n.buyAt || '—', n.recvName || '—', n.recvPhone || '—', n.recvAddr || '—', n.feeN, n.investFee || 0, n.feeP, n.feeD,
    (n.logistics && n.logistics.length) ? n.logistics.map(l => l.company || '').join('；') : '',
    (n.logistics && n.logistics.length) ? n.logistics.map(l => l.no || '').join('；') : '',
    n.office, n.docNo, n.docDate]);

// 筛选栏「批量导出」：勾选了行则只导所选，未勾选则导出全部（勾选框 = 导出范围筛选）
function exportNotaryCSV() {
  const picked = NOTARY_ITEMS.filter(n => NOTARY_SELECTED.has(n.id));
  const list = picked.length ? picked : NOTARY_ITEMS;
  downloadCSV(`取证表_${picked.length ? '已勾选' : '全部'}_${today()}.csv`, NOTARY_EXPORT_HEAD, notaryExportRows(list));
  toast('取证表已导出',
    picked.length ? `${list.length} 条已勾选记录 · 可直送公证处`
                  : `${list.length} 条记录 · 未勾选时默认导出全部，可勾选后只导所选`,
    'success');
}

// 客户管理筛选行「导出客户」：导出客户台账 CSV
function exportCustomers() {
  const head = ['客户编号', '客户名称', '统一信用代码', '区域', '主营类目', '在办案件', '累计结算金额', '累计回款', '回款率%', '结算方式', '状态', '客户经理', '运营', '合作模式', '结算条件', '更新日期'];
  const rows = CUSTOMERS.map(c =>
    [c.id, c.name, c.credit || '', c.region || '', c.category || '', c.cases != null ? c.cases : 0, c.amount || '', c.recovered || '', c.rate != null ? c.rate : '', c.settle || '', c.status || '', c.manager || '', c.operator || c.manager || '', c.model || '', custFormula(c), c.updated || '']);
  downloadCSV(`客户台账_${today()}.csv`, head, rows);
  toast('客户台账已导出', `${CUSTOMERS.length} 家客户 · CSV 可直接用 Excel 打开`, 'success');
}

function exportMonthBillsCSV() {
  // v150：原来硬编码 '2026-09' —— 过期后永远导不出当月；改成当前月，并按「发起结算日期」的月份前缀归集
  const m = curMonth();
  const rows = [];
  CUST_BILLS.filter(x => sameMonth(x.m, m)).forEach(x => rows.push(['客户结算', x.cust, x.amt, x.inv, x.rec, x.prog, x.date]));
  LAW_BILLS.filter(x => sameMonth(x.m, m)).forEach(x => rows.push(['律师结算', `${x.lawyer} / ${x.firm}`, x.amt, '', x.prog === '已打款' ? x.amt : 0, x.prog, x.date]));
  if (!rows.length) { toast('本月暂无账单', `${m} 没有可生成的结算单`, 'info'); return; }
  downloadCSV(`${m}_月账单.csv`,
    ['结算类型', '对象', '客户/律师结算金额', '已开票', '已回款/已打款', '进度', '回款/打款日期'], rows);
  toast('月账单已生成', `${m} · 客户 ${CUST_BILLS.filter(x => sameMonth(x.m, m)).length} 家 · 律师 ${LAW_BILLS.filter(x => sameMonth(x.m, m)).length} 位`, 'success');
}

// ============================================================
// 8. 事件绑定
// ============================================================
document.addEventListener('click', e => {
  // Modal
  if (e.target.closest('[data-modal-close]')) {
    // noEscape 弹窗：点击遮罩不关闭（取消按钮仍可用）
    if (MODAL_NO_ESCAPE && e.target.classList && e.target.classList.contains('modal-backdrop')) return;
    closeModal(); return;
  }
  const ok = e.target.closest('#modal-ok');
  if (ok) { if (MODAL_OK) MODAL_OK(); else closeModal(); return; }

  // Tab
  const tab = e.target.closest('.tab');
  if (tab) {
    const root = tab.parentElement;
    $$('.tab', root).forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const pid = tab.dataset.tab;
    $$('.tab-panel').forEach(p => p.classList.remove('active'));
    const p = document.getElementById(pid);
    if (p) p.classList.add('active');
    return;
  }

  // 选择框
  const cb = e.target.closest('[data-sel]');
  if (cb) { e.stopPropagation(); toggleSel(cb.dataset.sel); return; }
  const cb2 = e.target.closest('.checkbox');
  if (cb2 && !cb2.dataset.sel) { cb2.classList.toggle('checked'); e.stopPropagation(); return; }

  // 排序
  const th = e.target.closest('th.sortable');
  if (th) {
    const k = th.dataset.sort;
    if (FILTER.sort.key === k) FILTER.sort.dir *= -1;
    else FILTER.sort = { key: k, dir: 1 };
    renderCases();
    return;
  }

  // 案件阶段（页内阶段条 → 与侧栏子目录联动）
  const cst = e.target.closest('.case-stage-tab');
  if (cst) { gotoCaseStage(cst.dataset.status); return; }

  // 筛选 pill（案件）
  const fp = e.target.closest('#case-filters .filter-pill');
  if (fp) {
    $$('#case-filters .filter-pill').forEach(p => p.classList.remove('active'));
    fp.classList.add('active');
    FILTER.status = fp.dataset.status;
    renderCases();
    return;
  }
  // 筛选 pill（客户）
  const fpc = e.target.closest('#cust-filters .filter-pill');
  if (fpc) {
    $$('#cust-filters .filter-pill').forEach(p => p.classList.remove('active'));
    fpc.classList.add('active');
    CUST_FILTER.status = fpc.dataset.status;
    renderCustomers();
    return;
  }

  // 线索选择
  const lb = e.target.closest('[data-lead]');
  if (lb) { e.stopPropagation(); toggleLead(lb.dataset.lead); return; }

  // 筛选 pill（线索）
  const fpl = e.target.closest('#lead-filters .filter-pill');
  if (fpl) {
    $$('#lead-filters .filter-pill').forEach(p => p.classList.remove('active'));
    fpl.classList.add('active');
    LEAD_FILTER.status = fpl.dataset.status;
    renderLeads();
    return;
  }

  // 筛选 pill（结算-旧，保留兼容）
  const fps = e.target.closest('#settle-filters .filter-pill');
  if (fps) return;

  // 筛选 pill（公证 / 证物 / 公证书 / 结算双板块）
  const groups = [
    ['#notary-filters', 'NOTARY_FILTER', renderNotary],
    ['#ev-filters', 'EV_FILTER', renderEvidence],
    ['#settle-cust-filters', 'CUST_BILL_FILTER', renderSettlementSplit],
    ['#settle-law-filters', 'LAW_BILL_FILTER', renderSettlementSplit],
  ];
  for (const [sel, varName, fn] of groups) {
    const p = e.target.closest(sel + ' .filter-pill');
    if (p) {
      $$(sel + ' .filter-pill').forEach(x => x.classList.remove('active'));
      p.classList.add('active');
      if (varName === 'NOTARY_FILTER') NOTARY_FILTER.status = p.dataset.status;
      if (varName === 'EV_FILTER') EV_FILTER.status = p.dataset.status;
      if (varName === 'CUST_BILL_FILTER') CUST_BILL_FILTER.status = p.dataset.status;
      if (varName === 'LAW_BILL_FILTER') LAW_BILL_FILTER.status = p.dataset.status;
      fn();
      return;
    }
  }
});

// 搜索
document.addEventListener('input', e => {
  if (e.target.id === 'search-input') {
    FILTER.q = e.target.value;
    renderCases();
  }
  if (e.target.id === 'cust-search-input') {
    CUST_FILTER.q = e.target.value;
    renderCustomers();
  }
});

// Inline 编辑保存
document.addEventListener('focusout', e => {
  const el = e.target.closest && e.target.closest('.editable');
  if (!el) return;
  const key = el.dataset.ov;
  if (!key) return;
  const val = el.textContent.trim();
  if (el.closest('#view-detail')) {
    const c = curCase(); if (!c) return;
    c.ov = c.ov || {};
    if (c.ov[key] === val) return;
    c.ov[key] = val;
    save();
    toast('字段已保存', key, 'success');
  }
});

// 键盘
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !MODAL_NO_ESCAPE) closeModal();
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    $('#search-input').focus();
  }
  if (e.key === 'Enter' && $('#modal-root').classList.contains('open')) {
    const b = $('#modal-ok'); if (b) b.click();
  }
});

// 下拉筛选（运营/类型/证物进展）
document.addEventListener('change', e => {
  if (e.target.id === 'case-filter-op' || e.target.id === 'case-filter-type') {
    // 真实过滤：下拉值写入 FILTER 后重渲染列表（此前只弹 toast，列表没变）
    const opEl = document.getElementById('case-filter-op');
    const tyEl = document.getElementById('case-filter-type');
    FILTER.op = opEl ? opEl.value : '所有运营';
    FILTER.type = tyEl ? tyEl.value : '所有案件类型';
    renderCases(); syncCaseFilterBtn();
    const n = filteredCases().length;
    toast('筛选已应用', `${FILTER.op} · ${FILTER.type} · 命中 ${n} 个案件`, n ? 'success' : 'info');
  }
  // v131：证物「案件进展」筛选不再走 change 委托 —— 列头换成倒三角浮层，
  //     勾选/清除直接调 toggleEvStageFilterKey / clearEvStageFilter 并重渲染（见上面的 v131 函数组）
});

// ============================================================
// ============================================================
// 10. 新增模块数据（线索池 / 律师工作台 / 结算中心 / 归档库 / 报表）
// ============================================================
/* ============================================================
   线索库：工作流模型
   流程：待推送 → 线索待审核 → 线索待确认 → 公证阶段
   字段：客户、权利主体、案件类型、运营、案件单号（自动生成 LD-YYYYMMDD-NNN）、
         线索来源（线上/线下）、平台、侵权类型（可多选，顿号「、」分隔）、线索、店铺名、店铺ID、
         线索备注、线索发现日期、商品链接[]、商品名称、销量、单价、评论数、销售额、销售总额（Σ）
   ============================================================ */
const LEAD_STAGES = [
  { key: '待推送',       cls: 'pill-warning',  desc: '运营推送给客户',   role: '运营', action: '推送（自动记录推送日期）' },
  { key: '线索待审核',   cls: 'pill-info',     desc: '客户/运营审核',    role: '客户 / 运营', action: '审核：侵权 / 不侵权（不侵权须填原因）' },
  { key: '线索待确认',   cls: 'pill-blue',     desc: '运营确认是否取证', role: '运营', action: '确认：取证 / 不取证（不取证须归档）' },
  { key: '线索已归档',   cls: 'pill-neutral',  desc: '流程终止',         role: '—',   action: '已归档（含归档日期与原因）' },
];
const LEAD_STAGE_KEYS = LEAD_STAGES.map(s => s.key);
const leadStage = k => LEAD_STAGES.find(s => s.key === k) || LEAD_STAGES[0];

// 平台 → tag 颜色
const PLAT_TAG = {
  '淘宝':'tag-orange', '天猫':'tag-red', '拼多多':'tag-red', '京东':'tag-red',
  '抖音':'tag-purple', '1688':'tag-orange', '小红书':'tag-red', '快手':'tag-purple',
  '微信':'tag-blue', '其他':'tag-neutral',
};
const SOURCE_TAG = { '线上':'tag-blue', '线下':'tag-purple' };

// 销售总额 = Σ销售额（销售额 = 销量 × 单价，没有销量时 = 评论数 × 单价）；返回整数
function leadTotalAmt(links) {
  return (links || []).reduce((a, l) => a + leadLinkSale(l), 0);
}

// 生成案件单号 LD-YYYYMMDD-NNN（NNN = 当日序号递增，避免与已有冲突）
function genLeadId() {
  const d = new Date();
  const ds = d.getFullYear()
    + String(d.getMonth() + 1).padStart(2, '0')
    + String(d.getDate()).padStart(2, '0');
  const prefix = 'LD-' + ds + '-';
  let n = 1;
  for (const l of LEADS) {
    if (typeof l.id === 'string' && l.id.indexOf(prefix) === 0) {
      const k = parseInt(l.id.slice(prefix.length), 10);
      if (Number.isFinite(k) && k >= n) n = k + 1;
    }
  }
  return prefix + String(n).padStart(3, '0');
}

/* ---------- 案件单号（v96）：客户序号(3) + 年月日(8) + 当日该客户序号(3) ----------
   规则：某客户是第 9 位建档的客户，且该客户在 2026-09-02 创建了当天第一条线索 → 00920260902001。
   客户序号 = STATE.customers 中的建档顺序（第 1 位即 001，未建档客户回落 001）；
   当日序号 = 该「客户序号 + 年月日」前缀下已有线索/案件的最大序号 + 1，永远不重号。
   线索创建 / 批量导入 / 创建案件 三处共用本生成器；老种子数据按同一规则惰性补号（见 caseNoOf/leadNoOf）。 */
// 初始化早期（STATE 尚在 TDZ、LEADS 尚未声明）也要能算号，故所有全局读取都包在 try 里
function safeList(fn) { try { const v = fn(); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
function custList() {
  const s = safeList(() => STATE.customers);
  return s.length ? s : (typeof CUSTOMERS !== 'undefined' && Array.isArray(CUSTOMERS) ? CUSTOMERS : []);
}
function stateIsLive() { try { return Array.isArray(STATE.customers) && STATE.customers.length > 0; } catch (e) { return false; } }
function custOrdinalOf(name) {
  const nm = String(name == null ? '' : name).trim();
  const i = custList().findIndex(c => c && String(c.name == null ? '' : c.name).trim() === nm);
  return i >= 0 ? i + 1 : 1;
}
// 从任意字符串里取 8 位年月日：'LD-20260901-002' / '2026-09-01 14:05' / '2026-09-01' 均可
function dateDigitsOf(s) {
  const str = String(s == null ? '' : s);
  const m8 = str.match(/\d{8}/);
  if (m8) return m8[0];
  const m = str.match(/(\d{4})\D?(\d{2})\D?(\d{2})/);
  if (m) return m[1] + m[2] + m[3];
  return today().replace(/-/g, '');
}
function nextCaseNo(clientName, dateStr) {
  const prefix = String(custOrdinalOf(clientName)).padStart(3, '0') + dateDigitsOf(dateStr);
  const seqOf = r => {
    if (!r) return NaN;
    const v = r.caseNo || r.id;
    if (typeof v !== 'string' || v.indexOf(prefix) !== 0) return NaN;
    const k = parseInt(v.slice(prefix.length), 10);
    return Number.isFinite(k) ? k : NaN;
  };
  const pools = safeList(() => LEADS).concat(safeList(() => STATE.cases)).concat(safeList(() => NOTARY_ITEMS));
  const used = pools.map(seqOf).filter(Number.isFinite);
  return prefix + String((used.length ? Math.max(...used) : 0) + 1).padStart(3, '0');
}
/* 案件 / 线索的「案件单号」读取口：已有则用，没有则按规则补号并缓存（幂等，刷新后不变）。
   初始化未完成时只算不写回，避免把出厂种子对象写脏。 */
function caseNoOf(c) {
  if (!c) return '—';
  if (c.caseNo) return c.caseNo;
  const id = String(c.id || '');
  if (/^\d{14}$/.test(id)) return id;          // 新规则主键本身就是案件单号（3+8+3 = 14 位）
  const no = nextCaseNo(c.cust || c.client, id);
  if (stateIsLive()) c.caseNo = no;
  return no;
}
function leadNoOf(l) {
  if (!l) return '—';
  if (l.caseNo) return l.caseNo;
  const no = nextCaseNo(l.client, String(l.id || ''));
  if (stateIsLive()) l.caseNo = no;
  return no;
}
/* 启动时给全部案件/线索补齐案件单号（幂等：已补过的不动） */
function ensureCaseNos() {
  safeList(() => STATE.cases).forEach(c => { if (c) caseNoOf(c); });
  safeList(() => LEADS).forEach(l => { if (l) leadNoOf(l); });
}
// v136：这里原有一个「只有案件 id 时取案件单号」的小工具函数，已删除 ——
//   它唯一的调用点（查看证物弹窗顶部「本案共 N 件证物 · 案件单号 …」提示行）在 v135 按用户要求移除后成为严格孤儿。
//   案件单号统一走 caseNoOf(c) / evCaseNoOf(c)，不要再新增 id → 单号的独立包装。

const LEADS = [
  {
    id: 'LD-20260901-001',
    progress: '线索已归档',
    progressCls: 'pill-neutral',
    pushAt: '', pushBy: '', auditResult: '', auditReason: '', auditAt: '',
    confirmResult: '', confirmAt: '', archiveAt: '', archiveReason: '',
    client: '杭州××科技有限公司',
    party: '杭州××科技有限公司',
    caseType: '民事',
    operator: '陈晓敏',
    source: '线上', sourceCls: 'tag-blue',
    platform: '淘宝',
    reason: '商标权',
    shop: '××优品家居', shopId: '旺旺号 wang××01',
    remark: '店铺经营 3 年以上，店铺评分 4.8，建议优先处理',
    foundAt: '2026-09-01 10:22',
    links: [
      { url: 'https://item.taobao.com/item.htm?id=67890', title: '××同款保温杯 316不锈钢', qty: 1247, price: 89,  cmt: 387 },
      { url: 'https://item.taobao.com/item.htm?id=67891', title: '××品牌便携水杯 礼盒装',  qty: 532,  price: 168, cmt: 156 },
    ],
  },
  {
    id: 'LD-20260901-002',
    progress: '线索待确认',
    progressCls: 'pill-blue',
    pushAt: '', pushBy: '', auditResult: '', auditReason: '', auditAt: '',
    confirmResult: '', confirmAt: '', archiveAt: '', archiveReason: '',
    client: '深圳××文化传播有限公司',
    party: '深圳××文化传播有限公司',
    caseType: '刑事',
    operator: '林伟',
    source: '线上', sourceCls: 'tag-blue',
    platform: '抖音',
    reason: '美术作品著作权、信息网络传播权',
    shop: '潮流女装旗舰店', shopId: '抖店 ID ××0521',
    remark: '直播时间 20:00-23:00',
    foundAt: '2026-09-01 14:05',
    links: [
      { url: 'https://v.douyin.com/xxxx1/', title: '××联名款 直播间展示', qty: 880, price: 199, cmt: 234 },
    ],
  },
  {
    id: 'LD-20260831-003',
    progress: '线索待审核',
    progressCls: 'pill-info',
    pushAt: '', pushBy: '', auditResult: '', auditReason: '', auditAt: '',
    confirmResult: '', confirmAt: '', archiveAt: '', archiveReason: '',
    client: '北京××科技股份有限公司',
    party: '北京××科技股份有限公司',
    caseType: '行政',
    operator: '王敏',
    source: '线下', sourceCls: 'tag-purple',
    platform: '其他',
    reason: '实用新型专利权',
    shop: '深圳华强北电子市场 ××档口', shopId: '档口号 B-217',
    needDisclose: '否',
    remark: '展会 2026-08-29，建议立即取证',
    foundAt: '2026-08-31 09:40',
    links: [
      { url: 'https://example.com/sample-photo-1.jpg', title: '涉嫌侵权样品照片 1', qty: 0, price: 0, cmt: 0 },
      { url: 'https://example.com/sample-photo-2.jpg', title: '涉嫌侵权样品照片 2', qty: 0, price: 0, cmt: 0 },
    ],
  },
  {
    id: 'LD-20260830-004',
    progress: '待推送',
    progressCls: 'pill-warning',
    pushAt: '', pushBy: '', auditResult: '', auditReason: '', auditAt: '',
    confirmResult: '', confirmAt: '', archiveAt: '', archiveReason: '',
    client: '广州××食品有限公司',
    party: '广州××食品有限公司',
    caseType: '调查',
    operator: '陈晓敏',
    source: '线上', sourceCls: 'tag-blue',
    platform: '天猫',
    reason: '不正当竞争、商标权',
    shop: '××食品旗舰店', shopId: '旺旺号 wang××88',
    needDisclose: '是',
    remark: '月饼礼盒季节性强，建议节前 2 周内处理',
    foundAt: '2026-08-30 16:18',
    links: [
      { url: 'https://detail.tmall.com/item.htm?id=9001', title: '××同款月饼礼盒 8 件装', qty: 360, price: 198, cmt: 89 },
    ],
  },
  /* v149：线索库原来只有 4 条（四档各 1 条），列表、筛选、批量推送都不够演示 —— 补到 9 条。 */
  {
    id: 'LD-20260912-005',
    progress: '待推送',
    progressCls: 'pill-warning',
    pushAt: '', pushBy: '', auditResult: '', auditReason: '', auditAt: '',
    confirmResult: '', confirmAt: '', archiveAt: '', archiveReason: '',
    client: '杭州××科技有限公司',
    party: '杭州××科技有限公司',
    caseType: '民事',
    operator: '林伟',
    source: '线上', sourceCls: 'tag-blue',
    platform: '拼多多',
    reason: '商标权',
    shop: '××居家优选', shopId: '店铺ID pdd××3321',
    needDisclose: '是',
    remark: '店铺销量较高，建议优先推送',
    foundAt: '2026-09-12 09:15',
    links: [
      { url: 'https://mobile.yangkeduo.com/goods.html?id=77120', title: '××同款收纳盒 大号', qty: 2043, price: 39, cmt: 512 },
    ],
  },
  {
    id: 'LD-20260911-006',
    progress: '线索待审核',
    progressCls: 'pill-info',
    pushAt: '2026-09-11 16:05', pushBy: '王敏', auditResult: '', auditReason: '', auditAt: '',
    confirmResult: '', confirmAt: '', archiveAt: '', archiveReason: '',
    client: '东莞××电子有限公司',
    party: '东莞××电子有限公司',
    caseType: '民事',
    operator: '王敏',
    source: '线上', sourceCls: 'tag-blue',
    platform: '1688',
    reason: '实用新型专利权',
    shop: '××电子元件厂', shopId: '会员号 1688××77',
    remark: '已推送客户，等待判定',
    foundAt: '2026-09-11 15:32',
    links: [
      { url: 'https://detail.1688.com/offer/6612.html', title: '××同款连接器 10P', qty: 8600, price: 1.2, cmt: 76 },
      { url: 'https://detail.1688.com/offer/6613.html', title: '××同款端子线束', qty: 3200, price: 3.5, cmt: 41 },
    ],
  },
  {
    id: 'LD-20260909-008',
    progress: '线索待审核',
    progressCls: 'pill-info',
    pushAt: '2026-09-09 11:20', pushBy: '林伟', auditResult: '', auditReason: '', auditAt: '',
    confirmResult: '', confirmAt: '', archiveAt: '', archiveReason: '',
    client: '上海××设计工作室',
    party: '上海××设计工作室',
    caseType: '调查',
    operator: '林伟',
    source: '线下', sourceCls: 'tag-purple',
    platform: '其他',
    reason: '外观设计专利权',
    shop: '义乌小商品城 ××档口', shopId: '档口号 C-108',
    remark: '线下档口，需现场取证并公证',
    foundAt: '2026-09-09 10:05',
    links: [
      { url: 'https://example.com/sample-photo-11.jpg', title: '档口陈列样品照片 1', qty: 0, price: 0, cmt: 0 },
      { url: 'https://example.com/sample-photo-12.jpg', title: '档口陈列样品照片 2', qty: 0, price: 0, cmt: 0 },
    ],
  },
  {
    id: 'LD-20260910-007',
    progress: '线索待确认',
    progressCls: 'pill-blue',
    pushAt: '2026-09-10 11:40', pushBy: '陈晓敏', auditResult: '侵权', auditReason: '', auditAt: '2026-09-10 14:20',
    confirmResult: '', confirmAt: '', archiveAt: '', archiveReason: '',
    client: '苏州××服饰集团',
    party: '苏州××服饰集团',
    caseType: '民事',
    operator: '陈晓敏',
    source: '线上', sourceCls: 'tag-blue',
    platform: '抖音',
    reason: '美术作品著作权',
    shop: '潮流女装工厂店', shopId: '抖店 ID ××7788',
    needDisclose: '否',
    remark: '客户已判定侵权，待运营确认是否取证',
    foundAt: '2026-09-10 11:08',
    links: [
      { url: 'https://v.douyin.com/yyyy2/', title: '××原创印花连衣裙', qty: 1560, price: 129, cmt: 302 },
    ],
  },
  {
    id: 'LD-20260905-009',
    progress: '线索已归档',
    progressCls: 'pill-neutral',
    pushAt: '2026-09-05 10:10', pushBy: '王敏', auditResult: '不侵权', auditReason: '经比对，商品标识与权利人商标不构成近似', auditAt: '2026-09-06 09:30',
    confirmResult: '', confirmAt: '', archiveAt: '2026-09-06', archiveReason: '客户判定不侵权，线索终止',
    client: '北京××科技股份有限公司',
    party: '北京××科技股份有限公司',
    caseType: '民事',
    operator: '王敏',
    source: '线上', sourceCls: 'tag-blue',
    platform: '京东',
    reason: '商标权',
    shop: '××数码专营店', shopId: '店铺ID jd××6621',
    remark: '经比对不构成侵权，已归档留档',
    foundAt: '2026-09-05 09:30',
    links: [
      { url: 'https://item.jd.com/10088.html', title: '××同款充电器 65W', qty: 640, price: 79, cmt: 118 },
    ],
  },
];
let LEAD_FILTER = { status: '全部', q: '' };
let LEAD_SELECTED = new Set();

function filteredLeads() {
  const q = (LEAD_FILTER.q || '').trim().toLowerCase();
  return LEADS.filter(l => {
    if (LEAD_FILTER.status !== '全部' && l.progress !== LEAD_FILTER.status) return false;
    if (!q) return true;
    return [l.id, l.shop, l.shopId, l.title || '', l.reason, l.platform].join(' ').toLowerCase().indexOf(q) >= 0;
  });
}

/* ---------- 渲染 ---------- */
function renderLeads() {
  const list = filteredLeads();
  setTxt('#leads-count', list.length);
  renderLeadStageNav();

  // 流程条
  const cur = LEAD_STAGES.findIndex(s => s.key === (LEAD_FILTER.status === '全部' ? '__ALL__' : LEAD_FILTER.status));
  const stageBox = $('#leads-stepper');
  if (stageBox) {
    const activeIdx = (LEAD_FILTER.status === '全部') ? -1 : LEAD_STAGES.findIndex(s => s.key === LEAD_FILTER.status);
    stageBox.innerHTML = LEAD_STAGES.map((s, i) => {
      const cls = i < activeIdx ? 'done' : (i === activeIdx ? 'active' : '');
      return `<div class="step ${cls}"><span class="step-label">${s.key}</span><span class="step-time">${s.role} · ${s.action}</span></div>`;
    }).join('');
  }

  // KPI
  const cnt = s => LEADS.filter(l => l.progress === s).length;
  const totalAmt = LEADS.reduce((a, l) => a + leadTotalAmt(l.links), 0);
  const kpiBox = $('#leads-kpi');
  if (kpiBox) {
    kpiBox.innerHTML =
      statCard('线索总数', LEADS.length + ' <span class="unit">条</span>', '本周新增 ' + LEADS.filter(l => l.foundAt >= '2026-08-31').length + ' 条', 'up') +
      statCard('待推送', cnt('待推送') + ' <span class="unit">条</span>', '需运营处理', 'flat') +
      statCard('线索待审核', cnt('线索待审核') + ' <span class="unit">条</span>', '客户判定是否侵权', 'flat') +
      statCard('线索待确认', cnt('线索待确认') + ' <span class="unit">条</span>', '运营确认是否取证', 'flat') +
      statCard('线索已归档', cnt('线索已归档') + ' <span class="unit">条</span>', '不侵权 / 不取证', 'flat') +
      statCard('销售总额', money0(totalAmt), '累计 ' + LEADS.reduce((a, l) => a + (l.links || []).length, 0) + ' 条链接', 'up');
  }

  // 筛选 pill
  const filterBox = $('#lead-filters');
  if (filterBox) {
    filterBox.innerHTML = ['全部', ...LEAD_STAGE_KEYS]
      .map(k => {
        const n = k === '全部' ? LEADS.length : cnt(k);
        const active = (k === LEAD_FILTER.status) ? ' active' : '';
        return `<button class="filter-pill${active}" onclick="LEAD_FILTER.status='${k}';renderLeads();" data-page-node-id="lead-filter-${k}">${k}<span class="count" data-c="${k}">${n}</span></button>`;
      }).join('');
  }

  // 表体
  const body = $('#leads-tbody');
  if (!body) return;
  body.innerHTML = list.map(l => {
    const total = leadTotalAmt(l.links);
    const plat = PLAT_TAG[l.platform] || 'tag-neutral';
    const checked = LEAD_SELECTED.has(l.id) ? ' checked' : '';
    const links = l.links || [];
    const qty = links.reduce((a, x) => a + (Number(x.qty) || 0), 0);
    const cmt = links.reduce((a, x) => a + (Number(x.cmt) || 0), 0);
    const price = links[0] ? Number(links[0].price) : NaN;
    return `<tr>
      <td><div class="checkbox${checked}" onclick="toggleLead('${l.id}')" data-page-node-id="leads-row-${l.id}-chk"></div></td>
      <td>${leadActionBtns(l)}</td>
      <td><span class="pill ${l.progressCls}">${esc(l.progress)}</span></td>
      <td><span class="tag ${plat}">${esc(l.platform || '—')}</span></td>
      <td><span class="case-name">${esc(l.shop)}</span></td>
      <td class="mono">${esc(l.shopId || '—')}</td>
      <td><button class="btn btn-ghost btn-sm" onclick="viewLeadLinks('${l.id}')" data-page-node-id="leads-row-${l.id}-links" title="查看该店铺的全部商品链接">链接</button></td>
      <td class="num">${qty || '—'}</td>
      <td class="num">${Number.isFinite(price) && price ? '¥ ' + price : '—'}</td>
      <td class="num">${cmt || '—'}</td>
      <td class="num">${money0(total)}</td>
      <td class="mono">${esc(l.foundAt)}</td>
    </tr>`;
  }).join('') || emptyRow(12, '没有匹配的线索', '换个筛选条件试试');
}

// 行操作按钮：按阶段动态展示
function leadActionBtns(l) {
  const detailBtn = `<button class="btn btn-ghost btn-sm" onclick="viewLead('${l.id}')" data-page-node-id="leads-row-${l.id}-detail">详情</button>`;
  if (l.progress === '待推送') {
    return `<button class="btn btn-primary btn-sm" onclick="pushOneLead('${l.id}')" data-page-node-id="leads-row-${l.id}-push">推送</button> ${detailBtn}`;
  }
  if (l.progress === '线索待审核') {
    return `<button class="btn btn-primary btn-sm" onclick="openLeadAudit('${l.id}')" data-page-node-id="leads-row-${l.id}-audit">审核</button> ${detailBtn}`;
  }
  if (l.progress === '线索待确认') {
    return `<button class="btn btn-primary btn-sm" onclick="openLeadConfirm('${l.id}')" data-page-node-id="leads-row-${l.id}-confirm">确认</button> ${detailBtn}`;
  }
  return detailBtn; // 线索已归档
}

function toggleLead(id) {
  LEAD_SELECTED.has(id) ? LEAD_SELECTED.delete(id) : LEAD_SELECTED.add(id);
  renderLeads();
}
function toggleAllLeads(ev) {
  ev.stopPropagation();
  const list = filteredLeads();
  const allSel = list.length > 0 && list.every(l => LEAD_SELECTED.has(l.id));
  if (allSel) list.forEach(l => LEAD_SELECTED.delete(l.id));
  else list.forEach(l => LEAD_SELECTED.add(l.id));
  renderLeads();
}
// 清空选择：只清勾选会被误判成「按钮失灵」——用户常先用搜索框筛出空列表（此时没有勾选可清，点了毫无反应）。
// 故一并重置 搜索关键词 + 阶段筛选 + 勾选，并回写搜索框 + 给 toast 回执。
function clearLeadSelection() {
  const hadSel = LEAD_SELECTED.size;
  const hadQ = (LEAD_FILTER.q || '').trim();
  const hadStatus = LEAD_FILTER.status !== '全部';
  LEAD_SELECTED.clear();
  LEAD_FILTER.q = '';
  LEAD_FILTER.status = '全部';
  const si = $('#lead-search');
  if (si) si.value = '';
  renderLeads();
  const parts = [];
  if (hadQ) parts.push('搜索「' + hadQ + '」已清除');
  if (hadStatus) parts.push('阶段筛选已回到「全部」');
  if (hadSel) parts.push('取消勾选 ' + hadSel + ' 条');
  toast('已清空筛选与选择', parts.length ? parts.join(' · ') : '当前没有筛选条件或勾选项', 'info');
}

/* ---------- 流程推进 ---------- */
function pushOneLead(id) {
  const l = LEADS.find(x => x.id === id); if (!l) return;
  if (l.progress !== '待推送') { toast('该线索已推送', l.progress, 'info'); return; }
  const now = today() + ' ' + new Date().toTimeString().slice(0, 5);
  l.progress = '线索待审核'; l.progressCls = 'pill-info';
  l.pushAt = now;                       // 自动记录推送日期
  l.pushBy = l.operator || '运营';
  renderLeads(); renderLeadStageNav(); updateNavBadges(); save();
  toast('已推送至客户审核', `${l.shop} · 推送日期 ${now}`);
}

// 律师待办 / 结算中心 的演示数据（被渲染模块引用，必须存在）
const LAWYER_TASKS = [
  { case: '杭州××科技 vs 淘宝"××优品"',   id: 'IP-20260315-001', lawyer: '李建国', firm: '广东知恒律所',   col: 0, due: '2026-09-09' },
  { case: '深圳××文化 vs 拼多多"创艺小屋"', id: 'IP-20260402-003', lawyer: '周敏',   firm: '广东广信君达',   col: 0, due: '2026-09-12' },
  { case: '北京××科技 vs 京东"数码优选"',  id: 'IP-20260320-007', lawyer: '吴磊',   firm: '北京盈科',       col: 0, due: '2026-09-15' },
  { case: '广州××食品 vs 天猫"××旗舰店"',  id: 'IP-20260218-002', lawyer: '李建国', firm: '广东知恒律所',   col: 1, due: '2026-09-08' },
  { case: '东莞××电子 vs 1688"电子王国"',  id: 'IP-20260305-005', lawyer: '郑楠',   firm: '广东法制盛邦',   col: 1, due: '2026-09-10' },
  { case: '杭州××科技 vs 拼多多"杯具世家"', id: 'IP-20260508-021', lawyer: '李建国', firm: '广东知恒律所',   col: 2, due: '2026-09-07' },
  { case: '苏州××服饰 vs 抖音"潮流女装"',  id: 'IP-20260418-022', lawyer: '孙倩',   firm: '江苏致邦',       col: 2, due: '2026-09-11' },
  { case: '上海××设计 vs 淘宝"潮流集合"',  id: 'IP-20260110-015', lawyer: '何静',   firm: '上海协力',       col: 2, due: '2026-09-14' },
];
const LAWYER_COLS = [
  { key: 0, label: '律师：待写诉状' },
  { key: 1, label: '运营：诉状待确认' },
  { key: 2, label: '客户：诉状待盖章' },
];

/* v149：预置演示数据里的「案件单号」 —— 用 caseNoOf 现算，与案件详情「发起结算」的
   写入口径完全一致（否则账单详情 / 勾选校验里的案件单号与案件列表对不上）。
   必须声明在 SETTLEMENTS 之前：下面这一份影子副本也要用（见该数组上方注释）。 */
const DEMO_NO = (() => {
  const map = { hz: 'IP-20260315-001', sz: 'IP-20260402-003', dg: 'IP-20260305-005', su: 'IP-20260418-022', sh: 'IP-20260110-015' };
  const out = {};
  Object.keys(map).forEach(k => {
    const c = (STATE.cases || []).find(x => x && x.id === map[k]);
    out[k] = c ? caseNoOf(c) : '';
  });
  return out;
})();
/* ⚠️ 历史遗留：SETTLEMENTS 与上面的 CUST_BILLS 是内容完全相同的两份副本（客户结算台账
   走了两条线：客户管理的「累计结算 / 回款率」读 SETTLEMENTS，结算中心读 CUST_BILLS）。
   补数据时**两边都要改**，否则客户表 KPI 与结算中心会对不上。 */
const SETTLEMENTS = [
  { m: '2026-09-01', cust: '杭州××科技有限公司',     amt: 96000,  inv: 0,      rec: 0,      prog: '待发账单', cls: 'pill-warning', date: '2026-09-30' },
  { m: '2026-08-01', cust: '杭州××科技有限公司',     amt: 125000, inv: 125000, rec: 125000, prog: '已回款',   cls: 'pill-success', date: '2026-09-05' },
  { m: '2026-08-03', cust: '深圳××文化传播有限公司', amt: 82000,  inv: 82000,  rec: 82000,  prog: '已回款',   cls: 'pill-success', date: '2026-09-03' },
  { m: '2026-08-05', cust: '北京××科技股份有限公司', amt: 210000, inv: 210000, rec: 0,      prog: '已开票',   cls: 'pill-info',    date: '2026-10-15' },
  { m: '2026-07-01', cust: '广州××食品有限公司',     amt: 64000,  inv: 64000,  rec: 64000,  prog: '已回款',   cls: 'pill-success', date: '2026-08-06' },
  { m: '2026-07-03', cust: '东莞××电子有限公司',     amt: 58000,  inv: 58000,  rec: 58000,  prog: '已回款',   cls: 'pill-success', date: '2026-08-08' },
  { m: '2026-06-01', cust: '苏州××服饰集团',         amt: 158000, inv: 158000, rec: 158000, prog: '已回款',   cls: 'pill-success', date: '2026-07-05' },
  // v149：原值 '已暂停' 不是日期 —— 未回款本就没有回款日期，置空（进度本来就是「待发账单」）
  { m: '2026-06-03', cust: '上海××设计工作室',       amt: 18000,  inv: 0,      rec: 0,      prog: '待发账单', cls: 'pill-warning', date: '' },
  /* v149：以下 3 条是「有案件单号」的演示结算数据（caseId 非空 = 可勾选入账单）——
     前 2 条已并入演示账单 2026090100001，第 3 条留着演示「勾选 → 发起账单」。
     ⚠️ 与下方 CUST_BILLS 的对应行必须同步（历史遗留的两份副本）。 */
  { m: '2026-08-07', cust: '上海××设计工作室',       amt: 18000,  inv: 0,      rec: 0,      prog: '待发账单', cls: 'pill-warning', date: '2026-09-30', caseId: DEMO_NO.sh, nth: 2, billNo: '2026090100001', src: '一审结案结算' },
  { m: '2026-08-09', cust: '杭州××科技有限公司',     amt: 96000,  inv: 0,      rec: 0,      prog: '待发账单', cls: 'pill-warning', date: '2026-09-30', caseId: DEMO_NO.hz, nth: 1, billNo: '2026090100001', src: '一审结案结算' },
  { m: '2026-09-03', cust: '深圳××文化传播有限公司', amt: 82000,  inv: 0,      rec: 0,      prog: '待发账单', cls: 'pill-warning', date: '2026-09-30', caseId: DEMO_NO.sz, nth: 1, billNo: '', src: '一审结案结算' },
];
let SETTLE_FILTER = { status: '全部' };

function pushLeads() {
  const ids = LEAD_SELECTED.size
    ? [...LEAD_SELECTED]
    : LEADS.filter(l => l.progress === '待推送').map(l => l.id);
  let n = 0;
  const now = today() + ' ' + new Date().toTimeString().slice(0, 5);
  ids.forEach(id => {
    const l = LEADS.find(x => x.id === id);
    if (l && l.progress === '待推送') {
      l.progress = '线索待审核'; l.progressCls = 'pill-info';
      l.pushAt = now; l.pushBy = l.operator || '运营'; n++;
    }
  });
  LEAD_SELECTED.clear();
  renderLeads(); updateNavBadges(); save();
  if (n) toast(`已推送 ${n} 条线索至客户审核`, '等待客户判定是否侵权');
  else toast('没有待推送的线索', '所选线索已推送或已处理', 'info');
}
/* ---------- 线索待审核：角色 客户/运营，结果 侵权/不侵权 ---------- */
function openLeadAudit(id) {
  const l = LEADS.find(x => x.id === id); if (!l) return;
  if (l.progress !== '线索待审核') { toast('该线索不在审核阶段', l.progress, 'info'); return; }
  openModal({
    title: '线索审核 · ' + l.id,
    okText: '提交审核结果',
    bodyHTML: `
      <div class="lead-detail-section">线索信息</div>
      <div class="lead-detail-grid">
        <div><span class="k">店铺名</span><span class="v">${esc(l.shop)}</span></div>
        <div><span class="k">平台</span><span class="v">${esc(l.platform)}</span></div>
        <div><span class="k">线索来源</span><span class="v">${esc(l.source)}</span></div>
        <div><span class="k">侵权类型</span><span class="v">${esc(l.reason)}</span></div>
        <div><span class="k">推送日期</span><span class="v mono">${esc(l.pushAt || '—')}</span></div>
      </div>
      <div class="form-field" style="margin-top:14px;">
        <label class="form-label">审核结果<span class="req">*</span></label>
        <select class="form-select" id="lead-audit-result" onchange="document.getElementById('lead-audit-reason-box').style.display = this.value === '不侵权' ? '' : 'none';">
          <option value="侵权">侵权</option>
          <option value="不侵权">不侵权</option>
        </select>
      </div>
      <div class="form-field" id="lead-audit-reason-box" style="display:none;">
        <label class="form-label">不侵权原因<span class="req">*</span></label>
        <textarea class="form-textarea" id="lead-audit-reason" placeholder="如：已获得授权 / 商品不构成近似 / 权利人主体存疑"></textarea>
      </div>`,
    onSubmit: () => {
      const result = (document.getElementById('lead-audit-result') || {}).value || '侵权';
      const reason = ((document.getElementById('lead-audit-reason') || {}).value || '').trim();
      if (result === '不侵权' && !reason) { toast('请填写不侵权原因', '不侵权必须备注原因', 'error'); return false; }
      submitLeadAudit(id, result, reason);
    },
  });
}

function submitLeadAudit(id, result, reason) {
  const l = LEADS.find(x => x.id === id); if (!l) return;
  const now = today() + ' ' + new Date().toTimeString().slice(0, 5);
  l.auditResult = result; l.auditReason = reason; l.auditAt = now;
  if (result === '侵权') {
    l.progress = '线索待确认'; l.progressCls = 'pill-blue';
    toast('审核完成：侵权', `${l.shop} · 进入线索待确认`);
  } else {
    // 不侵权 → 归档（填归档日期与原因）
    openLeadArchive(id, reason || '客户判定不侵权');
  }
  renderLeads(); renderLeadStageNav(); updateNavBadges(); save();
}

/* ---------- 线索待确认：角色 运营，结果 取证/不取证 ---------- */
function openLeadConfirm(id) {
  const l = LEADS.find(x => x.id === id); if (!l) return;
  if (l.progress !== '线索待确认') { toast('该线索不在确认阶段', l.progress, 'info'); return; }
  openModal({
    title: '线索确认 · ' + l.id,
    okText: '提交确认结果',
    bodyHTML: `
      <div class="lead-detail-section">审核结论</div>
      <div class="lead-detail-grid">
        <div><span class="k">店铺名</span><span class="v">${esc(l.shop)}</span></div>
        <div><span class="k">审核结果</span><span class="v">${esc(l.auditResult || '—')}</span></div>
        <div><span class="k">审核日期</span><span class="v mono">${esc(l.auditAt || '—')}</span></div>
      </div>
      <div class="form-field" style="margin-top:14px;">
        <label class="form-label">确认结果<span class="req">*</span></label>
        <select class="form-select" id="lead-confirm-result" onchange="toggleLeadConfirmFields(this.value)">
          <option value="取证">取证（流转至公证流程）</option>
          <option value="不取证" selected>不取证（归档）</option>
        </select>
      </div>
      <div class="form-field" id="lead-archive-box">
        <label class="form-label">归档原因<span class="req">*</span></label>
        <textarea class="form-textarea" id="lead-archive-reason" placeholder="如：客户判定不侵权 / 运营确认不取证"></textarea>
        <div class="form-hint">选「不取证」时归档原因为必填项；归档日期默认为今天。</div>
      </div>
      <div class="form-field" id="lead-office-box" style="display:none;">
        <label class="form-label">公证处<span class="req">*</span></label>
        <select class="form-select" id="lead-confirm-office">
          <option value="">请选择公证处</option>
          ${NOTARY_OFFICE_OPTIONS.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}
        </select>
        <div class="form-hint">选「取证」时必填：公证处在此录入，随线索带入公证流程。</div>
      </div>`,
    onSubmit: () => {
      const result = (document.getElementById('lead-confirm-result') || {}).value || '取证';
      const archiveReason = ((document.getElementById('lead-archive-reason') || {}).value || '').trim();
      const office = ((document.getElementById('lead-confirm-office') || {}).value || '').trim();
      if (result === '不取证' && !archiveReason) {
        toast('请填写归档原因', '选「不取证」时归档原因为必填项', 'error');
        return false;
      }
      if (result === '取证' && !office) {
        toast('请选择公证处', '选「取证」时必须指定承接取证的公证处', 'error');
        return false;
      }
      submitLeadConfirm(id, result, archiveReason, office);
    },
  });
}

/* 线索确认弹窗：选「不取证」显示归档原因区（默认即显示，避免用户忘记必填）；选「取证」显示公证处下拉 */
function toggleLeadConfirmFields(v) {
  const aBox = document.getElementById('lead-archive-box');
  if (aBox) aBox.style.display = (v === '不取证') ? '' : 'none';
  const oBox = document.getElementById('lead-office-box');
  if (oBox) oBox.style.display = (v === '取证') ? '' : 'none';
}

function submitLeadConfirm(id, result, archiveReason, office) {
  const l = LEADS.find(x => x.id === id); if (!l) return;
  // 一致性校验：不取证须填归档原因、取证须选公证处，都拦截在数据层（防止其他入口绕过）
  if (result === '不取证' && !archiveReason) {
    toast('请填写归档原因', '选「不取证」时归档原因为必填项', 'error');
    return;
  }
  if (result === '取证' && !office) {
    toast('请选择公证处', '选「取证」时必须指定承接取证的公证处', 'error');
    return;
  }
  const now = today() + ' ' + new Date().toTimeString().slice(0, 5);
  l.confirmResult = result; l.confirmAt = now;
  if (result === '取证') {
    // 取证 → 生成公证条目并从线索库流出（已流转至公证阶段）
    toNotaryFromLead(l, office);
    const idx = LEADS.indexOf(l);
    if (idx >= 0) LEADS.splice(idx, 1);
    renderLeads(); renderLeadStageNav(); updateNavBadges(); save();
    toast('线索已转入公证流程', `${l.shop} · ${now}`);
    return;
  }
  // 不取证 → 单弹窗内直接落地归档（不走 openLeadArchive）
  l.archiveAt = today();
  l.archiveReason = archiveReason;
  l.progress = '线索已归档'; l.progressCls = 'pill-neutral';
  renderLeads(); renderLeadStageNav(); updateNavBadges(); save();
  toast('线索已归档', `${l.shop} · ${now}`);
}

/* ---------- 归档：不侵权 / 不取证 → 线索已归档 ---------- */
function openLeadArchive(id, presetReason) {
  const l = LEADS.find(x => x.id === id); if (!l) return;
  openModal({
    title: '线索归档 · ' + l.id,
    okText: '确认归档',
    bodyHTML: `
      <div class="form-field">
        <label class="form-label">归档日期<span class="req">*</span></label>
        <input class="form-input" type="date" id="lead-archive-at" value="${today()}">
      </div>
      <div class="form-field">
        <label class="form-label">归档原因<span class="req">*</span></label>
        <textarea class="form-textarea" id="lead-archive-reason" placeholder="如：客户判定不侵权 / 运营确认不取证">${esc(presetReason || '')}</textarea>
      </div>`,
    onSubmit: () => {
      const at = (document.getElementById('lead-archive-at') || {}).value || today();
      const rs = ((document.getElementById('lead-archive-reason') || {}).value || '').trim();
      if (!rs) { toast('请填写归档原因', '', 'error'); return false; }
      l.archiveAt = at; l.archiveReason = rs;
      l.progress = '线索已归档'; l.progressCls = 'pill-neutral';
      renderLeads(); renderLeadStageNav(); updateNavBadges(); save();
      toast('线索已归档', `${l.shop} · ${at}`);
    },
  });
}

/* ---------- 取证：线索 → 公证流程 ---------- */
function toNotaryFromLead(l, office) {
  const nid = 'N-' + new Date().getFullYear() + '-' + String(NOTARY_ITEMS.length + 1).padStart(3, '0');
  NOTARY_ITEMS.unshift({
    id: nid,
    case: `${l.party} vs ${l.platform}"${l.shop}"`,
    caseId: l.id,
    shop: l.shop,
    stage: '待取证',
    stageCls: 'pill-warning',
    push: today(),
    expressNo: '',
    recv: '—', recvAddr: '—',
    operator: l.operator || '—',
    links: 0, notarial: '—', deadline: '—',
    file: '—', ent: '—',
    photos: 0, ocr: false,
    docNo: '—', docDate: '—', feeN: 0, feeP: 0, feeD: 0,
    disclose: '—', discloseInfo: '—',
    office: office || '—',
    refundAmt: 0, refundFreight: 0,
    archiveAt: '', archiveReason: '',
    fromLead: l.id,
    source: l.source || '线上',
    notes: `由线索 ${l.id} 自动转入 · ${l.reason}`,
  });
  renderNotary(); if (typeof renderNotaryStageNav === 'function') renderNotaryStageNav(); updateNavBadges(); save();
  toast('已流转至公证流程', `线索 ${l.id} → 公证「待取证」（${nid}）`);
  showView('notary');
}

/* ---------- 侧栏二级目录：线索库 ---------- */
function renderLeadStageNav() {
  const box = document.getElementById('leads-subnav');
  if (!box) return;
  const total = LEADS.length;
  const n = k => LEADS.filter(l => l.progress === k).length;
  box.innerHTML =
    `<button class="nav-sub-item${LEAD_FILTER.status === '全部' ? ' active' : ''}" onclick="gotoLeadStage('全部')">全部 <span class="nav-sub-count">${total}</span></button>` +
    LEAD_STAGES.map(s => `<button class="nav-sub-item${LEAD_FILTER.status === s.key ? ' active' : ''}" onclick="gotoLeadStage('${s.key}')">${s.key} <span class="nav-sub-count">${n(s.key)}</span></button>`).join('');
}
function gotoLeadStage(k) {
  LEAD_FILTER.status = k;
  showView('leads');
  renderLeads();
}

/* ---------- 单条创建 ---------- */
function newLead() {
  const html = leadFormHTML();
  openModal({
    title: '新建线索', wide: true,
    okText: '创建线索', okClass: 'btn-primary',
    bodyHTML: html,
    onOk: () => {
      if (!readLeadForm()) return false;  // 校验失败不关闭
      closeModal();                       // v117c：创建成功 → 关窗（MODAL_OK 存在时外层不会自动关）
    },
  });
}
function leadFormHTML() {
  // 商品链接多行（默认 1 行，可加行）
  return `
    <div class="form-grid">
      <div class="form-field">
        <label class="form-label">客户<span class="req">*</span></label>
        <input class="form-input" data-k="client" list="client-options" oninput="syncPartyOptions()" placeholder="如：杭州××科技有限公司">
        <div class="form-err" data-err="client">此项为必填</div>
      </div>
      <div class="form-field">
        <label class="form-label">权利主体<span class="req">*</span></label>
        <input class="form-input" data-k="party" list="party-options" placeholder="按客户带出，也可直接输入">
        <div class="form-err" data-err="party">此项为必填</div>
      </div>
      <div class="form-field">
        <label class="form-label">案件类型<span class="req">*</span></label>
        <select class="form-select" data-k="caseType">
          ${CASE_TYPES.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}
        </select>
      </div>
      <div class="form-field">
        <label class="form-label">运营<span class="req">*</span></label>
        <select class="form-select" data-k="operator">
          ${['陈晓敏', '林伟', '王敏'].map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}
        </select>
      </div>

      <div class="form-field">
        <label class="form-label">线索来源<span class="req">*</span></label>
        <select class="form-select" data-k="source">
          <option value="线上" selected>线上</option>
          <option value="线下">线下</option>
        </select>
      </div>
      <div class="form-field">
        <label class="form-label">平台<span class="req">*</span></label>
        <select class="form-select" data-k="platform">
          ${LEAD_PLATFORMS.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}
        </select>
      </div>
      <div class="form-field">
        <label class="form-label">侵权类型<span class="req">*</span></label>
        ${multiSelectHTML('reason', '', INFRINGE_TYPES, { placeholder: '请选择侵权类型（可多选）' })}
        <div class="form-err" data-err="reason">此项为必填</div>
      </div>
      <div class="form-field">
        <label class="form-label">线索发现日期<span class="req">*</span></label>
        <input class="form-input" type="datetime-local" data-k="foundAt" value="${today()}T10:00">
        <div class="form-err" data-err="foundAt">此项为必填</div>
      </div>

      <div class="form-field">
        <label class="form-label">店铺名<span class="req">*</span></label>
        <input class="form-input" data-k="shop" placeholder="如：××优品家居">
        <div class="form-err" data-err="shop">此项为必填</div>
      </div>
      <div class="form-field">
        <label class="form-label">店铺ID</label>
        <input class="form-input" data-k="shopId" placeholder="如：wang××01">
      </div>
      <div class="form-field">
        <label class="form-label">是否需要披露<span class="req">*</span></label>
        <select class="form-select" data-k="needDisclose">
          <option value="" selected>请选择</option>
          <option value="是">是</option>
          <option value="否">否</option>
        </select>
        <div class="form-err" data-err="needDisclose">此项为必填</div>
      </div>
      <div class="form-field full">
        <label class="form-label">线索备注</label>
        <textarea class="form-textarea" data-k="remark" placeholder="如：店铺经营 3 年以上，店铺评分 4.8，建议优先处理"></textarea>
      </div>

      <div class="form-section-title">商品链接（可多条，销售额 = 销量×单价，没有销量时按 评论数×单价）</div>
    </div>

    <datalist id="client-options">${STATE.customers.map(c => `<option value="${esc(c.name)}"></option>`).join('')}</datalist>
    <datalist id="party-options"></datalist>

    <div id="lead-links-box" style="margin-top:8px;"></div>
    <button type="button" class="btn btn-secondary btn-sm" onclick="addLeadLinkRow()" style="margin-top:8px;">+ 添加一条链接</button>
  `;
}
// 模态打开后立刻初始化链接编辑区（默认 1 行）
window.addLeadLinkRow = function(prefill) {
  const box = document.getElementById('lead-links-box');
  if (!box) return;
  const row = document.createElement('div');
  row.className = 'lead-link-row';
  const p = prefill || {};
  row.innerHTML = `
    <div class="lead-link-grid">
      <input class="form-input" data-lk="url"   placeholder="商品链接" value="${esc(p.url || '')}">
      <input class="form-input" data-lk="title" placeholder="商品名称" value="${esc(p.title || '')}">
      <input class="form-input" data-lk="qty"   type="number" placeholder="销量" value="${p.qty || ''}" oninput="leadLinkRecalc(this)">
      <input class="form-input" data-lk="price" type="number" placeholder="单价" value="${p.price || ''}" oninput="leadLinkRecalc(this)">
      <input class="form-input" data-lk="cmt"   type="number" placeholder="评论数" value="${p.cmt || ''}" oninput="leadLinkRecalc(this)">
      <input class="form-input" data-lk="sale"  placeholder="销售额" value="${p.sale ? Number(p.sale).toLocaleString('zh-CN') : ''}"
        readonly title="自动计算：销量 × 单价（没有销量时用 评论数 × 单价）">
      <button type="button" class="btn btn-ghost btn-sm" onclick="this.closest('.lead-link-row').remove()">删除</button>
    </div>
  `;
  box.appendChild(row);
  // 预填时（如复制已有线索）先算一次，保证销售额不是空的
  const firstInput = row.querySelector('[data-lk="qty"]');
  if (firstInput) leadLinkRecalc(firstInput);
};
// 销售额 = 销量 × 单价；没有销量时用 评论数 × 单价（点赞/评论量大的链接用它估算）
function leadLinkSale(l) {
  const qty = Number((l && l.qty) || 0), price = Number((l && l.price) || 0), cmt = Number((l && l.cmt) || 0);
  return (qty > 0 ? qty : cmt) * price;
}
// 行内任一数字变化 → 重算该行「销售额」（只读框，随时与销量/单价/评论数保持一致）
window.leadLinkRecalc = function(el) {
  const row = el && el.closest ? el.closest('.lead-link-row') : null;
  if (!row) return;
  const val = k => { const i = row.querySelector('[data-lk="' + k + '"]'); return i ? Number(i.value) || 0 : 0; };
  const sale = leadLinkSale({ qty: val('qty'), price: val('price'), cmt: val('cmt') });
  const out = row.querySelector('[data-lk="sale"]');
  if (out) out.value = sale ? sale.toLocaleString('zh-CN') : '';
};
// 模态打开后给"创建线索"按钮挂初始化：监听 openModal
const _origOpenModal = openModal;
window.openModal = function(opts) {
  _origOpenModal(opts);
  if (opts && opts.title === '新建线索') {
    setTimeout(() => {
      const box = document.getElementById('lead-links-box');
      if (box && !box.children.length) addLeadLinkRow();
      syncPartyOptions();
    }, 0);
  }
};
/* 权利主体候选 = 当前输入客户名下的权利主体（客户 → 权利主体 一对多） */
function syncPartyOptions() {
  const clientEl = document.querySelector('#modal-body [data-k="client"]');
  const dl = document.getElementById('party-options');
  if (!clientEl || !dl) return;
  const c = (STATE.customers || []).find(x => x.name === clientEl.value.trim());
  const list = (c && Array.isArray(c.holders)) ? c.holders : [];
  dl.innerHTML = list.map(h => `<option value="${esc(h.name)}"></option>`).join('');
}
function readLeadForm() {
  const get = k => { const el = document.querySelector('#modal-body [data-k="' + k + '"]'); return el ? el.value.trim() : ''; };
  const required = ['client','party','caseType','operator','source','platform','reason','foundAt','shop','needDisclose'];
  const bad = [];
  required.forEach(k => { const v = get(k); if (!v) bad.push(k); });
  // 高亮错误
  document.querySelectorAll('#modal-body .form-err').forEach(e => e.classList.remove('show'));
  document.querySelectorAll('#modal-body .form-input.err, #modal-body .form-select.err, #modal-body .form-textarea.err').forEach(e => e.classList.remove('err'));
  if (bad.length) {
    bad.forEach(k => {
      const el = document.querySelector('#modal-body [data-k="' + k + '"]'); if (el) el.classList.add('err');
      const errEl = document.querySelector('#modal-body [data-err="' + k + '"]'); if (errEl) errEl.classList.add('show');
    });
    toast('请填写必填项', bad[0], 'error');
    return false;
  }
  // 收集商品链接
  const linkRows = Array.from(document.querySelectorAll('#lead-links-box .lead-link-row'));
  const links = linkRows.map(r => {
    const g = k => { const el = r.querySelector('[data-lk="' + k + '"]'); return el ? el.value.trim() : ''; };
    const row = { url: g('url'), title: g('title'), qty: numOf(g('qty')), price: numOf(g('price')), cmt: numOf(g('cmt')) };
    return Object.assign(row, { sale: leadLinkSale(row) });
  }).filter(l => l.url || l.title);
  if (!links.length) { toast('请至少添加一条商品链接', '否则销售总额无法计算', 'error'); return false; }

  const l = {
    id: genLeadId(),
    caseNo: nextCaseNo(get('client')),   // v96：案件单号随线索创建自动生成
    progress: '待推送',
    progressCls: 'pill-warning',
    pushAt: '', pushBy: '', auditResult: '', auditReason: '', auditAt: '',
    confirmResult: '', confirmAt: '', archiveAt: '', archiveReason: '',
    client: get('client'),
    party: get('party'),
    caseType: get('caseType'),
    operator: get('operator'),
    source: get('source'), sourceCls: SOURCE_TAG[get('source')] || 'tag-neutral',
    platform: get('platform'),
    reason: get('reason'),
    shop: get('shop'),
    shopId: get('shopId') || '—',
    needDisclose: get('needDisclose'),
    remark: get('remark'),
    foundAt: get('foundAt'),
    links: links,
  };
  LEADS.unshift(l);
  renderLeads(); updateNavBadges(); save();
  toast('线索已创建', `${l.id} · ${l.shop}`);
  return true;
}

/* ---------- 详情 ---------- */
function viewLead(id) {
  const l = LEADS.find(x => x.id === id); if (!l) return;
  const leadLinks = Array.isArray(l.links) ? l.links : [];
  const total = leadTotalAmt(leadLinks);
  const plat = PLAT_TAG[l.platform] || 'tag-neutral';
  const linksHTML = leadLinks.map((p, i) => `
    <tr>
      <td class="num">${i + 1}</td>
      <td><a href="${esc(p.url)}" target="_blank" rel="noopener" class="link-mono">${esc((p.url || '').length > 56 ? (p.url.slice(0, 53) + '…') : p.url)}</a></td>
      <td>${esc(p.title || '—')}</td>
      <td class="num">${(p.qty || 0).toLocaleString()}</td>
      <td class="num">¥ ${(p.price || 0).toLocaleString()}</td>
      <td class="num">${(p.cmt || 0).toLocaleString()}</td>
      <td class="num">${money0(leadLinkSale(p))}</td>
    </tr>`).join('');
  const body = `
    <div class="lead-detail-head">
      <div class="lead-detail-id-wrap">
        <span class="lead-detail-id-label">案件单号</span>
        <div class="lead-detail-id">${esc(leadNoOf(l))}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <button class="btn btn-secondary btn-sm" onclick="editLeadInfo('${esc(l.id)}')" title="编辑线索卡内的字段">编辑</button>
        <span class="pill ${l.progressCls}">${esc(l.progress)}</span>
      </div>
    </div>
    <div class="lead-detail-grid">
      <div><span class="k">客户</span><span class="v">${esc(l.client)}</span></div>
      <div><span class="k">权利主体</span><span class="v">${esc(l.party)}</span></div>
      <div><span class="k">案件类型</span><span class="v">${esc(l.caseType)}</span></div>
      <div><span class="k">运营</span><span class="v">${esc(l.operator)}</span></div>
      <div><span class="k">线索来源</span><span class="v"><span class="tag ${l.sourceCls}">${esc(l.source)}</span></span></div>
      <div><span class="k">平台</span><span class="v"><span class="tag ${plat}">${esc(l.platform)}</span></span></div>
      <div><span class="k">侵权类型</span><span class="v">${esc(l.reason)}</span></div>
      <div><span class="k">线索发现日期</span><span class="v mono">${esc(l.foundAt)}</span></div>
      <div><span class="k">店铺名</span><span class="v">${esc(l.shop)}</span></div>
      <div><span class="k">店铺ID</span><span class="v mono">${esc(l.shopId)}</span></div>
      <div><span class="k">是否需要披露</span><span class="v">${esc(l.needDisclose || '—')}</span></div>
      <div><span class="k">推送日期</span><span class="v mono">${esc(l.pushAt || '—')}</span></div>
      <div><span class="k">审核结果</span><span class="v">${esc(l.auditResult || '—')}</span></div>
      <div><span class="k">审核日期</span><span class="v mono">${esc(l.auditAt || '—')}</span></div>
      <div><span class="k">确认结果</span><span class="v">${esc(l.confirmResult || '—')}</span></div>
      <div><span class="k">确认日期</span><span class="v mono">${esc(l.confirmAt || '—')}</span></div>
      <div><span class="k">归档日期</span><span class="v mono">${esc(l.archiveAt || '—')}</span></div>
      <div><span class="k">归档原因</span><span class="v">${esc(l.archiveReason || '—')}</span></div>
      <div class="full"><span class="k">不侵权原因</span><span class="v">${esc(l.auditReason || '—')}</span></div>
      <div class="full"><span class="k">线索备注</span><span class="v">${esc(l.remark || '—')}</span></div>
    </div>

    <div class="lead-detail-section lead-detail-section-row">
      <span>商品链接（${leadLinks.length}）· 销售总额 <b>${money0(total)}</b></span>
      <button class="btn btn-secondary btn-sm" onclick="editLeadLinks('${esc(l.id)}')" title="编辑商品链接的字段数据">编辑</button>
    </div>
    <table class="data-table compact">
      <thead><tr><th class="num">#</th><th>链接</th><th>商品名称</th><th class="num">销量</th><th class="num">单价</th><th class="num">评论数</th><th class="num">销售额</th></tr></thead>
      <tbody>${linksHTML}</tbody>
    </table>
  `;
  openModal({
    title: '线索详情', wide: true, okText: '关闭', cancelText: '',
    bodyHTML: body,
    onOk: () => { closeModal(); },
  });
}

/* 线索库列表「商品链接」列：弹窗列出该店铺全部商品链接，点链接在新标签页打开。
   v106：与线索详情「商品链接」区块同口径（同一份数据、同样 7 列）。 */
window.viewLeadLinks = function(id) {
  const l = LEADS.find(x => x.id === id);
  if (!l) return;
  const links = Array.isArray(l.links) ? l.links : [];
  const rows = links.map((p, i) => `
    <tr>
      <td class="num">${i + 1}</td>
      <td><a href="${esc(p.url)}" target="_blank" rel="noopener" class="link-mono">${esc((p.url || '').length > 56 ? (p.url.slice(0, 53) + '…') : p.url)}</a></td>
      <td>${esc(p.title || '—')}</td>
      <td class="num">${(p.qty || 0).toLocaleString()}</td>
      <td class="num">¥ ${(p.price || 0).toLocaleString()}</td>
      <td class="num">${(p.cmt || 0).toLocaleString()}</td>
      <td class="num">${money0(leadLinkSale(p))}</td>
    </tr>`).join('');
  const bodyHTML = links.length
    ? `<div class="lead-detail-section lead-detail-section-row" style="margin-top:0;">
         <span>${esc(l.shop || '')} · 共 ${links.length} 条链接 · 销售总额 <b>${money0(leadTotalAmt(links))}</b></span>
       </div>
       <table class="data-table compact">
         <thead><tr><th class="num">#</th><th>链接</th><th>商品名称</th><th class="num">销量</th><th class="num">单价</th><th class="num">评论数</th><th class="num">销售额</th></tr></thead>
         <tbody>${rows}</tbody>
       </table>
       <div class="form-hint" style="margin-top:8px;">点击「链接」在新标签页打开对应商品页</div>`
    : '<div class="form-hint">该店铺暂无商品链接</div>';
  openModal({
    title: '商品链接 · ' + (l.shop || l.id), wide: true, okText: '关闭', cancelText: '',
    bodyHTML: bodyHTML,
    onOk: () => { closeModal(); },
  });
};

/* 商品链接「编辑」：线索详情 / 案件详情（线索信息面板）共用。
   可增删改每条链接的 链接 / 商品名称 / 销量 / 单价 / 评论数，销售额随输入自动重算。
   from='lead' → 保存后重开线索详情；from='case' → 保存后重渲染案件详情的线索信息面板。 */
window.editLeadLinks = function(id, from) {
  const l = LEADS.find(x => x.id === id);
  if (!l) return;
  const list = Array.isArray(l.links) ? l.links : [];
  openModal({
    title: '编辑商品链接 · ' + l.id,
    wide: true, okText: '保存修改', cancelText: '取消',
    bodyHTML: `
      <div class="form-hint" style="margin-bottom:8px;">销售额自动计算：有销量时 = 销量 × 单价；没有销量时 = 评论数 × 单价</div>
      <div id="lead-links-box"></div>
      <button type="button" class="btn btn-secondary btn-sm" onclick="addLeadLinkRow()" style="margin-top:8px;">+ 添加一条链接</button>
    `,
    onOk: () => {
      const box = document.getElementById('lead-links-box');
      if (!box) return;
      const rows = Array.from(box.querySelectorAll('.lead-link-row'));
      const links = rows.map(r => {
        const g = k => { const el = r.querySelector('[data-lk="' + k + '"]'); return el ? el.value.trim() : ''; };
        const row = { url: g('url'), title: g('title'), qty: numOf(g('qty')), price: numOf(g('price')), cmt: numOf(g('cmt')) };
        return Object.assign(row, { sale: leadLinkSale(row) });
      }).filter(x => x.url || x.title);
      if (!links.length) { toast('请至少保留一条商品链接', '销售总额按链接的销量/评论数计算', 'error'); return; }
      l.links = links;
      save(); renderLeads();
      toast('商品链接已更新', `${l.id} · ${links.length} 条 · 销售总额 ${money0(leadTotalAmt(links))}`);
      closeModal();
      if (from === 'case') {
        // 案件详情：只重渲染「线索信息」面板，保留其它折叠面板的展开状态
        const c = (typeof curCase === 'function') ? curCase() : null;
        const body = document.getElementById('collapse-body-lead-info');
        if (c && body) body.innerHTML = renderLeadInfoPanel(c);
      } else {
        // 表单关闭后再重开详情，避免被 closeModal 一起关掉
        setTimeout(() => viewLead(id), 0);
      }
    },
  });
  // 弹窗挂载完成后回填现有链接行（每条一行；原数据为空则给一行空行）
  const box = document.getElementById('lead-links-box');
  if (box) {
    (list.length ? list : [{}]).forEach(p => addLeadLinkRow(p));
  }
};

/* 线索详情「编辑」：只改卡片内的基础字段（客户 / 权利主体 / 分类 / 店铺 / 发现日期 …）。
   推送日期、审核结果、确认结果、归档日期等由流程写入，不放进编辑表单。 */
function editLeadInfo(id) {
  const l = LEADS.find(x => x.id === id); if (!l) return;
  const operators = [...new Set(['陈晓敏', '林伟', '王敏', l.operator].filter(Boolean))];
  const platforms = [...new Set(LEAD_PLATFORMS.concat([l.platform]).filter(Boolean))];
  formModal({
    title: '编辑线索 · ' + l.id, wide: true, submitText: '保存修改',
    fields: [
      { key: 'client', label: '客户', required: true, value: l.client, placeholder: '如：杭州××科技有限公司' },
      { key: 'party', label: '权利主体', required: true, value: l.party, placeholder: '按客户带出，也可直接输入' },
      { key: 'caseType', label: '案件类型', type: 'select', options: CASE_TYPES, value: l.caseType },
      { key: 'operator', label: '运营', type: 'select', options: operators, value: l.operator },
      { key: 'source', label: '线索来源', type: 'select', options: ['线上', '线下'], value: l.source },
      { key: 'platform', label: '平台', type: 'select', options: platforms, value: l.platform },
      { key: 'reason', label: '侵权类型', required: true, type: 'multi', value: normalizeInfringe(l.reason),
        options: INFRINGE_TYPES, placeholder: '请选择侵权类型（可多选）' },
      { key: 'foundAt', label: '线索发现日期', type: 'datetime-local', required: true,
        value: String(l.foundAt || '').replace(' ', 'T') },
      { key: 'shop', label: '店铺名', required: true, value: l.shop, placeholder: '如：××优品家居' },
      { key: 'shopId', label: '店铺ID', value: l.shopId === '—' ? '' : (l.shopId || ''), placeholder: '如：wang××01' },
      { key: 'needDisclose', label: '是否需要披露', type: 'select', options: ['是', '否'],
        value: l.needDisclose === '是' ? '是' : '否' },
      { key: 'remark', label: '线索备注', type: 'textarea', span: 2, value: l.remark || '',
        placeholder: '如：店铺经营 3 年以上，店铺评分 4.8，建议优先处理' },
    ],
    onSubmit: d => {
      const lead = LEADS.find(x => x.id === id); if (!lead) return false;
      lead.client = d.client;
      lead.party = d.party;
      lead.caseType = d.caseType;
      lead.operator = d.operator;
      lead.source = d.source;
      lead.sourceCls = SOURCE_TAG[d.source] || 'tag-neutral';
      lead.platform = d.platform;
      lead.reason = d.reason;
      lead.shop = d.shop;
      lead.shopId = d.shopId || '—';
      lead.needDisclose = d.needDisclose;
      lead.remark = d.remark;
      lead.foundAt = String(d.foundAt || '').replace('T', ' ');
      save(); renderLeads();
      toast('线索信息已更新', `${lead.id} · ${lead.shop}`);
      // 表单关闭后再重开详情，避免被 closeModal 一起关掉
      setTimeout(() => viewLead(id), 0);
    },
  });
}

/* ---------- 批量导入 ---------- */
// CSV 模板（首行为表头）：客户,权利主体,案件类型,运营,线索来源,平台,
// 侵权类型（可多选，多个值用顿号「、」分隔）,线索发现日期,店铺名,店铺ID,是否需要披露,线索备注,商品链接,商品名称,销量,单价,评论数
const LEAD_CSV_HEADER = ['客户','权利主体','案件类型','运营','线索来源','平台','侵权类型','线索发现日期','店铺名','店铺ID','是否需要披露','线索备注','商品链接','商品名称','销量','单价','评论数'];
function leadCSVTemplate() {
  const sample = [
    '杭州××科技有限公司,杭州××科技有限公司,民事,陈晓敏,线上,淘宝,商标权、美术作品著作权,2026-09-08 10:00,××优品家居,wang××01,是,店铺评分 4.8,https://item.taobao.com/item.htm?id=1,××同款保温杯,1247,89,387',
  ].join('\n');
  return LEAD_CSV_HEADER.join(',') + '\n' + sample + '\n';
}
function downloadLeadTemplate() {
  const csv = leadCSVTemplate();
  // 加 BOM 让 Excel 识别 UTF-8
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '线索库_批量导入模板.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('模板已下载', '按格式填写后上传');
}

function importLeads() {
  const html = `
    <div style="margin-bottom:14px; display:flex; gap:10px; align-items:center;">
      <button type="button" class="btn btn-secondary btn-sm" onclick="downloadLeadTemplate()">下载 CSV 模板</button>
      <span class="text-muted" style="font-size:12px;">首行为表头，每行一条线索；商品链接/商品名称/销量/单价/评论数为商品字段，可只填商品链接 + 商品名称</span>
    </div>
    <div id="lead-import-zone" class="import-zone">
      <input type="file" id="lead-file" accept=".csv,text/csv" style="display:none;" onchange="parseLeadCSV(event)">
      <button type="button" class="btn btn-primary" onclick="document.getElementById('lead-file').click()">选择 CSV 文件</button>
      <div id="lead-import-msg" class="text-muted" style="margin-top:10px; font-size:12px;">未选择文件</div>
    </div>
    <div id="lead-import-preview"></div>
  `;
  openModal({
    title: '批量导入线索', wide: true, okText: '确认导入', cancelText: '取消',
    bodyHTML: html,
    onOk: () => {
      const rows = window.__LEAD_IMPORT_ROWS;
      if (!rows || !rows.length) { toast('请先选择并解析 CSV', '没有可导入的行', 'error'); return false; }
      // 创建 N 条线索（unshift 顺序按行号）
      rows.forEach(r => {
        const l = {
          id: genLeadId(),
          caseNo: nextCaseNo(r['客户'] || '—'),   // v96：导入的线索同样自动生成案件单号
          progress: '待推送', progressCls: 'pill-warning',
          pushAt: '', pushBy: '', auditResult: '', auditReason: '', auditAt: '',
          confirmResult: '', confirmAt: '', archiveAt: '', archiveReason: '',
          client: r['客户'] || '—',
          party: r['权利主体'] || r['客户'] || '—',
          caseType: r['案件类型'] || '民事',
          operator: r['运营'] || '陈晓敏',
          source: r['线索来源'] || '线上', sourceCls: SOURCE_TAG[r['线索来源']] || 'tag-blue',
          platform: r['平台'] || '其他',
          reason: r['侵权类型'] || '—',
          shop: r['店铺名'] || '—',
          shopId: r['店铺ID'] || '—',
          needDisclose: (r['是否需要披露'] === '是' || r['是否需要披露'] === '否') ? r['是否需要披露'] : '',
          remark: r['线索备注'] || '',
          foundAt: r['线索发现日期'] || today() + ' 10:00',
          links: [{
            url: r['商品链接'] || '',
            title: r['商品名称'] || '',
            qty: numOf(r['销量']),
            price: numOf(r['单价']),
            cmt: numOf(r['评论数']),
          }],
        };
        LEADS.unshift(l);
      });
      window.__LEAD_IMPORT_ROWS = null;
      renderLeads(); updateNavBadges(); save();
      closeModal();   // v117c：导入成功 → 关窗（同上，成功分支此前漏了）
      toast(`已导入 ${rows.length} 条线索`, '进入待推送队列');
      return true;
    },
  });
}
// 简易 CSV 解析（支持引号转义）
function parseCSVLine(line) {
  const out = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else {
      if (c === ',') { out.push(cur); cur = ''; }
      else if (c === '"' && cur === '') inQ = true;
      else cur += c;
    }
  }
  out.push(cur);
  return out.map(s => s.trim());
}
window.parseLeadCSV = function(evt) {
  const file = evt.target.files && evt.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const text = (reader.result || '').replace(/^\uFEFF/, '');
      const lines = text.split(/\r\n|\n/).filter(l => l.trim().length);
      if (!lines.length) { toast('CSV 为空', '', 'error'); return; }
      const header = parseCSVLine(lines[0]);
      const rows = lines.slice(1).map(l => {
        const vals = parseCSVLine(l);
        const r = {};
        header.forEach((h, i) => { r[h] = vals[i] || ''; });
        return r;
      }).filter(r => r['店铺名'] || r['客户']);
      if (!rows.length) { toast('未解析到有效行', '检查表头与必填字段', 'error'); return; }
      window.__LEAD_IMPORT_ROWS = rows;
      const msg = document.getElementById('lead-import-msg');
      if (msg) msg.innerHTML = `已解析 <b>${rows.length}</b> 条线索（文件：${esc(file.name)}）`;
      // 预览前 5 条
      const preview = document.getElementById('lead-import-preview');
      if (preview) {
        preview.innerHTML = `
          <div style="margin-top:16px; font-weight:600;">预览（前 5 条）</div>
          <table class="data-table compact" style="margin-top:8px;">
            <thead><tr><th>店铺名</th><th>客户</th><th>平台</th><th>侵权类型</th><th>商品</th></tr></thead>
            <tbody>${rows.slice(0, 5).map(r => `<tr>
              <td>${esc(r['店铺名'] || '—')}</td>
              <td>${esc(r['客户'] || '—')}</td>
              <td>${esc(r['平台'] || '—')}</td>
              <td>${esc(r['侵权类型'] || '—')}</td>
              <td>${esc(r['商品名称'] || '—')}</td>
            </tr>`).join('')}</tbody>
          </table>`;
      }
    } catch (e) {
      toast('解析失败', e.message || '', 'error');
    } finally {
      evt.target.value = '';
    }
  };
  reader.onerror = () => toast('读取文件失败', '', 'error');
  reader.readAsText(file, 'utf-8');
};

/* ---------- 通用工具：金额 / 图表 / 卡片 ---------- */
const money0 = n => '¥ ' + Number(n || 0).toLocaleString('zh-CN');
const wan = n => '¥ ' + (Number(n || 0) / 10000).toFixed(1) + ' 万';

function barChart(items) {
  const max = Math.max(1, ...items.map(i => i.v));
  return items.map((it, i) => `
    <div class="bar-row">
      <span class="bar-label">${esc(it.k)}</span>
      <div class="bar-track"><div class="bar-fill c${(i % 6) + 1}" style="width:${(it.v / max * 100).toFixed(1)}%"></div></div>
      <span class="bar-val">${it.v}</span>
    </div>`).join('') || '<div class="empty" style="padding:20px;"><div class="empty-desc">暂无数据</div></div>';
}
const statCard = (l, v, t, tc) => `<div class="stat">
  <div class="stat-label">${esc(l)}</div>
  <div class="stat-value">${v}</div>
  <div class="stat-trend ${tc || 'flat'}">${esc(t || '')}</div></div>`;

/* ---------- 工作台 ---------- */
function renderDashboard() {
  // 看板视图已从工作台移除：保留空实现以兼容历史调用点，避免空引用
  if (!$('#view-dashboard')) return;
  const d = new Date();
  const wk = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  $('#dash-date').textContent = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 星期${wk} · 你共有 ${STATE.cases.length} 个案件、${NOTARY_ITEMS.filter(n => n.stage !== '已归档').length} 件公证在办`;

  const n = k => STATE.cases.filter(c => c.status === k).length;
  $('#dash-kpi').innerHTML =
    statCard('进行中案件', STATE.cases.filter(c => c.status !== '已归档').length + ' <span class="unit">件</span>', `已归档 ${n('已归档')} 件`, 'up') +
    statCard('待处理线索', LEADS.filter(l => l.progress === '待推送').length + ' <span class="unit">条</span>', `审核中 ${LEADS.filter(l => l.progress === '线索待审核').length} 条`, 'up') +
    statCard('律师待办', LAWYER_TASKS.length + ' <span class="unit">项</span>', `最急 ${LAWYER_TASKS.map(t => t.due).sort()[0]}`, 'flat') +
    statCard('本月应收', wan(SETTLEMENTS.filter(s => s.rec === 0).reduce((a, s) => a + s.amt, 0)), `已回款 ${wan(SETTLEMENTS.reduce((a, s) => a + s.rec, 0))}`, 'up') +
    statCard('合作客户', STATE.customers.length + ' <span class="unit">家</span>', `在办案件 ${STATE.cases.filter(c => c.status !== '已归档').length} 件`, 'flat');

  $('#dash-stages').innerHTML = barChart(STAGES.map(s => ({ k: s.key, v: n(s.key) })));

  const q = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  q('#quick-cases', STATE.cases.length);
  q('#quick-leads', LEADS.filter(l => l.progress === '待推送').length);
  q('#quick-evidence', EVIDENCES.length);
  q('#quick-cust', STATE.customers.length);
  q('#quick-settle', wan(SETTLEMENTS.filter(s => s.rec === 0 && sameMonth(s.m, curMonth())).reduce((a, s) => a + s.amt, 0)));
}

/* ---------- 数据报表 ---------- */
function renderReports() {
  const cs = STATE.cases;
  $('#report-n').textContent = cs.length;
  const n = k => cs.filter(c => c.status === k).length;
  const totalAmt = cs.reduce((a, c) => a + numOf(c.amount), 0);
  // 平均结案金额：仅统计已归档案件，避免被在办案件的整体均值稀释
  const closed = cs.filter(c => c.status === '已归档');
  const closedAmt = closed.reduce((a, c) => a + numOf(c.amount), 0);
  const avgClosed = wan(closedAmt / Math.max(1, closed.length));

  $('#report-kpi').innerHTML =
    statCard('案件总数', cs.length + ' <span class="unit">件</span>', `进行中 ${cs.filter(c => c.status !== '已归档').length} 件`, 'up') +
    statCard('累计标的额', wan(totalAmt), '含全部阶段', 'up') +
    statCard('平均结案金额', avgClosed, `已归档 ${closed.length} 件取平均`, 'flat') +
    statCard('结案率', Math.round(n('已归档') / Math.max(1, cs.length) * 100) + ' <span class="unit">%</span>', `${n('已归档')} / ${cs.length}`, 'up');

  const types = {};
  cs.forEach(c => types[c.type] = (types[c.type] || 0) + 1);
  $('#report-types').innerHTML = barChart(Object.entries(types).map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v));

  // 运营工作量：**用户已主动删除该卡片，禁止擅自恢复**。容器不存在时直接跳过，避免 report-ops 为 null 抛错
  const opsBox = $('#report-ops');
  if (opsBox) {
    const ops = {};
    cs.forEach(c => ops[c.operator] = (ops[c.operator] || 0) + 1);
    opsBox.innerHTML = barChart(Object.entries(ops).map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v));
  }

  const buckets = [
    { k: '10 万以下', min: 0, max: 1e5 },
    { k: '10-30 万', min: 1e5, max: 3e5 },
    { k: '30-50 万', min: 3e5, max: 5e5 },
    { k: '50 万以上', min: 5e5, max: Infinity },
  ];
  $('#report-amt').innerHTML = barChart(buckets.map(b => ({
    k: b.k, v: cs.filter(c => { const v = numOf(c.amount); return v >= b.min && v < b.max; }).length,
  })));

  // 平台分布（v11.2 新增）：优先用 c.platform 直接读（新案件），无则退回 splitDefendant 解析 defendant（老种子）；空归「—」
  const platforms = {};
  cs.forEach(c => {
    const raw = platformOf(c);
    const p = (typeof raw === 'string' && raw.trim()) || '—';
    platforms[p] = (platforms[p] || 0) + 1;
  });
  const platformEntries = Object.entries(platforms).map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v);
  $('#report-platforms').innerHTML = platformEntries.length
    ? barChart(platformEntries)
    : emptyRow(1, '暂无平台数据', '为案件填写被告（平台 / 店铺）后会出现在这里');

  // 立案法院 TOP（v11.2 新增）：过滤掉空值 / 占位（v150 起统一走 normBlank），TOP 5 按案件数倒序
  const courtMap = {};
  cs.forEach(c => {
    const ct = normBlank(c.court);
    if (!ct) return;
    courtMap[ct] = (courtMap[ct] || 0) + 1;
  });
  const courtEntries = Object.entries(courtMap).map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v).slice(0, 5);
  $('#report-courts').innerHTML = courtEntries.length
    ? barChart(courtEntries)
    : emptyRow(1, '暂无立案法院数据', '进入诉讼阶段的案件立案后会自动出现在这里');
}


// ============================================================
// 11. 公证阶段 / 证物公证书 / 日历 / 结算（客户+律师）
// ============================================================

/* 公证处备选：线索确认「取证」时下拉录入；出证后带入公证书台账 */
const NOTARY_OFFICE_OPTIONS = [
  '广东省广州市南方公证处', '广东省深圳市深圳公证处', '广东省东莞市东莞公证处',
  '江苏省苏州市苏州公证处', '北京市方圆公证处', '上海市东方公证处', '浙江省杭州市东方公证处',
];

/* ---------- 公证流程配置（7 阶段 + 字段） ---------- */
const NOTARY_FLOW = [
  { key: '待取证',     role: '运营', fields: ['快递单号'],                                   cta: '填写快递单号' },
  { key: '待取件开箱', role: '公证处 / 运营', fields: ['开箱照片（OCR 识别面单单号）', '发货姓名', '发货电话', '发货地址'], cta: '上传开箱照片' },
  { key: '开箱待审核', role: '运营 / 客户', fields: ['侵权 / 不侵权', '审核日期'], cta: '审核开箱照片' },
  { key: '开箱待确认', role: '运营', fields: ['出证 / 不出证', '确认日期'],                  cta: '确认是否出证' },
  { key: '待出证',     role: '公证处', fields: ['公证书编号', '公证费', '样品费', '披露文件', '披露信息'], cta: '填写出证信息' },
  { key: '待退货',     role: '运营', fields: ['是否退货', '公证费', '退款金额', '退货运费'],   cta: '处理退货' },
  { key: '已归档',     role: '—',   fields: ['归档日期', '归档原因'],                         cta: null },
];
const NOTARY_STAGE_KEYS = NOTARY_FLOW.map(f => f.key);
const NOTARY_STAGE_CLS = {
  '待取证': 'pill-warning', '待取件开箱': 'pill-info', '开箱待审核': 'pill-progress',
  '开箱待确认': 'pill-blue', '待出证': 'pill-progress', '待退货': 'pill-warning', '已归档': 'pill-neutral',
};
const notaryStage = k => NOTARY_FLOW.find(f => f.key === k) || NOTARY_FLOW[0];

let NOTARY_FILTER = { status: '全部' };
const NOTARY_ITEMS = [
  { id: 'N-2026-001', case: '杭州××科技 vs 淘宝"××优品"', caseId: 'IP-20260315-001', shop: '××优品官方店',
    stage: '待出证', stageCls: 'pill-info',
    expressNo: '', openAuditResult: '', openAuditAt: '',
    openConfirmResult: '', openConfirmAt: '',
    discloseInfo: '', needReturn: '', refundAmt: 0, refundFreight: 0,
    archiveAt: '', archiveReason: '', push: '2026-03-15', recv: '林某某 / 138****8888', recvAddr: '广东省 广州市 白云区 ××街道 168 号',
    photos: 4, ocr: true, docNo: '（2026）粤公证字第12345号', docDate: '2026-03-22',
    feeN: 1200, feeP: 356, feeD: 0, disclose: '已识别待确认', audit: '待审核', auditCls: 'pill-warning', office: '广东省广州市南方公证处' },
  { id: 'N-2026-002', case: '深圳××文化 vs 拼多多"创艺小屋"', caseId: 'IP-20260402-003', shop: '创艺小屋',
    stage: '待退货', stageCls: 'pill-progress',
    expressNo: '', openAuditResult: '', openAuditAt: '',
    openConfirmResult: '', openConfirmAt: '',
    discloseInfo: '', needReturn: '', refundAmt: 0, refundFreight: 0,
    archiveAt: '', archiveReason: '', push: '2026-04-05', recv: '赵某某 / 135****2211', recvAddr: '广东省 深圳市 宝安区 ××工业区 5 栋',
    photos: 6, ocr: true, docNo: '（2026）深公证字第08812号', docDate: '2026-04-18',
    feeN: 1500, feeP: 480, feeD: 0, disclose: '披露函_深圳××文化传播.pdf', audit: '侵权', auditCls: 'pill-success', office: '广东省深圳市深圳公证处' },
  { id: 'N-2026-003', case: '广州××食品 vs 天猫"××旗舰店"', caseId: 'IP-20260218-002', shop: '××旗舰店',
    stage: '开箱待确认', stageCls: 'pill-warning',
    expressNo: '', openAuditResult: '', openAuditAt: '',
    openConfirmResult: '', openConfirmAt: '',
    discloseInfo: '', needReturn: '', refundAmt: 0, refundFreight: 0,
    archiveAt: '', archiveReason: '', push: '2026-04-22', recv: '周某某 / 139****5566', recvAddr: '广东省 广州市 番禺区 ××路 22 号',
    photos: 5, ocr: true, docNo: '（2026）粤公证字第21033号', docDate: '2026-05-06',
    feeN: 1200, feeP: 620, feeD: 800, disclose: 'OCR 已识别待确认', audit: '待审核', auditCls: 'pill-warning', office: '广东省广州市南方公证处' },
  { id: 'N-2026-004', case: '东莞××电子 vs 1688"电子王国"', caseId: 'IP-20260305-005', shop: '电子王国',
    stage: '开箱待审核', stageCls: 'pill-progress',
    expressNo: '', openAuditResult: '', openAuditAt: '',
    openConfirmResult: '', openConfirmAt: '',
    discloseInfo: '', needReturn: '', refundAmt: 0, refundFreight: 0,
    archiveAt: '', archiveReason: '', push: '2026-06-10', recv: '郑某某 / 137****9900', recvAddr: '广东省 东莞市 长安镇 ××工业区',
    photos: 3, ocr: true, docNo: '—', docDate: '—',
    feeN: 1200, feeP: 890, feeD: 0, disclose: '—', audit: '待审核', auditCls: 'pill-warning', office: '广东省东莞市东莞公证处' },
  { id: 'N-2026-005', case: '苏州××服饰 vs 抖音"潮流女装"', caseId: 'IP-20260418-022', shop: '潮流女装',
    stage: '待取件开箱', stageCls: 'pill-info',
    expressNo: '', openAuditResult: '', openAuditAt: '',
    openConfirmResult: '', openConfirmAt: '',
    discloseInfo: '', needReturn: '', refundAmt: 0, refundFreight: 0,
    archiveAt: '', archiveReason: '', push: '2026-07-02', recv: '冯某某 / 136****3344', recvAddr: '江苏省 苏州市 吴中区 ××商城 B 座',
    photos: 0, ocr: false, docNo: '—', docDate: '—',
    feeN: 0, feeP: 760, feeD: 0, disclose: '—', audit: '待审核', auditCls: 'pill-warning', office: '江苏省苏州市苏州公证处' },
  { id: 'N-2026-006', case: '杭州××科技 vs 拼多多"杯具世家"', caseId: 'IP-20260508-021', shop: '杯具世家',
    stage: '待取证', stageCls: 'pill-neutral',
    expressNo: '', openAuditResult: '', openAuditAt: '',
    openConfirmResult: '', openConfirmAt: '',
    discloseInfo: '', needReturn: '', refundAmt: 0, refundFreight: 0,
    archiveAt: '', archiveReason: '', push: '—', recv: '—', recvAddr: '—',
    photos: 0, ocr: false, docNo: '—', docDate: '—',
    feeN: 0, feeP: 0, feeD: 0, disclose: '—', audit: '待审核', auditCls: 'pill-warning', office: '—' },
  { id: 'N-2026-007', case: '北京××科技 vs 京东"数码优选"', caseId: 'IP-20260320-007', shop: '数码优选',
    stage: '已归档', stageCls: 'pill-success',
    expressNo: '', openAuditResult: '', openAuditAt: '',
    openConfirmResult: '', openConfirmAt: '',
    discloseInfo: '', needReturn: '', refundAmt: 0, refundFreight: 0,
    archiveAt: '', archiveReason: '', push: '2026-02-18', recv: '孙某某 / 138****1122', recvAddr: '北京市 海淀区 ××大厦 15 层',
    photos: 8, ocr: true, docNo: '（2026）京公证字第04571号', docDate: '2026-03-05',
    feeN: 1800, feeP: 1200, feeD: 0, disclose: '披露函_北京××科技.pdf', audit: '侵权', auditCls: 'pill-success', office: '北京市方圆公证处' },
  { id: 'N-2026-008', case: '上海××设计 vs 淘宝"潮流集合"', caseId: 'IP-20260110-015', shop: '潮流集合',
    stage: '已归档', stageCls: 'pill-success',
    expressNo: '', openAuditResult: '', openAuditAt: '',
    openConfirmResult: '', openConfirmAt: '',
    discloseInfo: '', needReturn: '', refundAmt: 0, refundFreight: 0,
    archiveAt: '', archiveReason: '', push: '2025-12-20', recv: '吴某某 / 135****7788', recvAddr: '上海市 徐汇区 ××创意园 3 号楼',
    photos: 5, ocr: true, docNo: '（2025）沪公证字第33210号', docDate: '2026-01-08',
    feeN: 1500, feeP: 340, feeD: 0, disclose: '披露函_上海××设计工作室.pdf', audit: '不侵权', auditCls: 'pill-danger', office: '上海市东方公证处' },
];
// 费用合计 = 公证费 + 调查费 + 样品费 + 披露费（调查费 investFee 自 v83 起为正式费用列，必须计入合计）
const notaryTotal = n => (n.feeN || 0) + (n.investFee || 0) + (n.feeP || 0) + (n.feeD || 0);
// v141：开箱照片只显示「已上传 / —」；不显示张数（用户明确），也不显示 OCR 状态
//   photos 张数已无录入入口（v108/v109/v140 逐步删除），仅留数据键供历史数据兼容，不参与展示。
const openPhotoText = n => ((n && (Number(n.photos) > 0 || n.ocr)) ? '已上传' : '—');

// 待取证表头新增字段：权利主体/平台由案件名派生；店铺ID/取证日期/快递为示例数据
NOTARY_ITEMS.forEach(n => {
  n.party = (n.case || '').split(' vs ')[0] || '—';
  const pm = (n.case || n.shop || '').match(/淘宝|拼多多|天猫|1688|抖音|京东/);
  n.platform = pm ? pm[0] : '—';
  // 把合并的 recv「姓名 / 电话」拆成 发货人/发货电话；空值保持 '—'
  if (n.recv && n.recv !== '—' && (n.recvName === undefined)) {
    const parts = n.recv.split('/').map(s => s.trim());
    n.recvName = parts[0] || '—';
    n.recvPhone = parts[1] || '—';
  }
  if (n.recvName === undefined) n.recvName = '—';
  if (n.recvPhone === undefined) n.recvPhone = '—';
});
const NOTARY_SHOPID = { 'N-2026-001':'TB-100234','N-2026-002':'PDD-220871','N-2026-003':'TM-330512','N-2026-004':'1688-441900','N-2026-005':'DY-556677','N-2026-006':'PDD-778899','N-2026-007':'JD-123098','N-2026-008':'TB-445566' };
const NOTARY_BUY = { 'N-2026-001':'2026-03-16','N-2026-002':'2026-04-08','N-2026-003':'2026-04-25','N-2026-004':'2026-06-05','N-2026-005':'2026-06-29','N-2026-006':'—','N-2026-007':'2026-02-20','N-2026-008':'2025-12-22' };
NOTARY_ITEMS.forEach(n => { n.shopId = NOTARY_SHOPID[n.id] || '—'; n.buyAt = NOTARY_BUY[n.id] || '—'; n.logistics = n.logistics || []; });

// 演示数据补全：已越过「待取证」的条目应有快递单号（单号入口统一在「待取证」填写 / 公证详情 → 编辑 维护）。
// 「待取证」的 N-2026-006 故意留空 —— 它就是用来演示「填写快递单号」那一步的。
const NOTARY_EXPRESS = {
  'N-2026-001': { company: '顺丰速运', no: 'SF1234567890123' },
  'N-2026-002': { company: '中通快递', no: 'ZT7788990011223' },
  'N-2026-003': { company: '圆通速递', no: 'YT9900112233445' },
  'N-2026-004': { company: '京东物流', no: 'JD5566778899001' },
  'N-2026-005': { company: '顺丰速运', no: 'SF2233445566778' },
};
NOTARY_ITEMS.forEach(n => {
  const e = NOTARY_EXPRESS[n.id];
  if (!e) return;
  if (!(n.logistics && n.logistics.length)) n.logistics = [{ company: e.company, no: e.no }];
  if (!n.expressNo) n.expressNo = e.no;
});

// 公证费 / 调查费 / 样品费：公证费(feeN)、样品费(feeP) 原种子已有；调查费(investFee) 为 v83 新增列，
// 仅「待取证 → 上传调查报告」流程会写入，种子按 id 补演示值，避免该列常年为空。
const NOTARY_INVEST_FEE = { 'N-2026-001':800, 'N-2026-002':1500, 'N-2026-003':600, 'N-2026-004':1200, 'N-2026-005':500, 'N-2026-006':0, 'N-2026-007':1000, 'N-2026-008':600 };
NOTARY_ITEMS.forEach(n => { if (n.investFee == null) n.investFee = NOTARY_INVEST_FEE[n.id] || 0; });

/* ---------- 证物 / 公证书 ---------- */
const EVIDENCES = [
  { id: 'EV-2026-010', code: 'EV-2026-010', name: '××同款电热饭盒（实物）', type: '实物证物', typeTag: 'tag-blue',    case: '深圳××文化 vs 拼多多"×家电"', caseId: 'IP-20260812-031', collect: '2026-09-02', source: '拼多多公证购买', loc: '—',            photos: 8,  keeper: '林伟',   status: '未交付',     statusCls: 'pill-warning' },
  { id: 'EV-2026-001', code: 'EV-2026-001', name: '××同款保温杯 316（实物）', type: '实物证物', typeTag: 'tag-blue',    case: '杭州××科技 vs 淘宝"××优品"', caseId: 'IP-20260315-001', collect: '2026-03-18', source: '淘宝公证购买', loc: 'A 柜 03 层', photos: 12, keeper: '陈晓敏', status: '在库',       statusCls: 'pill-success' },
  { id: 'EV-2026-002', code: 'EV-2026-002', name: '开箱过程照片组',           type: '照片证据', typeTag: 'tag-purple',  case: '杭州××科技 vs 淘宝"××优品"', caseId: 'IP-20260315-001', collect: '2026-03-18', source: '公证处开箱',   loc: '电子档案 / 2026-03', photos: 24, keeper: '陈晓敏', status: '已邮寄律师', statusCls: 'pill-info' },
  { id: 'EV-2026-003', code: 'EV-2026-003', name: '侵权插画比对图',           type: '照片证据', typeTag: 'tag-purple',  case: '深圳××文化 vs 拼多多"创艺小屋"', caseId: 'IP-20260402-003', collect: '2026-04-12', source: '店铺页面截图', loc: '电子档案 / 2026-04', photos: 18, keeper: '林伟',   status: '已邮寄律师', statusCls: 'pill-info' },
  { id: 'EV-2026-004', code: 'EV-2026-004', name: '××品牌零食礼盒（实物）',   type: '实物证物', typeTag: 'tag-blue',    case: '广州××食品 vs 天猫"××旗舰店"', caseId: 'IP-20260218-002', collect: '2026-04-25', source: '天猫公证购买', loc: 'A 柜 05 层', photos: 9,  keeper: '陈晓敏', status: '在库',       statusCls: 'pill-success' },
  { id: 'EV-2026-005', code: 'EV-2026-005', name: '连接器样品（封存）',       type: '实物证物', typeTag: 'tag-blue',    case: '东莞××电子 vs 1688"电子王国"', caseId: 'IP-20260305-005', collect: '2026-06-15', source: '1688 公证购买', loc: 'B 柜 01 层', photos: 6,  keeper: '王敏',   status: '在库',       statusCls: 'pill-success' },
  { id: 'EV-2026-006', code: 'EV-2026-006', name: '女装实物 + 吊牌',          type: '实物证物', typeTag: 'tag-blue',    case: '苏州××服饰 vs 抖音"潮流女装"', caseId: 'IP-20260418-022', collect: '2026-07-08', source: '抖音公证购买', loc: 'B 柜 02 层', photos: 11, keeper: '林伟',   status: '在库',       statusCls: 'pill-success' },
  { id: 'EV-2026-007', code: 'EV-2026-007', name: '店铺销售数据电子存证',     type: '电子数据', typeTag: 'tag-green',   case: '北京××科技 vs 京东"数码优选"', caseId: 'IP-20260320-007', collect: '2026-02-25', source: '平台数据导出', loc: '电子档案 / 2026-02', photos: 0,  keeper: '王敏',   status: '已邮寄律师', statusCls: 'pill-info' },
  { id: 'EV-2026-008', code: 'EV-2026-008', name: '商标近似性鉴定报告',       type: '鉴定报告', typeTag: 'tag-orange',  case: '北京××科技 vs 京东"数码优选"', caseId: 'IP-20260320-007', collect: '2026-03-02', source: '第三方鉴定机构', loc: '电子档案 / 2026-03', photos: 0, keeper: '王敏',   status: '已邮寄律师', statusCls: 'pill-info' },
  { id: 'EV-2025-019', code: 'EV-2025-019', name: '××高颜值随手杯（实物）',   type: '实物证物', typeTag: 'tag-blue',    case: '上海××设计 vs 淘宝"潮流集合"', caseId: 'IP-20260110-015', collect: '2025-12-28', source: '淘宝公证购买', loc: '已清退',     photos: 7,  keeper: '林伟',   status: '已销毁',     statusCls: 'pill-neutral' },
  // v132：为「案件进展」此前没有任何证物的 8 个阶段各补 1 条演示证物 ——
  //       16 档里原本只有 6 档有证物，筛选面板上大半状态点下去都是空的。
  { id: 'EV-2026-011', code: 'EV-2026-011', name: '侵权商品页面截图',     type: '照片证据', typeTag: 'tag-purple', case: '厦门××贸易 vs 淘宝"进口好物"',     caseId: 'IP-20260410-012', collect: '2026-05-06', source: '店铺页面截图',   loc: '电子档案 / 2026-05', photos: 15, keeper: '林伟',   status: '未交付',     statusCls: 'pill-warning' },
  { id: 'EV-2026-012', code: 'EV-2026-012', name: '××同款家居用品（实物）', type: '实物证物', typeTag: 'tag-blue',   case: '杭州××科技 vs 天猫"优选家居"',     caseId: 'IP-20260522-038', collect: '2026-05-26', source: '天猫公证购买',   loc: 'A 柜 07 层',        photos: 9,  keeper: '陈晓敏', status: '在库',       statusCls: 'pill-success' },
  { id: 'EV-2026-013', code: 'EV-2026-013', name: '开箱过程照片组',         type: '照片证据', typeTag: 'tag-purple', case: '广州××食品 vs 京东"食品专营"',     caseId: 'IP-20260528-042', collect: '2026-06-02', source: '公证处开箱',     loc: '电子档案 / 2026-06', photos: 22, keeper: '陈晓敏', status: '在库',       statusCls: 'pill-success' },
  { id: 'EV-2026-014', code: 'EV-2026-014', name: '侵权商品销售流水（电子）', type: '电子数据', typeTag: 'tag-green', case: '上海××设计 vs 1688"设计优选"',     caseId: 'IP-20260630-061', collect: '2026-07-02', source: '平台数据导出',   loc: '电子档案 / 2026-07', photos: 0,  keeper: '王敏',   status: '已邮寄律师', statusCls: 'pill-info' },
  { id: 'EV-2026-015', code: 'EV-2026-015', name: '被执行人店铺快照',       type: '照片证据', typeTag: 'tag-purple', case: '厦门××贸易 vs 抖音"全球优选"',     caseId: 'IP-20260706-064', collect: '2026-07-08', source: '店铺页面截图',   loc: '电子档案 / 2026-07', photos: 18, keeper: '林伟',   status: '在库',       statusCls: 'pill-success' },
  { id: 'EV-2026-016', code: 'EV-2026-016', name: '执行阶段公证购买实物',   type: '实物证物', typeTag: 'tag-blue',   case: '东莞××电子 vs 淘宝"元件商城"',     caseId: 'IP-20260714-068', collect: '2026-07-16', source: '淘宝公证购买',   loc: 'C 柜 05 层',        photos: 5,  keeper: '陈晓敏', status: '在库',       statusCls: 'pill-success' },
  { id: 'EV-2026-017', code: 'EV-2026-017', name: '财产线索截图存证',       type: '电子数据', typeTag: 'tag-green',  case: '苏州××服饰 vs 拼多多"服饰工厂店"', caseId: 'IP-20260720-072', collect: '2026-07-22', source: '平台数据导出',   loc: '电子档案 / 2026-07', photos: 0,  keeper: '王敏',   status: '未交付',     statusCls: 'pill-warning' },
  { id: 'EV-2026-018', code: 'EV-2026-018', name: '结案归档实物',           type: '实物证物', typeTag: 'tag-blue',   case: '杭州××服饰 vs 抖音"××严选"',      caseId: 'IP-20251220-088', collect: '2025-12-26', source: '抖音公证购买',   loc: '已清退',            photos: 6,  keeper: '林伟',   status: '已销毁',     statusCls: 'pill-neutral' },
];
/* v148：新增两组「区间」筛选（开庭时间 / 结案时间）+ 列表勾选集合。
   取值一律走 `EV_FILTER.xxx || ''` —— 冒烟里有几处会把 EV_FILTER 整体重置成
   { status, stageSet } 再渲染，缺字段时不能当成「有筛选条件」。 */
let EV_FILTER = { status: '全部', stageSet: [], hearFrom: '', hearTo: '', closeFrom: '', closeTo: '' };
/* 勾选集合：键 = caseId|证物编号（证物编号在同一案件下唯一，跨案件可能重复，
   拼上 caseId 才能保证「一行一个键」；与公证阶段的 NOTARY_SELECTED 同一套做法） */
let EV_SELECTED = new Set();

const NOTARY_DOCS = [
  { id: 'DOC-001', no: '（2026）粤公证字第12345号', case: '杭州××科技 vs 淘宝"××优品"', caseId: 'IP-20260315-001', office: '广东省广州市南方公证处', date: '2026-03-22', pages: 8,  file: '公证书_12345.pdf', status: '纸质证邮寄律师', statusCls: 'pill-info' },
  { id: 'DOC-002', no: '（2026）深公证字第08812号', case: '深圳××文化 vs 拼多多"创艺小屋"', caseId: 'IP-20260402-003', office: '广东省深圳市深圳公证处', date: '2026-04-18', pages: 12, file: '公证书_08812.pdf', status: '纸质证邮寄律师', statusCls: 'pill-info' },
  { id: 'DOC-003', no: '（2026）粤公证字第21033号', case: '广州××食品 vs 天猫"××旗舰店"', caseId: 'IP-20260218-002', office: '广东省广州市南方公证处', date: '2026-05-06', pages: 10, file: '公证书_21033.pdf', status: '纸质证邮寄律师', statusCls: 'pill-info' },
  { id: 'DOC-004', no: '（2026）京公证字第04571号', case: '北京××科技 vs 京东"数码优选"', caseId: 'IP-20260320-007', office: '北京市方圆公证处', date: '2026-03-05', pages: 15, file: '公证书_04571.pdf', status: '纸质证邮寄律师', statusCls: 'pill-info' },
  { id: 'DOC-005', no: '（2025）沪公证字第33210号', case: '上海××设计 vs 淘宝"潮流集合"', caseId: 'IP-20260110-015', office: '上海市东方公证处', date: '2026-01-08', pages: 6,  file: '公证书_33210.pdf', status: '纸质证邮寄律师', statusCls: 'pill-info' },
  { id: 'DOC-006', no: '（2026）粤公证字第88812号', case: '深圳××文化 vs 拼多多"×家电"', caseId: 'IP-20260812-031', office: '广东省深圳市深圳公证处', date: '—',         pages: 0,  file: '—',               status: '未出纸质证',     statusCls: 'pill-warning' },
  { id: 'DOC-007', no: '（2026）京公证字第12099号', case: '北京××科技 vs 京东"数码优选"', caseId: 'IP-20260320-007', office: '北京市方圆公证处', date: '2026-09-01', pages: 14, file: '公证书_12099.pdf', status: '未出纸质证',     statusCls: 'pill-warning' },
];

/* ---------- 日历事件 ---------- */
const CAL_EVENTS = [
  { date: '2026-09-08', type: 'pay',      title: '缴费截止 · 诉讼费 ¥ 5,900',  sub: '（2026）粤0115民初12345号', caseId: 'IP-20260315-001' },
  { date: '2026-09-09', type: 'other',    title: '举证期限届满',                sub: '杭州××科技 vs 淘宝"××优品"', caseId: 'IP-20260315-001' },
  { date: HEARING_SEED_AT, type: 'court',    title: '开庭 · 广州知识产权法院',     sub: '第七法庭 14:30', caseId: 'IP-20260315-001', party: '杭州××科技有限公司', defendant: '淘宝"××优品"', reason: '商标侵权',     time: '14:30', place: '广州知识产权法院 · 第七法庭', judge: '张某某（审判长）· 合议庭：李某某、王某某' },
  { date: '2026-09-15', type: 'pay',      title: '缴费截止 · 公告费 ¥ 1,200',  sub: '（2026）浙0110民初7721号', caseId: 'IP-20260522-038' },
  { date: '2026-09-18', type: 'court',    title: '开庭 · 杭州互联网法院',       sub: '第三法庭 09:30', caseId: 'IP-20260522-038', party: '杭州××科技有限公司', defendant: '天猫"优选家居"',  reason: '著作权侵权',   time: '09:30', place: '杭州互联网法院 · 第三法庭',   judge: '陈某某（审判员）· 书记员 0571-8888 ××××' },
  { date: '2026-09-22', type: 'other',    title: '上诉期届满',                  sub: '（2026）粤03民初9042号', caseId: 'IP-20260812-031' },
  { date: '2026-09-24', type: 'pay',      title: '缴费截止 · 执行费 ¥ 3,200',  sub: '（2026）粤0115民初2345号', caseId: 'IP-20260218-002' },
  { date: '2026-09-25', type: 'other',    title: '提交代理词截止',              sub: '深圳××文化 vs 拼多多"创艺小屋"', caseId: 'IP-20260402-003' },
  { date: '2026-09-28', type: 'contract', title: '合同到期 · 苏州××服饰集团',   sub: '到期前需完成续签', custId: 'C-2024-019' },
  { date: '2026-09-30', type: 'contract', title: '合同到期 · 上海××设计工作室', sub: '已暂停 · 需确认是否终止', custId: 'C-2025-003' },
  { date: '2026-09-30', type: 'other',    title: '9 月账单出账',                sub: '客户 6 家 · 律师 4 位' },
  { date: '2026-10-02', type: 'court',    title: '开庭 · 深圳中级人民法院',     sub: '第二法庭 10:00', caseId: 'IP-20260812-031', party: '深圳××文化传播有限公司', defendant: '拼多多"×家电"',  reason: '著作权侵权',     time: '10:00', place: '深圳中级人民法院 · 第二法庭', judge: '刘某某（审判长）· 合议庭：赵某某、孙某某' },
  { date: '2026-10-08', type: 'other',    title: '执行申请期限届满',            sub: '（2026）闽02民初3391号', caseId: 'IP-20260706-064' },
  { date: '2026-10-12', type: 'court',    title: '开庭 · 北京知识产权法院',     sub: '第五法庭 14:00', caseId: 'IP-20260320-007', party: '北京××科技股份有限公司', defendant: '京东"数码优选"', reason: '不正当竞争', time: '14:00', place: '北京知识产权法院 · 第五法庭', judge: '吴某某（审判长）· 合议庭：周某某、郑某某' },
  { date: '2026-10-15', type: 'other',    title: '一审判决预计出具',            sub: '（2026）苏05民初6612号', caseId: 'IP-20260418-022' },
  { date: '2026-10-20', type: 'contract', title: '合同到期 · 东莞××电子',       sub: '自动续约 12 个月', custId: 'C-2024-011' },
];
const EV_TYPE_CLS = { court: 'court', pay: 'pay', contract: 'contract', other: 'other' };
const EV_TYPE_LABEL = { court: '开庭', pay: '缴费截止', contract: '合同到期', other: '重要节点' };
let CAL = { y: 2026, m: 8 };   // m 为 0-based

/* ---------- 结算：客户 / 律师 ---------- */
/* v149：DEMO_NO（案件单号）已在 SETTLEMENTS 上方声明一次，两份副本共用。
   这里**不要**再声明 —— const 重复声明是 SyntaxError，会让整份 app.js 直接不执行。 */
const CUST_BILLS = [
  { m: '2026-09-05', cust: '杭州××科技有限公司',     amt: 96000,  inv: 0,      rec: 0,      prog: '待发账单', cls: 'pill-warning', date: '2026-09-30' },
  { m: '2026-08-11', cust: '杭州××科技有限公司',     amt: 125000, inv: 125000, rec: 125000, prog: '已回款',   cls: 'pill-success', date: '2026-09-05' },
  { m: '2026-08-13', cust: '深圳××文化传播有限公司', amt: 82000,  inv: 82000,  rec: 82000,  prog: '已回款',   cls: 'pill-success', date: '2026-09-03' },
  { m: '2026-08-15', cust: '北京××科技股份有限公司', amt: 210000, inv: 210000, rec: 0,      prog: '已开票',   cls: 'pill-info',    date: '2026-10-15' },
  { m: '2026-07-05', cust: '广州××食品有限公司',     amt: 64000,  inv: 64000,  rec: 64000,  prog: '已回款',   cls: 'pill-success', date: '2026-08-06' },
  { m: '2026-07-07', cust: '东莞××电子有限公司',     amt: 58000,  inv: 58000,  rec: 58000,  prog: '已回款',   cls: 'pill-success', date: '2026-08-08' },
  { m: '2026-06-05', cust: '苏州××服饰集团',         amt: 158000, inv: 158000, rec: 158000, prog: '已回款',   cls: 'pill-success', date: '2026-07-05' },
  // v149：原值 '已暂停' 不是日期 —— 未回款本就没有回款日期，置空（进度本来就是「待发账单」）
  { m: '2026-06-07', cust: '上海××设计工作室',       amt: 18000,  inv: 0,      rec: 0,      prog: '待发账单', cls: 'pill-warning', date: '' },
  /* v149：以下 3 条是「有案件单号」的演示结算数据（caseId 非空 = 可勾选入账单）——
     前 2 条已并入演示账单 2026090100001，第 3 条留着演示「勾选 → 发起账单」。
     ⚠️ 与上方 SETTLEMENTS 的对应行必须同步（历史遗留的两份副本）。 */
  { m: '2026-08-17', cust: '上海××设计工作室',       amt: 18000,  inv: 0,      rec: 0,      prog: '待发账单', cls: 'pill-warning', date: '2026-09-30', caseId: DEMO_NO.sh, nth: 2, billNo: '2026090100001', src: '一审结案结算' },
  { m: '2026-08-19', cust: '杭州××科技有限公司',     amt: 96000,  inv: 0,      rec: 0,      prog: '待发账单', cls: 'pill-warning', date: '2026-09-30', caseId: DEMO_NO.hz, nth: 1, billNo: '2026090100001', src: '一审结案结算' },
  { m: '2026-09-07', cust: '深圳××文化传播有限公司', amt: 82000,  inv: 0,      rec: 0,      prog: '待发账单', cls: 'pill-warning', date: '2026-09-30', caseId: DEMO_NO.sz, nth: 1, billNo: '', src: '一审结案结算' },
];
let CUST_BILL_FILTER = { status: '全部' };

const LAW_BILLS = [
  { m: '2026-09-09', lawyer: '李建国', firm: '广东知恒律所',   cases: 4, amt: 32000, prog: '待提交', cls: 'pill-warning', date: '2026-10-10' },
  { m: '2026-09-11', lawyer: '周敏',   firm: '广东广信君达',   cases: 2, amt: 18000, prog: '待提交', cls: 'pill-warning', date: '2026-10-10' },
  { m: '2026-08-21', lawyer: '李建国', firm: '广东知恒律所',   cases: 5, amt: 41000, prog: '已打款', cls: 'pill-success', date: '2026-09-10' },
  { m: '2026-08-23', lawyer: '吴磊',   firm: '北京盈科',       cases: 3, amt: 36000, prog: '已打款', cls: 'pill-success', date: '2026-09-12' },
  { m: '2026-08-25', lawyer: '郑楠',   firm: '广东法制盛邦',   cases: 2, amt: 15000, prog: '已开票', cls: 'pill-info',    date: '2026-09-28' },
  { m: '2026-07-09', lawyer: '孙倩',   firm: '江苏致邦',       cases: 3, amt: 27000, prog: '已打款', cls: 'pill-success', date: '2026-08-15' },
  { m: '2026-07-11', lawyer: '何静',   firm: '上海协力',       cases: 1, amt: 9000,  prog: '已打款', cls: 'pill-success', date: '2026-08-18' },
  { m: '2026-06-09', lawyer: '李建国', firm: '广东知恒律所',   cases: 6, amt: 52000, prog: '已打款', cls: 'pill-success', date: '2026-07-12' },
  /* v149：以下 3 条是「有案件单号」的演示结算数据 —— 前 2 条已并入演示账单 2026090500001，
     第 3 条留着演示「勾选 → 发起账单」。 */
  { m: '2026-08-27', lawyer: '李建国', firm: '广东知恒律所',   cases: 1, amt: 32000, prog: '待提交', cls: 'pill-warning', date: '2026-10-30', caseId: DEMO_NO.hz, nth: 1, billNo: '2026090500001', src: '一审结案结算' },
  { m: '2026-08-28', lawyer: '郑楠',   firm: '广东法制盛邦',   cases: 1, amt: 15000, prog: '待提交', cls: 'pill-warning', date: '2026-10-30', caseId: DEMO_NO.dg, nth: 1, billNo: '2026090500001', src: '一审结案结算' },
  { m: '2026-09-13', lawyer: '周敏',   firm: '广东广信君达',   cases: 1, amt: 18000, prog: '待提交', cls: 'pill-warning', date: '2026-10-30', caseId: DEMO_NO.su, nth: 1, billNo: '', src: '一审结案结算' },
];
let LAW_BILL_FILTER = { status: '全部' };

/* ---------- v146：账单台账（「结算明细 → 账单」两层） ----------
   ① 结算明细 = CUST_BILLS / LAW_BILLS —— 案件详情「发起结算」生成，只增不改；
      字段 billNo 为空 = 未入账单，有值 = 已并入该账单。
   ② 账单 = BILLS —— 结算中心勾选多条明细后「发起账单」合并生成；
      items 是生成当时的金额快照（明细日后被改也能追溯到底合并了什么）。
   两层都不删数据；明细的 billNo 回写是唯一耦合点。 */
/* v149：预置 2 张演示账单 —— 结算中心「账单」页原来是空的（BILLS = []），
   演示到「账单号 / 账单日期 / 撤销」就没有数据可点。两张各合并 2 条「有案件单号」的明细，
   明细侧的 billNo 已在上方回写，与真实「发起账单」流程的结果完全一致（可直接点「撤销」走一遍）。 */
const BILLS = [
  {
    no: '2026090100001', side: 'cust', date: '2026-09-01', payee: '上海××设计工作室',
    count: 2, amt: 114000, prog: '待发账单', cls: 'pill-warning', note: '8 月合并结算', at: '2026-09-01',
    items: [
      { m: '2026-08-28', caseId: DEMO_NO.sh, nth: 2, amt: 18000, prevProg: '待发账单', prevCls: 'pill-warning' },
      { m: '2026-08-28', caseId: DEMO_NO.hz, nth: 1, amt: 96000, prevProg: '待发账单', prevCls: 'pill-warning' },
    ],
  },
  {
    no: '2026090500001', side: 'law', date: '2026-09-05', payee: '李建国 / 广东知恒律所',
    count: 2, amt: 47000, prog: '待提交', cls: 'pill-warning', note: '8 月代理费合并结算', at: '2026-09-05',
    items: [
      { m: '2026-08-28', caseId: DEMO_NO.hz, nth: 1, amt: 32000, prevProg: '待提交', prevCls: 'pill-warning' },
      { m: '2026-08-28', caseId: DEMO_NO.dg, nth: 1, amt: 15000, prevProg: '待提交', prevCls: 'pill-warning' },
    ],
  },
];
/* 勾选集合存的是「稳定行键」而不是数组下标 ——
   明细表用 unshift 新增，下标会整体位移；若按下标存，用户勾完再发起一笔结算，
   原来勾中的那行会「漂移」到新行上，账单就合并错了。 */
const BILL_SEL = { cust: new Set(), law: new Set() };
const BILL_SIDE_LABEL = { cust: '客户结算', law: '律师结算' };
function billListOf(side) { return side === 'cust' ? CUST_BILLS : LAW_BILLS; }
/* 账单日期：v148 起的账单带 date（yyyy-MM-dd）；v146/v147 建的旧账单只有 m（账单月份）→ 兼容显示 */
function billDateOf(b) { return (b && (b.date || b.m)) || '—'; }
/* v147（用户 2026-09-14 口径）：结算中心的数据只能由案件详情「发起结算」生成 ——
   出厂种子里的历史结算单没有案件单号（caseId 为空），一律锁死：不可勾选、不可入账单。
   「有来源」的判据就是 caseId（pushSettleRecord 写入的是 caseNoOf(c)）。 */
function billFromCase(s) { return !!(s && s.caseId); }
function billSelectable(s) { return billFromCase(s) && !s.billNo; }
/* 勾选列三态（v148：三种状态**都保留方框**，只是锁死的不给点 ——
   用户 2026-09-14 反馈「结算中心的多选框怎么没了」：v147 把锁死行整格换成文字，
   视觉上像功能被删了）：
     ① 已入账单 → 灰化已勾选；② 无案件单号（出厂种子）→ 灰化空框；③ 有来源且未入账单 → 可勾选 */
function billCellHTML(side, s, key, on) {
  if (s.billNo) return `<div class="checkbox locked checked" title="已并入账单 ${esc(s.billNo)}；撤销该账单后可再次勾选"></div>`;
  if (!billFromCase(s)) return '<div class="checkbox locked" title="出厂演示数据，没有案件单号，不可入账单 —— 结算中心的数据只能由案件详情「发起结算」生成"></div>';
  return `<div class="checkbox${on ? ' checked' : ''}" onclick="toggleBillSel('${side}','${key}')" title="勾选后可发起账单"></div>`;
}
let BILL_ROW_SEQ = 0;
/* 每行明细一个一次性的稳定 id（懒分配，随 save() 落盘，刷新后仍是它） */
function billRowKey(row) {
  if (!row) return '';
  if (!row.rowKey) row.rowKey = 'br' + (++BILL_ROW_SEQ) + '_' + Math.random().toString(36).slice(2, 7);
  return row.rowKey;
}
/* 历史种子数据可能没有 rowKey：一次性补齐，避免渲染与勾选用的是两个不同键 */
function ensureBillRowKeys() {
  CUST_BILLS.forEach(billRowKey);
  LAW_BILLS.forEach(billRowKey);
}
/* v148（用户 2026-09-14 口径）：账单号 = 账单日期 YYYYMMDD + 5 位流水，例 2026091400001。
   流水**跨客户/律师共用一条序列**（同一天内不重号）—— 号码里已不再带 CB/LB 前缀，
   两边各自从 00001 起就会撞号。日期部分取「账单日期」字段，用户改日期 → 号码当场重算。
   ⚠️ 取「当日已有号码的最大流水 + 1」而不是「条数 + 1」：撤销掉较早那张后，
      条数法会把已占用的号（同日更晚那张）再发一次，直接撞号。 */
function billNoFor(dateStr) {
  const raw = String(dateStr || '').slice(0, 10).replace(/-/g, '');
  const head = /^\d{8}$/.test(raw) ? raw : today().replace(/-/g, '');
  const maxSeq = BILLS.reduce((mx, b) => {
    const n = String((b && b.no) || '');
    if (n.length !== head.length + 5 || n.indexOf(head) !== 0) return mx;
    const v = Number(n.slice(head.length));
    return (Number.isFinite(v) && v > mx) ? v : mx;
  }, 0);
  return head + String(maxSeq + 1).padStart(5, '0');
}
/* 弹窗里改「账单日期」→ 账单号跟着重算（formModal 的 oninput 只能调全局函数，传不了 side） */
function syncBillNoField() {
  const noEl = document.querySelector('#modal-body [data-k="no"]');
  if (!noEl) return;
  const dateEl = document.querySelector('#modal-body [data-k="date"]');
  noEl.value = billNoFor(dateEl ? dateEl.value : today());
}

/* ---------- 文书模版库（设置页维护，批量导出诉状初稿时取用） ----------
   content 里的 {{占位符}} 会被案件数据替换：{{原告}} {{被告}} {{被告信息}} {{案由}} {{标的额}} {{法院}} {{案件名称}} */
const BUILTIN_DRAFT_TEMPLATE =
`民事起诉状

原告：{{原告}}，统一社会信用代码：—，住所地：—。
被告：{{被告信息}}

诉讼请求：
一、判令被告立即停止侵犯原告注册商标专用权的行为；
二、判令被告赔偿原告经济损失及合理维权开支共计人民币{{标的额}}元；
三、本案诉讼费用由被告承担。

事实与理由：
原告系「{{案件名称}}」所涉知识产权的权利人。经查，被告在电子商务平台实施侵权行为，{{案由}}事实清楚、证据充分。原告已对侵权行为完成公证取证，公证文书载明被告的侵权事实。被告未经许可，擅自销售侵权商品，依法应承担停止侵权、赔偿损失的民事责任。
本案已由{{法院}}依法受理（拟），特此起诉。

此致
{{法院}}

具状人：{{原告}}
{{日期}}`;

let DOC_TEMPLATES = [
  { id: 'T-001', type: '起诉状', name: '民事起诉状（演示模版）.txt', size: '2.1 KB', date: '2026-09-01',
    content: BUILTIN_DRAFT_TEMPLATE },
];

// 演示数据「出厂快照」——重置时用它还原（const 数组只能原地改，故深拷贝一份）
const DEMO_DEFAULTS = {
  leads: JSON.parse(JSON.stringify(LEADS)),
  notary: JSON.parse(JSON.stringify(NOTARY_ITEMS)),
  evidences: JSON.parse(JSON.stringify(EVIDENCES)),
  notaryDocs: JSON.parse(JSON.stringify(NOTARY_DOCS)),
  calEvents: JSON.parse(JSON.stringify(CAL_EVENTS)),
  custBills: JSON.parse(JSON.stringify(CUST_BILLS)),
  lawBills: JSON.parse(JSON.stringify(LAW_BILLS)),
  bills: JSON.parse(JSON.stringify(BILLS)),
  docTemplates: JSON.parse(JSON.stringify(DOC_TEMPLATES)),
};

// 把一组数据原地写回演示数组（const 数组不能整体重新赋值）
function restoreExtras(d) {
  if (!d) return;
  // 存档缺失/为空 → 自动回退到出厂种子（DEMO_DEFAULTS），绝不把证物/公证等列表清空成空白。
  // 只有存档里确有内容时才用存档，保证用户手动新增的数据不丢。
  const put = (arr, src, seed) => {
    const use = (Array.isArray(src) && src.length) ? src : (Array.isArray(seed) ? seed : []);
    arr.length = 0;
    use.forEach(x => arr.push(x));
  };
  put(LEADS, d.leads, DEMO_DEFAULTS.leads);
  put(NOTARY_ITEMS, d.notary, DEMO_DEFAULTS.notary);
  put(EVIDENCES, d.evidences, DEMO_DEFAULTS.evidences);
  put(NOTARY_DOCS, d.notaryDocs, DEMO_DEFAULTS.notaryDocs);
  put(CAL_EVENTS, d.calEvents, DEMO_DEFAULTS.calEvents);
  put(CUST_BILLS, d.custBills, DEMO_DEFAULTS.custBills);
  put(LAW_BILLS, d.lawBills, DEMO_DEFAULTS.lawBills);
  put(BILLS, Array.isArray(d.bills) ? d.bills : [], DEMO_DEFAULTS.bills);
  put(DOC_TEMPLATES, d.docTemplates, DEMO_DEFAULTS.docTemplates);
}

// ============================================================
// 12. 渲染：公证阶段
// ============================================================
function renderNotary() {
  // 页头说明：跟随当前二级目录阶段变化
  const notaryList = NOTARY_ITEMS.filter(n => NOTARY_FILTER.status === '全部' || n.stage === NOTARY_FILTER.status);
  const curStage = notaryStage(NOTARY_FILTER.status === '全部' ? '待取证' : NOTARY_FILTER.status);
  const subEl = document.getElementById('notary-page-sub');
  if (subEl) {
    subEl.innerHTML = NOTARY_FILTER.status === '全部'
      ? `待取证 → 待取件开箱 → 开箱待审核 → 开箱待确认 → 待出证（→ 诉讼） / 待退货 → 已归档 · 共 <b id="notary-count">${notaryList.length}</b> 件`
      : `案件进展「<b>${esc(NOTARY_FILTER.status)}</b>」 · 责任人 <b>${esc(curStage.role)}</b> · 需填写：${curStage.fields.map(x => esc(x)).join('、')} · 本阶段 <b id="notary-count">${notaryList.length}</b> 件`;
  }

  $$('#notary-filters .count[data-c]').forEach(el => {
    const k = el.dataset.c;
    const cnt = s => NOTARY_ITEMS.filter(n => n.stage === s).length;
    el.textContent = k === '全部' ? NOTARY_ITEMS.length : cnt(k);
  });

  const list = notaryList;
  const cntEl = document.getElementById('notary-count');
  if (cntEl) cntEl.textContent = list.length;
  // v68：批量上传开箱照片按钮仅在「待取件开箱」视图显示
  const openPhotoBatchBtn = document.getElementById('notary-openphotos-btn');
  if (openPhotoBatchBtn) openPhotoBatchBtn.style.display = (NOTARY_FILTER.status === '待取件开箱') ? '' : 'none';
  renderNotaryStageNav();
  // 费用三列（公证费 / 调查费 / 样品费）：0 或缺失显示「—」，与其它金额列口径一致
  const feeTdOf = v => { const num = Number(v) || 0; return num > 0 ? money0(num) : '<span class="ph">—</span>'; };
  $('#notary-tbody').innerHTML = list.map(n => {
    const checked = NOTARY_SELECTED.has(n.id) ? ' checked' : '';
    const photos = openPhotoText(n);
    const prog = caseProgressOf(n);   // 返回 HTML（pill），须用 innerHTML 写回
    return `
    <tr>
      <td><div class="checkbox${checked}" onclick="toggleNotary('${n.id}')" data-page-node-id="notary-row-${n.id}-chk"></div></td>
      <td style="white-space:nowrap;">${notaryActionBtns(n)}</td>
      <td>${prog}</td>
      <td>${esc(n.party || '—')}</td>
      <td><span class="tag tag-blue">${esc(n.platform || '—')}</span></td>
      <td>
        <span class="case-name">${esc(n.shop)}</span>
        <span class="case-id">${esc(n.id)}</span>
      </td>
      <td class="mono">${esc(n.shopId || '—')}</td>
      <td class="mono">${esc(n.push)}</td>
      <td class="mono">${esc(n.buyAt || '—')}</td>
      <td>${photos === '—' ? '<span class="ph">—</span>' : `<span class="pill pill-neutral">${photos}</span>`}</td>
      <td class="mono">${esc(n.docNo || '—')}</td>
      <td>${esc(n.recvName || '—')}</td>
      <td class="mono">${esc(n.recvPhone || '—')}</td>
      <td>${esc(n.recvAddr || '—')}</td>
      <td class="num">${feeTdOf(n.feeN)}</td>
      <td class="num">${feeTdOf(n.investFee)}</td>
      <td class="num">${feeTdOf(n.feeP)}</td>
    </tr>`;
  }).join('') || emptyRow(17,
    NOTARY_FILTER.status === '全部' ? '暂无公证案件' : '「' + NOTARY_FILTER.status + '」阶段暂无案件',
    '点击左侧「公证阶段」二级目录，或上方筛选按钮切换阶段');
}

/* 公证表「案件进展」列：与侧边栏公证子流程一一对应。
   - 已流转到诉讼：该公证条目已派生案件（STATE.cases.find(x => x.notaryId === n.id)），显示「已流转诉讼」+ 案件状态 pill
   - 未流转：尚未派生案件，显示 n.stage（公证子流程名），跟侧边栏公证阶段目录完全一致
   返回 HTML 字符串（带 pill 颜色），调用方需用 innerHTML 写回 */
function caseProgressOf(n) {
  try {
    if (typeof STATE !== 'undefined' && STATE && Array.isArray(STATE.cases)) {
      const c = STATE.cases.find(x => x.notaryId === n.id);
      if (c && c.status) {
        return `<span class="pill pill-info">已流转诉讼</span> ` +
               `<span class="pill pill-progress">${esc(c.status)}</span>`;
      }
    }
  } catch (e) {}
  // 未流转到诉讼：直接展示公证阶段子流程，与侧边栏公证 sub nav 一一对齐
  const stageKey = (n && n.stage) || '待取证';
  const cls = (typeof NOTARY_STAGE_CLS !== 'undefined' && NOTARY_STAGE_CLS[stageKey])
    || 'pill-neutral';
  return `<span class="pill ${cls}">${esc(stageKey)}</span>`;
}

/* ---------- 批量勾选：公证阶段 ---------- */
let NOTARY_SELECTED = new Set();
function toggleNotary(id) {
  NOTARY_SELECTED.has(id) ? NOTARY_SELECTED.delete(id) : NOTARY_SELECTED.add(id);
  renderNotary();
}
function toggleAllNotary(ev) {
  ev.stopPropagation();
  const list = NOTARY_ITEMS.filter(n => NOTARY_FILTER.status === '全部' || n.stage === NOTARY_FILTER.status);
  const allSel = list.length > 0 && list.every(n => NOTARY_SELECTED.has(n.id));
  if (allSel) list.forEach(n => NOTARY_SELECTED.delete(n.id));
  else list.forEach(n => NOTARY_SELECTED.add(n.id));
  renderNotary();
}

// 行操作：按阶段动态
function notaryActionBtns(n) {
  const detailBtn = `<button class="btn btn-ghost btn-sm" onclick="notaryDetail('${n.id}')">详情</button>`;
  const map = {
    '待取证': (n.source === '线下')
      ? `<button class="btn btn-primary btn-sm" onclick="openNotaryInvestReport('${n.id}')">上传调查报告</button>`
      : `<button class="btn btn-primary btn-sm" onclick="fillExpressNo('${n.id}')">填快递单号</button>`,
    '待取件开箱': `<button class="btn btn-primary btn-sm" onclick="uploadOpenPhotos('${n.id}')">上传开箱照片</button>`,
    '开箱待审核': `<button class="btn btn-primary btn-sm" onclick="openNotaryAudit('${n.id}')">审核</button>`,
    '开箱待确认': `<button class="btn btn-primary btn-sm" onclick="openNotaryConfirm('${n.id}')">确认</button>`,
    '待出证': `<button class="btn btn-primary btn-sm" onclick="openNotaryDoc('${n.id}')">填写出证</button>`,
    '待退货': `<button class="btn btn-primary btn-sm" onclick="openNotaryReturn('${n.id}')">处理退货</button>`,
  };
  return (map[n.stage] ? map[n.stage] + ' ' : '') + detailBtn;
}

/* ---------- 待取证：填写取证信息（取证日期* / 样品费* / 快递公司(下拉)+单号，可多组） ---------- */
// 快递公司统一走下拉（与全系统字段命名一致：店铺名 / 取证日期 / 样品费）
const COURIER_COMPANIES = ['顺丰速运', '京东物流', '中通快递', '圆通速递', '韵达快递', '申通快递', '邮政EMS', '极兔速递', '德邦快递'];
function courierOptionsHTML(sel) {
  // v111：走 courierSelectOptions —— 清单外的历史值也要能回显选中（原先只匹配标准清单，会静默丢选中）
  return '<option value="">请选择快递公司</option>' +
    courierSelectOptions(sel).map(o => `<option value="${o}"${o === sel ? ' selected' : ''}>${o}</option>`).join('');
}
// v110 / v111：快递公司下拉的选项。历史值可能不在标准清单内（早期手填 / 已落 '—'），
// 直接丢弃会让用户「一保存就丢公司名」—— 故把未知的历史值临时并入清单，保证可回显、不丢失。
// v111 起由 courierOptionsHTML 调用，填写取证信息与编辑公证的多行块共用。
function courierSelectOptions(cur) {
  const v = String(cur || '').trim();
  return (v && COURIER_COMPANIES.indexOf(v) < 0) ? [v].concat(COURIER_COMPANIES) : COURIER_COMPANIES;
}
/* ---------- v111：快递「可增删多行」组件（填写取证信息 / 编辑公证 共用） ----------
   快递公司与快递单号是两个独立字段（列头各一），不再合并成一个 label。 */
const COURIER_GRID = 'display:grid;grid-template-columns:1.05fr 1.05fr 34px;gap:8px;align-items:center;';
function courierRowHTML(c) {
  const company = (c && c.company) || '';
  const no = (c && c.no) || '';
  return `<div class="courier-row" style="${COURIER_GRID}margin-bottom:6px;">
      <select class="form-select">${courierOptionsHTML(company)}</select>
      <input class="form-input" placeholder="快递单号" value="${esc(no)}">
      <button type="button" class="btn btn-ghost btn-sm" title="删除这条快递" onclick="this.closest('.courier-row').remove()">✕</button>
    </div>`;
}
function courierRowsHTML(list, boxId) {
  const rows = (list && list.length) ? list : [null];
  return `<div style="${COURIER_GRID}margin-bottom:6px;font-size:12px;color:var(--color-ink-muted);">
      <span>快递公司</span><span>快递单号</span><span></span>
    </div>
    <div id="${boxId}">${rows.map(courierRowHTML).join('')}</div>
    <button type="button" class="btn btn-secondary btn-sm" style="margin-top:8px;" onclick="addCourierRow('${boxId}')">+ 添加快递</button>`;
}
function addCourierRow(boxId) {
  // 兼容旧调用 addCourierRow()：默认仍作用于取证弹窗的 #nt-couriers
  const box = document.getElementById(boxId || 'nt-couriers'); if (!box) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = courierRowHTML(null);
  box.appendChild(tmp.firstElementChild);
}
function readCourierRows(boxId) {
  const box = document.getElementById(boxId); if (!box) return [];
  return Array.from(box.querySelectorAll('.courier-row')).map(r => {
    const sel = r.querySelector('select');
    const inp = r.querySelector('input');
    return { company: ((sel && sel.value) || '').trim(), no: ((inp && inp.value) || '').trim() };
  }).filter(l => l.company || l.no);
}

function fillExpressNo(id) {
  const n = NOTARY_ITEMS.find(x => x.id === id); if (!n) return;
  openModal({
    title: '填写取证信息 · ' + n.id,
    okText: '保存',
    bodyHTML: `
      <div class="form-field">
        <label class="form-label">店铺名</label>
        <input class="form-input" value="${esc(n.shop)}" readonly>
      </div>
      <div class="form-field">
        <label class="form-label">取证日期<span class="req">*</span></label>
        <input class="form-input" type="date" id="nt-buyAt" value="${esc(n.buyAt && n.buyAt !== '—' ? n.buyAt : '')}">
      </div>
      <div class="form-field">
        <label class="form-label">样品费（元）<span class="req">*</span></label>
        <input class="form-input" type="number" id="nt-feeP" min="0" value="${n.feeP || ''}">
      </div>
      <div class="form-field">
        ${courierRowsHTML(n.logistics, 'nt-couriers')}
      </div>`,
    onSubmit: () => {
      const buyAt = ((document.getElementById('nt-buyAt') || {}).value || '').trim();
      const feePraw = ((document.getElementById('nt-feeP') || {}).value || '').trim();
      if (!buyAt) { toast('请填写取证日期', '', 'error'); return false; }
      if (feePraw === '' || !isFinite(Number(feePraw)) || Number(feePraw) < 0) { toast('请填写样品费', '', 'error'); return false; }
      const feeP = Number(feePraw);
      const logistics = readCourierRows('nt-couriers');
      if (!logistics.length) { toast('请至少填写一条快递记录', '快递公司与快递单号至少填一项', 'error'); return false; }
      const missingPick = logistics.find(l => !l.company);
      if (missingPick) { toast('请选择快递公司', '快递单号可留空，但公司必须从下拉中选择', 'error'); return false; }
      n.buyAt = buyAt;
      n.feeP = feeP;
      n.logistics = logistics;
      // v151：样品费属于「别的入口填的金额」→ 费用明细 + 费用中心同步生成一条（案件已存在时才落）
      pushFeeForNotary(n, '样品费', feeP, buyAt);
      renderNotary(); renderNotaryStageNav(); updateNavBadges(); save();
      toast('取证信息已保存', `${n.id} · 取证日期 ${n.buyAt} · 快递 ${logistics.length} 条`);
      closeModal();
      return true;
    },
  });
}

/* ---------- 待取证（线下线索）：上传调查报告 → 直接流转至开箱待审核 ---------- */
function openNotaryInvestReport(id) {
  const n = NOTARY_ITEMS.find(x => x.id === id); if (!n) return;
  openModal({
    title: '上传调查报告 · ' + id,
    okText: '提交',
    bodyHTML: `
      <div class="form-field">
        <label class="form-label">店铺名</label>
        <input class="form-input" value="${esc(n.shop)}" readonly>
      </div>
      <div class="form-field">
        <label class="form-label">取证日期<span class="req">*</span></label>
        <input class="form-input" type="date" id="nt-inv-date" value="">
      </div>
      <div class="form-field">
        <label class="form-label">调查费用（元）<span class="req">*</span></label>
        <input class="form-input" type="number" id="nt-inv-fee" min="0" value="" placeholder="0.00">
      </div>
      <div class="form-field">
        <label class="form-label">调查报告<span class="req">*</span></label>
        <input type="file" id="nt-inv-file" accept=".pdf,.doc,.docx,.txt" style="display:none" onchange="document.getElementById('nt-inv-fname').textContent=((this.files||[])[0]||{}).name||'未选择文件'">
        <div style="display:flex;gap:8px;align-items:center;">
          <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('nt-inv-file').click()">选择文件</button>
          <span id="nt-inv-fname" style="color:var(--color-ink-muted);font-size:13px;">未选择文件</span>
        </div>
      </div>`,
    onSubmit: () => {
      const date = ((document.getElementById('nt-inv-date') || {}).value || '').trim();
      const feeRaw = ((document.getElementById('nt-inv-fee') || {}).value || '').trim();
      const fname = (document.getElementById('nt-inv-fname') || {}).textContent || '';
      if (!date) { toast('请填写取证日期', '', 'error'); return false; }
      if (feeRaw === '' || !isFinite(Number(feeRaw)) || Number(feeRaw) < 0) { toast('请填写调查费用', '', 'error'); return false; }
      if (!fname || fname === '未选择文件') { toast('请上传调查报告', '', 'error'); return false; }
      // 回填字段
      n.buyAt = date;
      n.feeP = Number(feeRaw);
      n.investReport = fname;
      n.investFee = Number(feeRaw);
      // v151：调查费同样走统一入口（费用明细 + 费用中心），状态默认「未发起」
      pushFeeForNotary(n, '调查费', n.investFee, date);
      // 流转至开箱待审核
      n.stage = '开箱待审核';
      n.stageCls = NOTARY_STAGE_CLS['开箱待审核'] || 'pill-progress';
      renderNotary(); if (typeof renderNotaryStageNav === 'function') renderNotaryStageNav(); updateNavBadges(); save();
      toast('调查报告已提交', `${id} → 已流转至「开箱待审核」`, 'success');
      closeModal();
      return true;
    },
  });
}

/* ---------- 待取件开箱：上传开箱照片 → 从照片文件名 / 文件夹名识别快递单号 → 与本案比对后回填 ----------
   v122：单号入口收敛 —— 快递单号只在「待取证」填写或「公证详情 → 编辑」维护，
   本弹窗只读展示、不再重复录入；识别到的单号与本案比对：一致 → 归属本案；
   不一致 → 拦截（照片多半属于其它案件）；本案尚未录入单号时，以照片识别到的单号补录。 */
let OPEN_PHOTO_FILES = [];   // 本次已选的开箱照片（name / webkitRelativePath），提交时用于识别单号
// 本案快递单号：优先取「待取证」写入的多行物流，其次回落编辑侧维护的 shadow 字段 expressNo
function openPhotoCaseNo(n) {
  const lg = (n && n.logistics) || [];
  const fromLg = lg.map(l => ((l && l.no) || '').trim()).filter(Boolean);
  return fromLg.length ? fromLg[0] : String((n && n.expressNo) || '').trim();
}
// 只读展示用：多行物流逐条列出（无物流时回落 shadow 字段）
function openPhotoCaseNoText(n) {
  const lg = ((n && n.logistics) || []).filter(l => l && (l.no || l.company));
  if (!lg.length) return openPhotoCaseNo(n) || '未录入';
  return lg.map(l => [l.no, l.company].filter(Boolean).join(' · ')).join('；');
}
// 从已选照片的文件名 / 相对路径（文件夹名）中提取快递单号，去重保序（与批量上传同一识别口径）
function openPhotoRecognize(files) {
  const nos = [];
  (files || []).forEach(f => {
    const no = expressNoFromName(f.path) || expressNoFromName(f.name);
    if (no && nos.indexOf(no) < 0) nos.push(no);
  });
  return nos;
}
function openPhotoPicked(input) {
  OPEN_PHOTO_FILES = Array.from((input && input.files) || [])
    .map(f => ({ name: f.name || '', path: f.webkitRelativePath || '' }));
  const el = document.getElementById('nt-open-photo-name');
  if (!el) return;
  if (!OPEN_PHOTO_FILES.length) { el.textContent = '未选择'; return; }
  const nos = openPhotoRecognize(OPEN_PHOTO_FILES);
  el.textContent = '已选 ' + OPEN_PHOTO_FILES.length + ' 张 · ' +
    (nos.length ? '识别到单号 ' + nos.join(' / ') : '未识别到单号');
}
// 演示用的「单号 → 发货信息」识别结果
function ocrRecognize(no) {
  const seed = (no || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const names = ['林某某', '陈某某', '王某某', '赵某某', '刘某某'];
  const cities = ['广东省 广州市 白云区', '浙江省 杭州市 余杭区', '广东省 深圳市 宝安区', '江苏省 苏州市 吴中区', '福建省 厦门市 集美区'];
  return {
    name: names[seed % names.length],
    phone: '138****' + String(1000 + (seed % 8999)).slice(0, 4),
    addr: cities[seed % cities.length] + ' ××街道 ' + (10 + seed % 200) + ' 号',
  };
}
function uploadOpenPhotos(id) {
  const n = NOTARY_ITEMS.find(x => x.id === id); if (!n) return;
  OPEN_PHOTO_FILES = [];
  const caseNo = openPhotoCaseNo(n);
  openModal({
    title: '上传开箱照片 · ' + n.id,
    okText: '上传并识别',
    bodyHTML: `
      <div class="form-field">
        <label class="form-label">店铺名</label>
        <input class="form-input" value="${esc(n.shop || '—')}" readonly>
      </div>
      <div class="form-field">
        <label class="form-label">本案快递单号<span class="text-muted" style="font-weight:400;">（来自「待取证」填写 / 公证详情 → 编辑）</span></label>
        <input class="form-input mono" id="nt-open-caseno" value="${esc(openPhotoCaseNoText(n))}" readonly>
      </div>
      <div class="form-field">
        <label class="form-label">开箱照片<span class="req">*</span></label>
        <input type="file" id="nt-open-photo-file" accept="image/*" multiple style="display:none" onchange="openPhotoPicked(this)">
        <input type="file" id="nt-open-photo-dir" webkitdirectory style="display:none" onchange="openPhotoPicked(this)">
        <div style="display:flex;gap:8px;">
          <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('nt-open-photo-file').click()">选择照片</button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('nt-open-photo-dir').click()">选择文件夹</button>
        </div>
        <div class="form-hint" style="margin-top:6px;" id="nt-open-photo-name">未选择</div>
      </div>
      <div class="form-hint">识别规则：从照片文件名 / 文件夹名中提取快递单号（如 SF1234567890123）→ 与本案快递单号比对，一致才归属本案，并自动填写发货姓名 / 电话 / 地址。${caseNo ? '' : '<br><b>本案尚未录入快递单号</b>：本次将按照片识别到的单号补录到本案。'}</div>`,
    onSubmit: () => {
      if (!OPEN_PHOTO_FILES.length) { toast('请先选择开箱照片', '可多选照片，或直接选择整个开箱照片文件夹', 'error'); return false; }
      const picked = openPhotoRecognize(OPEN_PHOTO_FILES)[0] || '';
      const cur = openPhotoCaseNo(n);
      if (picked && cur && picked !== cur) {
        toast('快递单号不一致，未做任何变更', '照片识别到 ' + picked + '，本案单号为 ' + cur + '；若这批照片属于其它案件，请用右上角「批量上传开箱照片」', 'error');
        return false;
      }
      const no = picked || cur;
      const how = (picked && cur) ? '单号比对一致'
        : (picked && !cur) ? '本案未录入单号，按照片识别单号补录'
          : (cur ? '未识别到单号，按本案归属' : '未识别到单号，本案单号留空');
      // OCR 识别 + 自动回填（v109：不再录入 / 记录开箱照片张数 → 不回写 n.photos）
      const r = ocrRecognize(no || n.id);
      n.expressNo = no; n.ocr = true;
      n.recv = r.name + ' / ' + r.phone;
      n.recvName = r.name; n.recvPhone = r.phone;
      n.recvAddr = r.addr;
      n.stage = '开箱待审核'; n.stageCls = NOTARY_STAGE_CLS['开箱待审核'];
      renderNotary(); renderNotaryStageNav(); updateNavBadges(); save();
      toast('开箱照片已识别并归属本案', OPEN_PHOTO_FILES.length + ' 张 · ' + how + ' · 已流转「开箱待审核」', 'success');
      OPEN_PHOTO_FILES = [];
      closeModal();
      return true;
    },
  });
}

/* ---------- v68 待取件开箱：批量上传开箱照片（ZIP 解包 → 按文件夹取第一张面单照片识别单号 → 匹配线索回填） ----------
   回填字段与上方单个「上传开箱照片」完全一致：expressNo / ocr / 收件人三项 → 流转开箱待审核
   v109：开箱照片张数不再记录（OCR 只需上传照片）→ 文件夹内张数不再回写 photos */
// 从文件夹名或文件名提取快递单号：字母前缀(1-4位)+8位以上数字（SF1234567890123），或纯数字(10位以上)
function expressNoFromName(name) {
  const s = String(name || '');
  const m = s.match(/[A-Za-z]{1,4}\s?\d{8,20}/) || s.match(/\d{10,20}/);
  return m ? m[0].replace(/\s/g, '') : '';
}
// 按顶层文件夹分组：`文件夹/子目录/文件.jpg` 归该文件夹；无路径的根文件自成一组（按文件名去扩展名）
function groupOpenPhotoEntries(entries) {
  const groups = new Map();
  for (const en of entries) {
    if (en.skipped) continue;
    const parts = en.name.split('/');
    const key = parts.length > 1 ? parts[0] : parts[0].replace(/\.[^.]+$/, '');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(en);
  }
  return Array.from(groups.entries()).map(([folder, list]) => ({ folder, list }));
}
// 匹配：单号精确匹配优先；未填单号的待取件开箱条目按顺序兜底（一条只匹配一次，used 去重）
function matchOpenPhotoTarget(no, used) {
  let n = NOTARY_ITEMS.find(x => x.stage === '待取件开箱' && x.expressNo && x.expressNo === no && !used.has(x.id));
  if (n) return { n, how: '单号精确匹配' };
  n = NOTARY_ITEMS.find(x => x.stage === '待取件开箱' && !x.expressNo && !used.has(x.id));
  return n ? { n, how: '待取件开箱队列兜底匹配' } : null;
}
// 回填 + 流转（与单个 uploadOpenPhotos 同款字段与目标阶段）
// v109：开箱照片张数不再记录（OCR 只需上传照片）→ 去掉 cnt 参数与 photos 回写
function applyOpenPhotoBatch(n, no) {
  const r = ocrRecognize(no);
  n.expressNo = no; n.ocr = true;
  n.recv = r.name + ' / ' + r.phone;
  n.recvName = r.name; n.recvPhone = r.phone; n.recvAddr = r.addr;
  n.stage = '开箱待审核'; n.stageCls = NOTARY_STAGE_CLS['开箱待审核'];
}
// 入口：待取件开箱视图右上「批量上传开箱照片」
function uploadOpenPhotosBatch() {
  openModal({
    title: '批量上传开箱照片',
    okText: '开始识别',
    bodyHTML: `
      <div class="lead-detail-section">选择包含开箱照片的压缩包（.zip）。每个文件夹对应一件快递：取文件夹内<b>第一张面单照片</b> OCR 识别快递单号，匹配到对应线索后自动填充开箱照片与发货信息，并流转到「开箱待审核」。</div>
      <div class="form-field">
        <label class="form-label">开箱照片压缩包（.zip）<span class="req">*</span></label>
        <input type="file" id="openphoto-zip-file" accept=".zip" style="display:none" onchange="document.getElementById('openphoto-zip-name').textContent = ((this.files || [])[0] || {}).name || '未选择'">
        <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('openphoto-zip-file').click()">选择压缩包</button>
        <span class="form-hint" style="margin-left:8px;" id="openphoto-zip-name">未选择</span>
      </div>
      <div class="form-hint">识别规则：文件夹名 / 面单文件名中的快递单号（如 SF1234567890123）优先精确匹配；单号未录入的待取件开箱线索按队列顺序兜底匹配。</div>`,
    onSubmit: () => {
      const inp = document.getElementById('openphoto-zip-file');
      const f = inp && inp.files && inp.files[0];
      if (!f) { toast('请先选择开箱照片压缩包', '', 'error'); return false; }
      if (!/\.zip$/i.test(f.name)) { toast('请选择 .zip 压缩包', '', 'error'); return false; }
      readOpenPhotoZip(f);
      return false; // 保持弹窗，由识别结果弹窗接管
    },
  });
}
function readOpenPhotoZip(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    let entries;
    try { entries = await unzipRead(reader.result); }
    catch (e) { toast('压缩包解析失败', String(e && e.message || e), 'error'); return; }
    if (!entries.length) { toast('压缩包里没有可识别的文件', '', 'error'); return; }
    const used = new Set();
    const rows = [];
    let hitCount = 0;
    for (const g of groupOpenPhotoEntries(entries)) {
      const sheet = g.list[0]; // 文件夹内第一张 = 面单照片
      const fname = sheet.name.split('/').pop();
      const no = expressNoFromName(g.folder) || expressNoFromName(fname);
      if (!no) { rows.push({ folder: g.folder, photo: fname, item: '—', note: '未识别到快递单号（文件夹名/面单文件名均无单号）', ok: false }); continue; }
      const m = matchOpenPhotoTarget(no, used);
      if (!m) { rows.push({ folder: g.folder, photo: fname, item: '—', note: '单号 ' + no + ' 未匹配到待取件开箱线索', ok: false }); continue; }
      used.add(m.n.id);
      applyOpenPhotoBatch(m.n, no);
      hitCount++;
      rows.push({ folder: g.folder, photo: fname, item: m.n.id + ' · ' + m.n.shop, note: m.how + ' · ' + g.list.length + ' 张 · 已流转开箱待审核', ok: true });
    }
    renderNotary(); renderNotaryStageNav(); updateNavBadges(); save();
    openOpenPhotoResult(rows, hitCount);
  };
  reader.onerror = () => toast('读取文件失败', '', 'error');
  reader.readAsArrayBuffer(file);
}
function openOpenPhotoResult(rows, hitCount) {
  const trs = rows.map(r => `
    <tr>
      <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(r.folder)}">${esc(r.folder)}</td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(r.photo)}">${esc(r.photo)}</td>
      <td class="mono">${esc(r.item)}</td>
      <td>${r.ok ? '<span class="pill pill-success">已填充</span>' : '<span class="pill pill-warning">未处理</span>'} <span class="text-muted" style="font-size:11px;">${esc(r.note)}</span></td>
    </tr>`).join('');
  openModal({
    title: '开箱照片识别结果', wide: true, okText: '完成',
    bodyHTML: `
      <div class="lead-detail-section">共识别 <b>${rows.length}</b> 个文件夹：匹配线索 <b>${hitCount}</b> 个。</div>
      <table class="table"><thead><tr><th>文件夹</th><th>面单照片</th><th>匹配线索</th><th>结果</th></tr></thead><tbody>${trs}</tbody></table>`,
    onSubmit: () => true,
  });
}

/* ---------- 开箱待审核：运营/客户 判断侵权 / 不侵权 ---------- */
function openNotaryAudit(id) {
  const n = NOTARY_ITEMS.find(x => x.id === id); if (!n) return;
  openModal({
    title: '开箱照片审核 · ' + n.id,
    okText: '提交审核',
    bodyHTML: `
      <div class="lead-detail-section">开箱信息</div>
      <div class="lead-detail-grid">
        <div><span class="k">店铺名</span><span class="v">${esc(n.shop)}</span></div>
        <div><span class="k">快递单号</span><span class="v mono">${esc(n.expressNo || '—')}</span></div>
        <div><span class="k">开箱照片</span><span class="v">${openPhotoText(n)}</span></div>
        <div><span class="k">发货信息</span><span class="v">${esc(n.recvName || '—')} · <span class="mono">${esc(n.recvPhone || '—')}</span></span></div>
        <div class="full"><span class="k">发货地址</span><span class="v">${esc(n.recvAddr || '—')}</span></div>
      </div>
      <div class="form-field" style="margin-top:14px;">
        <label class="form-label">审核结果<span class="req">*</span></label>
        <select class="form-select" id="nt-audit-result">
          <option value="侵权">侵权</option><option value="不侵权">不侵权</option>
        </select>
      </div>`,
    onSubmit: () => {
      const res = (document.getElementById('nt-audit-result') || {}).value || '侵权';
      n.openAuditResult = res;
      n.openAuditAt = today() + ' ' + new Date().toTimeString().slice(0, 5);
      if (res === '侵权') {
        n.stage = '开箱待确认'; n.stageCls = NOTARY_STAGE_CLS['开箱待确认'];
        toast('审核完成：侵权', `${n.shop} · 进入开箱待确认`);
      } else {
        openNotaryArchive(id, '开箱照片判定不侵权');
      }
      renderNotary(); renderNotaryStageNav(); updateNavBadges(); save();
    },
  });
}

/* ---------- 开箱待确认：运营 判断出证 / 不出证 ---------- */
function openNotaryConfirm(id) {
  const n = NOTARY_ITEMS.find(x => x.id === id); if (!n) return;
  openModal({
    title: '出证确认 · ' + n.id,
    okText: '提交确认',
    bodyHTML: `
      <div class="lead-detail-section">审核结论</div>
      <div class="lead-detail-grid">
        <div><span class="k">审核结果</span><span class="v">${esc(n.openAuditResult || '—')}</span></div>
        <div><span class="k">审核日期</span><span class="v mono">${esc(n.openAuditAt || '—')}</span></div>
      </div>
      <div class="form-field" style="margin-top:14px;">
        <label class="form-label">确认结果<span class="req">*</span></label>
        <select class="form-select" id="nt-confirm-result">
          <option value="出证">出证（流转至待出证）</option>
          <option value="不出证">不出证（流转至待退货）</option>
          ${n.source === '线下' ? '<option value="提起诉讼">提起诉讼（直接流转至案件待匹配）</option>' : ''}
        </select>
      </div>`,
    onSubmit: () => {
      const res = (document.getElementById('nt-confirm-result') || {}).value || '出证';
      n.openConfirmResult = res;
      n.openConfirmAt = today() + ' ' + new Date().toTimeString().slice(0, 5);
      if (res === '提起诉讼') {
        // 线下线索：直接提起诉讼，流转至诉讼阶段（案件待匹配），不走待出证/证物
        toCaseFromNotary(n, '提起诉讼');
        n.stage = '已归档'; n.stageCls = NOTARY_STAGE_CLS['已归档'];
        n.archiveAt = today(); n.archiveReason = '线下提起诉讼，已流转至案件待匹配';
        renderNotary(); renderNotaryStageNav(); renderCaseStageNav(); updateNavBadges(); save();
        toast('已提起诉讼', `${n.shop} · 流转至案件待匹配`);
        return;
      }
      n.stage = res === '出证' ? '待出证' : '待退货';
      n.stageCls = NOTARY_STAGE_CLS[n.stage];
      renderNotary(); renderNotaryStageNav(); updateNavBadges(); save();
      toast('确认完成', `${n.shop} · ${res === '出证' ? '流转至待出证' : '流转至待退货'}`);
    },
  });
}

/* ---------- 待出证：公证书编号 / 公证费 / 样品费 / 披露文件 / 披露信息 ---------- */
function openNotaryDoc(id) {
  const n = NOTARY_ITEMS.find(x => x.id === id); if (!n) return;
  // 「是否需要披露」此前判断：公证条目自带 → 按店铺名关联线索 → 默认「是」
  const prevJudge = n.needDisclose
    || ((LEADS.find(l => l.shop === n.shop || (l.shop && n.shop && l.shop.indexOf(n.shop) >= 0) || (n.shop && l.shop && n.shop.indexOf(l.shop) >= 0)) || {}).needDisclose)
    || '是';
  // 披露文件是否已上传完成：非空且不再处于「待确认」状态（OCR 已识别待人工确认 = 尚未上传正式文件）
  const readForm = () => ({
    docNo: ((document.getElementById('nt-docno') || {}).value || '').trim(),
    docDate: (document.getElementById('nt-docdate') || {}).value || today(),
    feeN: Number((document.getElementById('nt-feen') || {}).value || 0),
    feeP: Number((document.getElementById('nt-feep') || {}).value || 0),
    needDisclose: (document.getElementById('nt-needdisclose') || {}).value || '是',
    disclose: ((document.getElementById('nt-disclose') || {}).value || '').trim(),
    discloseInfo: ((document.getElementById('nt-discloseinfo') || {}).value || '').trim(),
  });
  const applyForm = () => {
    const f = readForm();
    n.docNo = f.docNo; n.docDate = f.docDate; n.feeN = f.feeN; n.feeP = f.feeP;
    n.needDisclose = f.needDisclose;
    n.disclose = f.disclose || '—'; n.discloseInfo = f.discloseInfo || '—';
    save(); renderNotary();
  };
  openModal({
    title: '填写出证信息 · ' + n.id, wide: true,
    okText: '确认出证',
    cancelBtn: false,   // 无取消按钮：点遮罩 / 右上角 × 关闭
    extraBtn: { label: '保存', cls: 'btn-secondary', onClick: () => {
      applyForm();
      closeModal();
      toast('出证信息已保存', n.id + ' · 未流转，可稍后确认出证');
    } },
    bodyHTML: `
      <div class="form-grid">
        <div class="form-field">
          <label class="form-label">公证书编号<span class="req">*</span></label>
          <input class="form-input" id="nt-docno" value="${n.docNo && n.docNo !== '—' ? esc(n.docNo) : ''}" placeholder="如：（2026）粤公证字第12345号">
        </div>
        <div class="form-field">
          <label class="form-label">出证日期</label>
          <input class="form-input" type="date" id="nt-docdate" value="${n.docDate && n.docDate !== '—' ? n.docDate : today()}">
        </div>
        <div class="form-field">
          <label class="form-label">公证费（元）<span class="req">*</span></label>
          <input class="form-input" type="number" id="nt-feen" value="${n.feeN || 0}">
        </div>
        <div class="form-field">
          <label class="form-label">样品费（元）<span class="req">*</span></label>
          <input class="form-input" type="number" id="nt-feep" value="${n.feeP || 0}">
        </div>
        <div class="form-field">
          <label class="form-label">是否需要披露<span class="req">*</span></label>
          <select class="form-select" id="nt-needdisclose">
            <option value="是" ${prevJudge === '是' ? 'selected' : ''}>是</option>
            <option value="否" ${prevJudge === '否' ? 'selected' : ''}>否</option>
          </select>
        </div>
        <div class="form-field">
          <label class="form-label">披露文件</label>
          <input class="form-input" id="nt-disclose" value="${n.disclose && n.disclose !== '—' ? esc(n.disclose) : ''}" placeholder="如：披露函_××优品.pdf">
        </div>
        <div class="form-field">
          <label class="form-label">披露信息</label>
          <input class="form-input" id="nt-discloseinfo" value="${n.discloseInfo && n.discloseInfo !== '—' ? esc(n.discloseInfo) : ''}" placeholder="如：已披露店铺主体信息">
        </div>
      </div>
      <div class="form-hint">确认出证后，该案件将<b>自动流转到诉讼阶段（案件待匹配）</b>。</div>`,
    onSubmit: () => {
      const f = readForm();
      if (!f.docNo) { toast('请填写公证书编号', '', 'error'); return false; }
      if (!isFinite(f.feeN) || f.feeN <= 0) { toast('请填写公证费（元）', '出证费（公证费）为必填项', 'error'); return false; }
      if (!isFinite(f.feeP) || f.feeP <= 0) { toast('请填写样品费（元）', '样品费（原采买费）为必填项', 'error'); return false; }
      // 「需要披露」的案件：披露文件必须上传（非空且脱离「待确认」状态）才能确认出证
      if (f.needDisclose === '是') {
        const uploaded = f.disclose && f.disclose !== '—' && f.disclose.indexOf('待确认') < 0;
        if (!uploaded) { toast('需先上传披露文件', '需要披露的案件，披露文件确认后才能出证', 'error'); return false; }
      }
      n.docNo = f.docNo; n.docDate = f.docDate; n.feeN = f.feeN; n.feeP = f.feeP;
      n.needDisclose = f.needDisclose;
      n.disclose = f.needDisclose === '是' ? f.disclose : '—';
      n.discloseInfo = f.needDisclose === '是' ? f.discloseInfo : '—';
      n.stage = '已归档'; n.stageCls = NOTARY_STAGE_CLS['已归档'];
      n.archiveAt = today(); n.archiveReason = '出证完成，已流转诉讼阶段';
      // 出证 → 双路流转：诉讼阶段（案件待匹配）+ 证物管理（默认状态在公证处，等填货架号 → 入库）
      toCaseFromNotary(n);
      // v79：出证 → 自动生成费用明细（公证费 + 样品费），初始状态「未发起」
      // v151：改走 pushFeeFromSource —— 同一份数据同时落「案件费用明细」与「费用中心」，不再各写一份
      const gCase = STATE.cases.find(x => x.notaryId === n.id);
      if (gCase) {
        pushFeeFromSource(gCase.id, '公证费', n.feeN, { date: n.docDate || today() });
        pushFeeFromSource(gCase.id, '样品费', n.feeP, { date: n.docDate || today() });
      }
      toEvidenceFromNotary(n, n.docNo);
      toNotaryDocFromNotary(n, n.docNo);
      renderNotary(); renderNotaryStageNav(); renderCaseStageNav(); renderEvidence(); updateNavBadges(); save();
      toast('出证完成', `${n.docNo} · 已流转至诉讼阶段 + 证物管理（未交付，待填货架号上架）`);
      closeModal();
    },
  });
}

/* 出证 → 流转到证物管理：默认状态「未交付」（v11 之前叫「在公证处」），货架号空 → 用户编辑时填 */
function toEvidenceFromNotary(n, docNo) {
  if (typeof EVIDENCES === 'undefined' || !Array.isArray(EVIDENCES)) return;
  // 幂等：同一公证条目（n.id）只生成一条证物，避免重复出证触发多次入库
  if (EVIDENCES.some(e => e.caseId === n.id)) return;
  const eid = 'EV-' + today().slice(0, 4) + '-' + String(EVIDENCES.length + 1).padStart(3, '0');
  EVIDENCES.unshift({
    id: eid, code: eid,   // 默认证物编号 = 系统 id；用户在编辑弹窗可改成自己的物理编号（贴纸/条码号）
    name: n.shop + '（公证购买样品）', type: '实物证物', typeTag: 'tag-blue',
    case: n.case || (n.shop + ' 侵权案'),
    caseId: n.id,
    collect: n.docDate || today(), source: n.platform ? `${n.platform}公证购买` : '—',
    loc: '—', photos: n.photos || 0, keeper: n.keeper || '陈晓敏',
    status: '未交付', statusCls: EV_STATUS_CLS['未交付'],
  });
}

/* 出证 → 流转到公证书台账：默认状态「未出纸质证」（v11 之前叫「在公证处」） */
function toNotaryDocFromNotary(n, docNo) {
  if (typeof NOTARY_DOCS === 'undefined' || !Array.isArray(NOTARY_DOCS)) return;
  // 幂等：相同 notaryId 已生成的公证书不重复插入（同一公证条目多次出证只算一本）
  if (NOTARY_DOCS.some(d => d.caseId === n.id)) return;
  const did = 'DOC-' + String(NOTARY_DOCS.length + 1).padStart(3, '0');
  NOTARY_DOCS.unshift({
    id: did, no: docNo,
    case: n.case || (n.shop + ' 侵权案'),
    caseId: n.id,
    office: n.office || '—',
    date: n.docDate || today(), pages: 0, file: '—',
    status: '未出纸质证', statusCls: DOC_STATUS_CLS['未出纸质证'],
  });
}

/* ---------- 待退货：是否退货 → 归档 ---------- */
function openNotaryReturn(id) {
  const n = NOTARY_ITEMS.find(x => x.id === id); if (!n) return;
  const needReturn = n.needReturn || '否';
  const draftAmt = n.refundAmt != null && n.refundAmt !== '' ? n.refundAmt : '';
  const draftFrt = n.refundFreight != null && n.refundFreight !== '' ? n.refundFreight : '';
  const draftReason = n.archiveReason || '';
  // v123：公证费入口 —— 预填「待出证」已填的公证费（回写同一字段 feeN，不另造副本）
  const draftFeeN = n.feeN != null && n.feeN !== '' ? n.feeN : '';
  // 读取当前弹窗内已填写内容
  const readNeed = () => (document.getElementById('nt-needreturn') || {}).value || '否';
  // 公证费草稿：留空 = 不改动（草稿不把已有值清掉），填了合法数字才回写
  const readDraftFeeN = () => {
    const raw = (document.getElementById('nt-returnfeen') || {}).value;
    if (raw == null || String(raw).trim() === '') return null;
    const v = Number(raw);
    return isFinite(v) ? v : null;
  };
  const saveDraft = () => {
    n.needReturn = readNeed();
    const feeDraft = readDraftFeeN();
    if (feeDraft != null) n.feeN = feeDraft;
    if (n.needReturn === '是') {
      n.refundAmt = (document.getElementById('nt-refundamt') || {}).value;
      if (n.refundAmt == null) n.refundAmt = '';
      n.refundFreight = (document.getElementById('nt-refundfreight') || {}).value;
      if (n.refundFreight == null) n.refundFreight = '';
    } else {
      n.archiveReason = (function(el){ return el && el.value != null ? el.value : ''; })(document.getElementById('nt-reason')).trim();
    }
    save(); renderNotary();
  };
  // 「否 → 归档原因」与「是 → 金额」二选一展示
  const toggleBoxes = () => {
    const need = readNeed();
    document.getElementById('nt-refund-box').style.display = need === '是' ? '' : 'none';
    document.getElementById('nt-reason-box').style.display = need === '否' ? '' : 'none';
  };
  openModal({
    title: '退货处理 · ' + n.id,
    okText: '提交',
    cancelBtn: false,   // 无取消按钮：点弹窗外遮罩即取消
    extraBtn: { label: '保存', cls: 'btn-secondary', onClick: () => {
      saveDraft();
      toast('退货信息已保存', n.id + ' · 已填内容已保留，可继续提交', 'success');
    } },
    bodyHTML: `
      <div class="form-field">
        <label class="form-label">是否需要退货<span class="req">*</span></label>
        <select class="form-select" id="nt-needreturn" onchange="toggleReturnBoxes()">
          <option value="否"${needReturn === '否' ? ' selected' : ''}>否（填写归档原因后归档）</option>
          <option value="是"${needReturn === '是' ? ' selected' : ''}>是（填写退款金额与退货运费后归档）</option>
        </select>
      </div>
      <div class="form-field">
        <label class="form-label">公证费（元）<span class="req">*</span></label>
        <input class="form-input" type="number" id="nt-returnfeen" value="${draftFeeN}" placeholder="必填，取自「待出证」填写的公证费">
        <div class="form-hint">取自「待出证」阶段填写的公证费，可在此修正；保存 / 提交后同步到公证列表与详情费用。</div>
      </div>
      <div id="nt-refund-box" style="display:${needReturn === '是' ? '' : 'none'};">
        <div class="form-field">
          <label class="form-label">退款金额（元）<span class="req">*</span></label>
          <input class="form-input" type="number" id="nt-refundamt" value="${draftAmt}" placeholder="必填，请输入退款金额">
        </div>
        <div class="form-field">
          <label class="form-label">退货运费（元）<span class="req">*</span></label>
          <input class="form-input" type="number" id="nt-refundfreight" value="${draftFrt}" placeholder="必填，请输入退货运费">
        </div>
      </div>
      <div id="nt-reason-box" style="display:${needReturn === '否' ? '' : 'none'};">
        <div class="form-field">
          <label class="form-label">归档原因<span class="req">*</span></label>
          <textarea class="form-textarea" id="nt-reason" rows="3" placeholder="必填，请说明不退货直接归档的原因">${esc(draftReason)}</textarea>
        </div>
      </div>`,
    onSubmit: () => {
      // v123：公证费必填（与「待出证」同一口径）；预填已填值，正常情况下无需手输
      const feeRaw = (document.getElementById('nt-returnfeen') || {}).value;
      const feeVal = Number(feeRaw);
      if (feeRaw == null || String(feeRaw).trim() === '' || !isFinite(feeVal) || feeVal <= 0) {
        toast('请填写公证费（元）', '公证费为必填项', 'error');
        return false;
      }
      n.feeN = feeVal;
      const need = readNeed();
      n.needReturn = need;
      if (need === '是') {
        const amtRaw = (document.getElementById('nt-refundamt') || {}).value;
        const frtRaw = (document.getElementById('nt-refundfreight') || {}).value;
        const bad = [];
        if (amtRaw == null || String(amtRaw).trim() === '' || isNaN(Number(amtRaw)) || Number(amtRaw) < 0) bad.push('退款金额');
        if (frtRaw == null || String(frtRaw).trim() === '' || isNaN(Number(frtRaw)) || Number(frtRaw) < 0) bad.push('退货运费');
        if (bad.length) {
          toast('请先填写' + bad.join('与'), '必填项完成后才能提交归档', 'error');
          return;
        }
        n.refundAmt = Number(amtRaw);
        n.refundFreight = Number(frtRaw);
        save();
        openNotaryArchive(id, `退货退款 ${n.refundAmt} 元 · 运费 ${n.refundFreight} 元`);
        return;
      }
      const reason = (function(el){ return el && el.value != null ? el.value : ''; })(document.getElementById('nt-reason')).trim();
      if (!reason) {
        toast('请先填写归档原因', '不退货直接归档时归档原因为必填项', 'error');
        return;
      }
      n.archiveReason = reason;
      save();
      openNotaryArchive(id, '不退货 · ' + reason);
    },
  });
}
// 退货弹窗内切换「是→金额区 / 否→归档原因区」（内联 onchange 需要全局可见）
function toggleReturnBoxes() {
  const need = (document.getElementById('nt-needreturn') || {}).value || '否';
  const rb = document.getElementById('nt-refund-box');
  const rs = document.getElementById('nt-reason-box');
  if (rb) rb.style.display = need === '是' ? '' : 'none';
  if (rs) rs.style.display = need === '否' ? '' : 'none';
}

/* ---------- 归档：归档日期 + 归档原因 ---------- */
function openNotaryArchive(id, preset) {
  const n = NOTARY_ITEMS.find(x => x.id === id); if (!n) return;
  openModal({
    title: '公证归档 · ' + n.id,
    okText: '确认归档',
    bodyHTML: `
      <div class="form-field">
        <label class="form-label">归档日期<span class="req">*</span></label>
        <input class="form-input" type="date" id="nt-archive-at" value="${today()}">
      </div>
      <div class="form-field">
        <label class="form-label">归档原因<span class="req">*</span></label>
        <textarea class="form-textarea" id="nt-archive-reason" placeholder="如：不侵权 / 不出证 / 已完成退货">${esc(preset || '')}</textarea>
      </div>`,
    onSubmit: () => {
      const at = (document.getElementById('nt-archive-at') || {}).value || today();
      const rs = ((document.getElementById('nt-archive-reason') || {}).value || '').trim();
      if (!rs) { toast('请填写归档原因', '', 'error'); return false; }
      n.archiveAt = at; n.archiveReason = rs;
      n.stage = '已归档'; n.stageCls = NOTARY_STAGE_CLS['已归档'];
      renderNotary(); renderNotaryStageNav(); updateNavBadges(); save();
      toast('已归档', `${n.shop} · ${at}`);
    },
  });
}

/* ---------- 出证 → 诉讼阶段「案件待匹配」 ---------- */
function toCaseFromNotary(n, via) {
  if (typeof STATE === 'undefined' || !STATE.cases) return;
  if (STATE.cases.some(c => c.notaryId === n.id)) return;  // 已流转过
  const cid = 'IP-' + today().replace(/-/g, '') + '-' + String(100 + STATE.cases.length + 1);
  const vtxt = via ? `（${via}）` : '出证后';
  STATE.cases.unshift({
    id: cid,
    title: n.case || (n.shop + ' 侵权案'),
    no: '（2026）' + String(1000 + STATE.cases.length) + ' 民初 ' + String(100 + STATE.cases.length),
    client: n.case ? n.case.split(' vs ')[0] : '—',
    type: '民事', typeTag: 'tag-blue',
    defendant: n.shop, amount: 0, court: '—', operator: n.operator || '—',
    status: '案件待匹配', stageCls: 'pill-neutral',
    updated: today(), notaryId: n.id,
    timeline: [{ t: today(), d: `由公证 ${n.id}${vtxt}自动流转至诉讼阶段（案件待匹配）` }],
  });
  toast('已流转至诉讼阶段', `公证 ${n.id} → 案件 ${cid}（案件待匹配）`);
}

/* ---------- 侧栏二级目录：公证阶段 ---------- */
function renderNotaryStageNav() {
  const box = document.getElementById('notary-subnav');
  if (!box) return;
  const total = NOTARY_ITEMS.length;
  const n = k => NOTARY_ITEMS.filter(x => x.stage === k).length;
  box.innerHTML =
    `<button class="nav-sub-item" data-status="全部" onclick="gotoNotaryStage('全部')" title="全部公证案件">全部 <span class="nav-sub-count">${total}</span></button>` +
    NOTARY_STAGE_KEYS.map(k => {
      const f = notaryStage(k);
      const tip = `责任人：${f.role}｜需填写：${f.fields.join('、')}`;
      return `<button class="nav-sub-item${NOTARY_FILTER.status === k ? ' active' : ''}" data-status="${esc(k)}" onclick="gotoNotaryStage('${esc(k)}')" title="${esc(tip)}">${esc(k)} <span class="nav-sub-count">${n(k)}</span></button>`;
    }).join('');
  // 页内筛选 pill 同步
  const fb = document.getElementById('notary-filters');
  if (fb) {
    fb.innerHTML = ['全部', ...NOTARY_STAGE_KEYS].map(k => {
      const c = k === '全部' ? total : n(k);
      const act = k === NOTARY_FILTER.status ? ' active' : '';
      return `<button class="filter-pill${act}" onclick="gotoNotaryStage('${k}')" data-page-node-id="notary-filter-${k}">${k}<span class="count" data-c="${k}">${c}</span></button>`;
    }).join('');
  }
}
function gotoNotaryStage(k) {
  NOTARY_FILTER.status = k;
  showView('notary');
  renderNotary();
}

/* 公证条目 → 线索：优先 fromLead（由线索流转而来），其次店铺名互相包含，最后按权利主体前缀匹配 */
function notaryLeadOf(n) {
  if (!n) return null;
  const byLead = (typeof LEADS !== 'undefined') ? LEADS.find(l => n.fromLead && l.id === n.fromLead) : null;
  if (byLead) return byLead;
  const ns = String(n.shop || '').trim();
  if (ns) {
    const byShop = LEADS.find(l => l.shop && (l.shop === ns || l.shop.indexOf(ns) >= 0 || ns.indexOf(l.shop) >= 0));
    if (byShop) return byShop;
  }
  const np = String(n.party || '').trim();
  if (np) return LEADS.find(l => l.client && (l.client.indexOf(np) === 0 || np.indexOf(l.client) === 0)) || null;
  return null;
}

/* v96 公证详情：3 列排布。上半段「线索信息」把线索库详情卡的字段一并带过来，下半段「公证信息」；
   已删「关联案件」，并清掉此前重复的发货地址 / 公证书编号行。
   标题栏右侧有「编辑」，可修改本条目信息（案件进展仍走「推进下一阶段」）。 */
function notaryDetail(id) {
  const n = NOTARY_ITEMS.find(x => x.id === id); if (!n) return;
  const lead = notaryLeadOf(n);
  const cell = (k, v, full) => `<div${full ? ' class="full"' : ''}><span class="k">${k}</span><span class="v">${v}</span></div>`;
  const M = v => `<span class="text-muted">${v}</span>`;
  const leadCells = lead
    ? cell('案件单号', `<span class="mono">${esc(leadNoOf(lead))}</span>`)
      + cell('客户', esc(lead.client || '—'))
      + cell('权利主体', esc(lead.party || '—'))
      + cell('案件类型', esc(lead.caseType || '—'))
      + cell('运营', esc(lead.operator || '—'))
      + cell('线索来源', esc(lead.source || '—'))
      + cell('平台', esc(lead.platform || '—'))
      + cell('侵权类型', esc(lead.reason || '—'))
      + cell('线索发现日期', `<span class="mono">${esc(lead.foundAt || '—')}</span>`)
      + cell('店铺名', esc(lead.shop || '—'))
      + cell('店铺ID', `<span class="mono">${esc(lead.shopId || '—')}</span>`)
      + cell('是否需要披露', esc(lead.needDisclose || '—'))
      + cell('线索备注', esc(lead.remark || '—'), true)
    : `<div class="full"><span class="k">线索信息</span><span class="v">${M('未匹配到关联线索（该公证条目不是由线索库流转而来）')}</span></div>`;
  const leadLinks = (lead && Array.isArray(lead.links)) ? lead.links : [];
  const leadLinkRows = leadLinks.map((p, i) => `
      <tr>
        <td class="num">${i + 1}</td>
        <td><a href="${esc(p.url)}" target="_blank" rel="noopener" class="link-mono">${esc((p.url || '').length > 56 ? (p.url.slice(0, 53) + '…') : p.url)}</a></td>
        <td>${esc(p.title || '—')}</td>
        <td class="num">${(p.qty || 0).toLocaleString()}</td>
        <td class="num">¥ ${(p.price || 0).toLocaleString()}</td>
        <td class="num">${(p.cmt || 0).toLocaleString()}</td>
        <td class="num">${money0(leadLinkSale(p))}</td>
      </tr>`).join('');
  /* v98：线索库的「商品链接」区块随线索信息一起带进公证详情（只读；编辑仍在线索库 / 案件详情） */
  const leadLinksBlock = lead ? `
    <div class="lead-detail-section lead-detail-section-row" style="margin-top:14px;">
      <span>商品链接（${leadLinks.length}）· 销售总额 <b>${money0(leadTotalAmt(leadLinks))}</b></span>
    </div>
    <table class="data-table compact">
      <thead><tr><th class="num">#</th><th>链接</th><th>商品名称</th><th class="num">销量</th><th class="num">单价</th><th class="num">评论数</th><th class="num">销售额</th></tr></thead>
      <tbody>${leadLinkRows || '<tr><td colspan="7" class="text-muted" style="padding:10px;">该线索暂无商品链接</td></tr>'}</tbody>
    </table>` : '';
  // v112：快递的公司与单号各自独立成格展示，不再合并成一行（与填写 / 编辑侧口径一致）
  const lgList = (n.logistics && n.logistics.length) ? n.logistics
    : (n.expressNo ? [{ company: '', no: n.expressNo }] : []);
  const expressCompany = lgList.length ? lgList.map(l => esc(l.company || '—')).join('<br>') : M('未填写');
  const expressNo = lgList.length ? lgList.map(l => `<span class="mono">${esc(l.no || '—')}</span>`).join('<br>') : M('未填写');
  openModal({
    title: '公证详情 · ' + n.id, wide: true, xwide: true,
    okText: '推进下一阶段',
    headerBtns: [{ label: '编辑', title: '修改本公证条目的信息', onClick: () => editNotary(id) }],
    bodyHTML: `
    <div class="lead-detail-section">线索信息（来自线索库）</div>
    <div class="lead-detail-grid cols-3">${leadCells}</div>
    ${leadLinksBlock}

    <div class="lead-detail-section">公证信息</div>
    <div class="lead-detail-grid cols-3">
      ${lead ? '' : cell('店铺名', esc(n.shop || '—'))}
      ${lead ? '' : cell('平台', esc(n.platform || '—'))}
      ${lead ? '' : cell('店铺ID', `<span class="mono">${esc(n.shopId || '—')}</span>`)}
      ${cell('取证日期', `<span class="mono">${esc(n.buyAt || '—')}</span>`)}
      ${cell('快递公司', expressCompany)}
      ${cell('快递单号', expressNo)}
      ${cell('推送日期', `<span class="mono">${esc(n.push || '—')}</span>`)}
      ${cell('发货人', esc(n.recvName || '—'))}
      ${cell('发货电话', `<span class="mono">${esc(n.recvPhone || '—')}</span>`)}
      ${cell('发货地址', esc(n.recvAddr || '—'))}
      ${cell('开箱照片', openPhotoText(n))}
      ${cell('公证处', esc(n.office || '—'))}
      ${cell('公证书编号', `<span class="mono">${esc(n.docNo || '—')}</span>`)}
      ${cell('出证日期', `<span class="mono">${esc(n.docDate || '—')}</span>`)}
      ${cell('披露文件', esc(n.disclose || '—'))}
      ${cell('案件进展', `<span class="pill ${n.stageCls || 'pill-neutral'}">${esc(n.stage)}</span>`)}
      ${(n.archiveAt || n.archiveReason) ? cell('归档日期', `<span class="mono">${esc(String(n.archiveAt || '—').slice(0, 10))}</span>`) : ''}
      ${(n.archiveReason) ? cell('归档原因', esc(n.archiveReason)) : ''}
      ${cell('客户审核', `<span class="pill ${n.auditCls || 'pill-neutral'}">${esc(n.audit || '—')}</span>`)}
      ${cell('费用', `公证费 ${money0(n.feeN)} · 调查费 ${money0(n.investFee)} · 样品费 ${money0(n.feeP)} · 披露费 ${money0(n.feeD)} · <b>合计 ${money0(notaryTotal(n))}</b>`, true)}
    </div>`,
    onOk: () => { notaryAdvance(id); },
  });
}

/* 客户审核 → pill 配色（编辑表单里改完文案后同步类名） */
const NOTARY_AUDIT_CLS = { '待审核': 'pill-warning', '侵权': 'pill-success', '不侵权': 'pill-danger' };
/* v96 公证详情「编辑」：修改该公证条目自身信息（案件进展不在此改，用「推进下一阶段」） */
function editNotary(id) {
  const n = NOTARY_ITEMS.find(x => x.id === id); if (!n) return;
  const platforms = [...new Set(PLATFORMS.concat([n.platform]).filter(Boolean))];
  const clean = v => (v === undefined || v === null || v === '—') ? '' : String(v);
  formModal({
    title: '编辑公证 · ' + n.id, wide: true, submitText: '保存修改',
    fields: [
      { key: 'shop', label: '店铺名', required: true, value: clean(n.shop) },
      { key: 'platform', label: '平台', type: 'select', options: platforms, value: n.platform || '其他' },
      { key: 'shopId', label: '店铺ID', value: clean(n.shopId) },
      { key: 'buyAt', label: '取证日期', type: 'date', value: clean(n.buyAt) },
      { key: 'push', label: '推送日期', type: 'date', value: clean(n.push) },
      // v112：去掉了快递分区标题 —— 只要求把公司/单号拆成两个独立字段，不额外加标题；列头即字段名
      { type: 'custom', key: 'logistics', span: 2,
        html: courierRowsHTML(n.logistics, 'nt-couriers'),
        read: () => readCourierRows('nt-couriers') },
      { key: 'recvName', label: '发货人', value: clean(n.recvName) },
      { key: 'recvPhone', label: '发货电话', value: clean(n.recvPhone) },
      { key: 'recvAddr', label: '发货地址', span: 2, value: clean(n.recvAddr) },
      { key: 'ocr', label: '开箱照片 OCR', type: 'select', options: ['已识别', '未识别'], value: n.ocr ? '已识别' : '未识别' },
      { key: 'office', label: '公证处', type: 'select', value: clean(n.office), options: ['—'].concat(NOTARY_OFFICE_OPTIONS) },
      { key: 'docNo', label: '公证书编号', value: clean(n.docNo) },
      { key: 'docDate', label: '出证日期', type: 'date', value: clean(n.docDate) },
      { key: 'feeN', label: '公证费（元）', type: 'number', value: String(n.feeN || 0) },
      { key: 'investFee', label: '调查费（元）', type: 'number', value: String(n.investFee || 0) },
      { key: 'feeP', label: '样品费（元）', type: 'number', value: String(n.feeP || 0) },
      { key: 'feeD', label: '披露费（元）', type: 'number', value: String(n.feeD || 0) },
      { key: 'disclose', label: '披露文件', span: 2, value: clean(n.disclose) },
      { key: 'audit', label: '客户审核', type: 'select', options: ['待审核', '侵权', '不侵权'], value: n.audit || '待审核' },
    ],
    onSubmit: d => {
      const item = NOTARY_ITEMS.find(x => x.id === id); if (!item) return false;
      const cleared = [];   // v111：仅用于提示「快递已清空」这类显式清空动作
      // v111：快递**非必填**（原先留空也能改公证费，别把整张表单变成必须填快递）；
      // 但「填了单号却没选公司」是真错误 —— 校验必须放在任何赋值之前，否则 return false 会留下半改状态。
      const lgRows = Array.isArray(d.logistics) ? d.logistics : [];
      if (lgRows.length && lgRows.some(l => !l.company)) {
        toast('请选择快递公司', '填写了快递单号时，快递公司必须从下拉中选择', 'error'); return false;
      }
      item.shop = d.shop;
      item.platform = d.platform;
      item.shopId = d.shopId || '—';
      item.buyAt = d.buyAt || '—';
      item.push = d.push || '—';
      // v111：快递整体以多行块为准回写（原先是单条 logistics + 影子字段 expressNo 混用）
      if (lgRows.length) {
        item.logistics = lgRows;
        item.expressNo = lgRows[0].no || '';   // 兼容开箱照片 / OCR 匹配链路对 expressNo 的读取
      } else if (item.logistics && item.logistics.length) {
        item.logistics = [];                   // 用户在弹窗里删光了所有快递行 → 视为清空
        item.expressNo = '';
        cleared.push('快递已清空');
      }
      item.recvName = d.recvName || '—';
      item.recvPhone = d.recvPhone || '—';
      item.recvAddr = d.recvAddr || '—';
      item.recv = item.recvName + ' / ' + item.recvPhone;
      // v108：「开箱照片（张）」录入项已从本表单移除 → 不再回写 photos。
      // 原写法 numOf(d.photos) 在字段缺失时得 0，会把该条目已有的开箱照片张数清零。
      item.ocr = (d.ocr === '已识别');
      item.office = d.office || '—';
      item.docNo = d.docNo || '—';
      item.docDate = d.docDate || '—';
      item.feeN = numOf(d.feeN);
      item.investFee = numOf(d.investFee);
      item.feeP = numOf(d.feeP);
      item.feeD = numOf(d.feeD);
      /* v151（用户口径「统一费用明细的数据来源」）：本弹窗的 4 个金额也算「别的入口」——
         填了金额并保存后，案件费用明细 + 费用中心各自生成/更新一条，状态默认「未发起」。
         金额为 0 不生成（pushFeeFromSource 内部判 >0）。 */
      [['公证费', item.feeN], ['调查费', item.investFee], ['样品费', item.feeP], ['披露费', item.feeD]]
        .forEach(pair => pushFeeForNotary(item, pair[0], pair[1], today()));
      item.disclose = d.disclose || '—';
      item.audit = d.audit || '待审核';
      item.auditCls = NOTARY_AUDIT_CLS[item.audit] || 'pill-warning';
      renderNotary(); renderNotaryStageNav(); updateNavBadges(); save();
      toast('公证信息已更新', `${item.id} · ${item.shop}` + (cleared.length ? ' · ' + cleared.join(' · ') : ''));
      // 表单关窗后再重开详情（formModal 的 onOk 会 closeModal，直接打开会被一起关掉）
      setTimeout(() => notaryDetail(id), 0);
      return true;
    },
  });
}


function notaryAdvance(id) {
  const n = NOTARY_ITEMS.find(x => x.id === id); if (!n) return;
  const order = NOTARY_FLOW.map(f => f.key);
  const i = order.indexOf(n.stage);
  if (i < 0 || i >= order.length - 1) { toast('已是最后阶段', n.stage, 'info'); return; }
  const from = n.stage;
  n.stage = order[i + 1];
  n.stageCls = NOTARY_STAGE_CLS[n.stage] || 'pill-neutral';
  if (n.stage === '已出证' && n.docNo === '—') { n.docNo = '（2026）粤公证字第' + String(Math.floor(Math.random() * 90000) + 10000) + '号'; n.docDate = today(); }
  renderNotary(); renderDashboard(); updateNavBadges();
  closeModal();
  toast(`已推进至「${n.stage}」`, `${n.id} · ${from} → ${n.stage}`);
}

// ============================================================
// 13. 渲染：证物 / 公证书
// ============================================================
/* 证物 / 公证书状态枚举 + 颜色映射（供证物台账「操作 → 编辑」下拉使用） */
const EV_STATUS_CLS  = { '未交付': 'pill-warning', '在库': 'pill-success', '已邮寄律师': 'pill-info', '已销毁': 'pill-neutral' };
const DOC_STATUS_CLS = { '未出纸质证': 'pill-warning', '纸质证邮寄律师': 'pill-info' };
/* 渲染顺序：'未交付' 排在最前（出证自动生成 → 律师签收前），让用户优先看到待签收条目 */
const EV_STATUSES  = ['未交付', '在库', '已邮寄律师', '已销毁'];
const DOC_STATUSES = ['未出纸质证', '纸质证邮寄律师'];

function renderEvidence() {
  // 兜底：万一运行时证物数组为空（如本地存档损坏），立即回退到出厂种子，避免渲染成空白表
  if (!EVIDENCES.length) { DEMO_DEFAULTS.evidences.forEach(x => EVIDENCES.push(x)); }
  // ---- 证物 ----
  setTxt('#ev-count', EVIDENCES.length);
  setTxt('#ev-tab-n', EVIDENCES.length);
  /* v130：「案件进展」列 —— 与表头筛选共用 stageOfCase 这一个取值口，
     保证「列里显示的进展」与「筛选命中的进展」永远一致；不在枚举里的历史状态显示「—」。
     v131：stageOfCase 已提到模块级（倒三角浮层的计数要用），这里不再定义局部同名函数 */
  const stageCell = id => {
    const s = stageOfCase(id);
    const sObj = (s && s !== '—') ? STAGES.find(x => x.key === s) : null;
    return sObj ? `<span class="pill ${sObj.cls}">${esc(s)}</span>` : '<span class="text-muted">—</span>';
  };
  // status × stage × 时间 三个维度的判定口都在模块级（evOkStatus / evOkStage / evOkDate）：
  // pill 计数 / 进展浮层计数 / 列表行数 / 全选 / 导出五处共用，杜绝口径分叉
  // v148：「全部」也走同一套过滤（此前写死 EVIDENCES.length，设了时间区间后数字会与行数打架）
  $$('#ev-filters .filter-pill').forEach(p => {
    const el = p.querySelector('.count'); if (!el) return;
    const k = p.dataset.status;
    const ec = s => EVIDENCES.filter(e => evOkStage(e) && evOkDate(e) && (s === '全部' || e.status === s)).length;
    el.textContent = ec(k);
  });

  // 同时叠加 status × stage × 时间 三个维度（stage 多选，空集 = 不限）
  const evList = filteredEvList();
  // 按 caseId 关联公证信息：店铺名（NOTARY_ITEMS）、公证书编号+状态（NOTARY_DOCS）
  const findShop  = id => evShopOf(id);
  const findDoc   = id => evDocOf(id);
  // 脏数据兜底：历史存档里缺字段的证物条目补默认值，避免渲染抛错被 safe 吞掉后整块空白
  evList.forEach(e => {
    if (!e.id) e.id = 'EV-?';
    if (e.loc == null) e.loc = '—';
    if (e.source == null) e.source = '—';
    if (!e.status) { e.status = '在库'; }
    if (!e.statusCls || !EV_STATUS_CLS[e.status]) e.statusCls = EV_STATUS_CLS[e.status] || 'pill-neutral';
  });
  $('#ev-tbody').innerHTML = evList.map(e => {
    const doc = findDoc(e.caseId);
    // 兜底：缺 code 时回退到 id（旧种子数据兼容）
    const code = e.code || e.id || '—';
    const k = evSelKey(e);
    return `<tr>
      <td><div class="checkbox${EV_SELECTED.has(k) ? ' checked' : ''}" onclick="toggleEvSel('${esc(k)}')" title="勾选后可批量导出；表头方框 = 全选当前列表"></div></td>
      <td><div style="display:flex;gap:6px;"><button class="btn btn-ghost btn-sm" onclick="editEvidenceRow('${esc(e.id)}')" title="编辑公证书状态与备注；证物可增删多行（证物编号 / 货架号 / 证物状态）">编辑</button><button class="btn btn-ghost btn-sm" onclick="viewCaseEvidence('${esc(e.caseId)}')" title="查看该案件的证物与公证书信息">查看</button></div></td>
      <td>${esc(findShop(e.caseId))}</td>
      <td>${stageCell(e.caseId)}</td>
      <td>${esc(evLawyerOf(e))}</td>
      <td class="mono">${doc ? esc(doc.no) : '<span class="text-muted">—</span>'}</td>
      <td>${doc ? `<span class="pill ${doc.statusCls}">${esc(doc.status)}</span>` : '<span class="text-muted">—</span>'}</td>
      <td class="mono">${esc(code)}</td>
      <td class="mono">${esc(e.loc || '—')}</td>
      <td><span class="pill ${e.statusCls}">${esc(e.status)}</span></td>
      <td>${esc(e.source)}</td>
    </tr>`;
  }).join('') || emptyRow(11, '没有匹配的证物', '换个筛选条件试试');

  // v148：表头全选框 + 勾选汇总条与当前列表联动
  syncEvSelUI(evList);
  // v131：倒三角激活态 + 面板计数实时刷新
  syncEvStageFilterUI();
}

/* ---------- v148：证物台账批量勾选（单选 / 多选 / 全选，做法对齐公证阶段） ----------
   勾选集合用 caseId|证物编号 作键，全选范围 = 当前筛选命中的行（与「我的案件」「公证阶段」同口径）。
   勾选不因切换筛选而清空 —— 可以「筛一批勾一批」，最后一起导出所选。 */
function toggleEvSel(k) {
  if (!k) return;
  EV_SELECTED.has(k) ? EV_SELECTED.delete(k) : EV_SELECTED.add(k);
  renderEvidence();
}
function toggleAllEv(ev) {
  if (ev && ev.stopPropagation) ev.stopPropagation();
  const keys = filteredEvList().map(evSelKey);
  if (!keys.length) { toast('当前筛选下没有证物', '换个筛选条件再全选', 'info'); return; }
  const allSel = keys.every(k => EV_SELECTED.has(k));
  if (allSel) keys.forEach(k => EV_SELECTED.delete(k));
  else keys.forEach(k => EV_SELECTED.add(k));
  renderEvidence();
  toast(allSel ? '已取消全选' : '已全选当前列表', `${keys.length} 件证物`, 'info');
}
/* v150：原 clearEvSelection() 已删除 —— 「清除选择」按钮按用户口径去掉，
   取消勾选直接点行上的方框（或再点一次表头方框）即可，函数留着就是孤儿。 */
function syncEvSelUI(list) {
  const rows = list || filteredEvList();
  const keys = rows.map(evSelKey);
  const box = document.getElementById('ev-selall');
  if (box) box.classList.toggle('checked', keys.length > 0 && keys.every(k => EV_SELECTED.has(k)));
  const info = document.getElementById('ev-sel-info');
  if (info) info.textContent = EV_SELECTED.size
    ? `已勾选 ${EV_SELECTED.size} 件证物 · 可「导出清单」或「批量更改状态」`
    : `勾选证物可批量导出 / 批量改状态（当前列表 ${rows.length} 件，表头方框 = 全选）`;
}
/* v150：导出清单（原「导出所选」）—— 没勾就提示，不做「没勾=导全部」的隐式兜底
   （页头那个重复的「导出清单」按钮已按用户口径删掉，导出只保留这一个入口） */
function exportSelectedEvidenceCSV() {
  const picked = EVIDENCES.filter(e => EV_SELECTED.has(evSelKey(e)));
  if (!picked.length) { toast('请先勾选证物', '表头方框可全选当前列表', 'info'); return; }
  const rows = picked.map(e => {
    const doc = evDocOf(e.caseId);
    return [evShopOf(e.caseId), stageOfCase(e.caseId), evLawyerOf(e),
      doc ? doc.no : '—', doc ? doc.status : '—', e.code || e.id, e.loc, e.status, e.source];
  });
  downloadCSV(`证物清单_所选_${today()}.csv`,
    ['店铺名', '案件进展', '办案律师', '公证书编号', '公证书状态', '证物编号', '货架号', '证物状态', '备注'], rows);
  toast('已导出所选证物', `${rows.length} 条记录`, 'success');
}

/* ---------- v150：证物台账「批量更改状态」（勾选若干行 → 一次改两种状态） ----------
   用户口径：勾选多个案子后点它，可批量更改**公证书状态**和**证物状态**，保存后全站同步。
   ⚠ 公证书状态是**案件级**字段（NOTARY_DOCS 按 caseId 关联）——
     同一案件挂多件证物时不能逐件改（会被重复写），必须先按 caseId 去重。 */
function bulkEvStatus() {
  const picked = EVIDENCES.filter(e => EV_SELECTED.has(evSelKey(e)));
  if (!picked.length) { toast('请先勾选证物', '表头方框可全选当前列表', 'info'); return; }
  const caseIds = Array.from(new Set(picked.map(e => (e && e.caseId) || '').filter(Boolean)));
  const docCnt = caseIds.filter(id => !!evDocOf(id)).length;
  const KEEP = '不修改';
  openModal({
    title: `批量更改状态 · ${picked.length} 件证物`,
    okText: '保存', okClass: 'btn-primary',
    bodyHTML: `
      <div class="form-field">
        <label class="form-label">公证书状态</label>
        <select class="form-select" id="bvs-doc"><option>${KEEP}</option>${DOC_STATUSES.map(s => `<option>${esc(s)}</option>`).join('')}</select>
        <div class="form-hint">公证书状态是<b>案件级</b>字段：写入勾选项关联的 ${docCnt} / ${caseIds.length} 个案件（同一案件的多件证物只会写一次）。</div>
      </div>
      <div class="form-field">
        <label class="form-label">证物状态</label>
        <select class="form-select" id="bvs-ev"><option>${KEEP}</option>${EV_STATUSES.map(s => `<option>${esc(s)}</option>`).join('')}</select>
        <div class="form-hint">逐件写入勾选的 ${picked.length} 件证物。</div>
      </div>`,
    onSubmit: () => {
      const ds = (document.getElementById('bvs-doc') || {}).value || KEEP;
      const es = (document.getElementById('bvs-ev') || {}).value || KEEP;
      if (ds === KEEP && es === KEEP) { toast('没有要更改的状态', '两项都选了「不修改」', 'info'); return; }
      const changed = [];
      if (ds !== KEEP && DOC_STATUS_CLS[ds]) {
        let n = 0;
        caseIds.forEach(id => {
          const d = evDocOf(id);
          if (d && d.status !== ds) { d.status = ds; d.statusCls = DOC_STATUS_CLS[ds]; n++; }
        });
        if (n) changed.push(`公证书状态 → ${ds}（${n} 案）`);
      }
      if (es !== KEEP && EV_STATUS_CLS[es]) {
        let n = 0;
        picked.forEach(e => {
          if (e.status !== es) { e.status = es; e.statusCls = EV_STATUS_CLS[es]; n++; }
        });
        if (n) changed.push(`证物状态 → ${es}（${n} 件）`);
      }
      if (!changed.length) { toast('没有变化', '所选状态与现值一致', 'info'); return; }   // 不关窗
      renderEvidence(); updateNavBadges(); save();
      closeModal();
      toast('状态已更新', changed.join(' · '), 'success');
    },
  });
}

/* ---------- v148：证物列表「开庭时间 / 结案时间」区间筛选 ---------- */
function applyEvDateFilter() {
  const val = id => { const el = document.getElementById(id); return el ? String(el.value || '').slice(0, 10) : ''; };
  EV_FILTER.hearFrom  = val('ev-hear-from');
  EV_FILTER.hearTo    = val('ev-hear-to');
  EV_FILTER.closeFrom = val('ev-close-from');
  EV_FILTER.closeTo   = val('ev-close-to');
  renderEvidence();
  const on = !!(EV_FILTER.hearFrom || EV_FILTER.hearTo || EV_FILTER.closeFrom || EV_FILTER.closeTo);
  toast('时间筛选已应用',
    on ? `命中 ${filteredEvList().length} 件证物` : '未设时间范围 · 显示全部',
    on ? 'success' : 'info');
}
function clearEvDateFilter() {
  ['ev-hear-from', 'ev-hear-to', 'ev-close-from', 'ev-close-to'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  EV_FILTER.hearFrom = ''; EV_FILTER.hearTo = ''; EV_FILTER.closeFrom = ''; EV_FILTER.closeTo = '';
  renderEvidence();
  toast('已清除时间筛选', '开庭时间 / 结案时间 均不限', 'info');
}

/* ---------- v111：证物「可增删多行」组件 ----------
   展现形式对齐案件详情的「证物（N）」表：证物编号 / 货架号 / 证物状态（备注是案件级字段，不落在每行）。
   v134：编号 + 货架号都从「无」变为「有」→ 状态下拉框当场自动跳到「在库」（syncEvRowStatus）。
         用户一旦手动改过状态就不覆盖 —— 判定不依赖 onchange 事件（程序化改 value 不触发事件），
         而是把渲染时的初始状态存进 data-init-status，与当前值比对：不一致即视为「用户改过」。 */
const EV_GRID = 'display:grid;grid-template-columns:1.05fr 1.3fr 1fr 34px;gap:8px;align-items:center;';
function evRowHTML(e) {
  const st = (e && e.status) || '未交付';
  const opts = EV_STATUSES.indexOf(st) < 0 ? [st].concat(EV_STATUSES) : EV_STATUSES;   // 历史异常状态不丢选中
  const code = (e && e.code && e.code !== '—') ? e.code : '';
  const loc = (e && e.loc && e.loc !== '—') ? e.loc : '';
  return `<div class="ev-row" data-id="${(e && e.id) ? esc(e.id) : ''}" data-init-status="${esc(st)}" style="${EV_GRID}margin-bottom:6px;">
      <input class="form-input" data-f="code" placeholder="证物编号，如 EV-A03-2026-001" value="${esc(code)}" oninput="syncEvRowStatus(this)">
      <input class="form-input" data-f="loc" placeholder="货架号，如 A 柜 03 层" value="${esc(loc)}" oninput="syncEvRowStatus(this)">
      <select class="form-select" data-f="status" onchange="markEvRowManual(this)">${opts.map(o => `<option value="${esc(o)}"${o === st ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>
      <button type="button" class="btn btn-ghost btn-sm" title="删除这件证物" onclick="removeEvRow(this)">✕</button>
    </div>`;
}
/* 用户是否手动改过这行的状态：当前值 ≠ 渲染时的初始值，或 onchange 已打过标记 */
function evRowStatusTouched(row) {
  if (!row) return false;
  if (row.dataset.manual === '1') return true;
  const sel = row.querySelector('[data-f="status"]');
  const init = row.dataset.initStatus;
  return !!(sel && init !== undefined && sel.value !== init);
}
/* v134：编号 + 货架号都非空，且当前状态已是「未交付」、用户没手动改过 → 自动上架为「在库」。
   与保存时的数据层兜底共用同一判据（两格都有值 + 状态「未交付」 + 用户没动过）。 */
function syncEvRowStatus(el) {
  const row = el && el.closest ? el.closest('.ev-row') : null;
  if (!row) return;
  if (evRowStatusTouched(row)) return;                      // 用户改过状态 → 不自动覆盖
  const codeEl = row.querySelector('[data-f="code"]');
  const locEl  = row.querySelector('[data-f="loc"]');
  const selEl  = row.querySelector('[data-f="status"]');
  if (!codeEl || !locEl || !selEl) return;
  const code = (codeEl.value || '').trim();
  const loc  = (locEl.value || '').trim();
  if (!code || !loc) return;                               // 两格必须都有值
  if (selEl.value !== '未交付') return;                     // 只在「未交付」时上架
  if ((EV_STATUSES || []).indexOf('在库') < 0) return;
  selEl.value = '在库';
}
/* 用户手动动过状态下拉 → 打标记，本次弹窗内不再自动改写（双保险：还看 data-init-status 比对） */
function markEvRowManual(sel) {
  const row = sel && sel.closest ? sel.closest('.ev-row') : null;
  if (row) row.dataset.manual = '1';
}
function evRowsHTML(list) {
  const rows = (list && list.length) ? list : [null];
  return `<div style="${EV_GRID}margin-bottom:6px;font-size:12px;color:var(--color-ink-muted);">
      <span>证物编号</span><span>货架号</span><span>证物状态</span><span></span>
    </div>
    <div id="ev-rows">${rows.map(evRowHTML).join('')}</div>
    <button type="button" class="btn btn-secondary btn-sm" style="margin-top:8px;" onclick="addEvRow()">+ 添加证物</button>`;
}
function addEvRow() {
  const box = document.getElementById('ev-rows'); if (!box) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = evRowHTML(null);
  box.appendChild(tmp.firstElementChild);
}
function removeEvRow(btn) {
  const row = btn.closest('.ev-row'); if (!row) return;
  const box = row.parentNode;
  row.remove();
  // 至少留一行：空表会让「保存」变成不可见的清空操作
  if (box && !box.querySelector('.ev-row')) addEvRow();
}
function readEvRows() {
  const box = document.getElementById('ev-rows'); if (!box) return [];
  return Array.from(box.querySelectorAll('.ev-row')).map(r => {
    const pick = k => {
      const el = r.querySelector(`[data-f="${k}"]`);
      return ((el && el.value) || '').trim();
    };
    return {
      id: (r.dataset.id || '').trim(), code: pick('code'), loc: pick('loc'), status: pick('status'),
      // v134：用户是否改过这行状态（不依赖 onchange 事件，见 evRowStatusTouched）→ 自动上架不再覆盖
      manual: evRowStatusTouched(r),
    };
  });
}
/* 生成不冲突的证物 id（沿用 EV-YYYY-NNN 格式；出证流转用的 EVIDENCES.length+1 会撞号，这里取当年最大值 +1） */
function nextEvId() {
  const y = today().slice(0, 4);
  let max = 0;
  EVIDENCES.forEach(x => {
    const m = /^EV-(\d{4})-(\d+)$/.exec(x.id || '');
    if (m && m[1] === y) max = Math.max(max, Number(m[2]));
  });
  let n = max + 1, id = 'EV-' + y + '-' + String(n).padStart(3, '0'), guard = 0;
  while (EVIDENCES.some(x => x.id === id) && guard++ < 999) { n++; id = 'EV-' + y + '-' + String(n).padStart(3, '0'); }
  return id;
}

/* 证物台账「操作 → 编辑」：按案件一次编辑该案下**全部**证物（可添加 / 删除多行）
   列：证物编号 / 货架号 / 证物状态（对齐案件详情「证物（N）」表）；公证书状态与备注都是案件级字段，留在上方单独行。 */
function editEvidenceRow(id) {
  const e = EVIDENCES.find(x => x.id === id);
  if (!e) { toast('未找到该证物', id, 'error'); return; }
  const caseId = e.caseId;
  // 兜底：旧种子或外部导入数据缺 code 时，默认 = id，保证新字段总有值
  if (!e.code) e.code = e.id;
  EVIDENCES.filter(x => x.caseId === caseId).forEach(x => { if (!x.code) x.code = x.id; });
  const siblings = EVIDENCES.filter(x => x.caseId === caseId);
  const doc = NOTARY_DOCS.find(d => d.caseId === caseId);
  // v136：弹窗顶部只读信息块 —— 平台 / 店铺名 / 案号 / 案件进展 / 办案律师 / 备注。
  //   v137：**改为与「查看」弹窗完全同款** —— 复用 viewCaseEvidence 的 `field-list cols-2` + fieldRow() 结构，
  //   不再自造 .form-ro-block（用户明确：风格要统一，不要另起一种展示形态）。
  //   取值口径与「查看」弹窗逐项一致：案号走 mono、案件进展走 pill、办案律师「加粗 · 律所」、备注去重并列。
  const roCase = evCaseOfKey(caseId);
  const roDoc = doc;
  const roInfoBlock = (() => {
    const c = roCase;
    // 备注：v112 口径 —— 该案证物备注不一致时留空，避免拿其中一件的值静默覆盖其他件（与下方 initRemark 同一套）
    const roSrcVals = Array.from(new Set(siblings
      .map(x => (x.source && x.source !== '—') ? String(x.source) : '')
      .filter(Boolean)));
    const roRemark = roSrcVals.length ? esc(roSrcVals.join(' / ')) : '<span class="text-muted">—</span>';
    const roSt = c ? stageOf(c.status) : null;
    const roLawyer = (() => {
      if (!c) return '<span class="text-muted">—</span>';
      const lw = lawyerOf(c);
      // v150：原来显示「待匹配」标签 —— 用户口径：没值就给个横杠，不要说明文字
      if (!lw || lw === '—') return '<span class="text-muted">—</span>';
      const fm = (castOf(c) || {}).firm || '';
      return `<b>${esc(lw)}</b>${fm ? ` · ${esc(fm)}` : ''}`;
    })();
    // 公证书编号：查看弹窗里它是表格首列，这里作为只读块第 6 项补上（用户点名要的六项之一）
    // v138：只读块也排 3 列，与下方表单栅格对齐（复用 fieldRow()，仅加 .cols-3 列数变体）
    return `<div class="field-list cols-3" style="margin-bottom:16px;">
        ${fieldRow('平台', esc(c ? platformOf(c) : '—'))}
        ${fieldRow('店铺名', esc(evShopOf(caseId, c)))}
        ${fieldRow('案号', `<span class="mono">${esc(evCaseNoOf(c))}</span>`)}
        ${fieldRow('案件进展', roSt ? `<span class="pill ${roSt.cls}">${esc(c.status)}</span>` : '<span class="text-muted">—</span>')}
        ${fieldRow('办案律师', roLawyer)}
        ${fieldRow('公证书编号', roDoc ? `<span class="mono">${esc(roDoc.no || '—')}</span>` : '<span class="text-muted">—</span>')}
        ${fieldRow('备注', roRemark)}
      </div>`;
  })();
  // v112：备注 = 案件级。该案证物备注不一致时留空，避免拿其中一件的值静默覆盖其他件
  const srcSet = Array.from(new Set(siblings.map(x => (x.source && x.source !== '—') ? x.source : '')));
  const initRemark = (srcSet.length === 1) ? srcSet[0] : '';

  formModal({
    title: '编辑证物', xwide: true, cols: 3,
    fields: [
      { type: 'custom', key: '__ro', span: 3, html: roInfoBlock, read: () => undefined },
      { key: 'docStatus', label: '公证书状态', type: 'select',
        // 未知历史状态临时并入，避免下拉回落到首项后被「保存」静默改值
        value: doc ? doc.status : '（无关联公证书）',
        options: doc ? (DOC_STATUSES.indexOf(doc.status) < 0 ? [doc.status].concat(DOC_STATUSES) : DOC_STATUSES) : ['（无关联公证书）'] },
      // v112：备注是案件级字段（作用于该案全部证物），与公证书状态同排一行；
      // 标题与列名对齐案件详情「证物（N）」表，不自造词。v138：排 3 列后占 2 格，与状态凑满一行
      { key: 'remark', label: '备注', span: 2, value: initRemark,
        placeholder: '如：淘宝公证购买 / 需补拍开箱照 / 已移交法院卷宗' },
      // 证物明细表保持整行宽（4 格小表格塞进 1 列会挤死）
      { type: 'custom', key: 'evRows', label: '证物（' + siblings.length + '）', span: 3,
        html: evRowsHTML(siblings),
        read: () => readEvRows() },
    ],
    onSubmit: d => {
      const changed = [];
      if (doc && DOC_STATUS_CLS[d.docStatus] && d.docStatus !== doc.status) {
        doc.status = d.docStatus;
        doc.statusCls = DOC_STATUS_CLS[d.docStatus];
        changed.push('公证书状态 → ' + d.docStatus);
      }

      const rows = Array.isArray(d.evRows) ? d.evRows.filter(r => r.id || r.code || r.loc) : [];
      const keptIds = rows.filter(r => r.id).map(r => r.id);

      // ① 删除：弹窗里被 ✕ 掉的既有证物
      const removed = siblings.filter(x => keptIds.indexOf(x.id) < 0);
      removed.forEach(x => {
        const i = EVIDENCES.indexOf(x);
        if (i >= 0) EVIDENCES.splice(i, 1);
      });

      // ② 备注（案件级）：仅在填写时统一写入该案仍在列的证物（留空不覆盖，避免误清）
      const remark = (d.remark || '').trim();
      if (remark) {
        const alive = EVIDENCES.filter(x => x.caseId === caseId);
        let hit = 0;
        alive.forEach(x => { if ((x.source || '') !== remark) { x.source = remark; hit++; } });
        if (hit) changed.push('备注已更新（该案 ' + alive.length + ' 件证物）');
      }

      // ③ 更新既有 / ④ 新增（空行跳过）
      let added = 0;
      rows.forEach(r => {
        const code = r.code || '';
        const loc = r.loc || '';
        if (r.id) {
          const t = EVIDENCES.find(x => x.id === r.id);
          if (!t) return;
          // v134：先快照旧值，再写新值 —— 否则下面判断「从无到有」时读到的已是新值（静默失效）
          const oldCodeEmpty = (!t.code || t.code === '—');
          const oldLocEmpty  = (!t.loc || t.loc === '—');
          const oldStatus = t.status;
          if (code && code !== t.code) { t.code = code; changed.push('证物编号 → ' + code); }

          // v134 联动入库：证物编号 + 货架号都从「无」变为「有」→ 自动上架为「在库」。
          //   判据与 syncEvRowStatus 一致（两格都有值 + 状态仍是「未交付」+ 用户没手动改过），
          //   这里再兜一次，防止用户绕过下拉框（只填完就保存 / 直接改 DOM）导致状态没跟上。
          const nowBothFilled = !!code && code !== '—' && !!loc && loc !== '—';
          const autoStock = (oldStatus === '未交付' && nowBothFilled && (oldCodeEmpty || oldLocEmpty) && !r.manual);
          if (autoStock) {
            t.status = '在库'; t.statusCls = EV_STATUS_CLS['在库'];
            changed.push(t.id + ' 已填证物编号与货架号，证物已上架入库');
          } else if (r.status !== t.status && EV_STATUS_CLS[r.status]) {
            // 用户手动改过状态（含手动选「在库」）→ 以用户选择为准
            t.status = r.status; t.statusCls = EV_STATUS_CLS[r.status];
            changed.push(t.id + ' 证物状态 → ' + r.status);
          }
          if (loc && loc !== t.loc) { t.loc = loc; changed.push(t.id + ' 货架号 → ' + loc); }
        } else {
          if (!code && !loc) return;   // 整行空白：跳过
          const nid = nextEvId();
          const base = siblings[0] || {};
          // v134：新增证物时若「证物编号 + 货架号」都填了，默认直接落「在库」（同联动入库口径）；
          //   只填编号或只填货架号仍按「未交付」——与既有行的判据保持一致。
          //   用户若在新增行里手动选过状态（manual），一律以他的选择为准。
          const newBothFilled = !!code && !!loc;
          const newStatus = (!r.manual && r.status === '未交付' && newBothFilled) ? '在库' : (EV_STATUS_CLS[r.status] ? r.status : '未交付');
          EVIDENCES.unshift({
            id: nid, code: code || nid,
            name: base.name || (shop + '（证物）'), type: base.type || '实物证物', typeTag: base.typeTag || 'tag-blue',
            case: e.case, caseId: caseId,
            collect: base.collect || today(), source: remark || base.source || '—',
            loc: loc || '—', photos: 0, keeper: base.keeper || '—',
            status: newStatus,
            statusCls: EV_STATUS_CLS[newStatus] || EV_STATUS_CLS['未交付'],
          });
          added++;
        }
      });
      if (added) changed.push('新增 ' + added + ' 件证物');
      if (removed.length) changed.push('删除 ' + removed.length + ' 件证物');

      if (!changed.length) { toast('未做任何修改', '可修改备注 / 证物编号 / 货架号 / 证物状态，或用「+ 添加证物」新增', 'info'); return false; }
      renderEvidence(); updateNavBadges(); save();
      toast('已保存 ' + changed.length + ' 项', changed.join(' · '), 'success');
    },
  });
}

function calMove(n) {
  CAL.m += n;
  if (CAL.m > 11) { CAL.m = 0; CAL.y++; }
  if (CAL.m < 0) { CAL.m = 11; CAL.y--; }
  renderCalendar();
}
function calToday() {
  const d = new Date();
  CAL = { y: d.getFullYear(), m: d.getMonth() };
  renderCalendar();
}
function pad2(n) { return String(n).padStart(2, '0'); }
// ============================================================
// 8.5 日历「开庭」悬浮提示
// 内容存在 JS Map 里，DOM 上只挂 data-tip="<key>"，避免 HTML 转义问题
// ============================================================
const TIP_STORE = new Map();
let tipSeq = 0;
const COURT_TIP_FIELDS = [
  ['权利主体',   e => e.party],
  ['被告',     e => e.defendant],
  ['侵权类型',     e => e.reason],
  ['开庭日期', e => (e.date || '') + (e.time ? ' ' + e.time : '')],
  ['开庭地点', e => e.place],
  ['承办法官', e => e.judge],
];
function courtTipHTML(e) {
  const rows = COURT_TIP_FIELDS.map(([label, get]) => {
    const v = get(e);
    const mono = label === '开庭日期' ? ' mono' : '';
    return `<div class="cal-tip-row">
      <div class="cal-tip-label">${label}</div>
      <div class="cal-tip-val${mono}">${v ? esc(v) : '<span class="text-muted">\u2014</span>'}</div>
    </div>`;
  }).join('');
  return `<div class="cal-tip-head">${esc(e.title || '')}</div>${rows}`;
}
/* v150：非开庭事件（缴费截止 / 合同到期 / 重要节点…）也要有悬浮信息 ——
   用户口径：展示 客户 / 权利主体 / 被告 / 案号 / 标的额。
   开庭事件（type === 'court'）的信息已经定稿，保持 courtTipHTML 原样不动。 */
function calCaseTipHTML(c, ev) {
  const def = defendantNames(c);
  const rows = [
    ['客户',     c.cust || c.client || ''],
    ['权利主体', c.client || ''],
    ['被告',     def === '—' ? '' : def],
    ['案号',     normBlank(c.no) || ''],
    ['标的额',   c.amount || ''],
  ];
  const body = rows.map(([label, v]) =>
    `<div class="cal-tip-row">
      <div class="cal-tip-label">${label}</div>
      <div class="cal-tip-val${label === '案号' ? ' mono' : ''}">${v ? esc(v) : '<span class="text-muted">\u2014</span>'}</div>
    </div>`).join('');
  // v152：标题行改用「事件标题」（与开庭气泡同款）—— 悬停「上诉期届满 / 缴费截止」时，
  // 先看到自己在悬停哪个节点，案件名改由下面 5 行信息承载。
  const head = (ev && ev.title) ? ev.title : (c.title || '');
  return `<div class="cal-tip-head">${esc(head)}</div>${body}`;
}
/* v152：日历事件 → 案件。先按 caseId 精确匹配；匹配不到（种子里 caseId 悬空 / 缺失）就按事件文本里的
   案号反查案件 —— 「缴费截止」「上诉期届满」这类挂案件的时间无论 caseId 对不对，都能出悬浮信息并点进
   案件详情，不会退化成只有浏览器原生 title 的裸提示。 */
function calCaseOf(id, sub) {
  const list = (STATE && Array.isArray(STATE.cases)) ? STATE.cases : [];
  const c = id ? list.find(x => x && x.id === id) : null;
  if (c) return c;
  const m = String(sub || '').match(/（\d{4}）[^\s·]{2,}号/);
  return m ? (list.find(x => x && normBlank(x.no) === m[0]) || null) : null;
}
const regTip = e => {
  const k = 'ct' + (++tipSeq);
  if (e.type === 'court') { TIP_STORE.set(k, courtTipHTML(e)); return k; }
  // 非开庭：能挂到案件的就出案件信息；挂不到的（如合同到期）返回空 → 渲染时退回原生 title
  const c = calCaseOf(e.caseId, e.sub);
  if (c) { TIP_STORE.set(k, calCaseTipHTML(c, e)); return k; }
  return '';
};

/* v126：详情页「办案律师」悬浮 → 律师结算模式（样式对齐详情字段行：灰标签 + 深值）
   内容按案件 id 现算——TIP_STORE 会被日历渲染 clear()，不能预先寄存 */
function lawyerSettleTipHTML(c) {
  return '<div class="cal-tip-row wide"><div class="cal-tip-label">律师结算模式</div>' +
    '<div class="cal-tip-val">' + esc(lawCondText(c)) + '</div></div>';
}
let TIP_EL = null;
function ensureTipEl() {
  if (TIP_EL && document.body.contains(TIP_EL)) return TIP_EL;
  TIP_EL = document.createElement('div');
  TIP_EL.className = 'cal-tip';
  TIP_EL.setAttribute('role', 'tooltip');
  document.body.appendChild(TIP_EL);
  return TIP_EL;
}
function showTip(el) {
  let html = TIP_STORE.get(el.getAttribute('data-tip'));
  // 被告列：多被告时按案件 id 现算（日历渲染会 clear TIP_STORE，不能预先寄存）
  if (!html && el.getAttribute('data-tip-case')) {
    const cid = el.getAttribute('data-tip-case');
    const cc = (STATE && Array.isArray(STATE.cases)) ? STATE.cases.find(x => x.id === cid) : null;
    if (cc) html = defendantTipHTML(cc);
  }
  // 案件详情 · 办案律师 → 律师结算模式
  if (!html && el.getAttribute('data-tip-settle')) {
    const cid = el.getAttribute('data-tip-settle');
    const cS = (STATE && Array.isArray(STATE.cases)) ? STATE.cases.find(x => x.id === cid) : null;
    if (cS) html = lawyerSettleTipHTML(cS);
  }
  if (!html) return;
  const tip = ensureTipEl();
  tip.innerHTML = html;
  tip.classList.add('show');
  const r = el.getBoundingClientRect();
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  const vw = window.innerWidth || document.documentElement.clientWidth;
  let left = r.left + r.width / 2 - tw / 2;
  let top = r.top - th - 8;
  if (top < 8) top = r.bottom + 8;                       // 上方空间不足则翻到下方
  left = Math.max(8, Math.min(left, vw - tw - 8));
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
}
function hideTip() { if (TIP_EL) TIP_EL.classList.remove('show'); }

document.addEventListener('mouseover', e => {
  const t = e.target && e.target.closest && e.target.closest('[data-tip],[data-tip-case],[data-tip-settle]');
  if (t) showTip(t); else hideTip();
});
document.addEventListener('mouseout', e => {
  const t = e.target && e.target.closest && e.target.closest('[data-tip],[data-tip-case],[data-tip-settle]');
  if (!t) return;
  if (e.relatedTarget && t.contains(e.relatedTarget)) return;   // 仍在元素内部
  hideTip();
});
document.addEventListener('click', hideTip);
window.addEventListener('scroll', hideTip, true);
window.addEventListener('resize', hideTip);

function renderCalendar() {
  TIP_STORE.clear();                       // 重新渲染时丢弃旧提示内容
  const y = CAL.y, m = CAL.m;
  $('#cal-title').textContent = `${y} 年 ${m + 1} 月`;

  const first = new Date(y, m, 1);
  const startDow = first.getDay();               // 0=周日
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const todayStr = today();

  // 事件按日期分组
  const byDate = {};
  CAL_EVENTS.forEach(e => { (byDate[e.date] = byDate[e.date] || []).push(e); });

  const heads = ['日', '一', '二', '三', '四', '五', '六'];
  let html = heads.map(h => `<div class="cal-head">${h}</div>`).join('');

  const prevDays = new Date(y, m, 0).getDate();
  for (let i = 0; i < startDow; i++) {
    html += `<div class="cal-cell other"><div class="cal-day">${prevDays - startDow + i + 1}</div></div>`;
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${y}-${pad2(m + 1)}-${pad2(d)}`;
    const evs = byDate[ds] || [];
    html += `<div class="cal-cell${ds === todayStr ? ' today' : ''}">
      <div class="cal-day">${d}</div>
      ${evs.map(e => { const tk = regTip(e); return `<div class="cal-ev ${EV_TYPE_CLS[e.type]}" ${tk ? `data-tip="${tk}"` : `title="${esc(e.title)} · ${esc(e.sub)}"`} onclick="calEventDetail('${esc(e.title)}','${esc(e.sub)}','${esc(e.caseId || '')}')">${esc(e.title)}</div>`; }).join('')}
    </div>`;
  }
  const tail = (7 - ((startDow + daysInMonth) % 7)) % 7;
  for (let i = 1; i <= tail; i++) {
    html += `<div class="cal-cell other"><div class="cal-day">${i}</div></div>`;
  }
  $('#cal-grid').innerHTML = html;

  // KPI
  const soon = CAL_EVENTS.filter(e => { const dd = daysTo(e.date); return dd !== null && dd >= 0 && dd <= 30; }).sort((a, b) => a.date.localeCompare(b.date));
  const byType = t => CAL_EVENTS.filter(e => e.type === t).length;
  $('#cal-kpi').innerHTML =
    statCard('30 天内待办', soon.length + ' <span class="unit">项</span>', `最近 ${soon.length ? soon[0].date : '—'}`, soon.length > 5 ? 'down' : 'up') +
    statCard('开庭', byType('court') + ' <span class="unit">场</span>', '需提前准备材料', 'flat') +
    statCard('缴费截止', byType('pay') + ' <span class="unit">笔</span>', '逾期将视为撤诉', 'down') +
    statCard('合同到期', byType('contract') + ' <span class="unit">份</span>', '需提前续签', 'down') +
    statCard('其他节点', byType('other') + ' <span class="unit">项</span>', '举证/上诉/执行期限', 'flat');

  // 即将到期列表
  const colorMap = { court: '#5E6AD2', pay: '#B45309', contract: '#C4272B', other: '#057A55' };
  $('#cal-due').innerHTML = soon.map(e => {
    const dd = daysTo(e.date);
    const cls = dd <= 3 ? 'urgent' : (dd <= 10 ? 'soon' : '');
    const tk = regTip(e);
    return `<div class="due-item" ${tk ? `data-tip="${tk}"` : ''} onclick="calEventDetail('${esc(e.title)}','${esc(e.sub)}','${esc(e.caseId || '')}')">
      <div class="due-bar" style="background:${colorMap[e.type]}"></div>
      <div class="due-body">
        <div class="due-title">${esc(e.title)}</div>
        <div class="due-meta">${esc(e.date)} · ${esc(EV_TYPE_LABEL[e.type])} · ${esc(e.sub)}</div>
      </div>
      <div class="due-days ${cls}">${dd === 0 ? '今天' : dd + ' 天'}</div>
    </div>`;
  }).join('') || '<div class="empty" style="padding:32px;"><div class="empty-title">未来 30 天没有待办</div><div class="empty-desc">新增案件或合同到期日会自动出现在这里。</div></div>';
}
/* v150：日历事件点击 —— 能关联到案件就直接跳进案件详情；关联不到的（如合同到期）仍只弹提示。 */
function calEventDetail(title, sub, caseId) {
  const c = calCaseOf(caseId, sub);
  if (c) { openCase(c.id); return; }   // openCase 内部会 renderCaseDetail + showView('detail')
  toast(title, sub, 'info');
}

// ============================================================
// 15. 渲染：结算（客户 + 律师）
// ============================================================
function renderSettlementSplit() {
  // v146：分母为 0 时不再输出 NaN%（结算明细可能一笔都还没生成）
  const pct0 = (a, b) => (b > 0 ? Math.round(a / b * 100) : 0);
  // ---- 客户结算 ----
  const cs = CUST_BILLS;
  const sum = k => cs.reduce((a, x) => a + x[k], 0);
  const cCnt = s => cs.filter(x => x.prog === s).length;
  $('#settle-cust-kpi').innerHTML =
    statCard('累计应收', wan(sum('amt')), `${cs.length} 张账单`, 'flat') +
    statCard('已开票', wan(sum('inv')), '开票率 ' + pct0(sum('inv'), sum('amt')) + '%', 'up') +
    statCard('已回款', wan(sum('rec')), '回款率 ' + pct0(sum('rec'), sum('amt')) + '%', 'up') +
    statCard('待回款', wan(sum('amt') - sum('rec')), `${cs.filter(x => x.rec === 0).length} 张待收`, 'down') +
    statCard('本月账单', wan(cs.filter(x => sameMonth(x.m, curMonth())).reduce((a, x) => a + x.amt, 0)), '按发起结算日期归集', 'flat');

  $$('#settle-cust-filters .filter-pill').forEach(p => {
    const el = p.querySelector('.count'); if (!el) return;
    const k = p.dataset.status;
    el.textContent = k === '全部' ? cs.length : cCnt(k);
  });

  // v146：明细表加「勾选」列 + 案件单号列（caseId / 第几次结算），勾选后可发起账单
  // v152：列头由「来源案件」统一改为「案件单号」（用户口径：字段表达统一）
  const custRows = cs.map((s, i) => ({ s, i, k: billRowKey(s) }))
    .filter(o => CUST_BILL_FILTER.status === '全部' || o.s.prog === CUST_BILL_FILTER.status);
  $('#settle-cust-tbody').innerHTML = custRows.map(({ s, i, k }) => {
    const inBill = !!s.billNo;
    const on = billSelectable(s) && BILL_SEL.cust.has(k);
    return `
    <tr${inBill ? ' style="opacity:.7;"' : ''}>
      <td>${billCellHTML('cust', s, k, on)}</td>
      <td class="mono">${esc(s.m)}</td>
      <td style="color:var(--color-ink);">${esc(s.cust)}</td>
      <td class="mono" style="font-size:12px;">${esc(s.caseId || '—')}${s.nth ? `<span class="case-id">第 ${s.nth} 次结算</span>` : ''}</td>
      <td class="num">${money0(s.amt)}</td>
      <td class="num">${money0(s.inv)}</td>
      <td class="num" style="color:${s.rec > 0 ? 'var(--color-success)' : 'inherit'};">${money0(s.rec)}</td>
      <td><span class="pill ${s.cls}">${esc(s.prog)}</span>${inBill ? `<div class="case-id">${esc(s.billNo)}</div>` : ''}</td>
      <td class="mono">${esc(s.date)}</td>
      <td><button class="btn btn-ghost btn-sm" onclick="viewCustBill(${i})">查看</button></td>
    </tr>`;
  }).join('') || emptyRow(10, '没有匹配的客户结算数据',
    '在案件详情「待归档」阶段的「客户结算金额」旁点「发起结算」生成');

  // ---- 律师结算 ----
  const ls = LAW_BILLS;
  const lsum = k => ls.reduce((a, x) => a + x[k], 0);
  const paid = ls.filter(x => x.prog === '已打款').reduce((a, x) => a + x.amt, 0);
  const lCnt = s => ls.filter(x => x.prog === s).length;
  $('#settle-law-kpi').innerHTML =
    statCard('累计代理费', wan(lsum('amt')), `${ls.length} 张结算单`, 'flat') +
    statCard('已打款', wan(paid), '占比 ' + pct0(paid, lsum('amt')) + '%', 'up') +
    statCard('待提交', lCnt('待提交') + ' <span class="unit">张</span>', wan(ls.filter(x => x.prog === '待提交').reduce((a, x) => a + x.amt, 0)), 'flat') +
    statCard('已开票待付', lCnt('已开票') + ' <span class="unit">张</span>', wan(ls.filter(x => x.prog === '已开票').reduce((a, x) => a + x.amt, 0)), 'down') +
    statCard('合作律师', new Set(ls.map(x => x.lawyer)).size + ' <span class="unit">位</span>', `覆盖 ${new Set(ls.map(x => x.firm)).size} 家律所`, 'flat');

  $$('#settle-law-filters .filter-pill').forEach(p => {
    const el = p.querySelector('.count'); if (!el) return;
    const k = p.dataset.status;
    el.textContent = k === '全部' ? ls.length : lCnt(k);
  });

  const lawRows = ls.map((s, i) => ({ s, i, k: billRowKey(s) }))
    .filter(o => LAW_BILL_FILTER.status === '全部' || o.s.prog === LAW_BILL_FILTER.status);
  $('#settle-law-tbody').innerHTML = lawRows.map(({ s, i, k }) => {
    const inBill = !!s.billNo;
    const on = billSelectable(s) && BILL_SEL.law.has(k);
    return `
    <tr${inBill ? ' style="opacity:.7;"' : ''}>
      <td>${billCellHTML('law', s, k, on)}</td>
      <td class="mono">${esc(s.m)}</td>
      <td>
        <span class="case-name" style="font-size:13px;">${esc(s.lawyer)}</span>
        <span class="case-id">${esc(s.firm)}</span>
      </td>
      <td class="mono" style="font-size:12px;">${esc(s.caseId || '—')}${s.nth ? `<span class="case-id">第 ${s.nth} 次结算</span>` : ''}</td>
      <td class="num">${s.cases}</td>
      <td class="num">${money0(s.amt)}</td>
      <td><span class="pill ${s.cls}">${esc(s.prog)}</span>${inBill ? `<div class="case-id">${esc(s.billNo)}</div>` : ''}</td>
      <td class="mono">${esc(s.date)}</td>
      <td><button class="btn btn-ghost btn-sm" onclick="viewLawBill(${i})">查看</button></td>
    </tr>`;
  }).join('') || emptyRow(9, '没有匹配的律师结算数据',
    '在案件详情「待归档」阶段的「律师结算金额」旁点「发起结算」生成');

  // 同步 Tab 计数
  $('#settle-tab-cust-count').textContent = CUST_BILLS.length;
  $('#settle-tab-law-count').textContent = LAW_BILLS.length;
  // v146：账单区 + 发起账单按钮状态
  renderSettleBills('cust');
  renderSettleBills('law');
  syncBillSelUI('cust');
  syncBillSelUI('law');
}

/* ---------- v146：结算中心 —— 明细勾选 → 发起账单 ---------- */
/* 勾选按「稳定行键」记，不按下标；已入账单的行不允许再选 */
function toggleBillSel(side, key) {
  const set = BILL_SEL[side];
  if (!set || !key) return;
  const row = billListOf(side).find(x => x && x.rowKey === key);
  if (!row || row.billNo) return;
  if (!billFromCase(row)) {   // v147：无案件单号的历史数据不可入账单
    toast('该条结算数据没有案件单号', '结算中心的数据只能由案件详情「发起结算」生成', 'info');
    return;
  }
  set.has(key) ? set.delete(key) : set.add(key);
  renderSettlementSplit();
}
function toggleAllBillSel(side) {
  const set = BILL_SEL[side];
  if (!set) return;
  const all = billListOf(side);
  const free = all.filter(billSelectable);                                    // v147：只全选「有案件单号」的
  const locked = all.filter(s => s && !s.billNo && !billFromCase(s)).length;  // 无案件单号的历史数据
  const keys = free.map(billRowKey);
  if (!keys.length) {
    toast('没有可入账单的结算数据',
      locked ? `另有 ${locked} 条历史数据无案件单号，已锁死` : '请先在案件详情「发起结算」生成数据', 'info');
    return;
  }
  const everyOn = keys.every(k => set.has(k));
  if (everyOn) keys.forEach(k => set.delete(k));
  else keys.forEach(k => set.add(k));
  renderSettlementSplit();
  toast(everyOn ? '已取消全选' : '已勾选可发起账单的结算数据',
    `${set.size} 条` + (locked ? `（${locked} 条无案件单号已跳过）` : ''), 'info');
}
function syncBillSelUI(side) {
  const set = BILL_SEL[side];
  if (!set) return;
  const all = billListOf(side);
  // v147：只有「有案件单号且未入账单」的明细才是可勾选集合
  const freeKeys = all.filter(billSelectable).map(billRowKey);
  const locked = all.filter(s => s && !s.billNo && !billFromCase(s)).length;
  // 行被并入账单 / 数据被替换后键会失效 → 每次渲染都剔除，避免勾中不存在的行
  Array.from(set).forEach(k => { if (freeKeys.indexOf(k) < 0) set.delete(k); });
  const btn = document.getElementById('settle-' + side + '-bill-btn');
  if (btn) {
    btn.disabled = set.size === 0;
    btn.title = set.size
      ? `把勾选的 ${set.size} 条结算数据合并成一个账单`
      : (freeKeys.length
        ? '先勾选左侧「未入账单」的结算数据，再发起账单'
        : '暂无可入账单的结算数据（结算中心数据需先在案件详情「发起结算」生成）');
  }
  const selAll = document.getElementById('settle-' + side + '-selall');
  if (selAll) selAll.classList.toggle('checked', freeKeys.length > 0 && freeKeys.every(k => set.has(k)));
  const info = document.getElementById('settle-' + side + '-sel-info');
  if (info) info.textContent = set.size
    ? `已勾选 ${set.size} 条 · 合计 ${money0(all.filter(s => s && set.has(s.rowKey)).reduce((a, s) => a + (Number(s.amt) || 0), 0))}`
    : (locked
      ? `${locked} 条历史数据无案件单号，不可入账单`
      : '勾选多条结算数据后点「发起账单」合并结算');
}
function renderSettleBills(side) {
  const tb = document.getElementById('settle-' + side + '-bills-tbody');
  if (!tb) return;
  const list = BILLS.filter(b => b.side === side);
  // v148：账单号 / 账单日期 / 收付方 / 合并条数 / 合计 / 进度 / 操作（「预计打款日期」列已删）
  tb.innerHTML = list.map(b => `
    <tr>
      <td class="mono">${esc(b.no)}</td>
      <td class="mono">${esc(billDateOf(b))}</td>
      <td style="color:var(--color-ink);">${esc(b.payee || '—')}</td>
      <td class="num">${b.count}</td>
      <td class="num" style="color:var(--color-primary);font-weight:600;">${money0(b.amt)}</td>
      <td><span class="pill ${b.cls}">${esc(b.prog)}</span></td>
      <td><div style="display:flex;gap:6px;">
        <button class="btn btn-ghost btn-sm" onclick="viewBill('${side}','${esc(b.no)}')">查看</button>
        <button class="btn btn-ghost btn-sm" onclick="revokeBill('${side}','${esc(b.no)}')" title="撤销该账单：其中的结算数据退回「未入账单」，可重新勾选发起">撤销</button>
      </div></td>
    </tr>`).join('') || emptyRow(7, '还没有账单',
    '勾选上方「未入账单」的结算数据，点「发起账单」即可合并生成');
}
/* 发起账单：把勾选的多条结算数据合并成一条账单（用户 2026-09-14 口径） */
function createBill(side) {
  const set = BILL_SEL[side];
  if (!set) return;
  const all = billListOf(side);
  // 按台账顺序取「勾选中 + 有案件单号 + 未入账单」的行，顺序稳定（不受筛选 / 下标位移影响）
  const rows = all.filter(s => s && billSelectable(s) && set.has(s.rowKey));
  if (!rows.length) { toast('请先勾选结算数据', '勾选后即可合并成一个账单', 'info'); return; }
  const amt = rows.reduce((a, x) => a + (Number(x.amt) || 0), 0);
  const lines = rows.map(x => `<tr>
      <td class="mono">${esc(x.m)}</td>
      <td>${esc(side === 'cust' ? (x.cust || '—') : `${x.lawyer || '—'} / ${x.firm || '—'}`)}</td>
      <td class="mono" style="font-size:12px;">${esc(x.caseId || '—')}</td>
      <td class="num">${money0(x.amt)}</td>
    </tr>`).join('');
  formModal({
    title: '发起账单 · ' + BILL_SIDE_LABEL[side],
    wide: true, submitText: '确认发起账单',
    fields: [
      { type: 'custom', key: '__ro', span: 2, read: () => undefined, html:
        `<div class="form-hint" style="margin-bottom:8px;">将把下列 <b>${rows.length}</b> 条结算数据合并为一张账单，合计 <b>${money0(amt)}</b>。</div>`
        + '<div class="table-wrap"><table class="table"><thead><tr><th>发起结算日期</th><th>'
        + (side === 'cust' ? '客户' : '律师 / 律所') + '</th><th>案件单号</th><th class="num">' + (side === 'cust' ? '客户结算金额' : '律师结算金额') + '</th></tr></thead>'
        + `<tbody>${lines}</tbody></table></div>` },
      { key: 'no', label: '账单号', readonly: true, value: billNoFor(today()) },
      // v148：账单月份 → 账单日期（日期选择器，默认当天，可改）；改完账单号当场重算
      { key: 'date', label: '账单日期', type: 'date', value: today(), oninput: 'syncBillNoField()' },
      { key: 'note', label: '账单备注', span: 2, placeholder: '如：9 月合并结算' },
    ],
    onSubmit: d => {
      const prog = side === 'cust' ? '待发账单' : '待提交';
      const billDate = String(d.date || '').slice(0, 10) || today();
      const no = billNoFor(billDate);
      // ⚠️ 快照必须在改写之前取：撤销账单时要按它把每行的进度还原回去
      const items = rows.map(x => ({ m: x.m, caseId: x.caseId || '', nth: x.nth || 1, amt: Number(x.amt) || 0,
        prevProg: x.prog, prevCls: x.cls }));
      rows.forEach(x => { x.billNo = no; x.prog = prog; x.cls = 'pill-warning'; });
      BILLS.push({
        no, side, date: billDate,
        payee: side === 'cust' ? (rows[0].cust || '—') : `${rows[0].lawyer || '—'} / ${rows[0].firm || '—'}`,
        count: rows.length, amt, items,
        prog, cls: 'pill-warning', note: d.note || '', at: today(),
      });
      BILL_SEL[side] = new Set();
      save(); renderAll(); renderSettlementSplit();
      toast('账单已发起', `${no} · ${rows.length} 条合并 · 合计 ${money0(amt)}`, 'success');
    },
  });
}
function viewBill(side, no) {
  // v148：按账单号定位（原来按 side 过滤后的下标，撤销/新增会让下标错位）
  const b = BILLS.find(x => x.side === side && x.no === no);
  if (!b) return;
  const rows = (b.items || []).map((x, k) => `<tr>
      <td class="num">${k + 1}</td>
      <td class="mono">${esc(x.m)}</td>
      <td class="mono" style="font-size:12px;">${esc(x.caseId || '—')}</td>
      <td class="num">第 ${x.nth} 次</td>
      <td class="num">${money0(x.amt)}</td>
    </tr>`).join('');
  openModal({
    title: '账单详情 · ' + b.no, wide: true, okText: '关闭', cancelBtn: false,
    // 撤销入口（与账单列表行上的「撤销」同一个函数，同样二次确认）
    extraBtns: [{ label: '撤销该账单', cls: 'btn-danger', onClick: () => { closeModal(); revokeBill(side, b.no); } }],
    bodyHTML: `
      <div class="detail-list" style="margin-bottom:12px;">
        <div class="detail-row"><div class="detail-k">账单号</div><div class="detail-v mono">${esc(b.no)}</div></div>
        <div class="detail-row"><div class="detail-k">类型</div><div class="detail-v">${esc(BILL_SIDE_LABEL[side])}</div></div>
        <div class="detail-row"><div class="detail-k">账单日期</div><div class="detail-v mono">${esc(billDateOf(b))}</div></div>
        <div class="detail-row"><div class="detail-k">${side === 'cust' ? '客户' : '律师 / 律所'}</div><div class="detail-v">${esc(b.payee)}</div></div>
        <div class="detail-row"><div class="detail-k">合并条数</div><div class="detail-v">${b.count} 条</div></div>
        <div class="detail-row"><div class="detail-k">合计金额</div><div class="detail-v num-mono">${money0(b.amt)}</div></div>
        <div class="detail-row"><div class="detail-k">进度</div><div class="detail-v"><span class="pill ${b.cls}">${esc(b.prog)}</span></div></div>
        <div class="detail-row"><div class="detail-k">备注</div><div class="detail-v">${esc(b.note || '—')}</div></div>
      </div>
      <div class="lead-detail-section">账单明细（${b.count}）</div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th class="num">#</th><th>发起结算日期</th><th>案件单号</th><th class="num">结算次数</th><th class="num">金额</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`,
  });
}

/* ---------- v148：撤销账单（用户 2026-09-14 口径：生成后要有一个可撤销的入口） ----------
   撤销 = 删掉这张账单 + 把其中每条结算数据退回「未入账单」（billNo 清空、进度还原为入账单前的值），
   退回后即可重新勾选、重新发起账单。删除是不可逆动作，所以走二次确认弹窗。
   ⚠️ openModal 的确定按钮**不认** onOk 的返回值（只有 formModal 自己会关窗）
      → 处理完必须自己 closeModal()（v146 合并起诉弹窗踩过这个坑）。 */
function revokeBill(side, no) {
  const b = BILLS.find(x => x.side === side && x.no === no);
  if (!b) { toast('未找到该账单', String(no || ''), 'error'); return; }
  const back = billListOf(side).filter(x => x && x.billNo === b.no).length;
  openModal({
    title: '撤销账单 · ' + b.no, wide: true, okText: '确认撤销', okClass: 'btn-danger', cancelText: '取消',
    bodyHTML: `
      <div class="detail-list" style="margin-bottom:12px;">
        <div class="detail-row"><div class="detail-k">账单号</div><div class="detail-v mono">${esc(b.no)}</div></div>
        <div class="detail-row"><div class="detail-k">类型</div><div class="detail-v">${esc(BILL_SIDE_LABEL[side])}</div></div>
        <div class="detail-row"><div class="detail-k">账单日期</div><div class="detail-v mono">${esc(billDateOf(b))}</div></div>
        <div class="detail-row"><div class="detail-k">收付方</div><div class="detail-v">${esc(b.payee || '—')}</div></div>
        <div class="detail-row"><div class="detail-k">进度</div><div class="detail-v"><span class="pill ${b.cls}">${esc(b.prog)}</span></div></div>
      </div>
      <div class="form-hint">撤销后这张账单会被删除；其中 <b>${back}</b> 条结算数据（合计 <b>${money0(b.amt)}</b>）退回「未入账单」，可重新勾选发起。</div>`,
    onOk: () => doRevokeBill(b),
  });
}
function doRevokeBill(b) {
  if (!b) return;
  const all = billListOf(b.side);
  const rows = all.filter(x => x && x.billNo === b.no);
  const fb = b.side === 'cust' ? '待发账单' : '待提交';
  // items 与退回行的顺序一致（都是「按台账顺序取」）→ 第 i 条快照还原第 i 行入账单前的进度
  rows.forEach((x, i) => {
    const it = (b.items || [])[i] || {};
    x.billNo = '';
    x.prog = it.prevProg || fb;
    x.cls  = it.prevCls || 'pill-warning';
  });
  const i = BILLS.indexOf(b);
  if (i >= 0) BILLS.splice(i, 1);
  save(); renderAll(); renderSettlementSplit();
  toast('账单已撤销', `${b.no} · ${rows.length} 条结算数据已退回「未入账单」`, 'success');
  closeModal();
}

/* ---------- 结算中心 Tab 切换 ---------- */
function switchSettleTab(tab) {
  $$('#settle-tabs .settle-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  $$('#view-settlement .settle-block').forEach(b => b.classList.toggle('active', b.id === 'settle-block-' + tab));
  // v151：费用中心是本页第三个 tab，切进来时要现渲染（其余两个 tab 的数据由 renderSettlementSplit 统一渲染）
  if (tab === 'fee') renderFees();
}

/* ---------- v146：手工建单入口已下线 ----------
   用户 2026-09-14 明确「结算中心的数据只能由案件详情这 2 个按钮生成」，
   原 newSettlement / newCustBill / newLawBill / fillCustBillTextFromDoc 四个函数整体删除；
   结算中心改为「明细逐条列出 + 勾选 → 发起账单」（见 renderSettlementSplit / createBill）。 */

/* ---------- 详情弹窗 ---------- */
function detailModal(title, pairs) {
  openModal({
    title, wide: true, okText: '关闭',
    bodyHTML: '<div class="detail-list">' + pairs.map(([k, v]) => `
      <div class="detail-row">
        <div class="detail-k">${esc(k)}</div>
        <div class="detail-v">${v === '' || v == null ? '<span class="ph">—</span>' : esc(v)}</div>
      </div>`).join('') + '</div>',
  });
}

/* ---------- 证物台账：案件 → 证物 / 公证书（列表与「查看」弹窗共用同一口径，避免两处分叉） ----------
   注意：证物的 caseId 有两种形态 —— ① 案件单号（演示种子）；② 公证条目号 n.id（「出证」自动入库时写的
   是条目号，见 toEvidenceFromNotary）。取值口必须两种 key 都认，否则第②类证物的店铺名 / 公证书会永远空。 */
function evNotaryItemOf(key) { return NOTARY_ITEMS.find(n => n && (n.caseId === key || n.id === key)) || null; }
// key → 案件：先当案件单号找；找不到就把 key 当公证条目号，再经条目的 caseId / 案件的 notaryId 反查
function evCaseOfKey(key) {
  const direct = STATE.cases.find(x => x && x.id === key);
  if (direct) return direct;
  const n = evNotaryItemOf(key);
  return (n ? STATE.cases.find(x => x && (x.notaryId === n.id || x.id === n.caseId)) : null) || null;
}
// 公证书：查找链路与案件详情「公证书」一致（案件 notaryId → key → 案件 id → 公证条目号）
function evDocOf(key) {
  const c = evCaseOfKey(key), n = evNotaryItemOf(key);
  return NOTARY_DOCS.find(d => d && (
      (c && c.notaryId && d.caseId === c.notaryId) || d.caseId === key ||
      (c && d.caseId === c.id) || (n && d.caseId === n.id))) || null;
}
// 店铺名：与列表同源（先取公证条目，其次案件自身的平台/店铺解析）
function evShopOf(key, c) {
  const n = evNotaryItemOf(key);
  const cc = c || evCaseOfKey(key);
  return (n && n.shop) || (cc ? shopOf(cc) : '') || '—';
}
// 证物是否属于某案件：三种挂载方式都算（案件单号 / 案件的 notaryId / 案件的公证条目号）
function evBelongsToCase(e, c) {
  if (!e || !c) return false;
  const ids = [c.id];
  if (c.notaryId) ids.push(c.notaryId);
  const n = evNotaryItemOf(c.id);
  if (n) ids.push(n.id);
  return ids.indexOf(e.caseId) >= 0;
}
// 案号：立案前的占位值（'—  立案前'）不作为案号展示
function evCaseNoOf(c) {
  const no = c ? String(c.no || '').trim() : '';
  return (no && no.indexOf('立案前') < 0) ? no : '—';
}
// 查看：该案件的证物 + 公证书（该案有几件证物就列几行；同一店铺 2 件即 2 行，不去重合并）
//   v130：平台 / 店铺名 / 案号 / 案件进展 / 备注都是「案件级」信息，逐行列一遍纯属噪音 ——
//         移到表格上方按字段排列；表格只留「公证书 + 证物本身」的 5 列。
function viewCaseEvidence(key) {
  // key 可以是「案件单号」「证物编号 / 证物 id」或「公证条目号」——先统一归到案件
  const ev0 = EVIDENCES.find(x => x && (x.id === key || x.code === key));
  const raw = ev0 ? ev0.caseId : key;
  const c = evCaseOfKey(raw);
  const caseKey = c ? c.id : raw;
  const doc = evDocOf(caseKey);
  const evs = c ? EVIDENCES.filter(x => x && evBelongsToCase(x, c)) : EVIDENCES.filter(x => x && x.caseId === raw);
  const st = c ? stageOf(c.status) : null;
  /* v130：备注是案件级字段，与「编辑证物」弹窗写的是同一个 e.source（不另起 remark 键）。
     该案证物备注去重后全部列出（单值直出、多值用「 / 」并列）——
     既不像「取其中一件」那样静默丢信息，也不像「不一致就留空」那样假装这个案子没有备注 */
  const srcVals = Array.from(new Set(evs
    .map(e => (e.source && e.source !== '—') ? String(e.source) : '')
    .filter(Boolean)));
  const remark = srcVals.length ? esc(srcVals.join(' / ')) : '<span class="text-muted">—</span>';
  // v133：补「办案律师」（案件级信息，与平台 / 店铺名 / 案号等同属表格上方的字段块）
  //   口径复用 lawyerOf(c)：优先阶段表单写入的 c.lawyer，否则取 castOf(c).lawyer；待匹配阶段返回 '—'
  const lawyerVal = (() => {
    if (!c) return '<span class="text-muted">—</span>';
    const lw = lawyerOf(c);
    // v150：未匹配律师不再显示「待匹配」徽标（用户口径：空就是横杠，不要说明性文字）
    if (!lw || lw === '—') return '<span class="text-muted">—</span>';
    const fm = (castOf(c) || {}).firm || '';
    return `<b>${esc(lw)}</b>${fm ? ` · ${esc(fm)}` : ''}`;
  })();
  const infoBlock = `
      <div class="field-list cols-2" style="margin-bottom:12px;">
        ${fieldRow('平台', esc(c ? platformOf(c) : '—'))}
        ${fieldRow('店铺名', esc(evShopOf(caseKey, c)))}
        ${fieldRow('案号', `<span class="mono">${esc(evCaseNoOf(c))}</span>`)}
        ${fieldRow('案件进展', st ? `<span class="pill ${st.cls}">${esc(c.status)}</span>` : '<span class="text-muted">—</span>')}
        ${fieldRow('办案律师', lawyerVal)}
        ${fieldRow('备注', remark)}
      </div>`;
  const HEAD = ['公证书编号', '公证书状态', '证物编号', '货架号', '证物状态'];
  const rows = evs.map(e => `
      <tr>
        <td class="mono">${doc ? esc(doc.no) : '<span class="text-muted">—</span>'}</td>
        <td>${doc ? `<span class="pill ${doc.statusCls || 'pill-neutral'}">${esc(doc.status)}</span>` : '<span class="text-muted">—</span>'}</td>
        <td class="mono">${esc(e.code || e.id || '—')}</td>
        <td class="mono">${esc(e.loc || '—')}</td>
        <td><span class="pill ${e.statusCls || EV_STATUS_CLS[e.status] || 'pill-neutral'}">${esc(e.status || '—')}</span></td>
      </tr>`).join('');
  openModal({
    title: '证物与公证书 · ' + caseKey, xwide: true, okText: '关闭',
    bodyHTML: `
      ${infoBlock}
      <div class="table-wrap" style="overflow:auto;">
        <table class="table ev-case-tbl">
          <thead><tr>${HEAD.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
          <tbody>${rows || emptyRow(5, '该案件暂无证物', '先在公证阶段完成取证，证物会出现在这里')}</tbody>
        </table>
      </div>`,
  });
}



function viewCustBill(i) {
  const s = CUST_BILLS[i];
  if (!s) return;
  const rate = s.amt ? Math.round(s.rec / s.amt * 100) : 0;
  detailModal('客户账单 · ' + s.m, [
    ['发起结算日期', s.m], ['客户', s.cust], ['客户结算金额', money0(s.amt)],
    ['已开票', money0(s.inv)], ['已回款', money0(s.rec)],
    ['回款率', rate + '%'], ['结算进度', s.prog], ['回款日期', s.date || '—'],
    ['账单', s.text || '—'],
  ]);
}

function viewLawBill(i) {
  const s = LAW_BILLS[i];
  if (!s) return;
  detailModal('律师结算单 · ' + s.m, [
    ['发起结算日期', s.m], ['律师', s.lawyer], ['所属律所', s.firm],
    ['结算案件数', s.cases + ' 件'], ['代理费', money0(s.amt)],
    ['结算进展', s.prog], ['打款日期', s.date || '—'],
  ]);
}

// 侧边栏数字联动
function updateNavBadges() {
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  set('#nav-badge-cust', STATE.customers.length);
  set('#nav-badge-leads', LEADS.filter(l => l.progress !== '已转案件').length);
  set('#nav-badge-notary', NOTARY_ITEMS.filter(n => n.stage !== '已归档').length);
  set('#nav-badge-evidence', EVIDENCES.length);
  set('#nav-badge-cases', STATE.cases.length);
  /* v151：侧边栏「费用中心」入口已删除 → 徽标改挂在结算中心的第三个 tab 上（显示费用总条数） */
  set('#settle-tab-fee-count', (STATE.fees || []).length);
  set('#nav-badge-cal', CAL_EVENTS.filter(e => { const d = daysTo(e.date); return d !== null && d >= 0 && d <= 30; }).length);
}


// ============================================================
// 16. 数据迁移：导出 / 导入 / 设置页
// ============================================================
function exportData() {
  const payload = {
    __app: 'ip-case-system',
    __version: 2,
    __exportedAt: new Date().toISOString(),
    state: STATE,
    leads: LEADS,
    notary: NOTARY_ITEMS,
    evidences: EVIDENCES,
    notaryDocs: NOTARY_DOCS,
    calEvents: CAL_EVENTS,
    custBills: CUST_BILLS,
    lawBills: LAW_BILLS,
  };
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '知产案件系统_演示数据_' + today() + '.json';
  a.click();
  if (URL.revokeObjectURL) setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('演示数据已导出', `${STATE.cases.length} 个案件 · ${STATE.customers.length} 家客户 · ${NOTARY_ITEMS.length} 件公证`, 'success');
}

function importData(evt) {
  const file = evt.target.files && evt.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || !data.state || !Array.isArray(data.state.cases)) throw new Error('文件格式不正确');
      applyImport(data);
      toast('数据导入成功', `${data.state.cases.length} 个案件已恢复`, 'success');
    } catch (err) {
      toast('导入失败', err.message, 'error');
    }
    evt.target.value = '';
  };
  reader.onerror = () => { toast('读取文件失败', '', 'error'); evt.target.value = ''; };
  reader.readAsText(file, 'utf-8');
}

function applyImport(data) {
  if (data.state) {
    STATE = data.state;
    STATE.cases.forEach((c, i) => { if (!c.defendants) Object.assign(c, caseExtras(c)); if (!c.ov) c.ov = {}; if (!c.log) c.log = caseLog(c); Object.assign(c, operatorStyle(c.operator)); if (!c.lawyerSettleMode) seedLawyerSettle(c, i);
      // v93：老档案里多笔付款记录但没填付款类型 → 按「分期付款」补齐，避免与新上限规则（一次性付款只允许 1 条）冲突
      if (!c.payType && Array.isArray(c.payments) && c.payments.length > 1) c.payType = '分期付款';
      // v124：付款记录统一字段 —— 老档案缺「收款人」→ 权利人回落（已填值不覆盖）
      if (Array.isArray(c.payments)) c.payments.forEach(p => { if (p && !p.payee) { const h = holderName(c); if (h && h !== '—') p.payee = h; } }); });
    STATE.customers.forEach(c => {
      if (!c.contacts) Object.assign(c, customerExtras());
      if (!Array.isArray(c.holders)) c.holders = selfHolder(c);
      if (typeof c.contractText !== 'string') c.contractText = customerExtras().contractText || '';
    });
  }
  restoreExtras(data);
  save();
  autoFlowCases();
  renderAll();
  renderSettings();
}

function copyFileHint() {
  const text = '需要带走的文件：\n1. ip-case-system.html（主程序，自包含）\n2. DESIGN.md（设计规范）\n3. 知产案件系统_演示数据_' + today() + '.json（可选，演示数据）';
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(
      () => toast('文件清单已复制', '粘贴到微信/备忘录即可', 'success'),
      () => toast(text, '请手动记录', 'info')
    );
  } else {
    toast('请手动记录文件清单', text.replace(/\n/g, ' | '), 'info');
  }
}

function renderSettings() {
  const box = $('#settings-kpi');
  if (!box) return;
  renderDocTemplates();
  box.innerHTML =
    statCard('案件', STATE.cases.length + ' <span class="unit">件</span>', `已归档 ${STATE.cases.filter(c => c.status === '已归档').length}`, 'flat') +
    statCard('客户', STATE.customers.length + ' <span class="unit">家</span>', `合作中 ${STATE.customers.filter(c => c.status === '合作中').length}`, 'flat') +
    statCard('线索', LEADS.length + ' <span class="unit">条</span>', `待推送 ${LEADS.filter(l => l.progress === '待推送').length} · 已转案件 ${LEADS.filter(l => l.progress === '已转案件').length}`, 'flat') +
    statCard('公证', NOTARY_ITEMS.length + ' <span class="unit">件</span>', `在办 ${NOTARY_ITEMS.filter(n => n.stage !== '已归档').length}`, 'flat') +
    statCard('证物 / 公证书', EVIDENCES.length + ' / ' + NOTARY_DOCS.length, `日历事件 ${CAL_EVENTS.length}`, 'flat');
  const sz = $('#storage-size');
  if (sz) {
    try {
      const raw = localStorage.getItem(SK) || '';
      sz.textContent = (new Blob([raw]).size / 1024).toFixed(1) + ' KB';
    } catch (e) { sz.textContent = '—'; }
  }
}

/* ---------- 文书模版库（设置页维护） ---------- */
function renderDocTemplates() {
  const box = document.getElementById('doc-template-list');
  if (!box) return;
  if (!DOC_TEMPLATES.length) {
    box.innerHTML = '<div class="form-hint">模版库为空 · 批量导出诉状初稿时会引导上传</div>';
    return;
  }
  box.innerHTML = DOC_TEMPLATES.map(t => `
    <div class="file" style="padding:10px 0;">
      <div class="file-icon">${t.type === '起诉状' ? '诉' : '文'}</div>
      <div class="file-info">
        <div class="file-name" style="font-size:13px;">${esc(t.name)}${t.id === 'T-001' ? ' <span class="tag tag-blue">内置</span>' : ''}</div>
        <div class="file-meta">${esc(t.type)} · ${t.size || '—'} · ${esc(t.date || '—')}</div>
      </div>
      <div class="file-actions">
        <button class="btn btn-ghost btn-sm" onclick="previewDocTemplate('${t.id}')">预览</button>
        <button class="btn btn-danger btn-sm" onclick="deleteDocTemplate('${t.id}')">删除</button>
      </div>
    </div>`).join('');
}
function uploadDocTemplate() {
  const input = document.getElementById('doc-template-file');
  if (input) input.click();
  else toast('请在「设置」页上传模版', '系统 → 设置 → 文书模版库', 'info');
}
// fromDraftModal=true 时来自导出引导弹窗，读完后自动把文件名回显到弹窗
function onDocTemplateFile(ev, fromDraftModal) {
  const file = ev && ev.target && ev.target.files && ev.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let text = String(reader.result || '');
    // 二进制（如 .docx）读出来是乱码：登记文件名，内容回退内置模版结构
    const bad = (text.match(/\uFFFD/g) || []).length;
    let note = '';
    if (!text.trim() || bad > text.length * 0.02) {
      text = BUILTIN_DRAFT_TEMPLATE; note = '（二进制文件，已按内置结构登记）';
    }
    DOC_TEMPLATES.unshift({
      id: 'T-' + Date.now(), type: '起诉状', name: file.name,
      size: (new Blob([file]).size / 1024).toFixed(1) + ' KB', date: today(), content: text,
    });
    save(); renderDocTemplates();
    const tip = `已入库 · ${file.name}${note}`;
    if (fromDraftModal) { const el = document.getElementById('draft-tpl-name'); if (el) el.textContent = file.name; }
    toast('模版已上传', tip);
  };
  reader.onerror = () => toast('读取文件失败', '', 'error');
  reader.readAsText(file, 'utf-8');
}
function deleteDocTemplate(id) {
  const i = DOC_TEMPLATES.findIndex(t => t.id === id);
  if (i < 0) return;
  const name = DOC_TEMPLATES[i].name;
  DOC_TEMPLATES.splice(i, 1);
  save(); renderDocTemplates();
  toast('模版已删除', name, 'info');
}
function previewDocTemplate(id) {
  const t = DOC_TEMPLATES.find(x => x.id === id); if (!t) return;
  openModal({
    title: '模版预览 · ' + t.name, wide: true,
    okText: '关闭', cancelBtn: false,
    bodyHTML: `<pre style="white-space:pre-wrap;font:400 13px/1.8 var(--font-text);color:var(--color-ink);margin:0;">${esc(t.content)}</pre>`,
    onSubmit: () => true,
  });
}


// ============================================================
// 8.5 案件详情 · 动态渲染
//   设计约束见 DESIGN.md v1.5：凡随案件切换而变化的字段，一律由 JS 输出
// ============================================================

/* 案件「演员表」：律师 / 律所 / 公证处 / 法官 / 法庭
   按案件 id 确定性派生 → 概览、时间轴、公证、诉讼各 Tab 显示同一批人，不会自相矛盾 */
function castOf(c) {
  const rnd = rngOf(seedOf((c.id || c.title || 'IP') + '#cast'));
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  return {
    lawyer: pick(['李建国', '王思远', '张明远', '陈立川', '刘文君']),
    firm:   pick(['广东知恒律所', '北京盈科（广州）律所', '上海锦天城律所', '浙江天册律所']),
    office: pick(['广东省广州市南方公证处', '广东省深圳市深圳公证处', '浙江省杭州市东方公证处', '北京市方圆公证处']),
    judge:  pick(['张法官', '刘法官', '陈法官']),
    hall:   '第 ' + int(1, 12) + ' 法庭',
  };
}

/* 取时间轴上某个节点的完成日期；未发生返回 '—' */
function logTime(c, title) {
  const t = (c.log || []).find(x => x.title === title);
  return (t && t.time && t.time !== '—') ? t.time : '—';
}
function plusDays(dateStr, n) {
  if (!dateStr || dateStr === '—') return '—';
  const d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00');
  if (isNaN(d.getTime())) return '—';
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const fieldRow = (label, value, ov, extraAttr) =>
  `<div class="field-row"><div class="field-label">${label}</div>` +
  `<div class="field-value"${ov ? ` data-ov="${ov}"` : ''}${extraAttr ? ' ' + extraAttr : ''}>${value}</div></div>`;

/* ---------- 概览：案件摘要 / 关键金额 / 团队 ---------- */
function renderOverview(c) {
  const st = stageOf(c.status);
  const { lawyer, firm } = castOf(c);
  const main = (c.defendants && c.defendants[0]) || null;
  const amt = numOf(c.amount);
  const exps = allExpensesOf(c);
  const spent = exps.reduce((s, e) => s + Number(e.amt || 0), 0);
  const paid  = exps.reduce((s, e) => s + (expStatusOf(c, e) === '已支付' ? Number(e.amt || 0) : 0), 0);
  const back  = numOf(c.ov && c.ov.paidBack);

  const hearing = logTime(c, '开庭');
  const dd = daysTo(String(hearing).slice(0, 10));
  const ddTag = (hearing === '—' || dd === null) ? ''
    : (dd > 0 ? `<span class="tag tag-orange" style="margin-left:6px;">${dd} 天后</span>`
              : `<span class="tag tag-red" style="margin-left:6px;">已开庭</span>`);
  // v150：原来空值兜「（待匹配法院）/（待立案分配）」这类说明文字 —— 用户口径：空就是横杠
  const court = normBlank(c.court) || '—';
  const no = normBlank(c.no) || '—';

  const sum = $('#ov-summary');
  if (sum) sum.innerHTML =
      fieldRow('客户', esc(c.client || '—'), 'client')
    + fieldRow('被告', main ? esc(main.name) : '—')
    + fieldRow('案件进展', `<span class="pill ${st.cls}">${esc(c.status)}</span>`)
    + fieldRow('下一动作', st.next
        ? `<span style="color:var(--color-primary);font-weight:500;">${esc(st.next)}</span>`
        : (st.cta ? `<span style="color:var(--color-primary);font-weight:500;">${esc(st.cta)}</span>`
                  : '<span class="text-muted">已结案</span>'))
    + fieldRow('标的额', `<span class="num-mono">${money(amt)}</span>`)
    + fieldRow('开庭日期', `<span class="mono">${esc(hearing)}</span>${ddTag}`)
    + fieldRow('案件类型', `<span class="tag ${c.typeTag || 'tag-blue'}">${esc(c.type || '—')}</span>`, 'caseType')
    + fieldRow('立案法院', esc(court), 'court')
    + fieldRow('案件单号', `<span class="mono">${esc(caseNoOf(c))}</span>`)
    + fieldRow('案号', `<span class="mono">${esc(no)}</span>`);

  const { opInitial, opColor } = operatorStyle(c.operator);
  const clientName = c.client || '—';
  const cInitial = String(clientName).replace(/[^\u4e00-\u9fa5]/g, '').charAt(1) || '客';
  const tb = $('#ov-team');
  if (tb) tb.innerHTML = [
    { av: opInitial, color: opColor, name: esc(c.operator || '—'), sub: '运营' },
    { av: String(lawyer).charAt(0), color: 'linear-gradient(135deg,#2563EB 0%,#7C3AED 100%)', name: `${esc(lawyer)} 律师`, sub: esc(firm) },
    { av: cInitial,    color: 'linear-gradient(135deg,#057A55 0%,#2563EB 100%)', name: esc(clientName), sub: '权利人 · 客户对接' },
  ].map(p => `<div class="team-cell">
      <div class="avatar" style="width:28px;height:28px;font-size:11px;background:${p.color};">${esc(p.av)}</div>
      <div style="min-width:0;">
        <div class="team-name">${p.name}</div>
        <div class="team-sub">${p.sub}</div>
      </div>
    </div>`).join('');
}

/* ---------- 文件管理 Tab：案件全流程文书字段清单（v63：无标题、无分组标题，字段平铺 5 列 + 勾选批量下载） ---------- */
let FILES_ITEMS = [];   // 本次渲染出的可下载文书 [{ key, label, stage, file }]
let FILES_SEL = new Set();   // 已勾选的文书 key

function renderCaseFilesTab(c) {
  const root = $('#files-list-root');
  FILES_ITEMS = [];
  FILES_SEL = new Set();
  if (!root) return;
  // v146 合并起诉：新案件按店铺分组，每个源店铺一张小卡片（字段整块原样搬）
  const srcs = mergedSourcesOf(c);
  if (srcs) {
    root.innerHTML = srcs.map((s, i) => `
      <div class="merge-shop-card">
        <div class="merge-shop-card-head">
          <span class="tag tag-blue">${esc(mergeShopLabel(i))}</span>
          <span>${esc(shopOf(s) || '（无店铺名）')}</span>
          <span class="src">来源案件 ${esc(caseNoOf(s))}</span>
        </div>
        ${filesGridHTML(s)}
      </div>`).join('');
    syncFilesSelUI();
    return;
  }
  root.innerHTML = filesGridHTML(c);
  syncFilesSelUI();
}

/* 单个案件的文书字段网格（合并后的案件对每个源案件各调一次，口径与原来完全一致） */
function filesGridHTML(c) {
  const n = leadNotaryOf(c) || {};
  const doc = NOTARY_DOCS.find(d => (c.notaryId && d.caseId === c.notaryId) || d.caseId === c.id || (n && d.caseId === n.id)) || null;
  const discCount = (c.disclosures || []).length;
  const payCount = (c.payments || []).length;
  // v64：缴费凭证 = 费用明细里每笔已缴费用的 proof 份数
  const payProofCount = (c.expenses || []).filter(e => e.proof).length;
  const hasDraft = !!draftTextOf(c);

  /* v62：每个文书字段对应的可下载文件。清洗规则：
     ① 空值 / 「—」等占位符 / 「已确认 · 待确认」类状态值 → 不是文件，不给勾选框；
     ② 没有扩展名的（手填/批量上传字段里可能存的是一段描述或正文而非文件名）→ 用「字段名.doc」兜底，
        避免把一整篇正文当成文件名。 */
  const NOT_A_FILE = ['—', '-', '--', '待确认', '已确认', '未确认', '已识别待确认', 'OCR 已识别待确认', '已生成'];
  const cleanFileName = (label, raw) => {
    const s = String(raw == null ? '' : raw).trim();
    if (!s || NOT_A_FILE.indexOf(s) >= 0) return '';
    return /\.(pdf|docx?|xls[xm]?|txt|jpe?g|png|zip|rar|7z)$/i.test(s) ? s : label + '.doc';
  };
  const FILE_OF = {
    '公证书': doc && doc.file,
    '披露文件': discCount ? '披露文件清单.doc' : '',
    '起诉状': hasDraft ? '起诉状-' + draftDefName(c) + '.doc' : '',
    '立案受理通知书': c.acceptNotice,
    '缴费凭证': payProofCount ? '缴费凭证清单.doc' : '',
    '送达文书': c.serviceDoc,
    '披露数据附件': n.disclose || c.disclose,
    '判决书': c.judgeDoc,
    // v151：用户口径 —— 文件管理里的「诉讼退费凭证」删除（别再往回加）
    '二审文书': c.secondDoc,
    '二审送达文书': c.secondServiceDoc,
    '二审判决书': c.secondJudgeDoc,
    '执行立案截图': c.execFilingShot || c.execShot,
    // v64：取 execFormalDoc（「强制执行中」阶段的执行文书），与案件详情卡 8019 行一致；
    //      旧代码取的 c.execDoc 是「执行申请材料」，两者不是同一个文书。
    '执行文书': c.execFormalDoc,
    '结案文书': c.closeDoc,
    '付款凭证': payCount ? '付款凭证清单.doc' : ''
  };
  Object.keys(FILE_OF).forEach(k => { FILE_OF[k] = cleanFileName(k, FILE_OF[k]); });

  const groups = [
    {
      title: '线索与公证',
      items: [
        { label: '公证书', value: doc && doc.file && doc.file !== '—' ? `<span class="link-mono">${esc(doc.file)}</span>` : (doc ? esc(doc.status || '已出证') : '—') },
        { label: '披露文件', value: discCount ? `${discCount} 份` : '—' }
      ]
    },
    {
      title: '一审',
      items: [
        { label: '起诉状', value: hasDraft ? '已生成 · 点击预览' : '—', action: hasDraft ? 'previewDraft()' : null },
        { label: '立案受理通知书', value: c.acceptNotice ? `<span class="link-mono">${esc(c.acceptNotice)}</span>` : '—' },
        { label: '缴费凭证', value: payProofCount ? `<span class="link-mono">${esc(FILE_OF['缴费凭证'])}</span>` : '—' },
        { label: '送达文书', value: c.serviceDoc ? `<span class="link-mono">${esc(c.serviceDoc)}</span>` : '—' },
        { label: '披露数据附件', value: (n.disclose || c.disclose) ? `<span class="link-mono">${esc(n.disclose || c.disclose)}</span>` : '—' }
      ]
    },
    {
      title: '判决',
      items: [
        // v151：用户口径 —— 本组原有「诉讼退费凭证」已删除
        { label: '判决书', value: c.judgeDoc ? `<span class="link-mono">${esc(c.judgeDoc)}</span>` : '—' }
      ]
    },
    {
      title: '二审',
      items: [
        { label: '二审文书', value: c.secondDoc ? `<span class="link-mono">${esc(c.secondDoc)}</span>` : '—' },
        { label: '二审送达文书', value: c.secondServiceDoc ? `<span class="link-mono">${esc(c.secondServiceDoc)}</span>` : '—' },
        { label: '二审判决书', value: c.secondJudgeDoc ? `<span class="link-mono">${esc(c.secondJudgeDoc)}</span>` : '—' }
      ]
    },
    {
      title: '执行',
      items: [
        { label: '执行立案截图', value: c.execFilingShot ? `<span class="link-mono">${esc(c.execFilingShot)}</span>` : (c.execShot ? `<span class="link-mono">${esc(c.execShot)}</span>` : '—') },
        { label: '执行文书', value: c.execFormalDoc ? `<span class="link-mono">${esc(c.execFormalDoc)}</span>` : '—' }
      ]
    },
    {
      title: '结案',
      items: [
        { label: '结案文书', value: c.closeDoc ? `<span class="link-mono">${esc(c.closeDoc)}</span>` : '—' },
        { label: '付款凭证', value: payCount ? `${payCount} 笔` : '—' }
      ]
    }
  ];

  /* v63：6 个分组小标题与「文件清单」标题都去掉，14 个字段按流程顺序平铺成 5 列网格；
     分组信息仍留在 FILES_ITEMS[].stage（ZIP 正文里的「所处阶段」用它），只是页面上不再显示标题。
     有文件的字段可勾选，无文件的字段用 .files-no-box 占位对齐。 */
  const cells = [];
  groups.forEach(g => g.items.forEach(item => {
    const file = FILE_OF[item.label] || '';
    const selectable = !!file;
    const key = selectable && FILES_ITEMS.some(x => x.key === item.label)
      ? item.label + '#' + FILES_ITEMS.length : item.label;
    if (selectable) FILES_ITEMS.push({ key, label: item.label, stage: g.title, file });
    cells.push(`<div class="files-item${selectable ? '' : ' is-empty'}" data-fkey="${key}"${selectable ? ` onclick="toggleFilesSel('${key}')"` : ''}>
      ${selectable ? '<span class="checkbox"></span>' : '<span class="files-no-box"></span>'}
      <div class="files-text">
        <div class="files-label">${esc(item.label)}</div>
        <div class="files-value">${item.action ? `<a href="javascript:${item.action}" onclick="event.stopPropagation()">${item.value}</a>` : item.value}</div>
      </div>
    </div>`);
  }));

  return cells.length
    ? `<div class="grid-5">${cells.join('')}</div>`
    : '<div class="empty" style="padding:32px;"><div class="empty-title">暂无文书</div></div>';
}

/* ---------- 文件管理 Tab：勾选 / 全选 / 批量下载 ---------- */
function toggleFilesSel(key) {
  if (FILES_SEL.has(key)) FILES_SEL.delete(key); else FILES_SEL.add(key);
  syncFilesSelUI();
}

function toggleFilesSelAll() {
  const keys = FILES_ITEMS.map(i => i.key);
  if (!keys.length) { toast('本案暂无可下载文件', '文书尚未生成或未上传', 'info'); return; }
  const all = keys.every(k => FILES_SEL.has(k));
  keys.forEach(k => all ? FILES_SEL.delete(k) : FILES_SEL.add(k));
  syncFilesSelUI();
  toast(all ? '已取消全选' : '已全选', keys.length + ' 个文件', 'info');
}

function syncFilesSelUI() {
  const keys = FILES_ITEMS.map(i => i.key);
  $$('#files-list-root .files-item').forEach(el => {
    const on = FILES_SEL.has(el.dataset.fkey);
    el.classList.toggle('selected', on);
    const cb = el.querySelector('.checkbox');
    if (cb) cb.classList.toggle('checked', on);
  });
  const selAll = $('#files-sel-all');
  if (selAll) selAll.classList.toggle('checked', keys.length > 0 && keys.every(k => FILES_SEL.has(k)));
  setTxt('#files-sel-info', FILES_SEL.size
    ? '已选 ' + FILES_SEL.size + ' / ' + keys.length
    : '共 ' + keys.length + ' 个文件');
}

/* 单个文书的演示正文（打包进 ZIP 时每个文件一份） */
function caseFileDocContent(c, it) {
  return it.label + '\n\n'
    + '案件单号：' + (c ? caseNoOf(c) : '—') + '\n'
    + '案件名称：' + ((c && c.title) || '—') + '\n'
    + '权利人：' + ((c && holderName(c)) || '—') + '\n'
    + '所处阶段：' + it.stage + '\n'
    + '文件名：' + it.file + '\n'
    + '生成日期：' + today() + '\n\n'
    + '本文件由知产案件管理系统 Demo 生成，内容为演示数据。';
}

/* 批量下载所选文书：按案件单号分文件夹打包 ZIP */
function downloadCaseFilesBatch() {
  const c = curCase();
  const items = FILES_ITEMS.filter(i => FILES_SEL.has(i.key));
  if (!items.length) { toast('请先勾选需要下载的文件', '可单选、多选，或点右上角「全选」', 'info'); return; }
  const enc = new TextEncoder();
  const dir = (c && (c.no || c.id)) || '案件';
  const used = new Set();
  const files = items.map(it => {
    let fname = it.file;
    if (!/\.(docx?|txt|pdf|jpe?g|png)$/i.test(fname)) fname += '.doc';
    if (used.has(fname)) fname = fname.replace(/\.(docx?|txt|pdf|jpe?g|png)$/i, '') + '_' + it.key + '.doc';
    used.add(fname);
    return { path: dir + '/' + fname, data: enc.encode(draftDocHTML(caseFileDocContent(c, it))) };
  });
  downloadBytes('文件清单_' + today() + '.zip', makeZip(files), 'application/zip');
  FILES_SEL = new Set();
  syncFilesSelUI();
  toast('已批量下载文件', items.length + ' 个文件 · ' + dir + '.zip');
}

/* ============================================================
   v12：4 折叠面板 + 演员表 + 披露文件 + 调档概览
   ============================================================ */

/* 折叠面板：根据状态决定哪些面板可见
   - 案件信息 / 线索信息：始终显示（默认收起）
   - 一审信息：案件流转到「待正式立案（转正式立案）」之后显示（默认收起）
   - 判决信息：点击「判决更新」之后显示（停留待判决时认 judgeGotAt 标记，或已流转过待判决阶段）
   - 二审信息：案件进入二审流程之后显示（二审阶段，或已留有二审数据）
   - 执行信息：进入「待写执行材料」之后显示（默认收起）
   - 结案信息：进入「待归档」之后显示（默认展开）
*/
function renderCollapsePanels(c) {
  const root = $('#detail-collapse-root');
  if (!root) return;
  const st = stageOf(c.status);
  const idx = STAGE_KEYS.indexOf(c.status);
  const K = k => STAGE_KEYS.indexOf(k);

  const showFirst = idx >= K('转正式立案') && idx >= 0;
  // 判决更新点击后案件停留「待判决」（judgeGotAt 落库），此后任何阶段都视为已出判决
  const showJudge = (idx > K('待判决') && idx >= 0) || !!c.judgeGotAt;
  // 进入过二审流程：当前处于二审阶段，或已留有二审阶段写入的数据
  const showSecond = (idx >= K('二审') && idx >= 0) || !!(c.secondJudge || c.secondDoc || c.secondHearingAt || c.secondHearingPlace || c.secondServiceDoc);
  const showExec  = idx >= K('待写执行材料') && idx >= 0;
  const showClose = idx >= K('待归档') && idx >= 0;

  const panels = [
    { key: 'case-info',  title: '案件信息',     open: false, render: () => renderCaseInfoPanel(c, st), edit: `editCard('${esc(c.id)}','case-info')`, editTitle: '编辑案件信息' },
    { key: 'lead-info',  title: '线索信息',     open: false, render: () => renderLeadInfoPanel(c), edit: `editCard('${esc(c.id)}','lead-info')`, editTitle: '编辑线索信息' },
    { key: 'first',      title: '一审信息',     open: false, hidden: !showFirst, render: () => renderFirstInstancePanel(c), edit: `editCard('${esc(c.id)}','first')`, editTitle: '编辑一审信息' },
    { key: 'judgment',   title: '判决信息',     open: false, hidden: !showJudge, render: () => renderJudgmentPanel(c), edit: `editCard('${esc(c.id)}','judgment')`, editTitle: '编辑判决信息' },
    { key: 'second',     title: '二审信息',     open: false, hidden: !showSecond, render: () => renderSecondInstancePanel(c), edit: `editCard('${esc(c.id)}','second')`, editTitle: '编辑二审信息' },
    { key: 'exec',       title: '执行信息',     open: false, hidden: !showExec, render: () => renderExecPanel(c), edit: `editCard('${esc(c.id)}','exec')`, editTitle: '编辑执行信息' },
    // 结案信息不提供编辑入口（只读展示：结算金额/律师费/结算状态均为派生值）
    { key: 'close',      title: '结案信息',     open: true,  hidden: !showClose, render: () => renderClosePanel(c) },
  ].filter(p => !p.hidden);

  root.innerHTML = panels.map(p => `
    <div class="collapse ${p.open ? 'open' : ''}" data-collapse-key="${esc(p.key)}" data-page-node-id="collapse-${esc(p.key)}">
      <div class="collapse-head" onclick="toggleCollapse('${esc(p.key)}')">
        <span class="caret" aria-hidden="true">${p.open ? '▾' : '▸'}</span>
        <span class="title">${esc(p.title)}</span>
        ${p.open ? '<span class="status">展开</span>' : '<span class="status">收起</span>'}
        ${p.edit ? `<button class="btn btn-ghost btn-sm collapse-edit" onclick="event.stopPropagation();${p.edit}" title="${p.editTitle}">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style="vertical-align:-2px;margin-right:4px;"><path d="M11.5 2.5l1.5 1.5-8 8H3.5v-1.5l8-8z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>编辑
        </button>` : ''}
      </div>
      <div class="collapse-body" id="collapse-body-${esc(p.key)}"></div>
    </div>
  `).join('');

  panels.forEach(p => {
    const body = document.getElementById('collapse-body-' + p.key);
    if (body) body.innerHTML = p.render();
  });

  // 同步「收起/展开」标签（默认展开状态文字是反向的：open=true 显示「展开」是错的，应该是「收起」）
  // 已修：open=true → 显示「展开」（指向下一个动作 = 收起它）；open=false → 显示「收起」（指向下一个动作 = 展开它）
  // 但用户截图里：执行与结案信息是「收起」（可点击收起来），其他三个都是「展开」（可点击展开）。这里修正语义：
  root.querySelectorAll('.collapse').forEach(el => {
    const head = el.querySelector('.collapse-head .status');
    if (!head) return;
    if (el.classList.contains('open')) head.textContent = '收起';
    else head.textContent = '展开';
  });
}

/* 切换折叠面板：点击 caret / 标题都触发，编辑按钮通过 stopPropagation 互不干扰 */
function toggleCollapse(key) {
  const el = document.querySelector(`[data-collapse-key="${key}"]`);
  if (!el) return;
  el.classList.toggle('open');
  const caret = el.querySelector('.caret');
  const stat  = el.querySelector('.status');
  if (caret) caret.textContent = el.classList.contains('open') ? '▾' : '▸';
  if (stat)   stat.textContent   = el.classList.contains('open') ? '收起' : '展开';
}

/* 归档日期 / 归档原因：归档动作（「待归档」CTA 与「案件归档」弹窗）写入 c.archiveAt / c.archiveReason。
   老种子与演示播种没有这两个键，而 SAVE_VER 未 bump、老存档不会被重播种 —— 为避免「已归档」案件
   新增的卡片字段恒为「—」，按时间轴「结案归档」节点兜底（与结案信息卡同一套 logTime）。
   非「已归档」案件不兜底：这两格本就该是空的。 */
function archInfoOf(c) {
  const archived = !!c && c.status === '已归档';
  let at = (c && c.archiveAt) ? String(c.archiveAt).slice(0, 10) : '';
  if (!at && archived) {
    const t = String(logTime(c, '结案归档') || '');
    if (/^\d{4}-\d{2}-\d{2}/.test(t)) at = t.slice(0, 10);
  }
  const reason = (c && c.archiveReason) || (archived ? '结案并完成结算' : '');
  // v150：归档类型 —— 案件作废 / 和解结案 / 调解结案 / 判决履行 / 执行到款 / 执行终本
  //   老存档没有这个键（SAVE_VER 已 bump 会重播种；外部导入的老数据则显示「—」）
  const type = (c && c.archiveType) || '';
  return { at: at || '—', reason: reason || '—', type: type || '—' };
}

/* 案件信息折叠面板（3 列紧凑）：客户 / 权利人 / 被告（全部） / 侵权类型 / 案件类型 / 运营 / 案件单号 / 案件进展
   v130 追加：归档日期 / 归档原因 —— 整行双列收尾，「归档」是与在办流程无关的一组信息，不与上面 3 列混排 */
function renderCaseInfoPanel(c, st) {
  const ds = (Array.isArray(c.defendants) ? c.defendants : []).filter(d => d && d.name);
  // v128：被告值只留姓名（去掉「主被告 / 共同被告」标签）；悬浮口径与案件列表被告列一致
  const defVal = ds.length
    ? ds.map(d => esc(d.name)).join('<br>')
    : '—';
  const arch = archInfoOf(c);
  return `
    <div class="grid-12" style="gap:12px;">
      <div class="col-4">
        <div class="field-list">
          ${fieldRow('客户', esc(c.cust || c.client || '—'), 'cust')}
          ${fieldRow('权利主体', esc(c.client || '—'), 'client')}
          ${fieldRow('被告', defVal, null, multiDef(c) ? `data-tip-case="${esc(c.id)}"` : `title="${esc(defendantNames(c))}"`)}
        </div>
      </div>
      <div class="col-4">
        <div class="field-list">
          ${fieldRow('侵权类型', infringeTags(c.reason))}
          ${fieldRow('案件类型', `<span class="tag ${c.typeTag || 'tag-blue'}">${esc(c.type || '—')}</span>`)}
          ${fieldRow('运营', esc(c.operator || '—'))}
        </div>
      </div>
      <div class="col-4">
        <div class="field-list">
          ${fieldRow('案件单号', `<span class="mono">${esc(caseNoOf(c))}</span>`)}
          ${fieldRow('案件进展', `<span class="pill ${st.cls}">${esc(c.status)}</span>`)}
        </div>
      </div>
      <div class="col-12">
        <div class="field-list cols-3">
          ${fieldRow('归档日期', `<span class="mono">${esc(arch.at)}</span>`)}
          ${fieldRow('归档类型', esc(arch.type))}
          ${fieldRow('归档原因', esc(arch.reason))}
        </div>
      </div>
    </div>`;
}

/* 线索信息折叠面板：平台 / 店铺名 / 店铺ID / 开箱照片 / 公证书编号 / 公证书 / 披露文件
   关联链路：案件 notaryId → 公证条目（精确）；演示种子无 notaryId 时按 案件id → 店铺名互相包含 兜底 */
function leadNotaryOf(c) {
  const shop = shopOf(c);
  return NOTARY_ITEMS.find(x => c.notaryId && x.id === c.notaryId)
      || NOTARY_ITEMS.find(x => x.caseId === c.id)
      || NOTARY_ITEMS.find(x => x.shop && shop && (x.shop.indexOf(shop) >= 0 || shop.indexOf(x.shop) >= 0))
      || null;
}
function renderLeadInfoPanel(c) {
  // v146 合并起诉：新案件按店铺分组展示合并前的线索信息（小卡片 · 整块原样搬）
  const srcs = mergedSourcesOf(c);
  if (srcs) return srcs.map((s, i) => `
      <div class="merge-shop-card">
        <div class="merge-shop-card-head">
          <span class="tag tag-blue">${esc(mergeShopLabel(i))}</span>
          <span>${esc(shopOf(s) || '（无店铺名）')}</span>
          <span class="src">来源案件 ${esc(caseNoOf(s))}</span>
        </div>
        ${leadInfoBodyHTML(s)}
      </div>`).join('');
  return leadInfoBodyHTML(c);
}
function leadInfoBodyHTML(c) {
  const n = leadNotaryOf(c);
  const doc = NOTARY_DOCS.find(d => (c.notaryId && d.caseId === c.notaryId) || d.caseId === c.id || (n && d.caseId === n.id)) || null;
  const disc = Array.isArray(c.disclosures) ? c.disclosures : [];
  const discVal = disc.length ? disc.map(f => esc(f.name || '未命名文件')).join('<br>') : '—';
  const certVal = doc
    ? (doc.file && doc.file !== '—'
        ? `${esc(doc.file)} <span class="pill ${doc.statusCls || 'pill-neutral'}" style="margin-left:6px;">${esc(doc.status || '')}</span>`
        : `<span class="pill ${doc.statusCls || 'pill-warning'}">${esc(doc.status || '未出纸质证')}</span>`)
    : '—';
  /* 证物：按案件 id / 公证条目 id 匹配，只展示 3 项关键信息（证物编号 / 货架号 / 证物状态） */
  const evs = EVIDENCES.filter(e => e.caseId === c.id || (c.notaryId && e.caseId === c.notaryId));
  let evBlock = '';
  if (evs.length) {
    const rows = evs.map(e => `
      <tr>
        <td><span class="mono">${esc(e.id)}</span></td>
        <td>${esc(e.loc || '—')}</td>
        <td><span class="pill ${e.statusCls || 'pill-neutral'}">${esc(e.status || '—')}</span></td>
      </tr>`).join('');
    evBlock = `
    <div class="lead-detail-section" style="margin-top:14px;">证物（${evs.length}）</div>
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>证物编号</th><th>货架号</th><th>证物状态</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  } else {
    evBlock = `<div class="lead-detail-section" style="margin-top:14px;color:var(--color-ink-muted);">证物（0）</div>`;
  }
  /* 关联线索（按店铺名互相包含匹配，与披露判断同一套逻辑）→ 商品链接区块 */
  const shopC = shopOf(c), shopN = n && n.shop;
  const lead = LEADS.find(l => l.shop && ((shopC && (l.shop === shopC || l.shop.indexOf(shopC) >= 0 || shopC.indexOf(l.shop) >= 0)) || (shopN && l.shop === shopN))) || null;
  let linksBlock = '';
  if (lead && Array.isArray(lead.links) && lead.links.length) {
    const total = leadTotalAmt(lead.links);
    const rows = lead.links.map((p, i) => `
      <tr>
        <td class="num">${i + 1}</td>
        <td><a href="${esc(p.url)}" target="_blank" rel="noopener" class="link-mono">${esc((p.url || '').length > 56 ? (p.url.slice(0, 53) + '…') : p.url)}</a></td>
        <td>${esc(p.title || '—')}</td>
        <td class="num">${(p.qty || 0).toLocaleString()}</td>
        <td class="num">¥ ${(p.price || 0).toLocaleString()}</td>
        <td class="num">${(p.cmt || 0).toLocaleString()}</td>
        <td class="num">${money0(leadLinkSale(p))}</td>
      </tr>`).join('');
    linksBlock = `
    <div class="lead-detail-section lead-detail-section-row" style="margin-top:14px;">
      <span>商品链接（${lead.links.length}）· 销售总额 <b>${money0(total)}</b></span>
      <button class="btn btn-secondary btn-sm" onclick="editLeadLinks('${esc(lead.id)}','case')" title="编辑商品链接的字段数据">编辑</button>
    </div>
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th class="num">#</th><th>链接</th><th>商品名称</th><th class="num">销量</th><th class="num">单价</th><th class="num">评论数</th><th class="num">销售额</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }
  return `
    <div class="grid-12" style="gap:12px;">
      <div class="col-6">
        <div class="field-list">
          ${fieldRow('平台', `<span class="tag tag-blue">${esc((n && n.platform && n.platform !== '—') ? n.platform : platformOf(c))}</span>`)}
          ${fieldRow('店铺名', esc((n && n.shop) || shopOf(c)))}
          ${fieldRow('店铺ID', esc((n && n.shopId) || '—'))}
        </div>
      </div>
      <div class="col-6">
        <div class="field-list">
          ${fieldRow('开箱照片', openPhotoText(n))}
          ${fieldRow('公证书编号', n && n.docNo && n.docNo !== '—' ? `<span class="mono">${esc(n.docNo)}</span>` : '—')}
          ${fieldRow('公证书', certVal)}
          ${fieldRow('披露文件', discVal)}
        </div>
      </div>
    </div>${linksBlock}${evBlock}`;
}

/* 一审信息折叠面板：办案律师 / 立案 / 开庭 / 诉状 / 披露（v43 版） */
function renderFirstInstancePanel(c) {
  const { lawyer, firm, hall } = castOf(c);
  const judge = judgeOf(c);
  const n = leadNotaryOf(c);
  const amt = numOf(c.amount);
  const matchAt  = logTime(c, '匹配律师+调档');
  // v135：日期优先读编辑弹窗写入的顶层键，未填才回落时间轴节点（与 judgeOf 同一套「先用户值后派生值」口径）
  const draftAt  = c.submitAt || logTime(c, '上传诉状');
  const filingAt = c.formalAt || logTime(c, '正式立案');
  const hearingAt = c.hearingAt || logTime(c, '开庭');
  const matched = matchAt !== '—';
  const drafted = draftAt !== '—';
  const filed   = filingAt !== '—';
  // v150：空值不再兜「（待匹配法院）」说明文字（用户口径：空就是横杠）
  const court = normBlank(c.court) || '—';
  const feesAll = Array.isArray(STATE.fees) ? STATE.fees : [];
  const prePay = feesAll.filter(f => f.caseId === c.id && f.type === '诉讼费').reduce((a, f) => a + (Number(f.amount) || 0), 0);
  const caseNoVal = c.caseNo || '—';
  const filingShotVal = c.filingShot ? `<span class="link-mono">${esc(c.filingShot)}</span>` : '—';
  const acceptNoticeVal = c.acceptNotice ? `<span class="link-mono">${esc(c.acceptNotice)}</span>` : '—';
  const serviceDocVal = c.serviceDoc ? `<span class="link-mono">${esc(c.serviceDoc)}</span>` : '—';
  // v136：披露数据 / 披露数据附件是「一审阶段」的案件级字段（c.discloseInfo / c.disclose），
  //   与公证流程里的 n.discloseInfo / n.disclose 是两组独立数据，互不覆盖、不做旧数据兼容。
  const disclosureDataVal = (c.discloseInfo && c.discloseInfo !== '—') ? esc(c.discloseInfo) : '—';
  const disclosureFileVal = (c.disclose && c.disclose !== '—') ? `<span class="link-mono">${esc(c.disclose)}</span>` : '—';
  const filingDocsArr = Array.isArray(c.filingDocs) ? c.filingDocs : [];
  const filingDocsVal = filingDocsArr.length
    ? filingDocsArr.map(n => `<span class="link-mono">${esc(n)}</span>`).join('、')
    : '—';
  const filingDocsBlock = `${filingDocsVal} <button type="button" class="btn btn-secondary btn-sm" style="margin-left:6px;white-space:nowrap;" onclick="uploadFilingDocs('${esc(c.id)}')">+ 上传</button>`;
  // v135：起诉状只显示「文件图标 + 文件名」（点击预览全文），不再把诉状正文摘要铺在字段里；
  //   未上传直接留空，不显示派生的模板文字
  // v145：起诉状支持多文件 → 逐个渲染成「诉 文件名」（每个都能点开预览），「、」与换行分隔。
  const draftNames = authDocsOf(c);
  const draftCellVal = draftNames.length
    ? draftNames.map(n => `<span class="file-cell" style="display:inline-flex;align-items:center;gap:6px;">
         <span class="file-icon" style="cursor:pointer;" onclick="previewDraft()" title="点击预览全文">诉</span>
         <a href="javascript:previewDraft()" title="点击预览全文" style="color:var(--color-primary);text-decoration:none;">${esc(n)}</a>
       </span>`).join('<br>')
    : '—';
  return `
    <div class="grid-12" style="gap:12px;">
      <div class="col-6">
        <div class="field-list">
          ${fieldRow('办案律师', matched ? `<span class="tip-anchor" data-tip-settle="${esc(c.id)}"><b>${esc(lawyer)}</b> · ${esc(firm)}</span>` : '—')}
          ${fieldRow('立案法院', esc(court))}
          ${fieldRow('立案截图', filingShotVal)}
          ${fieldRow('诉调号 / 立案编号', `<span class="mono">${esc(caseNoVal)}</span>`)}
          ${fieldRow('提交立案日期', `<span class="mono">${esc(drafted ? draftAt.slice(0, 10) : '—')}</span>`)}
          ${fieldRow('正式立案日期', `<span class="mono">${esc(filed ? filingAt.slice(0, 10) : '—')}</span>`)}
          ${fieldRow('开庭日期', `<span class="mono">${esc(hearingAt)}</span>`)}
          ${fieldRow('开庭地点', esc(c.hearingPlace || (normBlank(c.court) ? court + ' · ' + hall : (hall || '—'))))}
          ${fieldRow('送达文书', serviceDocVal)}
        </div>
      </div>
      <div class="col-6">
        <div class="field-list">
          ${fieldRow('案号', `<span class="mono">${esc(normBlank(c.no) || '—')}</span>`)}
          ${fieldRow('立案受理通知书', acceptNoticeVal)}
          ${fieldRow('预缴诉讼费', `<span class="num-mono">${money(prePay)}</span>`)}
          ${fieldRow('承办法官', esc(judge || '—'))}
          ${fieldRow('标的额', `<span class="num-mono">${money(amt)}</span>`)}
          ${fieldRow('披露数据', disclosureDataVal)}
          ${fieldRow('披露数据附件', disclosureFileVal)}
          ${fieldRow('调档文件', filingDocsBlock)}
          ${fieldRow('起诉状', draftCellVal)}
        </div>
      </div>
    </div>`;
}

/* 判决信息折叠面板：收到判决日期 / 判决金额 / 判决书 / 实缴诉讼费 / 诉讼退费 */
function renderJudgmentPanel(c) {
  const judgeAt = (c.judgeGotAt || logTime(c, '判决')).split(' ')[0];
  const judged = judgeAt !== '—';
  const fee = (c.expenses || []).find(x => x.name === '诉讼费') || { amt: 0, status: '未发起' };
  const refunds = Array.isArray(c.refunds) ? c.refunds : [];
  const refundTotal = refunds.reduce((a, r) => a + (Number(r.amt) || 0), 0);
  // v144：诉讼退费与「判决更新」环节登记的是同一份数据（c.refunds）。此前只显示「合计（N 笔）」，
  //   看不出每笔明细 → 这里在合计下方补出每笔（退费方 / 金额 / 状态），与判决更新弹窗口径一致。
  const refundVal = refundTotal
    ? `<span class="num-mono">${money0(refundTotal)}</span>（${refunds.length} 笔）`
      + refunds.map(r => `<div style="font-size:12px;color:var(--color-ink-muted);margin-top:2px;">`
        + `${esc(r.from || '法院')} · ${money0(r.amt)} · ${esc(r.status || '待退')}</div>`).join('')
    : '—';
  return `
    <div class="grid-12" style="gap:12px;">
      <div class="col-4">
        <div class="field-list">
          ${fieldRow('收到判决日期', `<span class="mono">${esc(judgeAt)}</span>`)}
          ${fieldRow('判决金额', `<span class="num-mono">${esc(c.judgeAmt ? money(numOf(c.judgeAmt)) : (c.ov && c.ov.judgeAmt ? money(numOf(c.ov.judgeAmt)) : '—'))}</span>`)}
        </div>
      </div>
      <div class="col-4">
        <div class="field-list">
          ${fieldRow('判决书', (judged && c.judgeDoc) ? '<span class="text-success">已上传</span> · 1 份' : (judged ? '<span class="text-success">已上传</span> · 1 份' : '<span class="text-muted">待出具</span>'))}
          ${fieldRow('实缴诉讼费', `<span class="num-mono">${c.paidFee ? money(numOf(c.paidFee)) : money(expStatusOf(c, fee) === '已支付' ? fee.amt : 0)}</span>`)}
        </div>
      </div>
      <div class="col-4">
        <div class="field-list">
          ${fieldRow('诉讼退费', refundVal)}
        </div>
      </div>
    </div>`;
}

/* 二审信息折叠面板：进入二审流程后显示（二审进行中 / 已结 + 二审阶段字段） */
function renderSecondInstancePanel(c) {
  const active = c.status === '二审';
  return `
    <div class="grid-12" style="gap:12px;">
      <div class="col-6">
        <div class="field-list">
          ${fieldRow('二审进展', `<span class="pill ${active ? 'pill-warning' : 'pill-success'}">${active ? '二审进行中' : '二审已结'}</span>`)}
          ${fieldRow('二审文书', c.secondDoc ? esc(c.secondDoc) : '—')}
          ${fieldRow('二审开庭日期', `<span class="mono">${esc(c.secondHearingAt || '—')}</span>`)}
        </div>
      </div>
      <div class="col-6">
        <div class="field-list">
          ${fieldRow('二审开庭地点', esc(c.secondHearingPlace || '—'))}
          ${fieldRow('二审送达文书', c.secondServiceDoc ? esc(c.secondServiceDoc) : '—')}
          ${fieldRow('二审法官', esc(c.secondJudge || '—'))}
        </div>
      </div>
    </div>`;
}

/* 执行信息折叠面板：进入「待写执行材料」后显示 */
function renderExecPanel(c) {
  const execAt = String(logTime(c, '执行') || '—').split(' ')[0];
  const shotVal = c.execFilingShot ? `<span class="link-mono">${esc(c.execFilingShot)}</span>` : '—';
  const formalAt = c.execFormalAt || '—';
  const caseNo = c.execCaseNo || (c.ov && c.ov.execCaseNo) || '—';
  const docVal = c.execFormalDoc ? `<span class="link-mono">${esc(c.execFormalDoc)}</span>` : '—';
  return `
    <div class="grid-12" style="gap:12px;">
      <div class="col-4">
        <div class="field-list">
          ${fieldRow('执行立案日期', `<span class="mono">${esc(execAt)}</span>`)}
          ${fieldRow('执行立案截图', shotVal)}
        </div>
      </div>
      <div class="col-4">
        <div class="field-list">
          ${fieldRow('执行正式立案日期', `<span class="mono">${esc(formalAt)}</span>`)}
          ${fieldRow('执行案号', `<span class="mono">${esc(caseNo)}</span>`)}
        </div>
      </div>
      <div class="col-4">
        <div class="field-list">
          ${fieldRow('执行文书', docVal)}
        </div>
      </div>
    </div>`;
}

/* 结案信息折叠面板：进入「待归档」后显示（默认展开） */
function renderClosePanel(c) {
  const closeAt = String(logTime(c, '结案归档') || '—').split(' ')[0];
  const closeAmt = numOf(c.ov && c.ov.closeAmt) || numOf(c.closeAmt);
  const amt = numOf(c.amount);
  // 客户 / 律师结算金额：客户按「结算条件」公式、律师按「律师协议」各自独立派生
  const sf = settleFigures(c);
  const back = numOf(c.ov && c.ov.paidBack);
  const closed = c.status === '已归档' || c.status === '待归档';
  const payments = Array.isArray(c.payments) ? c.payments : [];
  const payTotal = payments.reduce((a, p) => a + (Number(p.amt) || 0), 0);
  const payBlock = payments.length ? `
    <div class="lead-detail-section">付款记录（${payments.length}） · 合计 ${money0(payTotal)}</div>
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th style="width:56px;">序号</th><th>付款日期</th><th>付款金额</th><th>付款人</th><th>收款人</th><th>收款截图</th></tr></thead>
        <tbody>
          ${payments.map((p, i) => `
            <tr>
              <td class="mono">${i + 1}</td>
              <td class="mono">${esc(p.date || '—')}</td>
              <td class="num-mono">${money0(Number(p.amt) || 0)}</td>
              <td>${esc(p.payer || '—')}</td>
              <td>${esc(p.payee || '—')}</td>
              <td>${p.proof ? `<span class="link-mono">${esc(p.proof)}</span>` : '—'}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>` : '';
  return `
    <div class="grid-12 close-info-grid">
      <div class="col-6">
        <div class="field-list">
          ${fieldRow('结案日期', `<span class="mono">${esc(closeAt)}</span>`)}
          ${fieldRow('结案金额', `<span class="num-mono">${closeAmt ? money(closeAmt) : '—'}</span>`)}
          ${fieldRow('已回款', `<span class="num-mono ${back > 0 ? 'text-success' : ''}" data-ov="paidBack">${money(back)}</span>`)}
          ${fieldRow('付款类型', esc(c.payType || (c.ov && c.ov.payType) || '—'))}
        </div>
      </div>
      <div class="col-6">
        <div class="field-list">
          ${fieldRow('客户结算金额', sf.amt > 0 ? settleAmtCell(c, 'cust') : '—')}
          ${fieldRow('结算条件', `<span class="mono">${esc(sf.cFormula)}</span>`)}
          ${fieldRow('律师结算金额', closed ? settleAmtCell(c, 'law') : '—')}
          ${fieldRow('律师结算模式', `<span class="mono">${esc(lawCondText(c))}</span>`)}
          ${fieldRow('结算状态', `<span class="pill ${closed ? 'pill-success' : 'pill-neutral'}">${closed ? '已结案结算' : '未结算'}</span>`)}
        </div>
      </div>
    </div>${payBlock}`;
}

/* ---------- 结算 Tab：7.1 客户 / 7.2 律师 ---------- */
function renderSettleTab(c) {
  const amt = numOf(c.amount);
  const back = numOf(c.ov && c.ov.paidBack);
  const closed = c.status === '已归档' || c.status === '待归档';
  const closeAmt = numOf(c.ov && c.ov.closeAmt) || numOf(c.closeAmt);
  const closeAt = (c.ov && c.ov.closeAt) ? c.ov.closeAt : '—';
  // 结算金额：客户按「结算条件」公式、律师按「律师协议」各自独立派生
  const sf = settleFigures(c);

  const cf = $('#st-cust-fields');
  if (cf) cf.innerHTML =
      fieldRow('客户结算金额', sf.amt > 0 ? settleAmtCell(c, 'cust') : '<span class="text-muted">—</span>')
    + fieldRow('结算条件', `<span class="mono">${esc(sf.cFormula)}</span>`)
    + fieldRow('结算日期', closeAmt ? `<span class="mono">${esc(closeAt)}</span>` : '<span class="text-muted">—</span>');

  const ck = $('#st-cust-kpi');
  if (ck) ck.innerHTML =
      `<div class="kpi-mini"><span>已发账单</span><span class="v">${closed ? '1' : '0'} / 1</span></div>`
    + `<div class="kpi-mini"><span>已开票</span><span class="v">${closed ? '1' : '0'} / 1</span></div>`
    + `<div class="kpi-mini"><span>已回款</span><span class="v">${amt > 0 ? `${money(back)} / ${money(amt)}` : '—'}</span></div>`;

  const lf = $('#st-law-fields');
  if (lf) lf.innerHTML =
      fieldRow('律师结算金额', closed ? settleAmtCell(c, 'law') : '<span class="text-muted">—</span>')
    + fieldRow('结算模式', `<span class="mono">${esc(lawCondText(c))}</span>`)
    + fieldRow('结算日期', closed ? `<span class="mono">${esc(closeAt)}</span>` : '<span class="text-muted">—</span>');

  const lk = $('#st-law-kpi');
  if (lk) lk.innerHTML =
      `<div class="kpi-mini"><span>已提交</span><span class="v">${closed ? '1' : '0'}</span></div>`
    + `<div class="kpi-mini"><span>已开票</span><span class="v">${closed ? '1' : '0'}</span></div>`
    + `<div class="kpi-mini"><span>已打款</span><span class="v">${closed && back > 0 ? money0(sf.lawAmt) : '—'}</span></div>`;
}

/* ---------- Tab 阶段锚点：状态由同一份时间轴推导，与时间轴永不矛盾 ----------
   v12 收敛为 3 个 tab：detail（案件详情，4 折叠面板）/ files（文件管理）/ costs（费用管理）。
   dot 含义聚合：
   - files  = 线索发现 + 公证出证 + 调档 + 披露文件归档（对应"文件"相关节点）
   - costs  = 上传诉状 + 正式立案 + 开庭 + 判决 + 执行 + 结案归档 + 结算（对应"费用/流程"相关节点）
*/
const TAB_LOG = {
  files: ['线索发现', '创建案件', '线索推送', '客户审核·侵权', '公证出证', '匹配律师+调档', '公证书归档', '上传披露文件'],
  costs: ['上传诉状', '正式立案', '开庭', '判决', '执行', '结案归档', '结算'],
};
function renderTabDots(c) {
  $$('#detail-tabs .tab-dot').forEach(el => {
    const titles = TAB_LOG[el.dataset.dot] || [];
    const items = (c.log || []).filter(t => titles.indexOf(t.title) >= 0);
    let s = 'pending';
    if (items.length) s = items.every(t => t.state === 'done') ? 'done' : 'active';
    el.className = 'tab-dot ' + s;
    el.title = s === 'done' ? '已完成' : (s === 'active' ? '进行中' : '未开始');
  });
}

/* ---------- 详情页操作：所有按钮必须有反馈，不留死按钮 ---------- */
function viewFullLog() {
  const c = curCase(); if (!c) return;
  const log = c.log || [];
  openModal({
    title: '完整流程记录 · ' + c.id, wide: true, okText: null, cancelText: '关闭',
    bodyHTML: `<div class="timeline" style="max-height:420px; overflow-y:auto;">${log.map(t => `
      <div class="timeline-item ${t.state}">
        <div class="timeline-time">${esc(t.time)}${t.actor && t.actor !== '—' ? `<span class="actor">${esc(t.actor)}</span>` : ''}</div>
        <div class="timeline-title">${esc(t.title)}</div>
        <div class="timeline-desc">${esc(t.desc)}</div>
      </div>`).join('')}</div>`,
  });
}
function previewDraft() {
  const c = curCase(); if (!c) return;
  openModal({
    title: '起诉状预览 · ' + c.id, wide: true, okText: null, cancelText: '关闭',
    bodyHTML: `<div class="doc-quote" style="max-height:420px;">${esc(draftTextOf(c))}</div>`,
  });
}

// 9. 初始化
// ============================================================
(function init() {
  const restored = load();
  // 每个流程补足 5 条演示案件（只增不减，兼容老档案）
  const demoAdded = fillStageDemoCases(STATE.cases);
  ensureCaseNos();   // v96：给全部案件/线索补齐案件单号（幂等，老档案同样生效）
  if (demoAdded || restored) save();
  renderAll();
  // 与 index.html 中初始 active 的视图对齐（含侧栏高亮、面包屑、二级目录展开）
  const av = document.querySelector('.view.active');
  const initView = av ? String(av.id).replace('view-', '') : 'cases';
  showView(initView);
  if (restored) {
    // 自修复：若上次的存档把证物/公证等列表存成了空数组，restoreExtras 已回退为种子数据，
    // 这里立即重新落盘，覆盖掉本地损坏的空数组，避免下次加载再次清空。
    save();
    setTimeout(() => toast('已恢复上次的演示数据', `${STATE.cases.length} 个案件 · ${STATE.customers.length} 家客户`, 'info'), 400);
  } else {
    setTimeout(() => toast('演示模式已就绪', '可新建案件 / 推进阶段 / 编辑字段', 'info'), 400);
  }
})();
