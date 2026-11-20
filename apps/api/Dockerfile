FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm install --workspace apps/api --include-workspace-root=false
COPY tsconfig.base.json ./
COPY apps/api apps/api
WORKDIR /app/apps/api
EXPOSE 3000
CMD ["npm", "start"]
