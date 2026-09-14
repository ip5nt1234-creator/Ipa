const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { execSync } = require('child_process');
const AdmZip = require('adm-zip');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const uploadDir = path.join(__dirname, 'uploads');
const signedDir = path.join(__dirname, 'signed');
const certDir = path.join(__dirname, 'certs');
[uploadDir, signedDir, certDir].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// تنزيل أداة zsign تلقائياً داخل سيرفر Render
try {
  execSync('which zsign');
} catch (e) {
  try {
    execSync('apt-get update && apt-get install -y zsign || true');
  } catch (err) {}
}

// دالة لجلب ملف عبر الرابط وحفظه تلقائياً
function downloadRemoteFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        return downloadRemoteFile(response.headers.location, dest).then(resolve).catch(reject);
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`)
});

const upload = multer({
  storage,
  limits: { fileSize: 600 * 1024 * 1024 }
});

const cpUpload = upload.fields([
  { name: 'ipa', maxCount: 1 },
  { name: 'icon', maxCount: 1 }
]);

app.post('/api/sign-and-upload', cpUpload, async (req, res) => {
  try {
    const ipaFile = req.files['ipa'] ? req.files['ipa'][0] : null;
    const iconFile = req.files['icon'] ? req.files['icon'][0] : null;
    const newAppName = req.body.appName || '';
    const newBundleId = req.body.bundleId || '';

    if (!ipaFile) return res.status(400).json({ error: 'يرجى اختيار ملف IPA' });

    let finalIpaPath = ipaFile.path;

    // حقن الصورة الجديدة من الألبوم كأيقونة
    if (iconFile) {
      try {
        const zip = new AdmZip(finalIpaPath);
        const iconBuffer = fs.readFileSync(iconFile.path);
        zip.getEntries().forEach(entry => {
          if (entry.entryName.includes('.app/') && /AppIcon.*\.png$/i.test(entry.entryName)) {
            zip.updateFile(entry.entryName, iconBuffer);
          }
        });
        zip.writeZip(finalIpaPath);
      } catch (iconErr) {
        console.error('خطأ الأيقونة:', iconErr);
      }
    }

    const p12Path = path.join(certDir, 'cert.p12');
    const provPath = path.join(certDir, 'cert.mobileprovision');
    const p12Password = '1';

    // توقيع التطبيق إذا توفرت الشهادة
    if (fs.existsSync(p12Path) && fs.existsSync(provPath)) {
      const outputIpa = path.join(signedDir, `signed-${Date.now()}.ipa`);
      let cmd = `zsign -k "${p12Path}" -m "${provPath}" -p "${p12Password}"`;
      if (newAppName) cmd += ` -n "${newAppName}"`;
      if (newBundleId) cmd += ` -b "${newBundleId}"`;
      cmd += ` -o "${outputIpa}" "${finalIpaPath}"`;

      try {
        execSync(cmd);
        finalIpaPath = outputIpa;
      } catch (signErr) {
        console.error('تنبيه التوقيع:', signErr);
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

app.listen(PORT, () => console.log(`Server live on ${PORT}`));
