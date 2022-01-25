FROM node:14.8.0-alpine as setup

WORKDIR /app/

COPY package*  /app/
COPY yarn.lock  /app/yarn.lock
COPY tsconfig.json  /app/tsconfig.json
RUN yarn install

FROM setup

COPY src /app/src

RUN yarn build

EXPOSE 4000

CMD ["node", "dist/index.js"]