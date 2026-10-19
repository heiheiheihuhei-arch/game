#!/bin/bash
# 第一批素材后期处理：去白底、盖印章、调淡地面、四周淡出到宣纸色。
# 用法：bash tools/art/process-001.sh（在工程根目录执行）
set -euo pipefail
RAW=art/raw
OUT=assets/art

source "$(dirname "$0")/lib.sh"

# 关羽立绘：去底后把右上角印章那一块直接改成全透明（用底色去盖会留下一块半透明的方框），再缩到高 800
ffmpeg -loglevel error -y -i $RAW/001-test/guanyu_portrait_2.png \
  -vf "$(key 251 245 237 3),drawbox=x=1370:y=100:w=170:h=220:color=black@0:t=fill:replace=1,scale=-1:800" \
  $OUT/heroes/guanyu/portrait.png

# 营帐、军旗
ffmpeg -loglevel error -y -i $RAW/001-test/prop_tent_1.png -vf "$(key 254 251 246 3),crop=1960:1400:80:440,scale=480:-1" $OUT/scene/tent.png
ffmpeg -loglevel error -y -i $RAW/001-test/prop_banner_1.png -vf "$(key 250 244 232 3),crop=976:1760:560:160,scale=-1:420" $OUT/scene/banner.png

# 地面：裁掉右下角的印章，和宣纸色（238,227,201）对半混合调淡，再从中心向四周淡出到纸色
P_R=238; P_G=227; P_B=201
FADE="clip(1.9-2.2*hypot(X-W/2,Y-H/2)/(W/2),0,1)"
mix() { echo "(${1}*(0.5*${FADE})+${2}*(1-0.5*${FADE}))"; }
ffmpeg -loglevel error -y -i $RAW/002-ground/ground_texture_1.png \
  -vf "crop=1880:1880:0:0,scale=1024:1024,geq=r='$(mix 'r(X,Y)' $P_R)':g='$(mix 'g(X,Y)' $P_G)':b='$(mix 'b(X,Y)' $P_B)'" \
  -q:v 3 $OUT/scene/ground_arena.jpg

ls -la $OUT/scene $OUT/heroes/guanyu
