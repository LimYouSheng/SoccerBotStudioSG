import ts from "typescript";
export function inspectTests(file, text) {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const inventory = [],
    errors = [];
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const expression = node.expression.getText(source);
      if (
        /^(?:test|it|describe)(?:\.|\()/.test(expression) &&
        /\.(?:only|skip|fixme|todo|skipIf|runIf|fails)\b/.test(expression)
      )
        errors.push(`Disabled/exclusive test: ${file}`);
      if (
        ts.isIdentifier(node.expression) &&
        ["it", "test"].includes(node.expression.text) &&
        /\.(test|spec)\.tsx?$/.test(file)
      ) {
        if (!ts.isStringLiteral(node.arguments[0]) || node.arguments.length < 2)
          errors.push(`Nonliteral/incomplete test: ${file}`);
        else
          inventory.push({
            file: file.replaceAll("\\", "/"),
            title: node.arguments[0].text,
          });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return { inventory, errors };
}
export const orderedInventory = (items) =>
  JSON.stringify(
    [...items].sort((a, b) =>
      (a.file + "\0" + a.title).localeCompare(b.file + "\0" + b.title),
    ),
  );
