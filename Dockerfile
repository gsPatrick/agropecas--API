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

# fixo em 80: é a porta padrão que o proxy do EasyPanel espera — o app lê
# APP_PORT (não a variável genérica PORT), então precisa vir explícito aqui
ENV NODE_ENV=production
ENV APP_PORT=80
EXPOSE 80

CMD ["node", "app.js"]
