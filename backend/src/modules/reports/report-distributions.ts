import { LeadCaseType, LeadPlatform } from '../../generated/prisma/enums';
import type { ReportDistributionsDto } from './reports-center.dto';

export type ReportDistributionFact = {
  caseType: LeadCaseType | null;
  platform: LeadPlatform | null;
  court: { id: string; name: string } | null;
};
export class InvalidReportDistributionError extends Error {
  constructor() {
    super('Invalid report distribution source');
    this.name = 'InvalidReportDistributionError';
  }
}
const binary = (a: string, b: string): number => (a === b ? 0 : a < b ? -1 : 1);
const categoryOrder = (a: string | null, b: string | null): number =>
  a === b ? 0 : a === null ? 1 : b === null ? -1 : binary(a, b);

export function reportDistributions(
  facts: readonly ReportDistributionFact[],
): ReportDistributionsDto {
  const types = new Map<LeadCaseType | null, number>();
  const platforms = new Map<LeadPlatform | null, number>();
  const courts = new Map<string, { id: string; name: string; count: number }>();
  let unrecordedCourtCases = 0;
  for (const fact of facts) {
    if (
      (fact.caseType !== null &&
        !Object.values(LeadCaseType).includes(fact.caseType)) ||
      (fact.platform !== null &&
        !Object.values(LeadPlatform).includes(fact.platform))
    )
      throw new InvalidReportDistributionError();
    types.set(fact.caseType, (types.get(fact.caseType) ?? 0) + 1);
    platforms.set(fact.platform, (platforms.get(fact.platform) ?? 0) + 1);
    if (fact.court === null) {
      unrecordedCourtCases++;
      continue;
    }
    const { id, name } = fact.court;
    if (
      typeof id !== 'string' ||
      id.trim().length === 0 ||
      typeof name !== 'string' ||
      name.trim().length === 0
    )
      throw new InvalidReportDistributionError();
    const previous = courts.get(id);
    if (previous && previous.name !== name)
      throw new InvalidReportDistributionError();
    courts.set(id, { id, name, count: (previous?.count ?? 0) + 1 });
  }
  return {
    types: [...types]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || categoryOrder(a.value, b.value)),
    platforms: [...platforms]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || categoryOrder(a.value, b.value)),
    courts: [...courts.values()]
      .sort((a, b) => b.count - a.count || binary(a.id, b.id))
      .slice(0, 5),
    unrecordedCourtCases,
  };
}
