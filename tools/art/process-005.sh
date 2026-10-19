#!/bin/bash
# 军营场景素材（005 批次）
set -euo pipefail
R=art/raw/005-camp
O=assets/art/scene
P="python3 -I tools/art/prep.py"
$P ground $R/ground_tile_1.png $O/ground_tile.jpg --size 512
$P prop $R/weapon_rack_1.png $O/weapon_rack.png --width 360
$P prop $R/fence_2.png      $O/fence.png       --width 600
$P prop $R/war_drum_1.png   $O/war_drum.png    --width 320
$P prop $R/hay_pile_1.png   $O/hay_pile.png    --width 360
$P prop $R/crates_1.png     $O/crates.png      --width 360
$P prop $R/rock_1.png       $O/rock_1.png      --width 380
$P prop $R/rock_2.png       $O/rock_2.png      --width 380
$P prop $R/pine_1.png       $O/pine_1.png      --height 480
$P prop $R/pine_2.png       $O/pine_2.png      --height 480
$P prop $R/big_tent_1.png   $O/big_tent.png    --width 560
ls -la $O

# 演武场地貌：从 002 批次地面图做成四周透明淡出
python3 -I tools/art/prep.py patch art/raw/002-ground/ground_texture_1.png assets/art/scene/ground_arena.png --size 768 --crop 0.9
