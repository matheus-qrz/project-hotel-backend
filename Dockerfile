# Imagem base com Node + Debian (bom pra bcrypt, sharp, etc.)
FROM node:20-slim

# Define ambiente e diretório
ENV NODE_ENV=production
WORKDIR /backend/src/app

# Dependências de build para libs nativas (sharp, bcrypt, etc.)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

# Só copia os manifests primeiro (cache de dependências)
COPY package*.json ./

# Instala apenas dependências de produção
RUN npm install --omit=dev

# Copia o restante do código
COPY . .

# Build do TypeScript -> dist/
RUN npm run build

# Porta (ajusta se no seu server for outra)
EXPOSE 3333

# IMPORTANTE: seu server precisa respeitar process.env.PORT
# e usar ela no listen, tipo:
# app.listen(process.env.PORT || 4000, () => ...)
CMD ["node", "dist/start.js"]
