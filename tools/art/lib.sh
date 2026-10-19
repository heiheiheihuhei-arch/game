#!/bin/bash
# 素材后期处理的公共函数，由各批次的处理脚本 source

# 白底转透明：越接近底色越透明；再把底色从半透明像素里扣掉，贴到宣纸上不会有白边
# 参数：底色 R G B，强度 K
key() {
  local br=$1 bg=$2 bb=$3 k=$4
  # 低于 4% 的透明度当作纯白底：去掉纸面噪点，PNG 才压得小
  local A="clip(((((${br}-r(X,Y))+(${bg}-g(X,Y))+(${bb}-b(X,Y)))*${k}/255)-0.04)/0.96,0,1)"
  echo "format=rgba,geq=r='if(gt(${A},0),clip((r(X,Y)-(1-${A})*${br})/max(${A},0.02),0,255),0)':g='if(gt(${A},0),clip((g(X,Y)-(1-${A})*${bg})/max(${A},0.02),0,255),0)':b='if(gt(${A},0),clip((b(X,Y)-(1-${A})*${bb})/max(${A},0.02),0,255),0)':a='255*${A}'"
}


# 四周渐隐：AI 生成图的纸张边缘常带一圈暗色纸纹，去底后会留下隐约的方框
# 参数：渐隐宽度（像素）
edge_fade() {
  local w=$1
  echo "geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*clip(min(min(X,W-1-X),min(Y,H-1-Y))/${w},0,1)'"
}
