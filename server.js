const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 8000;

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'public/signed');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

app.use(express.static('public'));
app.use(express.json());

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});
const upload = multer({ storage });

app.post('/api/sign', upload.fields([
  { name: 'ipa', maxCount: 1 },
  { name: 'p12', maxCount: 1 },
  { name: 'provision', maxCount: 1 }
]), async (req, res) => {
  try {
    const { password, bundleId, appName } = req.body;
    const ipaFile = req.files['ipa'] ? req.files['ipa'][0] : null;
    const p12File = req.files['p12'] ? req.files['p12'][0] : null;
    const provFile = req.files['provision'] ? req.files['provision'][0] : null;

    if (!ipaFile || !p12File || !provFile) {
      return res.status(400).json({ error: 'يرجى رفع ملف الـ IPA والشهادة (.p12) وملف الموبايل بروفجن.' });
    }

    const taskId = Date.now();
    const outputIpaName = `signed_${taskId}.ipa`;
    const outputIpaPath = path.join(OUTPUT_DIR, outputIpaName);

    let zsignCmd = `zsign -k "${p12File.path}" -p "${password || ''}" -m "${provFile.path}" -o "${outputIpaPath}"`;
    if (bundleId && bundleId.trim() !== '') {
      zsignCmd += ` -b "${bundleId.trim()}"`;
    }
    if (appName && appName.trim() !== '') {
      zsignCmd += ` -n "${appName.trim()}"`;
    }
    zsignCmd += ` "${ipaFile.path}"`;

    exec(zsignCmd, (error, stdout, stderr) => {
      try {
        fs.unlinkSync(ipaFile.path);
        fs.unlinkSync(p12File.path);
        fs.unlinkSync(provFile.path);
      } catch (e) {}

      if (error) {
        console.error('خطأ التوقيع:', stderr || stdout);
        return res.status(500).json({ error: 'فشلت عملية التوقيع. تأكد من كلمة مرور الشهادة ومطابقة الملفات.' });
      }

      const protocol = req.headers['x-forwarded-proto'] || req.protocol;
      const host = req.get('host');
      const hostUrl = `${protocol}://${host}`;
      const finalBundle = bundleId && bundleId.trim() !== '' ? bundleId.trim() : 'com.abdulelah.app';
      const finalTitle = appName && appName.trim() !== '' ? appName.trim() : 'تطبيق موقع';

      const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
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
                    <string>${hostUrl}/signed/${outputIpaName}</string>
                </dict>
            </array>
            <key>metadata</key>
            <dict>
                <key>bundle-identifier</key>
                <string>${finalBundle}</string>
                <key>bundle-version</key>
                <string>1.0</string>
                <key>kind</key>
                <string>software</string>
                <key>title</key>
                <string>${finalTitle}</string>
            </dict>
        </dict>
    </array>
</dict>
</plist>`;

      const plistName = `manifest_${taskId}.plist`;
      const plistPath = path.join(OUTPUT_DIR, plistName);
      fs.writeFileSync(plistPath, plistContent);

      const otaUrl = `itms-services://?action=download-manifest&url=${encodeURIComponent(`${hostUrl}/signed/${plistName}`)}`;

      return res.json({
        success: true,
        downloadUrl: `${hostUrl}/signed/${outputIpaName}`,
        otaUrl: otaUrl
      });
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'حدث خطأ في السيرفر.' });
  }
});

app.listen(PORT, () => {
  console.log(`السيرفر يعمل الآن على المنفذ: ${PORT}`);
});
