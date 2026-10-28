import { applyRoutineProductLabels } from './routine-business-product';

it('keeps each exact screenshot reference while using the independent case product label', () => {
  const source = [
    {
      id: 'p',
      position: 1,
      title: '线索新名称',
      url: null,
      screenshots: [{ materialId: 'm', contentVersionId: 'v1' }],
    },
  ];
  const saved = [
    {
      id: 'p',
      position: 1,
      title: '案件原名称',
      url: null,
      quantity: 1,
      unitPrice: '2.00',
      commentCount: 0,
      estimatedAmount: '2.00',
    },
  ];
  expect(applyRoutineProductLabels(source, saved)).toEqual([
    { ...source[0], title: '案件原名称' },
  ]);
  expect(source[0]?.screenshots[0]?.contentVersionId).toBe('v1');
  expect(() =>
    applyRoutineProductLabels(source, [{ ...saved[0], id: 'other' }]),
  ).toThrow();
});
