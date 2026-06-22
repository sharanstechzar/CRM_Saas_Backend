import express from "express";
import { protect } from "../middlewares/auth.middleware.js";
import fs from "fs";
import path from "path";
import multer from "multer";

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = "uploads/social";
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`);
  },
});
const uploadSocial = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

const router = express.Router();

// Existing download route
router.get("/download", protect, async (req, res) => {
  try {
    const { filePath } = req.query;
    
    if (!filePath) {
      return res.status(400).json({ message: "File path is required" });
    }

    // Security check: Ensure the file path is within your uploads directory
    const fullPath = path.join(process.cwd(), filePath);
    const uploadsDir = path.join(process.cwd(), 'uploads');
    
    if (!fullPath.startsWith(uploadsDir)) {
      return res.status(403).json({ message: "Access denied" });
    }

    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ message: "File not found" });
    }

    const fileName = path.basename(fullPath);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    
    const fileStream = fs.createReadStream(fullPath);
    fileStream.pipe(res);
  } catch (error) {
    console.error("File download error:", error);
    res.status(500).json({ message: "Server error" });
  }
});


router.get("/preview", protect, async (req, res) => {
  try {
    const { filePath } = req.query;
    
    if (!filePath) {
      return res.status(400).json({ message: "File path is required" });
    }

    // Security check: Ensure the file path is within your uploads directory
    const fullPath = path.join(process.cwd(), filePath);
    const uploadsDir = path.join(process.cwd(), 'uploads');
    
    if (!fullPath.startsWith(uploadsDir)) {
      return res.status(403).json({ message: "Access denied" });
    }

    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ message: "File not found" });
    }

    const fileName = path.basename(fullPath);
    const ext = path.extname(fullPath).toLowerCase();
    
    // Set proper content type for preview
    const contentTypes = {
      '.pdf': 'application/pdf',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.txt': 'text/plain',
      '.csv': 'text/csv',
      '.json': 'application/json',
      '.xml': 'application/xml',
    };
    
    const contentType = contentTypes[ext] || 'application/octet-stream';
    
    // KEY DIFFERENCE: Use 'inline' instead of 'attachment'
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    res.setHeader('Content-Type', contentType);
    
    // Optional: Add cache control for better performance
    res.setHeader('Cache-Control', 'public, max-age=3600');
    
    const fileStream = fs.createReadStream(fullPath);
    fileStream.pipe(res);
  } catch (error) {
    console.error("File preview error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// POST /files/upload — upload a single image for social posts
router.post("/upload", protect, uploadSocial.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ message: "No file provided" });
  const filePath = req.file.path.replace(/\\/g, "/").replace(/^\/+/, "");
  const BASE_URL = process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;
  res.json({ success: true, url: `${BASE_URL}/${filePath}`, filePath });
});

export default router;