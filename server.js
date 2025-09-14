// server.js - debug-friendly minimal server for Render
require('dotenv').config();
const express = require('express');
const cors = require('cors');

// Guard: try/catch around require of optional libs so startup won't crash silently
let axios, cheerio;
try {
  axios = require('axios');
  cheerio = require('cheerio');
} catch (e) {
  // We'll still start server, but note these libs missing
  console.warn('Optional modules missing (axios/cheerio). External fetch will fail until installed.', e.message);
}

const app = express();
app.use(cors());
app.use(express.json());

// Very first logs to ensure we see startup
console.log('*** BOOT START ***', new Date().toISOString());
console.log('NODE VERSION:', process.version);
console.log('ENV SAMPLE (PORT/TG_BASE):', { PORT: process.env.PORT || 'none', TG_BASE: process.env.TG_BASE || 'default' });

// Global handlers to surface otherwise-silent crashes to Render logs
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err && err.stack ? err.stack : err);
  // don't process.exit here so Render shows logs (but you can exit if desired)
});
process.on('unhandledRejection', (reason, p) => {
  console.error('UNHANDLED REJECTION at:', p, 'reason:', reason);
});

// Health check
app.get('/', (req, res) => res.send('✅ e-Panchayath backend running'));

// test route
app.get('/api/test', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// main route - guarded: if axios/cheerio not present we return message
app.get('/api/report', async (req, res) => {
  try {
    const uidRaw = String(req.query.uid || '').trim();
    const numericId = uidRaw.replace(/\D/g, '');
    if (!numericId) return res.status(400).json({ error: 'uid must contain digits' });

    if (!axios) {
      return res.status(500).json({ error: 'Server missing axios dependency. Please ensure package.json includes axios and redeploy.' });
    }

    const tgBase = process.env.TG_BASE || 'https://tgprepanchayat.telangana.gov.in';
    const tgPath = process.env.TG_PATH || '/PSPerformance/home';
    const param = `${numericId},2`;
    const externalUrl = `${tgBase.replace(/\/$/, '')}${tgPath}`;

    console.log('Calling external:', externalUrl, 'Parameter1=', param);

    const resp = await axios.get(externalUrl, {
      params: { Parameter1: param },
      timeout: 20000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; e-Panchayath/1.0)' },
      responseType: 'text'
    });

    const html = resp.data || '';
    const parsed = [];

    if (cheerio) {
      const $ = cheerio.load(html);
      const t = $('table').first();
      if (t && t.length) {
        const headers = [];
        t.find('tr').first().find('th,td').each((i, el) => headers.push($(el).text().trim().replace(/\s+/g, ' ')));
        t.find('tr').slice(1).each((i, tr) => {
          const row = {};
          $(tr).find('td').each((j, td) => {
            const key = headers[j] || `col${j}`;
            row[key] = $(td).text().trim();
          });
          if (Object.values(row).some(v => v)) parsed.push(row);
        });
      }
    }

    return res.json({ uid: numericId, external_url: `${externalUrl}?Parameter1=${param}`, parsed_count: parsed.length, rows: parsed, raw_length: html.length });
  } catch (err) {
    console.error('Error in /api/report handler:', err && err.stack ? err.stack : err);
    return res.status(500).json({ error: 'Server error fetching external', details: (err && err.message) || String(err) });
  }
});

// Listen once
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});