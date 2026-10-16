export function tokenize(s) {
  const out = [];
  let i = 0;
  const white = (c) => c !== undefined && /[\x00\t\n\f\r ]/.test(c);
  while (i < s.length) {
    if (white(s[i])) {
      i++;
      continue;
    }
    if (s[i] === "%") {
      while (i < s.length && !/[\r\n]/.test(s[i])) i++;
      continue;
    }
    const start = i;
    let value = null,
      type = "word";
    if (s[i] === "(") {
      type = "string";
      value = "";
      i++;
      let depth = 1;
      while (i < s.length && depth) {
        let c = s[i++];
        if (c === "\\") {
          c = s[i++];
          if (c === undefined) throw Error("Incomplete string");
          if (/[0-7]/.test(c)) {
            let n = c;
            for (let k = 0; k < 2 && /[0-7]/.test(s[i] || "x"); k++)
              n += s[i++];
            value += String.fromCharCode(parseInt(n, 8) & 255);
          } else if (c === "\r") {
            if (s[i] === "\n") i++;
          } else if (c !== "\n")
            value += { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" }[c] ?? c;
        } else if (c === "(") {
          depth++;
          value += c;
        } else if (c === ")") {
          if (--depth) value += c;
        } else value += c;
      }
      if (depth) throw Error("Unclosed string");
    } else if (s[i] === "<" && s[i + 1] !== "<") {
      type = "string";
      const end = s.indexOf(">", ++i);
      if (end < 0) throw Error("Unclosed hex string");
      let h = s.slice(i, end).replace(/\s/g, "");
      if (!/^[0-9a-f]*$/i.test(h)) throw Error("Invalid hex string");
      if (h.length % 2) h += "0";
      value = h.replace(/../g, (v) => String.fromCharCode(parseInt(v, 16)));
      i = end + 1;
    } else if ("[]<>".includes(s[i])) {
      type = "delimiter";
      i++;
      if (s[i] === s[start] && "<>".includes(s[start])) i++;
    } else {
      if (s[i] === "/") {
        type = "name";
        i++;
      }
      while (i < s.length && !white(s[i]) && !/[()[\]<>/%]/.test(s[i])) i++;
      if (i === start) throw Error("Unsupported content token");
    }
    if (out.length >= 500000)
      throw Error("Content stream exceeds the token limit.");
    out.push({ start, end: i, type, value, raw: s.slice(start, i) });
  }
  return out;
}
