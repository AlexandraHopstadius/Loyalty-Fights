const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs/promises');
const PDFDocument = require('pdfkit');

const LOGO_PATH = path.join(__dirname, '..', 'public', 'assets', 'logo_design.png');
const DEFAULT_FILE_BASENAME = 'fightcard-links';

let transporter = null;
let missingConfigLogged = false;
let logoBufferPromise = null;

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

function sanitizeFileBase(input){
  const base = (input || DEFAULT_FILE_BASENAME).toString().toLowerCase();
  const cleaned = base.replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
  return cleaned || DEFAULT_FILE_BASENAME;
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

async function loadLogoBuffer(){
  if (!logoBufferPromise){
    logoBufferPromise = fs.readFile(LOGO_PATH).catch(err => {
      console.warn('[mail] Logo image missing for PDF attachments:', err && err.message ? err.message : err);
      return null;
    });
  }
  return logoBufferPromise;
}

async function fetchQrBuffer(viewerUrl){
  if (!viewerUrl) return null;
  try{
    const qrEndpoint = 'https://api.qrserver.com/v1/create-qr-code/?size=360x360&data=' + encodeURIComponent(viewerUrl);
    const resp = await fetch(qrEndpoint);
    if (!resp.ok) throw new Error('QR fetch failed: '+resp.status);
    const arr = await resp.arrayBuffer();
    return Buffer.from(arr);
  }catch(err){
    console.warn('[mail] QR image fetch failed:', err && err.message ? err.message : err);
    return null;
  }
}

async function buildRegistrationPdf({ clubName, viewerUrl, adminUrl, token, slug } = {}){
  try{
    const [logoBuffer, qrBuffer] = await Promise.all([loadLogoBuffer(), fetchQrBuffer(viewerUrl)]);
    const fileBase = sanitizeFileBase(slug || clubName || DEFAULT_FILE_BASENAME);
    return await new Promise((resolve, reject)=>{
      const doc = new PDFDocument({ size: 'A4', margin: 48 });
      const buffers = [];
      doc.on('data', chunk => buffers.push(chunk));
      doc.on('error', reject);
      doc.on('end', ()=> resolve({ filename: fileBase + '.pdf', content: Buffer.concat(buffers) }));

      if (logoBuffer){
        const centerX = (doc.page.width - 160) / 2;
        doc.image(logoBuffer, Math.max(centerX, 50), doc.y, { fit:[160,90], align:'center' });
        doc.moveDown(1.2);
      }

      doc.font('Helvetica-Bold').fontSize(20).text('Fightcard-länkar', { align: 'center' });
      doc.moveDown(0.8);
      doc.font('Helvetica').fontSize(12).fillColor('#111');
      if (clubName) doc.text(`Klubb: ${clubName}`);
      if (slug) doc.text(`Kort-ID: ${slug}`);
      if (token) doc.text(`Adminlösenord: ${token}`);
      doc.moveDown(0.6);

      if (viewerUrl){
        doc.font('Helvetica-Bold').text('Publik länk:');
        doc.font('Helvetica').fillColor('#1d4ed8').text(viewerUrl, { link: viewerUrl, underline:true });
        doc.fillColor('#111');
        doc.moveDown(0.6);
      }
      if (adminUrl){
        doc.font('Helvetica-Bold').text('Admin länk:');
        doc.font('Helvetica').fillColor('#1d4ed8').text(adminUrl, { link: adminUrl, underline:true });
        doc.fillColor('#111');
        doc.moveDown(0.6);
      }

      if (qrBuffer){
        doc.font('Helvetica-Bold').text('QR-kod till publikvy:');
        const startY = doc.y + 6;
        doc.image(qrBuffer, doc.x, startY, { fit:[140,140] });
        doc.moveDown(7);
      }

      doc.end();
    });
  }catch(err){
    console.warn('[mail] PDF generation failed:', err && err.message ? err.message : err);
    return null;
  }
}

async function sendRegistrationEmail({ to, clubName, viewerUrl, adminUrl, slug, expiresAt, adminToken } = {}){
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
  const pdfAttachment = await buildRegistrationPdf({ clubName: name, viewerUrl, adminUrl, token: adminToken, slug });
  const attachments = pdfAttachment ? [pdfAttachment] : undefined;
  const textParts = [
    `Hej ${name}!`,
    '',
    'Dina fightcardlänkar:',
    viewerUrl ? `• Publik: ${viewerUrl}` : '',
    adminUrl ? `• Admin: ${adminUrl}` : '',
    slug ? `• Kort-ID: ${slug}` : '',
    expireText ? `Länken gäller till: ${expireText}` : '',
    pdfAttachment ? 'En PDF med länkar och QR-kod finns bifogad.' : ''
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
  if (pdfAttachment) htmlLines.push('<p>En PDF med länkar och QR-kod ligger bifogad.</p>');
  const html = htmlLines.join('');
  try{
    await mailer.sendMail({ from: fromAddress, to: email, subject, text, html, attachments });
    console.log('[mail] Registration email sent to', email);
    return true;
  }catch(err){
    console.warn('[mail] Failed to send registration email:', err && err.message ? err.message : err);
    return false;
  }
}

module.exports = { sendRegistrationEmail };
