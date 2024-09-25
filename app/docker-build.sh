#!/bin/bash
if [ -z "$1" ]; then
  DEFAULT_VALUE="latest" # set default
else
  DEFAULT_VALUE="$1" # use input
fi
npm install -g pkg
npm install
npm run build
pkg . --output dist/pado-brevis-app
docker build -t padolabs/pado-brevis-app:$DEFAULT_VALUE .
#docker push padolabs/pado-brevis-:$DEFAULT_VALUE