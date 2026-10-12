# How to design a terminal UI with OTIS

A walk-through from installing OTIS to handing a finished screen to your AI
agent to build. Each part stands on its own, so skip to what you need.

## 1. Install it

The easy way: tell your coding agent (Claude Code, Codex, Grok, OpenCode,
Pi…):

```text
Install https://github.com/WolfBrandon/otis as an app
```

Or run the installer yourself:

```sh
curl -fsSL https://raw.githubusercontent.com/WolfBrandon/otis/main/install.sh | bash
```

Then press **Super + Space** and type **OTIS**. If something looks off,
`~/.local/share/otis/app/install.sh --check` says what's set up and what
isn't.

## 2. Lay out your first screen

1. **File → New project.** Pick the size of the terminal you're designing
   for, such as 120 × 40.
2. **Draw the frame.** `B` draws boxes: pick a border style in the bar above
   the canvas, then drag. Boxes take a title on the top border. Lines that
   touch join up into proper corners and tees (`├ ┬ ┼`).
3. **Fill it in.** `T` for text: click anywhere, a box included, to type new
   text there, or click existing text to edit it. `#` for a table, `A` for
   arrows. The **Snippets** panel has ready-made widgets (progress bars,
   sparklines, status lines, menus): click one to drop it in.
4. **Add a title.** `Shift + T` opens TextArt. Type the name, pick a font
   (Blocks 3D is the solid look of OTIS's own logo) and a size.
5. **Color it with the palette.** Pick colors from the **Palette** panel's
   slots (accent, muted, red…) rather than fixed hex values, then switch
   themes there: the whole design follows, like your terminal does.

Double-click any text to edit it. `Ctrl + Z` undoes, and OTIS saves as you
go.

## 3. Add more screens with tabs

Most apps have more than one screen. The tab bar above the canvas holds them.

- **`+`** adds a blank tab the size of the first one.
- **`⋯` → Duplicate** copies a tab with everything on it. That's the quick way
  to make a settings screen that keeps the main screen's frame and status bar.
- Double-click a tab to rename it, drag tabs to reorder them, and use
  `Alt + PageUp` / `Alt + PageDown` to flip between them.

## 4. Make a popup or dialog

1. In the **Layers** panel, click `+` to add a layer above your screen and
   name it "Popup". Keeping popups on their own layer means their lines don't
   join with the screen underneath.
2. Draw a box on it, then in **Properties → Fill** choose **Solid**. A solid
   box hides everything underneath it, border included; a see-through one
   lets the screen show through.
3. Hide the layer (the eye icon) to see the screen without the popup.

## 5. Resize a whole layout

Select several objects (drag a box around them, or `Ctrl + A`) and drag one
of the handles around the selection. Everything stretches or shrinks
together, and lines that meet a border still meet it. A group works the same
way.

## 6. Design with your AI agent

After installing, start a new session with your agent so it picks up OTIS's
tools. Keep OTIS open next to it: every change shows up live, and `Ctrl + Z`
in OTIS undoes anything the agent did. Things to try:

- "Sketch a TUI for a Docker dashboard in OTIS."
- "Add a status bar along the bottom with the time and the branch name."
- "Add a Settings tab with a form for theme, font and notifications."
- "Make the selected box a popup: solid fill, accent border." Select things in
  OTIS first, and the agent knows which ones you mean.
- "Put a TextArt title, OSCAR, at the top in Blocks 3D."

The agent works on the tab you're looking at unless you name another one.

## 7. Turn it into something real

- **Code:** ask your agent to "build this OTIS screen in Bubble Tea" (or
  Ratatui, Textual, Ink…). It reads the exact positions, text and colors of
  everything on the canvas, not a screenshot.
- **Docs:** **Export** (`Ctrl + E`) → Markdown gives a code block you can paste
  into a README or an issue; tick "All tabs" to get every screen.
- **The terminal:** Export → ANSI, then `cat design.ans` shows it in color.
- **Pictures:** Export → PNG.

## 8. Keep it up to date

- **Update:** **Help → About OTIS** says when a new version is out. Click
  **Update now**: OTIS downloads it, restarts and reloads in a few seconds,
  and your projects aren't touched. Running the install command again (or
  asking your agent to update OTIS) does the same, and also refreshes the
  launcher and agent connections. Start a new agent session afterwards to get
  updated tools.
- **Trouble:** `install.sh --check` first, then the log:
  `journalctl --user -u otis -n 30`. After an update, the log shows OTIS
  stopping with "exit-code" right after "Restarting on the new version":
  that's how it restarts, not a crash.
- **Remove:** `~/.local/share/otis/app/install.sh --uninstall` takes out the
  app, launcher and agent connections. Your projects stay in
  `~/.local/share/otis/projects`.
