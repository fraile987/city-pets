/* =========================================================
   CITY PETS — Servicio de correo (Fase D3)
   Aísla toda la lógica SMTP del controlador.
   Seguridad: NUNCA registra tokens, contraseñas, SMTP_PASS,
   cuerpos de peticiones ni enlaces de recuperación.
   ========================================================= */

const nodemailer = require('nodemailer');

/* Escapa valores del usuario para usarlos como texto/atributos en HTML. */
function escapeHtml(v) {
  return String(v).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function getMailConfig() {
  return {
    host: (process.env.SMTP_HOST || '').trim(),
    port: process.env.SMTP_PORT || '587',
    user: (process.env.SMTP_USER || '').trim(),
    pass: process.env.SMTP_PASS || '',
    from: (process.env.SMTP_FROM || '').trim(),
    appUrl: (process.env.APP_URL || '').trim()
  };
}

/* ¿Hay una vía real de envío? Solo importa que exista un host SMTP. */
function isMailConfigured() {
  return !!getMailConfig().host;
}

/* Valida la configuración mínima para poder enviar. No expone secretos. */
function validateMailConfig() {
  const { host, port, from, appUrl } = getMailConfig();
  const errors = [];
  if (!host) errors.push('SMTP_HOST no configurado');
  const p = Number(port);
  if (!Number.isInteger(p) || p < 1 || p > 65535) errors.push('SMTP_PORT inválido');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(from)) errors.push('SMTP_FROM inválido');
  if (!/^https?:\/\/.+/.test(appUrl)) errors.push('APP_URL inválida');
  return { ok: errors.length === 0, errors };
}

function createTransport(cfg) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: Number(cfg.port),
    secure: Number(cfg.port) === 465,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined
  });
}

/* Plantilla propia de City Pets (texto plano + HTML, nombre escapado). */
function buildMessage(name, resetLink) {
  const safeName = String(name || '').trim() || 'cliente';
  const subject = 'Restablece tu contraseña — City Pets';
  const text = [
    `Hola ${safeName}:`,
    '',
    'Recibimos una solicitud para restablecer la contraseña de tu cuenta en City Pets.',
    '',
    `Para crear una nueva contraseña, abre este enlace: ${resetLink}`,
    '',
    'Este enlace expira en 30 minutos.',
    'Si no solicitaste este cambio, ignora este correo: tu contraseña actual seguirá funcionando.',
    '',
    '— Equipo City Pets'
  ].join('\n');
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#1b2a41">
      <h2 style="color:#0b1f3a">City Pets</h2>
      <p>Hola <strong>${escapeHtml(safeName)}</strong>:</p>
      <p>Recibimos una solicitud para restablecer la contraseña de tu cuenta en City Pets.</p>
      <p style="margin:22px 0">
        <a href="${escapeHtml(resetLink)}" style="background:#c9a227;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:700">Restablecer contraseña</a>
      </p>
      <p style="font-size:.9rem">O copia este enlace en tu navegador: <code>${escapeHtml(resetLink)}</code></p>
      <p style="font-size:.85rem;color:#5d7290">Este enlace expira en 30 minutos. Si no solicitaste este cambio, ignora este correo: tu contraseña actual seguirá funcionando.</p>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:18px 0" />
      <p style="font-size:.8rem;color:#8fa2bb">— Equipo City Pets</p>
    </div>`;
  return { subject, text, html };
}

/* Envía el correo de recuperación. Devuelve { ok } sin lanzar errores con
   detalles sensibles hacia fuera. NUNCA registra contenido del mensaje. */
async function sendPasswordResetMail({ to, name, resetLink }) {
  const cfg = getMailConfig();
  if (!isMailConfigured()) return { ok: false, reason: 'not-configured' };
  const valid = validateMailConfig();
  if (!valid.ok) return { ok: false, reason: 'invalid-config' };
  if (!to || !resetLink) return { ok: false, reason: 'invalid-args' };

  const { subject, text, html } = buildMessage(name, resetLink);
  try {
    const transporter = createTransport(cfg);
    await transporter.sendMail({ from: cfg.from, to, subject, text, html });
    return { ok: true };
  } catch {
    return { ok: false, reason: 'send-failed' };
  }
}

module.exports = { isMailConfigured, validateMailConfig, sendPasswordResetMail, escapeHtml };