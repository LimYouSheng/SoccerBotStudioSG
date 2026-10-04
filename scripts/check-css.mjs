import postcss from "postcss";
import * as cssTree from "css-tree";
export function checkCss(text, runtime = "") {
  const errors = [];
  let root;
  try {
    root = postcss.parse(text);
  } catch (error) {
    return [`CSS syntax: ${error.reason}`];
  }
  const defined = new Set();
  root.walkDecls(/^--/, (node) => defined.add(node.prop));
  root.walkRules((rule) => {
    const seen = new Set();
    rule.walkDecls((declaration) => {
      const key = declaration.prop.toLowerCase();
      if (seen.has(key))
        errors.push(`Duplicate CSS property: ${rule.selector} / ${key}`);
      seen.add(key);
    });
    try {
      const selector = cssTree.parse(rule.selector, {
        context: "selectorList",
      });
      if (runtime)
        cssTree.walk(selector, (node) => {
          if (
            node.type === "ClassSelector" &&
            !new RegExp(`\\b${node.name.replaceAll("-", "\\-")}\\b`).test(
              runtime,
            )
          )
            errors.push(`Unused CSS class: ${node.name}`);
        });
    } catch {
      errors.push(`CSS selector syntax: ${rule.selector}`);
    }
  });
  root.walkDecls((node) => {
    for (const [, name, fallback] of node.value.matchAll(
      /var\(\s*(--[\w-]+)\s*(,?)/g,
    ))
      if (!fallback && !defined.has(name))
        errors.push(`Undefined CSS variable: ${name}`);
    if (node.prop.startsWith("--")) return;
    if (node.value.includes("<EMBEDDED_ASSET>"))
      errors.push("Unresolved embedded CSS asset");
    try {
      const value = cssTree.parse(node.value, {
        context: "value",
        positions: true,
      });
      // Custom properties are resolved by CSS, so their type is checked at use/runtime.
      if (!/\bvar\(/.test(node.value)) {
        const match =
          node.parent.type === "atrule" && node.parent.name === "font-face"
            ? cssTree.lexer.matchAtruleDescriptor("font-face", node.prop, value)
            : cssTree.lexer.matchProperty(node.prop, value);
        if (match.error)
          errors.push(`Invalid CSS value: ${node.prop}: ${node.value}`);
      }
    } catch {
      errors.push(`CSS value syntax: ${node.prop}: ${node.value}`);
    }
  });
  return [...new Set(errors)];
}
