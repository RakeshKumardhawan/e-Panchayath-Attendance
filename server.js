// server.js - minimal express server suitable for Render
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
app.use(cors());
app.use(express.json());

// very first log so we can see startup in Render logs
console.log('Starting e-Panchayath backend...');

app.get('/', (req, res) => {
  res.send('e-Panchayath backend running ✅');
});

// Sample API expecting uid query param (we sanitize digits only)
app.get('/api/report', async (req, res) => {
  try {
    const uidRaw = String(req.query.uid || '').trim();
    const numericId = uidRaw.replace(/\D/g, '');
    if (!numericId) return res.status(400).json({ error: 'uid must contain digits' });

    const tgBase = process.env.TG_BASE || 'https://tgprepanchayat.telangana.gov.in';
    const tgPath = process.env.TG_PATH || '/PSPerformance/home';
    const param = `${numericId},2`;
    const externalUrl = `${tgBase.replace(/\/$/, '')}${tgPath}`;

    console.log('Calling external URL:', externalUrl, 'Parameter1=', param);

    const resp = await axios.get(externalUrl, {
      params: { Parameter1: param },
      timeout: 20000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; e-Panchayath/1.0)' },
      responseType: 'text'
    });

    const html = resp.data || '';
    // quick parse: try to extract table rows if any (basic)
    const $ = cheerio.load(html);
    const tables = $('table');
    const parsed = [];

    if (tables.length > 0) {
      const t = tables.first();
      // get headers
      const headers = [];
      t.find('tr').first().find('th,td').each((i, el) => {
        headers.push($(el).text().trim().replace(/\s+/g, ' '));
      });
      t.find('tr').slice(1).each((i, tr) => {
        const row = {};
        $(tr).find('td').each((j, td) => {
          const key = headers[j] || `col${j}`;
          row[key] = $(td).text().trim();
        });
        // only push non-empty rows
        if (Object.values(row).some(v => v)) parsed.push(row);
      });
    }

    // return JSON with raw html length and parsed rows (if any)
    return res.json({
      uid: numericId,
      external_url: `${externalUrl}?Parameter1=${param}`,
      parsed_count: parsed.length,
      rows: parsed,
      raw_length: html.length
    });

  } catch (err) {
    console.error('Error in /api/report:', err.message || err, err.response && err.response.status);
    if (err.response && err.response.data) {
      return res.status(err.response.status || 500).json({ error: 'External site error', details: String(err.response.data).slice(0,400) });
    }
    return res.status(500).json({ error: 'Server error', details: err.message || String(err) });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});