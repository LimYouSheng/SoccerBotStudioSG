import postcss from "postcss";
const functional =
  /\.(?:booking|page-title|section-title|lead|surface|field|hint|small|button|text-link|back|pill|alert|dialog|access|auth|session|player|counter|inclusion|summary|aside|basket|calendar|date|dates|month|legend|series|time|times|rotation|note|empty|check-label|review|line-item|payment|merchant|method|status|reference|confirmation|trainer|fixed-session|arrival|progress|checking)(?:\b|-)/;
const artwork = /\.(?:arena|pitch|studio-bottom|studio-book-arrow)\b/;
const palettePairs = [
  ["--color-ink", "--color-surface", 4.5],
  ["--color-muted", "--color-surface", 4.5],
  ["--color-muted", "--color-paper", 4.5],
  ["--color-muted", "--color-brand-soft", 4.5],
  ["--color-on-brand", "--color-action", 4.5],
  ["--color-on-brand", "--color-action-hover", 4.5],
  ["--color-on-brand-muted", "--color-brand", 4.5],
  ["--color-success", "--color-success-soft", 4.5],
  ["--color-danger", "--color-danger-soft", 4.5],
  ["--color-warning", "--color-surface", 4.5],
  ["--color-warning-inverse", "--color-brand", 4.5],
  ["--color-focus", "--color-surface", 3],
  ["--color-focus", "--color-brand", 3],
  ["--color-control-border", "--color-surface", 3],
];
function luminance(hex) {
  const channels = hex.match(/[a-f0-9]{2}/gi).map((channel) => {
    const value = parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
export function designAudit(text) {
  const errors = [],
    contrast = [];
  let css;
  try {
    css = postcss.parse(text);
  } catch {
    return { errors: ["Design CSS cannot be parsed"], contrast };
  }
  const theme = css.nodes.find(
    (n) => n.type === "atrule" && n.name === "theme",
  );
  const tokens = new Map(
    (theme?.nodes ?? [])
      .filter((n) => n.type === "decl")
      .map((n) => [n.prop, n.value]),
  );
  function resolve(name, seen = new Set()) {
    if (seen.has(name)) throw Error(`Cyclic design token: ${name}`);
    seen.add(name);
    const value = tokens.get(name);
    if (!value) throw Error(`Missing design token: ${name}`);
    const ref = /^var\((--[\w-]+)\)$/.exec(value);
    return ref ? resolve(ref[1], seen) : value;
  }
  try {
    for (const name of [
      "--color-brand",
      "--color-navy",
      "--color-action",
      "--color-action-border",
    ])
      if (resolve(name).toLowerCase() !== "#050a2f")
        errors.push(`Header blue drift: ${name}`);
    for (const [fg, bg, minimum] of palettePairs) {
      const values = [resolve(fg), resolve(bg)];
      if (values.some((v) => !/^#[a-f0-9]{6}$/i.test(v)))
        throw Error(`Unresolved contrast colour: ${fg}/${bg}`);
      const [a, b] = values.map(luminance).sort((x, y) => y - x);
      const ratio = (a + 0.05) / (b + 0.05);
      contrast.push({ foreground: fg, background: bg, ratio, minimum });
      if (ratio < minimum) errors.push(`Insufficient contrast: ${fg}/${bg}`);
    }
    const roles = [
      "page",
      "dialog",
      "section",
      "card",
      "body",
      "label",
      "caption",
    ];
    const sizes = roles.map((name) => {
      const value = resolve(`--text-${name}`);
      if (!/^\d+(?:\.\d+)?rem$/.test(value))
        throw Error(`Invalid type role: ${name}`);
      return parseFloat(value) * 16;
    });
    if (
      sizes.some((v, i) => i && v >= sizes[i - 1]) ||
      sizes[4] < 16 ||
      sizes[5] < 14 ||
      sizes[6] < 12
    )
      errors.push("Typography hierarchy or minimum readability regressed");
    if (parseFloat(resolve("--text-meta")) * 16 < 14)
      errors.push("Supporting text is below 14px");
    if (
      resolve("--control-height") !== "52px" ||
      resolve("--icon-control-size") !== "44px"
    )
      errors.push("Control size contract regressed");
  } catch (error) {
    errors.push(error.message);
  }
  const faces = [];
  css.walkAtRules("font-face", (rule) => {
    const face = Object.fromEntries(
      rule.nodes.filter((n) => n.type === "decl").map((n) => [n.prop, n.value]),
    );
    faces.push(`${face["font-weight"]}:${face["font-style"] ?? "normal"}`);
  });
  if (faces.sort().join(",") !== "400:normal,500:normal,700:normal,900:italic")
    errors.push(
      "Roboto static font weights/styles must match the supplied files",
    );
  css.walkRules((rule) => {
    if (!artwork.test(rule.selector))
      rule.walkDecls((d) => {
        if (d.value.includes("var(--color-arena-accent)"))
          errors.push(`Decorative accent used in interface: ${rule.selector}`);
      });
    if (!functional.test(rule.selector) || artwork.test(rule.selector)) return;
    rule.walkDecls((d) => {
      if (/#(?:[a-f0-9]{3,8})\b|\b(?:rgb|hsl)a?\(/i.test(d.value))
        errors.push(`Local interface colour bypass: ${rule.selector}`);
      if (
        d.prop === "font-size" &&
        d.value !== "inherit" &&
        !/^var\(--text-[\w-]+\)$/.test(d.value)
      )
        errors.push(`Local interface type size bypass: ${rule.selector}`);
    });
  });
  return { errors: [...new Set(errors)], contrast };
}
