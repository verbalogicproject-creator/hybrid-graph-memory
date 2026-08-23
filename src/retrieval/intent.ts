import { RetrievalIntent } from "../core/types";

export function inferQueryIntent(query: string): RetrievalIntent {
  const q = query.toLowerCase();

  if (
    q.includes("architecture") ||
    q.includes("design") ||
    q.includes("overview") ||
    q.includes("structure") ||
    q.includes("flow") ||
    q.includes("spec") ||
    q.includes("relation")
  ) {
    return "architecture";
  }

  if (
    q.includes("history") ||
    q.includes("previous") ||
    q.includes("last") ||
    q.includes("yesterday") ||
    q.includes("commit") ||
    q.includes("changelog")
  ) {
    return "history";
  }

  if (
    q.includes("how to") ||
    q.includes("implement") ||
    q.includes("function") ||
    q.includes("method") ||
    q.includes("code") ||
    q.includes("class") ||
    q.includes("api")
  ) {
    return "implementation";
  }

  if (
    /^[A-Z][a-zA-Z0-9]+$/.test(query.trim()) ||
    /^[a-z]+[A-Z][a-zA-Z0-9]+$/.test(query.trim()) ||
    query.trim().startsWith("use") ||
    query.trim().startsWith("get") ||
    query.trim().startsWith("set")
  ) {
    return "exact_symbol";
  }

  return "general";
}
