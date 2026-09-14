const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const appsFile = path.join(__dirname, 'apps.json');

app.get('/api/apps', (req, res) => {
  if (fs.existsSync(appsFile)) {
    try {
      const data = fs.readFileSync(appsFile, 'utf8');
      return res.json(JSON.parse(data));
    } catch (e) {
      return res.status(500).json({ error: 'خطأ في قراءة ملف التطبيقات' });
    }
  }
  res.json([]);
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
