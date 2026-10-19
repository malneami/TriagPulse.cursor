// First admin for a new server. Runs at container start (deploy/docker-entrypoint.sh).
//
// Creates one admin ONLY when the database has no active admin yet and both
// BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD are set. The account must change its
// password at first sign-in. It never changes an existing account, so leaving the
// variables set after the first start is harmless. Prints no password.
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || '';
const fullName = process.env.BOOTSTRAP_ADMIN_NAME?.trim() || 'Administrator';

if (!email || !password) process.exit(0);

const prisma = new PrismaClient();
try {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.endsWith('@triagepulse.local')) {
    throw new Error('BOOTSTRAP_ADMIN_EMAIL must be a real address.');
  }
  if (password.length < 16) throw new Error('BOOTSTRAP_ADMIN_PASSWORD must be at least 16 characters.');

  const admins = await prisma.user.count({ where: { role: 'admin', active: true } });
  if (admins > 0) {
    console.log('[bootstrap] An admin already exists; nothing to do.');
  } else if (await prisma.user.findUnique({ where: { email } })) {
    console.log(`[bootstrap] ${email} exists but is not an active admin; not changed.`);
  } else {
    await prisma.user.create({
      data: {
        email,
        fullName,
        role: 'admin',
        passwordHash: await bcrypt.hash(password, 12),
        mustChangePassword: true,
      },
    });
    console.log(`[bootstrap] First admin created: ${email} (must change password at first sign-in).`);
  }
} catch (err) {
  console.error(`[bootstrap] ${err.message}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
