FROM node:24-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Vite inlines VITE_* variables at BUILD time, not runtime — they end
# up as literals in the bundle. So the API URL has to be known here,
# which is why it's a build arg rather than an environment variable
# on the running container.
#
# This also means it is NOT a secret. Anything VITE_ is public the
# moment you ship the bundle.
ARG VITE_API_URL=http://localhost:3000
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

# ---------------------------------------------------------------

FROM nginx:alpine

# Static files only. Node isn't in the final image at all — nothing
# is executing JavaScript server-side here, so there's no reason to
# ship a runtime for it.
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]