/* =========================================================
   CITY PETS — Controladores de autenticación
   ========================================================= */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const prisma = require('../db');
const logger = require('../logger');
const { isMailConfigured, sendPasswordResetMail } = require('../services/mail');
const { CHANNELS, MAX, isEmail } = require('../constants');

const JWT_SECRET = process.env.JWT_SECRET;

/* Recuperación de contraseña (D1): expiración de 30 minutos. */
const RESET_TOKEN_TTL_MIN = 30;

/* Señal interna: el token ya fue reclamado por otra solicitud (concurrencia). */
class TokenConsumedError extends Error {}

/* Hash SHA-256 del token. En BD SOLO se guarda el hash, nunca el token en claro. */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/* Enlace de recuperación. Hasta que exista integración SMTP (fase posterior),
   solo se usa para devolver el enlace en desarrollo. */
function buildResetLink(token) {
  const base = (process.env.APP_URL || '').replace(/\/+$/, '');
  return `${base || 'http://localhost:3000'}/reset?token=${token}`;
}

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

/* ---------- Recuperación de contraseña (D1) ---------- */

const FORGOT_GENERIC = { message: 'Si el correo existe, recibirás un enlace de recuperación.' };

/* Solicitar recuperación: respuesta genérica (exista o no el correo) para
   evitar enumeración de usuarios. En desarrollo (NODE_ENV !== 'production')
   se devuelve resetLink para probar sin SMTP; en producción jamás se expone
   el token ni el enlace, y NO queda ningún token activo si no existe una vía
   real de envío (SMTP). */
async function forgot(req, res) {
  const rawEmail = req.body && typeof req.body.email === 'string' ? req.body.email.trim() : '';
  const email = rawEmail.toLowerCase();
  const isProd = process.env.NODE_ENV === 'production';

  if (!isEmail(email)) {
    return res.json(FORGOT_GENERIC);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return res.json(FORGOT_GENERIC);
  }

  /* Producción sin SMTP: no se crea ningún token utilizable que nunca se
     pudo enviar. Se responde genérico y se registra una advertencia segura. */
  if (isProd && !isMailConfigured()) {
    logger.warn('Recuperación: SMTP no configurado en producción', { path: '/api/auth/forgot' });
    return res.json(FORGOT_GENERIC);
  }

  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MIN * 60 * 1000);
  const resetLink = buildResetLink(token);

  try {
    /* Máximo un token activo por usuario: invalida tokens previos sin usar. */
    await prisma.$transaction([
      prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } }),
      prisma.passwordResetToken.create({ data: { tokenHash, userId: user.id, expiresAt } })
    ]);
  } catch (e) {
    logger.error('Recuperación: no se pudo crear el token', { path: '/api/auth/forgot' });
    return res.status(500).json({ message: 'No se pudo procesar la solicitud.' });
  }

  /* Envío SMTP si está configurado. */
  if (isMailConfigured()) {
    const result = await sendPasswordResetMail({ to: email, name: user.name, resetLink });
    if (!result.ok && isProd) {
      /* Producción: un token que no se pudo enviar NO debe quedar activo. */
      await prisma.passwordResetToken.deleteMany({ where: { tokenHash } });
      logger.warn('Recuperación: envío SMTP falló', { path: '/api/auth/forgot' });
      return res.json(FORGOT_GENERIC);
    }
    /* En desarrollo, aunque falle el envío, el resetLink sigue siendo usable. */
  }

  const out = { ...FORGOT_GENERIC };
  if (!isProd) {
    out.resetLink = resetLink;
  }
  return res.json(out);
}

/* Restablecer contraseña: token de un solo uso, atómico bajo concurrencia.
   El consumo del token (usedAt) y el cambio de passwordHash ocurren en una
   transacción; la reclamación es condicional (usedAt: null) para que con dos
   solicitudes simultáneas solo una tenga éxito. */
async function reset(req, res) {
  const token = req.body && typeof req.body.token === 'string' ? req.body.token : '';
  const newPassword = req.body && typeof req.body.newPassword === 'string' ? req.body.newPassword : '';

  if (!token || token.length > 128) {
    return res.status(400).json({ error: 'Token inválido' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  }

  const tokenHash = hashToken(token);
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
  if (!record) {
    return res.status(400).json({ error: 'Token inválido o expirado' });
  }
  if (record.usedAt) {
    return res.status(400).json({ error: 'Este enlace ya fue utilizado' });
  }
  if (record.expiresAt.getTime() <= Date.now()) {
    return res.status(400).json({ error: 'El enlace ha expirado' });
  }

  const newHash = await bcrypt.hash(newPassword, 10);
  try {
    await prisma.$transaction(async (tx) => {
      const claim = await tx.passwordResetToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: new Date() }
      });
      if (claim.count !== 1) {
        throw new TokenConsumedError();
      }
      await tx.user.update({ where: { id: record.userId }, data: { passwordHash: newHash } });
    });
  } catch (e) {
    if (e instanceof TokenConsumedError) {
      return res.status(400).json({ error: 'Este enlace ya fue utilizado' });
    }
    logger.error('Recuperación: error al restablecer', { path: '/api/auth/reset' });
    return res.status(500).json({ error: 'No se pudo restablecer la contraseña' });
  }

  return res.json({ message: 'Contraseña actualizada.' });
}

module.exports = { register, login, me, updateMe, forgot, reset };