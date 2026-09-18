<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../api/http';
import { getHealth } from '../api/health';

const state = ref<'loading' | 'ready' | 'failed'>('loading');
const message = ref('正在检查服务与数据库连接…');
const checkedAt = ref('尚未完成检查');
const requestId = ref<string>();
const backendReached = ref(false);
let activeRequest: AbortController | undefined;
const heading = computed(
  () =>
    ({ loading: '正在检查连接', ready: '连接正常', failed: '连接失败' })[
      state.value
    ],
);

async function checkConnection(): Promise<void> {
  activeRequest?.abort();
  const controller = new AbortController();
  activeRequest = controller;
  state.value = 'loading';
  message.value = '正在检查服务与数据库连接…';
  requestId.value = undefined;
  backendReached.value = false;
  try {
    await getHealth({ signal: controller.signal });
    if (controller.signal.aborted) return;
    backendReached.value = true;
    state.value = 'ready';
    message.value = '页面、服务与数据库之间的连接已确认。';
  } catch (error) {
    if (controller.signal.aborted) return;
    state.value = 'failed';
    message.value =
      error instanceof ApiError ? error.message : '检查未完成，请重试';
    backendReached.value =
      error instanceof ApiError &&
      error.status > 0 &&
      Boolean(error.requestId) &&
      /^[A-Z][A-Z0-9_]+$/.test(error.code);
    requestId.value = error instanceof ApiError ? error.requestId : undefined;
  } finally {
    if (!controller.signal.aborted)
      checkedAt.value = new Date().toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour12: false,
      });
  }
}

onMounted(() => {
  void checkConnection();
});
onBeforeUnmount(() => {
  activeRequest?.abort();
});
</script>

<template>
  <div class="page-shell">
    <header class="masthead">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">品知</span
        ><strong>品维·知产业务管理</strong>
      </div>
      <span class="environment-label">本地开发环境</span>
    </header>
    <main>
      <div class="page-heading">
        <p class="eyebrow">工程连接检查</p>
        <p class="intro">先确认连接，再开始工作。</p>
      </div>
      <section
        class="connection-panel"
        :data-state="state"
        aria-label="连接状态"
        :aria-busy="state === 'loading'"
      >
        <div class="status-summary" aria-live="polite">
          <span class="status-symbol" aria-hidden="true">{{
            state === 'ready' ? '✓' : state === 'failed' ? '!' : '…'
          }}</span>
          <div>
            <h1>{{ heading }}</h1>
            <p>{{ message }}</p>
          </div>
        </div>
        <dl class="connection-list">
          <div>
            <dt><span class="step">01</span>前端页面</dt>
            <dd>页面已加载</dd>
          </div>
          <div>
            <dt><span class="step">02</span>后端服务</dt>
            <dd>
              {{
                state === 'loading'
                  ? '检查中…'
                  : backendReached
                    ? '服务已响应'
                    : '连接失败'
              }}
            </dd>
          </div>
          <div>
            <dt><span class="step">03</span>数据库</dt>
            <dd>
              {{
                state === 'ready'
                  ? '数据库已连接'
                  : state === 'loading'
                    ? '检查中…'
                    : '连接未确认'
              }}
            </dd>
          </div>
        </dl>
        <footer class="panel-footer">
          <div class="check-time">
            <span>最近检查 · 上海时间</span><time>{{ checkedAt }}</time>
          </div>
          <ElButton
            type="primary"
            :loading="state === 'loading'"
            :disabled="state === 'loading'"
            @click="checkConnection"
            >重新检查</ElButton
          >
        </footer>
        <p v-if="requestId" class="request-id">请求编号：{{ requestId }}</p>
      </section>
      <aside class="scope-note">
        <span aria-hidden="true">—</span>
        <p>当前为工程基础页面。案件功能将在部门审核确认后逐步加入。</p>
      </aside>
    </main>
    <footer class="page-footer">
      <span>品维·知产业务管理系统</span><span>工程准备阶段</span>
    </footer>
  </div>
</template>

<style scoped>
.page-shell {
  max-width: 960px;
  min-height: 100vh;
  margin: 0 auto;
  padding: 0 40px;
  display: flex;
  flex-direction: column;
}
.masthead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 88px;
  border-bottom: 1px solid var(--color-hairline);
  gap: 16px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  letter-spacing: 0.03em;
}
.brand-mark {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: 1px solid var(--color-hairline);
  border-radius: 7px;
  font-weight: 700;
  color: var(--color-primary);
}
.environment-label {
  color: var(--color-ink-muted);
  font-size: 12px;
}
main {
  width: 100%;
  max-width: 680px;
  margin: 64px auto 72px;
}
.eyebrow {
  margin: 0;
  color: var(--color-ink-muted);
  font-size: 13px;
  letter-spacing: 0.08em;
}
.intro {
  margin: 10px 0 28px;
  font-size: 24px;
  font-weight: 600;
  letter-spacing: -0.03em;
}
.connection-panel {
  background: var(--color-surface-1);
  border: 1px solid var(--color-hairline);
  border-radius: 10px;
  overflow: hidden;
}
.status-summary {
  display: flex;
  gap: 18px;
  padding: 32px;
  align-items: center;
}
.status-symbol {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  height: 44px;
  width: 44px;
  border: 1px solid currentColor;
  border-radius: 50%;
  font-size: 22px;
  color: var(--color-primary);
}
[data-state='ready'] .status-symbol {
  color: var(--color-success);
}
[data-state='failed'] .status-symbol {
  color: var(--color-danger);
}
h1 {
  margin: 0;
  font-size: 22px;
  letter-spacing: -0.02em;
  font-weight: 600;
}
.status-summary p {
  margin: 6px 0 0;
  color: var(--color-ink-muted);
}
.connection-list {
  margin: 0 32px 12px;
}
.connection-list > div {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  padding: 17px 0;
  border-top: 1px solid var(--color-hairline);
}
dt {
  display: flex;
  gap: 16px;
  align-items: center;
}
dd {
  margin: 0;
  color: var(--color-ink-muted);
  text-align: right;
}
.step {
  font: 12px var(--font-mono);
  color: var(--color-ink-muted);
}
.panel-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  background: var(--color-canvas);
  border-top: 1px solid var(--color-hairline);
  padding: 22px 32px;
}
.check-time {
  display: grid;
  gap: 3px;
  font-size: 12px;
  color: var(--color-ink-muted);
}
time {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}
.request-id {
  margin: 0;
  padding: 0 32px 18px;
  font: 11px var(--font-mono);
  overflow-wrap: anywhere;
  color: var(--color-ink-muted);
  background: var(--color-canvas);
}
.scope-note {
  display: flex;
  gap: 12px;
  margin-top: 22px;
  font-size: 12px;
  color: var(--color-ink-muted);
}
.scope-note p {
  margin: 0;
}
.page-footer {
  display: flex;
  justify-content: space-between;
  padding: 22px 0;
  margin-top: auto;
  border-top: 1px solid var(--color-hairline);
  font-size: 11px;
  color: var(--color-ink-muted);
}
@media (max-width: 600px) {
  .page-shell {
    padding: 0 20px;
  }
  .masthead {
    min-height: 72px;
  }
  .environment-label {
    font-size: 11px;
  }
  main {
    margin: 40px auto;
  }
  .intro {
    font-size: 21px;
  }
  .status-summary {
    padding: 24px 20px;
    gap: 14px;
    align-items: flex-start;
  }
  .status-summary p {
    font-size: 13px;
  }
  .connection-list {
    margin: 0 20px 10px;
  }
  .panel-footer {
    padding: 20px;
  }
  .request-id {
    padding: 0 20px 16px;
  }
}
</style>
