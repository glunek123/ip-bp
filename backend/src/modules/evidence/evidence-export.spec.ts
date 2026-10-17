import { selectedEvidenceCsv } from './evidence-export';

describe('selected evidence CSV', () => {
  it('expands two paper records for one selected evidence item without taking the first one only', () => {
    const csv = selectedEvidenceCsv([
      {
        id: 'item-a',
        shopName: '=danger',
        stage: '已立案',
        lawyerName: 'Lin',
        displayCode: 'EV-A',
        shelfLocation: 'A3',
        status: 'IN_STOCK',
        remark: '备注',
        paperCertificates: [
          { id: 'paper-1', number: 'N1', status: 'NOT_ISSUED' },
          { id: 'paper-2', number: 'N2', status: 'MAILED_TO_LAWYER' },
        ],
      },
    ]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain("'=danger");
    expect(csv).toContain('"N1 [paper-1]","未出纸质证"');
    expect(csv).toContain('"N2 [paper-2]","纸质证邮寄律师"');
    expect(csv.trim().split('\r\n')).toHaveLength(3);
  });
});
