import { ref } from 'vue';
import { deleteCaseMaterial } from '../../api/materials';
import type { CaseFile } from '../../api/cases';

/**
 * 案件材料的删除逻辑。各卡片共用：
 * - 删除前二次确认
 * - 成功后本地摘除该材料（父组件 props 不会随 refresh 立即更新）
 * - 成功/失败统一弹窗提示
 */
export function useMaterialRemoval(options: {
  caseId: () => string;
  onRemoved?: () => void;
  busy?: () => boolean;
}) {
  const removing = ref(false);
  const removedIds = ref<Set<string>>(new Set());

  function isRemoved(file: CaseFile): boolean {
    return removedIds.value.has(file.materialId);
  }

  async function remove(file: CaseFile): Promise<void> {
    if (removing.value || options.busy?.() || isRemoved(file)) return;
    const confirmed = window.confirm(
      `确认删除材料「${file.originalFilename}」？删除后不可恢复。`,
    );
    if (!confirmed) return;
    removing.value = true;
    try {
      await deleteCaseMaterial(options.caseId(), file.materialId);
      removedIds.value = new Set([...removedIds.value, file.materialId]);
      window.alert('材料已删除');
      options.onRemoved?.();
    } catch {
      window.alert('删除失败，请稍后重试。');
    } finally {
      removing.value = false;
    }
  }

  return { remove, removing, isRemoved };
}
