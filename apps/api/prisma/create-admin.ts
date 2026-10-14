import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

/**
 * Creates (or resets) one real user with a strong random password.
 * The password is printed once to the terminal and stored nowhere else.
 *
 * Usage (run against the target DATABASE_URL):
 *   ADMIN_EMAIL=you@hmg.example ADMIN_NAME="Dr Name" npm run admin:create
 *   ADMIN_ROLE=nurse ...   # optional: nurse | physician | admin (default admin)
 *   RESET=1 ...            # replace the password of an existing user
 */

const prisma = new PrismaClient();

function generatePassword(): string {
  // 24 characters from a URL-safe alphabet, ~143 bits of entropy.
  return randomBytes(18).toString('base64url');
}

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const fullName = process.env.ADMIN_NAME?.trim();
  const roleInput = (process.env.ADMIN_ROLE || 'admin').trim();
  const reset = process.env.RESET === '1';

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error('Set ADMIN_EMAIL to a valid email address.');
  }
  if (email.endsWith('@triagepulse.local')) {
    throw new Error('Demo addresses (@triagepulse.local) cannot be used for real accounts.');
  }
  if (!fullName) throw new Error('Set ADMIN_NAME (shown on triage records).');
  if (!Object.values(UserRole).includes(roleInput as UserRole)) {
    throw new Error(`ADMIN_ROLE must be one of: ${Object.values(UserRole).join(', ')}`);
  }
  const role = roleInput as UserRole;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && !reset) {
    throw new Error(`${email} already exists. Re-run with RESET=1 to issue a new password.`);
  }

  const password = generatePassword();
  const passwordHash = await bcrypt.hash(password, 12);

  if (existing) {
    await prisma.user.update({ where: { email }, data: { passwordHash, fullName, role } });
  } else {
    await prisma.user.create({ data: { email, fullName, role, passwordHash } });
  }

  console.log('');
  console.log(`  ${existing ? 'Password reset' : 'User created'}: ${email} (${role})`);
  console.log(`  One-time password: ${password}`);
  console.log('  Store it in a password manager now. It is not saved anywhere else.');
  console.log('');
}

main()
  .catch((err) => {
    console.error(`create-admin failed: ${(err as Error).message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
