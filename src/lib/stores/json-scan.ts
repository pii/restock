import "server-only";

/**
 * Parses the JSON object or array that starts at `start` inside a larger text,
 * such as a React Server Components payload where data sits between other
 * content. Returns null if the text there isn't complete, valid JSON.
 */
export function readJsonAt<T = unknown>(text: string, start: number): T | null {
  const open = text[start];
  if (open !== "{" && open !== "[") return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
    } else if (c === "{" || c === "[") {
      depth++;
    } else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1)) as T;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
