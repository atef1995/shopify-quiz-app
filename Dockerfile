FROM node:20-alpine
RUN apk add --no-cache openssl

# Fly.io uses port 8080 by default
EXPOSE 8080

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY package.json package-lock.json* ./

RUN npm ci --omit=dev && npm cache clean --force

COPY . .

RUN npm run build

CMD ["npm", "run", "docker-start"]
