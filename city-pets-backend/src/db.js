/* =========================================================
   CITY PETS — Conexión a la base de datos (Prisma + SQLite)
   ========================================================= */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

module.exports = prisma;