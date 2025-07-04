import http from "http";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import swaggerSpec from './swagger.json';
import swaggerJSDoc from "./swagger.json";
import swaggerUI from "swagger-ui-express";
import cookieParser from "cookie-parser";
import router from "./routes/index";
import { connectToDb } from "./config/db"; // Importa a função de conexão

// Configuração do dotenv
dotenv.config();

const app = express();

const origins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',')
    : ["http://localhost:3000", "http://127.0.0.1:3000"];

// Middlewares
app.use(
    cors({
        origin: origins,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
        credentials: true,
    })
);

app.use(cookieParser());
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ limit: '200mb', extended: true }));

// Documentação Swagger
app.use("/api-docs", swaggerUI.serve, swaggerUI.setup(swaggerJSDoc));

// Conecta ao banco de dados
connectToDb();

// Tratamento de erros global
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error(err.stack);
    res.status(500).json({ message: "Erro interno no servidor." });
});

// Rotas
app.use("/", router());

app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error(err.stack);
    res.status(500).json({ message: "Erro interno no servidor." });
});

// Inicialização do servidor
const PORT = process.env.PORT || 3333;
const server = http.createServer(app);
server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});