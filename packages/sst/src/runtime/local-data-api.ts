import type { Request, Response } from "express";
import { SignatureV4 } from "@smithy/signature-v4";
import { Sha256 } from "@aws-crypto/sha256-js";

/** Work around LocalStack's named-tuple rows and column-name-based type lookup. */
export function rewriteTextCasts(sql: string) {
  const unchanged = { sql, aliases: {} as Record<string, string> };
  // shortcut: simple SELECT casts only; remove when the pinned emulator fixes row names and metadata.
  if (/'|;|--|\/\*|\$(?:[a-z_]\w*)?\$/i.test(sql)) return unchanged;
  const tokens = [...sql.matchAll(/"(?:[^"]|"")*"|::|[a-z_][\w$]*|[^\s]/gi)];
  const word = (index: number) => tokens[index]?.[0].toLowerCase();
  if (word(0) !== "select") return unchanged;
  if (tokens.slice(1).some((token) => token[0].toLowerCase() === "select"))
    return unchanged;
  if (tokens.some((token) => token[0].toLowerCase() === "into"))
    return unchanged;
  const from = tokens.findIndex((token) => token[0].toLowerCase() === "from");
  if (from < 0) return unchanged;
  const name = (token: string) =>
    token.startsWith('"')
      ? token.slice(1, -1).replaceAll('""', '"')
      : token.toLowerCase();
  const aliases: Record<string, string> = Object.create(null);
  const edits: { start: number; end: number; value: string }[] = [];
  for (let i = 1; i + 4 < from; i++) {
    const column = tokens[i][0];
    const alias = tokens[i + 4][0];
    if (
      !column.startsWith('"') ||
      word(i + 1) !== "::" ||
      word(i + 2) !== "text" ||
      word(i + 3) !== "as" ||
      !alias.startsWith('"') ||
      name(column) !== name(alias)
    )
      continue;
    const ordering = tokens.findIndex((token) =>
      /^(order|group|having|window)$/i.test(token[0])
    );
    if (
      ordering >= 0 &&
      tokens.slice(ordering + 1).some((token) => name(token[0]) === name(alias))
    )
      return unchanged;
    let index = edits.length;
    while (
      tokens.some((token) => name(token[0]) === `sst_local_text_${index}`) ||
      aliases[`sst_local_text_${index}`]
    )
      index++;
    const wireName = `sst_local_text_${index}`;
    aliases[wireName] = name(alias);
    edits.push({
      start: tokens[i + 4].index!,
      end: tokens[i + 4].index! + alias.length,
      value: `"${wireName}"`,
    });
  }
  for (const edit of edits.reverse())
    sql = sql.slice(0, edit.start) + edit.value + sql.slice(edit.end);
  return { sql, aliases };
}

/** Preserve DO bodies while avoiding LocalStack's splitting at inner semicolons. */
export function rewriteDoBlock(sql: string) {
  // shortcut: one dollar-quoted DO block only; remove when the emulator handles it.
  const block =
    /^\s*[dD][oO]\s+(\$(?:[a-zA-Z_]\w*)?\$)([\s\S]*?)\1\s*;?\s*$/.exec(sql);
  if (!block || block[2].includes(block[1])) return sql;
  const body = block[2]
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "''")
    .replaceAll(";", "\\073");
  return `DO E'${body}'`;
}

export function localDataApi(options: { endpoint: string; region: string }) {
  const endpoint = new URL(options.endpoint);
  const signer = new SignatureV4({
    service: "rds-data",
    region: options.region,
    sha256: Sha256,
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
  });
  const actions = new Set([
    "Execute",
    "BatchExecute",
    "BeginTransaction",
    "CommitTransaction",
    "RollbackTransaction",
  ]);
  return async (req: Request, res: Response) => {
    if (!actions.has(req.params.action)) {
      res.status(404).json({ message: "Unknown Data API action" });
      return;
    }
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      res.status(400).json({ message: "Invalid Data API request" });
      return;
    }
    const query =
      req.params.action === "Execute" &&
      req.body.formatRecordsAs !== "JSON" &&
      typeof req.body.sql === "string"
        ? rewriteTextCasts(rewriteDoBlock(req.body.sql))
        : undefined;
    try {
      const signed = await signer.sign({
        method: "POST",
        protocol: endpoint.protocol,
        hostname: endpoint.hostname,
        port: Number(endpoint.port) || 80,
        path: `/${req.params.action}`,
        headers: { host: endpoint.host, "content-type": "application/json" },
        body: JSON.stringify({
          ...req.body,
          ...(query ? { sql: query.sql } : {}),
        }),
      });
      const upstream = await fetch(`${endpoint.origin}${signed.path}`, {
        method: "POST",
        headers: signed.headers,
        body: signed.body,
        signal: AbortSignal.timeout(900_000),
      });
      let body = await upstream.text();
      if (upstream.ok && query && Object.keys(query.aliases).length) {
        const result = JSON.parse(body);
        for (const column of result.columnMetadata || []) {
          const original = query.aliases[column.label || column.name];
          if (original)
            Object.assign(column, {
              name: original,
              label: original,
              typeName: "text",
              type: 12,
              tableName: "",
            });
        }
        body = JSON.stringify(result);
      }
      for (const header of [
        "content-type",
        "x-amzn-errortype",
        "x-amzn-requestid",
      ]) {
        const value = upstream.headers.get(header);
        if (value) res.setHeader(header, value);
      }
      res.status(upstream.status).send(body);
    } catch {
      res.status(502).json({ message: "Local Data API request failed" });
    }
  };
}
