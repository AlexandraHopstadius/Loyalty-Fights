const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs/promises');
const PDFDocument = require('pdfkit');

const LOGO_PATH = path.join(__dirname, '..', 'public', 'assets', 'logo_design.png');
const INSTRUCTIONS_DIR = path.join(__dirname, '..', 'public', 'assets', 'docs');
const INSTRUCTION_FILES = {
  sv: path.join(INSTRUCTIONS_DIR, 'instructions_sv.pdf'),
  en: path.join(INSTRUCTIONS_DIR, 'instructions_en.pdf')
};
const DEFAULT_FILE_BASENAME = 'fightcard-links';

let transporter = null;
let missingConfigLogged = false;
let logoBufferPromise = null;
const instructionCache = new Map();

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

function resolveInstructionVariant(locale){
  const l = (locale || '').toLowerCase();
  if (l.startsWith('sv')) return 'sv';
  if (l.startsWith('en')) return 'en';
  if (l.startsWith('th')) return 'en';
  return 'sv';
}

async function loadInstructionsAttachment(locale){
  const variant = resolveInstructionVariant(locale);
  const filePath = INSTRUCTION_FILES[variant] || INSTRUCTION_FILES.en;
  if (!filePath) return null;
  if (!instructionCache.has(variant)){
    try{
      const content = await fs.readFile(filePath);
      const filename = variant === 'sv' ? 'instruktioner_sv.pdf' : 'instructions_en.pdf';
      instructionCache.set(variant, { filename, content });
    }catch(err){
      console.warn('[mail] Instructions PDF missing for variant', variant, err && err.message ? err.message : err);
      instructionCache.set(variant, null);
    }
  }
  const cached = instructionCache.get(variant);
  if (!cached || !cached.content) return null;
  return { filename: cached.filename, content: Buffer.from(cached.content) };
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
      const doc = new PDFDocument({ size: 'A4', margin: 56 });
      const buffers = [];
      doc.on('data', chunk => buffers.push(chunk));
      doc.on('error', reject);
      doc.on('end', ()=> resolve({ filename: fileBase + '.pdf', content: Buffer.concat(buffers) }));

      const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

      if (logoBuffer){
        const logoWidth = Math.min(usableWidth * 0.5, 220);
        const logoHeight = logoWidth * 0.48;
        const logoX = doc.page.margins.left + (usableWidth - logoWidth) / 2;
        const logoY = doc.y;
        doc.image(logoBuffer, logoX, logoY, { fit:[logoWidth, logoHeight] });
        doc.y = logoY + logoHeight + 24;
      }

      const headingHeight = 54;
      const headingX = doc.page.margins.left;
      const headingY = doc.y;
      doc.save();
      doc.roundedRect(headingX, headingY, usableWidth, headingHeight, 18).fill('#0f1d2b');
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(24).text('Fightcard-länkar', headingX + 24, headingY + 14, { lineBreak:false });
      doc.restore();
      doc.y = headingY + headingHeight + 20;

      doc.font('Helvetica').fontSize(12).fillColor('#4b5563').text('Alla länkar och QR-koder samlade för din klubb.', { align:'center' });
      doc.moveDown(1.2);
      doc.fillColor('#111');

      const metaPairs = [];
      if (clubName) metaPairs.push(['Klubb', clubName]);
      if (slug) metaPairs.push(['Kort-ID', slug]);
      if (token) metaPairs.push(['Adminlösenord', token]);
      const metaLines = [];
      if (viewerUrl) metaLines.push(['Publik länk', viewerUrl, true]);
      if (adminUrl) metaLines.push(['Admin länk', adminUrl, true]);

      const infoBoxPadding = 18;
      const infoBoxLineHeight = 22;
      const infoBoxHeight = infoBoxPadding * 2 + (metaPairs.length + metaLines.length) * infoBoxLineHeight + 10;
      const infoBoxX = doc.page.margins.left;
      const infoBoxY = doc.y;
      doc.save();
      doc.roundedRect(infoBoxX, infoBoxY, usableWidth, infoBoxHeight, 16).fill('#f8fafc');
      doc.restore();
      doc.y = infoBoxY + infoBoxPadding;

      metaPairs.forEach(([label, value]) => {
        doc.font('Helvetica-Bold').fillColor('#111').text(`${label}:`, { continued:true });
        doc.font('Helvetica').fillColor('#111').text(` ${value}`);
      });

      metaLines.forEach(([label, value, isLink]) => {
        doc.font('Helvetica-Bold').fillColor('#111').text(`${label}:`);
        if (isLink){
          doc.font('Helvetica').fillColor('#1d4ed8').text(value, { link: value, underline:true });
        } else {
          doc.font('Helvetica').fillColor('#111').text(value);
        }
        doc.moveDown(0.1);
      });
      doc.fillColor('#111');
      doc.y = infoBoxY + infoBoxHeight + 18;

      if (qrBuffer){
        const qrBlockPadding = 20;
        const qrSize = 170;
        const qrBlockHeight = qrSize + qrBlockPadding * 2 + 30;
        const qrBlockY = doc.y;
        doc.save();
        doc.roundedRect(doc.page.margins.left, qrBlockY, usableWidth, qrBlockHeight, 18).fill('#ffffff');
        doc.restore();
        const qrTitleY = qrBlockY + 16;
        doc.font('Helvetica-Bold').fontSize(12).fillColor('#111').text('QR-kod till publikvy:', doc.page.margins.left + qrBlockPadding, qrTitleY);
        const qrX = doc.page.margins.left + (usableWidth - qrSize) / 2;
        const qrY = qrTitleY + 18;
        doc.image(qrBuffer, qrX, qrY, { fit:[qrSize, qrSize] });
        doc.font('Helvetica').fontSize(10).fillColor('#4b5563').text('Dela QR-koden med publik och klubbar för snabb åtkomst.', doc.page.margins.left, qrY + qrSize + 16, { align:'center', width: usableWidth });
        doc.y = qrBlockY + qrBlockHeight;
      }

      doc.end();
    });
  }catch(err){
    console.warn('[mail] PDF generation failed:', err && err.message ? err.message : err);
    return null;
  }
}

async function sendRegistrationEmail({ to, clubName, viewerUrl, adminUrl, slug, expiresAt, adminToken, locale } = {}){
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
  const instructionsAttachment = await loadInstructionsAttachment(locale);
  const attachmentsList = [];
  if (pdfAttachment) attachmentsList.push(pdfAttachment);
  if (instructionsAttachment) attachmentsList.push(instructionsAttachment);
  const attachments = attachmentsList.length ? attachmentsList : undefined;
  const textParts = [
    `Hej ${name}!`,
    '',
    'Dina fightcardlänkar:',
    viewerUrl ? `• Publik: ${viewerUrl}` : '',
    adminUrl ? `• Admin: ${adminUrl}` : '',
    slug ? `• Kort-ID: ${slug}` : '',
    expireText ? `Länken gäller till: ${expireText}` : '',
    pdfAttachment ? 'En PDF med länkar och QR-kod finns bifogad.' : '',
    instructionsAttachment ? 'Instruktioner för arrangörer finns också bifogade som PDF.' : ''
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
  if (instructionsAttachment) htmlLines.push('<p>Du får även en instruktion-PDF med steg-för-steg-guide.</p>');
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
