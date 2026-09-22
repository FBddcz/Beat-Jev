FROM node:22-alpine

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .

ENV NODE_ENV=production
ENV HOST=0.0.0.0
EXPOSE 8791

CMD ["npm", "start"]
