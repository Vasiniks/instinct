#!/bin/sh
# Launch Balatro through Balala with BlindDeck tuned for watching instead of raw bot speed.
# Without these, BlindDeck applies bot defaults: 10 fps animations, 4x game speed, reduced motion.
# (It always turns off CRT, bloom and shadows; that is not configurable.)
export BALATROBOT_ANIMATION_FPS="${BALATROBOT_ANIMATION_FPS:-60}"
export BALATROBOT_GAMESPEED="${BALATROBOT_GAMESPEED:-2}"
export BALATROBOT_NO_REDUCED_MOTION="${BALATROBOT_NO_REDUCED_MOTION:-1}"
exec "${BALALA:-$HOME/Desktop/Balala.app/Contents/MacOS/Balala}"
