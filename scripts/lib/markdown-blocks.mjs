// Fenced code blocks, found line by line.
//
// A single regular expression for "a fence, anything, the closing fence"
// backtracks on long runs of backticks: a line of 50,000 of them took seconds.
// Scanning lines keeps the work proportional to the text.
//
// A fence opens with three or more backticks or tildes at the start of a line
// (a backtick fence's info string has no backticks in it) and closes with a
// line of at least as many of the same character and nothing else. A fence
// that is never closed is not a block.

export function fencedBlocks(text) {
  const source = String(text ?? "");
  const blocks = [];
  let position = 0;
  let open = null;
  while (position <= source.length) {
    const lineEnd = source.indexOf("\n", position);
    const end = lineEnd === -1 ? source.length : lineEnd;
    const line = source.slice(position, end);
    if (open) {
      const close = /^(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (close && close[1][0] === open.fence[0] && close[1].length >= open.fence.length) {
        blocks.push({
          start: open.start,
          end,
          fence: open.fence,
          lang: open.info.trim().split(/\s+/)[0].toLowerCase(),
          info: open.info,
          body: source.slice(open.bodyStart, Math.max(open.bodyStart, position - 1))
        });
        open = null;
      }
    } else {
      const opening = /^(`{3,}|~{3,})(.*)$/.exec(line);
      if (opening && !(opening[1][0] === "`" && opening[2].includes("`"))) {
        open = { start: position, fence: opening[1], info: opening[2], bodyStart: Math.min(end + 1, source.length) };
      }
    }
    if (lineEnd === -1) break;
    position = lineEnd + 1;
  }
  return blocks;
}

// The text with every fenced block replaced (removed by default).
export function withoutFences(text, replacement = "") {
  const source = String(text ?? "");
  let out = "";
  let last = 0;
  for (const block of fencedBlocks(source)) {
    out += source.slice(last, block.start) + (typeof replacement === "function" ? replacement(block) : replacement);
    last = block.end;
  }
  return out + source.slice(last);
}

// The text cut into prose and code pieces, in order.
export function splitByFences(text) {
  const source = String(text ?? "");
  const pieces = [];
  let last = 0;
  for (const block of fencedBlocks(source)) {
    if (block.start > last) pieces.push({ code: false, text: source.slice(last, block.start) });
    pieces.push({ code: true, text: source.slice(block.start, block.end), block });
    last = block.end;
  }
  if (last < source.length) pieces.push({ code: false, text: source.slice(last) });
  return pieces;
}
