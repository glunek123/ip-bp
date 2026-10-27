<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { notifyWorkflowChanged } from '../../app/workflow-events';
import { ApiError } from '../../api/http';
import MaterialPreviewDialog from '../../app/MaterialPreviewDialog.vue';
import { getLead, type LeadDetail } from '../../api/leads';
import { updateLeadProductScreenshots } from '../../api/leads';
import {
  getLeadImageImports,
  retryLeadImageImport,
  type LeadImageImportTask,
} from '../../api/lead-workbook';
import {
  downloadMaterialVersion,
  listOwnerMaterials,
  uploadMaterialFile,
} from '../../api/materials';
import ProductScreenshotsRow, {
  type ProductScreenshot,
} from './ProductScreenshotsRow.vue';
import {
  labelLeadPlatform,
  leadCaseTypeLabels,
  leadInfringementTypeLabels,
  leadSourceLabels,
  leadStatusLabels,
} from './lead-options';
import { summarizeLeadProducts } from './lead-display';
import { useAuthStore } from '../../stores/auth';
import LeadQuickActionsPanel from './LeadQuickActionsPanel.vue';
import {
  readPendingLeadCommands,
  type LeadWorkflowResult,
} from './LeadListWorkflowPanel.vue';
const route = useRoute();
const auth = useAuthStore();
const actorKey = computed(
  () =>
    `${auth.session?.user.id ?? ''}:${auth.session?.principalType ?? ''}:${auth.session?.department?.id ?? ''}:${auth.session?.authorizationRevision ?? ''}`,
);
const requestScopeKey = computed(
  () => `${String(route.params.id)}:${actorKey.value}`,
);
let contextGeneration = 0;
let refreshGeneration = 0;
let request: AbortController | undefined;
const downloadRequests = new Set<AbortController>();
const state = ref<'loading' | 'ready' | 'missing' | 'failed'>('loading');
const lead = ref<LeadDetail>();
const customerName = computed(
  () => lead.value?.displayNames.customerName ?? '客户名称不可见',
);
const holderName = computed(
  () => lead.value?.displayNames.rightsHolderName ?? '权利主体名称不可见',
);
const productSummary = computed(() =>
  summarizeLeadProducts(lead.value?.products ?? []),
);
const orderedProducts = computed(() =>
  [...(lead.value?.products ?? [])].sort((a, b) => a.position - b.position),
);
const screenshots = ref<
  Array<{ materialId: string; versionId: string; filename: string }>
>([]);
const productScreenshotMetadata = ref(new Map<string, ProductScreenshot>());
const productScreenshotBusy = ref(new Set<string>());
const productScreenshotUncertain = ref(new Set<string>());
const screenshotMessage = ref('');
const imageTasks = ref<LeadImageImportTask[]>([]);
const imageTaskError = ref('');
const retryUrls = ref<Record<string, string>>({});
let imagePoll: ReturnType<typeof globalThis.setInterval> | undefined;
const tasksForProduct = (productId: string) =>
  imageTasks.value.filter((task) => task.productId === productId);
function imageFailureMessage(code: string | null): string {
  const messages: Record<string, string> = {
    INVALID_URL: '链接格式无效',
    BLOCKED_ADDRESS: '链接指向不可访问的地址',
    HTTP_ERROR: '链接无法直接下载',
    INVALID_IMAGE: '返回内容不是有效图片',
    TOO_LARGE: '图片超过大小限制',
    TIMEOUT: '下载超时',
    NOT_AUTHORIZED: '当前无权附加截图',
    PROCESSING_TIMEOUT: '处理超时',
    PROCESSING_ERROR: '保存图片失败',
  };
  return messages[code ?? ''] ?? '处理失败';
}
async function retryImageTask(task: LeadImageImportTask): Promise<void> {
  const url = retryUrls.value[task.id] ?? task.url;
  try {
    await retryLeadImageImport(taskProductLeadId(), task.id, url);
    imageTaskError.value = '';
    imageTasks.value = await getLeadImageImports(taskProductLeadId());
  } catch (error) {
    imageTaskError.value = error instanceof Error ? error.message : '重试失败';
  }
}
function taskProductLeadId(): string {
  return String(route.params.id);
}
const selectedScreenshot = ref<{
  materialId: string;
  versionId: string;
  filename: string;
}>();
const downloadError = ref('');
const productLinkMessage = ref('');
const workflowOpen = ref(false);
const pendingCommands = ref(readPendingLeadCommands());
const pendingPush = computed(
  () => pendingCommands.value?.[actorKey.value] ?? null,
);
const transferredMatter = ref<{ id: string; businessNo: string }>();
const transferSuccess = ref('');
function readPending() {
  pendingCommands.value = readPendingLeadCommands();
}
async function workflowCompleted(result: LeadWorkflowResult) {
  const scope = requestScopeKey.value;
  if (
    result.attempt.identity !== actorKey.value ||
    result.attempt.leadId !== String(route.params.id)
  )
    return;
  notifyWorkflowChanged();
  readPending();
  const expectedRefresh = refreshGeneration + 1;
  await load();
  if (scope !== requestScopeKey.value || refreshGeneration !== expectedRefresh)
    return;
  if (
    result.matter &&
    lead.value?.notaryMatters.some((matter) => matter.id === result.matter?.id)
  ) {
    transferredMatter.value = result.matter;
    transferSuccess.value = '已创建本次公证取证批次，请打开对应事项继续办理。';
  }
}
const workflowNotice = computed(() => {
  const current = lead.value;
  if (!current) return '';
  switch (current.status) {
    case 'WAITING_REVIEW':
      return '等待客户审核；运营不能代客户确认。';
    case 'WAITING_EVIDENCE_DECISION':
      return current.capabilities.transferToNotary
        ? ''
        : '当前记录未提供办理入口，请刷新核对最新记录。';
    case 'ARCHIVED':
      return current.pendingWithdrawalApplication
        ? '撤回申请待原客户企业确认。'
        : '';
    default:
      return '';
  }
});
async function copyProductUrl(url: string): Promise<void> {
  if (!safeProductUrl(url)) return;
  try {
    await globalThis.navigator.clipboard.writeText(url);
    productLinkMessage.value = '商品链接已复制';
  } catch {
    productLinkMessage.value = '复制失败，请打开商品链接后从地址栏复制';
  }
}
function formatTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
}
function safeProductUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new globalThis.URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
async function load(): Promise<void> {
  refreshGeneration += 1;
  const generation = contextGeneration;
  request?.abort();
  const controller = new AbortController();
  request = controller;
  state.value = 'loading';
  lead.value = undefined;
  screenshots.value = [];
  productScreenshotMetadata.value = new Map();
  imageTasks.value = [];
  selectedScreenshot.value = undefined;
  transferredMatter.value = undefined;
  transferSuccess.value = '';
  try {
    const current = await getLead(String(route.params.id), {
      signal: controller.signal,
    });
    if (
      controller.signal.aborted ||
      generation !== contextGeneration ||
      request !== controller
    )
      return;
    lead.value = current;
    productScreenshotUncertain.value = new Set();
    screenshotMessage.value = '';
    const materials = await listOwnerMaterials('LEAD', current.id, {
      signal: controller.signal,
    }).catch(() => null);
    if (
      controller.signal.aborted ||
      generation !== contextGeneration ||
      request !== controller
    )
      return;
    screenshots.value = (materials?.items ?? []).flatMap((material) => {
      if (
        material.status !== 'ACTIVE' ||
        !material.currentVersionId ||
        !current.leadScreenshotContentVersionIds.includes(
          material.currentVersionId,
        )
      )
        return [];
      const version = material.contentVersions.find(
        (item) => item.id === material.currentVersionId,
      );
      return version
        ? [
            {
              materialId: material.id,
              versionId: version.id,
              filename: version.originalFilename,
            },
          ]
        : [];
    });
    productScreenshotMetadata.value = new Map(
      (materials?.items ?? [])
        .filter(
          (material) =>
            material.status === 'ACTIVE' &&
            material.ownerType === 'LEAD' &&
            material.ownerId === current.id &&
            material.category === 'LEAD_SCREENSHOT' &&
            material.purpose === 'LEAD_SCREENSHOT',
        )
        .flatMap((material) =>
          material.contentVersions.map(
            (version) =>
              [
                version.id,
                {
                  versionId: version.id,
                  materialId: material.id,
                  filename: version.originalFilename,
                },
              ] as const,
          ),
        ),
    );
    try {
      imageTasks.value = await getLeadImageImports(current.id, {
        signal: controller.signal,
      });
    } catch {
      imageTaskError.value = '图片导入状态暂不可用，请刷新重试。';
    }
    state.value = 'ready';
    if (imagePoll) globalThis.clearInterval(imagePoll);
    imagePoll = globalThis.setInterval(() => {
      if (
        !imageTasks.value.some((task) =>
          ['PENDING', 'LEASED', 'STORED'].includes(task.status),
        )
      )
        return;
      const scope = requestScopeKey.value;
      void getLeadImageImports(current.id)
        .then((next) => {
          if (scope !== requestScopeKey.value) return;
          const becameAttached = next.some(
            (item) =>
              item.status === 'ATTACHED' &&
              imageTasks.value.find((previous) => previous.id === item.id)
                ?.status !== 'ATTACHED',
          );
          imageTasks.value = next;
          if (becameAttached) void load();
        })
        .catch(() => {
          imageTaskError.value = '图片导入状态暂不可用，请刷新重试。';
        });
    }, 5_000);
  } catch (error) {
    if (
      controller.signal.aborted ||
      generation !== contextGeneration ||
      request !== controller
    )
      return;
    lead.value = undefined;
    state.value =
      error instanceof ApiError && error.code === 'RESOURCE_NOT_FOUND'
        ? 'missing'
        : 'failed';
  }
}
function productScreenshotItems(ids: string[]): ProductScreenshot[] {
  return (ids ?? []).flatMap((id) => {
    const item = productScreenshotMetadata.value.get(id);
    return item ? [item] : [];
  });
}
async function saveProductScreenshots(
  productId: string,
  nextIds: string[],
  files: Array<InstanceType<typeof globalThis.File>> = [],
): Promise<void> {
  const current = lead.value;
  const product = current?.products.find((item) => item.id === productId);
  const generation = contextGeneration;
  if (
    !current ||
    !product ||
    !current.capabilities.productScreenshotsEdit ||
    productScreenshotBusy.value.has(productId) ||
    productScreenshotUncertain.value.has(productId)
  )
    return;
  if (
    current.products.reduce(
      (total, product) =>
        total + (product.screenshotContentVersionIds?.length ?? 0),
      0,
    ) -
      (product.screenshotContentVersionIds?.length ?? 0) +
      nextIds.length +
      files.length >
    20
  ) {
    screenshotMessage.value = '所有商品截图合计最多 20 份';
    return;
  }
  productScreenshotBusy.value = new Set([
    ...productScreenshotBusy.value,
    productId,
  ]);
  screenshotMessage.value = '';
  try {
    for (const file of files) {
      const uploaded = await uploadMaterialFile({
        ownerType: 'LEAD',
        ownerId: current.id,
        category: 'LEAD_SCREENSHOT',
        purpose: 'LEAD_SCREENSHOT',
        file,
      });
      if (
        generation !== contextGeneration ||
        String(route.params.id) !== current.id
      )
        return;
      nextIds.push(uploaded.contentVersionId);
    }
    await updateLeadProductScreenshots(current.id, productId, {
      expectedVersion: current.version,
      screenshotContentVersionIds: nextIds,
    });
    if (
      generation !== contextGeneration ||
      String(route.params.id) !== current.id
    )
      return;
    await load();
  } catch (error) {
    if (generation !== contextGeneration) return;
    productScreenshotUncertain.value = new Set([
      ...productScreenshotUncertain.value,
      productId,
    ]);
    screenshotMessage.value =
      error instanceof ApiError && error.code === 'VERSION_CONFLICT'
        ? '线索已更新，截图未确认关联；请刷新后核对当前商品截图。'
        : '截图关联结果未确认，请刷新核对后再操作。';
  } finally {
    productScreenshotBusy.value = new Set(
      [...productScreenshotBusy.value].filter((id) => id !== productId),
    );
  }
}
function removeProductScreenshot(productId: string, versionId: string): void {
  const product = lead.value?.products.find((item) => item.id === productId);
  if (!product || productScreenshotUncertain.value.has(productId)) return;
  void saveProductScreenshots(
    productId,
    (product.screenshotContentVersionIds ?? []).filter(
      (id) => id !== versionId,
    ),
  );
}
function replaceProductScreenshots(
  productId: string,
  files: Array<InstanceType<typeof globalThis.File>>,
): void {
  const allowed = new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
  ]);
  if (
    files.some(
      (file) => !allowed.has(file.type) || file.size > 20 * 1024 * 1024,
    )
  ) {
    screenshotMessage.value =
      '截图仅支持 PDF、JPG/JPEG、PNG、WEBP，每份不超过 20MB';
    return;
  }
  void saveProductScreenshots(productId, [], files);
}
async function downloadScreenshot(
  materialId: string,
  versionId: string,
): Promise<void> {
  const generation = contextGeneration;
  const controller = new AbortController();
  downloadRequests.add(controller);
  downloadError.value = '';
  try {
    await downloadMaterialVersion(materialId, versionId, controller.signal);
  } catch {
    if (!controller.signal.aborted && generation === contextGeneration)
      downloadError.value = '截图下载失败，请稍后重试';
  } finally {
    downloadRequests.delete(controller);
  }
}
function handleScreenshotUnavailable(status: 403 | 404): void {
  selectedScreenshot.value = undefined;
  if (status === 403) screenshots.value = [];
  downloadError.value =
    status === 403
      ? '当前账号无权查看该截图，请刷新线索资料'
      : '截图文件已不存在，请刷新线索资料';
}
function clearContext() {
  if (imagePoll) globalThis.clearInterval(imagePoll);
  imagePoll = undefined;
  contextGeneration += 1;
  request?.abort();
  for (const controller of downloadRequests) controller.abort();
  downloadRequests.clear();
  lead.value = undefined;
  screenshots.value = [];
  productScreenshotMetadata.value = new Map();
  selectedScreenshot.value = undefined;
  downloadError.value = '';
  transferredMatter.value = undefined;
  transferSuccess.value = '';
  workflowOpen.value = false;
}
watch(
  requestScopeKey,
  () => {
    clearContext();
    readPending();
    workflowOpen.value = pendingPush.value?.leadId === String(route.params.id);
    void load();
  },
  { immediate: true, flush: 'sync' },
);
onBeforeUnmount(clearContext);
</script>
<template>
  <div class="page-view page-view--narrow lead-detail-page">
    <main>
      <RouterLink class="back-link" to="/leads">← 返回线索列表</RouterLink>
      <p
        v-if="pendingPush?.leadId === String(route.params.id) && !workflowOpen"
        role="alert"
      >
        该线索有未确认请求，请先核对原请求。
        <ElButton data-test="reopen-pending-lead" @click="workflowOpen = true"
          >核对未确认请求</ElButton
        >
      </p>
      <section
        v-if="transferredMatter"
        class="demo-card demo-card--pad"
        data-test="handoff-success"
        role="status"
      >
        <h2 class="form-section-title">本次移交成功</h2>
        <p>{{ transferSuccess }}</p>
        <RouterLink
          data-test="handoff-matter-link"
          :to="`/notary-matters/${transferredMatter.id}`"
          >打开 {{ transferredMatter.businessNo }}，继续办理</RouterLink
        >
        <p>请在该事项查看当前阶段、下一责任人与办理入口。</p>
      </section>
      <section v-if="state === 'loading'" class="state-panel ledger-panel">
        <h1>正在读取线索</h1>
      </section>
      <section v-else-if="state === 'missing'" class="state-panel ledger-panel">
        <h1>线索不存在或当前不可访问</h1>
      </section>
      <section v-else-if="state === 'failed'" class="state-panel ledger-panel">
        <h1>线索详情暂时无法加载</h1>
        <ElButton data-test="refresh" @click="load">重新加载</ElButton>
      </section>
      <template v-else-if="lead">
        <div class="page-head">
          <div>
            <span class="pill">{{ leadStatusLabels[lead.status] }}</span>
            <h1>{{ lead.businessNo }}</h1>
          </div>
          <div class="detail-actions">
            <ElButton
              v-if="lead.capabilities.push"
              type="primary"
              data-test="push-lead"
              @click="workflowOpen = true"
              >推送客户审核</ElButton
            >
            <RouterLink
              v-if="lead.capabilities.edit"
              data-test="edit-lead"
              :to="`/leads/${lead.id}/edit`"
              >编辑线索</RouterLink
            ><ElButton data-test="refresh" text @click="load">刷新</ElButton>
            <ElButton
              v-if="
                lead.capabilities.transferToNotary ||
                lead.capabilities.createEvidenceBatch ||
                lead.capabilities.evidenceDecide ||
                lead.capabilities.withdrawApply
              "
              data-test="open-lead-workflow"
              type="primary"
              @click="workflowOpen = true"
              >{{
                lead.capabilities.createEvidenceBatch
                  ? '新建取证批次'
                  : lead.capabilities.withdrawApply
                    ? '申请撤回归档'
                    : '确认取证安排'
              }}</ElButton
            >
          </div>
        </div>
        <p
          v-if="workflowNotice"
          class="field-help"
          data-test="lead-workflow-status"
        >
          {{ workflowNotice }}
        </p>
        <section class="demo-card demo-card--pad">
          <dl class="demo-detail-grid" data-test="lead-facts">
            <div>
              <dt>客户</dt>
              <dd>{{ customerName }}</dd>
            </div>
            <div>
              <dt>权利主体</dt>
              <dd>{{ holderName }}</dd>
            </div>
            <div>
              <dt>案件类型</dt>
              <dd>{{ leadCaseTypeLabels[lead.caseType] }}</dd>
            </div>
            <div>
              <dt>来源／平台</dt>
              <dd>
                {{ leadSourceLabels[lead.source] }} ·
                {{ labelLeadPlatform(lead.platform) }}
              </dd>
            </div>
            <div>
              <dt>负责人</dt>
              <dd>{{ lead.displayNames.responsibleUserName }}</dd>
            </div>
            <div>
              <dt>店铺</dt>
              <dd>
                {{ lead.shopName
                }}<small v-if="lead.shopExternalId">
                  · {{ lead.shopExternalId }}</small
                >
              </dd>
            </div>
            <div>
              <dt>发现时间</dt>
              <dd class="mono">{{ formatTime(lead.foundAt) }}</dd>
            </div>
            <div>
              <dt>侵权类型</dt>
              <dd>
                {{
                  lead.infringementTypes
                    .map((type) => leadInfringementTypeLabels[type])
                    .join('、')
                }}
              </dd>
            </div>
            <div>
              <dt>披露标记</dt>
              <dd>{{ lead.needDisclose ? '需要披露' : '无需披露' }}</dd>
            </div>
            <div class="detail-grid__wide">
              <dt>备注</dt>
              <dd>{{ lead.remark || '未填写' }}</dd>
            </div>
          </dl>
        </section>
        <section class="demo-card" data-test="lead-products-table">
          <h2 class="card-section-title">商品信息</h2>
          <p class="field-help lead-estimate-note">
            计算金额＝单价 × 销量；销量为 0
            时改用评论数。仅供线索评估参考，不代表实际成交额。
          </p>
          <div
            class="demo-table-wrap business-list-scroll"
            tabindex="0"
            role="region"
            aria-label="商品明细，可横向滚动"
          >
            <table class="demo-table business-list-table lead-product-table">
              <colgroup>
                <col style="width: 200px" />
                <col style="width: 260px" />
                <col style="width: 100px" />
                <col style="width: 120px" />
                <col style="width: 100px" />
                <col style="width: 160px" />
              </colgroup>
              <thead>
                <tr>
                  <th>商品名称</th>
                  <th>商品链接</th>
                  <th class="num">销量</th>
                  <th class="num">单价（元）</th>
                  <th class="num">评论数</th>
                  <th class="num">计算金额（元）</th>
                  <th>商品截图</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="product in orderedProducts" :key="product.id">
                  <td class="business-list-cell--text">
                    <span
                      class="lead-product-text"
                      :title="product.title || '未登记商品名称'"
                      >{{ product.title || '未登记商品名称' }}</span
                    >
                  </td>
                  <td class="business-list-cell--text">
                    <div
                      v-if="safeProductUrl(product.url)"
                      class="lead-product-link-row"
                    >
                      <a
                        :href="safeProductUrl(product.url)!"
                        :title="product.url ?? ''"
                        target="_blank"
                        rel="noopener noreferrer"
                        >{{ product.url }}</a
                      >
                      <button
                        type="button"
                        :aria-label="`复制商品链接：${product.title || '未登记商品名称'}`"
                        @click="copyProductUrl(product.url!)"
                      >
                        复制
                      </button>
                    </div>
                    <span v-else>无有效商品链接</span>
                  </td>
                  <td class="num mono business-list-cell--number">
                    {{ product.quantity }}
                  </td>
                  <td class="num mono business-list-cell--number">
                    {{ product.unitPrice }}
                  </td>
                  <td class="num mono business-list-cell--number">
                    {{ product.commentCount }}
                  </td>
                  <td class="num mono business-list-cell--number">
                    {{ product.estimatedAmount }}
                  </td>
                  <td>
                    <ProductScreenshotsRow
                      :items="
                        productScreenshotItems(
                          product.screenshotContentVersionIds ?? [],
                        )
                      "
                      :can-edit="
                        lead.capabilities.productScreenshotsEdit &&
                        !productScreenshotUncertain.has(product.id)
                      "
                      :busy="productScreenshotBusy.has(product.id)"
                      @preview="selectedScreenshot = $event"
                      @download="
                        downloadScreenshot($event.materialId, $event.versionId)
                      "
                      @remove="removeProductScreenshot(product.id, $event)"
                      @replace="replaceProductScreenshots(product.id, $event)"
                    />
                    <ul
                      v-if="tasksForProduct(product.id).length"
                      data-test="lead-image-import-tasks"
                    >
                      <li
                        v-for="task in tasksForProduct(product.id)"
                        :key="task.id"
                      >
                        导入第 {{ task.rowNumber }} 行／商品组
                        {{ task.productNumber }}：
                        {{
                          task.status === 'ATTACHED'
                            ? '已保存到系统'
                            : task.status === 'FAILED'
                              ? `待补：${imageFailureMessage(task.failureCode)}`
                              : '下载处理中'
                        }}
                        <span class="mono">{{ task.url }}</span>
                        <template
                          v-if="
                            task.status === 'FAILED' &&
                            lead.capabilities.productScreenshotsEdit
                          "
                        >
                          <input
                            v-model="retryUrls[task.id]"
                            :placeholder="task.url"
                            aria-label="补充图片链接"
                          />
                          <ElButton @click="retryImageTask(task)"
                            >重试链接</ElButton
                          >
                        </template>
                      </li>
                    </ul>
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr data-test="lead-product-summary">
                  <th colspan="3" scope="row">商品计算金额合计</th>
                  <td class="num mono business-list-cell--number">
                    {{ productSummary.quantityTotal }}
                  </td>
                  <td class="num mono business-list-cell--number">—</td>
                  <td class="num mono business-list-cell--number">
                    {{ productSummary.commentTotal }}
                  </td>
                  <td class="num mono business-list-cell--number">
                    {{ productSummary.estimatedAmount }}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p v-if="productLinkMessage" role="status" class="field-help">
            {{ productLinkMessage }}
          </p>
          <p v-if="screenshotMessage" role="status" class="field-help">
            {{ screenshotMessage }}
          </p>
          <p v-if="imageTaskError" role="alert">{{ imageTaskError }}</p>
          <div class="lead-unassigned-screenshots" data-test="lead-attachments">
            <h3>截图（商品归属待关联）</h3>
            <p class="field-help">
              现有截图未记录对应商品，暂不作为某件商品的截图展示。
            </p>
            <p v-if="lead.leadScreenshotContentVersionIds.length === 0">
              未上传截图
            </p>
            <ul v-else-if="screenshots.length">
              <li v-for="screenshot in screenshots" :key="screenshot.versionId">
                <span>{{ screenshot.filename }}</span>
                <ElButton
                  text
                  :data-test="`preview-screenshot-${screenshot.versionId}`"
                  @click="selectedScreenshot = screenshot"
                  >预览</ElButton
                >
                <ElButton
                  text
                  :data-test="`download-screenshot-${screenshot.versionId}`"
                  @click="
                    downloadScreenshot(
                      screenshot.materialId,
                      screenshot.versionId,
                    )
                  "
                  >下载</ElButton
                >
              </li>
            </ul>
            <p v-else role="status">截图暂时无法读取，请刷新线索资料。</p>
            <p v-if="downloadError" class="field-error" role="alert">
              {{ downloadError }}
            </p>
          </div>
        </section>
        <section
          v-if="lead.reviewDecision"
          class="demo-card demo-card--pad"
          data-test="client-review-record"
        >
          <h2 class="form-section-title">客户审核记录</h2>
          <dl class="demo-detail-grid">
            <div>
              <dt>审核结论</dt>
              <dd>
                {{
                  lead.reviewDecision.result === 'INFRINGEMENT'
                    ? '确认侵权'
                    : '判定不侵权并归档'
                }}
              </dd>
            </div>
            <div v-if="lead.reviewDecision.result === 'NO_INFRINGEMENT'">
              <dt>不侵权原因</dt>
              <dd>{{ lead.reviewDecision.reason }}</dd>
            </div>
            <div>
              <dt>审核人</dt>
              <dd>{{ lead.reviewDecision.reviewerDisplayName }}</dd>
            </div>
            <div v-if="lead.reviewDecision.result === 'NO_INFRINGEMENT'">
              <dt>归档时间</dt>
              <dd class="mono">
                {{ formatTime(lead.reviewDecision.archivedAt) }}
              </dd>
            </div>
            <div>
              <dt>审核时间</dt>
              <dd class="mono">
                {{ formatTime(lead.reviewDecision.decidedAt) }}
              </dd>
            </div>
          </dl>
        </section>
        <section
          v-if="lead.evidenceDecision"
          class="demo-card demo-card--pad"
          data-test="evidence-decision-record"
        >
          <h2 class="form-section-title">运营不取证归档记录</h2>
          <p>决定：不取证并归档</p>
          <p>操作人：{{ lead.evidenceDecision.decidedByDisplayName }}</p>
          <p>决定时间：{{ formatTime(lead.evidenceDecision.decidedAt) }}</p>
          <p>原因：{{ lead.evidenceDecision.reason }}</p>
          <p>归档时间：{{ formatTime(lead.evidenceDecision.archivedAt) }}</p>
        </section>
        <section
          v-if="lead.notaryMatters.length"
          id="notary-matters"
          class="demo-card demo-card--pad"
          data-test="notary-matters"
        >
          <h2 class="form-section-title">公证取证批次</h2>
          <p>本线索已进入公证流程；新增批次会保留原有批次记录。</p>
          <ul>
            <li v-for="matter in lead.notaryMatters" :key="matter.id">
              <RouterLink
                :data-test="`matter-link-${matter.id}`"
                :to="`/notary-matters/${matter.id}`"
                >{{ matter.businessNo }}</RouterLink
              >
              · {{ matter.notaryOfficeName }} · {{ matter.batchPurpose }} ·
              {{ formatTime(matter.createdAt) }}
            </li>
          </ul>
        </section>
        <section
          v-if="lead.pendingWithdrawalApplication"
          class="demo-card demo-card--pad"
          data-test="withdrawal-pending"
        >
          <h2 class="form-section-title">待客户确认的撤回申请</h2>
          <p>
            申请人：{{ lead.pendingWithdrawalApplication.applicantDisplayName }}
          </p>
          <p>
            申请时间：{{
              formatTime(lead.pendingWithdrawalApplication.appliedAt)
            }}
          </p>
          <p>申请原因：{{ lead.pendingWithdrawalApplication.reason }}</p>
          <p>线索仍保持归档，等待原客户企业确认。</p>
        </section>
        <section
          v-if="lead.history?.length"
          class="demo-card demo-card--pad"
          data-test="withdrawal-history"
        >
          <h2 class="form-section-title">审核和撤回历史</h2>
          <ol>
            <li v-for="item in lead.history" :key="item.id">
              {{
                item.kind === 'REVIEW_DECISION'
                  ? '客户审核'
                  : item.kind === 'WITHDRAWAL_APPLICATION'
                    ? '撤回申请'
                    : item.kind === 'EVIDENCE_DECISION'
                      ? '运营不取证归档'
                      : '客户确认撤回'
              }}
              · {{ formatTime(item.occurredAt) }}
              <span v-if="item.reviewerDisplayName">
                · {{ item.reviewerDisplayName }}</span
              >
              <span v-if="item.applicantDisplayName">
                · {{ item.applicantDisplayName }}</span
              >
              <span v-if="item.result">
                ·
                {{
                  item.result === 'NO_INFRINGEMENT'
                    ? '判定不侵权'
                    : item.result === 'INFRINGEMENT'
                      ? '确认侵权'
                      : item.result === 'NO_EVIDENCE'
                        ? '不取证并归档'
                        : item.result
                }}</span
              >
              <span v-if="item.reason"> · {{ item.reason }}</span>
            </li>
          </ol>
        </section>
        <section class="demo-card demo-card--pad lead-record-meta">
          <h2 class="form-section-title">记录信息</h2>
          <p class="mono">创建于 {{ formatTime(lead.createdAt) }}</p>
          <p class="mono">
            更新于 {{ formatTime(lead.updatedAt) }} · 版本 {{ lead.version }}
          </p>
          <p v-if="lead.pushedAt" class="mono" data-test="push-record">
            推送于 {{ formatTime(lead.pushedAt) }} · 操作人
            {{ lead.pushedByDisplayName || '已记录运营人员' }}
          </p>
        </section>
      </template>
    </main>
    <LeadQuickActionsPanel
      v-if="workflowOpen"
      :lead-id="String(route.params.id)"
      :identity="actorKey"
      :pending-push="pendingPush"
      @pending="readPending"
      @completed="workflowCompleted"
      @close="workflowOpen = false"
    />
    <MaterialPreviewDialog
      v-if="selectedScreenshot"
      :material-id="selectedScreenshot.materialId"
      :content-version-id="selectedScreenshot.versionId"
      :filename="selectedScreenshot.filename"
      :scope-key="requestScopeKey"
      @close="selectedScreenshot = undefined"
      @unavailable="handleScreenshotUnavailable"
    />
  </div>
</template>

<style scoped>
.lead-product-table {
  min-width: 940px;
  table-layout: fixed;
}
.lead-product-table .business-list-cell--text {
  min-width: 0;
}
.lead-product-text,
.lead-product-link-row a {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lead-product-link-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.lead-product-link-row a {
  flex: 1 1 auto;
}
.lead-product-link-row button {
  flex: 0 0 auto;
  border: 0;
  background: transparent;
  color: var(--color-primary);
  cursor: pointer;
}
.lead-estimate-note {
  margin: 4px 16px 10px;
}
.lead-detail-page .demo-detail-grid > div {
  padding-bottom: 8px;
}
.lead-unassigned-screenshots {
  margin: 8px 16px 14px;
  padding-top: 8px;
  border-top: 1px solid var(--color-hairline);
}
.lead-unassigned-screenshots h3 {
  margin: 0 0 4px;
  font-size: 14px;
}
.lead-unassigned-screenshots p {
  margin: 2px 0;
}
.lead-unassigned-screenshots ul {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
}
.lead-unassigned-screenshots li {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border: 1px solid var(--color-hairline);
  border-radius: 5px;
}
</style>
