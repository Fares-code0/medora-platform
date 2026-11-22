import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';

import { PrismaClient } from '../src/generated/prisma/client';
import { assertMultiHospitalSeedEnvironment, seedMultiHospital } from './seed/multihospital';

async function main(): Promise<void> {
  const connectionString = assertMultiHospitalSeedEnvironment();
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    await prisma.$connect();
    const counts = await seedMultiHospital(prisma);
    console.info('Multi-hospital development seed complete:', counts);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('Multi-hospital development seed failed:', error);
  process.exitCode = 1;
});
