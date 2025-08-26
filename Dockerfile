FROM apify/actor-node-playwright-chrome:latest

# Copy manifest first for better Docker layer caching
COPY package*.json ./

# Use npm install because we don't ship a lockfile in this template
RUN npm install --omit=dev

# Now copy the rest of the project
COPY . ./

CMD ["node", "src/main.js"]
