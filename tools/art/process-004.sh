#!/bin/bash
# 温酒斩华雄切入图：骑马冲锋劈砍（004 批次第 1 张），去白底后缩到宽 1000
set -euo pipefail
source "$(dirname "$0")/lib.sh"
ffmpeg -loglevel error -y -i art/raw/004-guanyu-mounted/guanyu_horse_a_1.png \
  -vf "$(key 250 243 237 3),$(edge_fade 80),scale=1000:-1" assets/art/heroes/guanyu/cutin.png
ls -la assets/art/heroes/guanyu/
