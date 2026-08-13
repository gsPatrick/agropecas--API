# Imagem única: não há passo de build (sem TypeScript, sem bundler) —
# instalar as dependências de produção e copiar o código já basta.
FROM node:20-alpine

WORKDIR /app

# libc6-compat evita falha do binário nativo do sharp em Alpine (musl)
RUN apk add --no-cache libc6-compat

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p uploads

ENV NODE_ENV=production
EXPOSE 3333

CMD ["node", "app.js"]
