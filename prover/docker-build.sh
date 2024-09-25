#!/bin/bash
if [ -z "$1" ]; then
  DEFAULT_VALUE="latest" # set default
else
  DEFAULT_VALUE="$1" # use input
fi
# 检查是否安装了 Go 环境
check_go_installed() {
    if command -v go &> /dev/null; then
        go version
    else
        echo "please install golang"
        exit 1
    fi
}
check_go_installed
go build -o ./prover ./cmd/main.go
docker build -t padolabs/pado-brevis-prover:$DEFAULT_VALUE .
#docker push padolabs/pado-brevis-:$DEFAULT_VALUE