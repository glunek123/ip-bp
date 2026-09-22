import { mount } from '@vue/test-utils';
import { defineComponent, ref, type Ref } from 'vue';
import {
  createMemoryHistory,
  createRouter,
  RouterView,
  type Router,
} from 'vue-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUnsavedForm } from './use-unsaved-form';

async function mountHarness(isDirty: Ref<boolean>): Promise<{
  router: Router;
  unmount: () => void;
}> {
  const FormPage = defineComponent({
    setup() {
      useUnsavedForm(isDirty);
      return () => 'form';
    },
  });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/form', component: FormPage },
      { path: '/next', component: defineComponent(() => () => 'next') },
    ],
  });
  await router.push('/form');
  await router.isReady();
  const wrapper = mount(RouterView, { global: { plugins: [router] } });

  return { router, unmount: () => wrapper.unmount() };
}

describe('useUnsavedForm', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('blocks dirty route navigation and allows a confirmed leave', async () => {
    const isDirty = ref(true);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { router, unmount } = await mountHarness(isDirty);

    await router.push('/next');
    expect(router.currentRoute.value.path).toBe('/form');

    confirm.mockReturnValue(true);
    await router.push('/next');
    expect(router.currentRoute.value.path).toBe('/next');
    unmount();
  });

  it('warns on browser unload only while the form is dirty', async () => {
    const isDirty = ref(false);
    const { unmount } = await mountHarness(isDirty);
    const cleanEvent = new Event('beforeunload', { cancelable: true });

    window.dispatchEvent(cleanEvent);
    expect(cleanEvent.defaultPrevented).toBe(false);

    isDirty.value = true;
    const dirtyEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirtyEvent);
    expect(dirtyEvent.defaultPrevented).toBe(true);
    unmount();
  });
});
