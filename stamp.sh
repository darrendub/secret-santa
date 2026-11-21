#!/bin/sh
# Give styles/scripts a new version so phones fetch fresh copies after a publish.
v=$(date +%Y%m%d%H%M%S)
sed -i -E "s/\?v=[0-9]+/?v=$v/g" "$(dirname "$0")/index.html"
echo "stamped v=$v"
