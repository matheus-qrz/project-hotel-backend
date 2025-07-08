import http from "http";
import app from "./app";
import { connectToDb } from "./config/db";
import dotenv from "dotenv";

dotenv.config();

const PORT = process.env.PORT || 3333;

async function startServer() {
    try {
        await connectToDb();
        const server = http.createServer(app);
        server.listen(PORT, () => {
            console.log(`🚀 Servidor rodando na porta ${PORT}`);
        });
    } catch (err) {
        console.error("❌ Erro ao iniciar servidor:", err);
        process.exit(1);
    }
}

startServer();
