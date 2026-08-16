/* =========================================================
   CITY PETS — Controladores de autenticación
   ========================================================= */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../db');

const JWT_SECRET = process.env.JWT_SECRET;

function signToken(user) {
  return jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
}

/* Forma pública del usuario (nunca expone passwordHash). */
function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    phone: u.phone,
    email: u.email,
    address: u.address,
    role: u.role,
    channel: u.channel,
    createdAt: u.createdAt
  };
}

async function register(req, res) {
  const { name, phone, email, password, channel } = req.body;

  if (!name || !phone || !email || !password) {
    return res.status(400).json({ error: 'Completa nombre, móvil, correo y contraseña' });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    return res.status(409).json({ error: 'Ya existe una cuenta con ese correo' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const userChannel = channel || 'Directo';

  const user = await prisma.user.create({
    data: {
      name: name.trim(),
      phone: phone.trim(),
      email: normalizedEmail,
      passwordHash,
      channel: userChannel
    }
  });

  /* Registra la atribución del canal de entrada (mismo comportamiento que el prototipo). */
  await prisma.attribution.create({
    data: { userId: user.id, channel: userChannel }
  });

  res.status(201).json({ token: signToken(user), user: publicUser(user) });
}

async function login(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Indica correo y contraseña' });
  }

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user) {
    return res.status(401).json({ error: 'Correo o contraseña incorrectos' });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: 'Correo o contraseña incorrectos' });
  }

  res.json({ token: signToken(user), user: publicUser(user) });
}

async function me(req, res) {
  res.json({ user: publicUser(req.user) });
}

module.exports = { register, login, me };