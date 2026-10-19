#!/bin/bash
# 关羽技能特效（006 批次）：黑底发光图转透明
set -euo pipefail
R=art/raw/006-vfx-guanyu
O=assets/art/fx
P="python3 -I tools/art/prep.py glow"
$P $R/slash_light_1.png   $O/slash_light.png   --width 512
$P $R/slash_heavy_2.png   $O/slash_heavy.png   --width 560
$P $R/slash_ring_1.png    $O/slash_ring.png    --width 560
$P $R/blade_wave_1.png    $O/blade_wave.png    --width 600
$P $R/slash_streak_2.png  $O/slash_streak.png  --width 900
$P $R/cross_slash_1.png   $O/cross_slash.png   --width 420
$P $R/hit_spark_1.png     $O/hit_spark.png     --width 320
$P $R/heal_aura_1.png     $O/heal_aura.png     --width 420
$P $R/counter_slash_2.png $O/counter_slash.png --width 512
ls -la $O | awk '{print $5, $9}'
