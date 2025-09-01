import path from "path";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import swaggerUI from "swagger-ui-express";
import swaggerJSDoc from "./swagger.json";
import cookieParser from "cookie-parser";
import router from "./routes/index";

dotenv.config();

const app = express();

const allowedOrigins = [
  "http://localhost:3000",
  "https://seugarcom-frontend.vercel.app",
  "https://frontend-git-develop-seugarcomprods-projects.vercel.app",
];

const corsOptions: cors.CorsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);

    const vercelPreviewOk = /^https:\/\/frontend-git-[a-z0-9-]+-seugarcomprods-projects\.vercel\.app$/.test(
      origin,
    );

    if (allowedOrigins.includes(origin) || vercelPreviewOk) {
      return callback(null, true);
    }
    return callback(new Error(`Not allowed by CORS: ${origin}`));
  },
  credentials: true, // se usa cookies (ex.: NextAuth)
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-session-id"],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
// responde preflight para TODAS as rotas
app.options("*", cors(corsOptions));
/** -------------------------------------- */

app.use(cookieParser());
app.use(express.json({ limit: "200mb" }));
app.use(express.urlencoded({ limit: "200mb", extended: true }));

app.use("/api-docs", swaggerUI.serve, swaggerUI.setup(swaggerJSDoc));
app.use(
  "/uploads",
  express.static(path.join(process.cwd(), "uploads"), {
    maxAge: "365d",
    immutable: true,
    setHeaders: (res) => {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    },
  }),
);

app.use("/", router());

// handler de erro
app.use(
  (
    err: Error,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    console.error(err.stack);
    res.status(500).json({ message: "Erro interno no servidor." });
  },
);

export default app;
