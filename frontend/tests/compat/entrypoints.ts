import ElementPlus, { ElSelect, ElTable, ElTransfer } from 'element-plus';
import * as CommonJsTypes from 'element-plus/lib';
import { ElSelect as Select } from 'element-plus/es/components/select/index.mjs';
import { ElTable as Table } from 'element-plus/es/components/table/index.mjs';
import type { GlobalComponents, GlobalDirectives } from 'vue';
import type { renderContent } from 'element-plus/es/components/transfer/index.mjs';
import type { SimpleFunctionalComponentProps } from 'element-plus/es/components/table-v2/src/types.mjs';

// Compile all public declarations, including both distribution formats.
export {
  ElementPlus,
  ElSelect,
  ElTable,
  ElTransfer,
  CommonJsTypes,
  Select,
  Table,
};

type Assert<T extends true> = T;
export type GlobalKeysRemainClosed = Assert<
  string extends keyof GlobalComponents ? false : true
>;
export type DirectiveKeysRemainClosed = Assert<
  string extends keyof GlobalDirectives ? false : true
>;
export const classValue: SimpleFunctionalComponentProps<object>['class'] = [
  'row',
  { active: true },
];
// @ts-expect-error Numeric class values must not be accepted by the declaration patch.
export const invalidClass: SimpleFunctionalComponentProps<object>['class'] = 123;
// @ts-expect-error Invalid component sizes must still be rejected after patching.
export const invalidSize: InstanceType<typeof ElSelect>['$props']['size'] =
  'huge';
// @ts-expect-error Table props must remain constrained as well.
export const invalidTableSize: InstanceType<typeof ElTable>['$props']['size'] =
  'huge';
export const renderTransfer: renderContent<{ key: string }> = (
  create,
  option,
) => {
  // @ts-expect-error The render function must retain Vue h overloads, not accept arbitrary values.
  create(123);
  return create('span', String(option.key));
};
