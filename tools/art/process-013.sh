#!/bin/bash
# 刮骨疗毒新特效（流光 + 八卦法阵）与大招收尾书法「斩」字（013 批次）
set -euo pipefail
R=art/raw/013-heal-zhan
python3 -I tools/art/prep.py glow $R/heal_rise_1.png assets/art/fx/heal_rise.png --width 360
python3 -I tools/art/prep.py glow $R/heal_seal_1.png assets/art/fx/heal_seal.png --width 420
python3 -I tools/art/prep.py prop $R/zhan_ink_2.png  assets/art/fx/zhan.png      --width 560
