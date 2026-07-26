// Bootstraps the very first SUPER_ADMIN account on a brand-new database —
// there's no self-registration path to becoming an admin (POST /auth/register
// always creates STANDARD_USER, and is itself disabled unless
// OPEN_REGISTRATION=true), so a fresh deploy has no way to log in at all
// without this. Idempotent: safe to run on every deploy, skips if the
// account already exists. No-ops quietly if SEED_ADMIN_EMAIL/PASSWORD aren't
// set, so it's harmless on environments that don't want it.
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  const name = process.env.SEED_ADMIN_NAME || 'Admin';

  if (!email || !password) {
    console.log('[seed] SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set in .env — skipping admin bootstrap.');
    return;
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`[seed] User "${email}" already exists (role: ${existing.globalRole}) — skipping.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.create({
    data: { email, name, passwordHash, globalRole: 'SUPER_ADMIN' },
  });
  console.log(`[seed] Created SUPER_ADMIN user "${email}". Log in and change the password from Settings.`);
}

main()
  .catch((err) => {
    console.error('[seed] Failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
