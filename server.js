const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const AdmZip = require('adm-zip');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const uploadDir = path.join(__dirname, 'uploads');
const signedDir = path.join(__dirname, 'signed');
[uploadDir, signedDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// تجهيز أداة zsign داخل بيئة السيرفر تلقائياً إن لم تكن متوفرة
try {
  execSync('which zsign');
} catch (e) {
  try {
    execSync('apt-get update && apt-get install -y zsign || true');
  } catch (err) {}
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});

const upload = multer({
  storage,
  limits: { fileSize: 600 * 1024 * 1024 }
});

const cpUpload = upload.fields([
  { name: 'ipa', maxCount: 1 },
  { name: 'p12', maxCount: 1 },
  { name: 'provision', maxCount: 1 },
  { name: 'icon', maxCount: 1 }
]);

app.post('/api/sign-and-upload', cpUpload, async (req, res) => {
  try {
    const ipaFile = req.files['ipa'] ? req.files['ipa'][0] : null;
    const p12File = req.files['p12'] ? req.files['p12'][0] : null;
    const provFile = req.files['provision'] ? req.files['provision'][0] : null;
    const iconFile = req.files['icon'] ? req.files['icon'][0] : null;

    const p12Password = req.body.p12Password || '';
    const newAppName = req.body.appName || '';
    const newBundleId = req.body.bundleId || '';

    if (!ipaFile) return res.status(400).json({ error: 'ملف الـ IPA مطلوب' });

    let finalIpaPath = ipaFile.path;

    // استبدال الأيقونة إذا تم رفع صورة من الاستوديو
    if (iconFile) {
      try {
        const zip = new AdmZip(finalIpaPath);
        const zipEntries = zip.getEntries();
        const iconBuffer = fs.readFileSync(iconFile.path);

        zipEntries.forEach(entry => {
          if (entry.entryName.includes('.app/') && /AppIcon.*\.png$/i.test(entry.entryName)) {
            zip.updateFile(entry.entryName, iconBuffer);
          }
        });
        zip.writeZip(finalIpaPath);
      } catch (e) {
        console.error('خطأ أثناء حقن الصورة:', e);
      }
    }

    // مرحلة التوقيع الإلكتروني عبر zsign
    if (p12File && provFile) {
      const outputIpa = path.join(signedDir, `signed-${Date.now()}.ipa`);
      let cmd = `zsign -k "${p12File.path}" -m "${provFile.path}"`;
      if (p12Password) cmd += ` -p "${p12Password}"`;
      if (newAppName) cmd += ` -n "${newAppName}"`;
      if (newBundleId) cmd += ` -b "${newBundleId}"`;
      cmd += ` -o "${outputIpa}" "${finalIpaPath}"`;

      try {
        execSync(cmd);
        finalIpaPath = outputIpa;
      } catch (signErr) {
        return res.status(500).json({ error: 'فشل توقيع التطبيق، تأكد من صحة الشهادة وكلمة السر' });
      }
    }

    const host = req.get('host');
    const protocol = req.headers['x-forwarded-proto'] === 'https' ? 'https' : req.protocol;
    const downloadUrl = `${protocol}://${host}/download/${path.basename(finalIpaPath)}`;

    res.json({ success: true, downloadUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/download/:filename', (req, res) => {
  const filePath = fs.existsSync(path.join(signedDir, req.params.filename))
    ? path.join(signedDir, req.params.filename)
    : path.join(uploadDir, req.params.filename);

  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).send('الملف غير موجود');
  }
});

app.get('/manifest', (req, res) => {
  const { url, name, id } = req.query;
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
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
  res.send(manifest);
});

app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
