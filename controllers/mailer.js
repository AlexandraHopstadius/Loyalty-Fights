const nodemailer = require('nodemailer');

let transporter = null;
let missingConfigLogged = false;

function createTransport(){
  if (transporter) return transporter;
  const host = process.env.BREVO_SMTP_HOST;
  const port = Number(process.env.BREVO_SMTP_PORT || 587);
  const user = process.env.BREVO_SMTP_USER;
  const pass = process.env.BREVO_SMTP_PASS;
  if (!host || !user || !pass || !process.env.BREVO_FROM){
    if (!missingConfigLogged){
      console.warn('[mail] Missing Brevo SMTP configuration; emails disabled');
      missingConfigLogged = true;
    }
    return null;
  }
  const secure = port === 465;
  transporter = nodemailer.createTransport({ host, port, secure, auth:{ user, pass } });
  return transporter;
}

function escapeHtml(str){
  return (str || '').replace(/[&<>]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;' }[c] || c));
}

function escapeAttr(str){
  return escapeHtml(str).replace(/"/g,'&quot;');
}

function formatExpiry(expiresAt){
  if (!expiresAt) return '';
  const dt = new Date(expiresAt);
  if (Number.isNaN(dt.getTime())) return '';
  try{
    return dt.toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' });
  }catch(_){
    return dt.toISOString();
  }
}

async function sendRegistrationEmail({ to, clubName, viewerUrl, adminUrl, slug, expiresAt } = {}){
  const mailer = createTransport();
  if (!mailer) return false;
  const email = (to || '').trim();
  if (!email){
    console.warn('[mail] No recipient email supplied for registration notification');
    return false;
  }
  const name = (clubName || '').trim() || 'Fightcard team';
  const expireText = formatExpiry(expiresAt);
  const fromName = process.env.BREVO_FROM_NAME ? `${process.env.BREVO_FROM_NAME}` : '';
  const fromAddress = fromName ? `${fromName} <${process.env.BREVO_FROM}>` : process.env.BREVO_FROM;
  const subject = 'Ditt fightcard är klart';
  const textParts = [
    `Hej ${name}!`,
    '',
    'Dina fightcardlänkar:',
    viewerUrl ? `• Publik: ${viewerUrl}` : '',
    adminUrl ? `• Admin: ${adminUrl}` : '',
    slug ? `• Kort-ID: ${slug}` : '',
    expireText ? `Länken gäller till: ${expireText}` : ''
  ].filter(Boolean);
  const text = textParts.join('\n');
  const htmlLines = [
    `<p>Hej ${escapeHtml(name)}!</p>`,
    '<p>Dina fightcardlänkar:</p>',
    '<ul>'
  ];
  if (viewerUrl) htmlLines.push(`<li><a href="${escapeAttr(viewerUrl)}" target="_blank" rel="noopener">Publikvy</a></li>`);
  if (adminUrl) htmlLines.push(`<li><a href="${escapeAttr(adminUrl)}" target="_blank" rel="noopener">Adminvy</a></li>`);
  if (slug) htmlLines.push(`<li>Kort-ID: ${escapeHtml(slug)}</li>`);
  htmlLines.push('</ul>');
  if (expireText) htmlLines.push(`<p>Länken gäller till: ${escapeHtml(expireText)}</p>`);
  const html = htmlLines.join('');
  try{
    await mailer.sendMail({ from: fromAddress, to: email, subject, text, html });
    console.log('[mail] Registration email sent to', email);
    return true;
  }catch(err){
    console.warn('[mail] Failed to send registration email:', err && err.message ? err.message : err);
    return false;
  }
}

module.exports = { sendRegistrationEmail };
