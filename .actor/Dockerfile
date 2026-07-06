FROM apify/actor-node:20

COPY package*.json ./
RUN npm --quiet set progress=false \
    && npm install --omit=dev --omit=optional

COPY . ./
ENV NODE_EXTRA_CA_CERTS=/usr/src/app/certs/root-yr-by-x1.pem

RUN npm install --include=dev \
    && npm run build

CMD ["npm", "start"]
