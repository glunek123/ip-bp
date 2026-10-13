import type { LeadProduct } from '../../api/leads';

export type LeadProductSummary = {
  quantityTotal: string;
  commentTotal: string;
  estimatedAmount: string;
  firstUnitPrice: string | null;
};

function cents(value: string): bigint {
  if (!/^(0|[1-9]\d{0,15})(\.\d{1,2})?$/u.test(value)) {
    throw new RangeError('Invalid recorded money amount');
  }
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
}

function count(value: number): bigint {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('Invalid recorded count');
  }
  return BigInt(value);
}

export function summarizeLeadProducts(
  products: readonly LeadProduct[],
): LeadProductSummary {
  let quantity = 0n;
  let comments = 0n;
  let estimated = 0n;
  let first: LeadProduct | undefined;
  for (const product of products) {
    quantity += count(product.quantity);
    comments += count(product.commentCount);
    estimated += cents(product.estimatedAmount);
    if (first === undefined || product.position < first.position)
      first = product;
  }
  return {
    quantityTotal: quantity.toString(),
    commentTotal: comments.toString(),
    estimatedAmount: `${estimated / 100n}.${String(estimated % 100n).padStart(2, '0')}`,
    firstUnitPrice: first?.unitPrice ?? null,
  };
}
