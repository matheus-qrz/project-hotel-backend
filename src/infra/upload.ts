import multer from "multer";

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|webp|avif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error("Tipo de arquivo não suportado.")); // trate no seu error handler
  },
});