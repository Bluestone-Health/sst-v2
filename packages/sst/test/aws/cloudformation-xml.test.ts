import { expect, test } from "vitest";
import {
  CloudFormationClient,
  DescribeStackEventsCommand,
} from "@aws-sdk/client-cloudformation";
import { StandardRetryStrategy } from "@aws-sdk/middleware-retry";

function stackEvent(properties: string, index: number) {
  return `<member>
    <StackId>test-stack</StackId>
    <EventId>event-${index}</EventId>
    <StackName>test-stack</StackName>
    <Timestamp>2026-01-01T00:00:00Z</Timestamp>
    <ResourceProperties>${properties}</ResourceProperties>
  </member>`;
}

async function describeStackEvents(properties: string[], documentType = "") {
  let requests = 0;
  const client = new CloudFormationClient({
    region: "us-east-1",
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
    // SST uses this older retry implementation with its deployment clients.
    retryStrategy: new StandardRetryStrategy(async () => 1),
    requestHandler: {
      async handle() {
        requests++;
        return {
          response: {
            statusCode: 200,
            headers: {
              "content-type": "text/xml",
              "x-amzn-requestid": "test-request",
            },
            body: Buffer.from(`${documentType}<DescribeStackEventsResponse xmlns="http://cloudformation.amazonaws.com/doc/2010-05-15/">
              <DescribeStackEventsResult>
                <StackEvents>${properties
                  .map(stackEvent)
                  .join("")}</StackEvents>
                <NextToken>next-page</NextToken>
              </DescribeStackEventsResult>
              <ResponseMetadata><RequestId>test-request</RequestId></ResponseMetadata>
            </DescribeStackEventsResponse>`),
          },
        };
      },
    },
  });
  try {
    const result = await client.send(
      new DescribeStackEventsCommand({ StackName: "test-stack" })
    );
    expect(requests).toBe(1);
    expect(result.NextToken).toBe("next-page");
    expect(result.$metadata.requestId).toBe("test-request");
    return result.StackEvents;
  } finally {
    client.destroy();
  }
}

test.each([0, 1, 1000, 1001, 1304])(
  "decodes %i ordinary XML escapes in a CloudFormation event",
  async (count) => {
    const events = await describeStackEvents(["&quot;".repeat(count)]);
    expect(events).toHaveLength(1);
    expect(events![0].ResourceProperties).toBe('"'.repeat(count));
  }
);

test("decodes multiple large events without losing event boundaries", async () => {
  const events = await describeStackEvents([
    "&quot;".repeat(1304),
    "&amp;&lt;&gt;&apos;&quot;".repeat(300),
  ]);
  expect(events?.map((event) => event.EventId)).toEqual(["event-0", "event-1"]);
  expect(events?.map((event) => event.ResourceProperties)).toEqual([
    '"'.repeat(1304),
    `&<>'"`.repeat(300),
  ]);
});

test("preserves escaped JSON and does not decode entities twice", async () => {
  const events = await describeStackEvents([
    "{&quot;value&quot;:&quot;&amp;quot; &lt;tag&gt; &amp; text&quot;}",
  ]);
  expect(events![0].ResourceProperties).toBe('{"value":"&quot; <tag> & text"}');
});

test("decodes escapes across events beyond the document-wide limit", async () => {
  const events = await describeStackEvents([
    "&quot;".repeat(700),
    "&amp;".repeat(700),
  ]);
  expect(events?.map((event) => event.ResourceProperties)).toEqual([
    '"'.repeat(700),
    "&".repeat(700),
  ]);
});

test("does not let a dotted entity replace a built-in XML entity", async () => {
  const events = await describeStackEvents(
    ["&lt;item&gt;"],
    '<!DOCTYPE DescribeStackEventsResponse [<!ENTITY l. "unexpected">]>'
  );
  expect(events![0].ResourceProperties).toBe("<item>");
});
