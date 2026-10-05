import { randomUUID } from 'node:crypto';
import { coreLeadFixtures } from './core-lead-database.mjs';

export async function createLawyerAccountThroughApi(
  request,
  profile = {},
  headers = {
    Authorization: `Bearer ${coreLeadFixtures.tokenA}`,
  },
) {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 20);
  const username = `lawyer-${suffix}`;
  const password = `Lawyer-${suffix}-2026!`;
  const response = await request.post('/api/v1/lawyer-accounts', {
    headers,
    data: {
      fullName: profile.fullName ?? '承办律师',
      lawFirm: profile.lawFirm,
      phone: profile.phone,
      username,
      password,
    },
  });
  if (response.status() !== 201)
    throw new Error(
      `Create lawyer account failed: ${response.status()} ${await response.text()}`,
    );
  return { ...(await response.json()), password };
}
