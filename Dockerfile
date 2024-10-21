# Use the official Node.js 18 image as a parent image
FROM node:18-alpine

# Set the working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy the rest of your app's source code
COPY . .

# Compile TypeScript to JavaScript
RUN npm run build

# Expose the port your app runs on
EXPOSE 3000

# Run your app
CMD ["npm", "start"]