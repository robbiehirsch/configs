# xp — daily experiments. Makes a dated folder, seeds it, and cd's into it.
#
#   xp                      fzf menu: type (and language for code), then a name
#   xp <type> [name]        blender | photo | genai | code
#   xp code <lang> [name]   go | js | ts | react | htmx | docker | shell
#   xp recent               fzf over existing experiments, newest first, cd there
#
# Layout: <root>/<type>/<year>/<YYYY-MM-DD>_<name>/ (code adds a <lang> level).
# Blender/photo/genai live on the NAS so every machine (and the Flamenco farm)
# sees them; code stays on local disk where node_modules and builds are fast.

XP_NAS_ROOT="/nfs/flamenco/sandbox"
XP_CODE_ROOT="$HOME/sandbox/code"
XP_RENDER_ROOT="/nfs/flamenco/renders/sandbox"
XP_TYPES=(blender photo genai code)
XP_LANGS=(go js ts react htmx docker shell)

xp() {
  emulate -L zsh
  setopt err_return no_unset pipe_fail extended_glob

  local type=${1:-} lang="" name=""
  if [[ $type == recent ]]; then _xp_recent; return; fi

  if [[ -z $type ]]; then
    type=$(print -l recent $XP_TYPES | fzf --height=~40% --reverse --no-multi --no-preview --prompt='xp> ') || return 1
    if [[ $type == recent ]]; then _xp_recent; return; fi
  fi
  (( ${XP_TYPES[(Ie)$type]} )) || { print -u2 "xp: unknown type '$type' (${(j:, :)XP_TYPES})"; return 1 }
  if (( $# )); then shift; fi

  if [[ $type == code ]]; then
    lang=${1:-}
    if [[ -z $lang ]]; then
      lang=$(print -l $XP_LANGS | fzf --height=~40% --reverse --no-multi --no-preview --prompt='xp code> ') || return 1
    else
      shift
    fi
    (( ${XP_LANGS[(Ie)$lang]} )) || { print -u2 "xp: unknown language '$lang' (${(j:, :)XP_LANGS})"; return 1 }
  fi

  name=${*:-}
  [[ -n $name ]] || vared -p "name: " name
  local slug=${${(L)name//[^[:alnum:]]##/-}##-}; slug=${slug%%-}
  [[ -n $slug ]] || { print -u2 "xp: need a name"; return 1 }

  local date=$(date +%F) year=$(date +%Y) root
  if [[ $type == code ]]; then root=$XP_CODE_ROOT/$lang; else root=$XP_NAS_ROOT/$type; fi
  if [[ $root == /nfs/* && ! -w ${root%/*} ]]; then
    print -u2 "xp: ${root%/*} isn't reachable — is the NAS mounted? (ls /nfs/flamenco)"; return 1
  fi
  local dir=$root/$year/${date}_$slug
  if [[ -e $dir ]]; then
    print "xp: $dir already exists — opening it"; cd "$dir"; return
  fi

  case $type in
    photo)
      # Capture One makes its own session folder, so only prepare the parent.
      mkdir -p "$root/$year"; cd "$root/$year"
      print -n -- "${date}_$slug" | pbcopy
      print "Capture One: File > New Session"
      print "  Name:     ${date}_$slug   (copied to clipboard)"
      print "  Location: $root/$year"
      if [[ -d "/Applications/Capture One.app" ]]; then open -a "Capture One"; else print "  (Capture One isn't installed)"; fi
      return ;;
  esac

  mkdir -p "$dir" && cd "$dir"
  case $type in
    blender) _xp_blender "$dir" "${date}_$slug" ;;
    genai)   _xp_genai "$date" "$name" ;;
    code)    _xp_code_$lang "$slug" && _xp_git ;;
  esac
  print "xp: $dir"
}

_xp_recent() {
  local d
  d=$( { find "$XP_NAS_ROOT" -mindepth 3 -maxdepth 3 -type d 2>/dev/null
         find "$XP_CODE_ROOT" -mindepth 3 -maxdepth 3 -type d 2>/dev/null } |
       awk -F/ '{print $NF "\t" $0}' | sort -r | cut -f2 |
       fzf --height=~50% --reverse --no-multi --no-preview --prompt='xp recent> ' ) || return 1
  cd "$d"
}

_xp_blender() {
  local dir=$1 base=$2 renders=$XP_RENDER_ROOT/$2
  mkdir -p "$renders"
  # Save the user's startup scene as the new file, with render output pointed at
  # the farm-visible renders folder.
  /Applications/Blender.app/Contents/MacOS/Blender -b --python-expr "
import bpy
bpy.context.scene.render.filepath = '$renders/'
bpy.ops.wm.save_as_mainfile(filepath='$dir/$base.blend')
" >/dev/null 2>&1 || { print -u2 "xp: Blender couldn't create the .blend"; return 1 }
  print "renders -> $renders"
  open "$dir/$base.blend"
}

_xp_genai() {
  mkdir -p inputs outputs
  print -l "# $2" "" "$1" "" "## Prompts" "" "## Notes" "" > prompts.md
}

_xp_git() {
  git init -q -b main && git add -A && git commit -q -m "xp: start" && print "git: initialized"
}

_xp_code_go() {
  go mod init "xp/$1" >/dev/null 2>&1
  print -l 'package main' '' 'import "fmt"' '' 'func main() {' '	fmt.Println("hello")' '}' > main.go
  print -l '/bin/' > .gitignore
  print "run: go run ."
}

_xp_code_js() {
  print -l '{' "  \"name\": \"$1\"," '  "private": true,' '  "type": "module",' \
    '  "scripts": { "start": "node index.js" }' '}' > package.json
  print 'console.log("hello");' > index.js
  print -l node_modules/ > .gitignore
  print "run: npm start"
}

_xp_code_ts() {
  # Node 23+ runs .ts directly (type stripping), so no build step.
  print -l '{' "  \"name\": \"$1\"," '  "private": true,' '  "type": "module",' \
    '  "scripts": { "start": "node index.ts", "check": "npx -y -p typescript tsc --noEmit" }' '}' > package.json
  print -l '{' '  "compilerOptions": {' '    "target": "esnext",' '    "module": "nodenext",' \
    '    "strict": true,' '    "noEmit": true,' '    "allowImportingTsExtensions": true,' \
    '    "erasableSyntaxOnly": true' '  }' '}' > tsconfig.json
  print 'const greet = (name: string): string => `hello ${name}`;\nconsole.log(greet("ts"));' > index.ts
  print -l node_modules/ > .gitignore
  print "run: npm start   typecheck: npm run check"
}

_xp_code_react() {
  # Vite + React + TS files, written by hand; dependencies install on first `npm install`.
  mkdir -p src
  print -l '{' "  \"name\": \"$1\"," '  "private": true,' '  "type": "module",' \
    '  "scripts": { "dev": "vite", "build": "vite build" },' \
    '  "dependencies": { "react": "latest", "react-dom": "latest" },' \
    '  "devDependencies": { "vite": "latest", "@vitejs/plugin-react": "latest", "typescript": "latest", "@types/react": "latest", "@types/react-dom": "latest" }' \
    '}' > package.json
  print -l 'import { defineConfig } from "vite";' 'import react from "@vitejs/plugin-react";' '' \
    'export default defineConfig({ plugins: [react()] });' > vite.config.ts
  print -l '{' '  "compilerOptions": {' '    "target": "esnext",' '    "module": "esnext",' \
    '    "moduleResolution": "bundler",' '    "jsx": "react-jsx",' '    "strict": true,' '    "noEmit": true' '  },' \
    '  "include": ["src"]' '}' > tsconfig.json
  print -l '<!doctype html>' '<html lang="en">' '  <head><meta charset="UTF-8" /><title>'"$1"'</title></head>' \
    '  <body>' '    <div id="root"></div>' '    <script type="module" src="/src/main.tsx"></script>' '  </body>' '</html>' > index.html
  print -l 'import { StrictMode } from "react";' 'import { createRoot } from "react-dom/client";' 'import App from "./App";' '' \
    'createRoot(document.getElementById("root")!).render(' '  <StrictMode>' '    <App />' '  </StrictMode>,' ');' > src/main.tsx
  print -l 'import { useState } from "react";' '' 'export default function App() {' \
    '  const [count, setCount] = useState(0);' \
    '  return <button onClick={() => setCount((c) => c + 1)}>count is {count}</button>;' '}' > src/App.tsx
  print -l node_modules/ dist/ > .gitignore
  print "run: npm install && npm run dev"
}

_xp_code_htmx() {
  # Go server + one page using htmx from a CDN.
  go mod init "xp/$1" >/dev/null 2>&1
  print -l 'package main' '' 'import (' '	"fmt"' '	"log"' '	"net/http"' '	"time"' ')' '' \
    'func main() {' '	http.Handle("/", http.FileServer(http.Dir(".")))' \
    '	http.HandleFunc("/time", func(w http.ResponseWriter, r *http.Request) {' \
    '		fmt.Fprintf(w, "<p>%s</p>", time.Now().Format(time.Kitchen))' '	})' \
    '	log.Println("http://localhost:8000")' '	log.Fatal(http.ListenAndServe(":8000", nil))' '}' > main.go
  print -l '<!doctype html>' '<html lang="en">' '  <head>' '    <meta charset="UTF-8" />' "    <title>$1</title>" \
    '    <script src="https://unpkg.com/htmx.org@2.0.4"></script>' '  </head>' '  <body>' \
    '    <button hx-get="/time" hx-target="#out">what time is it?</button>' '    <div id="out"></div>' \
    '  </body>' '</html>' > index.html
  print -l '/bin/' > .gitignore
  print "run: go run .  ->  http://localhost:8000"
}

_xp_code_docker() {
  print -l 'FROM alpine:3' 'CMD ["echo", "hello from docker"]' > Dockerfile
  print -l 'services:' '  app:' '    build: .' > compose.yaml
  print -l .git > .dockerignore
  command -v docker >/dev/null || print "(docker isn't installed on this Mac)"
  print "run: docker compose up --build"
}

_xp_code_shell() {
  print -l '#!/usr/bin/env bash' 'set -euo pipefail' '' 'echo "hello"' > "$1.sh"
  chmod +x "$1.sh"
  print "run: ./$1.sh"
}
