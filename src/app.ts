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

app.options('/login', (req, res) => {
    res.set({
        "Access-Control-Allow-Origin": "https://frontend-git-develop-seugarcomprods-projects.vercel.app/",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Credentials": "false"
    });
    res.sendStatus(204);
});

app.use(
    cors({
        origin: function (origin, callback) {
            const allowedOrigins = [
                "http://localhost:3000",
                "https://frontend-git-develop-seugarcomprods-projects.vercel.app/",
            ];
            if (!origin || allowedOrigins.includes(origin)) {
                callback(null, true);
            } else {
                console.error("❌ CORS bloqueado para origem:", origin);
                callback(new Error("Not allowed by CORS"));
            }
        },
        credentials: false,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization", "x-session-id"],
    })
);

app.use(cookieParser());
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ limit: '200mb', extended: true }));

app.use("/api-docs", swaggerUI.serve, swaggerUI.setup(swaggerJSDoc));
app.use(
  "/uploads",
  express.static(path.join(process.cwd(), "uploads"), {
    maxAge: "365d",
    immutable: true,
    setHeaders: (res) => {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    },
  })
);
app.use("/", router());

app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error(err.stack);
    res.status(500).json({ message: "Erro interno no servidor." });
});

export default app;
