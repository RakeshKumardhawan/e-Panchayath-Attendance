// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

// External base/path (TG site)
const TG_BASE = process.env.TG_BASE || 'https://tgprepanchayat.telangana.gov.in';
const TG_PATH = process.env.TG_PATH || '/PSPerformance/home'; // default path
const TG_TIMEOUT = parseInt(process.env.TG_TIMEOUT || '20000', 10);

// Helper: sanitize uid -> digits only
function extractDigits(uid) {
  return String(uid || '').replace(/\D/g, '');
}

// Helper: try to find the most relevant table and parse it to rows (array of objects)
function parseHtmlToRows(html) {
  const $ = cheerio.load(html);
  const tables = $('table');

  // If no tables, return empty
  if (!tables || tables.length === 0) return [];

  // choose the table with the most columns or with headers that match expected keywords
  let bestTable = null;
  let bestScore = -1;

  tables.each((i, t) => {
    const headers = [];
    // try th first, else first tr td text
    $(t).find('tr').first().find('th, td').each((j, cell) => {
      const txt = $(cell).text().trim();
      if (txt) headers.push(txt.toLowerCase());
    });

    // score based on expected words
    let score = 0;
    const expectedKeywords = ['mandal', 'panchayat', 'report', 'reporting', 'date', 'attendance', 'status', 'time', 'dsr'];
    headers.forEach(h => {
      expectedKeywords.forEach(k => { if (h.includes(k)) score += 1; });
    });

    // boost by number of headers
    score += headers.length * 0.1;

    if (score > bestScore) {
      bestScore = score;
      bestTable = t;
    }
  });

  if (!bestTable) return [];

  // build header names array (normalize)
  const headerEls = $(bestTable).find('tr').first().find('th, td');
  const headers = [];
  headerEls.each((i, cell) => {
    const txt = $(cell).text().trim();
    headers.push(txt);
  });

  // parse rows
  const rows = [];
  $(bestTable).find('tr').slice(1).each((i, tr) => {
    const cells = $(tr).find('td');
    if (cells.length === 0) return;
    const obj = {};
    cells.each((j, td) => {
      const keyRaw = headers[j] ? headers[j].trim() : `col${j}`;
      const key = keyRaw.replace(/\s+/g, '_').replace(/[^\w\-]/g, '').toLowerCase();
      obj[key] = $(td).text().trim();
    });
    // skip empty rows
    const any = Object.values(obj).some(v => v && v.length > 0);
    if (any) rows.push(obj);
  });

  return rows;
}

// Map parsed row object (with arbitrary keys) to our desired schema
function mapRowToSchema(parsedRow) {
  // try matching by keywords
  const keys = Object.keys(parsedRow);
  let mandal = '', panchayat = '', reporting = '', attStatus = '', attTime = '', dsr = '';

  keys.forEach(k => {
    const v = parsedRow[k] || '';
    const kl = k.toLowerCase();
    if (kl.includes('mandal')) mandal = v;
    else if (kl.includes('panchay')) panchayat = v;
    else if (kl.includes('report')) reporting = v;
    else if (kl.includes('date')) {
      // if reporting empty then set
      if (!reporting) reporting = v;
    }
    else if (kl.includes('time')) attTime = v;
    else if (kl.includes('attendance') || kl.includes('status')) {
      // if this column refers to attendance status vs DSR, we heuristically set
      if (kl.includes('dsr') || kl.includes('entry')) dsr = v;
      else attStatus = v;
    } else if (kl.includes('dsr')) dsr = v;
  });

  // fallback: if panchayat empty, try other likely columns
  if (!panchayat) {
    const alt = keys.find(k => /panch/i.test(k) || /gram/i.test(k));
    if (alt) panchayat = parsedRow[alt];
  }

  // normalize ReportingDate formatting if possible (try ISO)
  return {
    Mandal: mandal,
    Panchayat: panchayat,
    ReportingDate: reporting,
    AttendanceStatus: attStatus,
    AttendanceTime: attTime,
    DSR_Entry_Status: dsr
  };
}

// GET /api/report?uid=...&district=...&mandal=...
app.get('/api/report', async (req, res) => {
  try {
    let { uid = '', district = '', mandal = '' } = req.query;
    uid = String(uid || '').trim();
    // sanitize: digits only
    const numericId = extractDigits(uid);
    if (!numericId) return res.status(400).json({ error: 'uid must contain digits' });

    // build TG parameter Parameter1 = "<digits>,2"
    const param1 = `${numericId},2`;

    // Build full URL
    const externalUrl = `${TG_BASE.replace(/\/$/, '')}${TG_PATH}`;

    // call TG
    const resp = await axios.get(externalUrl, {
      params: { Parameter1: param1 },
      timeout: TG_TIMEOUT,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; e-Panchayath/1.0)'
      },
      responseType: 'text'
    });

    const contentType = (resp.headers['content-type'] || '').toLowerCase();
    // If JSON returned directly, return it (but TG likely returns HTML)
    if (contentType.includes('application/json') || contentType.includes('json')) {
      // if structure already fits, try to transform minimal
      const data = resp.data;
      // If data.rows exist, keep; otherwise try to map array -> desired
      if (Array.isArray(data)) {
        // try map each item
        const final = data.map((r, i) => ({ SNO: i+1, ...r }));
        return res.json({ uid: numericId, count: final.length, rows: final });
      } else if (data && Array.isArray(data.rows)) {
        const final = data.rows.map((r, i) => ({ SNO: i+1, ...r }));
        return res.json({ uid: numericId, count: final.length, rows: final });
      } else {
        return res.json({ uid: numericId, raw: data });
      }
    }

    // Otherwise parse HTML
    const html = resp.data;
    const parsedRows = parseHtmlToRows(html); // array of objects with header-based keys
    // map each parsed row to our schema
    const transformed = parsedRows.map(r => mapRowToSchema(r));
    // add SNO
    const finalRows = transformed.map((r, idx) => ({ SNO: idx + 1, ...r }));

    return res.json({ uid: numericId, external_url: `${externalUrl}?Parameter1=${param1}`, count: finalRows.length, rows: finalRows });
  } catch (err) {
    console.error('Error in /api/report:', err.message || err, err.response && err.response.status);
    if (err.response && err.response.data) {
      // send a helpful message
      return res.status(err.response.status || 500).json({ error: 'External site error', details: String(err.response.data).slice(0,500) });
    }
    return res.status(500).json({ error: 'Server error', details: err.message || String(err) });
  }
});

app.get('/', (req, res) => res.send('e-Panchayath backend running'));
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
