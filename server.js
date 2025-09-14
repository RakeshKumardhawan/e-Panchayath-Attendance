const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());

app.get('/', (req, res) => {
  res.send('e-Panchayath Attendance Backend Running ✅');
});

// ఇక్కడ userId ఆధారంగా proxy చేస్తాం
app.get('/api/report', async (req, res) => {
  const uid = req.query.uid;
  if (!uid) {
    return res.status(400).json({ error: "User ID అవసరం" });
  }

  // ఉదాహరణకు: Telangana govt site కి fetch
  const fetch = (await import('node-fetch')).default;
  const url = `https://tgprepanchayat.telangana.gov.in/PSPerformance/home?Parameter1=${uid},2`;

  try {
    const resp = await fetch(url);
    const html = await resp.text();

    // ఇక్కడ HTML parse చేసి నీకు కావాల్సిన data మాత్రమే పంపాలి
    res.json({ user: uid, raw: html });
  } catch (e) {
    res.status(500).json({ error: "Fetch విఫలమైంది", details: e.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
