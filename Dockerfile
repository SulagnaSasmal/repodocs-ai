FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ENV NODE_ENV=production
ENV REPODOCS_CONTROL_PLANE_HOST=0.0.0.0
ENV REPODOCS_CONTROL_PLANE_PORT=4312

EXPOSE 4312

CMD ["npm", "run", "control-plane:start"]