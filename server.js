// server.js - minimal express server for Render
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios'); // ensure installed

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => res.send('e-Panchayath backend running'));

// sample api - expects uid query param
app.get('/api/report', async (req, res) => {
  try {
    const uidRaw = String(req.query.uid || '');
    const numericId = uidRaw.replace(/\D/g, '');
    if (!numericId) return res.status(400).json({ error: 'uid must contain digits' });

    // Example: call external TG site (we just build URL)
    const externalUrl = `https://tgprepanchayat.telangana.gov.in/PSPerformance/home`;
    const param = `${numericId},2`;

    // make request (we expect HTML), keep timeout
    const resp = await axios.get(externalUrl, { params: { Parameter1: param }, timeout: 15000 });
    // send back basic info (you can parse resp.data later)
    return res.json({ uid: numericId, external_url: `${externalUrl}?Parameter1=${param}`, raw_length: (resp.data || '').length });
  } catch (err) {
    console.error('Error in /api/report:', err && err.message ? err.message : err);
    if (err.response) {
      return res.status(err.response.status || 500).json({ error: 'External error', details: String(err.response.data).slice(0,200) });
    }
    return res.status(500).json({ error: 'Server error', details: err.message || String(err) });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
