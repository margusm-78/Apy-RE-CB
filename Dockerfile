FROM apify/actor-node-playwright-chrome:latest

# Copy files
COPY package*.json ./
RUN npm ci --omit=dev

COPY . ./

CMD ["node", "src/main.js"]
