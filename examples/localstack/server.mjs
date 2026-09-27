import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

const [id, endpoint, port = "3001"] = process.argv.slice(2);
if (
  !/^[a-z][a-z0-9-]{0,31}$/.test(id || "") ||
  !/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint || "")
)
  throw new Error(
    "Usage: node server.mjs <env-id> http://127.0.0.1:<localstack-port> [web-port]"
  );
const lambda = new LambdaClient({
  endpoint,
  region: "us-east-1",
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
});
const page = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>SST LocalStack example</title>
<style>body{font:18px system-ui;max-width:850px;margin:3rem auto;padding:1rem}button{font:inherit;margin:.4rem;padding:.6rem}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#eee;padding:1rem}</style>
<h1>SST on your machine</h1><p>Upload a marker to S3, deliver work through SQS, and read the resulting PostgreSQL rows.</p>
<button id="upload">Upload and download</button><button id="queue">Queue work with one retry</button><button id="read">Refresh database</button>
<pre id="result" role="status">Ready</pre><script>
const result=document.querySelector('#result');
async function invoke(event){const response=await fetch('/invoke',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(event)});const value=await response.json();if(!response.ok)throw Error(value.error);return value;}
for(const action of ['upload','queue','read'])document.querySelector('#'+action).onclick=async()=>{try{result.textContent='Working…';let value=await invoke({action,failOnce:true});if(action==='upload'){let response=await fetch(value.upload,{method:'PUT',body:value.marker});if(!response.ok)throw Error('Upload failed');response=await fetch(value.download);if(!response.ok)throw Error('Download failed');value={key:value.key,downloaded:await response.text(),next:'Refresh database after SQS delivers the S3 event'};}result.textContent=JSON.stringify(value,null,2);}catch(error){result.textContent=error.message;}};
</script></html>`;
createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/") {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(page);
      return;
    }
    if (req.method !== "POST" || req.url !== "/invoke") {
      res.writeHead(404).end();
      return;
    }
    if (
      req.headers.origin &&
      req.headers.origin !== `http://127.0.0.1:${port}`
    ) {
      res.writeHead(403).end();
      return;
    }
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 8192) throw new Error("Request too large");
    }
    const event = JSON.parse(body);
    const outputs = JSON.parse(
      await readFile(`.sst/local/${id}/outputs.json`, "utf8")
    );
    const response = await lambda.send(
      new InvokeCommand({
        FunctionName: outputs.EntryFunction,
        Payload: Buffer.from(JSON.stringify(event)),
      })
    );
    const payload = JSON.parse(Buffer.from(response.Payload).toString());
    res.setHeader("content-type", "application/json");
    res
      .writeHead(response.FunctionError ? 502 : 200)
      .end(
        JSON.stringify(
          response.FunctionError ? { error: payload.errorMessage } : payload
        )
      );
  } catch (error) {
    res
      .writeHead(500, { "content-type": "application/json" })
      .end(JSON.stringify({ error: error.message }));
  }
}).listen(Number(port), "127.0.0.1", () =>
  console.log(`http://127.0.0.1:${port}`)
);
