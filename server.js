const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// مسار حفظ التطبيقات المرفوعة
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.ipa';
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 } // دعم حتى 500 ميجابايت
});

// استقبال ملف الـ IPA من واجهة الجوال
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'لم يتم استلام أي ملف' });
  }

  const host = req.get('host');
  const protocol = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  const downloadUrl = `${protocol}://${host}/download/${req.file.filename}`;

  res.json({ success: true, downloadUrl });
});

// تحميل ملف الـ IPA
app.get('/download/:filename', (req, res) => {
  const filePath = path.join(uploadDir, req.params.filename);
  if (fs.existsSync(filePath)) {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.download(filePath);
  } else {
    res.status(404).send('الملف غير موجود');
  }
});

// توليد ملف manifest.plist المباشر لخدمة itms-services
app.get('/manifest', (req, res) => {
  const { url, name, id } = req.query;

  if (!url || !name || !id) {
    return res.status(400).send('بيانات غير مكتملة');
  }

  const manifestXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>items</key>
  <array>
    <dict>
      <key>assets</key>
      <array>
        <dict>
          <key>kind</key>
          <string>software-package</string>
          <key>url</key>
          <string>${decodeURIComponent(url)}</string>
        </dict>
      </array>
      <key>metadata</key>
      <dict>
        <key>bundle-identifier</key>
        <string>${decodeURIComponent(id)}</string>
        <key>bundle-version</key>
        <string>1.0</string>
        <key>kind</key>
        <string>software</string>
        <key>title</key>
        <string>${decodeURIComponent(name)}</string>
      </dict>
    </dict>
  </array>
</dict>
</plist>`;

  res.setHeader('Content-Type', 'text/xml');
  res.send(manifestXml);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
