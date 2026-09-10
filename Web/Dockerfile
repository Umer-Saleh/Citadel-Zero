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

# Demo-instance flag, same build-time story. It defaults to empty, so
# an ordinary build produces a bundle with no demo code in it at all —
# the guard folds to `false` and the bundler drops the branches rather
# than shipping them switched off.
#
# There were two more, VITE_DEMO_EMAIL and VITE_DEMO_PASSWORD, carrying
# the credentials of a shared demo account printed on the unlock
# screen. That account is gone: each visitor now provisions their own
# vault in the browser, under a key the server never sees, so there are
# no credentials to bake in. Nothing read them and no compose file
# passed them, and an ARG that looks live but reaches nothing is an
# invitation to wire something to it.
ARG VITE_DEMO_MODE=
ENV VITE_DEMO_MODE=$VITE_DEMO_MODE

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