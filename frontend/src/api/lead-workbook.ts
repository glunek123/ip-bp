import {
  ApiError,
  getBlob,
  getJson,
  postTypedBinary,
  requestJson,
  type RequestOptions,
} from './http';
import type { LeadTableRecord } from '../modules/leads/lead-import-table';

export type LeadWorkbookSheet = { name: string; rows: LeadTableRecord[] };
export async function previewLeadWorkbook(
  file: Blob,
  options: RequestOptions = {},
): Promise<LeadWorkbookSheet[]> {
  const result = await postTypedBinary(
    '/leads/xlsx-preview',
    file,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    options,
  );
  if (
    !result ||
    typeof result !== 'object' ||
    !('sheets' in result) ||
    !Array.isArray(result.sheets)
  )
    throw new ApiError('Excel 预览响应无效', 200, 'INVALID_RESPONSE');
  return result.sheets.map((sheet: unknown) => {
    if (
      !sheet ||
      typeof sheet !== 'object' ||
      !('name' in sheet) ||
      typeof sheet.name !== 'string' ||
      !('rows' in sheet) ||
      !Array.isArray(sheet.rows)
    )
      throw new ApiError('Excel 工作表响应无效', 200, 'INVALID_RESPONSE');
    const rows = sheet.rows.map((row: unknown) => {
      if (
        !row ||
        typeof row !== 'object' ||
        !('rowNumber' in row) ||
        !Number.isSafeInteger(row.rowNumber) ||
        !('cells' in row) ||
        !Array.isArray(row.cells) ||
        !row.cells.every((cell: unknown) => typeof cell === 'string')
      )
        throw new ApiError('Excel 单元格响应无效', 200, 'INVALID_RESPONSE');
      return {
        rowNumber: row.rowNumber as number,
        cells: row.cells as string[],
      };
    });
    return { name: sheet.name, rows };
  });
}

export function downloadLeadWorkbookTemplate(options: RequestOptions = {}) {
  return getBlob('/leads/xlsx-template', options);
}

export type LeadImageImportTask = {
  id: string;
  rowNumber: number;
  productNumber: number;
  productId: string;
  url: string;
  status: 'PENDING' | 'LEASED' | 'STORED' | 'ATTACHED' | 'FAILED';
  failureCode: string | null;
  contentVersionId: string | null;
  createdAt: string;
  updatedAt: string;
};
export async function getLeadImageImports(
  leadId: string,
  options: RequestOptions = {},
): Promise<LeadImageImportTask[]> {
  const value = await getJson(
    `/leads/${encodeURIComponent(leadId)}/image-imports`,
    options,
  );
  if (
    !Array.isArray(value) ||
    !value.every(
      (task: unknown) =>
        task &&
        typeof task === 'object' &&
        'id' in task &&
        typeof task.id === 'string' &&
        'status' in task &&
        typeof task.status === 'string' &&
        'productId' in task &&
        typeof task.productId === 'string' &&
        'url' in task &&
        typeof task.url === 'string',
    )
  )
    throw new ApiError('图片任务响应无效', 200, 'INVALID_RESPONSE');
  return value as LeadImageImportTask[];
}
export function retryLeadImageImport(
  leadId: string,
  taskId: string,
  url: string,
  options: RequestOptions = {},
) {
  return requestJson(
    `/leads/${encodeURIComponent(leadId)}/image-imports/${encodeURIComponent(taskId)}/retry`,
    { ...options, method: 'POST', body: { url } },
  );
}
