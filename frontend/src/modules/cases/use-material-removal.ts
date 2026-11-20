import { ref } from 'vue';
import { deleteCaseMaterial } from '../../api/materials';
import type { CaseFile } from '../../api/cases';

/**
 * 案件材料的删除逻辑。各卡片共用，避免每张卡复制一份删除+确认+错误处理。
 * 调用方只需在模板里把返回的 remove 挂到按钮上。
 */
export function useMaterialRemoval(options: {
  caseId: () => string;
  onRemoved?: () => void;
  onError?: (message: string) => void;
  onSuccess?: (message: string) => void;
  busy?: () => boolean;
}) {
  const removing = ref(false);

  async function remove(file: CaseFile): Promise<void> {
    if (removing.value || options.busy?.()) return;
    const confirmed = window.confirm(
      `确认删除材料「${file.originalFilename}」？删除后不可恢复。`,
    );
    if (!confirmed) return;
    removing.value = true;
    try {
      await deleteCaseMaterial(options.caseId(), file.materialId);
      options.onSuccess?.('材料已删除');
      options.onRemoved?.();
    } catch {
      options.onError?.('删除失败，请稍后重试。');
    } finally {
      removing.value = false;
    }
  }

  return { remove, removing };
}
