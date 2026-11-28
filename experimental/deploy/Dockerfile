FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Run as the unprivileged user the Node image provides, not root.
RUN mkdir -p /var/data/control-plane && chown -R node:node /app /var/data
USER node

ENV NODE_ENV=production
ENV REPODOCS_CONTROL_PLANE_HOST=0.0.0.0
ENV REPODOCS_CONTROL_PLANE_PORT=4312
ENV REPODOCS_CONTROL_PLANE_DATA_DIR=/var/data/control-plane

EXPOSE 4312

CMD ["npm", "run", "control-plane:start"]