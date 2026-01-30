# Hotzone: Level Editor for Uprising Join or Die

<img width="1590" height="898" alt="image" src="https://github.com/user-attachments/assets/bd297bec-f69a-45c9-8659-d6c411429379" />

A level editor created to view the level files of the game Uprising Join or Die. This project was born out of curiosity, I wanted to know if I could reverse engineer enough out of this game to be able to render and parse level files, given how insanely/poorly structured they are. Turns out with a lot of patience (...and with Claude helping with the binary decoding parts...) you can do it.

## Features

Shows the terrain mesh rendered with textures, spawn locations and level data on the INTEL pane. There's also a COMMS/SCRIPT tab that shows the level script, basically the game rules for that level.

## How to use

Simply point it to your Uprising install folder and it should be able to guide itself from there. Left click rotates map, wheel zooms, and right click moves you around.
  
For now no editing/saving is done, just viewing (yes, I know, ironic).

## Contribs

This app was made with React + Vite + Electron, simply because I didn't want to delve into having a Go or Rust app do this, would add an insane amount of complexity. So if you happen to know more about the game and want to help, open a PR. Just be aware I like to be diligent about code submitted.

## License

The Unlicense
