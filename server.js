require("dotenv").config();
const express = require("express");
const multer = require("multer");
const { S3Client, PutObjectCommand ,DeleteObjectCommand} = require("@aws-sdk/client-s3");
const { Pool } = require("pg");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const port = process.env.PORT || 5000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:{
    rejectUnauthorized: false
  }
});

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const upload = multer({ dest: "uploads/" });

app.use(cors());
app.use(express.json());

app.post("/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const fileStream = fs.createReadStream(req.file.path);
  const fileKey = `${Date.now()}-${req.file.originalname}`;

  const uploadParams = {
    Bucket: process.env.AWS_BUCKET_NAME,
    Key: fileKey,
    Body: fileStream,
    ContentType: req.file.mimetype,
  };

  try {
    await s3.send(new PutObjectCommand(uploadParams));
    const fileUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.amazonaws.com/${fileKey}`;

    const result = await pool.query(
      "INSERT INTO assets (filename, url) VALUES ($1, $2) RETURNING *",
      [req.file.originalname, fileUrl]
    );

    fs.unlinkSync(req.file.path); 

    res.json({ message: "File uploaded", file: result.rows[0] });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: "Upload failed" });
  }
});

app.get("/upload", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM assets ORDER BY created_at DESC");
    res.json(result.rows);
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Failed to fetch files" });
  }
});

app.delete('/upload/:id', async (req, res) => {
    const { id } = req.params;
  
    try {
     
      const { rows } = await pool.query('SELECT url FROM assets WHERE id = $1', [id]);
      if (rows.length === 0) return res.status(404).json({ error: 'File not found' });
  
      const fileUrl = rows[0].url;
      const fileKey = fileUrl.split('/').pop(); 
  
      await s3.send(new DeleteObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: fileKey,
      }));
  
      
      await pool.query('DELETE FROM assets WHERE id = $1', [id]);
  
      res.json({ message: 'File deleted successfully' });
    } catch (error) {
      console.error('Delete Error:', error);
      res.status(500).json({ error: 'Failed to delete file' });
    }
  });

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
