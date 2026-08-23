FROM node:20-alpine

# Set the working directory
WORKDIR /usr/src/app

# Copy the server package.json and install dependencies
# We do this first to leverage Docker's layer caching for npm install
COPY server/package*.json ./server/
RUN cd server && npm ci --only=production

# Copy the rest of the application (frontend files and backend code)
COPY . .

# Set working directory to where the server runs
WORKDIR /usr/src/app/server

# Expose the port Cloud Run uses
EXPOSE 8080
ENV PORT=8080

# Start the Node.js application
CMD ["npm", "start"]

