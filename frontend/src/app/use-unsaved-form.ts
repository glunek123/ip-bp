import { onBeforeUnmount, onMounted, type Ref } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';

export function useUnsavedForm(
  isDirty: Readonly<Ref<boolean>>,
  message = '当前填写内容尚未保存，确认离开吗？',
): void {
  onBeforeRouteLeave(
    () => !isDirty.value || globalThis.window.confirm(message),
  );

  const warnBeforeUnload = (event: BeforeUnloadEvent) => {
    if (!isDirty.value) return;

    event.preventDefault();
    event.returnValue = '';
  };

  onMounted(() =>
    globalThis.window.addEventListener('beforeunload', warnBeforeUnload),
  );
  onBeforeUnmount(() =>
    globalThis.window.removeEventListener('beforeunload', warnBeforeUnload),
  );
}
