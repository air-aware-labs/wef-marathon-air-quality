// Collapses the INLINE_ALL build into one self-contained HTML fragment:
// CSS, JS bundle, fonts/logo (already data URIs) and the JSON data payload,
// with a fetch shim so the app's runtime data loads work with no network.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dist = "dist-inline";
const out = process.argv[2];

const assets = readdirSync(join(dist, "assets"));
const css = readFileSync(join(dist, "assets", assets.find((f) => f.endsWith(".css"))), "utf8");
const js = readFileSync(join(dist, "assets", assets.find((f) => f.endsWith(".js"))), "utf8");

// Rolldown emits raw UTF-8, and the artifact wrapper owns <head>, so nothing can
// declare a charset. Escape every non-ASCII code unit instead: \uXXXX is valid in
// JS strings, template literals and regexes, and in CSS values.
const toAscii = (text, esc) =>
  text.replace(/[\u0080-\uffff]/g, (ch) => esc + ch.charCodeAt(0).toString(16).padStart(4, "0") + (esc === "\\" ? " " : ""));
const jsAscii = toAscii(js, "\\u");
const cssAscii = toAscii(css, "\\");

// Walk the built data directory rather than listing files: a hardcoded list
// silently dropped locator.json and closure/london.json when they were added,
// which would have cost the artifact its locator inset and closure section.
const dataFiles = [];
const walk = (dir) => {
  for (const entry of readdirSync(join(dist, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(rel);
    else if (entry.name.endsWith(".json")) dataFiles.push(rel);
  }
};
walk("data");
const payload = {};
for (const rel of dataFiles) {
  payload[rel] = JSON.parse(readFileSync(join(dist, rel), "utf8"));
}

// \/ is a legal JSON escape, so this can never close the host <script> element.
// Non-ASCII is escaped because the wrapper owns <head>: without a charset
// declaration a stray UTF-8 byte would render as mojibake (e.g. PM2.5 subscripts).
const payloadJson = JSON.stringify(payload)
  .replace(/<\//g, "<\\/")
  .replace(/[\u0080-\uffff]/g, (ch) => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"));

const html = `<title>AirTrack marathon route analysis</title>
<style>
/* The AirTrack brand ground is light by design; hold it in dark-mode viewers. */
:root { color-scheme: light; }
${cssAscii}
#root { min-height: 100vh; }
</style>
<div id="root"></div>
<script type="application/json" id="airtrack-data">${payloadJson}</script>
<script>
  // The page normally fetches its route data over HTTP; serve it from the
  // embedded payload so the single-file build needs no network at all.
  (function () {
    var embedded = JSON.parse(document.getElementById("airtrack-data").textContent);
    var passthrough = window.fetch ? window.fetch.bind(window) : null;
    window.fetch = function (resource, init) {
      var key = String(resource && resource.url ? resource.url : resource).replace(/^\\.\\//, "");
      if (Object.prototype.hasOwnProperty.call(embedded, key)) {
        return Promise.resolve(
          new Response(JSON.stringify(embedded[key]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (!passthrough) return Promise.reject(new Error("Offline build: " + key + " is not embedded."));
      return passthrough(resource, init);
    };
  })();
</script>
<script type="module">
${jsAscii}
</script>
`;

if (/[\u0080-\uffff]/.test(html)) {
  const bad = html.match(/[\u0080-\uffff]/g);
  throw new Error("Non-ASCII survived in single-file output: " + [...new Set(bad)].slice(0, 20).join(" "));
}
writeFileSync(out, html);
console.log("wrote", out, (html.length / 1024 / 1024).toFixed(2), "MB");
console.log("embedded data files:", Object.keys(payload).length);
