import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import swaggerUI from "swagger-ui-express";
import swaggerJSDoc from "./swagger.json";
import cookieParser from "cookie-parser";
import router from "./routes/index";

dotenv.config();

const app = express();

// Pré-flight
app.options('*', cors({
    origin: function (origin, callback) {
        const allowedOrigins = process.env.CORS_ORIGIN?.split(',') || [
            "http://localhost:3000",
            "https://seugarcom-prod.vercel.app",
        ];
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            console.error("❌ Pré-flight bloqueado para origem:", origin);
            callback(new Error("Not allowed by CORS"));
        }
    },
    credentials: true
}));

app.use(
    cors({
        origin: function (origin, callback) {
            const allowedOrigins = process.env.CORS_ORIGIN?.split(',') || [
                "http://localhost:3000",
                "https://seugarcom-prod.vercel.app",
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
        allowedHeaders: ["Content-Type", "Authorization"],
    })
);

app.use(cookieParser());
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ limit: '200mb', extended: true }));

app.use("/api-docs", swaggerUI.serve, swaggerUI.setup(swaggerJSDoc));
app.use("/", router());

app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error(err.stack);
    res.status(500).json({ message: "Erro interno no servidor." });
});

export default app;
