type Scalar = string | number | boolean | null;
type NodeValue = Scalar | Record<string, NodeValue>;

/** Removes matching single or double quotes around a YAML scalar token. */
function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/** Parses the limited scalar forms supported by the daemon's config parser. */
function parseScalar(rawValue: string): Scalar {
  const value = stripQuotes(rawValue.trim());
  if (value === "null") {
    return null;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (/^-?\d+$/.test(value)) {
    return Number(value);
  }
  return value;
}

/** Parses the repo's indentation-based YAML subset into nested plain objects. */
export function parseSimpleYaml(source: string): Record<string, NodeValue> {
  const root: Record<string, NodeValue> = {};
  const stack: Array<{ indent: number; target: Record<string, NodeValue> }> = [
    { indent: -1, target: root }
  ];

  for (const rawLine of source.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith("#")) {
      continue;
    }

    const indent = rawLine.length - rawLine.trimStart().length;
    const line = rawLine.trim();
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      throw new Error(`Invalid config line: ${rawLine}`);
    }

    const key = stripQuotes(line.slice(0, separatorIndex).trim());
    const remainder = line.slice(separatorIndex + 1).trim();

    while (stack.length > 1 && indent <= stack[stack.length - 1]!.indent) {
      stack.pop();
    }

    const current = stack[stack.length - 1]!.target;

    if (!remainder) {
      const nested: Record<string, NodeValue> = {};
      current[key] = nested;
      stack.push({ indent, target: nested });
      continue;
    }

    current[key] = parseScalar(remainder);
  }

  return root;
}
