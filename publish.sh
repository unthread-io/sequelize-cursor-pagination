#!/bin/bash
DIR=$(pwd)

set -e

npm run build
cp package.json package-lock.json README.md LICENSE ./build
cd build
npm publish --access public
cd $DIR
