import mongoose from "mongoose";
import dotenv from "dotenv";

// Carrega as variáveis de ambiente do arquivo .env
dotenv.config({ path: ".env" });

// URI do MongoDB (usando variável de ambiente)
const uri = process.env.MONGODB_URI;

if (!uri) {
    console.error("A URI do MongoDB não está configurada no arquivo config.env.");
    process.exit(1);
}

// Função para conectar ao banco de dados
const connectToDb = async () => {
    try {
        await mongoose.connect(uri, {
            autoIndex: true, // Habilita a criação automática de índices
        });

        console.log("Conectado ao MongoDB com sucesso.");
    } catch (error) {
        console.error("Erro na conexão com o MongoDB:", error);
        process.exit(1);
    }
};

// Listeners para eventos de conexão
mongoose.connection.on("connected", () => {
    console.log("Mongoose conectado ao MongoDB.");
});

mongoose.connection.on("error", (err) => {
    console.error("Erro na conexão do Mongoose:", err);
});

mongoose.connection.on("disconnected", () => {
    console.log("Mongoose desconectado do MongoDB.");
});

// Exporta a função de conexão e a instância do Mongoose
export { connectToDb, mongoose };