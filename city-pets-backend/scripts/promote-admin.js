/* =========================================================
   CITY PETS — Script de promoción a administrador
   Uso: npm run promote -- <email>
   Es idempotente y no toca a los demás usuarios.
   ========================================================= */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const email = (process.argv[2] || '').trim().toLowerCase();
  if (!email) {
    console.error('Uso: npm run promote -- <email>');
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No existe un usuario con el correo ${email}`);
    process.exit(1);
  }

  if (user.role === 'admin') {
    console.log(`${email} ya es administrador.`);
  } else {
    await prisma.user.update({ where: { id: user.id }, data: { role: 'admin' } });
    console.log(`${email} promovido a administrador.`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});