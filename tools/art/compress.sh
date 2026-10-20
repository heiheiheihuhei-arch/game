#!/bin/sh
# 压缩游戏里用的全部 PNG（逐帧动画很多，不压的话包体超微信 20MB 上限）。重新切帧后要再跑一次。
# 需要 pngquant：brew install pngquant
cd "$(dirname "$0")/../../assets/art" && find . -name "*.png" -print0 | xargs -0 -P 8 -n 20 pngquant --quality=70-92 --speed 3 --skip-if-larger --force --ext .png
du -sh .
