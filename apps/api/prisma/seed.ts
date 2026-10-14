import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

/**
 * DEVELOPMENT ONLY. Creates three demo users for local work.
 * Refuses to run when NODE_ENV=production, so demo accounts can never be
 * created in a real deployment. Use `npm run admin:create` there instead.
 */

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed demo users: NODE_ENV=production. Use `npm run admin:create`.');
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  const plain = process.env.SEED_PASSWORD || 'triage123';
  const password = await bcrypt.hash(plain, 12);
  const users = [
    { email: 'nurse@triagepulse.local', fullName: 'Test Nurse', role: UserRole.nurse },
    { email: 'physician@triagepulse.local', fullName: 'Test Physician', role: UserRole.physician },
    { email: 'admin@triagepulse.local', fullName: 'Test Admin', role: UserRole.admin },
  ];

  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        email: u.email,
        fullName: u.fullName,
        role: u.role,
        passwordHash: password,
      },
    });
  }

  console.log('Seeded local demo users:');
  users.forEach((u) => console.log(`  ${u.role}: ${u.email}`));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
