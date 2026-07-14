FROM apify/actor-node:20 AS build

COPY package*.json ./
RUN npm ci --include=dev
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM apify/actor-node:20

COPY package*.json ./
RUN npm ci --omit=dev --omit=optional \
    && npm cache clean --force
COPY --from=build /usr/src/app/dist ./dist
COPY certs ./certs

ENV NODE_EXTRA_CA_CERTS=/usr/src/app/certs/root-yr-by-x1.pem

CMD ["npm", "start"]
