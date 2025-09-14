// src/routes/avatarRoutes.ts
import express, { type Request } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { uploadAvatar, removeAvatar, getAvatar } from "../controllers/AvatarController";
import { isAuthenticated } from "../middlewares/auth";

const router = express.Router();

// garante a pasta de upload
const UPLOAD_DIR = path.resolve(process.cwd(), "tmp", "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname) || "";
    cb(null, `avatar-${uniqueSuffix}${ext}`);
  },
});

// deixe o próprio Multer definir a assinatura do fileFilter
const fileFilter: multer.Options["fileFilter"] = (_req, file, cb) => {
  if (file.mimetype?.startsWith("image/")) {
    cb(null, true);
  } else {
    console.error("Arquivo rejeitado:", file.originalname, file.mimetype);
    cb(null, false); // rejeita silenciosamente arquivos não-imagem
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

router.post("/avatar/upload", isAuthenticated, upload.single("avatar"), uploadAvatar);
router.post("/avatar/remove", isAuthenticated, removeAvatar);
router.get("/:userId?/avatar", getAvatar);

export default router;
