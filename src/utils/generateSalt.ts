// Funções auxiliares
import crypto from "crypto";

export const generateSalt = () => crypto.randomBytes(16).toString("hex");

export const generateHash = (password: string, salt: string) => {
    return crypto
        .createHmac("sha256", salt)
        .update(password)
        .digest("hex");
};