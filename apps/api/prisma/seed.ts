import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const password = await bcrypt.hash('triage123', 10);
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

  console.log('Seeded users (password: triage123):');
  users.forEach((u) => console.log(`  ${u.role}: ${u.email}`));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
