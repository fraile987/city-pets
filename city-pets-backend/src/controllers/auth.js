/* =========================================================
   CITY PETS — Controladores de autenticación
   ========================================================= */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../db');
const { CHANNELS, MAX, isEmail } = require('../constants');

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
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > MAX.name) {
    return res.status(400).json({ error: 'El nombre no es válido' });
  }
  if (typeof phone !== 'string' || phone.trim().length < 7 || phone.trim().length > MAX.phone) {
    return res.status(400).json({ error: 'El móvil no es válido' });
  }
  if (!isEmail(email)) {
    return res.status(400).json({ error: 'El correo no es válido' });
  }
  if (typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  }
  if (channel !== undefined && channel !== null && channel !== '' && !CHANNELS.includes(channel)) {
    return res.status(400).json({ error: 'Canal no válido' });
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
  const { email, password } = req.body || {};

  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
    return res.status(400).json({ error: 'Indica correo y contraseña válidos' });
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

async function updateMe(req, res) {
  const { name, phone, email, address } = req.body;
  const data = {};

  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > MAX.name) {
      return res.status(400).json({ error: 'El nombre no es válido' });
    }
    data.name = name.trim();
  }
  if (phone !== undefined) {
    if (typeof phone !== 'string' || phone.trim().length < 7 || phone.trim().length > MAX.phone) {
      return res.status(400).json({ error: 'El móvil no es válido' });
    }
    data.phone = phone.trim();
  }
  if (address !== undefined) data.address = typeof address === 'string' ? address.trim().slice(0, MAX.address) : '';
  if (email !== undefined) {
    if (!isEmail(email)) {
      return res.status(400).json({ error: 'El correo no es válido' });
    }
    const normalizedEmail = email.toLowerCase().trim();
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing && existing.id !== req.user.id) {
      return res.status(409).json({ error: 'Ya existe una cuenta con ese correo' });
    }
    data.email = normalizedEmail;
  }

  const user = await prisma.user.update({ where: { id: req.user.id }, data });
  res.json({ user: publicUser(user) });
}

module.exports = { register, login, me, updateMe };